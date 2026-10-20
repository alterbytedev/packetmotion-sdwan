# Selected hub WireGuard tunnels

This feature adds saved hub selection and automatic **tunnel** addressing. Signed agent release 0.2.0 includes local opt-in apply and device-state reporting. The default service remains unprivileged and does not enable WireGuard; an explicitly reviewed local systemd drop-in is still required. Do not treat received configuration as applied, or applied interfaces as verified LAN routing.

## Dashboard setup

1. A superadmin opens Settings → Tunnel addressing and chooses an unused canonical private IPv4 pool, for example `10.250.0.0/24`. Supported prefix lengths are 16–30. Confirm it does not overlap management, underlay, existing LANs or VPN routes across the deployment; the controller cannot discover every host's routes.
2. Upgrade the intended Hub and Edge agents from reviewed source after isolated validation. Signed 0.3.3 agents register public keys during management reconciliation, including with network apply disabled. Enable WireGuard locally as described below only when ready to apply tunnels. Agents register only their public keys; retain their private state.
3. On each Hub device detail page, set a reachable underlay IPv4 endpoint and base UDP port. The controller reserves 128 consecutive ports for that Hub, one per Edge adjacency. Overlapping ranges on the same endpoint address are rejected. Configure external firewalls/NAT to permit the necessary UDP traffic; the agent does not open them.
4. On an Edge detail page, select up to eight available keyed Hubs and save. Each pair receives a stable /31, separate interface and UDP port. Both peer revisions are published atomically. No branch LAN address is changed.
5. Inspect receipt status, Network apply and per-interface last handshake separately. Reports retain timestamps and revisions; a previous revision or old timestamp is not current proof. A zero handshake means none observed. Use tunnel-IP ping in the isolated lab to verify traffic.

Only superadmins change the pool. Admins and superadmins configure Hub endpoints and Edge selections; viewers can read. Optimistic versions reject concurrent stale saves; reload after a conflict. Deselecting a Hub removes its active peer configuration while retaining reserved addresses/port. Reserved pools and Hub base ports cannot be changed through normal settings; explicit migration/reclamation is not implemented. Revocation publishes removal to active counterparts; an offline counterpart applies removal only after reconnecting.

## Local activation gate

Before activation, arrange independent console access or a timed local rollback, and record the management route, node identity, current addresses/routes, kernel/tools versions, and any existing WireGuard ownership. Confirm the pool and endpoints avoid management/underlay routes. Use isolated Debian VMs before deployment. Do not replace an enrolled identity or its private keys.

From `sdwan-edge/`, build source with the pinned Go toolchain:

```sh
go build -o /tmp/fabric-agent ./cmd/fabric-agent
```

Install the reviewed binary through your controlled lab procedure. The default service remains unprivileged. The example at `deploy/systemd/fabric-agent.service.d/wireguard.conf.example` shows the optional drop-in: local `--enable-wireguard`, NET_ADMIN capability and AF_NETLINK access. Review it on the actual Debian system before installing as `/etc/systemd/system/fabric-agent.service.d/wireguard.conf`; then daemon-reload and restart using console access. The signed installer does not install this drop-in or grant network capabilities. Required executables are `/usr/sbin/ip`, `/usr/bin/wg` and `/usr/sbin/nft`, with WireGuard kernel support. The signed 0.2.0 bundle is published for controller-served upgrades. The user-provided Hub/Edge Debian lab received a reviewed source binary at `/opt/packetmotion-lab/fabric-agent-0.2.0` and an explicit `90-wireguard-lab.conf` drop-in; this is separate from the default installer.

Private files in the 0700 state directory include `wireguard.key` (0600), `network-applied.json`, `network-pending.json` and `network.lock`. Keep the key and journal; do not share them in diagnostic reports. Keys are protected by filesystem permissions, not application-level encryption. JSON plans contain peer public keys, not private keys.

## Safety and recovery

