import { operatorRequest } from '@/lib/fabric/http';
import { permanentlyDeleteDevices } from '@/lib/fabric/enrollment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return operatorRequest(request, true, async (actor, input) => {
    const ids = input && typeof input === 'object' ? (input as { ids?: unknown }).ids : undefined;
    return permanentlyDeleteDevices(actor, ids);
  });
}
