import { randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;
// npm may consume CLI flags itself and expose them as npm_config_* variables.
const override =
  process.argv.includes('--override') ||
  process.env.npm_config_override === 'true' ||
  process.env.npm_config_overide === 'true';
const initialRole = process.argv[2] === 'superadmin' ? 'superadmin' : 'admin';
const envPath = '.env.local';
let contents = '';
try {
  contents = readFileSync(envPath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function readEnv(name) {
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

const email = (process.env.CONTROLLER_ADMIN_EMAIL || readEnv('CONTROLLER_ADMIN_EMAIL') || 'admin@admin.local')
  .trim()
  .toLowerCase();
if (!/^[^\s@]+@(?:localhost|[^\s@]+\.[^\s@]+)$/.test(email)) {
  console.error('CONTROLLER_ADMIN_EMAIL must be a valid email address (localhost is supported for development).');
  process.exit(1);
}
const configuredSecret = readEnv('CONTROLLER_SESSION_SECRET');
const secret = !override && configuredSecret && !/^<.*>$/.test(configuredSecret)
  ? configuredSecret
  : randomBytes(32).toString('hex');
if (secret.length < 32) {
  console.error('CONTROLLER_SESSION_SECRET must contain at least 32 characters.');
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

  const existing = await pool.query('SELECT email FROM operators ORDER BY id LIMIT 1');
  if (existing.rowCount && !override) {
    console.error(`An operator already exists. Use npm run init:${initialRole} --override only if you intend to replace all operator credentials.`);
    process.exitCode = 1;
  } else {
    const password = randomBytes(18).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
    await pool.query('BEGIN');
    try {
      if (existing.rowCount) {
        await pool.query('DELETE FROM operators');
      }
      await pool.query(
        'INSERT INTO operators (email, password_hash, role) VALUES ($1, $2, $3)',
        [email, passwordHash, initialRole],
      );
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

    const retained = contents
      .split(/\r?\n/)
      .filter((line) => !/^CONTROLLER_(?:ADMIN_|SESSION_SECRET)/.test(line))
      .join('\n')
      .trimEnd();
    const updated = `${retained}${retained ? '\n\n' : ''}CONTROLLER_SESSION_SECRET=${JSON.stringify(secret)}\n`;
    writeFileSync(envPath, updated, { mode: 0o600 });
    chmodSync(envPath, 0o600);
    console.log(`${initialRole} operator ${existing.rowCount ? 'updated' : 'created'}. Email: ${email}\nPassword: ${password}\nSave this password; only its scrypt hash is stored in PostgreSQL.`);
  }
} finally {
  await pool.end();
}
