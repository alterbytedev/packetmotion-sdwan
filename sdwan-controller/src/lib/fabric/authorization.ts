import 'server-only';
import { getUser } from '../auth';
import { getDatabase } from '../db';
import type { Actor } from './types';

export class FabricError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function currentActor(): Promise<Actor | null> {
  const email = await getUser();
  if (!email) return null;
  const result = await getDatabase().query<Actor>(
    'SELECT id::text, email, role FROM operators WHERE email = $1',
    [email],
  );
  return result.rows[0] ?? null;
}

export function authorize(actor: Actor | null, mutation = false): asserts actor is Actor {
  if (!actor) throw new FabricError(401, 'Sign in to access inventory.');
  if (actor.role !== 'admin' && actor.role !== 'viewer')
    throw new FabricError(403, 'Operator access denied.');
  if (mutation && actor.role !== 'admin')
    throw new FabricError(403, 'Administrator access required.');
}
