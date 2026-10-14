import { FabricError } from '@/lib/fabric/authorization';
import { agentRequest } from '@/lib/fabric/agent-http';
import { desiredConfig } from '@/lib/fabric/channel';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return agentRequest(request, false, async (device) => {
    if (!device) throw new FabricError(401, 'Device required.');
    const query = new URL(request.url).searchParams;
    return desiredConfig(device.id, query.get('revision'), query.get('checksum'));
  });
}
