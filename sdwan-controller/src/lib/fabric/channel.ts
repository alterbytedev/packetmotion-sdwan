import 'server-only';
import { createHash } from 'node:crypto';
import { getDatabase } from '../db';
import { FabricError, authorize } from './authorization';
import { mutate } from './inventory';
import { auditCreation } from './audit';
import type { Actor } from './types';

export type DeviceConfig = {
  schemaVersion: 1;
  deviceKind: 'branch' | 'hub';
  mode: 'gateway' | 'subnet-router';
  lanPrefix: string | null;
  pollIntervalSeconds: number;
};
export async function desiredConfig(nodeId: string) {
  const existing = await getDatabase().query(
    'SELECT revision,payload,checksum FROM desired_configs WHERE node_id=$1 ORDER BY revision DESC LIMIT 1',
    [nodeId],
  );
  if (existing.rowCount)
    return {
      revision: existing.rows[0].revision,
      payload: JSON.parse(existing.rows[0].payload),
      checksum: existing.rows[0].checksum,
    };
  return { revision: 0, payload: null, checksum: null };
}
export async function publishConfig(actor: Actor | null, nodeId: string, value: unknown) {
  const input = value as { expectedRevision?: unknown; pollIntervalSeconds?: unknown };
  if (
    !input ||
    Object.keys(input).some((key) => !['expectedRevision', 'pollIntervalSeconds'].includes(key)) ||
    !Number.isInteger(input.expectedRevision) ||
    Number(input.expectedRevision) < 0 ||
    !Number.isInteger(input.pollIntervalSeconds) ||
    Number(input.pollIntervalSeconds) < 10 ||
    Number(input.pollIntervalSeconds) > 300
  )
    throw new FabricError(400, 'Supply current revision and polling interval (10–300 seconds).');
  return mutate(actor, async (client, fresh) => {
    const node = await client.query(
      `SELECT n.kind,s.mode,s.lan_prefix::text AS prefix FROM nodes n JOIN sites s ON s.id=n.site_id WHERE n.id=$1 AND n.revoked_at IS NULL FOR UPDATE OF n`,
      [nodeId],
    );
    if (!node.rowCount) throw new FabricError(404, 'Device not found or revoked.');
    const prior = await client.query(
      'SELECT revision FROM desired_configs WHERE node_id=$1 ORDER BY revision DESC LIMIT 1',
      [nodeId],
    );
    const revision = prior.rows[0]?.revision ?? 0;
    if (revision !== input.expectedRevision)
      throw new FabricError(409, 'Configuration changed; reload and retry.');
    const payload: DeviceConfig = {
      schemaVersion: 1,
      deviceKind: node.rows[0].kind,
      mode: node.rows[0].mode,
      lanPrefix: node.rows[0].prefix,
      pollIntervalSeconds: Number(input.pollIntervalSeconds),
    };
    const serialized = JSON.stringify(payload);
    const checksum = createHash('sha256').update(serialized).digest('hex');
    await client.query(
      'INSERT INTO desired_configs(node_id,revision,payload,checksum) VALUES($1,$2,$3,$4)',
      [nodeId, revision + 1, serialized, checksum],
    );
    await auditCreation(client, fresh, 'config.published', nodeId);
    return { revision: revision + 1, payload, checksum };
  });
}
export async function acknowledgeConfig(nodeId: string, value: unknown) {
  const input = value as { revision?: unknown; checksum?: unknown; status?: unknown };
  if (
    !input ||
    Object.keys(input).some((key) => !['revision', 'checksum', 'status'].includes(key)) ||
    !Number.isInteger(input.revision) ||
    Number(input.revision) < 1 ||
    !['received', 'rejected'].includes(String(input.status))
  )
    throw new FabricError(400, 'Invalid configuration acknowledgement.');
  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');
    const active = await client.query(
      'SELECT id FROM nodes WHERE id=$1 AND revoked_at IS NULL FOR UPDATE',
      [nodeId],
    );
    if (!active.rowCount) throw new FabricError(401, 'Device is revoked.');
    const config = await client.query(
      'SELECT revision,checksum FROM desired_configs WHERE node_id=$1 ORDER BY revision DESC LIMIT 1',
      [nodeId],
    );
    if (
      !config.rowCount ||
      config.rows[0].revision !== input.revision ||
      config.rows[0].checksum !== input.checksum
    )
      throw new FabricError(409, 'Acknowledgement does not match the current device revision.');
    const prior = await client.query(
      'SELECT status FROM config_acknowledgements WHERE node_id=$1 AND revision=$2',
      [nodeId, input.revision],
    );
    if (prior.rowCount && prior.rows[0].status !== input.status)
      throw new FabricError(409, 'Acknowledgement already recorded.');
    await client.query(
      'INSERT INTO config_acknowledgements(node_id,revision,status) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [nodeId, input.revision, input.status],
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
