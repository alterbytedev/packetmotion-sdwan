import 'server-only';
import { createHash } from 'node:crypto';
import { getDatabase } from '../db';
import { FabricError, authorize } from './authorization';
import type { Actor } from './types';

export async function recordHeartbeat(nodeId: string, value: unknown) {
  const input = value as {
    eventId?: unknown;
    agentVersion?: unknown;
    os?: unknown;
    arch?: unknown;
    uptimeSeconds?: unknown;
    interfaces?: unknown;
  };
  if (
    !input ||
    Object.keys(input).some(
      (key) =>
        !['eventId', 'agentVersion', 'os', 'arch', 'uptimeSeconds', 'interfaces'].includes(key),
    ) ||
    typeof input.eventId !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.eventId) ||
    !Number.isSafeInteger(input.uptimeSeconds) ||
    Number(input.uptimeSeconds) < 0 ||
    ['agentVersion', 'os', 'arch'].some(
      (key) =>
        typeof input[key as keyof typeof input] !== 'string' ||
        String(input[key as keyof typeof input]).length > 64,
    ) ||
    !Array.isArray(input.interfaces) ||
    input.interfaces.length > 64
  )
    throw new FabricError(400, 'Invalid heartbeat.');
  for (const entry of input.interfaces) {
    if (
      !entry ||
      typeof entry.name !== 'string' ||
      entry.name.length > 64 ||
      typeof entry.up !== 'boolean' ||
      !Number.isInteger(entry.mtu) ||
      entry.mtu < 0 ||
      entry.mtu > 1000000 ||
      Object.keys(entry).some((key) => !['name', 'up', 'mtu'].includes(key))
    )
      throw new FabricError(400, 'Invalid interface telemetry.');
  }
  const serialized = JSON.stringify(input);
  const checksum = createHash('sha256').update(serialized).digest('hex');
  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');
    const active = await client.query(
      'SELECT id FROM nodes WHERE id=$1 AND revoked_at IS NULL FOR UPDATE',
      [nodeId],
    );
    if (!active.rowCount) throw new FabricError(401, 'Device is revoked.');
    const prior = await client.query(
      'SELECT checksum FROM device_telemetry WHERE node_id=$1 AND event_id=$2',
      [nodeId, input.eventId],
    );
    if (prior.rowCount && prior.rows[0].checksum !== checksum)
      throw new FabricError(409, 'Telemetry event ID reused with different content.');
    if (!prior.rowCount) {
      await client.query(
        'INSERT INTO device_telemetry(node_id,event_id,snapshot,checksum) VALUES($1,$2,$3,$4)',
        [nodeId, input.eventId, serialized, checksum],
      );
      await client.query('UPDATE nodes SET last_seen_at=now() WHERE id=$1', [nodeId]);
    }
    // Keep the most recent 100 snapshots per node; retries of retained events are idempotent.
    await client.query(
      'DELETE FROM device_telemetry WHERE node_id=$1 AND event_id NOT IN (SELECT event_id FROM device_telemetry WHERE node_id=$1 ORDER BY received_at DESC LIMIT 100)',
      [nodeId],
    );
    await client.query('COMMIT');
    return { accepted: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function readTelemetry(actor: Actor | null, nodeId: string) {
  authorize(actor);
  const node = await getDatabase().query('SELECT id FROM nodes WHERE id=$1', [nodeId]);
  if (!node.rowCount) throw new FabricError(404, 'Device not found.');
  const result = await getDatabase().query(
    'SELECT snapshot,received_at::text AS "receivedAt" FROM device_telemetry WHERE node_id=$1 ORDER BY received_at DESC LIMIT 1',
    [nodeId],
  );
  return { telemetry: result.rows[0] ?? null };
}
