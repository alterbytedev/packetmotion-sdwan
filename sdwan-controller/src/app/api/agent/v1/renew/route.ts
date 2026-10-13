import { FabricError } from '@/lib/fabric/authorization';
import { agentRequest, readAgentJson } from '@/lib/fabric/agent-http';
import { renewCertificate } from '@/lib/fabric/renewal';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return agentRequest(request, false, async (device) => {
    if (!device) throw new FabricError(401, 'Device required.');
    return renewCertificate(device, await readAgentJson(request));
  });
}
