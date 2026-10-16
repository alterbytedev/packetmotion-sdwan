import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';
assert.equal(process.env.FABRIC_TEST_ISOLATED, '1');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const load = loader({ '../db': { getDatabase: () => pool }, 'next/headers': {}, 'next/navigation': {} });
const wg = load('src/lib/fabric/wireguard.ts');
const inv = load('src/lib/fabric/inventory.ts');
const channel = load('src/lib/fabric/channel.ts');
const observed = load('src/lib/fabric/wireguard-observed.ts');
const enrollment = load('src/lib/fabric/enrollment.ts');
const actor = (await pool.query('SELECT id::text,email,role FROM operators WHERE email=$1', [process.env.FABRIC_TEST_EMAIL])).rows[0];
const superadmin = { ...actor, role: 'superadmin' };
test.after(() => pool.end());

test('tunnel allocation, publication, conflicts, removal and revocation are transactional', async () => {
  // The mutation service rechecks the current database role.
  await pool.query("UPDATE operators SET role='superadmin' WHERE id=$1", [actor.id]);
  try {
    const settings = await wg.readTunnelSettings(actor);
    await assert.rejects(wg.saveTunnelSettings(actor, { pool: '10.250.0.0/30', expectedVersion: settings.version }), /Superadmin/);
    await wg.saveTunnelSettings(superadmin, { pool: '10.250.0.0/30', expectedVersion: settings.version });
    await assert.rejects(inv.createNode(actor, { name: 'WG overlap', kind: 'branch', mode: 'gateway', lanPrefix: '10.250.0.0/25' }), /overlaps/);
    const hubs = [];
    for (let i = 0; i < 2; i++) {
      const hub = await inv.createNode(actor, { name: `WG Hub ${i}`, kind: 'hub', mode: 'gateway' });
      await wg.registerWireguardKey(hub.id, { publicKey: randomBytes(32).toString('base64') });
      await wg.saveWireguardDevice(actor, hub.id, { endpoint: `192.168.99.${i + 1}`, basePort: 22000, expectedVersion: 0 });
      hubs.push(hub);
    }
    await assert.rejects(wg.saveWireguardDevice(actor, hubs[1].id, {
      endpoint: '192.168.99.1', basePort: 22001, expectedVersion: 1,
    }), /port range overlaps/);
    const edge = await inv.createNode(actor, { name: 'WG Edge', kind: 'branch', mode: 'gateway' });
    await assert.rejects(wg.saveWireguardDevice(actor, edge.id, { hubIds: hubs.map(h => h.id), expectedVersion: 0 }), /register/);
    const key = randomBytes(32).toString('base64');
    await wg.registerWireguardKey(edge.id, { publicKey: key });
    await wg.registerWireguardKey(edge.id, { publicKey: key });
    await assert.rejects(wg.registerWireguardKey(edge.id, { publicKey: randomBytes(32).toString('base64') }), /replacement/);
    await assert.rejects(wg.saveWireguardDevice({ ...actor, role: 'viewer' }, edge.id, { hubIds: [], expectedVersion: 0 }), /Administrator/);
    const results = await Promise.allSettled([0, 1].map(() => wg.saveWireguardDevice(actor, edge.id, { hubIds: hubs.map(h => h.id), expectedVersion: 0 })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const selected = await wg.readWireguardDevice(actor, edge.id);
    assert.equal(selected.links.length, 2);
    assert.notEqual(selected.links[0].network, selected.links[1].network);
    const desired = await channel.desiredConfig(edge.id);
    assert.equal(desired.payload.schemaVersion, 2);
    assert.equal(desired.payload.wireguard.tunnels.length, 2);
    assert.equal(desired.payload.wireguard.tunnels[0].keepalive, 25);
    const status = { revision: desired.revision, checksum: desired.checksum, status: 'applied',
      handshakes: desired.payload.wireguard.tunnels.map(tunnel => ({ name: tunnel.name, lastHandshake: 0 })) };
    await observed.recordWireguardStatus(edge.id, status);
    assert.equal((await wg.readWireguardDevice(actor, edge.id)).observed.status, 'applied');
    await assert.rejects(observed.recordWireguardStatus(edge.id, { ...status, revision: desired.revision - 1 }), /current desired/);
    await assert.rejects(observed.recordWireguardStatus(edge.id, { ...status, handshakes: [] }), /current tunnel/);
    const extra = await inv.createNode(actor, { name: 'WG Exhaustion Edge', kind: 'branch', mode: 'gateway' });
    await wg.registerWireguardKey(extra.id, { publicKey: randomBytes(32).toString('base64') });
    await assert.rejects(wg.saveWireguardDevice(actor, extra.id, { expectedVersion: 0, hubIds: [hubs[0].id] }), /exhausted/);
    assert.equal((await wg.readWireguardDevice(actor, extra.id)).links.length, 0);
    const republished = await channel.publishConfig(actor, edge.id, { expectedRevision: desired.revision, pollIntervalSeconds: 45 });
    assert.equal(republished.payload.wireguard.tunnels.length, 2);
    await assert.rejects(wg.saveTunnelSettings(superadmin, { pool: '10.249.0.0/24', expectedVersion: settings.version + 1 }), /Reserved/);
    await wg.saveWireguardDevice(actor, edge.id, { hubIds: [], expectedVersion: selected.version });
    assert.equal((await channel.desiredConfig(edge.id)).payload.wireguard.tunnels.length, 0);
    await wg.saveWireguardDevice(actor, edge.id, { hubIds: hubs.map(h => h.id), expectedVersion: selected.version + 1 });
    assert.equal((await wg.readWireguardDevice(actor, edge.id)).links[0].network, selected.links[0].network);
    await enrollment.revokeDevice(actor, hubs[0].id);
    assert.equal((await channel.desiredConfig(edge.id)).payload.wireguard.tunnels.length, 1);
    const beforeArchive = await pool.query('SELECT id,network::text,hub_port,active FROM wireguard_links WHERE hub_id=$1 ORDER BY id', [hubs[1].id]);
    assert.equal(beforeArchive.rowCount, 1);
    await enrollment.archiveDevice(actor, hubs[1].id);
    await enrollment.archiveDevice(actor, hubs[1].id);
    assert.equal((await channel.desiredConfig(edge.id)).payload.wireguard.tunnels.length, 0);
    assert.deepEqual(
      (await pool.query('SELECT id,network::text,hub_port,active FROM wireguard_links WHERE hub_id=$1 ORDER BY id', [hubs[1].id])).rows,
      beforeArchive.rows.map(row => ({ ...row, active: false })),
    );
    assert.equal((await pool.query('SELECT revoked_at FROM enrollment_tokens WHERE node_id=$1', [hubs[1].id])).rows[0].revoked_at === null, false);
    assert.equal((await pool.query("SELECT action FROM audit_events WHERE resource_id=$1 AND action='device.archived'", [hubs[1].id])).rowCount, 1);
    assert.equal((await inv.listDevices(actor, new URLSearchParams({ search: 'WG Hub 1' }))).total, 0);
    await assert.rejects(inv.getDevice(actor, hubs[1].id), error => error.status === 404);
    await assert.rejects(enrollment.archiveDevice({ ...actor, role: 'viewer' }, edge.id), /Administrator/);
  } finally {
    await pool.query("UPDATE operators SET role='admin' WHERE id=$1", [actor.id]);
  }
});
