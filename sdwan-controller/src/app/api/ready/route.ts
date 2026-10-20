import { getDatabase } from '@/lib/db';
import { createRequestId, reportServerError } from '@/lib/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requiredSchema = `
  WITH required(table_name,column_name) AS (VALUES
    ('nodes','id'),('nodes','last_seen_at'),('nodes','revoked_at'),
    ('device_certificates','serial'),('device_certificates','node_id'),('device_certificates','expires_at'),('device_certificates','revoked_at'),
    ('desired_configs','node_id'),('desired_configs','revision'),('desired_configs','payload'),('desired_configs','checksum'),
    ('config_acknowledgements','node_id'),('config_acknowledgements','revision'),('config_acknowledgements','status'),
    ('device_telemetry','node_id'),('device_telemetry','event_id'),('device_telemetry','snapshot'),('device_telemetry','checksum'),('device_telemetry','received_at')
  ), relations AS (
    SELECT table_name,column_name,to_regclass(format('%I.%I','public',table_name)) AS relation_id
    FROM required
  )
  SELECT table_name,column_name FROM relations r
  WHERE relation_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid=r.relation_id AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped
  )`;

export async function GET() {
  const requestId = createRequestId();
  const headers = { 'Cache-Control': 'no-store', 'X-Request-ID': requestId };

  if (!process.env.DATABASE_URL) {
    return Response.json(
      { status: 'not_ready', service: 'sdwan-controller', dependency: 'database', requestId },
      { status: 503, headers },
    );
  }

  try {
    const schema = await getDatabase().query(requiredSchema);
    if (schema.rowCount) {
      return Response.json(
        { status: 'not_ready', service: 'sdwan-controller', dependency: 'schema', requestId },
        { status: 503, headers },
      );
    }
    return Response.json({ status: 'ready', service: 'sdwan-controller' }, { headers });
  } catch (error) {
    await reportServerError('readiness.database', requestId, error, {
      routePath: '/api/ready',
      method: 'GET',
    });
    return Response.json(
      { status: 'not_ready', service: 'sdwan-controller', dependency: 'database', requestId },
      { status: 503, headers },
    );
  }
}
