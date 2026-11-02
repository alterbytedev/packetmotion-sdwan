import { operatorRequest } from '@/lib/fabric/http';
import { readTransitPolicy, saveTransitDraft } from '@/lib/fabric/transit-policy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return operatorRequest(request, false, (actor) => readTransitPolicy(actor));
}
export function PUT(request: Request) {
  return operatorRequest(request, true, (actor, input) => saveTransitDraft(actor, input));
}
