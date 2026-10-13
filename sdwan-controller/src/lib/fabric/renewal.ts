import 'server-only';
import { getDatabase } from '../db';
import { FabricError } from './authorization';
import { signDeviceCertificate } from './pki';

export async function renewCertificate(device: { id: string; serial: string }, value: unknown) {
  const input = value as { csr?: unknown };
  if (!input || Object.keys(input).some((key) => key !== 'csr'))
    throw new FabricError(400, 'Invalid renewal request.');
  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT c.public_key_hash FROM device_certificates c JOIN nodes n ON n.id=c.node_id
      WHERE c.serial=$1 AND n.id=$2 AND n.revoked_at IS NULL AND c.revoked_at IS NULL AND c.expires_at>now() FOR UPDATE OF n,c`,
      [device.serial, device.id],
    );
    if (!current.rowCount) throw new FabricError(401, 'Device identity revoked.');
    const issued = await signDeviceCertificate(device.id, input.csr);
    if (issued.publicKeyHash !== current.rows[0].public_key_hash)
      throw new FabricError(400, 'Renewal must prove the enrolled key.');
    // Overlap permits recovery if a renewal response is lost. Reuse a recent certificate for the same key.
    const recent = await client.query(
      `SELECT certificate_pem,expires_at FROM device_certificates WHERE node_id=$1 AND public_key_hash=$2
      AND revoked_at IS NULL AND expires_at>now()+interval '7 days' ORDER BY created_at DESC LIMIT 1`,
      [device.id, issued.publicKeyHash],
    );
    if (recent.rowCount) {
      await client.query('COMMIT');
      return {
        certificate: recent.rows[0].certificate_pem,
        ca: issued.ca,
        expiresAt: new Date(recent.rows[0].expires_at).toISOString(),
      };
    }
    await client.query(
      'INSERT INTO device_certificates(serial,node_id,certificate_pem,public_key_hash,expires_at) VALUES($1,$2,$3,$4,$5)',
      [issued.serial, device.id, issued.certificate, issued.publicKeyHash, issued.expiresAt],
    );
    await client.query(
      "INSERT INTO audit_events(actor_email,action,resource_id) VALUES($1,'device.renewed',$2)",
      [`device:${device.id}`, device.id],
    );
    await client.query('COMMIT');
    return {
      certificate: issued.certificate,
      ca: issued.ca,
      expiresAt: issued.expiresAt.toISOString(),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
