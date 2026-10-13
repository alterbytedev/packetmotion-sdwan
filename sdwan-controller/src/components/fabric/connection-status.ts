import type { NodeRecord } from '@/lib/fabric/types';

export const connectionStatusLabels: Record<NodeRecord['connectionStatus'], string> = {
  connected: 'Controller connected',
  offline: 'Controller offline',
  'not-enrolled': 'Not enrolled',
  revoked: 'Revoked',
};
