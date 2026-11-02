import { operatorRequest } from '@/lib/fabric/http';
import { deployTransitDraft } from '@/lib/fabric/transit-policy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return operatorRequest(request, true, (actor, input) => deployTransitDraft(actor, input));
}
