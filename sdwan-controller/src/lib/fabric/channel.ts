import 'server-only';
import { createHash } from 'node:crypto';
import { getDatabase } from '../db';
import { FabricError } from './authorization';
import { mutate } from './inventory';
import { auditCreation } from './audit';
import { lockTopology, wireguardPlan, wireguardSchemaVersion } from './wireguard-plan';
import { waitForRevision } from './revision-events';
import { appendCommandEvent, recordCommandPublication } from './command-history';
import type { Actor } from './types';

// Preserve the existing channel import boundary for routes and integration callers.
export { recordHeartbeat, readTelemetry } from './telemetry';

export type DeviceConfig = {
  schemaVersion: 1 | 2 | 3 | 4;
  wireguard?: Awaited<ReturnType<typeof wireguardPlan>>;
  deviceKind: 'branch' | 'hub';
  mode: 'gateway' | 'subnet-router';
  lanPrefix: string | null;
  pollIntervalSeconds: number;
};

export async function desiredConfig(
  nodeId: string,
  knownRevision?: string | null,
  knownChecksum?: string | null,
) {
  const existing = await getDatabase().query(
    'SELECT revision,payload,checksum FROM desired_configs WHERE node_id=$1 ORDER BY revision DESC LIMIT 1',
    [nodeId],
  );
  const latest = existing.rows[0];
  if (existing.rowCount && String(latest.revision) === knownRevision && latest.checksum === knownChecksum)
    return { revision: latest.revision, checksum: latest.checksum, unchanged: true };
  if (existing.rowCount)
    return {
      revision: latest.revision,
      payload: JSON.parse(latest.payload),
      checksum: latest.checksum,
    };
  if (knownRevision === '0' && !knownChecksum)
    return { revision: 0, checksum: null, unchanged: true };
  return { revision: 0, payload: null, checksum: null };
}

export async function waitForDesiredConfig(
  nodeId: string,
  knownRevision: string | null,
  knownChecksum: string | null,
  timeoutMs: number,
  signal: AbortSignal,
  extraReady: () => Promise<boolean> = async () => false,
) {
  return waitForRevision(nodeId, timeoutMs, signal, async () => {
    const current = await desiredConfig(nodeId, knownRevision, knownChecksum);
    const emptyKnownState = current.revision === 0 && current.unchanged === true;
    const changed = !current.unchanged && !emptyKnownState;
    return { value: current, changed: changed || await extraReady() };
  });
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
    await lockTopology(client);
    const node = await client.query(
      `SELECT n.kind,s.mode,s.lan_prefix::text AS prefix FROM nodes n JOIN sites s ON s.id=n.site_id WHERE n.id=$1 AND n.revoked_at IS NULL FOR UPDATE OF n`,
      [nodeId],
    );
    if (!node.rowCount) throw new FabricError(404, 'Device not found or revoked.');
    const prior = await client.query(
      'SELECT revision,payload FROM desired_configs WHERE node_id=$1 ORDER BY revision DESC LIMIT 1',
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
    if (prior.rows[0] && JSON.parse(prior.rows[0].payload).schemaVersion >= 2) {
      payload.wireguard = await wireguardPlan(client, nodeId);
      payload.schemaVersion = wireguardSchemaVersion(payload.wireguard);
    }
    const serialized = JSON.stringify(payload);
    const checksum = createHash('sha256').update(serialized).digest('hex');
    await client.query(
      'INSERT INTO desired_configs(node_id,revision,payload,checksum) VALUES($1,$2,$3,$4)',
      [nodeId, revision + 1, serialized, checksum],
    );
    await recordCommandPublication(client, nodeId, revision + 1, payload.wireguard ? 'wireguard' : 'desired_config', fresh.email,
      `Desired configuration revision ${revision + 1} published.`, serialized);
    await client.query('SELECT pg_notify($1,$2)', [
      'fabric_desired_revision',
      JSON.stringify({ nodeId, revision: revision + 1 }),
    ]);
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
    await appendCommandEvent(client, nodeId, Number(input.revision), input.status as 'received' | 'rejected');
    await client.query('COMMIT');
    return { accepted: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
