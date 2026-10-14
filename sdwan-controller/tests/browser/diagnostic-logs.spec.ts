import { test, expect, request, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { signSession } from '../../src/lib/session';
import { database } from './fixture';

async function setRole(role: 'superadmin' | 'admin' | 'viewer') {
  await database(async (pool) => {
    await pool.query('UPDATE operators SET role = $1 WHERE email = $2', [
      role,
      process.env.FABRIC_TEST_EMAIL,
    ]);
  });
}

async function addOperatorSession(page: Page) {
  const operator = await database(async (pool) => (
    await pool.query('SELECT email, password_hash FROM operators WHERE email=$1', [
      process.env.FABRIC_TEST_EMAIL,
    ])
  ).rows[0]);
  const credentialVersion = createHash('sha256').update(operator.password_hash).digest('hex');
  const session = signSession(
    operator.email,
    process.env.CONTROLLER_SESSION_SECRET!,
    Date.now(),
    credentialVersion,
  );
  await page.context().addCookies([
    { name: 'sdwan-session', value: session, url: 'http://127.0.0.1:3107' },
  ]);
}

test('superadmin can open diagnostics from the dashboard menu', async ({ page }) => {
  await setRole('superadmin');
  try {
    expect(await database(async (pool) => (
      await pool.query('SELECT role FROM operators WHERE email=$1', [process.env.FABRIC_TEST_EMAIL])
    ).rows[0].role)).toBe('superadmin');
    await addOperatorSession(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Superadmin', { exact: true })).toBeVisible();
    const diagnosticsLink = page.getByRole('link', { name: 'Diagnostics' });
    const openNavigation = page.getByRole('button', { name: 'Open navigation' });
    if (await openNavigation.isVisible()) await openNavigation.click();
    await expect(diagnosticsLink).toBeVisible();
    await expect(diagnosticsLink).toHaveAttribute('href', '/diagnosticlogs');
    const diagnosticsResponse = await page.request.get('/diagnosticlogs');
    expect(diagnosticsResponse.status()).toBe(200);
    expect(await diagnosticsResponse.text()).toContain('Runtime error logs');
  } finally {
    await setRole('admin');
  }
});

test('admin and viewer sessions are redirected from diagnostics and lack the menu link', async ({ page }) => {
  await setRole('admin');
  try {
    const anonymous = await request.newContext({ baseURL: 'http://127.0.0.1:3107' });
    try {
      const anonymousResponse = await anonymous.get('/diagnosticlogs', { maxRedirects: 0 });
      expect(anonymousResponse.status()).toBe(307);
      expect(anonymousResponse.headers().location).toBe('/login');
    } finally {
      await anonymous.dispose();
    }

    await addOperatorSession(page);
    const adminResponse = await page.request.get('/diagnosticlogs', { maxRedirects: 0 });
    expect(adminResponse.status()).toBe(307);
    expect(adminResponse.headers().location).toBe('/dashboard');

    await setRole('viewer');
    const viewerResponse = await page.request.get('/diagnosticlogs', { maxRedirects: 0 });
    expect(viewerResponse.status()).toBe(307);
    expect(viewerResponse.headers().location).toBe('/dashboard');
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Diagnostics' })).toHaveCount(0);
  } finally {
    await setRole('admin');
  }
});
