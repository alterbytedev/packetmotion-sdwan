import { operatorRequest } from '@/lib/fabric/http';
import { permanentlyDeleteDevice } from '@/lib/fabric/enrollment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return operatorRequest(request, true, async (actor) => {
    const { id } = await context.params;
    return permanentlyDeleteDevice(actor, id);
  });
}
