import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const nodeId = '12345678-1234-1234-1234-123456789abc';
for (const file of ['../sdwan-edge/install/edge.sh', 'public/fabric/edge.sh']) {
  test(`${file} requires an explicit reset for a different enrolled identity`, () => {
    const source = readFileSync(file, 'utf8');
    const guard = source.match(/check_existing_identity\(\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(guard);
    function run(expected, stdin) {
      return spawnSync('bash', ['-c', `${guard}\nRESET_REQUIRED=0\nfail() { printf '%s' "$1" >&2; exit 12; }\ncheck_existing_identity; printf "reset=%s" "$RESET_REQUIRED"`], {
        encoding: 'utf8', env: { ...process.env, IDENTITY_STATE: 'enrolled', IDENTITY_NODE_ID: nodeId, EXPECTED_NODE_ID: expected, TOKEN_STDIN: String(stdin) },
      });
    }
    const mismatch = run('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1);
    assert.equal(mismatch.status, 0);
    assert.match(mismatch.stdout, /explicit terminal reset confirmation/);
    assert.match(mismatch.stdout, /reset=1/);
    assert.match(mismatch.stdout, new RegExp(nodeId));
    assert.equal(run('', 1).status, 12);
    assert.equal(run(nodeId, 1).status, 0);
    assert.equal(run(nodeId.toUpperCase(), 1).status, 0);
    assert.equal(run('', 0).status, 0);
    assert.ok(source.indexOf('check_existing_identity\n') < source.indexOf('curl --fail'), 'guard must run before downloads and installation');
    assert.doesNotMatch(guard, /rm |mv |systemctl stop/);
  });
}

for (const file of ['../sdwan-edge/install/edge.sh', 'public/fabric/edge.sh']) {
  test(`${file} reports unexpected failures by stage without echoing commands or secrets`, () => {
    const prefix = readFileSync(file, 'utf8').split('while (($#)); do')[0];
    const result = spawnSync('bash', ['-c', `${prefix}\nprogress identity-check\nfalse`], {
      encoding: 'utf8', env: { ...process.env, FABRIC_ENROLLMENT_TOKEN: 'secret-token-sentinel' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stage=identity-check error=unexpected command failure/);
    assert.match(result.stderr, /journalctl -u fabric-agent/);
    assert.doesNotMatch(result.stdout + result.stderr, /secret-token-sentinel/);
  });
}
