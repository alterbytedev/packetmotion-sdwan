import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;

function readEnv(name) {
  let contents;
  try {
    contents = readFileSync('.env.local', 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  const line = contents.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  if (!line) return undefined;
  const raw = line.slice(name.length + 1).trim();
  if (raw.startsWith('"')) return JSON.parse(raw);
  if (raw.startsWith("'")) return raw.slice(1, raw.lastIndexOf("'"));
  return raw;
}

const connectionString = readEnv('DATABASE_URL') || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required in .env.local or the process environment.');
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operators (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      attempt_key TEXT PRIMARY KEY,
      window_started_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL CHECK (attempts > 0)
    )
  `);
  console.log('Authentication schema is up to date.');
} finally {
  await pool.end();
}
