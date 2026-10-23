import 'server-only';
import type { PoolClient } from 'pg';
import { FabricError } from './authorization';

// Read installed intent and in-flight candidates in one place. Both participate
// in reservations until a terminal rollback/rejection is observed.
export async function assertInterfacePrefixAvailable(
  client: PoolClient,
  prefix: string,
  scope?: { nodeId: string; interfaceName: string; kind: string },
) {
  const conflict = await client.query(
    `WITH settings AS (
    SELECT a.node_id,a.interface_name,a.kind,a.interfaces FROM network_interface_applied a
    UNION ALL SELECT c.node_id,c.interface_name,c.kind,c.payload::jsonb->'interfaces' FROM network_interface_commits c
      WHERE c.status IN ('queued','applying','awaiting_confirmation','rollback_failed')
  ) SELECT 1 FROM settings s CROSS JOIN LATERAL jsonb_array_elements(s.interfaces) i
    WHERE i->>'address' IS NOT NULL AND network((i->>'address')::inet) && $1::cidr
    AND NOT (s.node_id IS NOT DISTINCT FROM $2::uuid AND s.interface_name IS NOT DISTINCT FROM $3::text AND s.kind IS NOT DISTINCT FROM $4::text) LIMIT 1`,
    [prefix, scope?.nodeId ?? null, scope?.interfaceName ?? null, scope?.kind ?? null],
  );
  if (conflict.rowCount)
    throw new FabricError(409, 'Network overlaps an applied or pending interface subnet.');
}
export async function assertLegacyLanInterfaceAvailable(
  client: PoolClient,
  nodeId: string,
  interfaceName: string,
) {
  const conflict = await client.query(
    `SELECT 1 FROM network_interface_applied WHERE node_id=$1 AND interface_name=$2
    UNION ALL SELECT 1 FROM network_interface_commits WHERE node_id=$1 AND interface_name=$2
    AND status IN ('queued','applying','awaiting_confirmation','rollback_failed') LIMIT 1`,
    [nodeId, interfaceName],
  );
  if (conflict.rowCount)
    throw new FabricError(
      409,
      'This parent is owned by the interface apply engine. Remove its applied settings before assigning a legacy LAN profile.',
    );
}

export async function assertInterfaceRetired(client: PoolClient, nodeId: string) {
  const conflict = await client.query(
    `SELECT 1 FROM network_interface_applied WHERE node_id=$1
 UNION ALL SELECT 1 FROM network_interface_commits WHERE node_id=$1 AND status IN ('queued','applying','awaiting_confirmation','rollback_failed') LIMIT 1`,
    [nodeId],
  );
  if (conflict.rowCount)
    throw new FabricError(
      409,
      'Remove applied interface settings and resolve pending recovery before archiving or permanently deleting this device.',
    );
}
