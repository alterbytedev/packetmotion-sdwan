import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const setup = new URL('../deploy/controller/setup-controller.sh', import.meta.url).pathname;
const nginx = new URL('../deploy/proxy/setup-nginx.sh', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'controller-setup-'));
const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

// Fixture standing in for `ip -j -4 addr show`, so the scan is deterministic and needs no root.
const link = (ifname, operstate, addrs) => ({ ifname, operstate, addr_info: addrs.map(([local, prefixlen, dynamic]) => ({ local, prefixlen, ...(dynamic ? { dynamic: true } : {}) })) });
const fixture = join(dir, 'ip.json');
writeFileSync(fixture, JSON.stringify([
  link('lo', 'UNKNOWN', [['127.0.0.1', 8]]),
  link('ens33', 'UP', [['192.168.160.200', 24]]),
  link('ens34', 'UP', [['192.168.0.50', 24, true], ['192.168.88.100', 24]]),
  link('docker0', 'UP', [['172.17.0.1', 16]]),
  link('wt0', 'UNKNOWN', [['100.83.173.93', 16]]),
  link('eth9', 'DOWN', [['10.9.0.1', 24]]),
  link('ens36', 'UP', [['203.0.113.10', 24]]),
]));

function run(args, env = {}) {
  const result = spawnSync('bash', [setup, '--dry-run', '--non-interactive', '--port', '39999', ...args], {
    encoding: 'utf8',
    env: { ...process.env, FABRIC_SETUP_IP_JSON: fixture, FABRIC_SETUP_DEFAULT_DEV: 'ens33', ...env },
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

test('scripts have valid syntax and are executable', () => {
  for (const file of [setup, nginx]) assert.equal(spawnSync('bash', ['-n', file]).status, 0, file);
});

test('interface scan excludes loopback and classifies selected address', () => {
  const lab = run(['--mode', 'lab', '--address', '192.168.160.200']);
  assert.equal(lab.status, 0, lab.out);
  assert.match(lab.out, /serving interface\s+ens33 \(192\.168\.160\.200\)\s+\[private; default-route\]/);
  assert.match(lab.out, /TCP 80\s+NGINX on 192\.168\.160\.200: lab installer\/enrollment/);
  assert.match(lab.out, /Dry run: nothing was changed/);
});

test('selecting by interface needs --address when it has several IPs', () => {
  const result = run(['--mode', 'lab', '--interface', 'ens34']);
  assert.notEqual(result.status, 0);
  assert.match(result.out, /ens34 has 2 usable addresses/);
  assert.equal(run(['--mode', 'lab', '--interface', 'ens33']).status, 0);
});

test('unknown address, down interface and loopback are rejected', () => {
  assert.match(run(['--mode', 'lab', '--address', '10.1.1.1']).out, /not assigned to any local interface/);
  assert.match(run(['--mode', 'lab', '--address', '10.9.0.1']).out, /DOWN; bring it up/);
  assert.match(run(['--mode', 'lab', '--address', '127.0.0.1']).out, /not assigned to any local interface/);
});

test('risks flag DHCP, virtual, overlay and public addresses', () => {
  assert.match(run(['--mode', 'lab', '--address', '192.168.0.50']).out, /DHCP-assigned/);
  assert.match(run(['--mode', 'lab', '--address', '172.17.0.1']).out, /virtual\/overlay\/container/);
  assert.match(run(['--mode', 'lab', '--address', '100.83.173.93']).out, /overlay\/CGNAT/);
  assert.match(run(['--mode', 'lab', '--address', '203.0.113.10']).out, /public address/);
});

test('production disables cleartext enrollment, refuses a root service and warns about IP identity', () => {
  const production = run(['--mode', 'production', '--address', '192.168.160.200']);
  assert.match(production.out, /redirect to HTTPS only/);
  assert.match(production.out, /as 'packetmotion-controller'/);
  assert.match(production.out, /DNS name/);
  assert.doesNotMatch(production.out, /Lab: TCP 80/);
  assert.match(run(['--mode', 'production', '--address', '192.168.160.200', '--run-as', 'root']).out, /refuses a root service/);
});

test('rejects invalid options', () => {
  assert.match(run(['--mode', 'staging']).out, /--mode must be lab or production/);
  assert.match(run(['--mode', 'lab', '--address', '192.168.160.200', '--host', 'https://x']).out, /Host must be an IP address or DNS name/);
  assert.match(run(['--mode', 'lab', '--address', '192.168.160.200', '--tls-cert', 'x']).out, /only valid with --tls custom/);
});

// ---- custom (public/enterprise) certificate validation. A private test CA stands in for a public CA.
function issue(name, { cn = 'ctrl.example.test', san = 'DNS:ctrl.example.test', days = 90, ca = false } = {}) {
  const key = join(dir, `${name}.key`), crt = join(dir, `${name}.crt`), csr = join(dir, `${name}.csr`), ext = join(dir, `${name}.ext`);
  openssl('genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', key);
  openssl('req', '-new', '-key', key, '-subj', `/CN=${cn}`, '-out', csr);
  writeFileSync(ext, `basicConstraints=critical,CA:${ca ? 'TRUE' : 'FALSE'}\nsubjectAltName=${san}\n`);
  openssl('x509', '-req', '-in', csr, '-signkey', key, '-out', crt, '-days', String(days), '-extfile', ext);
  return { key, crt };
}
const custom = (pair, extra = []) => run(['--mode', 'production', '--address', '192.168.160.200', '--host', 'ctrl.example.test', '--tls', 'custom', '--tls-cert', pair.crt, '--tls-key', pair.key, ...extra]);

test('custom certificate: untrusted chain is refused unless explicitly allowed', () => {
  const pair = issue('selfsigned');
  const refused = custom(pair);
  assert.notEqual(refused.status, 0);
  assert.match(refused.out, /does not verify against the OS trust store/);
  const allowed = custom(pair, ['--allow-untrusted-chain']);
  assert.equal(allowed.status, 0, allowed.out);
  assert.match(allowed.out, /edges must trust the issuing CA/);
  assert.match(allowed.out, /operator supplied/);
});

test('custom certificate: key mismatch, wrong host, expiry and CA-as-leaf are refused', () => {
  const pair = issue('good');
  const other = issue('other');
  assert.match(custom({ crt: pair.crt, key: other.key }).out, /private key does not match/);
  assert.match(custom(issue('wronghost', { san: 'DNS:other.example.test' }), ['--allow-untrusted-chain']).out, /does not cover ctrl\.example\.test/);
  assert.match(custom(issue('leafca', { ca: true }), ['--allow-untrusted-chain']).out, /is a CA, not a server leaf/);
  const expired = join(dir, 'expired.crt');
  const key = join(dir, 'expired.key');
  openssl('genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', key);
  openssl('req', '-x509', '-key', key, '-subj', '/CN=ctrl.example.test', '-addext', 'subjectAltName=DNS:ctrl.example.test', '-not_before', '20200101000000Z', '-not_after', '20200201000000Z', '-out', expired);
  assert.match(custom({ crt: expired, key }, ['--allow-untrusted-chain']).out, /has expired/);
});

test('custom certificate expiring soon produces a renewal risk', () => {
  const soon = issue('soon', { days: 10 });
  assert.match(custom(soon, ['--allow-untrusted-chain']).out, /expires within 30 days/);
});

// ---- nginx script contract: rendering of the site file, extracted without running as root.
function render(vars) {
  const source = readFileSync(nginx, 'utf8');
  const body = source.slice(source.indexOf('if [[ -n "$LISTEN" ]]; then LISTEN80'), source.indexOf('chmod 0640 "$SITE_TMP"'));
  const output = join(dir, `site-${Math.random().toString(36).slice(2)}.conf`);
  const script = `HOST=h.example UPSTREAM=127.0.0.1:3000 PROXY_SECRET=SECRET SERVER_CERT=/c SERVER_KEY=/k DEVICE_CERT=/d PUBLIC_CA=/ca LISTEN= TLS_CERT= HTTP_ENROLL=1 ${vars}\nSITE_TMP=${output}\n${body}`;
  assert.equal(spawnSync('bash', ['-c', script], { encoding: 'utf8' }).status, 0);
  return readFileSync(output, 'utf8');
}

test('nginx default rendering keeps the lab behaviour (HTTP enrollment, CA download, wildcard listeners)', () => {
  const site = render('');
  assert.match(site, /listen 80;\n  listen \[::\]:80;/);
  assert.match(site, /listen 443 ssl;/);
  assert.match(site, /location = \/fabric\/server-ca\.crt/);
  assert.match(site, /location = \/fabric\/edge\.sh/);
});

test('nginx production rendering binds one address, redirects HTTP and publishes no lab CA', () => {
  const site = render('LISTEN=10.0.0.5 TLS_CERT=/x HTTP_ENROLL=0');
  assert.match(site, /listen 10\.0\.0\.5:80;/);
  assert.match(site, /listen 10\.0\.0\.5:443 ssl;/);
  assert.match(site, /return 301 https:\/\/h\.example\$request_uri;/);
  assert.doesNotMatch(site, /server-ca\.crt|\/fabric\/edge\.sh|X-Forwarded-Proto http;/);
  // mTLS enforcement for agent paths must be identical in every mode.
  assert.match(site, /ssl_verify_client optional;/);
  assert.match(site, /if \(\$ssl_client_verify != SUCCESS\) \{ return 403; \}/);
});

test('nginx script clears a stale CA pin when a custom certificate is used', () => {
  const source = readFileSync(nginx, 'utf8');
  assert.match(source, /keys=set\(values\)\|\{"CONTROLLER_AGENT_CA_SHA256"\}/);
  assert.match(source, /if os\.environ\["SERVER_CA_SHA256"\]:/);
  assert.match(source, /restored/);
});

// ---- lab-only PostgreSQL helper. Dry-run in a copy without .env.local so "no database configured" is real.
import { cpSync, mkdirSync } from 'node:fs';
function runWithoutEnv(args) {
  const root = mkdtempSync(join(tmpdir(), 'no-env-'));
  mkdirSync(join(root, 'deploy/controller'), { recursive: true });
  mkdirSync(join(root, 'deploy/proxy'), { recursive: true });
  mkdirSync(join(root, 'sdwan-controller'), { recursive: true });
  cpSync(setup, join(root, 'deploy/controller/setup-controller.sh'));
  const result = spawnSync('bash', [join(root, 'deploy/controller/setup-controller.sh'), '--dry-run', '--non-interactive', '--port', '39999', '--address', '192.168.160.200', ...args], {
    encoding: 'utf8', env: { ...process.env, FABRIC_SETUP_IP_JSON: fixture, FABRIC_SETUP_DEFAULT_DEV: 'ens33' },
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

test('lab --setup-postgres plans Docker + a loopback-only PostgreSQL 17 container', () => {
  const result = runWithoutEnv(['--mode', 'lab', '--setup-postgres']);
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /install Docker if missing; PostgreSQL 17 container 'sdwan-postgres' on 127\.0\.0\.1:5432/);
});

test('PostgreSQL helper is lab only and never overrides an existing database', () => {
  assert.match(runWithoutEnv(['--mode', 'production', '--setup-postgres']).out, /lab only/);
  assert.match(runWithoutEnv(['--mode', 'lab', '--setup-postgres', '--database-url', 'postgresql://u:p@h/d']).out, /conflicts with an existing DATABASE_URL/);
  assert.match(runWithoutEnv(['--mode', 'lab']).out, /No database is configured/);
  assert.match(runWithoutEnv(['--mode', 'lab', '--no-setup-postgres']).out, /No database is configured/);
});

test('database fields build a redacted plan; the password never appears in output', () => {
  const pw = join(dir, 'dbpass');
  writeFileSync(pw, 'p@ss:w/rd#1', { mode: 0o600 });
  const ok = runWithoutEnv(['--mode', 'production', '--tls', 'private-ca', '--db-host', 'db.internal', '--db-user', 'sdwan_app', '--db-password-file', pw]);
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /PostgreSQL sdwan_app@db\.internal:5432\/sdwan_controller, TLS verify-full \(password not shown\)/);
  assert.doesNotMatch(ok.out, /p@ss|w\/rd/);
});

test('database risks: superuser in production, cleartext to a remote host, loose password file, bad input', () => {
  const pw = join(dir, 'dbpass2');
  writeFileSync(pw, 'secret', { mode: 0o644 });
  const risky = runWithoutEnv(['--mode', 'production', '--tls', 'private-ca', '--db-host', 'db.internal', '--db-user', 'postgres', '--db-password-file', pw, '--db-sslmode', 'disable']);
  assert.match(risky.out, /postgres superuser/);
  assert.match(risky.out, /not encrypted/);
  assert.match(risky.out, /readable by group\/others/);
  assert.match(runWithoutEnv(['--mode', 'lab', '--db-host', 'x', '--db-user', 'u; drop', '--db-password-file', pw]).out, /Invalid --db-user/);
  assert.match(runWithoutEnv(['--mode', 'lab', '--db-host', 'x', '--db-user', 'u']).out, /password is required/);
  assert.match(runWithoutEnv(['--mode', 'lab', '--db-host', '127.0.0.1', '--db-user', 'u', '--db-password-file', pw, '--db-sslmode', 'require']).out, /disable or verify-full/);
});
