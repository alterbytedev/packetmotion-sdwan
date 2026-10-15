import 'server-only';
import { randomBytes, scryptSync } from 'node:crypto';
import { getDatabase } from '../db';
import { FabricError } from './authorization';
import type { Actor, OperatorRole } from './types';

export type ManagedOperator = { id: string; email: string; role: OperatorRole; createdAt: string };

export async function listOperators(): Promise<ManagedOperator[]> {
  const result = await getDatabase().query<ManagedOperator>(
    `SELECT id::text, email, role, created_at::text AS "createdAt"
     FROM operators ORDER BY created_at, id`,
  );
  return result.rows;
}

export async function createOperator(actor: Actor, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new FabricError(400, 'A JSON object is required.');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !['email', 'role'].includes(key)))
    throw new FabricError(400, 'Unknown operator field.');
  if (typeof data.email !== 'string' || data.email.length > 254)
    throw new FabricError(400, 'Enter a valid email address.');
  const email = data.email.trim().toLowerCase();
  if (!/^[^\s@]+@(?:localhost|[^\s@]+\.[^\s@]+)$/.test(email))
    throw new FabricError(400, 'Enter a valid email address.');

  const role: OperatorRole = data.role === undefined && actor.role === 'admin'
    ? 'viewer'
    : data.role as OperatorRole;
  if (actor.role === 'admin' && role !== 'viewer')
    throw new FabricError(403, 'Admins can create viewer accounts only.');
  if (actor.role !== 'superadmin' && actor.role !== 'admin')
    throw new FabricError(403, 'Operator administration access required.');
  if (!['admin', 'viewer'].includes(role))
    throw new FabricError(400, 'Choose admin or viewer access.');

  const password = randomBytes(18).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  try {
    const result = await getDatabase().query<{ id: string; email: string; role: OperatorRole }>(
      `INSERT INTO operators (email, password_hash, role)
       VALUES ($1, $2, $3) RETURNING id::text, email, role`,
      [email, passwordHash, role],
    );
    return { operator: result.rows[0], password };
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new FabricError(409, 'An operator with that email already exists.');
    throw error;
  }
}
