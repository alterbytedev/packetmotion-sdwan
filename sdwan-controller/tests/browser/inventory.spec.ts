import { test, expect } from '@playwright/test';
import { clearInventory, database, login } from './fixture';

test.beforeEach(clearInventory);

test('admin creates site/device through UI, reloads persisted inventory and rejects invalid HTTP mutations', async ({
  page,
}, info) => {
  const unauthenticated = await page.request.get('/api/operator/sites');
  expect(unauthenticated.status()).toBe(401);
  await login(page);
  await page.goto('/dashboard/devices');
  await page.getByRole('button', { name: 'Add device', exact: true }).click();
  await page.getByLabel('Device name', { exact: true }).fill('Jakarta edge');
  await page.getByLabel('Routing mode', { exact: true }).selectOption('subnet-router');
  await page.getByLabel('LAN subnet (optional)', { exact: true }).fill('10.61.0.0/24');
  await page.getByRole('button', { name: 'Save device', exact: true }).click();
  await expect(page.getByTestId('enrollment-token')).toHaveText(/^pm_enroll_[a-f0-9]{64}$/);
  await page.getByRole('button', { name: 'Hide token', exact: true }).click();
  await expect(page.getByTestId('enrollment-token')).toHaveCount(0);
  const device = page.getByRole('link', { name: 'Jakarta edge', exact: true });
  await expect(device).toBeVisible();
  const status = page.getByRole('cell', { name: 'Not enrolled', exact: true });
  await expect(status).toBeVisible();
  await page.reload();
  await expect(device).toBeVisible();
  await page.getByRole('textbox', { name: 'Search devices' }).fill('no such device');
  await expect(page.getByText('No devices match “no such device”')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search devices' }).fill('');
  await expect(device).toBeVisible();
  await page.screenshot({
    path: `../docs/evidence/browser/inventory-${info.project.name}.png`,
    fullPage: true,
  });
  const origin = 'http://127.0.0.1:3107';
  expect(
    (
      await page.request.post('/api/operator/sites', {
        headers: { Origin: 'https://attacker.test' },
        data: { name: 'CSRF', mode: 'gateway' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post('/api/operator/sites', {
        data: { name: 'No origin', mode: 'gateway' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post('/api/operator/sites', {
        headers: { Origin: origin },
        data: { name: 'Overlap', mode: 'gateway', lanPrefix: '10.61.0.128/25' },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post('/api/operator/sites', {
        headers: { Origin: origin },
        data: { name: 'Bad', mode: 'gateway', lanPrefix: '10.61.0.1/24' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post('/api/operator/nodes', {
        headers: { Origin: origin },
        data: { name: 'Missing', siteId: '00000000-0000-0000-0000-000000000000', kind: 'branch' },
      })
    ).status(),
  ).toBe(400);
  await database(async (pool) => {
    expect((await pool.query('SELECT action FROM audit_events')).rowCount).toBe(3);
    expect((await pool.query('SELECT id FROM sites')).rowCount).toBe(1);
  });
  await page.goto('/dashboard');
  await expect(page.getByText('2 of 4 steps', { exact: true })).toBeVisible();
  await page.goto('/dashboard/devices');
  await expect(page.getByText('Jakarta edge', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/dashboard\/devices(?:$|\?)/);
  await page.getByRole('link', { name: 'Jakarta edge', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/devices\/[0-9a-f-]+$/);
  await expect(page.getByRole('button', { name: 'New token', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Publish configuration', exact: true }),
  ).toBeEnabled({ timeout: 15_000 }); // Allow the isolated Next dev server to compile the config route.
  await page.getByLabel('Check-in interval (seconds)', { exact: true }).fill('45');
  await page.getByRole('button', { name: 'Publish configuration', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 1 published.');
});

test('current viewer role permits reading but blocks API and hides mutation controls; forged cookie fails', async ({
  page,
  context,
}) => {
  await login(page);
  await database(async (pool) => {
    await pool.query("UPDATE operators SET role = 'viewer' WHERE email = $1", [
      process.env.FABRIC_TEST_EMAIL,
    ]);
  });
  try {
    await page.goto('/dashboard/devices');
    await expect(page.getByRole('button', { name: 'Add device', exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/dashboard\/devices(?:$|\?)/);
    await expect(page.getByRole('link', { name: 'Add a device', exact: false })).toHaveCount(0);

    expect((await page.request.get('/api/operator/sites')).status()).toBe(200);
    expect(
      (
        await page.request.post('/api/operator/sites', {
          headers: { Origin: 'http://127.0.0.1:3107' },
          data: { name: 'Denied', mode: 'gateway' },
        })
      ).status(),
    ).toBe(403);
    await context.addCookies([
      { name: 'sdwan-session', value: 'forged.signature', url: 'http://127.0.0.1:3107' },
    ]);
    expect((await page.request.get('/api/operator/nodes')).status()).toBe(401);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await database(async (pool) => {
      await pool.query("UPDATE operators SET role = 'admin' WHERE email = $1", [
        process.env.FABRIC_TEST_EMAIL,
      ]);
    });
  }
});

test('device table fetches bounded pages, searches across pages and opens scoped configuration', async ({
  page,
}, info) => {
  const target = await database(async (pool) => {
    const site = (
      await pool.query(
        "INSERT INTO sites(id,name,mode) VALUES(gen_random_uuid(),'Bulk network','gateway') RETURNING id",
      )
    ).rows[0].id;
    const rows = await pool.query(
      "INSERT INTO nodes(id,site_id,name,kind) SELECT gen_random_uuid(),$1,'Device ' || lpad(i::text,3,'0'),'branch' FROM generate_series(1,31) i RETURNING id,name",
      [site],
    );
    return rows.rows.find((row) => row.name === 'Device 031').id;
  });
  await login(page);
  await page.goto('/dashboard/devices');
  await expect(page).toHaveURL(/dashboard\/devices$/);
  await expect(page.getByText('Page 1 of 2 · 31 devices', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Device \d{3}$/ })).toHaveCount(25);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 2 · 31 devices', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Device \d{3}$/ })).toHaveCount(6);
  await page.getByRole('textbox', { name: 'Search devices' }).fill('031');
  await expect(page.getByText('Page 1 of 1 · 1 devices', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Device 031', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/devices/${target}$`));
  await expect(page.getByLabel('Device', { exact: true }).first()).toHaveValue(target);
  await page.getByLabel('Check-in interval (seconds)', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Publish configuration', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 1 published.');
  await database(async (pool) => {
    const rows = await pool.query('SELECT node_id FROM desired_configs');
    expect(rows.rows).toEqual([{ node_id: target }]);
  });
  await page.screenshot({
    path: `../docs/evidence/browser/device-detail-${info.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByLabel('Check-in interval (seconds)', { exact: true })).toHaveValue('60');
  await page.getByRole('link', { name: 'Back to devices', exact: true }).click();
  await expect(page).toHaveURL(/dashboard\/devices$/);
  await page.getByLabel('Rows per page', { exact: true }).selectOption('10');
  await expect(page.getByText('Page 1 of 4 · 31 devices', { exact: true })).toBeVisible();
  expect((await page.request.get('/api/operator/nodes?page=0')).status()).toBe(400);
  expect((await page.request.get('/api/operator/nodes?pageSize=1000')).status()).toBe(400);
  await database(async (pool) => {
    await pool.query("UPDATE operators SET role='viewer' WHERE email=$1", [
      process.env.FABRIC_TEST_EMAIL,
    ]);
  });
  try {
    await page.goto(`/dashboard/devices/${target}`);
    await expect(
      page.getByRole('button', { name: 'Publish configuration', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel('Check-in interval (seconds)', { exact: true })).toBeDisabled();
    expect(
      (
        await page.request.post(`/api/operator/nodes/${target}/config`, {
          headers: { Origin: 'http://127.0.0.1:3107' },
          data: { expectedRevision: 1, pollIntervalSeconds: 90 },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await database(async (pool) => {
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [
        process.env.FABRIC_TEST_EMAIL,
      ]);
    });
  }
});

test('async device search ignores older responses and recovers from load errors', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/operator/nodes?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('search');
    if (query === 'fail') {
      await route.fulfill({ status: 503, json: { error: 'Unable to load devices.' } });
      return;
    }
    if (query === 'old') await new Promise((resolve) => setTimeout(resolve, 700));
    await route
      .fulfill({ json: { nodes: [], total: query === 'old' ? 99 : 0, page: 1, pageSize: 25 } })
      .catch(() => {});
  });
  await page.goto('/dashboard/devices');
  const search = page.getByRole('textbox', { name: 'Search devices' });
  await search.fill('old');
  await page.waitForRequest((request) => request.url().includes('search=old'));
  await search.fill('new');
  await expect(page.getByText('No devices match “new”', { exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByText('Page 1 of 1 · 0 devices', { exact: true })).toBeVisible();
  await search.fill('fail');
  await expect(page.locator('p[role="alert"]')).toHaveText('Unable to load devices.');
  await page.unroute('**/api/operator/nodes?*');
  await page.getByRole('button', { name: 'Refresh devices', exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toHaveCount(0);
  await expect(page.getByText('No devices match “fail”', { exact: true })).toBeVisible();
});
