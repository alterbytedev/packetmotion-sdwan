export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Liveness only; use /api/ready to check PostgreSQL readiness.
export function GET() {
  return Response.json(
    { status: 'ok', service: 'sdwan-controller' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
