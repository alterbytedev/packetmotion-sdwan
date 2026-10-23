import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { clearInventory, database, login } from './fixture';

test.beforeEach(clearInventory);
test('current IPs, safe apply results and edit retry are available from interface rows', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await database(async (pool) => {
    await pool.query(
      `INSERT INTO routing_settings(singleton,protected_prefixes,version) VALUES(TRUE,ARRAY['192.168.160.0/24']::cidr[],1) ON CONFLICT(singleton) DO UPDATE SET protected_prefixes=excluded.protected_prefixes`,
    );
  });
  await login(page);
  const response = await page.request.post('/api/operator/nodes', {
    headers: { Origin: 'http://127.0.0.1:3107' },
    data: { name: 'Safe apply Hub', kind: 'hub', mode: 'gateway' },
  });
  expect(response.status()).toBe(201);
  const { node } = await response.json();
  const sample = {
    eventId: randomUUID(),
    agentVersion: '0.4.0',
    os: 'linux',
    arch: 'amd64',
    uptimeSeconds: 100,
    interfaces: [
      { name: 'ens33', up: true, mtu: 1500, addresses: ['192.168.160.142/24', 'fe80::1/64'] },
      { name: 'ens36', up: false, mtu: 1500, addresses: [] },
    ],
    interfaceApply: {
      nodeId: node.id,
      protocolVersion: 1,
      mode: 'dedicated-static',
      interfaces: ['ens36'],
      updatedAt: new Date().toISOString(),
    },
  };
  await database(async (pool) => {
    await pool.query(
      'INSERT INTO device_telemetry(node_id,event_id,snapshot,checksum) VALUES($1,$2,$3,$4)',
      [node.id, sample.eventId, JSON.stringify(sample), '0'.repeat(64)],
    );
  });
  await page.goto(`/dashboard/devices/${node.id}`);
  await page.getByRole('tab', { name: 'Underlay', exact: true }).click();
  await expect(page.getByText('192.168.160.142/24, fe80::1/64', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Configure ens33', exact: true }).click();
  await expect(page.getByLabel('IPv4 address / prefix', { exact: true })).toHaveValue(
    '192.168.160.142/24',
  );
  await expect(page.getByRole('button', { name: 'Save and apply', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Configure ens36', exact: true }).click();
  await page.getByLabel('IPv4 address / prefix', { exact: true }).fill('10.94.0.1/24');
  await page.getByRole('checkbox', { name: 'Enabled in candidate configuration' }).check();
  await expect(page.getByRole('button', { name: 'Save and apply', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save and apply', exact: true }).click();
  const history = page.getByRole('region', { name: 'Interface commit history' });
  await expect(history.getByText('Queued for agent', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      database(async (pool) =>
        Number(
          (
            await pool.query('SELECT count(*) FROM network_interface_commits WHERE node_id=$1', [
              node.id,
            ])
          ).rows[0].count,
        ),
      ),
    )
    .toBe(1);
  const first = await database(
    async (pool) =>
      (
        await pool.query('SELECT id,payload FROM network_interface_commits WHERE node_id=$1', [
          node.id,
        ])
      ).rows[0],
  );
  expect(JSON.parse(first.payload).safeCommitSeconds).toBe(60);
  // Synthetic result fixtures verify UI behavior, not physical appliance apply.
  await database(async (pool) => {
    await pool.query(
      "UPDATE network_interface_commits SET status='rolled_back',reason='controller_confirmation_timeout',sequence=3,reported_at=now() WHERE id=$1",
      [first.id],
    );
  });
  await expect(history.getByText('Rolled back', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(history.getByText('controller confirmation timeout', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'Edit and retry', exact: true }).click();
  await page.getByLabel('IPv4 address / prefix', { exact: true }).fill('10.94.1.1/24');
  await database(async (pool) => {
    await pool.query(
      "UPDATE device_telemetry SET snapshot=jsonb_set(snapshot,'{interfaceApply,updatedAt}',to_jsonb($2::text)) WHERE node_id=$1",
      [node.id, new Date().toISOString()],
    );
  });
  await page.getByRole('button', { name: 'Save and apply', exact: true }).click();
  await expect(history.getByText('Queued for agent', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      database(async (pool) =>
        Number(
          (
            await pool.query('SELECT count(*) FROM network_interface_commits WHERE node_id=$1', [
              node.id,
            ])
          ).rows[0].count,
        ),
      ),
    )
    .toBe(2);
  const second = await database(
    async (pool) =>
      (
        await pool.query(
          'SELECT id,payload FROM network_interface_commits WHERE node_id=$1 ORDER BY created_at DESC',
          [node.id],
        )
      ).rows[0],
  );
  expect(second.id).not.toBe(first.id);
  expect(JSON.parse(second.payload).interfaces[0].address).toBe('10.94.1.1/24');
  await database(async (pool) => {
    await pool.query(
      "UPDATE network_interface_commits SET status='applied',sequence=3,reported_at=now() WHERE id=$1",
      [second.id],
    );
    sample.interfaces[1].addresses = ['10.94.1.1/24'];
    sample.interfaces[1].up = true;
    sample.interfaceApply.updatedAt = new Date().toISOString();
    await pool.query('UPDATE device_telemetry SET snapshot=$2 WHERE node_id=$1', [
      node.id,
      JSON.stringify(sample),
    ]);
  });
  await expect(history.getByText('Applied', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `/tmp/packetmotion-interface-apply-${info.project.name}.png`,
    fullPage: false,
  });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('10.94.1.1/24', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `/tmp/packetmotion-interface-addresses-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
