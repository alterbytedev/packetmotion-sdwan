import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db';
import { authorize, authorizeSuperadmin, FabricError } from './authorization';
import { mutate } from './inventory';
import { lockTopology, publishWireguardPlans } from './wireguard-plan';
import { hubEndpoint, tunnelObject, tunnelPool, tunnelVersion, wireguardPublicKey } from './wireguard-validation';
import type { Actor } from './types';

async function audit(client: import('pg').PoolClient, actor: Actor, action: string, id: string | null) {
  await client.query('INSERT INTO audit_events(actor_id,actor_email,action,resource_id) VALUES($1,$2,$3,$4)',
    [actor.id, actor.email, action, id]);
}

export async function readTunnelSettings(actor: Actor | null) {
  authorize(actor);
  const result = await getDatabase().query('SELECT pool::text,version FROM wireguard_settings');
  return result.rows[0] ?? { pool: '', version: 0 };
}

export async function saveTunnelSettings(actor: Actor | null, value: unknown) {
  authorizeSuperadmin(actor);
  const input = tunnelObject(value, ['pool', 'expectedVersion']);
  const pool = tunnelPool(input.pool);
  const version = tunnelVersion(input.expectedVersion);
  return mutate(actor, async (client, fresh) => {
    authorizeSuperadmin(fresh);
    await lockTopology(client);
    await client.query('SELECT pg_advisory_xact_lock(72011002)');
    const prior = await client.query('SELECT pool::text,version FROM wireguard_settings');
    if ((prior.rows[0]?.version ?? 0) !== version)
      throw new FabricError(409, 'Tunnel settings changed; reload and retry.');
    if (prior.rows[0]?.pool !== pool) {
      if ((await client.query('SELECT 1 FROM routing_settings r CROSS JOIN unnest(r.protected_prefixes) p WHERE p && $1::cidr LIMIT 1', [pool])).rowCount)
        throw new FabricError(409, 'Tunnel pool overlaps a protected management or underlay network.');
      if ((await client.query('SELECT 1 FROM wireguard_links LIMIT 1')).rowCount)
        throw new FabricError(409, 'Reserved tunnel addresses prevent pool changes. Plan an explicit migration.');
      if ((await client.query('SELECT 1 FROM wireguard_devices WHERE endpoint <<= $1::cidr LIMIT 1', [pool])).rowCount)
        throw new FabricError(409, 'Tunnel pool overlaps a configured hub endpoint.');
      if ((await client.query('SELECT 1 FROM sites WHERE lan_prefix && $1::cidr LIMIT 1', [pool])).rowCount)
        throw new FabricError(409, 'Tunnel pool overlaps an existing LAN.');
    }
    await client.query(`INSERT INTO wireguard_settings(singleton,pool,version) VALUES(TRUE,$1,1)
      ON CONFLICT(singleton) DO UPDATE SET pool=excluded.pool,version=wireguard_settings.version+1`, [pool]);
    await audit(client, fresh, 'wireguard.settings_updated', '00000000-0000-0000-0000-000000000008');
    return { pool, version: version + 1 };
  });
}

export async function readWireguardDevice(actor: Actor | null, nodeId: string) {
  authorize(actor);
  const db = getDatabase();
  const node = await db.query(`SELECT n.id,n.kind,n.revoked_at IS NOT NULL AS revoked,
    d.public_key AS "publicKey",host(d.endpoint) AS endpoint,d.base_port AS "basePort",
    COALESCE(d.version,0) AS version FROM nodes n LEFT JOIN wireguard_devices d ON d.node_id=n.id WHERE n.id=$1`, [nodeId]);
  if (!node.rowCount) throw new FabricError(404, 'Device not found.');
  const hubs = await db.query(`SELECT n.id,n.name,d.public_key IS NOT NULL AS ready,host(d.endpoint) AS endpoint
    FROM nodes n LEFT JOIN wireguard_devices d ON d.node_id=n.id
    WHERE n.kind='hub' AND n.revoked_at IS NULL ORDER BY n.name,n.id`);
  const links = await db.query(`SELECT l.hub_id AS "hubId",l.edge_id AS "edgeId",n.name AS "peerName",
    l.network::text,host(l.network::inet) AS "hubAddress",host(l.network::inet+1) AS "edgeAddress",
    l.hub_port AS "hubPort" FROM wireguard_links l JOIN nodes n ON n.id=CASE WHEN l.edge_id=$1 THEN l.hub_id ELSE l.edge_id END
    WHERE (l.edge_id=$1 OR l.hub_id=$1) AND l.active ORDER BY l.id`, [nodeId]);
  const observed = await db.query('SELECT revision,status,handshakes,received_at::text AS "receivedAt" FROM wireguard_observed WHERE node_id=$1', [nodeId]);
  const desired = await db.query('SELECT max(revision) AS revision FROM desired_configs WHERE node_id=$1', [nodeId]);
  return { ...node.rows[0], hubs: hubs.rows, links: links.rows, observed: observed.rows[0] ?? null, desiredRevision: desired.rows[0]?.revision ?? null };
}

