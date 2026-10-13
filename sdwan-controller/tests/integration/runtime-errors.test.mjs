import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';

assert.equal(process.env.FABRIC_TEST_ISOLATED, '1');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const load = loader({
  '@/lib/db': { getDatabase: () => pool },
  '@/lib/fabric/authorization': {
    currentActor: async () => ({ id: '1', email: 'operator@example.test', role: 'admin' }),
  },
});
const route = load('src/app/api/runtime-errors/route.ts');
const referenceId = '123e4567-e89b-42d3-a456-426614174000';

test.after(async () => {
  await pool.query('DELETE FROM runtime_errors WHERE reference_id=$1', [referenceId]);
  await pool.end();
});

test('same-origin browser reports are persisted with a usable reference and redacted details', async () => {
  const response = await route.POST(
    new Request('http://127.0.0.1:3107/api/runtime-errors', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3107', 'content-type': 'application/json' },
      body: JSON.stringify({
        referenceId,
        name: 'TypeError',
        message: 'password=private-value',
        stack: 'TypeError: password=private-value\n at /dashboard',
        routePath: '/dashboard',
      }),
    }),
  );
  assert.equal(response.status, 202);
  const row = (
    await pool.query('SELECT * FROM runtime_errors WHERE reference_id=$1', [referenceId])
  ).rows[0];
  assert.equal(row.source, 'browser.runtime');
  assert.equal(row.route_path, '/dashboard');
  assert.match(row.message, /password=\[REDACTED\]/);
  assert.equal(row.message.includes('private-value'), false);
  assert.equal(row.stack.includes('private-value'), false);
});

test('cross-origin browser reports are rejected', async () => {
  const response = await route.POST(
    new Request('http://127.0.0.1:3107/api/runtime-errors', {
      method: 'POST',
      headers: { origin: 'https://attacker.test', 'content-type': 'application/json' },
      body: JSON.stringify({ referenceId, name: 'TypeError', message: 'forged', routePath: '/' }),
    }),
  );
  assert.equal(response.status, 403);
});

test('anonymous browser reports are rejected', async () => {
  const anonymousRoute = loader({
    '@/lib/db': { getDatabase: () => pool },
    '@/lib/fabric/authorization': { currentActor: async () => null },
  })('src/app/api/runtime-errors/route.ts');
  const response = await anonymousRoute.POST(
    new Request('http://127.0.0.1:3107/api/runtime-errors', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3107', 'content-type': 'application/json' },
      body: JSON.stringify({ referenceId, name: 'Error', message: 'forged', routePath: '/' }),
    }),
  );
  assert.equal(response.status, 401);
});
