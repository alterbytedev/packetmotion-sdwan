import { operatorRequest } from '@/lib/fabric/http';
import { readRoutingSettings, saveRoutingSettings } from '@/lib/fabric/lan';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return operatorRequest(request, false, (actor) => readRoutingSettings(actor));
}
export function PUT(request: Request) {
  return operatorRequest(request, true, (actor, input) => saveRoutingSettings(actor, input));
}
