import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';

assert.equal(process.env.FABRIC_TEST_ISOLATED, '1');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const load = loader({ '../db': { getDatabase: () => pool }, 'next/headers': {}, 'next/navigation': {} });
const inventory = load('src/lib/fabric/inventory.ts');
const channel = load('src/lib/fabric/channel.ts');
const history = load('src/lib/fabric/command-history.ts');
const actor = (await pool.query('SELECT id::text,email,role FROM operators WHERE email=$1', [process.env.FABRIC_TEST_EMAIL])).rows[0];
const superadmin = { ...actor, role: 'superadmin' };
test.after(() => pool.end());

test('command history records lifecycle and denies non-superadmin reads', async () => {
  const node = await inventory.createNode(actor, { name: 'History Edge', kind: 'branch', mode: 'gateway' });
  const first = await channel.desiredConfig(node.id);
  await history.recordConfigDelivery(node.id, first.revision);
  await channel.acknowledgeConfig(node.id, { revision: first.revision, checksum: first.checksum, status: 'received' });
  const next = await channel.publishConfig(actor, node.id, { expectedRevision: first.revision, pollIntervalSeconds: 45 });
  await channel.acknowledgeConfig(node.id, { revision: next.revision, checksum: next.checksum, status: 'rejected' });

  const all = await history.listCommandHistory(superadmin, node.id, new URLSearchParams({ pageSize: '10' }));
  assert.equal(all.total, 5);
  assert.deepEqual(all.entries.map((entry) => entry.event), ['rejected', 'published', 'received', 'delivered', 'published']);
  assert.equal(all.entries[0].attempt, 1);
  assert.equal(all.entries.at(-1).actorEmail, actor.email);
  assert.equal((await history.readCommandConfig(superadmin, node.id, all.entries.at(-1).operationId)).rawConfig,
    JSON.stringify(first.payload));
  const rejected = await history.listCommandHistory(superadmin, node.id, new URLSearchParams({ status: 'rejected' }));
  assert.equal(rejected.total, 1);
  assert.equal(rejected.entries[0].revision, next.revision);
  await assert.rejects(history.listCommandHistory(actor, node.id, new URLSearchParams()), /Superadmin/);
  await assert.rejects(history.readCommandConfig(actor, node.id, all.entries.at(-1).operationId), /Superadmin/);
  await assert.rejects(history.listCommandHistory(superadmin, node.id, new URLSearchParams({ page: '0' })), /Invalid command history/);
});
