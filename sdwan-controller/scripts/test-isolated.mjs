import { randomBytes, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import pg from 'pg';
import { migrateController } from './lib/migrations.mjs';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd());
const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL (or local DATABASE_URL) is required; the account must be able to create an isolated test database.');
const { Pool } = pg;
const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
const name = `fabric_test_${randomBytes(8).toString('hex')}`;
const url = new URL(connectionString);
url.pathname = `/${name}`;
const secret = randomBytes(32).toString('hex');
const password = randomBytes(18).toString('base64url');
const childEnv = { ...process.env, DATABASE_URL: url.toString(), CONTROLLER_SESSION_SECRET: secret,
  CONTROLLER_PUBLIC_ORIGIN: 'http://127.0.0.1:3107', FABRIC_TEST_ISOLATED: '1', FABRIC_TEST_EMAIL: 'integration@example.test', FABRIC_TEST_PASSWORD: password };
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: childEnv, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} failed with exit ${code}`)));
  });
}
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  try {
    await pool.query(`CREATE TABLE operators (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    ); CREATE TABLE login_attempts (attempt_key TEXT PRIMARY KEY, window_started_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL CHECK (attempts > 0))`);
    const salt = randomBytes(16).toString('hex');
    await pool.query('INSERT INTO operators (email,password_hash) VALUES ($1,$2)', [childEnv.FABRIC_TEST_EMAIL, `${salt}:${scryptSync(password, salt, 64).toString('hex')}`]);
    await migrateController(pool);
  } finally { await pool.end(); }
  if (process.argv[2] === 'agent') {
    await run(process.execPath,['scripts/agent-smoke.mjs']);
  } else if (process.argv[2] === 'browser' || process.argv[2] === 'baseline') {
    await run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...(process.argv[2] === 'baseline' ? ['baseline'] : []), ...process.argv.slice(3)]);
  } else {
    const { readdirSync } = await import('node:fs');
    const files = readdirSync('tests/integration').filter((file) => file.endsWith('.test.mjs')).map((file) => `tests/integration/${file}`);
    await run(process.execPath, ['--test', '--test-concurrency=1', ...files]);
  }
  console.log('Isolated test run passed.');
} finally {
  if (created) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
    await admin.query(`DROP DATABASE "${name}"`);
    console.log('Isolated test database removed.');
  }
  await admin.end();
}
