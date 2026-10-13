import { test, expect } from '@playwright/test';
import { login } from './fixture';

test('diagnostic logs require their own developer credentials and support sign-out', async ({ page }) => {
  await page.goto('/diagnosticlogs');
  await expect(page.getByRole('heading', { name: 'Diagnostic logs' })).toBeVisible();
  const form = new URLSearchParams({ username: 'developer', password: process.env.FABRIC_TEST_DEVELOPER_PASSWORD || '' });
  const response = await page.request.post('/diagnosticlogs/login', {
    headers: { origin: 'http://127.0.0.1:3107', 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  await page.goto('/diagnosticlogs');
  await expect(page.getByRole('heading', { name: 'Runtime error logs' })).toBeVisible();
  const logout = await page.request.post('/diagnosticlogs/logout', {
    headers: { origin: 'http://127.0.0.1:3107' },
    maxRedirects: 0,
  });
  expect(logout.status()).toBe(303);
  await page.goto('/diagnosticlogs');
  await expect(page.getByRole('heading', { name: 'Diagnostic logs' })).toBeVisible();
});

test('operator session alone does not grant diagnostic log access', async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/diagnosticlogs');
  await expect(page.getByRole('heading', { name: 'Diagnostic logs' })).toBeVisible();
});
