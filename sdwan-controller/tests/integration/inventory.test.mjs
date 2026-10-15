import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';
import { migrateController } from '../../scripts/lib/migrations.mjs';

assert.equal(process.env.FABRIC_TEST_ISOLATED, '1', 'Use npm run test:integration');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
const load = loader({
  '../db': { getDatabase: () => pool },
  'next/headers': {},
  'next/navigation': {},
});
const inventory = load('src/lib/fabric/inventory.ts');
let brandingActor = null;
const branding = loader({
  './db': { getDatabase: () => pool },
  './fabric/authorization': {
    currentActor: async () => brandingActor,
    authorizeSuperadmin(actor) {
      if (!actor) throw new Error('Sign in');
      if (actor.role !== 'superadmin') throw new Error('Superadmin access required.');
    },
    FabricError: class FabricError extends Error {},
  },
})('src/lib/branding.ts');
const operator = await pool.query('SELECT id::text, email, role FROM operators WHERE email = $1', [
  process.env.FABRIC_TEST_EMAIL,
]);
const admin = operator.rows[0];

test.after(() => pool.end());

test('migration is repeatable, preserves credentials and detects modified applied migrations', async () => {
  const before = await pool.query('SELECT id,email,password_hash,role FROM operators ORDER BY id');
  await Promise.all([migrateController(pool), migrateController(pool)]);
  assert.deepEqual(
    (await pool.query('SELECT id,email,password_hash,role FROM operators ORDER BY id')).rows,
    before.rows,
  );
  const migrations = await pool.query('SELECT * FROM controller_migrations ORDER BY name');
  assert.equal(migrations.rowCount, 7);
  const original = migrations.rows[0].checksum;
  await pool.query(
    "UPDATE controller_migrations SET checksum = 'tampered' WHERE name = '0001_inventory_roles_audit.sql'",
  );
  try {
    await assert.rejects(migrateController(pool), /Applied migration changed/);
  } finally {
    await pool.query(
      "UPDATE controller_migrations SET checksum = $1 WHERE name = '0001_inventory_roles_audit.sql'",
      [original],
    );
  }
});

test('branding logo persists and only a superadmin can save or remove it', async () => {
  brandingActor = { ...admin, role: 'superadmin' };
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  await branding.saveLogo(admin.id, 'image/png', png);
  const stored = await branding.getLogo();
  assert.equal(stored.logo_mime, 'image/png');
  assert.deepEqual(stored.logo_data, png);
  brandingActor = { ...brandingActor, role: 'admin' };
  await assert.rejects(branding.saveLogo(admin.id, 'image/png', png), /Superadmin/);
  await assert.rejects(branding.removeLogo(), /Superadmin/);
  assert.deepEqual((await branding.getLogo()).logo_data, png);
  brandingActor = { ...brandingActor, role: 'superadmin' };
  await branding.removeLogo();
  assert.equal(await branding.getLogo(), null);
});

test('inventory persists, is audited and is readable by viewer; viewer or missing site mutations fail', async () => {
  const site = await inventory.createSite(admin, {
    name: 'Test Branch',
    mode: 'gateway',
    lanPrefix: '10.61.0.0/24',
  });
  const node = await inventory.createNode(admin, {
    name: 'Branch appliance',
    siteId: site.id,
    kind: 'branch',
  });
  const state = await inventory.listInventory({ ...admin, role: 'viewer' });
  assert.ok(state.nodes.some((record) => record.id === node.id && record.siteName === site.name));
  assert.equal(
    (
      await pool.query('SELECT action FROM audit_events WHERE resource_id IN ($1,$2)', [
        site.id,
        node.id,
      ])
    ).rowCount,
    4,
  );
  const persistedBefore = (await pool.query('SELECT id,name FROM sites ORDER BY id')).rows;
  await migrateController(pool);
  assert.deepEqual(
    (await pool.query('SELECT id,name FROM sites ORDER BY id')).rows,
    persistedBefore,
  );
  assert.equal((await pool.query('SELECT id FROM nodes WHERE id = $1', [node.id])).rowCount, 1);
  assert.equal(
    (
      await pool.query('SELECT id FROM audit_events WHERE resource_id IN ($1,$2)', [
        site.id,
        node.id,
      ])
    ).rowCount,
    4,
  );
  await assert.rejects(
    inventory.createNode(admin, { name: node.name, siteId: site.id, kind: 'branch' }),
    /already exists/,
  );

  await assert.rejects(
    inventory.createSite({ ...admin, role: 'viewer' }, { name: 'Denied', mode: 'gateway' }),
    /Administrator/,
  );
  await assert.rejects(inventory.listInventory(null), /Sign in/);
  await assert.rejects(
    inventory.createNode(admin, { name: 'Invalid', siteId: randomUUID(), kind: 'hub' }),
    /does not exist/,
  );
  await assert.rejects(
    inventory.createSite(admin, { name: 'Overlap', mode: 'gateway', lanPrefix: '10.61.0.128/25' }),
    /overlaps/,
  );
  await assert.rejects(
    inventory.createSite(admin, { name: 'test branch', mode: 'gateway' }),
    /already exists/,
  );
});

