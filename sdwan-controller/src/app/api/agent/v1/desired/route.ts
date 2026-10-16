import { FabricError } from '@/lib/fabric/authorization';
import { agentRequest } from '@/lib/fabric/agent-http';
import { desiredConfig, waitForDesiredConfig } from '@/lib/fabric/channel';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return agentRequest(request, false, async (device) => {
    if (!device) throw new FabricError(401, 'Device required.');
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !['revision', 'checksum', 'wait'].includes(key)))
      throw new FabricError(400, 'Unsupported desired-state query.');
    const revision = query.get('revision');
    const checksum = query.get('checksum');
    const wait = query.get('wait');
    if (wait === null) return desiredConfig(device.id, revision, checksum);
    if (!/^([1-9]|1\d|2[0-5])$/.test(wait))
      throw new FabricError(400, 'Desired-state wait must be between 1 and 25 seconds.');
    return waitForDesiredConfig(device.id, revision, checksum, Number(wait) * 1000, request.signal);
  });
}
