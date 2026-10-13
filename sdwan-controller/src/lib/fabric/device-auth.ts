import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { getDatabase } from '../db';
import { FabricError } from './authorization';

export function verifyProxy(request: Request) {
  const secret = process.env.CONTROLLER_AGENT_PROXY_SECRET;
  const supplied = request.headers.get('x-fabric-proxy-secret');
  if (
    !secret ||
    secret.length < 32 ||
    !supplied ||
    Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))
  )
    throw new FabricError(401, 'Trusted agent ingress required.');
}

export async function authenticateDevice(request: Request) {
  verifyProxy(request);
  const serial = request.headers.get('x-fabric-client-serial')?.toLowerCase();
  if (
    request.headers.get('x-fabric-client-verified') !== 'SUCCESS' ||
    !serial ||
    !/^[a-f0-9]{1,64}$/.test(serial)
  )
    throw new FabricError(401, 'Device certificate required.');
  const device = await getDatabase().query<{ id: string; kind: 'branch' | 'hub'; serial: string }>(
    `SELECT n.id,n.kind,c.serial FROM device_certificates c JOIN nodes n ON n.id=c.node_id
    WHERE c.serial=$1 AND c.expires_at>now() AND c.revoked_at IS NULL AND n.revoked_at IS NULL`,
    [serial.replace(/^0+/, '')],
  );
  if (!device.rowCount) throw new FabricError(401, 'Device identity is expired or revoked.');
  return device.rows[0];
}
