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
