import 'server-only';
import { isIP } from 'node:net';
import { getDatabase } from '../db';
import { FabricError } from './authorization';
import type { Actor } from './types';

const auditResourceId = '00000000-0000-0000-0000-000000000007';
const maxHosts = 64;

export function normalizeInsecureHttpHost(value: unknown): string {
  if (typeof value !== 'string') throw new FabricError(400, 'Enter a private IP address.');
  let host = value.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const ipVersion = isIP(host);
  let allowed = false;
  if (ipVersion === 4) {
    const [a, b] = host.split('.').map(Number);
    allowed = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
  } else if (ipVersion === 6) {
    allowed = host === '::1' || host.startsWith('fc') || host.startsWith('fd');
  }
  if (!allowed) throw new FabricError(400, 'Only private IPv4, private IPv6, and loopback addresses are allowed.');
  return host;
}

export async function getInsecureHttpHosts(): Promise<string[]> {
  const result = await getDatabase().query<{ host: string }>(
    'SELECT host FROM controller_insecure_http_hosts ORDER BY host',
  );
  return result.rows.map((row) => row.host);
}

export async function isInsecureHttpHostAllowed(host: string): Promise<boolean> {
  let normalized: string;
  try {
    normalized = normalizeInsecureHttpHost(host);
  } catch {
    return false;
  }
  const result = await getDatabase().query(
    'SELECT 1 FROM controller_insecure_http_hosts WHERE host=$1',
    [normalized],
  );
  return Boolean(result.rowCount);
}

export async function replaceInsecureHttpHosts(actor: Actor, input: unknown): Promise<string[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new FabricError(400, 'A JSON object is required.');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => key !== 'hosts') || !Array.isArray(data.hosts))
    throw new FabricError(400, 'Provide a hosts list.');
  if (data.hosts.length > maxHosts) throw new FabricError(400, `Use at most ${maxHosts} addresses.`);
  const hosts = [...new Set(data.hosts.map(normalizeInsecureHttpHost))].sort();
  if (hosts.length !== data.hosts.length) throw new FabricError(400, 'Remove duplicate addresses.');

  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(72011007)');
    await client.query('DELETE FROM controller_insecure_http_hosts');
    for (const host of hosts)
      await client.query(
        'INSERT INTO controller_insecure_http_hosts(host,updated_by) VALUES($1,$2)',
        [host, actor.id],
      );
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_email,action,resource_id)
       VALUES($1,$2,'controller.insecure_http_hosts_updated',$3)`,
      [actor.id, actor.email, auditResourceId],
    );
    await client.query('COMMIT');
    return hosts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
