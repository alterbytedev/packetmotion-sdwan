'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE, sessionSecret } from '@/lib/auth';
import { findOperator } from '@/lib/operators';
import { clearLoginAttempts, consumeLoginAttempt } from '@/lib/login-rate-limit';
import { SESSION_DURATION, signSession } from '@/lib/session';

export type LoginState = { error: string };

export async function login(_state: LoginState, form: FormData): Promise<LoginState> {
  const secret = sessionSecret();
  if (!secret)
    return {
      error: 'Operator access is not configured. Run npm run init:superadmin on the controller.',
    };
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(form.get('password') ?? '');
  if (password.length > 1024 || email.length > 254) return { error: 'Invalid email or password.' };
  const key = createHash('sha256').update(email).digest('hex');
  if (!(await consumeLoginAttempt(key)))
    return { error: 'Too many attempts. Please wait a minute and try again.' };
  const operator = await findOperator(email);
  const [salt, expected] = operator?.passwordHash.split(':') ?? ['', ''];
  const validHash = /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(operator?.passwordHash ?? '');
  const actual = scryptSync(password, validHash ? salt : '0'.repeat(32), 64);
  if (
    !validHash ||
    !timingSafeEqual(actual, validHash ? Buffer.from(expected, 'hex') : Buffer.alloc(64)) ||
    !operator
  ) {
    return { error: 'Invalid email or password.' };
  }
  await clearLoginAttempts(key);
  const credentialVersion = createHash('sha256').update(operator.passwordHash).digest('hex');
  (await cookies()).set(SESSION_COOKIE, signSession(operator.email, secret, Date.now(), credentialVersion), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION,
  });
  redirect('/dashboard');
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
