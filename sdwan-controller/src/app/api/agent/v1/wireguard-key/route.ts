import { FabricError } from '@/lib/fabric/authorization';
import { agentRequest, readAgentJson } from '@/lib/fabric/agent-http';
import { registerWireguardKey } from '@/lib/fabric/wireguard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return agentRequest(request, false, async (device) => {
    if (!device) throw new FabricError(401, 'Device required.');
    return registerWireguardKey(device.id, await readAgentJson(request));
  });
}
