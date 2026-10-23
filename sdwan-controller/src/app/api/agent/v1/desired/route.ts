import { FabricError } from '@/lib/fabric/authorization';
import { agentRequest } from '@/lib/fabric/agent-http';
import { desiredConfig, waitForDesiredConfig } from '@/lib/fabric/channel';
import { recordConfigDelivery } from '@/lib/fabric/command-history';
import { readPendingDeviceStateRequest } from '@/lib/fabric/device-state';
import { pendingInterfaceRequest } from '@/lib/fabric/network-commit-state';
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
    if (wait === null) {
      const result = await desiredConfig(device.id, revision, checksum);
      if (result.payload) await recordDeliveryIfAvailable(device.id, Number(result.revision));
      const diagnosticRequest = await readPendingDeviceStateRequest(device.id);
      const interfaceRequest = await pendingInterfaceRequest(device.id);
      return { ...result, ...(diagnosticRequest ? { diagnosticRequest } : {}), ...(interfaceRequest ? { interfaceRequest } : {}) };
    }
    if (!/^([1-9]|1\d|2[0-5])$/.test(wait))
      throw new FabricError(400, 'Desired-state wait must be between 1 and 25 seconds.');
    const result = await waitForDesiredConfig(device.id, revision, checksum, Number(wait) * 1000, request.signal,
      async () => Boolean(await readPendingDeviceStateRequest(device.id)));
    if (result.payload) await recordDeliveryIfAvailable(device.id, Number(result.revision));
    const diagnosticRequest = await readPendingDeviceStateRequest(device.id);
    const interfaceRequest = await pendingInterfaceRequest(device.id);
      return { ...result, ...(diagnosticRequest ? { diagnosticRequest } : {}), ...(interfaceRequest ? { interfaceRequest } : {}) };
  });
}

async function recordDeliveryIfAvailable(nodeId: string, revision: number) {
  try {
    await recordConfigDelivery(nodeId, revision);
  } catch (error) {
    // Command history is optional for delivery; desired configuration is core.
    if (error && typeof error === 'object' && 'code' in error && error.code === '42P01') return;
    throw error;
  }
}
