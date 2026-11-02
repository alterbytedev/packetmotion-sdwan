import { expect, test } from '@playwright/test';
import { database, login, clearInventory } from './fixture';

test('superadmin configures and persists a lab HTTP host allowlist', async ({ page }) => {
  await login(page);
  await database(async (pool) => {
    await pool.query("UPDATE operators SET role='superadmin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
  });
  try {
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Insecure HTTP lab controllers' })).toBeVisible();
    await page.getByLabel('Allowed private IP addresses').fill('192.168.160.200');
    await page.getByRole('button', { name: 'Save allowlist', exact: true }).click();
    await expect(page.getByText(/Allowed controller addresses saved/)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Allowed private IP addresses')).toHaveValue('192.168.160.200');
  } finally {
    await database(async (pool) => {
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
      await pool.query('DELETE FROM controller_insecure_http_hosts');
      await pool.query("DELETE FROM audit_events WHERE action='controller.insecure_http_hosts_updated' AND actor_email=$1", [process.env.FABRIC_TEST_EMAIL]);
    });
  }
});

test('admin cannot view or change the lab HTTP host allowlist', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'Insecure HTTP lab controllers' })).toHaveCount(0);
  expect((await page.request.get('/api/operator/controller-settings/insecure-http-hosts')).status()).toBe(403);
  expect((await page.request.put('/api/operator/controller-settings/insecure-http-hosts', {
    headers: { Origin: 'http://127.0.0.1:3107', 'Content-Type': 'application/json' },
    data: { hosts: ['192.168.160.200'] },
  })).status()).toBe(403);
});

test('superadmin changes the controller time zone and admins cannot change it', async ({ page }) => {
  await login(page);
  await database(async (pool) => {
    await pool.query("UPDATE operators SET role='superadmin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
  });
  try {
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Controller time zone' })).toBeVisible();
    await page.getByLabel('IANA time zone').fill('Asia/Jakarta');
    await page.getByRole('button', { name: 'Save time zone', exact: true }).click();
    await expect(page.getByText('Controller time zone saved.')).toBeVisible();
    expect((await (await page.request.get('/api/operator/controller-settings/time-zone')).json()).timeZone).toBe('Asia/Jakarta');
    await page.reload();
    await expect(page.getByLabel('IANA time zone')).toHaveValue('Asia/Jakarta');

    await database(async (pool) => {
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Controller time zone' })).toHaveCount(0);
    expect((await page.request.put('/api/operator/controller-settings/time-zone', {
      headers: { Origin: 'http://127.0.0.1:3107', 'Content-Type': 'application/json' },
      data: { timeZone: 'UTC', expectedVersion: 2 },
    })).status()).toBe(403);
  } finally {
    await database(async (pool) => {
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
      await pool.query("UPDATE controller_timezone SET time_zone='UTC',version=version+1 WHERE singleton=TRUE");
      await pool.query("DELETE FROM audit_events WHERE action='controller.timezone_updated' AND actor_email=$1", [process.env.FABRIC_TEST_EMAIL]);
    });
  }
});

test('superadmin drafts and deploys a transit rule; admins cannot see the policy', async ({ page }, info) => {
  await clearInventory(); await login(page);
  await database(pool => pool.query("UPDATE operators SET role='superadmin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]));
  try {
    await page.goto('/dashboard/settings');
    await page.getByLabel('Protected IPv4 networks').fill('192.168.160.0/24');
    await page.getByRole('button', { name: 'Save protected networks' }).click();
    await expect(page.getByText('Protected networks saved.')).toBeVisible();
    for (const [index, name] of [[73, 'Transit Browser A'], [74, 'Transit Browser B']] as const) {
      const created = await page.request.post('/api/operator/nodes', { headers: { Origin: 'http://127.0.0.1:3107' },
        data: { name, kind: 'branch', mode: 'gateway' } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).node.id;
      const saved = await page.request.put(`/api/operator/nodes/${id}/lan`, { headers: { Origin: 'http://127.0.0.1:3107' },
        data: { expectedVersion: 0, interfaceName: 'ens34', address: `10.${index}.0.1/24`, advertisedPrefix: `10.${index}.0.0/24` } });
      expect(saved.status()).toBeLessThan(300);
    }
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Transit policy' })).toBeVisible();
    await expect(page.getByText('No rules. All tunnel transit is blocked.')).toBeVisible();
    await page.getByRole('button', { name: 'Allow any/any between all LANs' }).click();
    await expect(page.getByLabel('Rule 2 source')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deploy policy' })).toBeDisabled();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved. Deploy to publish.')).toBeVisible();
    await page.getByRole('button', { name: 'Deploy policy' }).click();
    await expect(page.getByText('Transit policy deployed.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Rule 2 source')).toBeVisible();
    await expect(page.getByText('Deployed: 2 rule(s)', { exact: false })).toBeVisible();
    await page.screenshot({ path: info.outputPath('transit-policy.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await database(pool => pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]));
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Transit policy' })).toHaveCount(0);
    expect((await page.request.get('/api/operator/controller-settings/transit')).status()).toBe(200);
    expect((await page.request.put('/api/operator/controller-settings/transit', {
      headers: { Origin: 'http://127.0.0.1:3107', 'Content-Type': 'application/json' },
      data: { expectedVersion: 1, rules: [] },
    })).status()).toBe(403);
  } finally {
    await database(async (pool) => {
      await pool.query("UPDATE operators SET role='admin' WHERE email=$1", [process.env.FABRIC_TEST_EMAIL]);
      await pool.query("UPDATE transit_policy SET rules='[]',draft_rules=NULL");
      await pool.query("DELETE FROM audit_events WHERE action LIKE 'transit.%' AND actor_email=$1", [process.env.FABRIC_TEST_EMAIL]);
    });
  }
});
