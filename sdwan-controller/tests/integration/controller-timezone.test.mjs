import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';

assert.equal(process.env.FABRIC_TEST_ISOLATED, '1', 'Use npm run test:integration');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
class FabricError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const service = loader({
  '../db': { getDatabase: () => pool },
  './authorization': {
    FabricError,
    authorize(actor) { if (!actor) throw new FabricError(401, 'Sign in'); },
    authorizeSuperadmin(actor) { if (!actor) throw new FabricError(401, 'Sign in'); if (actor.role !== 'superadmin') throw new FabricError(403, 'Superadmin access required.'); },
  },
  './inventory': {
    mutate: async (actor, operation) => {
      if (actor.role !== 'superadmin') throw new FabricError(403, 'Superadmin access required.');
      return operation({ query: pool.query.bind(pool) }, actor);
    },
  },
})('src/lib/fabric/controller-timezone.ts');
const operator = (await pool.query('SELECT id::text,email FROM operators WHERE email=$1', [process.env.FABRIC_TEST_EMAIL])).rows[0];
const superadmin = { ...operator, role: 'superadmin' };
const admin = { ...operator, role: 'admin' };

test.after(async () => {
  await pool.query("UPDATE controller_timezone SET time_zone='UTC',version=version+1 WHERE singleton=TRUE");
  await pool.end();
});

test('controller time zone is globally stored, validated, versioned and superadmin-only to change', async () => {
  const initial = await service.readControllerTimeZone(admin);
  assert.equal(initial.timeZone, 'UTC');
  assert.equal(await service.getControllerTimeZone(), 'UTC');
  await assert.rejects(service.saveControllerTimeZone(admin, { timeZone: 'America/Los_Angeles', expectedVersion: initial.version }), /Superadmin/);
  await assert.rejects(service.saveControllerTimeZone(superadmin, { timeZone: 'Invalid/Zone', expectedVersion: initial.version }), /valid IANA time zone/);
  const saved = await service.saveControllerTimeZone(superadmin, { timeZone: 'America/Los_Angeles', expectedVersion: initial.version });
  assert.equal(saved.timeZone, 'America/Los_Angeles');
  assert.equal(await service.getControllerTimeZone(), 'America/Los_Angeles');
  await assert.rejects(service.saveControllerTimeZone(superadmin, { timeZone: 'UTC', expectedVersion: initial.version }), /changed; reload/);
  const audit = await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='controller.timezone_updated'");
  assert.equal(audit.rows[0].count, 1);
});
