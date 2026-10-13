import { test, expect } from '@playwright/test';
import { clearInventory, database, login } from './fixture';

test.beforeEach(clearInventory);

test('unhandled click errors show a friendly reference and persist a redacted developer log', async ({
  page,
}) => {
  await login(page);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'runtime-error-trigger';
    button.textContent = 'Trigger runtime error';
    button.addEventListener('click', () => {
      throw new Error('password=browser-secret');
    });
    document.body.append(button);
  });
  await page.evaluate(() =>
    (document.getElementById('runtime-error-trigger') as HTMLButtonElement).click(),
  );
  await expect(page.getByRole('heading', { name: 'We hit a problem' })).toBeVisible();
  await expect(page.getByText(/This page ran into an unexpected problem/)).toBeVisible();
  const referenceId = await page.getByTestId('runtime-error-reference').textContent();
  expect(referenceId).toMatch(/^[0-9a-f-]{36}$/);
  await expect
    .poll(async () =>
      database(
        async (pool) =>
          (
            await pool.query('SELECT message FROM runtime_errors WHERE reference_id=$1', [
              referenceId,
            ])
          ).rows[0]?.message,
      ),
    )
    .toContain('password=[REDACTED]');
  await expect(page.locator('main').getByText(/browser-secret/)).toHaveCount(0);
});

test('password visibility uses keyboard and exposes pressed state', async ({ page }) => {
  await page.goto('/login');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('example-password');
  const toggle = page.getByRole('button', { name: 'Show password', exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(password).toHaveAttribute('type', 'text');
  const hide = page.getByRole('button', { name: 'Hide password', exact: true });
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('navigation focus is contained on mobile and survives viewport changes', async ({
  page,
}, info) => {
  await login(page);
  const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
  const panel = page.locator('#dashboard-navigation');
  if (info.project.name === 'desktop') {
    await expect(panel).not.toHaveAttribute('inert');
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await expect(panel).toHaveAttribute('inert');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Controller navigation' });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const close = page.getByRole('button', { name: 'Close menu', exact: true });
  await expect(close).toBeFocused();
  await page.screenshot({
    path: `../docs/evidence/browser/navigation-open-${info.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('link', { name: 'SD-WAN CONTROLLER' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(panel).toHaveAttribute('inert');
  await trigger.click();
  await panel.locator('nav a[href="/dashboard/devices"]').click();
  await expect(page).toHaveURL(/dashboard\/devices(?:$|\?)/);
  await trigger.click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(panel).not.toHaveAttribute('inert');
  await expect(panel).not.toHaveAttribute('aria-modal');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(panel.locator('nav a[href="/dashboard/devices"]')).toBeVisible();
});

test('form/select semantics, clipboard feedback and responsive inventory', async ({
  page,
}, info) => {
  await login(page);
  await page.goto('/dashboard/devices');
  await expect(page.getByText('No devices added', { exact: true })).toBeVisible();
  const rows = page.getByRole('combobox', { name: 'Rows per page' });
  await rows.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(rows).toHaveValue('25');
  await page.getByRole('button', { name: 'Add device', exact: true }).click();
  await page.getByLabel('Device name', { exact: true }).fill('Consistency edge');
  const kind = page.getByRole('combobox', { name: 'Device type' });
  await expect(kind).toHaveValue('branch');
  await page.screenshot({
    path: `../docs/evidence/browser/device-form-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save device', exact: true }).click();
  await expect(page.getByTestId('enrollment-token')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Device added.' })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard permission denied');
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Copy token', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Device enrollment' }).getByRole('alert'),
  ).toHaveText('Unable to copy token. Select and copy it manually.');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {},
      },
    });
  });
  await page.getByRole('button', { name: 'Copy token', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  await expect(page.getByText('Token copied.', { exact: true })).toHaveAttribute('role', 'status');
  await expect(
    page.getByRole('region', { name: 'Device enrollment' }).getByRole('alert'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide token', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Not enrolled', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `../docs/evidence/browser/ui-consistency-${info.project.name}.png`,
    fullPage: true,
  });
});
