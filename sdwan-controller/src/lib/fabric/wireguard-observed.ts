import 'server-only';
import { getDatabase } from '../db';
import { FabricError } from './authorization';
import { tunnelObject } from './wireguard-validation';

export async function recordWireguardStatus(nodeId: string, value: unknown) {
  const input = tunnelObject(value, ['revision', 'checksum', 'status', 'handshakes']);
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1 ||
      typeof input.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(input.checksum) ||
      !['disabled', 'applied', 'failed'].includes(String(input.status)) ||
      !Array.isArray(input.handshakes) || input.handshakes.length > 128)
    throw new FabricError(400, 'Invalid WireGuard status.');
  if (input.status !== 'applied' && input.handshakes.length) throw new FabricError(400, 'Only applied interfaces can report handshakes.');
  const names = new Set<string>();
  for (const item of input.handshakes) {
    const entry = tunnelObject(item, ['name', 'lastHandshake']);
    if (typeof entry.name !== 'string' || !/^pm[0-9a-f]{12}$/.test(entry.name) || names.has(entry.name) ||
        !Number.isSafeInteger(entry.lastHandshake) || Number(entry.lastHandshake) < 0 ||
        Number(entry.lastHandshake) > Math.floor(Date.now()/1000)+300)
      throw new FabricError(400, 'Invalid WireGuard handshake.');
    names.add(entry.name);
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
    if (!plan || [...names].some((name) => !plan.tunnels.some((t: { name: string }) => t.name === name)) ||
        (input.status === 'applied' && names.size !== plan.tunnels.length))
      throw new FabricError(400, 'Status must describe the current tunnel interfaces.');
    await client.query(`INSERT INTO wireguard_observed(node_id,revision,checksum,status,handshakes) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(node_id) DO UPDATE SET revision=excluded.revision,checksum=excluded.checksum,status=excluded.status,
      handshakes=excluded.handshakes,received_at=now()`, [nodeId, input.revision, input.checksum, input.status, JSON.stringify(input.handshakes)]);
    await client.query('COMMIT'); return { recorded: true };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
