import 'server-only';
import { getDatabase } from '../db';
import { getDevice } from './inventory';
import { FabricError } from './authorization';
import type { Actor, NodeRecord } from './types';

const eventLabels: Record<string, string> = {
  'node.created': 'Device entry created',
  'enrollment.issued': 'Enrollment token issued',
  'device.enrolled': 'Enrollment accepted',
  'device.enrollment_reset': 'Enrollment reset',
  'device.revoked': 'Device access revoked',
  'device.renewed': 'Certificate renewed',
  'config.published': 'Configuration published',
};

export type ConnectionDiagnostics = {
  checkedAt: string;
  connectionStatus: NodeRecord['connectionStatus'];
  summary: string;
  nextStep: string;
  enrolledAt: string | null;
  tokenStatus: 'missing' | 'available' | 'consumed' | 'expired' | 'revoked';
  tokenExpiresAt: string | null;
  tokenConsumedAt: string | null;
  lastSeenAt: string | null;
  configRevision: number | null;
  configStatus: NodeRecord['configStatus'];
  acknowledgedAt: string | null;
  certificateExpiresAt: string | null;
  events: { id: string; at: string; message: string }[];
};

// Operator-visible lifecycle facts, not runtime logs. No tokens, hashes, PEM,
// request bodies, error stacks, or diagnostic-log records leave this boundary.
export async function readConnectionDiagnostics(
  actor: Actor | null,
  nodeId: string,
): Promise<ConnectionDiagnostics> {
  const node = await getDevice(actor, nodeId);
  const pool = getDatabase();
  const [facts, events] = await Promise.all([
    pool.query(
      `SELECT n.enrolled_at::text AS "enrolledAt", t.expires_at::text AS "tokenExpiresAt",
      t.consumed_at::text AS "tokenConsumedAt",
      CASE WHEN t.revoked_at IS NOT NULL THEN 'revoked' WHEN t.consumed_at IS NOT NULL THEN 'consumed'
        WHEN t.expires_at<=now() THEN 'expired' WHEN t.node_id IS NULL THEN 'missing' ELSE 'available' END AS "tokenStatus",
      (SELECT max(expires_at)::text FROM device_certificates WHERE node_id=n.id AND revoked_at IS NULL) AS "certificateExpiresAt",
      (SELECT created_at::text FROM config_acknowledgements WHERE node_id=n.id AND revision=$2) AS "acknowledgedAt"
      FROM nodes n LEFT JOIN enrollment_tokens t ON t.node_id=n.id WHERE n.id=$1 AND n.archived_at IS NULL`,
      [nodeId, node.configRevision],
    ),
    pool.query(
      `SELECT id::text AS id, created_at::text AS at, action FROM audit_events WHERE resource_id=$1
      AND action=ANY($2::text[]) ORDER BY created_at DESC,id DESC LIMIT 10`,
      [nodeId, Object.keys(eventLabels)],
    ),
  ]);
  const fact = facts.rows[0];
  if (!fact) throw new FabricError(404, 'Device not found.');
  let summary: string;
  let nextStep: string;
  switch (node.connectionStatus) {
    case 'pending':
      summary =
        fact.tokenStatus === 'expired'
          ? 'Enrollment token expired before enrollment was accepted.'
          : 'The controller has not accepted enrollment for this device.';
      nextStep =
        'On a reused Debian appliance, compare its local device ID with this dashboard device ID. Archiving an entry leaves its local identity on disk. Check the installer output; an existing identity can prevent the new token from being used.';
      if (fact.tokenStatus === 'expired') nextStep = `Issue a fresh enrollment token. ${nextStep}`;
      break;
    case 'enrolling':
      summary = 'Enrollment was accepted, but no management heartbeat has arrived.';
      nextStep =
        'Check whether fabric-agent is running and inspect its journal for startup recovery, TLS, revoked identity, or controller connection failures.';
      break;
    case 'offline':
      summary = 'The last heartbeat is stale; current agent state is unknown.';
      nextStep =
        'Check the service status and journal on Debian, then verify its direct management route to the controller.';
      break;
    case 'syncing':
      summary =
        node.configStatus === 'rejected'
          ? 'The agent rejected the latest configuration.'
          : 'A heartbeat arrived, but the latest configuration has not been acknowledged received.';
      nextStep =
        'Inspect desired-operation results in the agent journal. Received means staged; it does not prove network apply.';
      break;
    case 'revoked':
      summary = 'Controller access for this identity has been revoked.';
      nextStep =
        'Preserve the appliance identity and network recovery files and use operator recovery before enrolling a replacement device.';
      break;
    default:
      summary = 'Recent heartbeat and receipt of the latest configuration are recorded.';
      nextStep =
        'Management is connected. Tunnel and routed data-plane health are separate observations.';
  }
  return {
    checkedAt: new Date().toISOString(),
    connectionStatus: node.connectionStatus,
    summary,
    nextStep,
    ...fact,
    lastSeenAt: node.lastSeenAt,
    configRevision: node.configRevision,
    configStatus: node.configStatus,
    events: events.rows.map((event) => ({
      id: event.id,
      at: event.at,
      message: eventLabels[event.action],
    })),
  };
}
