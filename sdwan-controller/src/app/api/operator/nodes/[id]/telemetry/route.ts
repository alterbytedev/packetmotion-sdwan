import { operatorRequest } from '@/lib/fabric/http';
import { readTelemetry } from '@/lib/fabric/channel';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, false, async (actor) => readTelemetry(actor, id));
}
