import 'server-only';
import { getDatabase } from '../db';
import { FabricError } from './authorization';
import { lockTopology } from './wireguard-plan';
import { tunnelObject } from './wireguard-validation';

export async function readInterfaceCapability(nodeId: string) {
  const sample = (
    await getDatabase().query(
      `SELECT snapshot,received_at FROM device_telemetry WHERE node_id=$1 ORDER BY received_at DESC LIMIT 1`,
      [nodeId],
    )
  ).rows[0];
  const capability = sample?.snapshot?.interfaceApply;
  if (
    !capability ||
    capability.nodeId !== nodeId ||
    !Number.isFinite(Date.parse(capability.updatedAt)) ||
    capability.protocolVersion !== 1 ||
    capability.mode !== 'dedicated-static' ||
    !Array.isArray(capability.interfaces) ||
    new Date(sample.received_at).getTime() < Date.now() - 120000 ||
    new Date(capability.updatedAt).getTime() < Date.now() - 45000 ||
    new Date(capability.updatedAt).getTime() > Date.now() + 5000
  )
    return null;
  return capability as {
    protocolVersion: 1;
    mode: 'dedicated-static';
    interfaces: string[];
    updatedAt: string;
  };
}
export async function readNetworkCommitHistory(nodeId: string) {
  const result = await getDatabase().query(
    `SELECT id,"interface_name" AS "interfaceName",kind,status,reason,sequence,
    (SELECT report->>'operation' FROM network_interface_commit_events e WHERE e.commit_id=network_interface_commits.id ORDER BY sequence DESC LIMIT 1) AS operation,
    actor_email AS "actorEmail",created_at::text AS "createdAt",reported_at::text AS "reportedAt",deadline::text,payload::jsonb AS payload
    FROM network_interface_commits WHERE node_id=$1 ORDER BY created_at DESC,id LIMIT 10`,
    [nodeId],
  );
  return result.rows;
}
export async function pendingInterfaceRequest(nodeId: string) {
  const result = await getDatabase().query(
    `SELECT id,checksum,payload FROM network_interface_commits
    WHERE node_id=$1 AND status IN ('queued','applying','awaiting_confirmation') ORDER BY created_at LIMIT 1`,
    [nodeId],
  );
  const row = result.rows[0];
  return row
    ? { commitId: row.id, checksum: row.checksum, payload: JSON.parse(row.payload) }
    : null;
}
const statuses = [
  'applying',
  'awaiting_confirmation',
  'applied',
  'rolled_back',
  'rejected',
  'rollback_failed',
];
const reasons = [
  '',
  'local_authorization_denied',
  'inventory_unavailable',
  'management_route_unavailable',
  'management_interface_protected',
  'physical_parent_required',
  'foreign_interface_address',
  'foreign_vlan_interface',
  'interface_subnet_overlap',
  'interface_route_overlap',
  'validation_failed',
  'controller_confirmation_timeout',
  'apply_failed',
  'interrupted_apply',
  'rollback_failed',
  'local_activation_required',
];
export async function recordInterfaceResult(nodeId: string, value: unknown) {
  const input = tunnelObject(value, [
    'commitId',
    'checksum',
    'status',
    'reason',
    'sequence',
    'nonce',
    'deadline',
    'updatedAt',
    'operation',
  ]);
  if (
    input.operation !== undefined &&
    (typeof input.operation !== 'string' ||
      ![
        '',
        'inspect_state',
        'isolate_forwarding',
        'create_vlan',
        'delete_vlan',
        'set_mtu',
        'assign_address',
        'remove_address',
        'set_link_state',
        'verify_management_route',
      ].includes(input.operation))
  )
    throw new FabricError(400, 'Invalid interface operation.');
  if (
    typeof input.commitId !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.commitId) ||
    typeof input.checksum !== 'string' ||
    !/^[0-9a-f]{64}$/.test(input.checksum) ||
    typeof input.status !== 'string' ||
    !statuses.includes(input.status) ||
    typeof input.reason !== 'string' ||
    !reasons.includes(input.reason) ||
    !Number.isSafeInteger(input.sequence) ||
    Number(input.sequence) < 1 ||
    Number(input.sequence) > 1000000 ||
    typeof input.nonce !== 'string' ||
    (input.nonce !== '' && !/^[0-9a-f]{64}$/.test(input.nonce)) ||
    typeof input.deadline !== 'string' ||
    input.deadline.length > 40 ||
    (input.deadline !== '' && !Number.isFinite(Date.parse(input.deadline))) ||
    typeof input.updatedAt !== 'string' ||
    input.updatedAt.length > 40 ||
    !Number.isFinite(Date.parse(input.updatedAt))
  )
    throw new FabricError(400, 'Invalid interface result.');
  if (
    (input.status === 'awaiting_confirmation' || input.status === 'applied') &&
    (!input.nonce || !input.deadline)
  )
    throw new FabricError(400, 'Confirmation metadata required.');
  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');
    await lockTopology(client);
    await client.query('SELECT pg_advisory_xact_lock(72011002)');
    if (
      !(
        await client.query('SELECT 1 FROM nodes WHERE id=$1 AND revoked_at IS NULL FOR UPDATE', [
          nodeId,
        ])
      ).rowCount
    )
      throw new FabricError(401, 'Device revoked.');
    const row = (
      await client.query(
        'SELECT * FROM network_interface_commits WHERE id=$1 AND node_id=$2 FOR UPDATE',
        [input.commitId, nodeId],
      )
    ).rows[0];
    if (!row || row.checksum !== input.checksum)
      throw new FabricError(409, 'Interface commit does not match this device.');
    const prior = (
      await client.query(
        'SELECT report FROM network_interface_commit_events WHERE commit_id=$1 AND sequence=$2',
        [input.commitId, input.sequence],
      )
    ).rows[0];
    if (prior) {
      const same =
        Object.keys(input).length === Object.keys(prior.report).length &&
        Object.keys(input).every(
          (key) => JSON.stringify(prior.report[key]) === JSON.stringify(input[key]),
        );
      if (!same) throw new FabricError(409, 'Interface event sequence reused.');
    } else {
      if (Number(input.sequence) <= row.sequence)
        throw new FabricError(409, 'Stale interface event.');
      if (['applied', 'rolled_back', 'rejected'].includes(row.status))
        throw new FabricError(409, 'Interface commit is already terminal.');
      await client.query(
        'INSERT INTO network_interface_commit_events(commit_id,sequence,report) VALUES($1,$2,$3)',
        [input.commitId, input.sequence, JSON.stringify(input)],
      );
      await client.query(
        `UPDATE network_interface_commits SET status=$2,sequence=$3,reason=$4,nonce=$5,deadline=$6,reported_at=now() WHERE id=$1`,
        [
          input.commitId,
          input.status,
          input.sequence,
          input.reason,
          input.nonce,
          input.deadline || null,
        ],
      );
      if (input.status === 'applied') {
        const payload = JSON.parse(row.payload);
        if (payload.interfaces.length)
          await client.query(
            `INSERT INTO network_interface_applied(node_id,interface_name,kind,commit_id,interfaces) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(node_id,interface_name,kind) DO UPDATE SET commit_id=excluded.commit_id,interfaces=excluded.interfaces`,
            [nodeId, row.interface_name, row.kind, row.id, JSON.stringify(payload.interfaces)],
          );
        else
          await client.query(
            'DELETE FROM network_interface_applied WHERE node_id=$1 AND interface_name=$2 AND kind=$3',
            [nodeId, row.interface_name, row.kind],
          );
      }
      await client.query(
        'DELETE FROM network_interface_commit_events WHERE commit_id=$1 AND sequence<$2',
        [input.commitId, Number(input.sequence) - 100],
      );
    }
    await client.query('COMMIT');
    return { accepted: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function confirmInterfaceCommit(nodeId: string, value: unknown) {
  const input = tunnelObject(value, ['commitId', 'checksum', 'nonce']);
  if (
    typeof input.commitId !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.commitId) ||
    typeof input.checksum !== 'string' ||
    !/^[0-9a-f]{64}$/.test(input.checksum) ||
    typeof input.nonce !== 'string' ||
    !/^[0-9a-f]{64}$/.test(input.nonce)
  )
    throw new FabricError(400, 'Invalid interface confirmation.');
  const row = (
    await getDatabase().query(
      `SELECT 1 FROM network_interface_commits WHERE id=$1 AND node_id=$2 AND checksum=$3 AND nonce=$4
    AND status='awaiting_confirmation' AND deadline>now()`,
      [input.commitId, nodeId, input.checksum, input.nonce],
    )
  ).rows[0];
  if (!row)
    throw new FabricError(
      409,
      'Interface confirmation expired or does not match the pending transaction.',
    );
  return { commitId: input.commitId, checksum: input.checksum, nonce: input.nonce };
}
