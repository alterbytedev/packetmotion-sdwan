import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';

assert.equal(process.env.FABRIC_TEST_ISOLATED, '1');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const load = loader({
  '../db': { getDatabase: () => pool },
  'next/headers': {},
  'next/navigation': {},
});
const inventory = load('src/lib/fabric/inventory.ts');
const drafts = load('src/lib/fabric/network-drafts.ts');
const commits = load('src/lib/fabric/network-commits.ts');
const state = load('src/lib/fabric/network-commit-state.ts');
const telemetry = load('src/lib/fabric/telemetry.ts');
const lan = load('src/lib/fabric/lan.ts');
const enrollment = load('src/lib/fabric/enrollment.ts');
const actor = (
  await pool.query('SELECT id::text,email,role FROM operators WHERE email=$1', [
    process.env.FABRIC_TEST_EMAIL,
  ])
).rows[0];
test.after(() => pool.end());
test('typed interface commits enforce authorization, confirmation, replay safety, reservations and retained failure state', async () => {
  await pool.query(
    `INSERT INTO routing_settings(singleton,protected_prefixes,version) VALUES(TRUE,ARRAY['192.168.160.0/24']::cidr[],1) ON CONFLICT(singleton) DO UPDATE SET protected_prefixes=excluded.protected_prefixes,version=routing_settings.version+1`,
  );
  const node = await inventory.createNode(actor, {
    name: 'Interface apply Hub',
    kind: 'hub',
    mode: 'gateway',
  });
  const other = await inventory.createNode(actor, {
    name: 'Interface apply scope',
    kind: 'branch',
    mode: 'gateway',
  });
  const sample = {
    eventId: randomUUID(),
    agentVersion: '0.4.0',
    os: 'linux',
    arch: 'amd64',
    uptimeSeconds: 10,
    interfaces: [{ name: 'ens36', up: false, mtu: 1500, addresses: [] }],
    interfaceApply: {
      nodeId: node.id,
      protocolVersion: 1,
      mode: 'dedicated-static',
      interfaces: ['ens36'],
      updatedAt: new Date().toISOString(),
    },
  };
  await telemetry.recordHeartbeat(node.id, sample);
  const entry = {
    interfaceName: 'ens36',
    vlanId: null,
    role: 'lan',
    mode: 'static',
    address: '10.92.100.1/24',
    gateway: null,
    advertisedPrefix: null,
    enabled: true,
    mtu: 1500,
  };
  const current = await drafts.readNetworkDraft(actor, node.id);
  await drafts.saveNetworkDraft(actor, node.id, {
    expectedVersion: 0,
    baseRevision: current.currentRevision,
    baseLanVersion: 0,
    interfaces: [entry],
    safeCommitSeconds: 60,
  });
  const input = {
    requestId: randomUUID(),
    expectedVersion: 1,
    interfaceName: 'ens36',
    kind: 'physical',
  };
  await assert.rejects(
    commits.applyNetworkDraft({ ...actor, role: 'viewer' }, node.id, input),
    /Administrator/,
  );
  const queued = await commits.applyNetworkDraft(actor, node.id, input);
  assert.equal(queued.commit.status, 'queued');
  assert.equal((await commits.applyNetworkDraft(actor, node.id, input)).commit.id, input.requestId);
  await assert.rejects(
    commits.applyNetworkDraft(actor, node.id, { ...input, requestId: randomUUID() }),
    /pending/,
  );
  const request = await state.pendingInterfaceRequest(node.id);
  assert.equal(request.commitId, input.requestId);
  assert.equal(
    request.checksum,
    createHash('sha256').update(JSON.stringify(request.payload)).digest('hex'),
  );
  assert.equal(
    (await pool.query('SELECT max(revision) AS r FROM desired_configs WHERE node_id=$1', [node.id]))
      .rows[0].r,
    1,
    'interface commands must not alter legacy config checksum/schema',
  );
  const nonce = 'a'.repeat(64);
  const deadline = new Date(Date.now() + 60000).toISOString();
  const report = {
    commitId: request.commitId,
    checksum: request.checksum,
    status: 'applying',
    reason: '',
    sequence: 1,
    nonce,
    deadline,
    updatedAt: new Date().toISOString(),
  };
  await assert.rejects(state.recordInterfaceResult(other.id, report), /does not match/);
  await state.recordInterfaceResult(node.id, report);
  await assert.rejects(
    state.confirmInterfaceCommit(node.id, {
      commitId: request.commitId,
      checksum: request.checksum,
      nonce,
    }),
    /expired/,
  );
  const awaiting = { ...report, status: 'awaiting_confirmation', sequence: 2 };
  await state.recordInterfaceResult(node.id, awaiting);
  await state.recordInterfaceResult(node.id, awaiting);
  await assert.rejects(
    state.recordInterfaceResult(node.id, { ...awaiting, reason: 'apply_failed' }),
    /sequence reused/,
  );
  await assert.rejects(
    state.confirmInterfaceCommit(node.id, {
      commitId: request.commitId,
      checksum: request.checksum,
      nonce: 'b'.repeat(64),
    }),
    /expired/,
  );
  assert.equal(
    (
      await state.confirmInterfaceCommit(node.id, {
        commitId: request.commitId,
        checksum: request.checksum,
        nonce,
      })
    ).nonce,
    nonce,
  );
  await state.recordInterfaceResult(node.id, { ...awaiting, status: 'applied', sequence: 3 });
  assert.equal(await state.pendingInterfaceRequest(node.id), null);
  await assert.rejects(
    enrollment.archiveDevice(actor, node.id),
    /Remove applied interface settings/,
  );
  assert.equal(
    (await pool.query('SELECT 1 FROM network_interface_applied WHERE node_id=$1', [node.id]))
      .rowCount,
    1,
  );
  await assert.rejects(
    inventory.createNode(actor, {
      name: 'Applied prefix conflict',
      kind: 'branch',
      mode: 'gateway',
      lanPrefix: '10.92.100.0/24',
    }),
    /applied or pending/,
  );
  await assert.rejects(
    lan.saveLan(actor, node.id, {
      interfaceName: 'ens36',
      address: '10.93.0.1/24',
      advertisedPrefix: '10.93.0.0/24',
      expectedVersion: 0,
    }),
    /owned by the interface/,
  );
  const vlan = { ...entry, vlanId: 100, address: '10.92.101.1/24' };
  await drafts.saveNetworkDraft(actor, node.id, {
    expectedVersion: 1,
    baseRevision: 1,
    baseLanVersion: 0,
    interfaces: [entry, vlan],
    safeCommitSeconds: 60,
  });
  const second = await commits.applyNetworkDraft(actor, node.id, {
    ...input,
    requestId: randomUUID(),
    expectedVersion: 2,
    kind: 'vlan',
  });
  const secondRequest = await state.pendingInterfaceRequest(node.id);
  assert.equal(
    secondRequest.payload.interfaces.length,
    1,
    'only the selected parent/kind is applied',
  );
  const failure = { ...report, commitId: second.commit.id, checksum: secondRequest.checksum };
  await state.recordInterfaceResult(node.id, failure);
  await state.recordInterfaceResult(node.id, {
    ...failure,
    status: 'rolled_back',
    reason: 'apply_failed',
    sequence: 2,
  });
  assert.equal(
    (await pool.query('SELECT 1 FROM network_interface_applied WHERE node_id=$1', [node.id]))
      .rowCount,
    1,
    'failed VLAN must preserve previous confirmed physical settings',
  );
  assert.equal((await state.readNetworkCommitHistory(node.id))[0].reason, 'apply_failed');
  const recovered = await inventory.createNode(actor, {
    name: 'Released rejected prefix',
    kind: 'branch',
    mode: 'gateway',
    lanPrefix: '10.92.101.0/24',
  });
  assert.ok(recovered.id);
  await pool.query(
    "UPDATE device_telemetry SET snapshot=jsonb_set(snapshot,'{interfaceApply,updatedAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE node_id=$1",
    [node.id],
  );
  await assert.rejects(
    commits.applyNetworkDraft(actor, node.id, {
      ...input,
      requestId: randomUUID(),
      expectedVersion: 2,
    }),
    /locally authorized/,
  );
});
test('heartbeat accepts bounded current addresses and rejects malformed or oversized IP telemetry', async () => {
  const node = await inventory.createNode(actor, {
    name: 'Current IP telemetry',
    kind: 'branch',
    mode: 'gateway',
  });
  const sample = {
    eventId: randomUUID(),
    agentVersion: '0.4.0',
    os: 'linux',
    arch: 'amd64',
    uptimeSeconds: 0,
    interfaces: [
      { name: 'ens33', up: true, mtu: 1500, addresses: ['192.168.160.142/24', 'fe80::1/64'] },
    ],
  };
  await telemetry.recordHeartbeat(node.id, sample);
  const result = await telemetry.readTelemetry(actor, node.id);
  assert.equal(result.telemetry.snapshot.interfaces[0].addresses[0], '192.168.160.142/24');
  for (const addresses of [
    ['bad'],
    ['192.0.2.1/24/'],
    ['192.0.2.1/33'],
    ['::1/129'],
    Array(17).fill('192.0.2.1/24'),
  ])
    await assert.rejects(
      telemetry.recordHeartbeat(node.id, {
        ...sample,
        eventId: randomUUID(),
        interfaces: [{ ...sample.interfaces[0], addresses }],
      }),
      /Invalid interface/,
    );
  await assert.rejects(
    telemetry.recordHeartbeat(node.id, {
      ...sample,
      eventId: randomUUID(),
      interfaces: Array.from({ length: 17 }, (_, i) => ({
        name: `eth${i}`,
        up: true,
        mtu: 1500,
        addresses: Array(16).fill('192.0.2.1/24'),
      })),
    }),
    /Invalid interface/,
  );
  await telemetry.recordHeartbeat(node.id, {
    ...sample,
    eventId: randomUUID(),
    interfaces: [{ name: 'old-agent', up: true, mtu: 1500 }],
  });
});