export async function saveWireguardDevice(actor: Actor | null, nodeId: string, value: unknown) {
  const input = tunnelObject(value, ['expectedVersion', 'hubIds', 'endpoint', 'basePort']);
  const version = tunnelVersion(input.expectedVersion);
  return mutate(actor, async (client, fresh) => {
    await lockTopology(client);
    const node = await client.query('SELECT kind FROM nodes WHERE id=$1 AND revoked_at IS NULL FOR UPDATE', [nodeId]);
    if (!node.rowCount) throw new FabricError(404, 'Device not found or revoked.');
    await client.query('INSERT INTO wireguard_devices(node_id) VALUES($1) ON CONFLICT DO NOTHING', [nodeId]);
    const device = (await client.query('SELECT * FROM wireguard_devices WHERE node_id=$1', [nodeId])).rows[0];
    if (device.version !== version) throw new FabricError(409, 'Hub settings changed; reload and retry.');
    let affected = [nodeId];
    if (node.rows[0].kind === 'hub') {
      if (input.hubIds !== undefined) throw new FabricError(400, 'Hubs cannot select other hubs.');
      const endpoint = hubEndpoint(input.endpoint);
      if (!Number.isInteger(input.basePort) || Number(input.basePort) < 1024 || Number(input.basePort) > 65408)
        throw new FabricError(400, 'Hub base UDP port must be 1024–65408.');
      const collision = await client.query(
        `SELECT 1 FROM wireguard_devices d JOIN nodes n ON n.id=d.node_id
         WHERE d.node_id<>$1 AND n.kind='hub' AND d.endpoint=$2::inet
           AND int4range(d.base_port,d.base_port+128) && int4range($3::int,$3::int+128) LIMIT 1`,
        [nodeId, endpoint, input.basePort],
      );
      if (collision.rowCount) throw new FabricError(409, 'Hub UDP port range overlaps another hub at this endpoint.');
      const pool = await client.query('SELECT 1 FROM wireguard_settings WHERE $1::inet <<= pool', [endpoint]);
      if (pool.rowCount) throw new FabricError(409, 'Hub endpoint cannot be inside the tunnel pool.');
      if (Number(input.basePort) !== device.base_port &&
          (await client.query('SELECT 1 FROM wireguard_links WHERE hub_id=$1 LIMIT 1', [nodeId])).rowCount)
        throw new FabricError(409, 'Reserved hub ports prevent changing the base port.');
      await client.query('UPDATE wireguard_devices SET endpoint=$2,base_port=$3 WHERE node_id=$1', [nodeId, endpoint, input.basePort]);
      const peers = await client.query('SELECT edge_id FROM wireguard_links WHERE hub_id=$1 AND active', [nodeId]);
      affected = [...affected, ...peers.rows.map((row) => row.edge_id)];
    } else {
      if (input.endpoint !== undefined || input.basePort !== undefined || !Array.isArray(input.hubIds) || input.hubIds.length > 8 ||
          input.hubIds.some((id) => typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) ||
          new Set(input.hubIds).size !== input.hubIds.length)
        throw new FabricError(400, 'Choose up to eight distinct hubs.');
      const hubIds = input.hubIds as string[];
      if (hubIds.length && !device.public_key) throw new FabricError(409, 'Upgrade and start the Edge agent to register its WireGuard key first.');
      const settings = await client.query('SELECT pool::text FROM wireguard_settings');
      if (hubIds.length && !settings.rowCount) throw new FabricError(409, 'Configure the tunnel address pool in Settings first.');
      const prior = await client.query('SELECT hub_id FROM wireguard_links WHERE edge_id=$1 AND active', [nodeId]);
      affected = [...affected, ...prior.rows.map((row) => row.hub_id), ...hubIds];
      for (const hubId of hubIds) {
        const hub = await client.query(`SELECT d.* FROM nodes n JOIN wireguard_devices d ON d.node_id=n.id
          WHERE n.id=$1 AND n.kind='hub' AND n.revoked_at IS NULL AND d.endpoint IS NOT NULL AND d.public_key IS NOT NULL`, [hubId]);
        if (!hub.rowCount) throw new FabricError(409, 'Selected hub needs an endpoint and a registered WireGuard key.');
        const existing = await client.query('SELECT id FROM wireguard_links WHERE edge_id=$1 AND hub_id=$2', [nodeId, hubId]);
        if (existing.rowCount) continue;
        const allocation = await client.query(`SELECT host(s.pool::inet + g.slot*2)||'/31' AS network
          FROM wireguard_settings s CROSS JOIN LATERAL generate_series(0,(1 << (32-masklen(s.pool)))/2-1) AS g(slot)
          WHERE NOT EXISTS (SELECT 1 FROM wireguard_links l WHERE l.network=(host(s.pool::inet+g.slot*2)||'/31')::cidr)
          ORDER BY g.slot LIMIT 1`);
        if (!allocation.rowCount) throw new FabricError(409, 'Tunnel address pool is exhausted.');
        const port = await client.query(`SELECT p.port FROM generate_series($2::int,$2::int+127) p(port)
          WHERE NOT EXISTS (SELECT 1 FROM wireguard_links l WHERE l.hub_id=$1 AND l.hub_port=p.port) ORDER BY p.port LIMIT 1`, [hubId, hub.rows[0].base_port]);
        if (!port.rowCount) throw new FabricError(409, 'Hub has reached its 128 reserved connection limit.');
        await client.query('INSERT INTO wireguard_links(id,edge_id,hub_id,network,hub_port) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), nodeId, hubId, allocation.rows[0].network, port.rows[0].port]);
      }
      await client.query('UPDATE wireguard_links SET active=(hub_id=ANY($2::uuid[])) WHERE edge_id=$1', [nodeId, hubIds]);
    }
    await client.query('UPDATE wireguard_devices SET version=version+1 WHERE node_id=$1', [nodeId]);
    await publishWireguardPlans(client, affected);
    await audit(client, fresh, 'wireguard.device_updated', nodeId);
    return { saved: true, version: version + 1 };
  });
}

export async function registerWireguardKey(nodeId: string, value: unknown) {
  const input = tunnelObject(value, ['publicKey']);
  const key = wireguardPublicKey(input.publicKey);
  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');
    await lockTopology(client);
    const node = await client.query('SELECT id FROM nodes WHERE id=$1 AND revoked_at IS NULL FOR UPDATE', [nodeId]);
    if (!node.rowCount) throw new FabricError(401, 'Device is revoked.');
    const prior = await client.query('SELECT public_key FROM wireguard_devices WHERE node_id=$1', [nodeId]);
    if (prior.rows[0]?.public_key && prior.rows[0].public_key !== key)
      throw new FabricError(409, 'WireGuard key replacement requires operator recovery.');
    await client.query(`INSERT INTO wireguard_devices(node_id,public_key) VALUES($1,$2)
      ON CONFLICT(node_id) DO UPDATE SET public_key=excluded.public_key`, [nodeId, key]);
    if (!prior.rows[0]?.public_key) await client.query(
      "INSERT INTO audit_events(actor_email,action,resource_id) VALUES($1,'wireguard.key_registered',$2)", [`device:${nodeId}`, nodeId]);
    await client.query('COMMIT');
    return { registered: true };
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') throw new FabricError(409, 'WireGuard key is already registered.');
    throw error;
  } finally { client.release(); }
}
