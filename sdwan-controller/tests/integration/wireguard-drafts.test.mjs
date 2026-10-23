import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';
assert.equal(process.env.FABRIC_TEST_ISOLATED, '1');
assert.ok(new URL(process.env.DATABASE_URL).pathname.startsWith('/fabric_test_'));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const load = loader({ '../db': { getDatabase: () => pool }, 'next/headers': {}, 'next/navigation': {} });
const wg = load('src/lib/fabric/wireguard.ts');
const drafts = load('src/lib/fabric/wireguard-drafts.ts');
const inv = load('src/lib/fabric/inventory.ts');
const actor = (await pool.query('SELECT id::text,email,role FROM operators WHERE email=$1', [process.env.FABRIC_TEST_EMAIL])).rows[0];
const owned = [];
test.after(async () => { await pool.query('DELETE FROM wireguard_links WHERE edge_id=ANY($1::uuid[]) OR hub_id=ANY($1::uuid[])', [owned]); await pool.end(); });

test('drafts stay outside active topology; deployment is atomic, versioned, authorized and idempotent', async () => {
  const hub = await inv.createNode(actor, { name: 'Draft hub', kind: 'hub', mode: 'gateway' });
  const edge = await inv.createNode(actor, { name: 'Draft edge', kind: 'branch', mode: 'gateway' });
  owned.push(hub.id, edge.id);
  await pool.query("INSERT INTO wireguard_settings(singleton,pool,version) VALUES(TRUE,'10.248.0.0/24',1) ON CONFLICT(singleton) DO NOTHING");
  await wg.registerWireguardKey(edge.id, { publicKey: randomBytes(32).toString('base64') });
  const revision = async id => Number((await pool.query('SELECT max(revision) AS revision FROM desired_configs WHERE node_id=$1', [id])).rows[0].revision);
  const hubDraft = { expectedVersion: 0, expectedDraftVersion: 0, endpoint: '192.168.71.2', basePort: 25000 };
  await drafts.saveWireguardDraft(actor, hub.id, hubDraft);
  assert.equal((await wg.readWireguardDevice(actor, hub.id)).endpoint, null);
  assert.equal(await revision(hub.id), 1);
  await assert.rejects(drafts.saveWireguardDraft(actor, hub.id, hubDraft), error => error.status === 409);
  await drafts.deployWireguardDraft(actor, hub.id, { expectedVersion: 0, expectedDraftVersion: 1 });
  assert.equal(await revision(hub.id), 2);
  assert.equal((await drafts.deployWireguardDraft(actor, hub.id, { expectedVersion: 0, expectedDraftVersion: 1 })).deployed, false);
  assert.equal(await revision(hub.id), 2);
  await drafts.saveWireguardDraft(actor, edge.id, { expectedVersion: 0, expectedDraftVersion: 0, hubIds: [hub.id] });
  // Missing Hub key fails at deploy and rolls back all allocations/publications.
  await assert.rejects(drafts.deployWireguardDraft(actor, edge.id, { expectedVersion: 0, expectedDraftVersion: 1 }), /registered WireGuard key/);
  assert.equal(await revision(edge.id), 1);
  assert.equal((await pool.query('SELECT 1 FROM wireguard_links WHERE edge_id=$1', [edge.id])).rowCount, 0);
  assert.ok((await drafts.readWireguardDeployment(actor, edge.id)).draft.payload);
  await wg.registerWireguardKey(hub.id, { publicKey: randomBytes(32).toString('base64') });
  await pool.query("INSERT INTO wireguard_settings(singleton,pool,version) VALUES(TRUE,'10.248.0.0/24',1) ON CONFLICT(singleton) DO NOTHING");
  await assert.rejects(drafts.deployWireguardDraft({ ...actor, role: 'viewer' }, edge.id, { expectedVersion: 0, expectedDraftVersion: 1 }), /Administrator/);
  // Fail the final peer publication after topology allocation and the first
  // publication: the transaction must restore revisions, links and the draft.
  const lastPeer = [edge.id, hub.id].sort().at(-1);
  await pool.query(`CREATE FUNCTION draft_test_fail_publish() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.node_id=TG_ARGV[0]::uuid THEN RAISE EXCEPTION 'injected publication failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER draft_test_fail_publish BEFORE INSERT ON desired_configs FOR EACH ROW EXECUTE FUNCTION draft_test_fail_publish('${lastPeer}')`);
  try {
    await assert.rejects(drafts.deployWireguardDraft(actor, edge.id, { expectedVersion: 0, expectedDraftVersion: 1 }), /injected publication failure/);
    assert.equal(await revision(edge.id), 1); assert.equal(await revision(hub.id), 2);
    assert.equal((await pool.query('SELECT 1 FROM wireguard_links WHERE edge_id=$1', [edge.id])).rowCount, 0);
    assert.ok((await drafts.readWireguardDeployment(actor, edge.id)).draft.payload);
  } finally {
    await pool.query('DROP TRIGGER draft_test_fail_publish ON desired_configs');
    await pool.query('DROP FUNCTION draft_test_fail_publish()');
  }
  // A live demotion must deny a cached admin actor as well.
  await pool.query("UPDATE operators SET role='viewer' WHERE id=$1", [actor.id]);
  try { await assert.rejects(drafts.deployWireguardDraft(actor, edge.id, { expectedVersion: 0, expectedDraftVersion: 1 }), /Administrator/); }
  finally { await pool.query("UPDATE operators SET role='admin' WHERE id=$1", [actor.id]); }
  const deployments = await Promise.allSettled(Array.from({ length: 2 }, () => drafts.deployWireguardDraft(actor, edge.id, { expectedVersion: 0, expectedDraftVersion: 1 })));
  assert.equal(deployments.filter(result => result.status === 'fulfilled' && result.value.deployed).length, 1);
  assert.equal(await revision(edge.id), 2);
  assert.equal(await revision(hub.id), 3);
  assert.equal((await wg.readWireguardDevice(actor, edge.id)).links.length, 1);
  // Saving an identical selection does not enable Deploy or publish revisions.
  await drafts.saveWireguardDraft(actor, edge.id, { expectedVersion: 1, expectedDraftVersion: 2, hubIds: [hub.id.toUpperCase()] });
  assert.equal((await drafts.readWireguardDeployment(actor, edge.id)).draft.payload, null);
  assert.equal(await revision(edge.id), 2);
  await drafts.saveWireguardDraft(actor, edge.id, { expectedVersion: 1, expectedDraftVersion: 3, hubIds: [] });
  await drafts.deployWireguardDraft(actor, edge.id, { expectedVersion: 1, expectedDraftVersion: 4 });
  assert.equal((await wg.readWireguardDevice(actor, edge.id)).links.length, 0);
  const state = await drafts.readWireguardDeployment(actor, edge.id);
  assert.equal(state.devices.length, 2, 'removed Hub remains visible in the last deployment');
  assert.equal(state.devices.find(device => device.id === hub.id).tunnelCount, 0);
  // A legacy immediate mutation cannot silently deploy a stale draft.
  const h = await wg.readWireguardDevice(actor, hub.id);
  const d = await drafts.readWireguardDeployment(actor, hub.id);
  await drafts.saveWireguardDraft(actor, hub.id, { expectedVersion: h.version, expectedDraftVersion: d.draft.version, endpoint: '192.168.71.3', basePort: 25000 });
  await wg.saveWireguardDevice(actor, hub.id, { expectedVersion: h.version, endpoint: '192.168.71.4', basePort: 25000 });
  await assert.rejects(drafts.deployWireguardDraft(actor, hub.id, { expectedVersion: h.version, expectedDraftVersion: d.draft.version + 1 }), error => error.status === 409);
  await assert.rejects(drafts.saveWireguardDraft(actor, edge.id, { expectedVersion: 2, expectedDraftVersion: 5, hubIds: ['bad'] }), /distinct hubs/);
});
