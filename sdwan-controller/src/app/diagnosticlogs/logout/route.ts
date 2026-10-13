import { NextResponse } from 'next/server';
import { DIAGNOSTIC_COOKIE } from '@/lib/diagnostic-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const url = new URL(request.url);
  const expectedOrigin = process.env.CONTROLLER_PUBLIC_ORIGIN ||
    (process.env.NODE_ENV === 'production' ? null : `${url.protocol}//${request.headers.get('host') || url.host}`);
  if (!expectedOrigin || request.headers.get('origin') !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const response = NextResponse.redirect(new URL('/diagnosticlogs', request.url), 303);
  response.headers.set('Cache-Control', 'no-store');
  response.cookies.set(DIAGNOSTIC_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
