import 'server-only';
import { getDatabase } from '../db';
import { authorize, authorizeSuperadmin, FabricError } from './authorization';
import { mutate } from './inventory';
import type { Actor } from './types';

export function validateTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || value.trim() !== value || !value)
    throw new FabricError(400, 'Enter a valid IANA time zone, such as America/Los_Angeles.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new FabricError(400, 'Enter a valid IANA time zone, such as America/Los_Angeles.');
  }
  return value;
}

export async function getControllerTimeZone() {
  const result = await getDatabase().query('SELECT time_zone AS "timeZone" FROM controller_timezone WHERE singleton=TRUE');
  return result.rows[0]?.timeZone ?? 'UTC';
}

export async function readControllerTimeZone(actor: Actor | null) {
  authorize(actor);
  const result = await getDatabase().query(
    'SELECT time_zone AS "timeZone",version FROM controller_timezone WHERE singleton=TRUE',
  );
  return result.rows[0] ?? { timeZone: 'UTC', version: 1 };
}

export async function saveControllerTimeZone(actor: Actor | null, value: unknown) {
  authorizeSuperadmin(actor);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FabricError(400, 'Invalid time zone settings.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['timeZone', 'expectedVersion'].includes(key)) ||
      !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1)
    throw new FabricError(400, 'Invalid time zone settings.');
  const timeZone = validateTimeZone(input.timeZone);
  const expectedVersion = Number(input.expectedVersion);
  return mutate(actor, async (client, fresh) => {
    authorizeSuperadmin(fresh);
    const previous = await client.query(
      'SELECT time_zone AS "timeZone",version FROM controller_timezone WHERE singleton=TRUE FOR UPDATE',
    );
    const current = previous.rows[0];
    if (!current || current.version !== expectedVersion)
      throw new FabricError(409, 'Controller time zone changed; reload and retry.');
    if (current.timeZone !== timeZone) {
      await client.query(
        `UPDATE controller_timezone SET time_zone=$1,version=version+1,updated_by=$2,updated_at=now()
         WHERE singleton=TRUE`, [timeZone, fresh.id],
      );
      await client.query(
        `INSERT INTO audit_events(actor_id,actor_email,action,resource_id)
         VALUES($1,$2,'controller.timezone_updated','00000000-0000-0000-0000-000000000017')`,
        [fresh.id, fresh.email],
      );
    }
    return { timeZone, version: current.version + Number(current.timeZone !== timeZone) };
  });
}
