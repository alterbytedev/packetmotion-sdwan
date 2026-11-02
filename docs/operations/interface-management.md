# Interface and VLAN configuration

## Network tab interface workflow

Device details → Network lists reported interfaces with their current IPv4/IPv6 CIDRs. An empty address list means unassigned; absent addresses mean an older agent or unavailable observation. **Configure** opens settings for that interface and prefills its first observed IPv4 address. **VLANs** opens tagged settings for its physical parent. Kernel-reported VLAN tags and parents are shown. Loopback and Fabric tunnels remain informational. Viewers have read-only access. Refresh reads the latest heartbeat; it does not force a new appliance sample.

Admins can save versioned candidates for static IPv4, WAN DHCP/gateway, MTU, enabled state and exact optional LAN advertisements. Saving preserves other interface scopes and does not apply anything. **Save and apply** saves then queues only the selected physical or VLAN scope. Queueing is distinct from successful apply. A failure between save and queue leaves a saved candidate that can be reviewed again.

The first apply adapter supports **locally authorized dedicated static LAN interfaces and VLANs only**, without gateway, WAN/DHCP or advertisement. Those other candidate settings remain saveable but cannot be applied with this adapter. General forwarding remains blocked by an owned nftables guard. VLAN creation does not imply switch trunk connectivity or BGP advertisement. Multi-prefix advertisement and WAN/DHCP ownership/recovery remain pending under the [implementation plan](../development/interface-vlan-management-plan.md).

## Controller and agent delivery

Apply migrations **0022** and **0023** with `npm run migrate:controller` before serving these APIs. Applied migrations are immutable. Candidate saves and apply requests are audited; current roles are checked transactionally. Apply rechecks revision/LAN baselines, installed and pending prefix reservations and legacy LAN ownership. One active commit per device is allowed; rollback failure blocks further commits. Desired revision checksums/schema 1–3 are unchanged: the existing authenticated desired response carries a separate checksummed typed interface request. Receipt never means applied.

Agent source 0.4.0 collects addresses and supports the commit protocol. The normal management service stays unprivileged. A separately installed root supervisor performs only validated network operations; no arbitrary command input is accepted. See [ADR 0007](../adr/0007-interface-safe-commit.md).

After verifying dedicated NIC ownership, actual switch mapping and independent console recovery, an appliance administrator can authorize interfaces locally:

```sh
sudo fabric-agent network enable-interfaces --interfaces ens36 --confirm-exclusive
```

This requires the installed running enrolled agent, root-owned executable and protected parent directories, and no competing LAN/routing owner. It installs `/etc/packetmotion/interface-policy.json` and `fabric-interface-guard.service`. Existing policy/unit/recovery state is never overwritten; review changes locally. The controller cannot grant this privilege. Readiness appears through a fresh agent heartbeat. This command has **not** been executed on the supplied physical Hub because trunk mapping and console recovery are unknown. Do not copy this example as an instruction to activate that Hub yet.

Management/default-route NICs, controller routes and active WireGuard endpoints are protected. Existing foreign addresses, global IPv6, interface masters, foreign VLANs and overlapping routes are refused. Only dedicated NICs without another network manager are supported; local confirmation asserts exclusive ownership. IPv6 configuration, resolver management and DHCP adapters are outside this release. The CLI `fabric-agent network inspect` provides bounded read-only selected interface/route/service observations; it cannot establish switch mapping or ownership by itself.

## Safe commit and history

The root supervisor journals previous and proposed state before mutation. A monotonic **60-second deadline starts before apply**. The management agent must complete a new authenticated controller round trip with matching node, commit, checksum and random nonce before expiry. The supervisor independently kills a stuck worker and restores the previous confirmed configuration when confirmation is missing. Ordinary shutdown rolls pending work back; a pending journal after a crash is recovered before accepting new work. The independent systemd watchdog restarts a stalled supervisor. Confirmed settings are restored at service startup without controller access and are not removed merely because the controller later disconnects.

