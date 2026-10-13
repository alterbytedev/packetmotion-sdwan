import 'server-only';
import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { verifySessionClaims } from './session';
import { findOperator } from './operators';

export const SESSION_COOKIE = 'sdwan-session';

export function sessionSecret() {
  const secret = process.env.CONTROLLER_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export async function getUser() {
  const secret = sessionSecret();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!secret || !token) return null;
  const claims = verifySessionClaims(token, secret);
  if (!claims) return null;
  const operator = await findOperator(claims.email);
  if (!operator) return null;
  const credentialVersion = createHash('sha256').update(operator.passwordHash).digest('hex');
  return claims.credentialVersion === credentialVersion ? claims.email : null;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}
