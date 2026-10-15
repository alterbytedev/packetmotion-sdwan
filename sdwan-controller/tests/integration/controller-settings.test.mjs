import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';

assert.equal(process.env.FABRIC_TEST_ISOLATED, '1', 'Use npm run test:integration');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const service = loader({
  '../db': { getDatabase: () => pool },
  './authorization': {
    FabricError: class FabricError extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    },
  },
})('src/lib/fabric/insecure-http-allowlist.ts');
const operator = (await pool.query(
  'SELECT id::text,email FROM operators WHERE email=$1',
  [process.env.FABRIC_TEST_EMAIL],
)).rows[0];
const actor = { ...operator, role: 'superadmin' };

test.after(async () => {
  try {
    await pool.query('DELETE FROM controller_insecure_http_hosts');
  } finally {
    await pool.end();
  }
});

test('controller HTTP allowlist replaces hosts transactionally and records an audit event', async () => {
  const saved = await service.replaceInsecureHttpHosts(actor, {
    hosts: ['192.168.160.200', '10.20.0.5'],
  });
  assert.deepEqual([...saved], ['10.20.0.5', '192.168.160.200']);
  assert.deepEqual([...(await service.getInsecureHttpHosts())], [...saved]);
  assert.equal(await service.isInsecureHttpHostAllowed('192.168.160.200'), true);
  assert.equal(await service.isInsecureHttpHostAllowed('192.168.160.201'), false);
  await assert.rejects(
    service.replaceInsecureHttpHosts(actor, { hosts: ['192.168.160.201', '8.8.8.8'] }),
    /private IPv4/,
  );
  assert.deepEqual([...(await service.getInsecureHttpHosts())], [...saved]);
  const audit = await pool.query(
    "SELECT count(*)::int AS count FROM audit_events WHERE actor_email=$1 AND action='controller.insecure_http_hosts_updated'",
    [actor.email],
  );
  assert.equal(audit.rows[0].count, 1);
});
