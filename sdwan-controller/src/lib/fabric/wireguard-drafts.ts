import 'server-only';
import type { PoolClient } from 'pg';
import { getDatabase } from '../db';
import { authorize, FabricError } from './authorization';
import { mutate } from './inventory';
import { lockTopology } from './wireguard-plan';
import { applyWireguardDevice, normalizeWireguardSettings } from './wireguard';
import { nodeIdInput } from './validation';
import { tunnelObject, tunnelVersion } from './wireguard-validation';
import type { Actor } from './types';

async function currentSettings(client: PoolClient, nodeId: string) {
  const node = (
    await client.query(
      `SELECT n.kind,COALESCE(d.version,0) AS version,
    host(d.endpoint) AS endpoint,d.base_port AS "basePort" FROM nodes n
    LEFT JOIN wireguard_devices d ON d.node_id=n.id
    WHERE n.id=$1 AND n.revoked_at IS NULL AND n.archived_at IS NULL FOR UPDATE OF n`,
      [nodeId],
    )
  ).rows[0];
  if (!node) throw new FabricError(404, 'Device not found or revoked.');
  const settings =
    node.kind === 'hub'
      ? { endpoint: node.endpoint, basePort: node.basePort ?? 20000 }
      : {
          hubIds: (
            await client.query(
              'SELECT hub_id FROM wireguard_links WHERE edge_id=$1 AND active ORDER BY hub_id',
              [nodeId],
            )
          ).rows.map((row) => row.hub_id),
        };
  return { ...node, settings };
}

export async function saveWireguardDraft(actor: Actor | null, id: string, value: unknown) {
  const nodeId = nodeIdInput(id);
  const input = tunnelObject(value, [
    'expectedVersion',
    'expectedDraftVersion',
    'hubIds',
    'endpoint',
    'basePort',
  ]);
  const expectedVersion = tunnelVersion(input.expectedVersion);
  const expectedDraftVersion = tunnelVersion(input.expectedDraftVersion);
  return mutate(actor, async (client, fresh) => {
    await lockTopology(client);
    const current = await currentSettings(client, nodeId);
    const prior = (await client.query('SELECT * FROM wireguard_drafts WHERE node_id=$1', [nodeId]))
      .rows[0];
    if (current.version !== expectedVersion || (prior?.version ?? 0) !== expectedDraftVersion)
      throw new FabricError(
        409,
        'Configuration changed. Refresh the page, review the latest draft, and save again.',
      );
    const settings = normalizeWireguardSettings(current.kind, input);
    const payload = JSON.stringify(settings) === JSON.stringify(current.settings) ? null : settings;
    const version = expectedDraftVersion + 1;
    await client.query(
      `INSERT INTO wireguard_drafts(node_id,version,base_version,payload) VALUES($1,$2,$3,$4)
      ON CONFLICT(node_id) DO UPDATE SET version=excluded.version,base_version=excluded.base_version,
      payload=excluded.payload,updated_at=now()`,
      [nodeId, version, expectedVersion, payload === null ? null : JSON.stringify(payload)],
    );
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_email,action,resource_id) VALUES($1,$2,'wireguard.draft_saved',$3)",
      [fresh.id, fresh.email, nodeId],
    );
    return { saved: true, version, hasChanges: payload !== null };
  });
}

export async function deployWireguardDraft(actor: Actor | null, id: string, value: unknown) {
  const nodeId = nodeIdInput(id);
  const input = tunnelObject(value, ['expectedVersion', 'expectedDraftVersion']);
  const expectedVersion = tunnelVersion(input.expectedVersion);
  const expectedDraftVersion = tunnelVersion(input.expectedDraftVersion);
  return mutate(actor, async (client, fresh) => {
    await lockTopology(client);
    const current = await currentSettings(client, nodeId);
    const draft = (await client.query('SELECT * FROM wireguard_drafts WHERE node_id=$1', [nodeId]))
      .rows[0];
    // A retried completed deployment must not create another revision.
    if (!draft?.payload) return { deployed: false, message: 'No unpublished changes.' };
    if (
      draft.version !== expectedDraftVersion ||
      current.version !== expectedVersion ||
      draft.base_version !== current.version
    )
      throw new FabricError(
        409,
        'The draft or published configuration changed. Refresh, review, and save the draft again before deploying.',
      );
    const result = await applyWireguardDevice(client, fresh, nodeId, {
      ...draft.payload,
      expectedVersion,
    });
    await client.query(
      `UPDATE wireguard_drafts SET payload=NULL,version=version+1,base_version=$2,
      deployment_targets=$3,updated_at=now() WHERE node_id=$1`,
      [nodeId, result.version, result.affected],
    );
    return { deployed: true, version: result.version, affectedDeviceIds: result.affected };
  });
}

export async function readWireguardDeployment(actor: Actor | null, id: string) {
  authorize(actor);
  const nodeId = nodeIdInput(id);
  const db = getDatabase();
  if (
    !(await db.query('SELECT 1 FROM nodes WHERE id=$1 AND archived_at IS NULL', [nodeId])).rowCount
  )
    throw new FabricError(404, 'Device not found.');
  const draft = (
    await db.query(
      `SELECT version,"base_version" AS "baseVersion",payload,
    deployment_targets AS targets,updated_at::text AS "updatedAt" FROM wireguard_drafts WHERE node_id=$1`,
      [nodeId],
    )
  ).rows[0];
  // Include detached counterparts from the last deployment, not just active links.
  const targets = await db.query(
    `SELECT n.id,n.name,n.kind,n.revoked_at IS NOT NULL AS revoked,
    n.last_seen_at::text AS "lastSeenAt",dc.revision,ca.status AS receipt,
    o.status AS "applyStatus",o.revision AS "observedRevision",o.received_at::text AS "observedAt",
    o.checksum=dc.checksum AS "matchingChecksum",o.handshakes,
    n.last_seen_at > now()-make_interval(secs=>GREATEST(120,3*COALESCE((dc.payload::jsonb->>'pollIntervalSeconds')::int,30))) AS online,
    o.received_at > now()-make_interval(secs=>GREATEST(120,3*COALESCE((dc.payload::jsonb->>'pollIntervalSeconds')::int,30))) AS "observationFresh",
    COALESCE(jsonb_array_length(dc.payload::jsonb->'wireguard'->'tunnels'),0) AS "tunnelCount"
    FROM nodes n
    LEFT JOIN LATERAL (SELECT revision,checksum,payload FROM desired_configs WHERE node_id=n.id ORDER BY revision DESC LIMIT 1) dc ON TRUE
    LEFT JOIN config_acknowledgements ca ON ca.node_id=n.id AND ca.revision=dc.revision
    LEFT JOIN wireguard_observed o ON o.node_id=n.id
    WHERE n.id=$1 OR n.id=ANY($2::uuid[]) OR n.id IN
      (SELECT CASE WHEN edge_id=$1 THEN hub_id ELSE edge_id END FROM wireguard_links WHERE (edge_id=$1 OR hub_id=$1) AND active)
    ORDER BY n.id<>$1,n.name,n.id`,
    [nodeId, draft?.targets ?? []],
  );
  return {
    draft: draft
      ? {
          version: draft.version,
          baseVersion: draft.baseVersion,
          payload: draft.payload,
          updatedAt: draft.updatedAt,
        }
      : { version: 0, baseVersion: null, payload: null, updatedAt: null },
    devices: targets.rows,
  };
}
