import { createRequire } from 'node:module';
import pg from 'pg';

createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const referenceId = process.argv[2];
if (!referenceId || !/^[A-Za-z0-9._-]{1,128}$/.test(referenceId)) {
  throw new Error('Usage: npm run errors:show -- <reference-id>');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
});
try {
  const result = await pool.query(
    `SELECT reference_id, source, route_path, method, error_name, error_code, message, stack,
            first_seen_at, last_seen_at, occurrence_count
     FROM runtime_errors WHERE reference_id = $1`,
    [referenceId],
  );
  if (!result.rowCount) {
    console.error(
      'No runtime error found for that reference ID. Check the ID and database environment.',
    );
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result.rows[0], null, 2));
  }
} finally {
  await pool.end();
}
