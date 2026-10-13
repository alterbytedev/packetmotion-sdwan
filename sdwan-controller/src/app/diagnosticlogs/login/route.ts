import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { sessionSecret } from '@/lib/auth';
import { authenticateDeveloper, developerSessionToken, DIAGNOSTIC_COOKIE } from '@/lib/diagnostic-auth';
import { clearLoginAttempts, consumeLoginAttempt } from '@/lib/login-rate-limit';
import { SESSION_DURATION } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectToLogin(request: Request, invalid = false) {
  const url = new URL('/diagnosticlogs', request.url);
  if (invalid) url.searchParams.set('error', 'invalid');
  const response = NextResponse.redirect(url, 303);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const expectedOrigin = process.env.CONTROLLER_PUBLIC_ORIGIN ||
    (process.env.NODE_ENV === 'production' ? null : `${url.protocol}//${request.headers.get('host') || url.host}`);
  if (
    !expectedOrigin || request.headers.get('origin') !== expectedOrigin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  if (!sessionSecret()) return redirectToLogin(request, true);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
    return NextResponse.json({ error: 'Use a form-encoded request.' }, { status: 415, headers: { 'Cache-Control': 'no-store' } });
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 4096) return NextResponse.json({ error: 'Request too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > 4096) return NextResponse.json({ error: 'Request too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  const username = (form.get('username') || '').trim().toLowerCase();
  const password = form.get('password') || '';
  if (username.length > 64 || password.length > 1024) return redirectToLogin(request, true);
  const attemptKey = createHash('sha256').update(`diagnostic:${username}`).digest('hex');
  if (!(await consumeLoginAttempt(attemptKey))) return redirectToLogin(request, true);
  const hash = await authenticateDeveloper(username, password);
  if (!hash) return redirectToLogin(request, true);
  await clearLoginAttempts(attemptKey);
  const response = NextResponse.redirect(new URL('/diagnosticlogs', request.url), 303);
  response.headers.set('Cache-Control', 'no-store');
  response.cookies.set(DIAGNOSTIC_COOKIE, developerSessionToken(hash), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_DURATION,
  });
  return response;
}
