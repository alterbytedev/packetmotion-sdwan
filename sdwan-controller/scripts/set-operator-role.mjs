import pg from 'pg';
import { createRequire } from 'node:module';
import { isOperatorEmail, OPERATOR_ROLES } from './lib/operator-role.mjs';

createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const [, , emailArg, roleArg] = process.argv;
const email = emailArg?.trim().toLowerCase();
const role = roleArg;
if (!email || !isOperatorEmail(email) || !OPERATOR_ROLES.includes(role)) {
  console.error('Usage: npm run set:operator-role -- <email> <superadmin|admin|viewer>');
  process.exit(2);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
try {
  const result = await pool.query('UPDATE operators SET role = $2 WHERE lower(email) = $1 RETURNING email', [email, role]);
  if (!result.rowCount) {
    console.error('No operator exists with that email. Create the operator first.');
    process.exitCode = 1;
  } else {
    console.log(`Updated ${result.rows[0].email} to ${role}. Existing sessions remain valid.`);
  }
} finally {
  await pool.end();
}
