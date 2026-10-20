import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';

assert.equal(process.env.FABRIC_TEST_ISOLATED, '1');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const load = loader({ '../db': { getDatabase: () => pool }, 'next/headers': {}, 'next/navigation': {} });
const inventory = load('src/lib/fabric/inventory.ts');
const diagnostics = load('src/lib/fabric/device-state.ts');
const operator = (await pool.query('SELECT id::text,email,role FROM operators WHERE email=$1', [process.env.FABRIC_TEST_EMAIL])).rows[0];
const superadmin = { ...operator, role: 'superadmin' };
test.after(() => pool.end());

const report = {
  stateDirectory: '/var/lib/packetmotion', revision: 3, wireguardEnabled: true,
  files: [{ name: 'Applied plan', path: '/var/lib/packetmotion/network-applied.json', present: true }],
  appliedPlan: { tunnels: [{ name: 'pm123456789abc', address: '10.250.0.1/31', peerAddress: '10.250.0.0',
    publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', endpoint: '192.0.2.1:22000', listenPort: 0,
    keepalive: 25, allowedPrefixes: [] }] },
  interfaces: [{ name: 'pm123456789abc', present: true, up: true, addresses: ['10.250.0.1/31'], lastHandshake: 0 }],
  unplannedOwnedInterfaces: [],
};

test('device state requests are superadmin-only, bounded, latest-only and expire', async () => {
  const node = await inventory.createNode(operator, { name: 'Diagnostic Edge', kind: 'branch', mode: 'gateway' });
  await assert.rejects(diagnostics.requestDeviceState(operator, node.id), /Superadmin/);
  await assert.rejects(diagnostics.readDeviceState(operator, node.id), /Superadmin/);

  const requested = await diagnostics.requestDeviceState(superadmin, node.id);
  assert.equal(requested.status, 'pending');
  assert.equal((await diagnostics.readPendingDeviceStateRequest(node.id)).requestId, requested.requestId);
  assert.deepEqual(await diagnostics.requestDeviceState(superadmin, node.id), requested);

  await diagnostics.recordDeviceState(node.id, {
    requestId: requested.requestId,
    status: 'completed',
    report: { ...report, privateKey: 'must-not-be-persisted', appliedPlan: { tunnels: report.appliedPlan.tunnels.map(tunnel => ({ ...tunnel, privateKey: 'must-not-be-persisted' })) } },
  });
  const completed = await diagnostics.readDeviceState(superadmin, node.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.report.stateDirectory, '/var/lib/packetmotion');
  assert.doesNotMatch(JSON.stringify(completed.report), /privateKey|must-not-be-persisted/);
  assert.equal((await diagnostics.recordDeviceState(node.id, { requestId: requested.requestId, status: 'unsupported', report: null })).recorded, true);
  await assert.rejects(diagnostics.recordDeviceState(node.id, { requestId: '00000000-0000-0000-0000-000000000000', status: 'unsupported', report: null }), /no longer active/);

  const latest = await diagnostics.requestDeviceState(superadmin, node.id);
  await pool.query("UPDATE device_state_reports SET requested_at=now()-interval '3 minutes' WHERE node_id=$1", [node.id]);
  const unavailable = await diagnostics.readDeviceState(superadmin, node.id);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.reason, 'timeout');
  assert.equal(unavailable.requestId, latest.requestId);
  await pool.query("UPDATE device_state_reports SET expires_at=now()-interval '1 second' WHERE node_id=$1", [node.id]);
  assert.equal((await diagnostics.readDeviceState(superadmin, node.id)).status, 'none');
});

test('device state reports reject oversized or malformed reports and accept unsupported outcomes', async () => {
  const node = await inventory.createNode(operator, { name: 'Diagnostic Hub', kind: 'hub', mode: 'gateway' });
  const requested = await diagnostics.requestDeviceState(superadmin, node.id);
  await assert.rejects(diagnostics.recordDeviceState(node.id, {
    requestId: requested.requestId, status: 'completed', report: { ...report, revision: -1 },
  }), /Invalid device state report/);
  const missingPrefixes = await diagnostics.requestDeviceState(superadmin, node.id);
  const oldGoShape = structuredClone(report);
  delete oldGoShape.appliedPlan.tunnels[0].allowedPrefixes;
  await diagnostics.recordDeviceState(node.id, { requestId: missingPrefixes.requestId, status: 'completed', report: oldGoShape });
  assert.deepEqual((await diagnostics.readDeviceState(superadmin, node.id)).report.appliedPlan.tunnels[0].allowedPrefixes, []);
  const goGeneratedWire = JSON.parse(await readFile(
    new URL('../../../sdwan-edge/internal/agent/testdata/device-state-empty-prefix.json', import.meta.url),
    'utf8',
  ));
  const serializedReport = await diagnostics.requestDeviceState(superadmin, node.id);
  await diagnostics.recordDeviceState(node.id, {
    ...goGeneratedWire,
    requestId: serializedReport.requestId,
  });
  assert.deepEqual(
    (await diagnostics.readDeviceState(superadmin, node.id)).report.appliedPlan.tunnels[0].allowedPrefixes,
    [],
  );
  const malformedPrefixes = await diagnostics.requestDeviceState(superadmin, node.id);
  const malformed = structuredClone(report);
  malformed.appliedPlan.tunnels[0].allowedPrefixes = null;
  await assert.rejects(diagnostics.recordDeviceState(node.id, {
    requestId: malformedPrefixes.requestId, status: 'completed', report: malformed,
  }), /Invalid device state report/);
  await diagnostics.recordDeviceState(node.id, { requestId: malformedPrefixes.requestId, status: 'unsupported', report: null });
  assert.equal((await diagnostics.readDeviceState(superadmin, node.id)).status, 'unsupported');

  const failedCollection = await diagnostics.requestDeviceState(superadmin, node.id);
  await diagnostics.recordDeviceState(node.id, { requestId: failedCollection.requestId, status: 'unavailable', report: null, reason: 'collection_failed' });
  assert.equal((await diagnostics.readDeviceState(superadmin, node.id)).reason, 'collection_failed');
  const invalidReason = await diagnostics.requestDeviceState(superadmin, node.id);
  await assert.rejects(diagnostics.recordDeviceState(node.id, {
    requestId: invalidReason.requestId, status: 'unavailable', report: null, reason: 'timeout',
  }), /Invalid device state response/);
});
