import { FabricError } from '@/lib/fabric/authorization';
import { agentRequest, readAgentJson } from '@/lib/fabric/agent-http';
import { acknowledgeConfig } from '@/lib/fabric/channel';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return agentRequest(request, false, async (device) => {
    if (!device) throw new FabricError(401, 'Device required.');
    return acknowledgeConfig(device.id, await readAgentJson(request));
  });
}
