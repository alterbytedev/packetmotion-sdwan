export type OperatorRole = 'superadmin' | 'admin' | 'viewer';
export type Actor = { id: string; email: string; role: OperatorRole };
export type Site = {
  id: string;
  name: string;
  mode: 'gateway' | 'subnet-router';
  lanPrefix: string | null;
  createdAt: string;
};
export type NodeRecord = {
  id: string;
  siteId: string;
  siteName: string;
  name: string;
  kind: 'hub' | 'branch';
  connectionStatus: 'pending' | 'enrolling' | 'syncing' | 'management-connected' | 'offline' | 'revoked';
  configRevision: number | null;
  configStatus: 'pending' | 'received' | 'rejected' | 'not-configured' | null;
  lastSeenAt: string | null;
  agentVersion?: string | null;
  telemetryReceivedAt?: string | null;
  createdAt: string;
};
export type Inventory = { sites: Site[]; nodes: NodeRecord[]; total?: number; connected?: number };
