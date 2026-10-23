import { agentRequest, readAgentJson } from '@/lib/fabric/agent-http';
import { FabricError } from '@/lib/fabric/authorization';
import { confirmInterfaceCommit } from '@/lib/fabric/network-commit-state';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return agentRequest(request, false, async (device) => {
    if (!device) throw new FabricError(401, 'Device required.');
    return confirmInterfaceCommit(device.id, await readAgentJson(request));
  });
}
