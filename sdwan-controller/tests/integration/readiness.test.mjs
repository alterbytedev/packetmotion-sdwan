import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';

assert.equal(process.env.FABRIC_TEST_ISOLATED, '1');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const load = loader({ '@/lib/db': { getDatabase: () => pool } });
const readyRoute = load('src/app/api/ready/route.ts');

test.after(() => pool.end());

test('readiness confirms PostgreSQL and returns a safe correlation ID', async () => {
  const response = await readyRoute.GET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ready');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  assert.equal(body.requestId, undefined);
});

test('database failures expose a generic response without leaking the driver message', async () => {
  const secretError = new Error('password=do-not-expose');
  const failingLoad = loader({
    '@/lib/db': {
      getDatabase: () => ({
        query: async () => {
          throw secretError;
        },
      }),
    },
  });
  const failingRoute = failingLoad('src/app/api/ready/route.ts');
  const response = await failingRoute.GET();
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.status, 'not_ready');
  assert.equal(body.dependency, 'database');
  assert.equal(JSON.stringify(body).includes('do-not-expose'), false);
});
