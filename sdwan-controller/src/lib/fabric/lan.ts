import 'server-only';
import { getDatabase } from '../db';
import { authorize, authorizeSuperadmin, FabricError } from './authorization';
import { mutate } from './inventory';
import { lockTopology } from './wireguard-plan';
import { lanInput, protectedNetworksInput } from './lan-validation';
import type { Actor } from './types';
import { assertInterfacePrefixAvailable, assertLegacyLanInterfaceAvailable } from './network-reservations';

export async function readRoutingSettings(actor: Actor | null) {
  authorize(actor);
  const result = await getDatabase().query('SELECT protected_prefixes::text[] AS "protectedPrefixes",version FROM routing_settings');
  return result.rows[0] ?? { protectedPrefixes: [], version: 0 };
}
export async function saveRoutingSettings(actor: Actor | null, value: unknown) {
  authorizeSuperadmin(actor);
  const input = protectedNetworksInput(value);
  return mutate(actor, async (client, fresh) => {
    authorizeSuperadmin(fresh);
    await lockTopology(client);
    await client.query('SELECT pg_advisory_xact_lock(72011002)');
    for (const prefix of input.protectedPrefixes) await assertInterfacePrefixAvailable(client,prefix);
    const prior = await client.query('SELECT version FROM routing_settings');
    if ((prior.rows[0]?.version ?? 0) !== input.expectedVersion)
      throw new FabricError(409, 'Protected networks changed; reload and retry.');
    const conflicts = await client.query(
      `SELECT 1 FROM sites s CROSS JOIN unnest($1::cidr[]) p WHERE s.lan_prefix && p LIMIT 1`,
      [input.protectedPrefixes],
    );
    if (conflicts.rowCount) throw new FabricError(409, 'Protected network overlaps an existing site LAN.');
    const tunnels = await client.query('SELECT 1 FROM wireguard_settings w CROSS JOIN unnest($1::cidr[]) p WHERE w.pool && p LIMIT 1', [input.protectedPrefixes]);
    if (tunnels.rowCount) throw new FabricError(409, 'Protected network overlaps the tunnel address pool.');
    await client.query(`INSERT INTO routing_settings VALUES(TRUE,$1,1) ON CONFLICT(singleton)
      DO UPDATE SET protected_prefixes=excluded.protected_prefixes,version=routing_settings.version+1`, [input.protectedPrefixes]);
    await client.query("INSERT INTO audit_events(actor_id,actor_email,action,resource_id) VALUES($1,$2,'routing.settings_updated',$3)",
      [fresh.id, fresh.email, '00000000-0000-0000-0000-000000000010']);
    return { protectedPrefixes: input.protectedPrefixes, version: input.expectedVersion + 1 };
  });
}
export async function readLan(actor: Actor | null, nodeId: string) {
  authorize(actor);
  const result = await getDatabase().query(`SELECT n.id,n.kind,n.revoked_at IS NOT NULL AS revoked,
    s.lan_prefix::text AS "sitePrefix",l.interface_name AS "interfaceName",l.address::text,
    l.advertised_prefix::text AS "advertisedPrefix",COALESCE(l.version,0) AS version
    FROM nodes n JOIN sites s ON s.id=n.site_id LEFT JOIN lan_profiles l ON l.node_id=n.id WHERE n.id=$1`, [nodeId]);
  if (!result.rowCount) throw new FabricError(404, 'Device not found.');
  const settings = await readRoutingSettings(actor);
  return { ...result.rows[0], protectedPrefixes: settings.protectedPrefixes };
}
export async function saveLan(actor: Actor | null, nodeId: string, value: unknown) {
  authorize(actor, true);
  const input = lanInput(value);
  return mutate(actor, async (client, fresh) => {
    await lockTopology(client);
    await client.query('SELECT pg_advisory_xact_lock(72011002)');
    const node = await client.query('SELECT site_id,kind FROM nodes WHERE id=$1 AND revoked_at IS NULL FOR UPDATE', [nodeId]);
    if (!node.rowCount) throw new FabricError(404, 'Device not found or revoked.');
    const prior = await client.query('SELECT version FROM lan_profiles WHERE node_id=$1', [nodeId]);
    if ((prior.rows[0]?.version ?? 0) !== input.expectedVersion) throw new FabricError(409, 'LAN settings changed; reload and retry.');
    await assertLegacyLanInterfaceAvailable(client,nodeId,input.interfaceName);
    await assertInterfacePrefixAvailable(client,input.advertisedPrefix);
    const settings = await client.query('SELECT protected_prefixes FROM routing_settings');
    if (!settings.rowCount) throw new FabricError(409, 'Configure protected management networks in Settings first.');
    const protectedOverlap = await client.query('SELECT 1 FROM routing_settings r CROSS JOIN unnest(r.protected_prefixes) p WHERE p && $1::cidr LIMIT 1', [input.advertisedPrefix]);
    if (protectedOverlap.rowCount) throw new FabricError(409, 'LAN overlaps a protected management or underlay network.');
    const tunnelOverlap = await client.query('SELECT 1 FROM wireguard_settings WHERE pool && $1::cidr', [input.advertisedPrefix]);
    if (tunnelOverlap.rowCount) throw new FabricError(409, 'LAN overlaps the tunnel address pool.');
    const endpointOverlap = await client.query('SELECT 1 FROM wireguard_devices WHERE endpoint <<= $1::cidr LIMIT 1', [input.advertisedPrefix]);
    if (endpointOverlap.rowCount) throw new FabricError(409, 'LAN contains a hub underlay endpoint.');
    const overlap = await client.query('SELECT 1 FROM sites WHERE id<>$2 AND lan_prefix && $1::cidr LIMIT 1', [input.advertisedPrefix, node.rows[0].site_id]);
    if (overlap.rowCount) throw new FabricError(409, 'LAN overlaps another site network.');
    // A shared site can have multiple appliances, but one member cannot silently
    // renumber another member or reuse its interface address.
    const shared = await client.query(`SELECT 1 FROM lan_profiles l JOIN nodes n ON n.id=l.node_id
      WHERE n.site_id=$2 AND n.id<>$1 AND (l.advertised_prefix<>$3::cidr OR host(l.address)=host($4::inet)) LIMIT 1`,
      [nodeId, node.rows[0].site_id, input.advertisedPrefix, input.address]);
    if (shared.rowCount) throw new FabricError(409, 'Shared-site LAN settings conflict with another appliance.');
    await client.query(`INSERT INTO lan_profiles VALUES($1,$2,$3,$4,1) ON CONFLICT(node_id) DO UPDATE SET
      interface_name=excluded.interface_name,address=excluded.address,advertised_prefix=excluded.advertised_prefix,version=lan_profiles.version+1`,
      [nodeId, input.interfaceName, input.address, input.advertisedPrefix]);
    await client.query('UPDATE sites SET lan_prefix=$2 WHERE id=$1', [node.rows[0].site_id, input.advertisedPrefix]);
    await client.query("INSERT INTO audit_events(actor_id,actor_email,action,resource_id) VALUES($1,$2,'lan.updated',$3)", [fresh.id, fresh.email, nodeId]);
    return { saved: true, version: input.expectedVersion + 1 };
  });
}
