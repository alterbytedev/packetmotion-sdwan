import assert from 'node:assert/strict';
import test from 'node:test';
import sessionModule from './support/session.cjs';
const { signSession, verifySession, verifySessionClaims, SESSION_DURATION } = sessionModule;

const secret = 'test-secret-that-is-at-least-32-characters';
const email = 'operator@example.com';
const now = 1_000_000;

test('valid operator session is accepted', () => {
  const version = 'credential-version';
  assert.equal(verifySession(signSession(email, secret, now, version), secret, email, now, version), email);
});
test('expired session is rejected at the expiry boundary', () => {
  assert.equal(
    verifySession(signSession(email, secret, now), secret, email, now + SESSION_DURATION * 1000),
    null,
  );
});
test('tampered payload and signature are rejected', () => {
  const token = signSession(email, secret, now);
  const [payload, signature] = token.split('.');
  assert.equal(verifySession(`${payload}a.${signature}`, secret, email, now), null);
  assert.equal(verifySession(`${payload}.aaaa`, secret, email, now), null);
});
test('wrong signing key or changed operator invalidates a session', () => {
  const token = signSession(email, secret, now);
  assert.equal(verifySession(token, 'another-secret', email, now), null);
  assert.equal(verifySession(token, secret, 'other@example.com', now), null);
});
test('changed password invalidates an existing session', () => {
  const token = signSession(email, secret, now, 'old-password-hash');
  assert.equal(verifySession(token, secret, email, now, 'new-password-hash'), null);
});
test('malformed tokens fail closed', () => {
  for (const token of ['', '.', 'bad.data', 'a.b.c', '%%%']) {
    assert.equal(verifySession(token, secret, email, now), null);
  }
});
test('signed claims are verified before database lookup', () => {
  const token = signSession(email, secret, now, 'credential-version');
  assert.deepEqual(verifySessionClaims(token, secret, now), {
    email,
    credentialVersion: 'credential-version',
  });
  assert.equal(verifySessionClaims(`${token}forged`, secret, now), null);
  assert.equal(verifySessionClaims(token, secret, now + SESSION_DURATION * 1000), null);
  assert.equal(verifySessionClaims('not-a-session', secret, now), null);
});
