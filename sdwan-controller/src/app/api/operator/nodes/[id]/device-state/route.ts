import { operatorRequest } from '@/lib/fabric/http';
import { FabricError } from '@/lib/fabric/authorization';
import { readDeviceState, requestDeviceState } from '@/lib/fabric/device-state';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return operatorRequest(request, false, async (actor) => readDeviceState(actor, (await params).id));
}
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return operatorRequest(request, true, async (actor, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)
      throw new FabricError(400, 'Device state request must be an empty JSON object.');
    return requestDeviceState(actor, (await params).id);
  });
}