- Preflight validates typed /31 adjacencies, keys, endpoints, owned interface names/groups, host route collisions and controller-address overlap. It never accepts arbitrary shell commands. Only owned WireGuard interfaces, their connected /31 routes and the owned nftables forwarding-isolation table are changed. The guard drops forwarded packets entering/leaving this node’s tunnel group and preserves input/output and unrelated forwarding. It is installed before bringing up tunnels and refreshed even for unchanged plans. Host forwarding sysctls are preserved.
- A topology change rebuilds this agent's owned tunnels and can interrupt their traffic. Each command has a five-second timeout; the apply phase has a 90-second deadline. Failed application/management confirmation restores the previous plan with a separate bounded recovery context. A failed rollback keeps the pending journal and requires local investigation.
- Startup recovers pending state and restores missing locally applied interfaces before controller requests. This supports local recovery during controller outage. It is not proof of Debian reboot persistence or independent hardware watchdog behavior.
- Changing routes outside the agent or manually changing owned interfaces is unsupported. The unchanged-plan fast path checks presence/ownership, and handshake reporting checks expected peers; it does not fully verify every kernel setting for drift.
- Stopping/disabling the agent or reverting to the management binary does **not** remove active WireGuard interfaces. To remove managed tunnels normally, deselect all Hubs while both peers can reconnect, verify an applied empty plan, then remove the opt-in drop-in. A harmless group-scoped nftables guard can remain after empty plans; remove only its exact owned table after verifying that no owned interfaces remain. During emergency console recovery, identify exact interfaces by node group/name/type and remove only confirmed PacketMotion interfaces. Preserve journals/identity and never flush host routes or firewall rules.
- Restoring a prior source version does not reverse database data. Preserve additive migrations, reservations, audit history and append-only change logs. A destructive pool migration requires separate approval.

## Reproducible isolated check

From `sdwan-edge/` on Linux with Go, `unshare`, `nsenter`, iproute2, wireguard-tools, ping and sufficient namespace privileges:

```sh
unshare --mount --net --fork env FABRIC_WIREGUARD_LAB=1 FABRIC_WIREGUARD_OUTER_NS=1 \
  go test -v ./internal/network -run TestNamespaceWireguardLifecycle -count=1
```

The test refuses the PID-1 network namespace, creates disposable Edge/Hub namespaces plus a test LAN namespace and veth pairs inside the disposable outer namespace, then cleans up child processes. It verifies two real handshakes and tunnel pings, management underlay connectivity, rollback on failed confirmation, restoration after interface removal, interrupted-journal recovery, deselection and removal, and a positive/negative forwarding guard test with IP forwarding enabled. It does not exercise physical Debian NICs, systemd, NAT, general forwarding policy, BGP, disk faults, process-kill windows or the actual mTLS proxy.

## User-provided Debian lab

Hub `192.168.160.142` and Edge `192.168.160.141` use ens33 management through `192.168.160.2`; those addresses/routes were preserved. Reviewed source 0.2.0 is installed separately from their original binaries. Root-only state/service/network snapshots and a rollback helper are retained in `/root/packetmotion-wireguard-lab-20261015` on each appliance. Do not share those backups: they contain identity material. The helper removes only this node’s owned tunnel interfaces/guard and lab drop-in, then restores its original management service. It does not erase controller reservations or identity. Successful lab validation cancels the temporary rollback timers; the helper remains available for manual console recovery. Current exact validation and remaining gaps are recorded in the change log.

Final lab checks also verified actual reboots of both appliances, re-created guards/interfaces and preserved management routes, current applied reports with real handshakes, and Edge tunnel recovery while its controller HTTPS traffic was deliberately blocked. The temporary outage rule was removed. These observations apply to the supplied two-host lab; NAT, multiple physical Hubs, sustained load/MTU, disk faults, arbitrary process-kill timing, LAN forwarding and BGP/failover remain unverified.
