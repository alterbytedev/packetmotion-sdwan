# ADR 0004 — Selected WireGuard hub adjacencies

- Date: 2026-10-15
- Decision: approved implementation scope; source implemented and validated on the supplied Debian lab; production release gate pending.

## Context

Operators need an Edge to connect to several selected hubs with automatic tunnel addresses and a configurable pool. Existing releases stage management revisions only. The existing Next.js/PostgreSQL controller and Go agent remain the owners; no new service is introduced.

## Decision

- PostgreSQL owns a superadmin-configured RFC1918 IPv4 pool (/16 through /30), immutable once reservations exist. Each selected Edge–Hub pair reserves a unique /31 and a port from a hub's 128-port range. The hub uses the first address, Edge the second. Selection is limited to eight hubs per Edge. Deselection retains reservations so delayed/offline agents cannot collide with reused addresses.
- Each adjacency has a distinct `pm` interface derived from the link UUID. Both peers receive schemaVersion 2 desired revisions in one topology transaction; schemaVersion 1 remains valid for management-only nodes. PostgreSQL notifications remain hints. Topology writes take advisory lock 72011003 before node locks; pool/LAN overlap writers also coordinate through existing prefix lock 72011002.
- Agents generate a persistent local X25519 WireGuard key separate from mTLS identity. Only public keys reach the controller; same-key registration is idempotent. Key replacement requires operator recovery rather than silent rotation.
- The local `--enable-wireguard` flag gates network operations. The default installed service retains no capabilities. An optional reviewed systemd drop-in grants NET_ADMIN to the agent process; typed code restricts operations to owned WireGuard interfaces. This is a broader process privilege than a separate privileged helper and must be assessed before production rollout.
- Use numeric interface groups derived from the node ID as creation-time ownership markers, plus interface name/type checks. A descriptive alias is added afterward. Tested iproute2 6.15.0 silently omitted alias during `link add`; group survives creation and interruption.
- Install only the /31 connected route and peer /32 AllowedIPs. Hub endpoint is an explicit reachable IPv4/UDP address; Edge persistent keepalive is 25 seconds. MTU is fixed at 1380 for this first implementation. No default-route takeover, physical-interface addressing, forwarding sysctl, BGP or LAN-route advertisement is added. An owned nftables inet table blocks forwarded traffic entering/leaving this node’s tunnel interface group, without changing input/output policy or unrelated forwarding. This is necessary even when the host already has IP forwarding enabled; it is an isolation guard, not the future LAN policy engine.
- Persist the previous local plan before mutations. Serialize with a process lock, bound commands and the apply deadline, verify management access before committing a new plan, and restore previous interfaces on failure. Startup restores local journal/applied state before contacting the controller. Controller outage does not remove an unchanged local plan.
- Keep received/rejected acknowledgements unchanged. A separate status endpoint records revision-scoped disabled/applied/failed observations and latest handshake timestamps. Applied means local configuration completed; a handshake is a separate observation and proves neither LAN routing nor application reachability.

## Alternatives

A shared hub interface would reduce ports/interfaces but complicate the planned per-adjacency BGP topology and ownership. Controller-held private keys would weaken device key custody. Automatically recycling removed reservations risks conflicts with disconnected devices. Immediate automatic activation would bypass host-specific management safety review.

## Consequences and limits

Reserved addresses/ports can exhaust; renumbering and reclamation require a future explicit migration workflow. Removing a link or revoking a node publishes peer removal, but a disconnected peer cannot receive it until reconnection. Changing a topology currently rebuilds this agent's owned interfaces, temporarily interrupting its tunnels. External changes to owned interfaces are unsupported; unchanged-plan checks do not fully audit every kernel setting. Route-collision checks cover all existing IPv4 routing tables; management addresses and underlay endpoints cannot overlap new tunnel prefixes. Host default routes are preserved.

Source version 0.2.0 is not automatically released or enabled. The served signed management release remains unchanged. The namespace lifecycle test proves two Hub handshakes/pings, management-confirmation rollback, local interface-loss recovery, interrupted-journal recovery and peer removal with underlay connectivity. Supplied Debian boot/systemd, actual mTLS-to-kernel apply and controller-disconnection recovery now have lab evidence below; real NAT, sustained traffic/MTU, arbitrary process-kill timing, disk-failure recovery, BGP/failover and LAN forwarding remain UNVERIFIED. See the [operations guide](../operations/wireguard-tunnels.md) and task change log for actual checks.

## Lab activation evidence — 2026-10-15

The user supplied isolated Debian 13 Hub 192.168.160.142 and Edge 192.168.160.141. Both already had forwarding enabled and empty nftables rulesets. After the guard passed positive/negative namespace tests, source 0.2.0 was installed under /opt/packetmotion-lab with an explicit NET_ADMIN drop-in, state backups and temporary automatic rollback timers. Controller migrations 0008/0009 were applied without changing operator credentials. The selected pair received 10.250.0.0/31 (Hub) and 10.250.0.1/31 (Edge), UDP 22000. Real mTLS management/public-key registration, local apply, handshakes, bidirectional tunnel pings and preserved ens33 management routes were observed. See the change log/evidence for subsequent recovery checks. The signed installer remains unchanged.

Both supplied appliances subsequently passed actual reboot recovery, re-created owned forwarding guards/interfaces and retained their ens33 management routes. Edge tunnel/interface restoration also succeeded while only its agent-to-controller HTTPS was blocked. The temporary outage table was removed.
