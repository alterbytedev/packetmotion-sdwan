import type { NodeRecord } from '@/lib/fabric/types';

export const connectionStatusLabels: Record<NodeRecord['connectionStatus'], string> = {
  pending: 'Pending',
  enrolling: 'Enrolling',
  syncing: 'Syncing',
  'management-connected': 'Management connected',
  offline: 'Controller offline',
  revoked: 'Revoked',
};
