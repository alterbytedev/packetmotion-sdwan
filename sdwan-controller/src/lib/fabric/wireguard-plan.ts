import 'server-only';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

// All topology writers acquire this before node locks. Pool allocation and
// publishing both peers must commit together; notifications are only wake hints.
export async function lockTopology(client: PoolClient) {
  await client.query('SELECT pg_advisory_xact_lock(72011003)');
}

export async function wireguardPlan(client: PoolClient, nodeId: string) {
  const links = await client.query(
    `SELECT l.id, l.edge_id=$1 AS edge, host(l.network::inet) AS hub_address,
      host(l.network::inet+1) AS edge_address, l.hub_port, host(h.endpoint) AS endpoint,
      CASE WHEN l.edge_id=$1 THEN h.public_key ELSE e.public_key END AS public_key
     FROM wireguard_links l
     JOIN wireguard_devices h ON h.node_id=l.hub_id
     JOIN wireguard_devices e ON e.node_id=l.edge_id
     JOIN nodes hn ON hn.id=l.hub_id JOIN nodes en ON en.id=l.edge_id
     WHERE (l.edge_id=$1 OR l.hub_id=$1) AND l.active
       AND hn.revoked_at IS NULL AND en.revoked_at IS NULL ORDER BY l.id`, [nodeId],
  );
  return { tunnels: links.rows.map((link) => ({
    name: `pm${link.id.replaceAll('-', '').slice(0, 12)}`,
    address: `${link.edge ? link.edge_address : link.hub_address}/31`,
    peerAddress: link.edge ? link.hub_address : link.edge_address,
    publicKey: link.public_key,
    endpoint: link.edge ? `${link.endpoint}:${link.hub_port}` : null,
    listenPort: link.edge ? 0 : link.hub_port,
    keepalive: link.edge ? 25 : 0,
  })) };
}

export async function publishWireguardPlans(client: PoolClient, nodeIds: string[]) {
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
    const payload = { ...JSON.parse(prior.rows[0].payload), schemaVersion: 2,
      wireguard: await wireguardPlan(client, nodeId) };
    const serialized = JSON.stringify(payload);
    const checksum = createHash('sha256').update(serialized).digest('hex');
    const revision = prior.rows[0].revision + 1;
    await client.query(
      'INSERT INTO desired_configs(node_id,revision,payload,checksum) VALUES($1,$2,$3,$4)',
      [nodeId, revision, serialized, checksum],
    );
    await client.query('SELECT pg_notify($1,$2)', ['fabric_desired_revision', JSON.stringify({ nodeId, revision })]);
  }
}

export async function detachWireguardNode(client: PoolClient, nodeId: string) {
  const links = await client.query(
    'UPDATE wireguard_links SET active=FALSE WHERE (edge_id=$1 OR hub_id=$1) AND active RETURNING edge_id,hub_id',
    [nodeId],
  );
  await publishWireguardPlans(client, links.rows.flatMap((row) => [row.edge_id, row.hub_id]));
}
