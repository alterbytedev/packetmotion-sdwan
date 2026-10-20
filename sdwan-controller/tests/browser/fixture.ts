import pg from 'pg';
import { expect, type Page } from '@playwright/test';

export async function database<T>(operation: (pool: pg.Pool) => Promise<T>): Promise<T> {
  if (
    process.env.FABRIC_TEST_ISOLATED !== '1' ||
    !new URL(process.env.DATABASE_URL!).pathname.startsWith('/fabric_test_')
  )
    throw new Error('Browser database operations require an isolated test database.');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return await operation(pool);
  } finally {
    await pool.end();
  }
}

export async function clearInventory() {
  await database(async (pool) => {
    await pool.query(
      'DELETE FROM device_state_reports; DELETE FROM wireguard_observed; DELETE FROM device_command_history; DELETE FROM runtime_errors; DELETE FROM config_acknowledgements; DELETE FROM desired_configs; DELETE FROM device_telemetry; DELETE FROM device_certificates; DELETE FROM enrollment_tokens; DELETE FROM audit_events; DELETE FROM nodes; DELETE FROM sites',
    );
  });
}

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(process.env.FABRIC_TEST_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.FABRIC_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in to controller', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}
