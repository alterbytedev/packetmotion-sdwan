import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';

assert.equal(process.env.FABRIC_TEST_ISOLATED, '1', 'Use npm run test:integration');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const route = loader({
  '@/lib/db': { getDatabase: () => pool },
  '@/lib/auth': { sessionSecret: () => process.env.CONTROLLER_SESSION_SECRET },
  'next/headers': { cookies: async () => ({ get: () => null }) },
})('src/app/diagnosticlogs/login/route.ts');
const logoutRoute = loader()('src/app/diagnosticlogs/logout/route.ts');
const baseUrl = 'http://127.0.0.1:3107/diagnosticlogs/login';

test.after(() => pool.end());

test('developer login issues an isolated cookie and correct password, while invalid and cross-origin attempts fail', async () => {
  const form = new URLSearchParams({ username: 'developer', password: process.env.FABRIC_TEST_DEVELOPER_PASSWORD });
  const response = await route.POST(new Request(baseUrl, {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:3107', 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  }));
  assert.equal(response.status, 303);
  assert.match(response.headers.get('set-cookie') || '', /^sdwan-diagnostic-session=/);
  assert.match(response.headers.get('location') || '', /\/diagnosticlogs$/);

  const invalid = await route.POST(new Request(baseUrl, {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:3107', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'developer', password: 'wrong' }),
  }));
  assert.equal(invalid.status, 303);
  assert.match(invalid.headers.get('location') || '', /error=invalid/);
  assert.equal(invalid.headers.get('set-cookie'), null);

  const crossOrigin = await route.POST(new Request(baseUrl, {
    method: 'POST', headers: { origin: 'https://attacker.test', 'content-type': 'application/x-www-form-urlencoded' }, body: form,
  }));
  assert.equal(crossOrigin.status, 403);

  const logout = await logoutRoute.POST(new Request('http://127.0.0.1:3107/diagnosticlogs/logout', {
    method: 'POST', headers: { origin: 'http://127.0.0.1:3107' },
  }));
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie') || '', /^sdwan-diagnostic-session=;/);
});

test('developer credentials cannot be used as operator dashboard authentication', async () => {
  const operator = loader({
    '@/lib/db': { getDatabase: () => pool },
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'invalid' }) }) },
  })('src/lib/auth.ts');
  assert.equal(await operator.getUser(), null);
});

test('rotating the developer password invalidates already signed diagnostic sessions', async () => {
  let token = '';
  const auth = loader({
    '@/lib/db': { getDatabase: () => pool },
    '@/lib/auth': { sessionSecret: () => process.env.CONTROLLER_SESSION_SECRET },
    'next/headers': { cookies: async () => ({ get: () => ({ value: token }) }) },
  })('src/lib/diagnostic-auth.ts');
  const original = (await pool.query('SELECT password_hash FROM diagnostic_developer WHERE id=TRUE')).rows[0].password_hash;
  token = auth.developerSessionToken(original);
  assert.equal(await auth.developerSession(), true);
  const salt = 'a'.repeat(32);
  await pool.query('UPDATE diagnostic_developer SET password_hash=$1 WHERE id=TRUE', [
    `${salt}:${'b'.repeat(128)}`,
  ]);
  assert.equal(await auth.developerSession(), false);
});
