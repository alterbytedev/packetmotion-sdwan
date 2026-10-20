import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db';
import { authorizeSuperadmin, FabricError } from './authorization';
import type { Actor } from './types';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const interfaceName = /^pm[0-9a-f]{12}$/;
const prefix = /^[0-9a-fA-F:.%/]{1,64}$/;
const base64Key = /^[A-Za-z0-9+/]{43}=$/;

type Report = {
  stateDirectory: string;
  revision: number;
  wireguardEnabled: boolean;
  files: { name: string; path: string; present: boolean }[];
  appliedPlan: { tunnels: {
    name: string;
    address: string;
    peerAddress: string;
    publicKey: string;
    endpoint: string | null;
    listenPort: number;
    keepalive: number;
    allowedPrefixes: string[];
  }[] } | null;
  interfaces: { name: string; present: boolean; up: boolean; addresses: string[]; lastHandshake: number | null }[];
  unplannedOwnedInterfaces: string[];
};

function boundedString(value: unknown, max: number, pattern?: RegExp): value is string {
  return typeof value === 'string' && value.length <= max && (!pattern || pattern.test(value));
}

function sanitizeReport(value: unknown): Report {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FabricError(400, 'Invalid device state report.');
  const input = value as Record<string, unknown>;
  if (!boundedString(input.stateDirectory, 512) || input.stateDirectory.length === 0 || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0 ||
      typeof input.wireguardEnabled !== 'boolean' || !Array.isArray(input.files) || input.files.length > 4 ||
      !Array.isArray(input.interfaces) || input.interfaces.length > 128 ||
      !Array.isArray(input.unplannedOwnedInterfaces) || input.unplannedOwnedInterfaces.length > 128)
    throw new FabricError(400, 'Invalid device state report.');
  const files = input.files.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new FabricError(400, 'Invalid device state report.');
    const file = item as Record<string, unknown>;
    if (!boundedString(file.name, 64) || !boundedString(file.path, 1024) || typeof file.present !== 'boolean')
      throw new FabricError(400, 'Invalid device state report.');
    return { name: file.name, path: file.path, present: file.present };
  });
  let appliedPlan: Report['appliedPlan'] = null;
  if (input.appliedPlan !== null) {
    if (!input.appliedPlan || typeof input.appliedPlan !== 'object' || Array.isArray(input.appliedPlan))
      throw new FabricError(400, 'Invalid device state report.');
    const plan = input.appliedPlan as Record<string, unknown>;
    if (!Array.isArray(plan.tunnels) || plan.tunnels.length > 128) throw new FabricError(400, 'Invalid device state report.');
    appliedPlan = { tunnels: plan.tunnels.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new FabricError(400, 'Invalid device state report.');
      const tunnel = item as Record<string, unknown>;
      if (!boundedString(tunnel.name, 14, interfaceName) || !boundedString(tunnel.address, 64, prefix) ||
          !boundedString(tunnel.peerAddress, 64, prefix) || !boundedString(tunnel.publicKey, 44, base64Key) ||
          (tunnel.endpoint !== null && !boundedString(tunnel.endpoint, 64, /^[0-9a-fA-F:.]+:[0-9]{1,5}$/)) ||
          !Number.isSafeInteger(tunnel.listenPort) || Number(tunnel.listenPort) < 0 || Number(tunnel.listenPort) > 65535 ||
          !Number.isSafeInteger(tunnel.keepalive) || Number(tunnel.keepalive) < 0 || Number(tunnel.keepalive) > 65535 ||
          (tunnel.allowedPrefixes !== undefined && (!Array.isArray(tunnel.allowedPrefixes) || tunnel.allowedPrefixes.length > 32 ||
            !tunnel.allowedPrefixes.every((item) => boundedString(item, 64, prefix)))))
        throw new FabricError(400, 'Invalid device state report.');
      return {
        name: tunnel.name, address: tunnel.address, peerAddress: tunnel.peerAddress, publicKey: tunnel.publicKey,
        endpoint: tunnel.endpoint as string | null, listenPort: Number(tunnel.listenPort), keepalive: Number(tunnel.keepalive),
        allowedPrefixes: (tunnel.allowedPrefixes ?? []) as string[],
      };
    }) };
  }
  const interfaces = input.interfaces.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new FabricError(400, 'Invalid device state report.');
    const entry = item as Record<string, unknown>;
    if (!boundedString(entry.name, 14, interfaceName) || typeof entry.present !== 'boolean' || typeof entry.up !== 'boolean' ||
        !Array.isArray(entry.addresses) || entry.addresses.length > 16 || !entry.addresses.every((address) => boundedString(address, 64, prefix)) ||
        (entry.lastHandshake !== null && (!Number.isSafeInteger(entry.lastHandshake) || Number(entry.lastHandshake) < 0)))
      throw new FabricError(400, 'Invalid device state report.');
    return { name: entry.name, present: entry.present, up: entry.up, addresses: entry.addresses as string[],
      lastHandshake: entry.lastHandshake as number | null };
  });
  if (!input.unplannedOwnedInterfaces.every((name) => boundedString(name, 14, interfaceName)))
    throw new FabricError(400, 'Invalid device state report.');
  const report: Report = {
    stateDirectory: input.stateDirectory, revision: Number(input.revision), wireguardEnabled: input.wireguardEnabled,
    files, appliedPlan, interfaces, unplannedOwnedInterfaces: input.unplannedOwnedInterfaces as string[],
  };
  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > 65536) throw new FabricError(413, 'Device state report is too large.');
  return report;
}

