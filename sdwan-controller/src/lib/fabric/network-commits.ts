import 'server-only';
import { createHash } from 'node:crypto';
import { FabricError } from './authorization';
import { mutate } from './inventory';
import { readInterfaceCapability } from './network-commit-state';
import { networkBaseline, validateNetworkInterfaces } from './network-drafts';
import { assertInterfacePrefixAvailable } from './network-reservations';
import { interfaceSubnet, networkDraftInput } from './network-validation';
import type { Actor } from './types';
import { nodeIdInput } from './validation';
import { lockTopology } from './wireguard-plan';
import { tunnelObject, tunnelVersion } from './wireguard-validation';

export async function applyNetworkDraft(actor: Actor | null, id: string, value: unknown) {
  const nodeId = nodeIdInput(id);
  const input = tunnelObject(value, ['requestId', 'expectedVersion', 'interfaceName', 'kind']);
  if (
    typeof input.requestId !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.requestId) ||
    typeof input.interfaceName !== 'string' ||
    !['physical', 'vlan'].includes(String(input.kind))
  )
    throw new FabricError(400, 'Choose the reported interface and a new commit ID.');
  const version = tunnelVersion(input.expectedVersion);
  const interfaceName = input.interfaceName;
  const kind = String(input.kind);
  return mutate(actor, async (client, fresh) => {
    await lockTopology(client);
    await client.query('SELECT pg_advisory_xact_lock(72011002)');
    const current = await networkBaseline(client, nodeId, true);
    const duplicate = (
      await client.query(
        'SELECT id,node_id,draft_version,interface_name,kind,status,created_at::text AS "createdAt" FROM network_interface_commits WHERE id=$1',
        [input.requestId],
      )
    ).rows[0];
    if (duplicate) {
      if (
        duplicate.node_id !== nodeId ||
        duplicate.draft_version !== version ||
        duplicate.interface_name !== interfaceName ||
        duplicate.kind !== kind
      )
        throw new FabricError(409, 'Commit ID reused with different settings.');
      return {
        commit: {
          id: duplicate.id,
          interfaceName: duplicate.interface_name,
          kind: duplicate.kind,
          status: duplicate.status,
          createdAt: duplicate.createdAt,
        },
      };
    }
    if (
      (
        await client.query(
          "SELECT 1 FROM network_interface_commits WHERE node_id=$1 AND status IN ('queued','applying','awaiting_confirmation','rollback_failed')",
          [nodeId],
        )
      ).rowCount
    )
      throw new FabricError(
        409,
        'A network commit is pending or requires recovery. Resolve it before applying another change.',
      );
    const capability = await readInterfaceCapability(nodeId);
    if (!capability?.interfaces.includes(interfaceName))
      throw new FabricError(
        409,
        'This interface is not locally authorized by a running Fabric interface guard.',
      );
    const draft = (
      await client.query('SELECT * FROM network_drafts WHERE node_id=$1 FOR UPDATE', [nodeId])
    ).rows[0];
    if (
      !draft ||
      draft.version !== version ||
      Number(draft.base_revision) !== current.revision ||
      draft.base_lan_version !== current.lanVersion
    )
      throw new FabricError(
        409,
        'The saved draft or published configuration changed. Save and review again.',
      );
    const validated = networkDraftInput({
      expectedVersion: version,
      baseRevision: current.revision,
      baseLanVersion: current.lanVersion,
      interfaces: draft.interfaces,
      safeCommitSeconds: 60,
    });
    const interfaces = validated.interfaces.filter(
      (entry) =>
        entry.interfaceName === interfaceName &&
        (kind === 'physical' ? entry.vlanId === null : entry.vlanId !== null),
    );
    if (
      interfaces.some(
        (entry) =>
          entry.role !== 'lan' ||
          entry.mode !== 'static' ||
          entry.gateway !== null ||
          entry.advertisedPrefix !== null,
      )
    )
      throw new FabricError(
        409,
        'This apply release supports dedicated static LAN interfaces/VLANs without advertisement. WAN/DHCP and BGP publication require their separate ownership/recovery adapters.',
      );
    if (
      (
        await client.query('SELECT 1 FROM lan_profiles WHERE node_id=$1 AND interface_name=$2', [
          nodeId,
          interfaceName,
        ])
      ).rowCount
    )
      throw new FabricError(
        409,
        'This interface is already owned by the existing LAN/routing profile.',
      );
    const installedCount = Number(
      (
        await client.query(
          `SELECT COALESCE(sum(jsonb_array_length(interfaces)),0)::int AS count FROM network_interface_applied WHERE node_id=$1 AND NOT(interface_name=$2 AND kind=$3)`,
          [nodeId, interfaceName, kind],
        )
      ).rows[0].count,
    );
    if (installedCount + interfaces.length > 16)
      throw new FabricError(
        409,
        'At most 16 installed interface/VLAN settings are supported per device.',
      );
    await validateNetworkInterfaces(client, nodeId, current.site_id, interfaces);
    for (const entry of interfaces)
      if (entry.address)
        await assertInterfacePrefixAvailable(client, interfaceSubnet(entry.address), {
          nodeId,
          interfaceName: interfaceName,
          kind: String(kind),
        });
    const payload = {
      schemaVersion: 1,
      nodeId,
      interfaceName: interfaceName,
      kind: kind,
      safeCommitSeconds: 60,
      interfaces,
    };
    const serialized = JSON.stringify(payload);
    const checksum = createHash('sha256').update(serialized).digest('hex');
    await client.query(
      `INSERT INTO network_interface_commits(id,node_id,draft_version,interface_name,kind,payload,checksum,actor_email)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.requestId, nodeId, version, interfaceName, kind, serialized, checksum, fresh.email],
    );
    await client.query(
      `DELETE FROM network_interface_commits c WHERE c.node_id=$1 AND c.status IN ('applied','rolled_back','rejected')
      AND c.id NOT IN (SELECT id FROM network_interface_commits WHERE node_id=$1 ORDER BY created_at DESC,id LIMIT 100)
      AND NOT EXISTS (SELECT 1 FROM network_interface_applied a WHERE a.commit_id=c.id)`,
      [nodeId],
    );
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_email,action,resource_id) VALUES($1,$2,'network.apply_requested',$3)",
      [fresh.id, fresh.email, nodeId],
    );
    await client.query('SELECT pg_notify($1,$2)', [
      'fabric_desired_revision',
      JSON.stringify({ nodeId, revision: current.revision }),
    ]);
    return {
      commit: {
        id: input.requestId,
        interfaceName: interfaceName,
        kind: kind,
        status: 'queued',
        createdAt: new Date().toISOString(),
      },
    };
  });
}
