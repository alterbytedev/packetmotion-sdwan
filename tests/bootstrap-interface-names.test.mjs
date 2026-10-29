import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = readFileSync(new URL('../sdwan-edge/sdwan-provisioning-scripts/packetmotion-fabric-bootstrap-v1.8.sh', import.meta.url), 'utf8');

test('bootstrap syntax is valid', () => {
  const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('bootstrap preserves selected interface names and does not stage boot renaming', () => {
  assert.match(script, /NETWORK_IFACE/);
  assert.match(script, /packetmotion-dhcp/);
  assert.doesNotMatch(script, /packetmotion-interface-names|MAC-sorted Ethernet|ip', 'link', 'set', 'dev'/);
  assert.doesNotMatch(script, /PM_INTERFACE_HELPER|eth\$\{?index\}?/);
});

test('bootstrap step total matches the number of steps', () => {
  const steps = script.match(/^step '/gm)?.length;
  assert.equal(Number(script.match(/TOTAL_STEPS=(\d+)/)?.[1]), steps);
});

test('bootstrap APT runs non-interactively and backups never overwrite the first copy', () => {
  assert.match(script, /--force-confold/);
  assert.match(script, /DPkg::Lock::Timeout/);
  assert.match(script, /cp -an /);
  assert.doesNotMatch(script, /cp -a [^\n]*\.bak\./);
});

test('bootstrap sets PATH for non-login su and resolves dhcpcd outside a subshell', () => {
  assert.match(script, /^export PATH=.*\/usr\/sbin/m);
  assert.doesNotMatch(script, /"\$\(command -v dhcpcd\)"/);
});

test('bootstrap asks for IP addressing and name server before SSH, hostname and APT', () => {
  const at = (needle) => script.indexOf(needle);
  assert.ok(at('\nnetwork_wizard\n') > 0);
  assert.ok(at('\nnetwork_wizard\n') < at("network_prompt 'SSH option"));
  assert.ok(at("network_prompt 'SSH option") < at('\nhostname_wizard\n'));
  assert.ok(at('\nhostname_wizard\n') < at("run 'APT index refresh"));
});

test('bootstrap DHCP offers a manual name server, a dhclient fallback and a static fallback', () => {
  assert.match(script, /4\) DNS /);
  assert.match(script, /dhclient -4 -1/);
  assert.match(script, /Configure a static IP instead/);
  assert.match(script, /static domain_name_servers=/);
  assert.match(script, /dns_resolves/);
});

test('bootstrap name server prompt defaults to 8.8.8.8 and 8.8.4.4', () => {
  assert.match(script, /'8\.8\.8\.8 8\.8\.4\.4'/);
  assert.match(script, /Name server option \(1-2\)' 2/);
});

test('DNS-only mode persists through a unit that never sets addresses or routes', () => {
  const unit = script.match(/<<'DNS_SERVICE'\n([\s\S]*?)\nDNS_SERVICE\n/)?.[1];
  const resolver = script.match(/print_resolver_commands\(\) \{\n([\s\S]*?)\n\}\n/)?.[1];
  assert.ok(unit, 'DNS-only unit heredoc not found');
  assert.ok(resolver, 'resolver helper not found');
  assert.match(unit, /ExecStart=\/usr\/local\/sbin\/packetmotion-dns/);
  assert.match(unit, /WantedBy=multi-user\.target/);
  assert.doesNotMatch(unit, /\bip\b/);
  assert.doesNotMatch(resolver, /\bip\b/);
  assert.match(script, /systemctl enable packetmotion-dns\.service/);
});

test('DHCP mode removes FRR static uplink settings before requesting a lease', () => {
  const at = (needle) => script.indexOf(needle);
  assert.match(script, /no ip address \$value/);
  assert.ok(at('clear_frr_uplink_static "$iface"') > 0);
  assert.ok(at('clear_frr_uplink_static "$iface"') < at('request_dhcp_lease "$iface"'));
});

test('DHCP lease success is judged by an uplink IPv4 address, not dhcpcd exit status alone', () => {
  const request = script.match(/request_dhcp_lease\(\) \{\n([\s\S]*?)\n\}\n/)?.[1];
  assert.ok(request, 'request_dhcp_lease not found');
  assert.match(request, /stop_dhcp_client "\$iface"\n\s+wait_for_dhcpcd_exit/);
  assert.match(request, /wait_for_uplink_ipv4 "\$iface"/);
});

test('DHCP retry keeps a healthy lease instead of releasing it first', () => {
  const request = script.match(/request_dhcp_lease\(\) \{\n([\s\S]*?)\n\}\n/)?.[1];
  assert.ok(request, 'request_dhcp_lease not found');
  assert.ok(request.indexOf('dhcpcd_running && ') < request.indexOf('stop_dhcp_client "$iface"'));
});

test('DHCP service starts only after every dhcpcd manager for the uplink has stopped', () => {
  const at = (needle) => script.indexOf(needle);
  assert.ok(at('stop_uplink_dhcp_clients "$NETWORK_IFACE"') > 0);
  assert.ok(at('stop_uplink_dhcp_clients "$NETWORK_IFACE"') < at('run \'Start uplink DHCP client\''));
  assert.match(script, /pgrep -f "\^dhcpcd: \$iface "/);
});
