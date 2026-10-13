import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_DURATION = 60 * 60 * 8;

export function signSession(
  email: string,
  secret: string,
  now = Date.now(),
  credentialVersion = '',
) {
  const payload = Buffer.from(
    JSON.stringify({ email, expires: now + SESSION_DURATION * 1000, credentialVersion }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function verifySession(
  token: string,
  secret: string,
  email: string,
  now = Date.now(),
  credentialVersion = '',
): string | null {
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const expected = createHmac('sha256', secret).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.email === email &&
      data.credentialVersion === credentialVersion &&
      typeof data.expires === 'number' && data.expires > now
      ? data.email
      : null;
  } catch {
    return null;
  }
}

/** Verify the signed claims before any database lookup. */
export function verifySessionClaims(token: string, secret: string, now = Date.now()): {
  email: string;
  credentialVersion: string;
} | null {
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const expected = createHmac('sha256', secret).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof data.email === 'string' && data.email.length > 0 &&
      typeof data.credentialVersion === 'string' &&
      typeof data.expires === 'number' && Number.isFinite(data.expires) && data.expires > now
      ? { email: data.email, credentialVersion: data.credentialVersion }
      : null;
  } catch {
    return null;
  }
}
