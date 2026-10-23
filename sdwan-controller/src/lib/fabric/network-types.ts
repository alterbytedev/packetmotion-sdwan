/** Candidate settings only. These are not agent apply instructions. */
export type InterfaceIntent = {
  interfaceName: string;
  vlanId: number | null;
  role: 'wan' | 'lan';
  mode: 'static' | 'dhcp';
  address: string | null;
  gateway: string | null;
  advertisedPrefix: string | null;
  enabled: boolean;
  mtu: number;
};
export type NetworkDraft = {
  version: number;
  baseRevision: number;
  baseLanVersion: number;
  interfaces: InterfaceIntent[];
  safeCommitSeconds: 60;
  updatedAt: string | null;
};

export type InterfaceCommitView = {
  id: string;
  interfaceName: string;
  kind: 'physical' | 'vlan';
  status: 'queued' | 'applying' | 'awaiting_confirmation' | 'applied' | 'rolled_back' | 'rejected' | 'rollback_failed';
  reason: string;
  createdAt: string;
  reportedAt?: string | null;
  actorEmail?: string;
  operation?: string | null;
  deadline?: string | null;
  payload?: { interfaces: InterfaceIntent[] };
};
