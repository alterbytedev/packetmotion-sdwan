import 'server-only';
import { randomUUID } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import type { PoolClient } from 'pg';
import { getDatabase } from '../db';
import { authorize, FabricError } from './authorization';
import { auditCreation } from './audit';
import { issueToken } from './enrollment';
import { siteInput, nodeInput } from './validation';
import type { Actor, Inventory, Site, NodeRecord } from './types';

const siteColumns =
  'id, name, mode, lan_prefix::text AS "lanPrefix", created_at::text AS "createdAt"';
const nodeColumns = `n.id, n.site_id AS "siteId", s.name AS "siteName", n.name, n.kind, n.created_at::text AS "createdAt", n.last_seen_at::text AS "lastSeenAt", CASE WHEN n.revoked_at IS NOT NULL THEN 'revoked' WHEN n.enrolled_at IS NULL THEN 'not-enrolled' WHEN n.last_seen_at > now()-make_interval(secs=>GREATEST(120,3*COALESCE((SELECT (dc.payload::jsonb->>'pollIntervalSeconds')::int FROM desired_configs dc WHERE dc.node_id=n.id ORDER BY dc.revision DESC LIMIT 1),30))) THEN 'connected' ELSE 'offline' END AS "connectionStatus"`;

export async function listInventory(actor: Actor | null): Promise<Inventory> {
  authorize(actor);
  const pool = getDatabase();
  const [sites, nodes] = await Promise.all([
    pool.query<Site>(`SELECT ${siteColumns} FROM sites ORDER BY name, id`),
    pool.query<NodeRecord>(
      `SELECT ${nodeColumns} FROM nodes n JOIN sites s ON s.id = n.site_id ORDER BY s.name, n.name, n.id`,
    ),
  ]);
  return { sites: sites.rows, nodes: nodes.rows };
}

export async function mutate<T>(
  actor: Actor | null,
  operation: (client: PoolClient, actor: Actor) => Promise<T>,
): Promise<T> {
  authorize(actor, true);
  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');
    // Recheck role under a lock so concurrent demotion cannot authorize a write.
    const operator = await client.query<Actor>(
      'SELECT id::text, email, role FROM operators WHERE id = $1 FOR SHARE',
      [actor.id],
    );
    const fresh = operator.rows[0];
    if (!fresh || fresh.email !== actor.email)
      throw new FabricError(401, 'Operator access changed. Sign in again.');
    authorize(fresh, true);
    const result = await operation(client, fresh);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    const code = (error as { code?: string }).code;
    if (code === '23505') throw new FabricError(409, 'This inventory name already exists.');
    if (code === '23503') throw new FabricError(400, 'The selected site no longer exists.');
    throw error;
  } finally {
    client.release();
  }
}

async function insertSite(
  client: PoolClient,
  actor: Actor,
  input: ReturnType<typeof siteInput>,
): Promise<Site> {
  await client.query('SELECT pg_advisory_xact_lock(72011002)');
  if (input.lanPrefix) {
    const overlap = await client.query(
      'SELECT id FROM sites WHERE lan_prefix && $1::cidr LIMIT 1',
      [input.lanPrefix],
    );
    if (overlap.rowCount)
      throw new FabricError(409, 'LAN prefix overlaps an existing device network.');
  }
  const result = await client.query<Site>(
    `INSERT INTO sites (id,name,mode,lan_prefix) VALUES ($1,$2,$3,$4) RETURNING ${siteColumns}`,
    [randomUUID(), input.name, input.mode, input.lanPrefix],
  );
  const site = result.rows[0];
  await auditCreation(client, actor, 'site.created', site.id);
  return site;
}

export async function createSite(actor: Actor | null, value: unknown): Promise<Site> {
  authorize(actor, true);
  const input = siteInput(value);
  return mutate(actor, (client, fresh) => insertSite(client, fresh, input));
}

export async function createNode(
  actor: Actor | null,
  value: unknown,
): Promise<NodeRecord & { enrollment: { token: string; expiresAt: string } }> {
  authorize(actor, true);
  const input = nodeInput(value);
  return mutate(actor, async (client, fresh) => {
    const siteId = input.network
      ? (await insertSite(client, fresh, input.network)).id
      : input.siteId;
    const site = await client.query('SELECT id FROM sites WHERE id = $1 FOR SHARE', [siteId]);
    if (!site.rowCount) throw new FabricError(400, 'The selected site does not exist.');
    const id = randomUUID();
    await client.query('INSERT INTO nodes (id,site_id,name,kind) VALUES ($1,$2,$3,$4)', [
      id,
      siteId,
      input.name,
      input.kind,
    ]);
    await auditCreation(client, fresh, 'node.created', id);
    const result = await client.query<NodeRecord>(
      `SELECT ${nodeColumns} FROM nodes n JOIN sites s ON s.id = n.site_id WHERE n.id = $1`,
      [id],
    );
    const enrollment = await issueToken(client, fresh, id);
    return { ...result.rows[0], enrollment };
  });
}

export type DevicePage = { nodes: NodeRecord[]; total: number; page: number; pageSize: number };

export async function listDevices(
  actor: Actor | null,
  params = new URLSearchParams(),
): Promise<DevicePage> {
  authorize(actor);
  const search = (params.get('search') || '').trim();
  const page = Number(params.get('page') || 1);
  const pageSize = Number(params.get('pageSize') || 25);
  if (
    search.length > 100 ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000000 ||
    ![10, 25, 50, 100].includes(pageSize)
  )
    throw new FabricError(400, 'Invalid device search or pagination.');
  // Literal substring matching: user wildcard characters are not SQL patterns.
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const filter =
      "WHERE n.name ILIKE $1 OR (CASE WHEN n.kind='hub' THEN 'Hub' ELSE 'Edge' END) ILIKE $1";
    const count = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM nodes n ${filter}`,
      [pattern],
    );
    const total = count.rows[0].total;
    const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const result = await client.query<NodeRecord>(
      `SELECT ${nodeColumns} FROM nodes n JOIN sites s ON s.id=n.site_id ${filter} ORDER BY lower(n.name), n.id LIMIT $2 OFFSET $3`,
      [pattern, pageSize, (currentPage - 1) * pageSize],
    );
    await client.query('COMMIT');
    return { nodes: result.rows, total, page: currentPage, pageSize };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getDevice(actor: Actor | null, id: string): Promise<NodeRecord> {
  authorize(actor);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    throw new FabricError(404, 'Device not found.');
  const result = await getDatabase().query<NodeRecord>(
    `SELECT ${nodeColumns} FROM nodes n JOIN sites s ON s.id=n.site_id WHERE n.id=$1`,
    [id],
  );
  if (!result.rows[0]) throw new FabricError(404, 'Device not found.');
  return result.rows[0];
}

export async function dashboardInventory(actor: Actor | null): Promise<Inventory> {
  const devices = await listDevices(actor);
  const counts = await getDatabase().query<{ connected: number }>(
    `SELECT count(*)::int AS connected FROM (SELECT ${nodeColumns} FROM nodes n JOIN sites s ON s.id=n.site_id) devices WHERE "connectionStatus"='connected'`,
  );
  return {
    sites: [],
    nodes: devices.nodes,
    total: devices.total,
    connected: counts.rows[0].connected,
  };
}
