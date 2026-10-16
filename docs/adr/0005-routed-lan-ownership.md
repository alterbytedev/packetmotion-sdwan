# ADR 0005 — Routed LAN bundle ownership

- Date: 2026-10-15
- Status: approved routed-LAN scope; implementation and evidence recorded per milestone.

## Context

WireGuard adjacency recovery currently owns only tunnel interfaces and a transit-isolation table. Routed LANs add Ethernet addresses, FRRouting configuration and explicit forwarding rules. Existing Debian FRR instances already own a management static default route; replacing their entire configuration would violate management-path safety.

## Decision

- Controller LAN intent extends per-node interface/host addressing while sites remain authoritative for the subnet. Protected management/underlay reservations constrain both LAN and tunnel allocation. Shared-site appliances must agree on their subnet and retain distinct addresses.
- Physical LAN apply requires local routing opt-in and a specific locally authorized LAN interface. Controller intent cannot authorize a different interface. On-device route lookup protects controller and WireGuard underlay interfaces; existing addresses/routes and protected prefixes are checked before mutation. No management-address, default-route, DHCP, NetworkManager or WAN ownership is assumed. The operator must confirm the spare NIC's virtual-network mapping and ensure it has no competing configuration manager before activation.
- Keep one typed network bundle and one process lock for apply/recovery. Persist the previous bundle before mutation and record original LAN link state plus exact owned addresses before adding them. Remove only owned addresses and restore the original UP/DOWN state during rollback. A locally supplied controller-address cache bound to its exact origin permits recovery through DNS/controller outage.
- Recovery acquires the lock before reading state, avoiding stale-plan rollback by independent local reconciliation. Existing pending/applied WireGuard-only plans remain readable.
- FRR ownership is limited to one PacketMotion BGP router instance per appliance and named PacketMotion prefix lists/route maps. Preserve static management routes, unrelated protocols and the global FRR configuration file. Refuse a pre-existing foreign BGP instance instead of claiming it. Use FRR's CLI syntax validator before typed commands are applied through its Unix sockets. Do not issue arbitrary controller-supplied CLI or write the global integrated configuration.
- BGP state is restored from the local typed plan independently of controller availability. Any required frrvty group access is a separate local opt-in and must be documented; that group grants broader CLI capability to the process than its typed adapter exposes.
- Keep transit isolated while routing is staged. Explicit source/destination/protocol/port permissions are validated against approved LANs before the isolation table can admit traffic. Route advertisements and WireGuard AllowedIPs use the same approved exact prefix ownership. Management, tunnel and default routes are never advertised as LAN resources.

## Alternatives and consequences

Replacing /etc/frr/frr.conf would also replace existing management routes and unrelated operator configuration. A second independent Zebra process in the host's main routing table would introduce competing route ownership. Both are rejected. A separate privileged helper may narrow privileges further before production rollout; this increment retains the explicit local agent capability/group boundary.

Physical interface renumbering and topology changes can interrupt traffic. Shared-site renumbering needs coordinated handling. Multiple physical Hubs require destination reachability and return-path design; a second endpoint alone does not establish end-to-end failover. Initial site traffic is routed without NAT.

## Verification

Milestone 1 controller integration/browser checks pass. The extended local engine has namespace evidence for LAN-address staging, failed-management rollback, original link-state restoration and rejection of the management interface. The source FRR adapter additionally has a real FRR 10.3 namespace lifecycle test for establishment, approved kernel routes, failed-confirmation rollback, default transit denial and preservation of an existing management static route during removal. Both direct and wrapped address-family JSON observations have regression tests. Controller/CLI activation, explicit transit policy, daemon-restart recovery and physical LAN/failover evidence remain pending. See [routed LAN delivery](../operations/routed-lan.md) and the append-only task log.

References: [FRR 10.3 basic configuration and daemon options](https://docs.frrouting.org/en/stable-10.3/basic.html), [FRR VTY shell security and socket access](https://docs.frrouting.org/en/latest/vtysh.html). Actual local/VM daemon and CLI versions were checked before implementation.
