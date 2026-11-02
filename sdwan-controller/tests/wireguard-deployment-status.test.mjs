import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';
const { deploymentStatus } = loader()('src/lib/fabric/wireguard-deployment-status.ts');
const now = Date.now();
const device = { online: true, revoked: false, revision: 2, receipt: 'received', observedRevision: 2,
  matchingChecksum: true, observationFresh: true, applyStatus: 'applied', tunnelCount: 1,
  handshakes: [{ name: 'pm123456789abc', lastHandshake: Math.floor(now / 1000) }] };
test('receipt/apply/freshness and handshake remain separate with actionable next steps', () => {
  assert.match(deploymentStatus(device, now).label, /recent handshake observed/);
  for (const [override, label] of [
    [{ online: false }, /Offline/], [{ receipt: 'rejected' }, /rejected/], [{ receipt: null }, /receipt/],
    [{ observedRevision: 1 }, /awaiting apply/], [{ matchingChecksum: false }, /awaiting apply/],
    [{ observationFresh: false }, /stale/], [{ applyStatus: 'disabled' }, /activation/],
    [{ applyStatus: 'failed' }, /failed/],
  ]) {
    const result = deploymentStatus({ ...device, ...override }, now);
    assert.match(result.label, label); assert.equal(result.applied, false); assert.ok(result.next.length > 30);
  }
  const missing = deploymentStatus({ ...device, handshakes: [{ name: 'pm123456789abc', lastHandshake: 0 }] }, now);
  assert.equal(missing.applied, true); assert.match(missing.label, /no recent handshake/);
  assert.equal(missing.ok, false);
  assert.match(deploymentStatus({ ...device, tunnelCount: 0, handshakes: [] }, now).label, /no active tunnels/);
});

test('ok is true only for an applied plan with nothing to act on', () => {
  assert.equal(deploymentStatus({ ...device, tunnelCount: 0, handshakes: [] }).ok, true);
  assert.equal(deploymentStatus({ ...device, applyStatus: 'disabled' }).ok, false);
});

test('sdwanIndicator reports integrated, pending and not configured', () => {
  const { sdwanIndicator } = loader()('src/lib/fabric/wireguard-deployment-status.ts');
  const node = { id: 'n', name: 'edge01', kind: 'branch', connectionStatus: 'management-connected', lastSeenAt: null,
    configRevision: 2, configStatus: 'received', sdwan: { ...device } };
  assert.equal(sdwanIndicator(node, now).label, 'SD-WAN integrated');
  assert.equal(sdwanIndicator({ ...node, sdwan: { ...device, handshakes: [{ name: 'x', lastHandshake: 0 }] } }, now).tone, 'warn');
  assert.equal(sdwanIndicator({ ...node, sdwan: null }, now).label, 'SD-WAN not configured');
  assert.equal(sdwanIndicator({ ...node, sdwan: { ...device, tunnelCount: 0, handshakes: [] } }, now).tone, 'muted');
});
