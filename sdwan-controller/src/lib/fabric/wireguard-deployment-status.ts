export type DeploymentDevice = {
  id: string;
  name: string;
  kind: string;
  revoked: boolean;
  lastSeenAt: string | null;
  revision: number | null;
  receipt: string | null;
  applyStatus: string | null;
  observedRevision: number | null;
  observedAt: string | null;
  matchingChecksum: boolean | null;
  online: boolean | null;
  observationFresh: boolean | null;
  tunnelCount: number;
  handshakes: { name: string; lastHandshake: number }[] | null;
};
export type WireguardSettings = { hubIds?: string[]; endpoint?: string; basePort?: number };
export type WireguardDeployment = {
  draft: {
    version: number;
    baseVersion: number | null;
    payload: WireguardSettings | null;
    updatedAt: string | null;
  };
  devices: DeploymentDevice[];
};

export function deploymentStatus(device: DeploymentDevice, now = Date.now()) {
  if (device.revoked)
    return {
      label: 'Revoked',
      next: 'Credentials are revoked. Review the device lifecycle before provisioning a replacement.',
      applied: false,
      ok: false,
    };
  if (!device.online)
    return {
      label: 'Offline or awaiting heartbeat',
      next: 'Check the agent service and controller connectivity. Published configuration stays pending until the device reconnects.',
      applied: false,
      ok: false,
    };
  if (device.receipt === 'rejected')
    return {
      label: 'Configuration rejected',
      next: 'Check agent version and service logs for the rejection. Correct the configuration, save a draft, and deploy again.',
      applied: false,
      ok: false,
    };
  if (!device.revision || device.receipt !== 'received')
    return {
      label: 'Awaiting configuration receipt',
      next: 'Wait for the next agent check-in. If this persists, check management connectivity and the agent service.',
      applied: false,
      ok: false,
    };
  if (device.observedRevision !== device.revision || !device.matchingChecksum)
    return {
      label: 'Received; awaiting apply report',
      next: 'The agent received the latest revision, but its apply result is not current. Check its service logs if the next check-in does not update this status.',
      applied: false,
      ok: false,
    };
  if (!device.observationFresh)
    return {
      label: 'Apply report is stale',
      next: 'Refresh after the next agent check-in. An old report does not prove the current kernel state.',
      applied: false,
      ok: false,
    };
  if (device.applyStatus === 'disabled')
    return {
      label: 'Local activation required',
      next: 'Enable the local WireGuard opt-in on this appliance. Saving or deploying configuration does not grant network privileges. Both Edge and Hub must be activated.',
      applied: false,
      ok: false,
    };
  if (device.applyStatus === 'failed')
    return {
      label: 'Network apply failed',
      next: 'Read the agent service logs to identify the failed preflight/apply step. Correct the local prerequisite; the agent retries reconciliation. Redeploy only when the configuration changes.',
      applied: false,
      ok: false,
    };
  if (device.applyStatus !== 'applied')
    return {
      label: 'Apply not reported',
      next: 'Confirm the agent supports network observations and check its service logs.',
      applied: false,
      ok: false,
    };
  const recent =
    device.handshakes?.length === device.tunnelCount &&
    device.handshakes.every(
      (item) =>
        item.lastHandshake > 0 &&
        now / 1000 - item.lastHandshake <= 180 &&
        item.lastHandshake <= now / 1000 + 300,
    );
  return {
    label:
      device.tunnelCount === 0
        ? 'Applied; no active tunnels'
        : recent
          ? 'Applied; recent handshake observed'
          : 'Applied; no recent handshake',
    next:
      device.tunnelCount === 0
        ? 'The published plan has no tunnels.'
        : recent
          ? 'Verify tunnel-IP reachability separately. A handshake does not prove LAN forwarding.'
          : 'Check the counterpart activation, Hub endpoint, assigned UDP port, firewall/NAT, and peer configuration. No recent handshake is not a verified connectivity result.',
    applied: true,
    // Green only when nothing needs operator attention.
    ok: device.tunnelCount === 0 || recent,
  };
}
