export type OperatorRole = 'superadmin' | 'admin' | 'viewer';
export type Actor = { id: string; email: string; role: OperatorRole };
export type Site = {
  id: string;
  name: string;
  mode: 'gateway' | 'subnet-router';
  lanPrefix: string | null;
  createdAt: string;
};
// Latest desired-config tunnel count and WireGuard observation; null before any revision.
export type SdwanObservation = {
  applyStatus: string | null;
  observedRevision: number | null;
  observedAt: string | null;
  matchingChecksum: boolean | null;
  observationFresh: boolean | null;
  tunnelCount: number;
  handshakes: { name: string; lastHandshake: number }[] | null;
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
  sdwan?: SdwanObservation | null;
  createdAt: string;
};
export type Inventory = { sites: Site[]; nodes: NodeRecord[]; total?: number; connected?: number };
