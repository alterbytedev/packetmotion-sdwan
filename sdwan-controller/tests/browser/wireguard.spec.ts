import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { database, login, clearInventory } from './fixture';

test('save tunnel pool, hub endpoint and multiple selected hubs; viewers cannot mutate', async ({ page }, testInfo) => {
  await clearInventory();
  await login(page);
  await database(pool => pool.query("UPDATE operators SET role='superadmin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]));
  try {
    await page.goto('/dashboard/settings');
    await page.getByLabel('Tunnel IPv4 pool').fill('10.250.0.0/24');
    await page.getByRole('button', { name: 'Save tunnel pool' }).click();
    await expect(page.getByText('Tunnel address pool saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Tunnel IPv4 pool')).toHaveValue('10.250.0.0/24');
    const create = async (name: string, kind: string) => {
      const response = await page.request.post('/api/operator/nodes', {
        headers: { Origin: 'http://127.0.0.1:3107' }, data: { name, kind, mode: 'gateway' },
      });
      expect(response.status()).toBe(201);
      return (await response.json()).node.id as string;
    };
    const hubs = [await create('WG Browser Hub A', 'hub'), await create('WG Browser Hub B', 'hub')];
    const edge = await create('WG Browser Edge', 'branch');
    await database(async pool => {
      for (const id of [...hubs, edge]) await pool.query('INSERT INTO wireguard_devices(node_id,public_key) VALUES($1,$2)', [id, randomBytes(32).toString('base64')]);
    });
    for (const [index, id] of hubs.entries()) {
      await page.goto(`/dashboard/devices/${id}`);
      await page.getByRole('tab', { name: 'Overlay', exact: true }).click();
      await page.getByLabel('Hub endpoint IPv4').fill(`192.168.99.${index + 1}`);
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Deploy changes', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Deploy changes', exact: true }).click();
      await expect(page.getByText('Configuration published to the affected devices.', { exact: false })).toBeVisible();
    }
    await page.goto(`/dashboard/devices/${edge}`);
    await page.getByRole('tab', { name: 'Overlay', exact: true }).click();
    await page.getByLabel('WG Browser Hub A', { exact: false }).check();
    await page.getByLabel('WG Browser Hub B', { exact: false }).check();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByRole('button', { name: 'Deploy changes', exact: true }).click();
    await expect(page.getByText('Allocated tunnel addresses')).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Overlay', exact: true }).click();
    await expect(page.getByLabel('WG Browser Hub A', { exact: false })).toBeChecked();
    await expect(page.getByLabel('WG Browser Hub B', { exact: false })).toBeChecked();
    await expect(page.getByText('Network apply: Not reported', { exact: false })).toBeVisible();
    // Capture actual desktop/mobile content for inspection without changing baselines.
    await page.screenshot({ path: testInfo.outputPath('wireguard-device.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await database(pool => pool.query("UPDATE operators SET role='viewer' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]));
    await page.reload();
    await page.getByRole('tab', { name: 'Overlay', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('WG Browser Hub A', { exact: false })).toBeDisabled();
    expect((await page.request.put(`/api/operator/nodes/${edge}/wireguard`, {
      headers: { Origin: 'http://127.0.0.1:3107' }, data: { expectedVersion: 1, hubIds: [] },
    })).status()).toBe(403);
  } finally {
    await database(pool => pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]));
    await clearInventory();
  }
});
