import { operatorRequest } from '@/lib/fabric/http';
import { renameNode } from '@/lib/fabric/inventory';
import { archiveDevice } from '@/lib/fabric/enrollment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return operatorRequest(request, true, async (actor, input) => {
    const { id } = await context.params;
    return renameNode(actor, id, input);
  });
}

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return operatorRequest(request, true, async (actor) => {
    const { id } = await context.params;
    return archiveDevice(actor, id);
  });
}
