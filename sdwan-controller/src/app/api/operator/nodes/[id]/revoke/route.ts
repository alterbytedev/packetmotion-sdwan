import { operatorRequest } from '@/lib/fabric/http';
import { revokeDevice } from '@/lib/fabric/enrollment';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, true, async (actor) => revokeDevice(actor, id));
}
