import 'server-only';
import { getDatabase } from '../db';
import { FabricError } from './authorization';
import { tunnelObject } from './wireguard-validation';
import { appendCommandEvent } from './command-history';

export async function recordWireguardStatus(nodeId: string, value: unknown) {
  const input = tunnelObject(value, ['revision', 'checksum', 'status', 'handshakes', 'bgpPeers']);
  const reportedBGPPeers = input.bgpPeers === undefined ? [] : input.bgpPeers;
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1 ||
      typeof input.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(input.checksum) ||
      !['disabled', 'applied', 'failed'].includes(String(input.status)) ||
      !Array.isArray(input.handshakes) || input.handshakes.length > 128 ||
      !Array.isArray(reportedBGPPeers) || reportedBGPPeers.length > 128)
    throw new FabricError(400, 'Invalid WireGuard status.');
  if (input.status !== 'applied' && (input.handshakes.length || reportedBGPPeers.length))
    throw new FabricError(400, 'Only applied interfaces can report tunnel and BGP observations.');
  const names = new Set<string>();
  for (const item of input.handshakes) {
    const entry = tunnelObject(item, ['name', 'lastHandshake']);
    if (typeof entry.name !== 'string' || !/^pm[0-9a-f]{12}$/.test(entry.name) || names.has(entry.name) ||
        !Number.isSafeInteger(entry.lastHandshake) || Number(entry.lastHandshake) < 0 ||
        Number(entry.lastHandshake) > Math.floor(Date.now()/1000)+300)
      throw new FabricError(400, 'Invalid WireGuard handshake.');
    names.add(entry.name);
  }
  const bgpAddresses = new Set<string>();
  for (const item of reportedBGPPeers) {
    const entry = tunnelObject(item, ['address', 'state', 'receivedPrefixes']);
    if (typeof entry.address !== 'string' || bgpAddresses.has(entry.address) ||
        !['Idle', 'Connect', 'Active', 'OpenSent', 'OpenConfirm', 'Established', 'Unavailable'].includes(String(entry.state)) ||
        !Number.isSafeInteger(entry.receivedPrefixes) || Number(entry.receivedPrefixes) < 0 || Number(entry.receivedPrefixes) > 1)
      throw new FabricError(400, 'Invalid BGP peer observation.');
    bgpAddresses.add(entry.address);
  }
  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');
    const node = await client.query('SELECT id FROM nodes WHERE id=$1 AND revoked_at IS NULL FOR UPDATE', [nodeId]);
    if (!node.rowCount) throw new FabricError(401, 'Device is revoked.');
    const latest = (await client.query('SELECT revision,checksum,payload FROM desired_configs WHERE node_id=$1 ORDER BY revision DESC LIMIT 1', [nodeId])).rows[0];
    if (!latest || latest.revision !== input.revision || latest.checksum !== input.checksum)
      throw new FabricError(409, 'Status does not match the current desired revision.');
    const plan = JSON.parse(latest.payload).wireguard;
    const expectedPeers: string[] = plan?.routing?.bgp?.peers?.map((peer: { address: string }) => peer.address) ?? [];
    if (!plan || [...names].some((name) => !plan.tunnels.some((t: { name: string }) => t.name === name)) ||
        (input.status === 'applied' && names.size !== plan.tunnels.length) ||
        (input.status === 'applied' && (bgpAddresses.size !== expectedPeers.length || expectedPeers.some(address => !bgpAddresses.has(address)))))
      throw new FabricError(400, 'Status must describe the current tunnel interfaces.');
    const previous = await client.query<{ revision: number; status: string }>(
      'SELECT revision,status FROM wireguard_observed WHERE node_id=$1 FOR UPDATE', [nodeId],
    );
    const stateChanged = !previous.rowCount || previous.rows[0].revision !== input.revision || previous.rows[0].status !== input.status;
    await client.query(`INSERT INTO wireguard_observed(node_id,revision,checksum,status,handshakes,bgp_peers) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(node_id) DO UPDATE SET revision=excluded.revision,checksum=excluded.checksum,status=excluded.status,
      handshakes=excluded.handshakes,bgp_peers=excluded.bgp_peers,received_at=now()`,
    [nodeId, input.revision, input.checksum, input.status, JSON.stringify(input.handshakes), JSON.stringify(reportedBGPPeers)]);
    // The agent reports current state on each reconcile cycle. Keep observation fresh,
    // but only add a history event when the reported state actually changes.
    if (stateChanged)
      await appendCommandEvent(client, nodeId, Number(input.revision), String(input.status) as 'disabled' | 'applied' | 'failed');
    await client.query('COMMIT'); return { recorded: true };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
