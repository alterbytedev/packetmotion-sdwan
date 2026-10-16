# Routed LAN delivery and activation

The approved increment adds saved LAN intent, typed safe apply, FRRouting IPv4 BGP, explicit transit permissions and preferred/backup hub paths. Work proceeds in that order. The existing WireGuard tunnel isolation stays active until a validated routing/policy revision is explicitly activated.

## Milestone 1: saved LAN intent

A superadmin configures **Settings → Protected networks** with management and underlay networks before LAN profiles are saved. These reservations reject overlapping LANs and tunnel pools; they do not change host routes or firewall rules.

Device details → **LAN network** stores a physical interface name, a private appliance host address/prefix (8–30) and the exact advertised subnet. Loopback/managed tunnel interfaces, network/broadcast host addresses, noncanonical or mismatched advertisements, protected/tunnel/other-site overlaps and stale saves are rejected. Shared-site appliances must agree on the subnet and use distinct host addresses. A single shared-site member cannot silently renumber another. Admin/superadmin writes are audited; viewers read only. Migration 0010 is required before this UI/API is deployed.

Sites remain authoritative for the LAN prefix; per-node LAN profiles add the interface and host address. Saving a profile updates site prefix and profile in one transaction but does not publish an apply revision in milestone 1. The default/signed management agents and existing tunnel configuration remain unchanged. On-device management-interface and route ownership must pass preflight before any later physical-interface apply.

## Lab prerequisites and scope

Existing management is Edge 192.168.160.141 and Hub 192.168.160.142 over ens33, default gateway 192.168.160.2. Existing tunnels use 10.250.0.0/24 allocations. Proposed test LANs are 10.61.0.0/24 and 10.62.0.0/24, subject to overlap checks. The physical/virtual network mapping of spare NICs and real LAN test hosts must be supplied before appliance LAN activation. A second physical Hub and valid destination/return paths are required for the final physical failover test. Do not infer a spare NIC's network from its interface name or DOWN state.

Initial data traffic is routed without SNAT. Hosts must use their PacketMotion appliance as gateway or have explicit return routes. Management/underlay routes and unrelated FRR configuration remain outside agent ownership.

## Remaining milestones

1. Extend durable recovery to a typed LAN/WireGuard/BGP/firewall bundle, with local opt-in, management/underlay protection, ownership checks, syntax validation and failure rollback.
2. Establish BGP over approved tunnel peers. Export only approved exact local LANs and import only approved peer LANs; never redistribute management/default routes. Use a deterministic preferred path, without ECMP.
3. Replace blanket tunnel-transit denial only with explicit stateful source/destination/protocol/port permissions. Preserve default denial, anti-spoofing, management connectivity and unrelated forwarding.
4. Observe configured revisions, BGP peers/routes and timestamped actual connectivity separately. Test withdrawn routes, denied traffic, controller loss, restart and reboot.
5. Add the second physical Hub only after destination reachability and return paths are defined, then validate failover and recovery.

The existing FRR instances have a management static default route. Never replace or reload their whole configuration to install PacketMotion BGP. Ownership and any added local privilege must be documented before apply is connected. Actual tested versions and exact evidence belong in the change log; planned features are not delivered claims.

## Rollback

For milestone 1, revert only task UI/service bindings while preserving migration 0010, saved intent, audit history and earlier worktree edits. No appliance network state changes are needed to undo a profile-only delivery. Later network apply must retain its prior working typed bundle and restore only owned addresses, BGP configuration and rules; stopping an agent is not a kernel rollback.

## Safe-apply foundation

The source network engine now validates locally authorized LAN Ethernet interfaces, protects interfaces carrying controller/underlay routes, rejects foreign IPv4 addresses and host-route overlap, and records original link state/exact owned addresses before mutation. Namespace tests verify management-interface rejection, local opt-in enforcement, unchanged reconciliation, failed-management rollback and original address/link-state restoration. Recovery locks before reading state; the controller-address cache is bound to its origin for offline recovery. The source engine also validates and applies an owned FRR BGP instance in the same journaled transaction. Generated exact-prefix filters, private ASNs and WireGuard AllowedIPs share one typed ownership model. A disposable four-namespace lab with FRR 10.3 proves BGP establishment, approved route installation, failed-management rollback, management static-route preservation, transit denial and owned cleanup. This adapter is not yet connected to controller activation or agent CLI flags; schema 2 explicitly rejects routing intent. Explicit-policy integration and schema/privilege wiring follow before physical LAN activation. See [ADR 0005](../adr/0005-routed-lan-ownership.md).
