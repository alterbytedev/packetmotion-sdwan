import { operatorRequest } from '@/lib/fabric/http';
import { readConnectionDiagnostics } from '@/lib/fabric/connection-diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return operatorRequest(request, false, async (actor) => {
    const { id } = await context.params;
    return readConnectionDiagnostics(actor, id);
  });
}