Root journals live in `/var/lib/packetmotion-interfaces` (0700); public operational reports remain inside the existing private agent state directory. Both reconcilers share the existing network lock. The guard retains at most 50 result records, never discards an unacknowledged result to accept a new mutation, and retries eventual reporting after reconnection. The controller retains the latest 100 commits plus snapshots referenced by installed scopes, up to 100 events per commit; the UI shows the latest ten. Reports are deduplicated. No raw command output, credentials or private keys are sent.

History shows queue/apply/confirmation/rollback status, actor, timestamps, safe deadline, failure category and typed operation when available. **Edit and retry** copies failed settings into the editor; correction and application create a new immutable commit. Failed candidates are not repeatedly applied automatically. History polling runs only for active commits and is bounded to 40 reads at two-second intervals; reopen the editor afterward to refresh.

A rollback failure needs local console investigation; the controller does not claim restoration succeeded. Do not delete root journals to dismiss the error. Remove owned scopes through successful empty-scope commits before retiring the local guard or reenrolling the appliance. Identity-reset paths refuse existing guard policy/state. Archiving/permanent deletion are refused while applied scopes or pending recovery remain. Security revocation remains available and retains reservations; it cannot remotely undo offline networking. Retire owned settings before routine revocation. Keep old binaries and unit configuration for upgrade rollback; a running guard uses its own executable inode for workers during an atomic binary upgrade.

## Supplied Hub and verification limits

The [discovery report](../evidence/interface-inspection/hub-2026-10-22.json) records Debian 13.7, iproute2 6.15.0 and FRR 10.3. `ens33` has DHCP `192.168.160.142/24` with default gateway `192.168.160.2`; the bootstrap DHCP owner must be preserved. `ens34`–`ens36` were down/unaddressed. The user selected ens36 for a future trunk, whose mapping is not established. The participating Edge and console recovery are unknown.

Isolated mount/network namespace tests exercise real static address/MTU changes, VLAN create/delete, confirmed service restart, interrupted rollback, failed-candidate suppression and the actual 60-second deadline with confirmation withheld. Separate TLS agent tests and disposable controller/browser tests cover reporting, confirmation, reservations, access control and edit/retry. These are not physical Debian reboot, switch trunk, WAN, BGP or routed-traffic evidence. Disk exhaustion, arbitrary kernel hangs, fleet rollout and physical controller-disconnection recovery remain **UNVERIFIED**. See the [change log](../change-logs/log_change_001.md) for actual checks and failed iterations.

## Rollback

Revert only this feature's source changes, retaining unrelated work, applied migrations and audit/commit records. On an activated appliance, first remove owned scopes through confirmed commits and verify restoration locally. Stop/retire the guard only after that recovery; preserve journals until reviewed. Downgrade an upgraded management binary using its saved binary/unit and restart the management service. No physical interface settings are changed merely by installing an agent or saving a candidate.

### Supplied Hub management upgrade

Signed release 0.4.0 was SHA-256 verified and installed on `pm-hub-001` on 2026-10-22. Its existing WireGuard-only service override now points at `/opt/packetmotion-lab/fabric-agent-0.4.0`; all original flags/capabilities were retained. The previous override is `/opt/packetmotion-lab/90-wireguard-lab.before-0.4.0.conf`; its old executable was preserved. The controller received a real 0.4.0 heartbeat with ens33 `192.168.160.142/24`, ens34–ens36 unassigned, and tunnel `10.250.0.2/31`. The default CLI binary was also upgraded, retaining its previous file at `/opt/packetmotion-lab/fabric-agent-installed.before-0.4.0`. No interface guard authorization or physical address/VLAN apply was performed.

For management upgrade rollback, restore those saved binary/override files, run `systemctl daemon-reload`, then restart `fabric-agent`. Preserve identity and network state. Restoring the old agent removes current-IP reporting on subsequent heartbeats.
