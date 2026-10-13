import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import loader from './support/load-ts.cjs';
import session from './support/session.cjs';

test('forged, expired and malformed sessions never look up an operator; current credentials are checked', async (t) => {
  const original = process.env.CONTROLLER_SESSION_SECRET;
  process.env.CONTROLLER_SESSION_SECRET = 'test-session-secret-32-characters-minimum';
  t.after(() => { if (original === undefined) delete process.env.CONTROLLER_SESSION_SECRET; else process.env.CONTROLLER_SESSION_SECRET = original; });
  const secret = process.env.CONTROLLER_SESSION_SECRET;
  let token;
  let lookups = 0;
  const email = 'operator@example.test';
  let hash = 'stored-credential-hash';
  const load = loader({
    'next/headers': { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
    'next/navigation': {},
    './operators': { findOperator: async () => { lookups++; return { email, passwordHash: hash }; } },
    './session': session,
  });
  const { getUser } = load('src/lib/auth.ts');
  const signedBadClaims = Buffer.from(JSON.stringify({ email: 42, expires: Date.now() + 10000, credentialVersion: '' })).toString('base64url');
  for (token of ['bad.data', 'a.b.c', `${session.signSession(email, secret)}forged`, session.signSession(email, secret, Date.now() - session.SESSION_DURATION * 1000), `${signedBadClaims}.${createHmac('sha256', secret).update(signedBadClaims).digest('base64url')}`]) {
    assert.equal(await getUser(), null);
  }
  assert.equal(lookups, 0);
  token = session.signSession(email, secret, Date.now(), createHash('sha256').update(hash).digest('hex'));
  assert.equal(await getUser(), email);
  assert.equal(lookups, 1);
  hash = 'changed-credential-hash';
  assert.equal(await getUser(), null);
});
