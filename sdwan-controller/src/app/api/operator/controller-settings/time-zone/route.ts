import { operatorRequest } from '@/lib/fabric/http';
import { readControllerTimeZone, saveControllerTimeZone } from '@/lib/fabric/controller-timezone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return operatorRequest(request, false, (actor) => readControllerTimeZone(actor));
}

export function PUT(request: Request) {
  return operatorRequest(request, true, (actor, input) => saveControllerTimeZone(actor, input));
}
