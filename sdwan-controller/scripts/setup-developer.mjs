import { randomBytes, scryptSync } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const reset = process.argv.includes('--reset');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
try {
  const found = await pool.query('SELECT id FROM diagnostic_developer WHERE id = TRUE');
  if (found.rowCount && !reset) {
    throw new Error('Developer access already exists. Run npm run reset:developer to rotate its password.');
  }
  const password = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  await pool.query(
    `INSERT INTO diagnostic_developer (id,password_hash,updated_at)
     VALUES (TRUE,$1,now())
     ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash,updated_at=now()`,
    [passwordHash],
  );
  console.log(`Developer diagnostic access ${reset ? 'reset' : 'created'}.\nUsername: developer\nPassword: ${password}\nSave this password now; only its scrypt hash is stored.`);
} finally {
  await pool.end();
}
