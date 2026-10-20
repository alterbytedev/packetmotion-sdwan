import 'server-only';
import { createHash } from 'node:crypto';
import { recordCommandPublication } from './command-history';
import type { PoolClient } from 'pg';

type RoutingPlan = {
  lan: { interfaceName: string; address: string; advertisedPrefix: string };
  protectedPrefixes: string[];
  bgp: { localAsn: number; routerId: string; peers: {
    interfaceName: string; address: string; remoteAsn: number;
    importPrefixes: string[]; exportPrefixes: string[]; localPreference: number;
  }[] };
};

// All topology writers acquire this before node locks. Pool allocation and
// publishing both peers must commit together; notifications are only wake hints.
export async function lockTopology(client: PoolClient) {
  await client.query('SELECT pg_advisory_xact_lock(72011003)');
}

export async function wireguardPlan(client: PoolClient, nodeId: string) {
  const links = await client.query(
    `SELECT l.id, l.edge_id=$1 AS edge, host(l.network::inet) AS hub_address,
      host(l.network::inet+1) AS edge_address, l.hub_port, host(h.endpoint) AS endpoint,
      CASE WHEN l.edge_id=$1 THEN h.public_key ELSE e.public_key END AS public_key,
      CASE WHEN l.edge_id=$1 THEN ep.interface_name ELSE hp.interface_name END AS interface_name,
      CASE WHEN l.edge_id=$1 THEN ep.address::text ELSE hp.address::text END AS local_address,
      CASE WHEN l.edge_id=$1 THEN ep.advertised_prefix::text ELSE hp.advertised_prefix::text END AS local_prefix,
      CASE WHEN l.edge_id=$1 THEN hp.address::text ELSE ep.address::text END AS peer_address,
      CASE WHEN l.edge_id=$1 THEN hp.advertised_prefix::text ELSE ep.advertised_prefix::text END AS peer_prefix,
      CASE WHEN l.edge_id=$1 THEN en.kind ELSE hn.kind END AS local_kind,
      CASE WHEN l.edge_id=$1 THEN hn.kind ELSE en.kind END AS peer_kind
     FROM wireguard_links l
     JOIN wireguard_devices h ON h.node_id=l.hub_id
     JOIN wireguard_devices e ON e.node_id=l.edge_id
     LEFT JOIN lan_profiles hp ON hp.node_id=h.node_id
     LEFT JOIN lan_profiles ep ON ep.node_id=e.node_id
     JOIN nodes hn ON hn.id=l.hub_id JOIN nodes en ON en.id=l.edge_id
     WHERE (l.edge_id=$1 OR l.hub_id=$1) AND l.active
       AND hn.revoked_at IS NULL AND en.revoked_at IS NULL ORDER BY l.id`, [nodeId],
  );
  const tunnels = links.rows.map((link) => ({
    name: `pm${link.id.replaceAll('-', '').slice(0, 12)}`,
    address: `${link.edge ? link.edge_address : link.hub_address}/31`,
    peerAddress: link.edge ? link.hub_address : link.edge_address,
    publicKey: link.public_key,
    endpoint: link.edge ? `${link.endpoint}:${link.hub_port}` : null,
    listenPort: link.edge ? 0 : link.hub_port,
    keepalive: link.edge ? 25 : 0,
    ...(link.local_prefix && link.peer_prefix ? { allowedPrefixes: [link.peer_prefix] } : {}),
  }));
  const local = links.rows.find((link) => link.local_prefix);
  let routing: RoutingPlan | undefined;
  if (local) {
    const protectedResult = await client.query('SELECT protected_prefixes::text[] AS prefixes FROM routing_settings WHERE singleton=TRUE');
    routing = {
      lan: { interfaceName: local.interface_name, address: local.local_address, advertisedPrefix: local.local_prefix },
      protectedPrefixes: protectedResult.rows[0]?.prefixes ?? [],
      bgp: {
        localAsn: local.local_kind === 'hub' ? 65000 : 65001,
        routerId: local.local_address.split('/')[0],
        peers: links.rows.filter((link) => link.local_prefix && link.peer_prefix).map((link, index) => ({
          interfaceName: `pm${link.id.replaceAll('-', '').slice(0, 12)}`,
          address: link.edge ? link.hub_address : link.edge_address,
          remoteAsn: link.peer_kind === 'hub' ? 65000 : 65001,
          importPrefixes: [link.peer_prefix],
          exportPrefixes: [link.local_prefix],
          localPreference: index === 0 ? 200 : 100,
        })),
      },
    };
  }
  return { tunnels, ...(routing ? { routing } : {}) };
}

export async function publishWireguardPlans(client: PoolClient, nodeIds: string[], actorEmail = 'Controller (automatic)') {
  for (const nodeId of [...new Set(nodeIds)].sort()) {
    const node = await client.query(
      'SELECT id FROM nodes WHERE id=$1 AND revoked_at IS NULL FOR UPDATE', [nodeId],
    );
    if (!node.rowCount) continue;
    const prior = await client.query(
      'SELECT revision,payload FROM desired_configs WHERE node_id=$1 ORDER BY revision DESC LIMIT 1',
      [nodeId],
    );
    if (!prior.rowCount) continue;
    const plan = await wireguardPlan(client, nodeId);
    const payload = { ...JSON.parse(prior.rows[0].payload), schemaVersion: plan.routing ? 3 : 2, wireguard: plan };
    const serialized = JSON.stringify(payload);
    const checksum = createHash('sha256').update(serialized).digest('hex');
    const revision = prior.rows[0].revision + 1;
    await client.query(
      'INSERT INTO desired_configs(node_id,revision,payload,checksum) VALUES($1,$2,$3,$4)',
      [nodeId, revision, serialized, checksum],
    );
    await recordCommandPublication(client, nodeId, revision, 'wireguard', actorEmail,
      `WireGuard topology revision ${revision} published.`, serialized);
    await client.query('SELECT pg_notify($1,$2)', ['fabric_desired_revision', JSON.stringify({ nodeId, revision })]);
  }
}

export async function detachWireguardNode(client: PoolClient, nodeId: string, actorEmail = 'Controller (automatic)') {
  const links = await client.query(
    'UPDATE wireguard_links SET active=FALSE WHERE (edge_id=$1 OR hub_id=$1) AND active RETURNING edge_id,hub_id',
    [nodeId],
  );
  await publishWireguardPlans(client, links.rows.flatMap((row) => [row.edge_id, row.hub_id]), actorEmail);
}
