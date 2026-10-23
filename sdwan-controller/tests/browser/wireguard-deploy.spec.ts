import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { clearInventory, database, login } from './fixture';

test.beforeEach(clearInventory);
test('WireGuard draft persists without publication, Deploy publishes both peers and exposes actionable status', async ({ page }, info) => {
  test.setTimeout(60_000);
  await login(page);
  const headers = { Origin: 'http://127.0.0.1:3107' };
  const create = async (name: string, kind: string) => {
    const response = await page.request.post('/api/operator/nodes', { headers, data: { name, kind, mode: 'gateway' } });
    expect(response.ok()).toBe(true);
    return (await response.json()).node.id as string;
  };
  const hub = await create('Deploy Hub', 'hub');
  const edge = await create('Deploy Edge', 'branch');
  await database(async pool => {
    await pool.query("INSERT INTO wireguard_settings(singleton,pool,version) VALUES(TRUE,'10.247.0.0/24',1) ON CONFLICT(singleton) DO NOTHING");
    for (const id of [hub, edge]) await pool.query('INSERT INTO wireguard_devices(node_id,public_key) VALUES($1,$2)', [id, randomBytes(32).toString('base64')]);
  });
  expect((await page.request.put(`/api/operator/nodes/${hub}/wireguard`, { headers, data: { expectedVersion: 0, endpoint: '192.168.160.142', basePort: 22000 } })).ok()).toBe(true);
  await page.goto(`/dashboard/devices/${edge}`);
  await page.getByRole('tab', { name: 'Overlay', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save draft', exact: true });
  const deploy = page.getByRole('button', { name: 'Deploy changes', exact: true });
  await expect(save).toBeDisabled(); await expect(deploy).toBeDisabled();
  await page.getByRole('checkbox', { name: /Deploy Hub/ }).check();
  await expect(save).toBeEnabled(); await expect(deploy).toBeDisabled();
  await save.click();
  await expect(page.getByText('Unpublished draft — not sent to agents')).toBeVisible();
  await expect(deploy).toBeEnabled();
  const revision = async (id: string) => database(async pool => (await pool.query('SELECT max(revision) AS revision FROM desired_configs WHERE node_id=$1', [id])).rows[0].revision);
  expect(await revision(edge)).toBe(1); expect(await revision(hub)).toBe(2);
  await page.reload();
  await page.getByRole('tab', { name: 'Overlay', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Deploy Hub/ })).toBeChecked();
  await expect(deploy).toBeEnabled();
  await page.screenshot({ path: `/tmp/packetmotion-deploy-draft-${info.project.name}.png`, fullPage: true });
  await deploy.click();
  await expect(page.getByText('Configuration published to the affected devices.', { exact: false })).toBeVisible();
  await expect(deploy).toBeDisabled();
  expect(await revision(edge)).toBe(2); expect(await revision(hub)).toBe(3);
  const status = page.getByRole('region', { name: 'Deployment status' });
  await expect(status.getByRole('link', { name: 'Deploy Hub', exact: true })).toBeVisible();
  await database(async pool => {
    for (const id of [edge, hub]) {
      const desired = (await pool.query('SELECT * FROM desired_configs WHERE node_id=$1 ORDER BY revision DESC LIMIT 1', [id])).rows[0];
      await pool.query('UPDATE nodes SET last_seen_at=now(),enrolled_at=now() WHERE id=$1', [id]);
      await pool.query("INSERT INTO config_acknowledgements(node_id,revision,status) VALUES($1,$2,'received')", [id, desired.revision]);
      await pool.query("INSERT INTO wireguard_observed(node_id,revision,checksum,status,handshakes) VALUES($1,$2,$3,'disabled','[]')", [id, desired.revision, desired.checksum]);
    }
  });
  await page.getByRole('button', { name: 'Reload configuration', exact: true }).click();
  await expect(status.getByText('Local activation required', { exact: true })).toHaveCount(2);
  await expect(deploy).toBeDisabled();
  await status.getByText('Enable WireGuard locally', { exact: true }).click();
  await expect(status.getByText(/sudo fabric-agent network enable/, { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: `/tmp/packetmotion-deploy-disabled-${info.project.name}.png`, fullPage: true });
  await database(async pool => {
    for (const id of [edge, hub]) {
      const plan = JSON.parse((await pool.query('SELECT payload FROM desired_configs WHERE node_id=$1 ORDER BY revision DESC LIMIT 1', [id])).rows[0].payload);
      await pool.query("UPDATE wireguard_observed SET status='applied',handshakes=$2,received_at=now() WHERE node_id=$1", [id, JSON.stringify(plan.wireguard.tunnels.map((t: { name: string }) => ({ name: t.name, lastHandshake: Math.floor(Date.now() / 1000) }))) ]);
    }
  });
  await page.getByRole('button', { name: 'Reload configuration', exact: true }).click();
  await expect(page.getByText('Published configuration is up to date', { exact: true })).toBeVisible();
  await expect(status.getByText('Applied; recent handshake observed', { exact: true })).toHaveCount(2);
  await expect(status.getByText('Enable WireGuard locally', { exact: true })).toHaveCount(0);
  await expect(status.getByText(/sudo fabric-agent network enable/)).toHaveCount(0);
  await expect(deploy).toBeDisabled();
  await page.screenshot({ path: `/tmp/packetmotion-deploy-synced-${info.project.name}.png`, fullPage: true });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { (window as unknown as { deploymentCopy: string }).deploymentCopy = text; },
    } });
  });
  await status.getByRole('button', { name: 'Copy deployment report', exact: true }).click();
  await expect(status.getByText('Deployment report copied.', { exact: true })).toBeVisible();
  const report = JSON.parse(await page.evaluate(() => (window as unknown as { deploymentCopy: string }).deploymentCopy));
  expect(report.devices).toHaveLength(2);
  expect(report.reportType).toBe('controller-observed-wireguard-deployment');
  expect(Object.keys(report.devices[0]).some(key => /private|token|cookie|password/i.test(key))).toBe(false);

  await database(pool => pool.query("UPDATE operators SET role='viewer' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]));
  try {
    await page.reload(); await page.getByRole('tab', { name: 'Overlay', exact: true }).click();
    await expect(save).toHaveCount(0); await expect(deploy).toHaveCount(0);
    expect((await page.request.post(`/api/operator/nodes/${edge}/wireguard/deploy`, { headers, data: { expectedVersion: 1, expectedDraftVersion: 2 } })).status()).toBe(403);
  } finally { await database(pool => pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL])); }
});
