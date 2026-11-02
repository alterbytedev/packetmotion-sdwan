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

## Source activation — BGP over selected WireGuard peers

Source 0.3.0 adds schema v3 generation from saved LAN profiles and active WireGuard links. When both peers have saved LAN profiles, each tunnel carries only that peer LAN in `AllowedIPs`; FRR imports and exports only the corresponding exact LAN prefix. Hubs use private ASN 65000 and Edges 65001. The existing locally gated engine applies the LAN address and owned FRR instance transactionally, while the controller records peer state and received-prefix counts separately from WireGuard handshake state. The operator must publish the updated desired config after saving LAN profiles.

Activation remains local to each appliance: run signed agent 0.3.0 with `--enable-wireguard --enable-routing --lan-interface <interface>`. The named interface must match the reviewed LAN profile and must not carry management or underlay routes. The service account also needs local FRR vty socket access (commonly `frrvty`); that group grants broad FRR CLI access and must be explicitly reviewed. The example [routed-LAN systemd drop-in](../../deploy/systemd/fabric-agent.service.d/routed-lan.conf.example) shows the local flags and permissions; replace `ens34` with the reviewed LAN interface. Controller configuration cannot turn on either local flag. Signed 0.2.0 remains management/WireGuard-only and cannot consume schema v3. The 0.3.0 bundle is in controller public assets; deploy the matching controller before selecting it in the dashboard or upgrading devices.

For source review, the typed BGP plan fixture and its expected rendered FRR commands are in [`sdwan-edge/internal/network/testdata/frr/`](../../sdwan-edge/internal/network/testdata/frr/); the renderer is in [`bgp_render.go`](../../sdwan-edge/internal/network/bgp_render.go). On an appliance, the syntax-check candidate is written privately as `routing-candidate.conf` in the agent state directory (default `/var/lib/packetmotion`) and is overwritten when validating a later plan. It is runtime state, not a source artifact or a user-editable configuration file; review the committed fixture for the intended generated text. The agent continues to apply typed, locally gated configuration and does not accept arbitrary `vtysh` text.

This milestone is intended to establish BGP control-plane sessions and install approved LAN routes on appliances. Go tests/race/vet and signed amd64/arm64 release build pass on Go 1.27.2, and generated FRR configuration passes `vtysh -C` with FRR 10.3. The nested FRR namespace lifecycle test could not run here because the container does not provide an outer network/mount namespace distinct from `/proc/1`; physical appliance reachability, BGP convergence/recovery, controller-loss restart behavior, and deployed release availability remain UNVERIFIED. The PacketMotion WireGuard forwarding guard still denies tunnel transit, so host-to-host LAN traffic is not enabled.

## Transit allow rules (milestone 3, source)

Superadmins manage a single global rule list in **Settings → Transit policy**. Rules name two different saved device LAN prefixes and a protocol (`any`, `tcp`, `udp` or `icmp`; no ports yet). **Save draft** changes nothing on devices; **Deploy policy** promotes the draft and republishes every device with a LAN profile. Migration 0024 is required first (`npm run migrate:controller`).

- Each node receives only rules whose source and destination are its own LAN or its linked peers' LANs. An edge therefore never sees edge-to-edge rules; a hub carries them. Nodes with no applicable rules keep their schema-v3 payload; otherwise the payload is schema v4 with `routing.transit`. Agents older than this release reject v4 and keep their last-known-good configuration, so upgrade agents before deploying.
- Local opt-in: run the agent with `--enable-transit` (requires `--enable-routing`; see [the drop-in example](../../deploy/systemd/fabric-agent.service.d/routed-lan.conf.example)). Without it the agent rejects a revision that carries transit rules and the blanket tunnel-transit denial stays in force. Controller configuration cannot turn the flag on.
- On the appliance each rule becomes `iifname <source interface> oifname <destination interface> ip saddr <source> ip daddr <destination> [ip protocol <p>] accept` inside the existing owned `pmwg<group>` forward chain, ahead of the group drops. The source LAN/peer prefix is bound to the interface that carries it, so spoofed sources are dropped. Established/related return traffic is admitted only for flows a rule allowed to start. Management, underlay, protected and overlay networks can never be named, and unrelated forwarding is untouched.
- Remove a rule by saving a draft without it and deploying; an empty policy returns nodes to schema v3. Removing `--enable-transit` and restarting reasserts the blanket denial from the journaled plan.

Verification: Go validation/renderer/agent-gate tests and controller unit/integration tests pass in this repository. The nested namespace forwarding lab, the Playwright spec and physical-appliance reachability are UNVERIFIED (see the change log). To check on an appliance: `nft list table inet pmwg<group>`, then ping between LAN hosts whose gateways are the appliances (or with explicit return routes); no SNAT is applied.
