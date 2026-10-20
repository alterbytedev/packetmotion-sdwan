import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { clearInventory } from './fixture';

test.beforeEach(clearInventory);

// Keep this as a reproducible shell baseline. Inventory acceptance lives separately.
test('login, protected dashboard, navigation, and logout', async ({ page }, testInfo) => {
  const directory = '../docs/evidence/browser';
  await mkdir(directory, { recursive: true });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.screenshot({
    path: `${directory}/login-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel('Email address').fill(process.env.FABRIC_TEST_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.FABRIC_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in to controller', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Network overview' })).toBeVisible();
  await page.screenshot({
    path: `${directory}/overview-${testInfo.project.name}.png`,
    fullPage: true,
  });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('nav a[href="/dashboard/devices"]').click();
  await expect(page).toHaveURL(/dashboard\/devices(?:$|\?)/);
  await expect(page.getByText('No devices added', { exact: true })).toBeVisible();
  await expect(page.locator('nav a[href="/dashboard/devices"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.screenshot({
    path: `${directory}/devices-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto('/dashboard/telemetry');
  await expect(page).toHaveURL(/dashboard\/devices$/);
  await expect(page.getByRole('heading', { name: 'Devices', exact: true })).toBeVisible();
  await page.goto('/dashboard/settings');
  await expect(page).toHaveURL(/dashboard\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Network overview' })).toBeVisible();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});
