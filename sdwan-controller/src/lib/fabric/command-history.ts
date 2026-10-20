import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db';
import { authorizeSuperadmin, FabricError } from './authorization';
import type { Actor } from './types';
import type { PoolClient } from 'pg';

export type CommandEvent = 'published' | 'delivered' | 'received' | 'rejected' | 'applied' | 'failed' | 'disabled';
export type CommandType = 'desired_config' | 'wireguard' | 'frr' | 'nftables';

// Pass only secret-free snapshots; future device-file writers must redact credentials first.
export async function recordCommandPublication(
  client: PoolClient,
  nodeId: string,
  revision: number,
  operationType: CommandType,
  actorEmail: string,
  summary: string,
  rawConfig: string | null = null,
) {
  if (rawConfig !== null && Buffer.byteLength(rawConfig, 'utf8') > 131072)
    throw new FabricError(413, 'Configuration snapshot exceeds the 128 KiB history limit.');
  await client.query("DELETE FROM device_command_history WHERE created_at < now() - interval '365 days'");
  const operationId = randomUUID();
  await client.query(
    `INSERT INTO device_command_history
      (operation_id,node_id,operation_type,revision,event,attempt,actor_email,summary,raw_config)
     VALUES($1,$2,$3,$4,'published',1,$5,$6,$7)`,
    [operationId, nodeId, operationType, revision, actorEmail, summary.slice(0, 240), rawConfig],
  );
  return operationId;
}

export async function appendCommandEvent(
  client: PoolClient,
  nodeId: string,
  revision: number,
  event: CommandEvent,
  options: { errorSummary?: string | null; summary?: string } = {},
) {
  await client.query("DELETE FROM device_command_history WHERE created_at < now() - interval '365 days'");
  const prior = await client.query(
    `SELECT operation_id,operation_type FROM device_command_history
     WHERE node_id=$1 AND revision=$2 AND event='published' ORDER BY id DESC LIMIT 1 FOR SHARE`,
    [nodeId, revision],
  );
  if (!prior.rowCount) return;
  const operation = prior.rows[0];
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${operation.operation_id}:${event}`]);
  const attempts = await client.query(
    'SELECT COALESCE(max(attempt),0)::int AS attempt FROM device_command_history WHERE operation_id=$1 AND event=$2',
    [operation.operation_id, event],
  );
  const attempt = attempts.rows[0].attempt + 1;
  const defaultSummary: Record<CommandEvent, string> = {
    published: 'Configuration revision published by controller.',
    delivered: 'Configuration revision returned to device agent.',
    received: 'Device agent confirmed the revision was received and staged.',
    rejected: 'Device agent rejected the revision.',
    applied: 'Device agent reported the WireGuard revision applied.',
    failed: 'Device agent reported WireGuard apply failure; detailed reason unavailable.',
    disabled: 'Device agent reported WireGuard disabled for this revision.',
  };
  await client.query(
    `INSERT INTO device_command_history
      (operation_id,node_id,operation_type,revision,event,attempt,summary,error_summary)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(node_id,revision,event,attempt) DO NOTHING`,
    [operation.operation_id, nodeId, operation.operation_type, revision, event, attempt,
      (options.summary || defaultSummary[event]).slice(0, 240), options.errorSummary?.slice(0, 500) ?? null],
  );
}

export async function recordCommandEvent(
  nodeId: string,
  revision: number,
  event: CommandEvent,
  options: { errorSummary?: string | null; summary?: string } = {},
) {
  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');
    await appendCommandEvent(client, nodeId, revision, event, options);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function recordConfigDelivery(nodeId: string, revision: number) {
  await recordCommandEvent(nodeId, revision, 'delivered');
}

export async function listCommandHistory(
  actor: Actor | null,
  nodeId: string,
  params: URLSearchParams,
) {
  authorizeSuperadmin(actor);
  const page = Number(params.get('page') || 1);
  const pageSize = Number(params.get('pageSize') || 25);
  const event = params.get('status') || '';
  const operationType = params.get('type') || '';
  const validEvents = ['published', 'delivered', 'received', 'rejected', 'applied', 'failed', 'disabled'];
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || ![10, 25, 50, 100].includes(pageSize) ||
      (event && !validEvents.includes(event)) || (operationType && !['desired_config', 'wireguard', 'frr', 'nftables'].includes(operationType)))
    throw new FabricError(400, 'Invalid command history filter or pagination.');
  const values: (string | number)[] = [nodeId];
  let where = 'node_id=$1';
  let historyWhere = 'h.node_id=$1';
  if (event) {
    values.push(event);
    where += ` AND event=$${values.length}`;
    historyWhere += ` AND h.event=$${values.length}`;
  }
  if (operationType) {
    values.push(operationType);
    where += ` AND operation_type=$${values.length}`;
    historyWhere += ` AND h.operation_type=$${values.length}`;
  }
  const count = await getDatabase().query<{ total: number }>(
    `SELECT count(*)::int AS total FROM device_command_history WHERE ${where}`, values,
  );
  const offset = (page - 1) * pageSize;
  const rows = await getDatabase().query(
    `SELECT h.id,h.operation_id AS "operationId",h.operation_type AS "operationType",h.revision,h.event,h.attempt,
            h.actor_email AS "actorEmail",h.summary,h.error_summary AS "errorSummary",h.created_at::text AS "createdAt",
            floor(extract(epoch FROM (h.created_at - (SELECT min(p.created_at) FROM device_command_history p
              WHERE p.operation_id=h.operation_id AND p.event='published')))*1000)::bigint AS "durationMs"
     FROM device_command_history h WHERE ${historyWhere}
     ORDER BY h.created_at DESC,h.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset],
  );
  return { entries: rows.rows, total: count.rows[0].total, page, pageSize };
}

export async function readCommandConfig(actor: Actor | null, nodeId: string, operationId: string) {
  authorizeSuperadmin(actor);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(nodeId) ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(operationId))
    throw new FabricError(400, 'Invalid device or operation ID.');
  const result = await getDatabase().query<{ rawConfig: string | null }>(
    `SELECT raw_config AS "rawConfig" FROM device_command_history
     WHERE node_id=$1 AND operation_id=$2 AND event='published'`,
    [nodeId, operationId],
  );
  if (!result.rowCount || result.rows[0].rawConfig === null)
    throw new FabricError(404, 'Configuration snapshot not found.');
  return { operationId, rawConfig: result.rows[0].rawConfig };
}
