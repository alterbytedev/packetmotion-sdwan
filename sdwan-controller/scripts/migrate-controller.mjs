import { createRequire } from 'node:module';
import pg from 'pg';
import { migrateController } from './lib/migrations.mjs';

createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Run migrate:auth before migrate:controller.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
try {
  await migrateController(pool);
  console.log('Controller schema is up to date; operator credentials were preserved.');
} finally { await pool.end(); }
