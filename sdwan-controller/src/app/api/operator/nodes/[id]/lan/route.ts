import { operatorRequest } from '@/lib/fabric/http';
import { readLan, saveLan } from '@/lib/fabric/lan';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, false, (actor) => readLan(actor, id));
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, true, (actor, input) => saveLan(actor, id, input));
}
