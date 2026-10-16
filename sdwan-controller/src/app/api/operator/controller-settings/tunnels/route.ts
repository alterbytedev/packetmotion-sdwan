import { operatorRequest } from '@/lib/fabric/http';
import { readTunnelSettings, saveTunnelSettings } from '@/lib/fabric/wireguard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return operatorRequest(request, false, (actor) => readTunnelSettings(actor));
}
export function PUT(request: Request) {
  return operatorRequest(request, true, (actor, input) => saveTunnelSettings(actor, input));
}
