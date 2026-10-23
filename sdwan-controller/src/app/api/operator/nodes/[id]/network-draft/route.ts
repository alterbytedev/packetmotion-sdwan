import { operatorRequest } from '@/lib/fabric/http';
import { readNetworkDraft, saveNetworkDraft } from '@/lib/fabric/network-drafts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, false, (actor) => readNetworkDraft(actor, id));
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, true, (actor, input) => saveNetworkDraft(actor, id, input));
}
