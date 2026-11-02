import { expect, test } from '@playwright/test';
import { clearInventory, database, login } from './fixture';

test.beforeEach(clearInventory);
test('interface VLAN drafts save without deployment and viewers cannot edit them', async ({ page }, info) => {
  test.setTimeout(90_000);
  await database(async (pool) => {
    await pool.query(`INSERT INTO routing_settings(singleton,protected_prefixes,version) VALUES(TRUE,ARRAY['192.168.160.0/24']::cidr[],1)
      ON CONFLICT(singleton) DO UPDATE SET protected_prefixes=excluded.protected_prefixes`);
  });
  await login(page);
  const headers = { Origin: 'http://127.0.0.1:3107' };
  const response = await page.request.post('/api/operator/nodes', { headers, data: { name: 'Interface draft Hub', kind: 'hub', mode: 'gateway' } });
  expect(response.status()).toBe(201);
  const { node } = await response.json();
  await page.route(`**/api/operator/nodes/${node.id}/telemetry?*`, (route) => route.fulfill({ json: { telemetry: {
    receivedAt: new Date().toISOString(), snapshot: { agentVersion: '0.3.6', os: 'linux', arch: 'amd64', uptimeSeconds: 120,
      interfaces: [{ name: 'lo', up: true, mtu: 65536 }, { name: 'ens33', up: true, mtu: 1500 }, { name: 'ens36', up: false, mtu: 1500 }, { name: 'pm8617db064cf9', up: true, mtu: 1380 }] },
  } } }));
  await page.goto(`/dashboard/devices/${node.id}`);
  await page.getByRole('tab', { name: 'Network', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Interfaces', exact: true })).toBeVisible();
  await expect(page.getByText('WAN addressing is managed locally on the appliance.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Configure lo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Configure pm8617db064cf9', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Configure ens33', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Configure ens33' })).toBeVisible();
  await expect(page.getByLabel('Physical interface / parent', { exact: true })).toHaveValue('ens33');
  await expect(page.getByLabel('Physical interface / parent', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByLabel('Role', { exact: true }).selectOption('wan');
  await page.getByLabel('Addressing', { exact: true }).selectOption('dhcp');
  await page.getByRole('button', { name: 'Save interface draft', exact: true }).click();
  await expect(page.getByText('Interface draft saved. Appliance configuration has not changed.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Configure ens33', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'VLANs on ens36', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'VLANs on ens36' })).toBeVisible();
  await expect(page.getByLabel('Physical interface / parent', { exact: true })).toHaveValue('ens36');
  await page.getByLabel('VLAN tag', { exact: true }).fill('100');
  await page.getByLabel('IPv4 address / prefix', { exact: true }).fill('10.88.100.1/24');
  await page.getByLabel('Advertised subnet (optional)', { exact: true }).fill('10.88.100.0/24');
  await page.getByRole('button', { name: 'Save interface draft', exact: true }).click();
  await expect(page.getByText('Interface draft saved. Appliance configuration has not changed.', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Network', exact: true }).click();
  await page.getByRole('button', { name: 'VLANs on ens36', exact: true }).click();
  await expect(page.getByLabel('VLAN tag', { exact: true })).toHaveValue('100');
  await expect(page.getByLabel('IPv4 address / prefix', { exact: true })).toHaveValue('10.88.100.1/24');
  await expect(page.getByText(/Apply requires the updated Fabric agent/)).toBeVisible();
  expect((await page.request.get(`/api/operator/nodes/${node.id}/network-draft`)).status()).toBe(200);
  expect(await database(async (pool) => Number((await pool.query('SELECT max(revision) AS revision FROM desired_configs WHERE node_id=$1', [node.id])).rows[0].revision))).toBe(1);
  const persisted = (await (await page.request.get(`/api/operator/nodes/${node.id}/network-draft`)).json()).draft;
  expect(persisted.interfaces).toHaveLength(2);
  expect(persisted.interfaces.find((entry: { interfaceName: string }) => entry.interfaceName === 'ens33').mode).toBe('dhcp');
  await page.screenshot({ path: `/tmp/packetmotion-direct-interface-${info.project.name}.png`, fullPage: false });
  const dialogBounds = await page.getByRole('dialog', { name: 'VLANs on ens36' }).boundingBox();
  expect(dialogBounds?.y).toBeGreaterThanOrEqual(0);
  expect(dialogBounds?.x).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('VLAN tag', { exact: true }).fill('4095');
  await page.getByRole('button', { name: 'Save interface draft', exact: true }).click();
  expect(await page.getByLabel('VLAN tag', { exact: true }).evaluate((element: HTMLInputElement) => element.validity.rangeOverflow)).toBe(true);
  await database(async (pool) => { await pool.query("UPDATE operators SET role='viewer' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]); });
  try {
    await page.reload();
    await page.getByRole('tab', { name: 'Network', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Configure ens33', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'View settings for ens33', exact: true }).click();
    await expect(page.getByLabel('Physical interface / parent', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save interface draft', exact: true })).toHaveCount(0);
    const candidate = (await (await page.request.get(`/api/operator/nodes/${node.id}/network-draft`)).json()).draft;
    const denied = await page.request.put(`/api/operator/nodes/${node.id}/network-draft`, { headers, data: { expectedVersion: candidate.version, baseRevision: candidate.baseRevision, baseLanVersion: candidate.baseLanVersion, interfaces: candidate.interfaces, safeCommitSeconds: 60 } });
    expect(denied.status()).toBe(403);
  } finally {
    await database(async (pool) => { await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]); });
  }
});
