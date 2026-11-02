import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSession } from '../../src/lib/session';
import { clearInventory, database, login } from './fixture';

test.beforeEach(clearInventory);

test('white-label branding is superadmin-only and the saved logo appears on login and dashboard', async ({
  page,
}) => {
  const operator = await database(
    async (pool) =>
      (
        await pool.query('SELECT email, password_hash FROM operators WHERE email=$1', [
          process.env.FABRIC_TEST_EMAIL,
        ])
      ).rows[0],
  );
  const credentialVersion = createHash('sha256').update(operator.password_hash).digest('hex');
  const session = signSession(
    operator.email,
    process.env.CONTROLLER_SESSION_SECRET!,
    Date.now(),
    credentialVersion,
  );
  await page
    .context()
    .addCookies([{ name: 'sdwan-session', value: session, url: 'http://127.0.0.1:3107' }]);
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'White-label logo' })).toHaveCount(0);
  const adminUpload = await page.request.put('/api/branding/logo', {
    headers: { Origin: 'http://127.0.0.1:3107', 'Content-Type': 'image/png' },
    data: Buffer.from('89504e470d0a1a0a', 'hex'),
  });
  expect(adminUpload.status()).toBe(403);

  await database(async (pool) => {
    await pool.query("UPDATE operators SET role='superadmin' WHERE email=$1", [
      process.env.FABRIC_TEST_EMAIL,
    ]);
  });
  try {
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'White-label logo' })).toBeVisible();
    await expect(page.getByText(/up to 2 MiB.*600 × 180 px/)).toBeVisible();
    await expect(page.getByText('Default mark is in use')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove logo' })).toHaveCount(0);
    const savedLogo = page.waitForResponse(
      (response) =>
        response.url().includes('/api/branding/logo') && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Upload a logo' }).setInputFiles({
      name: 'brand.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    expect((await savedLogo).status()).toBe(200);
    expect((await page.request.get('/api/branding/logo')).status()).toBe(200);
    await expect(page.getByText('Custom logo')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove logo' })).toBeVisible();
    await page.goto('/dashboard');
    await expect(page.locator('#dashboard-navigation img[alt="Organization logo"]')).toBeVisible();
    if (await page.getByRole('button', { name: 'Open navigation' }).isVisible())
      await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    if (await page.getByAltText('Organization logo').count()) {
      await expect(page.getByAltText('Organization logo')).toBeVisible();
    } else {
      await expect(page.getByText('SD-WAN Controller', { exact: true })).toBeVisible();
    }
  } finally {
    await database(async (pool) => {
      await pool.query('DELETE FROM controller_branding WHERE id=TRUE');
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [
        process.env.FABRIC_TEST_EMAIL,
      ]);
    });
  }
});

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
  await expect(page.getByText(/curl -fsSLo install\.sh http:\/\/127\.0\.0\.1:3107\/fabric\/edge\.sh/)).toBeVisible();
  await expect(page.getByText(/--allow-insecure-local/)).toBeVisible();
  await page.getByRole('button', { name: 'Hide token', exact: true }).click();
  await expect(page.getByTestId('enrollment-token')).toHaveCount(0);
  const device = page.getByRole('link', { name: 'Jakarta edge', exact: true });
  await expect(device).toBeVisible();
  const status = page.getByRole('cell', { name: 'Pending', exact: true });
  await expect(status).toBeVisible();
  await page.reload();
  await expect(device).toBeVisible();
  await page.getByRole('textbox', { name: 'Search devices' }).fill('no such device');
  await expect(page.getByText('No devices match “no such device”')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search devices' }).fill('');
  await expect(device).toBeVisible();
  await page.screenshot({
    path: info.outputPath(`inventory-${info.project.name}.png`),
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
    expect((await pool.query('SELECT action FROM audit_events')).rowCount).toBe(4);
    expect((await pool.query('SELECT id FROM sites')).rowCount).toBe(1);
  });
  await page.goto('/dashboard');
  await expect(page.getByText('2 of 4 steps', { exact: true })).toBeVisible();
  await page.goto('/dashboard/devices');
  await expect(page.getByText('Jakarta edge', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/dashboard\/devices(?:$|\?)/);
  await page.getByRole('link', { name: 'Jakarta edge', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/devices\/[0-9a-f-]+$/);
  await expect(page.getByRole('button', { name: 'Enroll device', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Publish configuration', exact: true }),
  ).toBeEnabled({ timeout: 15_000 }); // Allow the isolated Next dev server to compile the config route.
  await page.getByLabel('Check-in interval (seconds)', { exact: true }).fill('45');
  await page.getByRole('button', { name: 'Publish configuration', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 2 published.');
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
  const table = page.getByRole('table', { name: 'Registered devices' });
  await expect(table).toHaveAttribute('data-density', 'compact');
  await expect(table.getByRole('columnheader', { name: 'Management status' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search devices' })).toHaveCSS('height', '32px');
  await expect(page.getByLabel('Rows per page', { exact: true })).toHaveCSS('height', '32px');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCSS('height', '32px');
  const scrollRegion = page.getByRole('region', { name: 'Device inventory table' });
  await scrollRegion.focus();
  await expect(scrollRegion).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (info.project.name === 'mobile') {
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scrollRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await scrollRegion.evaluate((element) => { element.scrollLeft = 0; });
  }
  await scrollRegion.evaluate((element) => { (element as HTMLElement).blur(); });
  await page.screenshot({ path: `/tmp/packetmotion-ui-inventory-${info.project.name}.png`, fullPage: true });
  const refreshButton = page.getByRole('button', { name: 'Refresh', exact: true });
  const refreshWidth = (await refreshButton.boundingBox())!.width;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  await page.route('**/api/operator/nodes?*', async (route) => {
    await refreshGate;
    await route.continue();
  }, { times: 1 });
  try {
    await refreshButton.click();
    await expect(refreshButton).toBeDisabled();
    await expect(refreshButton).toHaveAttribute('aria-busy', 'true');
    await expect(refreshButton).toHaveAccessibleName('Refresh');
    expect((await refreshButton.boundingBox())!.width).toBe(refreshWidth);
    await page.screenshot({ path: `/tmp/packetmotion-ui-loading-${info.project.name}.png`, fullPage: true });
  } finally {
    releaseRefresh();
  }
  await expect(refreshButton).toBeEnabled();


  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 2 · 31 devices', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Device \d{3}$/ })).toHaveCount(6);
  await page.getByRole('textbox', { name: 'Search devices' }).fill('031');
  await expect(page.getByText('Page 1 of 1 · 1 devices', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search devices' }).fill('no-such-device');
  await expect(page.getByText('No devices match “no-such-device”')).toBeVisible();
  expect(await scrollRegion.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/packetmotion-ui-empty-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByRole('textbox', { name: 'Search devices' })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Search devices' }).fill('031');
  await expect(page.getByText('Page 1 of 1 · 1 devices', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Device 031', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/devices/${target}$`));
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await expect(page.getByLabel('Device', { exact: true }).first()).toHaveValue(target);
  await page.getByLabel('Check-in interval (seconds)', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Publish configuration', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 1 published.');
  await database(async (pool) => {
    const rows = await pool.query('SELECT node_id FROM desired_configs');
    expect(rows.rows).toEqual([{ node_id: target }]);
  });
  await page.screenshot({
    path: `test-results/device-detail-published-${info.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await expect(page.getByLabel('Check-in interval (seconds)', { exact: true })).toHaveValue('60');
  await expect(page.getByLabel('Device', { exact: true }).first()).toHaveCSS('height', '36px');
  await expect(page.getByLabel('Check-in interval (seconds)', { exact: true })).toHaveCSS('height', '36px');

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
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Publish configuration', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel('Check-in interval (seconds)', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Rename', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive device', exact: true })).toHaveCount(0);
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
  await database((pool) => pool.query("UPDATE operators SET role='superadmin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]));
  try {
    await page.goto('/dashboard/settings');
    await expect(page.getByLabel('IANA time zone')).toHaveCSS('height', '36px');
    await expect(page.getByRole('button', { name: 'Save time zone' })).toHaveCSS('height', '36px');
    await expect(page.getByLabel('Access level')).toHaveCSS('height', '36px');
    await expect(page.getByRole('cell', { name: process.env.FABRIC_TEST_EMAIL!, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/packetmotion-ui-settings-${info.project.name}.png`, fullPage: true });
  } finally {
    await database((pool) => pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]));
  }

});

test('device detail tabs support keyboard navigation, rename and archive', async ({ page }, info) => {
  const target = await database(async (pool) => {
    const site = (await pool.query(
      "INSERT INTO sites(id,name,mode) VALUES(gen_random_uuid(),'Tabbed network','gateway') RETURNING id",
    )).rows[0].id;
    return (await pool.query(
      "INSERT INTO nodes(id,site_id,name,kind) VALUES(gen_random_uuid(),$1,'Tabbed Edge','branch') RETURNING id",
      [site],
    )).rows[0].id;
  });
  let telemetryRequests = 0;
  let telemetryUnavailable = false;
  await page.route(`**/api/operator/nodes/${target}/telemetry?*`, async (route) => {
    telemetryRequests++;
    if (telemetryUnavailable) {
      await route.fulfill({ status: 503, json: { error: 'Telemetry temporarily unavailable.' } });
      return;
    }
    await route.fulfill({ json: { telemetry: { receivedAt: new Date().toISOString(), snapshot: {
      agentVersion: '0.3.6', os: 'linux', arch: 'amd64', uptimeSeconds: 120,
      interfaces: [{ name: 'eth0', up: true, mtu: 1500 }, { name: 'wg-fabric', up: false, mtu: 1420 }],
    } } } });
  });
  await login(page);
  await page.goto(`/dashboard/devices/${target}`);
  await page.waitForLoadState('networkidle');
  const tabs = page.getByRole('tablist', { name: 'Device details' });
  const overview = tabs.getByRole('tab', { name: 'Overview' });
  await expect(overview).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Agent telemetry' })).toBeVisible();
  await expect(page.getByLabel('Device', { exact: true })).toBeHidden();
  await page.screenshot({ path: `test-results/device-detail-overview-${info.project.name}.png`, fullPage: true });
  const requestsBeforeTabChange = telemetryRequests;
  expect(requestsBeforeTabChange).toBeGreaterThan(0);
  await overview.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Network' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Interfaces', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'LAN network' })).toBeVisible();
  await expect(page.getByText('eth0', { exact: true })).toBeVisible();
  await expect(page.getByText('wg-fabric', { exact: true })).toBeVisible();
  expect(telemetryRequests).toBe(requestsBeforeTabChange);
  await expect(page.getByRole('heading', { name: 'Tabbed Edge', exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/device-detail-underlay-${info.project.name}.png`, fullPage: true });
  const underlay = page.getByRole('tabpanel', { name: 'Network', exact: true });
  telemetryUnavailable = true;
  await underlay.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(underlay.getByText('Telemetry temporarily unavailable.', { exact: true })).toBeVisible();
  telemetryUnavailable = false;
  await underlay.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(underlay.getByText('eth0', { exact: true })).toBeVisible();
  expect(telemetryRequests).toBe(requestsBeforeTabChange + 2);
  await tabs.getByRole('tab', { name: 'Network' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'SD-WAN' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Hub connections' })).toBeVisible();
  await page.screenshot({ path: `test-results/device-detail-overlay-${info.project.name}.png`, fullPage: true });
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Advanced' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Agent configuration' })).toBeVisible();
  await expect(page.locator('summary').filter({ hasText: /^Agent upgrade$/ })).toHaveCount(0);
  await page.getByLabel('Check-in interval (seconds)', { exact: true }).fill('75');
  await page.keyboard.press('Tab');
  await tabs.getByRole('tab', { name: 'Overview' }).click();
  await tabs.getByRole('tab', { name: 'Advanced' }).click();
  await expect(page.getByLabel('Check-in interval (seconds)', { exact: true })).toHaveValue('75');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/device-detail-advanced-${info.project.name}.png`, fullPage: true });
  await tabs.getByRole('tab', { name: 'Advanced' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(overview).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.getByRole('tab', { name: 'Advanced' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(overview).toBeFocused();
  await tabs.getByRole('tab', { name: 'Overview' }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Device name', { exact: true }).fill('Renamed Tabbed Edge');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Renamed Tabbed Edge', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive device', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive device' });
  await expect(dialog.getByText(/Audit history and reserved WireGuard addresses and ports are retained/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive device', exact: true }).click();
  await page.getByRole('dialog', { name: 'Archive device' }).getByRole('button', { name: 'Archive device', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/devices$/);
  const activeInventory = await page.request.get('/api/operator/nodes?search=Renamed%20Tabbed%20Edge');
  expect((await activeInventory.json()).total).toBe(0);
  expect((await database(pool => pool.query('SELECT archived_at FROM nodes WHERE id=$1', [target]))).rows[0].archived_at).not.toBeNull();
});

test('admins can select and permanently delete multiple archived devices', async ({ page }) => {
  const ids = await database(async (pool) => {
    const siteId = (await pool.query(
      "INSERT INTO sites(id,name,mode) VALUES(gen_random_uuid(),'Bulk archive site','gateway') RETURNING id",
    )).rows[0].id;
    const nodes = [];
    for (const name of ['Bulk archived one', 'Bulk archived two']) {
      nodes.push((await pool.query(
        "INSERT INTO nodes(id,site_id,name,kind,archived_at,revoked_at) VALUES(gen_random_uuid(),$1,$2,'branch',now(),now()) RETURNING id",
        [siteId, name],
      )).rows[0].id);
    }
    return nodes;
  });

  await login(page);
  await page.goto('/dashboard/devices');
  await page.getByRole('button', { name: 'View archived devices' }).click();
  await expect(page.getByRole('link', { name: 'Bulk archived one', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bulk archived two', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select all archived devices on this page' }).check();
  await expect(page.getByRole('button', { name: 'Delete selected (2)' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  const deletion = page.waitForResponse((response) =>
    response.url().endsWith('/api/operator/nodes/permanent') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Delete selected (2)' }).click();
  expect((await deletion).status()).toBe(201);
  await expect(page.getByText('2 archived devices permanently deleted.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Bulk archived/ })).toHaveCount(0);
  expect((await database((pool) => pool.query('SELECT id FROM nodes WHERE id=ANY($1::uuid[])', [ids]))).rowCount).toBe(0);
});

test('device command history is visible only to superadmins and API enforces the live role', async ({ page }) => {
  const { nodeId, operationId, email, passwordHash } = await database(async (pool) => {
    const site = (await pool.query(
      "INSERT INTO sites(id,name,mode) VALUES(gen_random_uuid(),'History network','gateway') RETURNING id",
    )).rows[0].id;
    const node = (await pool.query(
      "INSERT INTO nodes(id,site_id,name,kind) VALUES(gen_random_uuid(),$1,'History device','branch') RETURNING id",
      [site],
    )).rows[0].id;
    const operationId = randomUUID();
    await pool.query(
      `INSERT INTO device_command_history(operation_id,node_id,operation_type,revision,event,attempt,actor_email,summary,raw_config)
       VALUES($1,$2,'desired_config',1,'published',1,$3,'Initial desired configuration published.',$4)`,
      [operationId, node, process.env.FABRIC_TEST_EMAIL, '{"schemaVersion":1,"pollIntervalSeconds":30}'],
    );
    await pool.query("UPDATE operators SET role='superadmin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
    const operator = (await pool.query('SELECT email,password_hash FROM operators WHERE email=$1', [process.env.FABRIC_TEST_EMAIL])).rows[0];
    return { nodeId: node, operationId, email: operator.email, passwordHash: operator.password_hash };
  });
  try {
    const credentialVersion = createHash('sha256').update(passwordHash).digest('hex');
    const session = signSession(email, process.env.CONTROLLER_SESSION_SECRET!, Date.now(), credentialVersion);
    await page.context().addCookies([{ name: 'sdwan-session', value: session, url: 'http://127.0.0.1:3107' }]);
    await page.goto(`/dashboard/devices/${nodeId}`);
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
    await page.locator('summary').filter({ hasText: /^Agent upgrade$/ }).click();
    await expect(page.getByLabel('Release version')).toBeVisible();
    await expect(page.getByText(/curl -fsSL .*\/fabric\/edge\.sh \| sudo bash -s -- --controller/)).toBeVisible();
    await page.locator('summary').filter({ hasText: /^Command history$/ }).click();
    await expect(page.getByText('Published · Desired configuration r1', { exact: false })).toBeVisible();
    await expect(page.getByText(/Event 1 · Operation/)).toBeVisible();
    await expect(page.locator('time')).not.toContainText('UTC UTC');
    await page.getByRole('button', { name: 'View raw config' }).click();
    await expect(page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Command history$/ }) }).locator('pre')).toHaveText('{"schemaVersion":1,"pollIntervalSeconds":30}');
    const snapshot = await page.request.get(`/api/operator/nodes/${nodeId}/command-history/config?operationId=${operationId}`);
    expect((await snapshot.json()).rawConfig).toBe('{"schemaVersion":1,"pollIntervalSeconds":30}');
    expect((await page.request.get(`/api/operator/nodes/${nodeId}/command-history`)).status()).toBe(200);

    await page.locator('summary').filter({ hasText: /^Configuration sources$/ }).click();
    await page.getByRole('button', { name: 'Collect current state' }).click();
    await expect(page.getByText('Waiting for the device agent…')).toBeVisible();
    await expect(page.getByText(/^Request ID: [0-9a-f-]{36}$/i)).toBeVisible();
    await database(async (pool) => {
      const report = {
        stateDirectory: '/var/lib/packetmotion', revision: 3, wireguardEnabled: true,
        files: [{ name: 'Applied plan', path: '/var/lib/packetmotion/network-applied.json', present: true }],
        appliedPlan: { tunnels: [] }, interfaces: [], unplannedOwnedInterfaces: [],
      };
      await pool.query(
        "UPDATE device_state_reports SET status='completed',completed_at=now(),report=$2 WHERE node_id=$1",
        [nodeId, JSON.stringify(report)],
      );
    });
    await expect(page.getByRole('region', { name: 'Device-reported current state' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('/var/lib/packetmotion/network-applied.json', { exact: true })).toBeVisible();
    expect((await page.request.get(`/api/operator/nodes/${nodeId}/device-state`)).status()).toBe(200);

    await page.getByRole('button', { name: 'Collect current state' }).click();
    await expect(page.getByText('Waiting for the device agent…')).toBeVisible();
    await database(async (pool) => {
      await pool.query("UPDATE device_state_reports SET status='unavailable',unavailable_reason='timeout',completed_at=now(),report=NULL WHERE node_id=$1", [nodeId]);
    });
    await expect(page.getByText(/request expired without a report/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Collect current state' }).click();
    await expect(page.getByText('Waiting for the device agent…')).toBeVisible();
    await database(async (pool) => {
      await pool.query("UPDATE device_state_reports SET status='unavailable',unavailable_reason='collection_failed',completed_at=now(),report=NULL WHERE node_id=$1", [nodeId]);
    });
    await expect(page.getByText(/agent could not collect its current state/i)).toBeVisible({ timeout: 10_000 });

    await database(async (pool) => {
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
    });
    expect((await page.request.get(`/api/operator/nodes/${nodeId}/command-history`)).status()).toBe(403);
    expect((await page.request.get(`/api/operator/nodes/${nodeId}/command-history/config?operationId=${operationId}`)).status()).toBe(403);
    expect((await page.request.get(`/api/operator/nodes/${nodeId}/device-state`)).status()).toBe(403);
    expect((await page.request.post(`/api/operator/nodes/${nodeId}/device-state`, {
      headers: { Origin: 'http://127.0.0.1:3107', 'Content-Type': 'application/json' }, data: {},
    })).status()).toBe(403);
    await page.reload();
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
    await expect(page.locator('summary').filter({ hasText: /^(Command history|Configuration sources|Agent upgrade)$/ })).toHaveCount(0);
  } finally {
    await database(async (pool) => {
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
    });
  }
});

test('device network preview adds firewall rules in an accessible modal without persisting them', async ({
  page,
}, info) => {
  const target = await database(async (pool) => {
    const site = (
      await pool.query(
        "INSERT INTO sites(id,name,mode) VALUES(gen_random_uuid(),'Modal network','gateway') RETURNING id",
      )
    ).rows[0].id;
    return (
      await pool.query(
        "INSERT INTO nodes(id,site_id,name,kind) VALUES(gen_random_uuid(),$1,'Modal edge','branch') RETURNING id",
        [site],
      )
    ).rows[0].id;
  });
  await login(page);
  await page.goto(`/dashboard/devices/${target}`);
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Network configuration preview$/ }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  const dialog = page.getByRole('dialog', { name: 'Firewall rule' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: `/tmp/packetmotion-ui-modal-${info.project.name}.png`, fullPage: true });
  // The shared Modal focuses its first control: the header close button.
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Rule name')).toBeFocused();
  await dialog.getByLabel('Rule name').fill('Allow ERP');
  await dialog.getByLabel('Action').selectOption({ label: 'Allow' });
  await dialog.getByLabel('Source network').fill('10.61.0.0/24');
  await dialog.getByLabel('Destination network').fill('10.62.0.0/24');
  await dialog.getByLabel('Protocol and port').fill('TCP 443');
  await dialog.getByRole('button', { name: 'Add to preview' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Allow ERP', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Network configuration preview$/ }).click();
  await expect(page.getByText('Allow ERP', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Block unsolicited inbound', { exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toHaveCount(0);
  await expect(page.getByText('No devices match “fail”', { exact: true })).toBeVisible();
});

test('connection check explains reused appliance enrollment and refreshes lifecycle evidence', async ({ page }, info) => {
  const origin = 'http://127.0.0.1:3107';
  // Reuse the signed operator-session fixture used by other feature tests;
  // login-form behavior is covered separately.
  const operator = await database(async pool => (await pool.query('SELECT email,password_hash FROM operators WHERE email=$1', [process.env.FABRIC_TEST_EMAIL])).rows[0]);
  const credentialVersion = createHash('sha256').update(operator.password_hash).digest('hex');
  const session = signSession(operator.email, process.env.CONTROLLER_SESSION_SECRET!, Date.now(), credentialVersion);
  await page.context().addCookies([{ name: 'sdwan-session', value: session, url: origin }]);
  const response = await page.request.post('/api/operator/nodes', {
    headers: { Origin: origin }, data: { name: 'Reused Debian edge', kind: 'branch', mode: 'gateway' },
  });
  expect(response.status()).toBe(201);
  const created = await response.json();
  const id = created.node.id;
  expect(created.enrollment.nodeId).toBe(id);
  await page.goto(`/dashboard/devices/${id}`);
  const check = page.getByRole('region', { name: 'Connection check' });
  await expect(check.getByText('The controller has not accepted enrollment for this device.')).toBeVisible();
  await expect(check.getByText(/Archiving an entry leaves its local identity on disk/)).toBeVisible();
  await page.getByRole('button', { name: 'Enroll device', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Device enrollment' }).getByText(new RegExp(`--expected-node-id ${id}`))).toBeVisible();
  const commands = page.getByRole('region', { name: 'Device enrollment' }).locator('pre');
  await expect(commands).toBeVisible();
  expect(await commands.innerText()).toContain('ExecMainStatus;\nsudo journalctl');
  await expect(commands).toHaveCSS('white-space', 'pre-wrap');
  await commands.screenshot({ path: info.outputPath('troubleshooting-commands.png') });
  const enrollmentRegion = page.getByRole('region', { name: 'Device enrollment' });
  await expect(enrollmentRegion.getByText(/installer offers a confirmed reset/)).toBeVisible();
  await enrollmentRegion.locator('code').evaluateAll(elements => elements.forEach(element => { element.style.visibility = 'hidden'; }));
  await enrollmentRegion.screenshot({ path: info.outputPath('replacement-enrollment.png') });
  await enrollmentRegion.locator('code').evaluateAll(elements => elements.forEach(element => { element.style.visibility = ''; }));
  await page.getByRole('button', { name: 'Hide token', exact: true }).click();
  await database(async pool => { await pool.query("UPDATE enrollment_tokens SET expires_at=now()-interval '1 minute' WHERE node_id=$1", [id]); });
  await check.getByRole('button', { name: 'Refresh connection status' }).click();
  await expect(check.getByText('Enrollment token expired before enrollment was accepted.')).toBeVisible();
  await check.getByText('Recent connection events', { exact: true }).click();
  await expect(check.getByText(/Enrollment token issued/).first()).toBeVisible();
  await check.getByText('Check the Debian agent', { exact: true }).click();
  await expect(check.getByText(/sudo journalctl -u fabric-agent/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('connection-status.png'), fullPage: true });

  await database(async pool => { await pool.query('UPDATE nodes SET enrolled_at=now() WHERE id=$1', [id]); });
  await check.getByRole('button', { name: 'Refresh connection status' }).click();
  await expect(check.getByText('Enrollment was accepted, but no management heartbeat has arrived.')).toBeVisible();
  await page.route(`**/api/operator/nodes/${id}/connection-status`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Connection status temporarily unavailable.' }) }));
  await check.getByRole('button', { name: 'Refresh connection status' }).click();
  await expect(check.getByRole('alert')).toHaveText('Connection status temporarily unavailable.');
  await page.unroute(`**/api/operator/nodes/${id}/connection-status`);
  await check.getByRole('button', { name: 'Refresh connection status' }).click();
  await expect(check.getByRole('alert')).toHaveCount(0);
  await database(async pool => { await pool.query("UPDATE operators SET role='viewer' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]); });
  try {
    expect((await page.request.get(`/api/operator/nodes/${id}/connection-status`)).status()).toBe(200);
  } finally {
    await database(async pool => { await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]); });
  }
  await page.context().clearCookies();
  expect((await page.request.get(`/api/operator/nodes/${id}/connection-status`)).status()).toBe(401);
});
