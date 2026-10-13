import { getDatabase } from '@/lib/db';
import { createRequestId, reportServerError } from '@/lib/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    await getDatabase().query('SELECT 1');
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
