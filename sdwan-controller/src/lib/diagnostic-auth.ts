import 'server-only';
import { cookies } from 'next/headers';
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDatabase } from '@/lib/db';
import { sessionSecret } from '@/lib/auth';
import { verifySessionClaims, signSession } from '@/lib/session';

export const DIAGNOSTIC_COOKIE = 'sdwan-diagnostic-session';

async function credentialHash() {
  const result = await getDatabase().query<{ password_hash: string }>(
    'SELECT password_hash FROM diagnostic_developer WHERE id = TRUE',
  );
  return result.rows[0]?.password_hash ?? null;
}

export async function authenticateDeveloper(username: string, password: string) {
  const hash = await credentialHash();
  const [salt, expected] = hash?.split(':') ?? ['', ''];
  const valid = /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash ?? '');
  const actual = scryptSync(password, valid ? salt : '0'.repeat(32), 64);
  return username === 'developer' && valid && timingSafeEqual(actual, Buffer.from(expected, 'hex'))
    ? hash
    : null;
}

export async function developerSession() {
  const secret = sessionSecret();
  const token = (await cookies()).get(DIAGNOSTIC_COOKIE)?.value;
  if (!secret || !token) return false;
  const claims = verifySessionClaims(token, secret);
  if (claims?.email !== 'developer') return false;
  const hash = await credentialHash();
  return Boolean(hash && claims.credentialVersion === createHash('sha256').update(hash).digest('hex'));
}

export function developerSessionToken(passwordHash: string) {
  const secret = sessionSecret();
  if (!secret) throw new Error('Controller session signing is not configured.');
  const credentialVersion = createHash('sha256').update(passwordHash).digest('hex');
  return signSession('developer', secret, Date.now(), credentialVersion);
}
