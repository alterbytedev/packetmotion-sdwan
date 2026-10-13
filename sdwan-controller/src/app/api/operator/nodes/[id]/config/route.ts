import { operatorRequest } from '@/lib/fabric/http';
import { publishConfig, desiredConfig } from '@/lib/fabric/channel';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, false, async () => desiredConfig(id));
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, true, async (actor, input) => publishConfig(actor, id, input));
}
