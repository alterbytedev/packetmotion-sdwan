import { operatorRequest } from '@/lib/fabric/http';
import { FabricError } from '@/lib/fabric/authorization';
import { createOperator, listOperators } from '@/lib/fabric/operator-management';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return operatorRequest(request, false, async (actor) => {
    if (actor.role === 'viewer') throw new FabricError(403, 'Operator administration access required.');
    return { operators: await listOperators() };
  });
}

export function POST(request: Request) {
  return operatorRequest(request, true, async (actor, input) => {
    const result = await createOperator(actor, input);
    return { ...result, message: 'Save this generated password now; it will not be shown again.' };
  });
}
