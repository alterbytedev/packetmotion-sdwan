import 'server-only';
import { requireUser } from '@/lib/auth';
import { currentActor, FabricError } from '@/lib/fabric/authorization';
import { dashboardInventory, getDevice } from '@/lib/fabric/inventory';
import type { Inventory, NodeRecord, OperatorRole } from '@/lib/fabric/types';
import type { DashboardView } from '@/components/controller-dashboard';

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
  return { email, inventory, role, inventoryError, selectedDevice };
}
