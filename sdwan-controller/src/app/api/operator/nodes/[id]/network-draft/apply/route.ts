import { operatorRequest } from '@/lib/fabric/http';
import { applyNetworkDraft } from '@/lib/fabric/network-commits';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, true, (actor, input) => applyNetworkDraft(actor, id, input));
}
