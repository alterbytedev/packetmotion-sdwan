import 'server-only';
import { getDatabase } from './db';

export type Operator = { email: string; passwordHash: string };

export async function findOperator(email: string): Promise<Operator | null> {
  const result = await getDatabase().query<{ email: string; password_hash: string }>(
    'SELECT email, password_hash FROM operators WHERE email = $1',
    [email.toLowerCase()],
  );
  const row = result.rows[0];
  return row ? { email: row.email, passwordHash: row.password_hash } : null;
}
