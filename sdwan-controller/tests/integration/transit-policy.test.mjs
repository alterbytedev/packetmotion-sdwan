import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';
assert.equal(process.env.FABRIC_TEST_ISOLATED, '1');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const load = loader({ '../db': { getDatabase: () => pool }, 'next/headers': {}, 'next/navigation': {} });
const transit = load('src/lib/fabric/transit-policy.ts');
const wg = load('src/lib/fabric/wireguard.ts');
const inv = load('src/lib/fabric/inventory.ts');
const channel = load('src/lib/fabric/channel.ts');
const actor = (await pool.query('SELECT id::text,email,role FROM operators WHERE email=$1', [process.env.FABRIC_TEST_EMAIL])).rows[0];
const superadmin = { ...actor, role: 'superadmin' };
test.after(() => pool.end());

async function lanNode(name, kind, index) {
  const node = await inv.createNode(actor, { name, kind, mode: 'gateway' });
  await wg.registerWireguardKey(node.id, { publicKey: randomBytes(32).toString('base64') });
  const prefix = `10.${index}.0.0/24`;
  const site = await pool.query('SELECT site_id FROM nodes WHERE id=$1', [node.id]);
  await pool.query('UPDATE sites SET lan_prefix=$2 WHERE id=$1', [site.rows[0].site_id, prefix]);
  await pool.query('INSERT INTO lan_profiles(node_id,interface_name,address,advertised_prefix,version) VALUES($1,$2,$3,$4,1)',
    [node.id, `ens${index}`, `10.${index}.0.1/24`, prefix]);
  return { ...node, prefix };
}

test('transit policy drafts stay inert until deployed, then reach only nodes whose LANs they name', async () => {
  await pool.query("UPDATE operators SET role='superadmin' WHERE id=$1", [actor.id]);
  try {
    await pool.query(`INSERT INTO routing_settings(singleton,protected_prefixes,version) VALUES(TRUE,ARRAY['192.168.160.0/24'::cidr],1)
      ON CONFLICT(singleton) DO UPDATE SET protected_prefixes=excluded.protected_prefixes`);
    await pool.query("INSERT INTO wireguard_settings(singleton,pool,version) VALUES(TRUE,'10.248.0.0/24',1) ON CONFLICT(singleton) DO NOTHING");
    const hub = await lanNode('Transit Hub', 'hub', 80);
    await wg.saveWireguardDevice(actor, hub.id, { endpoint: '192.168.98.1', basePort: 23000, expectedVersion: 0 });
    const edges = [await lanNode('Transit Edge A', 'branch', 81), await lanNode('Transit Edge B', 'branch', 82)];
    for (const edge of edges) await wg.saveWireguardDevice(actor, edge.id, { hubIds: [hub.id], expectedVersion: 0 });
    const [a, b] = edges;
    const before = await channel.desiredConfig(a.id);
    assert.equal(before.payload.schemaVersion, 3);
    assert.equal(before.payload.wireguard.routing.transit, undefined);

    const policy = await transit.readTransitPolicy(actor);
    assert.equal(policy.rules.length, 0);
    assert.equal(policy.draftRules, null);
    for (const prefix of [a.prefix, b.prefix, hub.prefix]) assert.ok(policy.lanPrefixes.includes(prefix));
    const rules = [
      { source: a.prefix, destination: hub.prefix, protocol: 'any' },
      { source: hub.prefix, destination: a.prefix, protocol: 'any' },
      { source: a.prefix, destination: b.prefix, protocol: 'icmp' },
    ];
    await assert.rejects(transit.saveTransitDraft(actor, { expectedVersion: policy.version, rules }), /Superadmin/);
    await assert.rejects(transit.saveTransitDraft(superadmin, { expectedVersion: policy.version, rules: [{ ...rules[0], destination: '192.168.160.0/24' }] }), /saved device LAN/);
    await assert.rejects(transit.saveTransitDraft(superadmin, { expectedVersion: policy.version + 5, rules }), /changed/);
    const saved = await transit.saveTransitDraft(superadmin, { expectedVersion: policy.version, rules });
    assert.equal((await channel.desiredConfig(a.id)).revision, before.revision, 'a draft must not publish');

    await assert.rejects(transit.deployTransitDraft(actor, { expectedVersion: saved.version }), /Superadmin/);
    await assert.rejects(transit.deployTransitDraft(superadmin, { expectedVersion: saved.version - 1 }), /changed/);
    const deployed = await transit.deployTransitDraft(superadmin, { expectedVersion: saved.version });
    assert.equal(deployed.deployed, true);
    const retry = await transit.deployTransitDraft(superadmin, { expectedVersion: deployed.version });
    assert.equal(retry.deployed, false);

    const forA = await channel.desiredConfig(a.id);
    assert.equal(forA.payload.schemaVersion, 4);
    assert.equal(JSON.stringify(forA.payload.wireguard.routing.transit.map((rule) => [rule.source, rule.destination])), JSON.stringify([[a.prefix, hub.prefix], [hub.prefix, a.prefix]]),
      'an edge keeps only rules between its LAN and its linked hub');
    const forHub = await channel.desiredConfig(hub.id);
    assert.equal(forHub.payload.wireguard.routing.transit.length, 3, 'the hub also carries edge-to-edge rules');
    assert.equal(forHub.payload.wireguard.routing.transit[2].protocol, 'icmp');
    const forB = await channel.desiredConfig(b.id);
    assert.equal(forB.payload.wireguard.routing.transit, undefined, 'unrelated nodes keep their v3 payload');
    assert.equal(forB.payload.schemaVersion, 3);
    const audits = await pool.query("SELECT action FROM audit_events WHERE action LIKE 'transit.%' ORDER BY id");
    assert.equal(JSON.stringify(audits.rows.map((row) => row.action)), JSON.stringify(['transit.draft_saved', 'transit.deployed']));

    const cleared = await transit.saveTransitDraft(superadmin, { expectedVersion: deployed.version, rules: [] });
    await transit.deployTransitDraft(superadmin, { expectedVersion: cleared.version });
    const reverted = await channel.desiredConfig(a.id);
    assert.equal(reverted.payload.schemaVersion, 3);
    assert.equal(reverted.payload.wireguard.routing.transit, undefined);
  } finally {
    // Release tunnel reservations so later suites may reconfigure the pool.
    await pool.query("DELETE FROM wireguard_links WHERE hub_id IN (SELECT id FROM nodes WHERE name LIKE 'Transit %')");
    await pool.query("UPDATE operators SET role='admin' WHERE id=$1", [actor.id]);
  }
});
