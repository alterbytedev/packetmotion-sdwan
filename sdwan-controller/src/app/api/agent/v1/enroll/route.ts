import { agentRequest, readAgentJson } from '@/lib/fabric/agent-http';
import { enrollDevice } from '@/lib/fabric/enrollment';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return agentRequest(request, true, async () => enrollDevice(await readAgentJson(request)));
}
