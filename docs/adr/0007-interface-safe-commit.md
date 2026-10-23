# ADR 0007: Locally authorized interface safe commit supervisor

Date: 2026-10-22
Status: Accepted for dedicated static LAN/VLAN apply; other adapters pending.

## Decision

Keep the existing unprivileged Fabric management agent and authenticated outbound channel. Deliver checksummed interface transactions separately from legacy desired-revision schemas. A root-owned local policy grants an independent systemd supervisor exclusive ownership of specified dedicated physical NICs. The controller cannot activate privileges. Typed scope replacement preserves other installed interface settings and legacy WireGuard/LAN ownership.

The supervisor writes a durable previous/proposed journal before mutation, holds the existing network lock, and supervises a killable worker. Start a monotonic 60-second deadline before mutation. Commit only after a fresh controller confirmation bound to node, commit, checksum and random nonce. Otherwise restore last confirmed state. A pending journal after interruption is rolled back before accepting work; an already persisted confirmed decision wins over a leftover pending journal. Confirmed settings survive controller loss. A separate systemd watchdog covers supervisor stalls. Bounded acknowledged result history supports eventual reporting and suppresses failed-candidate repetition.

## Consequences

The first adapter rejects management/WAN/DHCP/gateway/advertisement changes, competing interface owners and overlapping routes. Owned nftables isolation blocks forwarding. VLAN creation and successful commit are not BGP or physical reachability proof. Additional adapters require their own ownership, recovery and isolated failure evidence. Root journals are not controller-editable. UI history offers typed correction and a new commit, never executable command editing.

The [operation guide](../operations/interface-management.md) owns installation, retention, retirement, evidence and rollback details. Namespace evidence does not authorize physical NIC activation.
