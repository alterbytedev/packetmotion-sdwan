import { expect, test } from '@playwright/test';
import { database, login } from './fixture';

test('superadmin configures and persists a lab HTTP host allowlist', async ({ page }) => {
  await login(page);
  await database(async (pool) => {
    await pool.query("UPDATE operators SET role='superadmin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
  });
  try {
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Insecure HTTP lab controllers' })).toBeVisible();
    await page.getByLabel('Allowed private IP addresses').fill('192.168.160.200');
    await page.getByRole('button', { name: 'Save allowlist', exact: true }).click();
    await expect(page.getByText(/Allowed controller addresses saved/)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Allowed private IP addresses')).toHaveValue('192.168.160.200');
  } finally {
    await database(async (pool) => {
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
      await pool.query('DELETE FROM controller_insecure_http_hosts');
      await pool.query("DELETE FROM audit_events WHERE action='controller.insecure_http_hosts_updated' AND actor_email=$1", [process.env.FABRIC_TEST_EMAIL]);
    });
  }
});

test('admin cannot view or change the lab HTTP host allowlist', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'Insecure HTTP lab controllers' })).toHaveCount(0);
  expect((await page.request.get('/api/operator/controller-settings/insecure-http-hosts')).status()).toBe(403);
  expect((await page.request.put('/api/operator/controller-settings/insecure-http-hosts', {
    headers: { Origin: 'http://127.0.0.1:3107', 'Content-Type': 'application/json' },
    data: { hosts: ['192.168.160.200'] },
  })).status()).toBe(403);
});