export async function requestDeviceState(actor: Actor | null, nodeId: string) {
  authorizeSuperadmin(actor);
  if (!uuid.test(nodeId)) throw new FabricError(400, 'Invalid device ID.');
  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');
    const node = await client.query('SELECT id FROM nodes WHERE id=$1 AND revoked_at IS NULL FOR UPDATE', [nodeId]);
    if (!node.rowCount) throw new FabricError(404, 'Device not found.');
    await client.query('DELETE FROM device_state_reports WHERE expires_at < now()');
    const previous = await client.query(
      `SELECT request_id AS "requestId",status,requested_at AS "requestedAt"
       FROM device_state_reports WHERE node_id=$1 FOR UPDATE`, [nodeId],
    );
    if (previous.rowCount && previous.rows[0].status === 'pending' &&
        Date.now() - new Date(previous.rows[0].requestedAt).getTime() < 120_000) {
      await client.query('COMMIT');
      return { requestId: previous.rows[0].requestId, status: 'pending' as const };
    }
    const requestId = randomUUID();
    await client.query(
      `INSERT INTO device_state_reports(node_id,request_id,status,requested_by,requested_at,expires_at)
       VALUES($1,$2,'pending',$3,now(),now()+interval '24 hours')
       ON CONFLICT(node_id) DO UPDATE SET request_id=excluded.request_id,status='pending',requested_by=excluded.requested_by,
         requested_at=now(),expires_at=now()+interval '24 hours',completed_at=NULL,report=NULL,unavailable_reason=NULL`,
      [nodeId, requestId, actor.email],
    );
    await client.query('SELECT pg_notify($1,$2)', [
      'fabric_desired_revision', JSON.stringify({ nodeId, diagnosticRequest: true }),
    ]);
    await client.query('COMMIT');
    return { requestId, status: 'pending' as const };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function readDeviceState(actor: Actor | null, nodeId: string) {
  authorizeSuperadmin(actor);
  if (!uuid.test(nodeId)) throw new FabricError(400, 'Invalid device ID.');
  await getDatabase().query('DELETE FROM device_state_reports WHERE expires_at < now()');
  const result = await getDatabase().query(
    `UPDATE device_state_reports SET status='unavailable',unavailable_reason='timeout',completed_at=now()
     WHERE node_id=$1 AND status='pending' AND requested_at < now()-interval '2 minutes'
     RETURNING request_id AS "requestId",status,unavailable_reason AS reason,requested_at AS "requestedAt",completed_at AS "completedAt",report`, [nodeId],
  );
  const row = result.rowCount ? result.rows[0] : (await getDatabase().query(
    `SELECT request_id AS "requestId",status,unavailable_reason AS reason,requested_at AS "requestedAt",completed_at AS "completedAt",report
     FROM device_state_reports WHERE node_id=$1`, [nodeId],
  )).rows[0];
  return row ?? { requestId: null, status: 'none', reason: null, requestedAt: null, completedAt: null, report: null };
}

export async function readPendingDeviceStateRequest(nodeId: string) {
  try {
    const result = await getDatabase().query(
      `SELECT request_id AS "requestId" FROM device_state_reports
       WHERE node_id=$1 AND status='pending' AND requested_at >= now()-interval '2 minutes' AND expires_at > now()`, [nodeId],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    // Diagnostic collection is optional during migration rollout; preserve all
    // failures except the specific missing optional report table.
    if (error && typeof error === 'object' && 'code' in error && error.code === '42P01') return null;
    throw error;
  }
}

export async function recordDeviceState(nodeId: string, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FabricError(400, 'Invalid device state response.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['requestId', 'status', 'report', 'reason'].includes(key)) ||
      !boundedString(input.requestId, 36, uuid) || !['completed', 'unsupported', 'unavailable'].includes(String(input.status)))
    throw new FabricError(400, 'Invalid device state response.');
  const status = input.status as 'completed' | 'unsupported' | 'unavailable';
  if ((status === 'completed') !== (input.report !== undefined && input.report !== null))
    throw new FabricError(400, 'Invalid device state response.');
  const reason = input.reason === undefined || input.reason === null ? null : input.reason;
  if ((status === 'unavailable' && reason !== null && reason !== 'collection_failed') ||
      (status !== 'unavailable' && reason !== null))
    throw new FabricError(400, 'Invalid device state response.');
  const report = status === 'completed' ? sanitizeReport(input.report) : null;
  const result = await getDatabase().query(
    `UPDATE device_state_reports SET status=$3,completed_at=now(),report=$4,unavailable_reason=$5
     WHERE node_id=$1 AND request_id=$2 AND status='pending'
       AND requested_at >= now()-interval '2 minutes' AND expires_at > now()`,
    [nodeId, input.requestId, status, report ? JSON.stringify(report) : null, reason],
  );
  if (!result.rowCount) {
    const previous = await getDatabase().query(
      `SELECT status FROM device_state_reports WHERE node_id=$1 AND request_id=$2`, [nodeId, input.requestId],
    );
    if (previous.rowCount && previous.rows[0].status !== 'pending') return { recorded: true };
    throw new FabricError(409, 'Device state request is no longer active.');
  }
  return { recorded: true };
}
