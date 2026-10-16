import { operatorRequest } from '@/lib/fabric/http';
import { readWireguardDevice, saveWireguardDevice } from '@/lib/fabric/wireguard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, false, (actor) => readWireguardDevice(actor, id));
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, true, (actor, input) => saveWireguardDevice(actor, id, input));
}
