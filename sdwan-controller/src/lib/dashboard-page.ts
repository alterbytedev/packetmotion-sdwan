import 'server-only';
import { requireUser } from '@/lib/auth';
import { currentActor, FabricError } from '@/lib/fabric/authorization';
import { dashboardInventory, getDevice } from '@/lib/fabric/inventory';
import { getControllerTimeZone } from '@/lib/fabric/controller-timezone';
import type { Inventory, NodeRecord, OperatorRole } from '@/lib/fabric/types';
import type { DashboardView } from '@/components/controller-dashboard';
import { availableAgentReleases } from './fabric/agent-releases';

export async function dashboardPageData(view: DashboardView, deviceId?: string) {
  const email = await requireUser();
  let inventory: Inventory = { sites: [], nodes: [] };
  let selectedDevice: NodeRecord | undefined;
  let role: OperatorRole = 'viewer';
  let inventoryError: string | undefined;
  try {
    const actor = await currentActor();
    inventory = await dashboardInventory(actor);
    if (view === 'devices' && deviceId) selectedDevice = await getDevice(actor, deviceId);
    role = actor?.role ?? 'viewer';
  } catch (error) {
    inventoryError =
      error instanceof FabricError && error.status === 404
        ? 'Device not found. Return to Devices and choose an existing device.'
        : 'Inventory is unavailable. Contact your controller administrator.';
  }
  const timeZone = await getControllerTimeZone();
  const agentReleases = view === 'devices' && selectedDevice && role === 'superadmin' ? await availableAgentReleases() : [];
  return { email, inventory, role, inventoryError, selectedDevice, timeZone, agentReleases };
}
