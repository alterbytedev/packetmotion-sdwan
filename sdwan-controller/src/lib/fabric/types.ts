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
  connectionStatus: 'connected' | 'offline' | 'not-enrolled' | 'revoked';
  lastSeenAt: string | null;
  createdAt: string;
};
export type Inventory = { sites: Site[]; nodes: NodeRecord[]; total?: number; connected?: number };
