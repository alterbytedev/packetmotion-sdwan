import 'server-only';
import type { PoolClient } from 'pg';
import type { Actor } from './types';

export async function auditCreation(
  client: PoolClient,
  actor: Actor,
  action:
    | 'site.created'
    | 'node.created'
    | 'enrollment.issued'
    | 'device.enrollment_reset'
    | 'device.revoked'
    | 'config.published',
  resourceId: string,
) {
  await client.query(
    'INSERT INTO audit_events (actor_id,actor_email,action,resource_id) VALUES ($1,$2,$3,$4)',
    [actor.id, actor.email, action, resourceId],
  );
}
