import 'server-only';
import type { PoolClient } from 'pg';
import { getDatabase } from '../db';
import { authorize, FabricError } from './authorization';
import { mutate } from './inventory';
import { readInterfaceCapability, readNetworkCommitHistory } from './network-commit-state';
import type { InterfaceIntent } from './network-types';
import { interfaceSubnet, networkDraftInput } from './network-validation';
import type { Actor } from './types';
import { nodeIdInput } from './validation';
import { lockTopology } from './wireguard-plan';

export async function networkBaseline(client: Pick<PoolClient, 'query'>, id: string, lock = false) {
  const result = await client.query(
    `SELECT n.id,n.site_id,
    COALESCE((SELECT max(revision) FROM desired_configs WHERE node_id=n.id),0)::int AS revision,
    COALESCE((SELECT version FROM lan_profiles WHERE node_id=n.id),0) AS "lanVersion"
    FROM nodes n WHERE n.id=$1 AND n.revoked_at IS NULL AND n.archived_at IS NULL ${lock ? 'FOR UPDATE OF n' : ''}`,
    [id],
  );
  if (!result.rowCount) throw new FabricError(404, 'Active device not found.');
  return result.rows[0];
}

export async function readNetworkDraft(actor: Actor | null, id: string) {
  authorize(actor);
  const nodeId = nodeIdInput(id);
  const db = getDatabase();
  const current = await networkBaseline(db, nodeId);
  const result = await db.query(
    `SELECT version,base_revision::int AS "baseRevision",base_lan_version AS "baseLanVersion",
    interfaces,safe_commit_seconds AS "safeCommitSeconds",updated_at::text AS "updatedAt" FROM network_drafts WHERE node_id=$1`,
    [nodeId],
  );
  const capability = await readInterfaceCapability(nodeId);
  const commits = await readNetworkCommitHistory(nodeId);
  return {
    capability,
    commits,
    draft: result.rows[0] ?? {
      version: 0,
      baseRevision: current.revision,
      baseLanVersion: current.lanVersion,
      interfaces: [],
      safeCommitSeconds: 60,
      updatedAt: null,
    },
    currentRevision: current.revision,
    currentLanVersion: current.lanVersion,
    deploymentAvailable: capability !== null,
    deploymentReason: capability
      ? 'Apply uses the Fabric agent with a 60-second confirmation window. This release supports locally authorized dedicated static LAN interfaces and VLANs without advertisement.'
      : 'Apply requires the updated Fabric agent and a locally authorized interface guard. Save remains available while activation is pending.',
  };
}

export async function saveNetworkDraft(actor: Actor | null, id: string, value: unknown) {
  const nodeId = nodeIdInput(id);
  const input = networkDraftInput(value);
  return mutate(actor, async (client, fresh) => {
    await lockTopology(client);
    await client.query('SELECT pg_advisory_xact_lock(72011002)');
    const current = await networkBaseline(client, nodeId, true);
    const prior = (
      await client.query('SELECT version FROM network_drafts WHERE node_id=$1', [nodeId])
    ).rows[0];
    if (
      (prior?.version ?? 0) !== input.expectedVersion ||
      current.revision !== input.baseRevision ||
      current.lanVersion !== input.baseLanVersion
    )
      throw new FabricError(
        409,
        'Published settings or this draft changed. Reload and review before saving.',
      );
    await validateNetworkInterfaces(client, nodeId, current.site_id, input.interfaces);
    const version = input.expectedVersion + 1;
    await client.query(
      `INSERT INTO network_drafts(node_id,version,base_revision,base_lan_version,interfaces,safe_commit_seconds)
      VALUES($1,$2,$3,$4,$5,60) ON CONFLICT(node_id) DO UPDATE SET version=excluded.version,
      base_revision=excluded.base_revision,base_lan_version=excluded.base_lan_version,interfaces=excluded.interfaces,updated_at=now()`,
      [nodeId, version, input.baseRevision, input.baseLanVersion, JSON.stringify(input.interfaces)],
    );
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_email,action,resource_id) VALUES($1,$2,'network.draft_saved',$3)",
      [fresh.id, fresh.email, nodeId],
    );
    return { saved: true, version, applied: false };
  });
}

export async function validateNetworkInterfaces(
  client: PoolClient,
  nodeId: string,
  siteId: string,
  interfaces: InterfaceIntent[],
) {
  for (const entry of interfaces) {
    if (!entry.address) continue;
    const prefix = interfaceSubnet(entry.address);
    const reserved = await client.query('SELECT 1 FROM wireguard_settings WHERE pool && $1::cidr', [
      prefix,
    ]);
    if (reserved.rowCount)
      throw new FabricError(409, 'Interface subnet overlaps the WireGuard pool.');
    if (entry.role === 'lan') {
      const settings = await client.query('SELECT protected_prefixes FROM routing_settings');
      if (!settings.rowCount || !settings.rows[0].protected_prefixes.length)
        throw new FabricError(
          409,
          'Configure protected management/underlay networks before saving LAN settings.',
        );
      const protectedOverlap = await client.query(
        'SELECT 1 FROM routing_settings r CROSS JOIN unnest(r.protected_prefixes) p WHERE p && $1::cidr',
        [prefix],
      );
      if (protectedOverlap.rowCount)
        throw new FabricError(409, 'LAN overlaps a protected management or underlay network.');
      const endpoint = await client.query(
        'SELECT 1 FROM wireguard_devices WHERE endpoint <<= $1::cidr LIMIT 1',
        [prefix],
      );
      if (endpoint.rowCount) throw new FabricError(409, 'LAN contains a hub transport endpoint.');
    }
    const sites = await client.query(
      "SELECT 1 FROM sites WHERE lan_prefix && $1::cidr AND ($3::text='wan' OR id<>$2 OR lan_prefix<>$1::cidr) LIMIT 1",
      [prefix, siteId, entry.role],
    );
    if (sites.rowCount) throw new FabricError(409, 'Interface overlaps an existing site network.');
    const duplicate = await client.query(
      'SELECT 1 FROM lan_profiles WHERE node_id<>$1 AND host(address)=host($2::inet) LIMIT 1',
      [nodeId, entry.address],
    );
    if (duplicate.rowCount)
      throw new FabricError(409, 'Another appliance already uses this LAN address.');
  }
}
