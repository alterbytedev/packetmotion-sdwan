import { expect, test } from '@playwright/test';
import { database, login, clearInventory } from './fixture';

test('protected networks and LAN profile persist; viewer cannot change intent', async ({ page }, info) => {
  await clearInventory(); await login(page);
  await database(pool => pool.query("UPDATE operators SET role='superadmin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]));
  try {
    await page.goto('/dashboard/settings');
    await page.getByLabel('Protected IPv4 networks').fill('192.168.160.0/24');
    await page.getByRole('button', { name: 'Save protected networks' }).click();
    await expect(page.getByText('Protected networks saved.')).toBeVisible();
    const created = await page.request.post('/api/operator/nodes', { headers: { Origin: 'http://127.0.0.1:3107' },
      data: { name: 'LAN Browser Edge', kind: 'branch', mode: 'gateway' } });
    expect(created.status()).toBe(201); const id = (await created.json()).node.id;
    await page.goto(`/dashboard/devices/${id}`);
    await page.getByLabel('LAN interface', { exact: true }).fill('ens34');
    await page.getByLabel('Appliance LAN address / prefix').fill('10.72.0.1/24');
    await page.getByLabel('Advertised LAN subnet', { exact: true }).fill('10.72.0.0/24');
    await page.getByRole('button', { name: 'Save LAN profile' }).click();
    await expect(page.getByText('LAN profile saved.', { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('LAN interface', { exact: true })).toHaveValue('ens34');
    await expect(page.getByLabel('Appliance LAN address / prefix')).toHaveValue('10.72.0.1/24');
    await page.screenshot({ path: info.outputPath('lan-profile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await database(async pool => {
      expect((await pool.query('SELECT max(revision) AS revision FROM desired_configs WHERE node_id=$1', [id])).rows[0].revision).toBe(1);
      await pool.query("UPDATE operators SET role='viewer' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
    });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Save LAN profile' })).toHaveCount(0);
    await expect(page.getByLabel('LAN interface', { exact: true })).toBeDisabled();
    expect((await page.request.put(`/api/operator/nodes/${id}/lan`, {
      headers: { Origin: 'http://127.0.0.1:3107' }, data: { expectedVersion: 1, interfaceName: 'ens34', address: '10.72.0.2/24', advertisedPrefix: '10.72.0.0/24' },
    })).status()).toBe(403);
  } finally {
    await database(pool => pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]));
    await clearInventory();
  }
});