test('concurrent overlapping site creation has one winner across transactions', async () => {
  const results = await Promise.allSettled([
    inventory.createSite(admin, {
      name: 'Concurrent A',
      mode: 'gateway',
      lanPrefix: '10.62.0.0/24',
    }),
    inventory.createSite(admin, {
      name: 'Concurrent B',
      mode: 'subnet-router',
      lanPrefix: '10.62.0.128/25',
    }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter(
      (result) => result.status === 'rejected' && /overlaps/.test(result.reason.message),
    ).length,
    1,
  );
});

test('audit failure rolls back creation and current database role overrides stale admin claims', async () => {
  await pool.query(`CREATE FUNCTION fail_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$;
    CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_test_audit()`);
  try {
    await assert.rejects(
      inventory.createSite(admin, { name: 'Must roll back', mode: 'gateway' }),
      /test audit failure/,
    );
    assert.equal(
      (await pool.query("SELECT id FROM sites WHERE name = 'Must roll back'")).rowCount,
      0,
    );
  } finally {
    await pool.query('DROP TRIGGER fail_audit ON audit_events; DROP FUNCTION fail_test_audit()');
  }
  await pool.query("UPDATE operators SET role = 'viewer' WHERE id = $1", [admin.id]);
  try {
    await assert.rejects(
      inventory.createSite(admin, { name: 'Stale role', mode: 'gateway' }),
      /Administrator/,
    );
  } finally {
    await pool.query("UPDATE operators SET role = 'admin' WHERE id = $1", [admin.id]);
  }
});

test('one-step device creation is atomic, rejects overlap, and leaves no network record on audit failure', async () => {
  const node = await inventory.createNode(admin, {
    name: 'Single-step edge',
    kind: 'branch',
    mode: 'gateway',
    lanPrefix: '10.80.0.0/24',
  });
  assert.equal(node.siteName, 'Single-step edge');
  assert.equal(
    (
      await pool.query('SELECT id FROM audit_events WHERE resource_id IN ($1,$2)', [
        node.id,
        node.siteId,
      ])
    ).rowCount,
    4,
  );
  await assert.rejects(
    inventory.createNode(admin, {
      name: 'Single-step overlap',
      kind: 'hub',
      mode: 'gateway',
      lanPrefix: '10.80.0.128/25',
    }),
    /overlaps/,
  );
  assert.equal(
    (await pool.query("SELECT id FROM sites WHERE name = 'Single-step overlap'")).rowCount,
    0,
  );
  await pool.query(`CREATE FUNCTION fail_node_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'node.created' THEN RAISE EXCEPTION 'test node audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_node_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_node_audit()`);
  try {
    await assert.rejects(
      inventory.createNode(admin, {
        name: 'Atomic rollback edge',
        kind: 'branch',
        mode: 'gateway',
      }),
      /test node audit failure/,
    );
    assert.equal(
      (await pool.query("SELECT id FROM sites WHERE name = 'Atomic rollback edge'")).rowCount,
      0,
    );
    assert.equal(
      (await pool.query("SELECT id FROM nodes WHERE name = 'Atomic rollback edge'")).rowCount,
      0,
    );
  } finally {
    await pool.query(
      'DROP TRIGGER fail_node_audit ON audit_events; DROP FUNCTION fail_node_audit()',
    );
  }
});

test('device pagination is bounded, deterministic, searchable and validated', async () => {
  const group = await inventory.createSite(admin, { name: 'Pagination network', mode: 'gateway' });
  await pool.query(
    "INSERT INTO nodes(id,site_id,name,kind) SELECT gen_random_uuid(),$1,'Pagination ' || lpad(i::text,3,'0'),'branch' FROM generate_series(1,31) i",
    [group.id],
  );
  const params = new URLSearchParams({ search: 'Pagination' });
  const first = await inventory.listDevices(admin, params);
  assert.equal(first.total, 31);
  assert.equal(first.nodes.length, 25);
  const second = await inventory.listDevices(
    admin,
    new URLSearchParams({ search: 'Pagination', page: '2' }),
  );
  assert.equal(second.nodes.length, 6);
  assert.equal(new Set([...first.nodes, ...second.nodes].map((row) => row.id)).size, 31);
  assert.equal(
    (await inventory.listDevices(admin, new URLSearchParams({ search: 'pagination 031' }))).total,
    1,
  );
  assert.equal(
    (await inventory.listDevices(admin, new URLSearchParams({ search: 'Pagination%', page: '3' })))
      .total,
    0,
  );
  assert.equal(
    (await inventory.listDevices(admin, new URLSearchParams({ search: 'Pagination', page: '99' })))
      .page,
    2,
  );
  for (const query of [
    'page=0',
    'page=-1',
    'page=1.5',
    'page=Infinity',
    'pageSize=1000',
    'pageSize=foo',
    `search=${'x'.repeat(101)}`,
  ]) {
    await assert.rejects(
      inventory.listDevices(admin, new URLSearchParams(query)),
      (error) => error.status === 400,
    );
  }
  await assert.rejects(inventory.listDevices(null), (error) => error.status === 401);
  assert.equal((await inventory.listDevices({ ...admin, role: 'viewer' }, params)).total, 31);
  const detail = await inventory.getDevice(admin, second.nodes[5].id);
  assert.equal(detail.name, 'Pagination 031');
  await assert.rejects(inventory.getDevice(admin, 'bad'), (error) => error.status === 404);
  await assert.rejects(inventory.getDevice(admin, randomUUID()), (error) => error.status === 404);
  const summary = await inventory.dashboardInventory(admin);
  assert.ok(summary.total >= 31);
  assert.ok(summary.nodes.length <= 25);
});
