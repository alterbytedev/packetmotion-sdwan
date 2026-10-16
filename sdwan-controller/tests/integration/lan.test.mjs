import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';
assert.equal(process.env.FABRIC_TEST_ISOLATED, '1');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const load = loader({ '../db': { getDatabase: () => pool }, 'next/headers': {}, 'next/navigation': {} });
const lan = load('src/lib/fabric/lan.ts');
const inventory = load('src/lib/fabric/inventory.ts');
const channel = load('src/lib/fabric/channel.ts');
const wg = load('src/lib/fabric/wireguard.ts');
const actor = (await pool.query('SELECT id::text,email,role FROM operators WHERE email=$1', [process.env.FABRIC_TEST_EMAIL])).rows[0];
test.after(() => pool.end());

test('LAN profiles protect reserved networks, preserve staged behavior and reject concurrent stale writes', async () => {
  await pool.query("UPDATE operators SET role='superadmin' WHERE id=$1", [actor.id]);
  const superadmin = { ...actor, role: 'superadmin' };
  try {
    const settings = await lan.readRoutingSettings(actor);
    await assert.rejects(lan.saveRoutingSettings(actor, { expectedVersion: settings.version, protectedPrefixes: ['192.168.160.0/24'] }), /Superadmin/);
    await lan.saveRoutingSettings(superadmin, { expectedVersion: settings.version, protectedPrefixes: ['192.168.160.0/24'] });
    const node = await inventory.createNode(actor, { name: 'LAN profile Edge', kind: 'branch', mode: 'gateway' });
    const input = { expectedVersion: 0, interfaceName: 'ens34', address: '10.71.0.1/24', advertisedPrefix: '10.71.0.0/24' };
    for (const mutation of [
      { interfaceName: 'lo' }, { interfaceName: 'pm515fd66de4e9' }, { address: '10.71.0.0/24' },
      { address: '10.71.0.255/24' }, { advertisedPrefix: '0.0.0.0/0' },
      { address: '192.168.160.1/24', advertisedPrefix: '192.168.160.0/24' },
    ]) await assert.rejects(lan.saveLan(actor, node.id, { ...input, ...mutation }));
    await assert.rejects(lan.saveLan({ ...actor, role: 'viewer' }, node.id, input), /Administrator/);
    const outcomes = await Promise.allSettled([lan.saveLan(actor, node.id, input), lan.saveLan(actor, node.id, input)]);
    assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
    const saved = await lan.readLan(actor, node.id);
    assert.equal(saved.interfaceName, 'ens34'); assert.equal(saved.address, input.address);
    assert.equal(saved.advertisedPrefix, input.advertisedPrefix); assert.equal(saved.sitePrefix, input.advertisedPrefix);
    assert.equal(saved.version, 1);
    assert.equal((await channel.desiredConfig(node.id)).revision, 1, 'profile save must not claim or trigger network apply');
    const second = await inventory.createNode(actor, { name: 'LAN conflict Edge', kind: 'branch', mode: 'gateway' });
    await assert.rejects(lan.saveLan(actor, second.id, input), /another site/);
    await assert.rejects(inventory.createNode(actor, { name: 'Protected LAN', kind: 'branch', mode: 'gateway', lanPrefix: '192.168.160.0/25' }), /protected/);
    const nextSettings = await lan.readRoutingSettings(actor);
    await assert.rejects(lan.saveRoutingSettings(superadmin, { expectedVersion: nextSettings.version, protectedPrefixes: ['10.71.0.0/24'] }), /existing site/);
    const tunnelSettings = await wg.readTunnelSettings(actor);
    await assert.rejects(wg.saveTunnelSettings(superadmin, { expectedVersion: tunnelSettings.version, pool: '192.168.160.0/24' }), /protected/);
    const audits = await pool.query("SELECT 1 FROM audit_events WHERE resource_id=$1 AND action='lan.updated'", [node.id]);
    assert.equal(audits.rowCount, 1);
  } finally { await pool.query("UPDATE operators SET role='admin' WHERE id=$1", [actor.id]); }
});
