import { expect, test } from '@playwright/test';
import { database, login } from './fixture';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const adminEmail = `managed-admin-${suffix}@localhost`;
const viewerEmail = `managed-user-${suffix}@localhost`;

test('operator management follows superadmin and admin account creation limits', async ({ page }) => {
  await database(async (pool) => {
    await pool.query("UPDATE operators SET role='superadmin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
  });
  try {
    await login(page);
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Operator accounts' })).toBeVisible();
    await page.getByLabel('Email address').fill(adminEmail);
    await page.getByLabel('Access level').selectOption('admin');
    const createAdmin = page.waitForResponse((response) => response.url().endsWith('/api/operator/operators') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Add operator' }).click();
    expect((await createAdmin).status()).toBe(201);
    await expect(page.getByRole('row').filter({ hasText: adminEmail })).toBeVisible();
    await expect(page.getByText(/generated password \(shown once\)/)).toBeVisible();

    await database(async (pool) => {
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
    });
    await page.reload();
    await expect(page.getByText('Admins can add viewer accounts.')).toBeVisible();
    await page.getByLabel('Email address').fill(viewerEmail);
    const createViewer = page.waitForResponse((response) => response.url().endsWith('/api/operator/operators') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Add operator' }).click();
    expect((await createViewer).status()).toBe(201);
    await expect(page.getByRole('row').filter({ hasText: viewerEmail })).toBeVisible();

    const denied = await page.request.post('/api/operator/operators', {
      headers: { Origin: 'http://127.0.0.1:3107', 'Content-Type': 'application/json' },
      data: { email: `denied-${suffix}@localhost`, role: 'admin' },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await database(async (pool) => {
      await pool.query('DELETE FROM operators WHERE email = ANY($1::text[])', [[adminEmail, viewerEmail]]);
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
    });
  }
});
