import 'server-only';
import { getDatabase } from './db';

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 10;

export async function consumeLoginAttempt(key: string): Promise<boolean> {
  const database = getDatabase();
  await database.query('DELETE FROM login_attempts WHERE window_started_at < date_trunc(\'minute\', now()) - interval \'1 minute\'');
  const result = await database.query<{ allowed: boolean }>(
    `INSERT INTO login_attempts (attempt_key, window_started_at, attempts)
     VALUES ($1, date_trunc('minute', now()), 1)
     ON CONFLICT (attempt_key) DO UPDATE SET
       attempts = CASE
         WHEN login_attempts.window_started_at < date_trunc('minute', now())
           THEN 1
         ELSE login_attempts.attempts + 1
       END,
       window_started_at = date_trunc('minute', now())
     RETURNING attempts <= $2 AS allowed`,
    [key, MAX_ATTEMPTS],
  );
  return result.rows[0]?.allowed === true;
}

export async function clearLoginAttempts(key: string): Promise<void> {
  await getDatabase().query('DELETE FROM login_attempts WHERE attempt_key = $1', [key]);
}

export const LOGIN_ATTEMPT_WINDOW_SECONDS = WINDOW_SECONDS;
