import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getDatabase } from '../db';
import { FabricError } from './authorization';
import { mutate } from './inventory';
import { auditCreation } from './audit';
import { signDeviceCertificate } from './pki';
import type { Actor } from './types';

export async function issueToken(client: PoolClient, actor: Actor, nodeId: string) {
  const token = `pm_enroll_${randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  await client.query(
    `INSERT INTO enrollment_tokens (node_id,token_hash,expires_at) VALUES ($1,$2,$3)
    ON CONFLICT(node_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,consumed_at=NULL,revoked_at=NULL`,
    [nodeId, createHash('sha256').update(token).digest('hex'), expiresAt],
  );
  await auditCreation(client, actor, 'enrollment.issued', nodeId);
  return { token, expiresAt };
}

export async function reissueEnrollment(actor: Actor | null, nodeId: string) {
  return mutate(actor, async (client, fresh) => {
    const node = await client.query(
      'SELECT enrolled_at,revoked_at,last_seen_at FROM nodes WHERE id=$1 FOR UPDATE',
      [nodeId],
    );
    if (!node.rowCount) throw new FabricError(404, 'Device not found.');
    if (node.rows[0].revoked_at)
      throw new FabricError(409, 'Device is already enrolled or revoked.');
    if (node.rows[0].enrolled_at) {
      if (node.rows[0].last_seen_at)
        throw new FabricError(409, 'An active device cannot have its enrollment reset.');
      await client.query('UPDATE device_certificates SET revoked_at=now() WHERE node_id=$1 AND revoked_at IS NULL', [nodeId]);
      await client.query('UPDATE enrollment_tokens SET revoked_at=now() WHERE node_id=$1 AND revoked_at IS NULL', [nodeId]);
      await client.query('UPDATE nodes SET enrolled_at=NULL WHERE id=$1', [nodeId]);
      await auditCreation(client, fresh, 'device.enrollment_reset', nodeId);
    }
    return issueToken(client, fresh, nodeId);
  });
}

export async function revokeDevice(actor: Actor | null, nodeId: string) {
  return mutate(actor, async (client, fresh) => {
    const node = await client.query('UPDATE nodes SET revoked_at=now() WHERE id=$1 RETURNING id', [
      nodeId,
    ]);
    if (!node.rowCount) throw new FabricError(404, 'Device not found.');
    await client.query('UPDATE enrollment_tokens SET revoked_at=now() WHERE node_id=$1', [nodeId]);
    await client.query('UPDATE device_certificates SET revoked_at=now() WHERE node_id=$1', [
      nodeId,
    ]);
    await auditCreation(client, fresh, 'device.revoked', nodeId);
    return { revoked: true };
  });
}

export async function enrollDevice(value: unknown) {
  const data = value as { token?: unknown; csr?: unknown };
  if (
    !data ||
    typeof data.token !== 'string' ||
    !/^pm_enroll_[a-f0-9]{64}$/.test(data.token) ||
    Object.keys(data).some((key) => !['token', 'csr'].includes(key))
  )
    throw new FabricError(400, 'Invalid enrollment request.');
  const pool = getDatabase();
  const hash = createHash('sha256').update(data.token).digest('hex');
  await pool.query(
    "DELETE FROM enrollment_attempts WHERE window_started_at < date_trunc('minute',now()) - interval '1 minute'",
  );
  const attempt = await pool.query(
    `INSERT INTO enrollment_attempts VALUES($1,date_trunc('minute',now()),1)
    ON CONFLICT(attempt_key) DO UPDATE SET attempts=CASE WHEN enrollment_attempts.window_started_at < date_trunc('minute',now()) THEN 1 ELSE enrollment_attempts.attempts+1 END,
    window_started_at=date_trunc('minute',now()) RETURNING attempts<=5 AS allowed`,
    [hash],
  );
  if (!attempt.rows[0].allowed) throw new FabricError(429, 'Too many enrollment attempts.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const token = await client.query(
      `SELECT t.node_id,n.kind FROM enrollment_tokens t JOIN nodes n ON n.id=t.node_id
      WHERE t.token_hash=$1 AND t.expires_at>now() AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND n.revoked_at IS NULL AND n.enrolled_at IS NULL FOR UPDATE OF n,t`,
      [hash],
    );
    if (!token.rowCount)
      throw new FabricError(401, 'Enrollment token is expired, used, or revoked.');
    const node = token.rows[0];
    const issued = await signDeviceCertificate(node.node_id, data.csr);
    await client.query(
      'INSERT INTO device_certificates(serial,node_id,certificate_pem,public_key_hash,expires_at) VALUES($1,$2,$3,$4,$5)',
      [issued.serial, node.node_id, issued.certificate, issued.publicKeyHash, issued.expiresAt],
    );
    await client.query('UPDATE enrollment_tokens SET consumed_at=now() WHERE node_id=$1', [
      node.node_id,
    ]);
    await client.query('UPDATE nodes SET enrolled_at=now() WHERE id=$1', [node.node_id]);
    await client.query(
      "INSERT INTO audit_events(actor_email,action,resource_id) VALUES($1,'device.enrolled',$2)",
      [`device:${node.node_id}`, node.node_id],
    );
    await client.query('COMMIT');
    return {
      nodeId: node.node_id,
      kind: node.kind,
      certificate: issued.certificate,
      ca: issued.ca,
      expiresAt: issued.expiresAt.toISOString(),
      agentUrl: process.env.CONTROLLER_AGENT_URL || null,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
