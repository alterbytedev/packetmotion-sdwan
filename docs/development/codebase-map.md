# Codebase map and maintenance guide

Use this map to choose the smallest relevant area before changing code. [Current status](../STATUS.md) records delivered capabilities and verification gaps; this guide describes ownership rather than delivery promises.

## Controller

All paths below are relative to `sdwan-controller/`.

| Area | Owner and purpose |
| --- | --- |
| `src/app/` | Next.js pages, server actions and API Route Handlers. Keep request parsing and response handling here; delegate business rules to domain services. |
| `src/lib/fabric/` | Server-side inventory, enrollment, device identity, desired revisions and telemetry. `types.ts` defines shared inventory types; `validation.ts` validates inventory input. |
| `src/lib/fabric/inventory.ts` | Inventory reads and creation, connection-status SQL, and operator mutation transactions with a locked role recheck. |
| `src/lib/fabric/channel.ts` | Desired revision reads, publishing and acknowledgement. Retains telemetry exports for existing callers. |
| `src/lib/fabric/telemetry.ts` | Heartbeat validation, event deduplication, snapshot retention and latest telemetry reads. |
| `src/lib/fabric/lan{,-validation}.ts` | Saved LAN profiles, site-prefix consistency and protected management/underlay reservations. |
| `src/lib/fabric/wireguard*.ts` | Tunnel settings/validation, topology allocation and publication, public-key registration and revision-scoped observations. |
| `src/lib/fabric/revision-events.ts` | Bounded desired-revision waits. PostgreSQL notifications are wake hints; durable revision reads determine state. |
| `src/lib/` | Authentication, sessions, database access and runtime diagnostics. Inspect the relevant module before creating another helper. |
| `src/components/ui/` | Shared UI primitives. Follow [component conventions](ui-component-architecture.md) before extending them. |
| `src/components/fabric/` | Fabric feature components and presentation labels. Keep feature state within its owning feature. |
| `migrations/` | Ordered database changes. Applied migrations are immutable; add a follow-up migration. |
| `tests/`, `scripts/` | Node unit tests, integration/browser scenarios, isolated runners and operator tools. |

Inventory connection status is derived from enrollment, revocation, heartbeat freshness and receipt of the latest desired revision. It does not prove tunnel health or routed reachability. `branch` is the wire value for the UI's Edge device type.

## Shared Go agent

All paths below are relative to `sdwan-edge/`.

| Area | Owner and purpose |
| --- | --- |
| `cmd/fabric-agent/` | CLI configuration, service loop and scheduling. |
| `internal/controller/` | Controller origin validation, TLS client construction and bounded JSON requests. |
| `internal/identity/` | Private identity and state persistence. Preserve file permissions and crash/retry safety. |
| `internal/network/` | Locally gated owned WireGuard interfaces, private keys, preflight, durable recovery and handshake observations. |
| `internal/agent/` | Enrollment, desired revision validation and durable staging, acknowledgement, heartbeat snapshots and certificate renewal. |
| `install/`, `scripts/` | Installer source and release tooling. Served releases are immutable; do not rebuild them for readability changes. |

The default service stages received configuration. Source 0.2.0 adds locally gated WireGuard adjacency apply/recovery and handshake observations; see [activation and evidence limits](../operations/wireguard-tunnels.md). BGP, nftables and LAN forwarding remain pending.

## Other boundaries

- `api/openapi.yaml` owns the HTTP contract; keep it aligned when behavior changes.
- `deploy/proxy/` owns the trusted ingress boundary. Device identity headers are trustworthy only through verified proxy authentication.
- `docs/agent/README.md` indexes agent workflow; `docs/human/README.md` indexes product, operations and evidence.
- `docs/change-logs/` is append-only task history. Use `node scripts/append-change-log.mjs <entry-file>` from the root.

## Readability changes

1. Inspect callers, existing helpers, tests and uncommitted changes before moving logic.
2. Keep validation, transaction boundaries, lock order, serialized field order and error behavior intact during a structural refactor. Serialized JSON bytes participate in revision and telemetry checksums.
3. Extract a module when it has a clear responsibility and dependency direction. Keep existing imports working where practical; avoid creating a generic abstraction for a single use.
4. Name intermediate values for their domain meaning. Explain safety constraints and non-obvious decisions in comments.
5. Use the existing Biome configuration for TypeScript and `gofmt` for Go. Limit formatting to touched code.
6. Follow the [testing strategy](testing-strategy.md), record actual results and inspect the final task diff against the starting worktree.

Documentation should describe current behavior in its owning source document. Keep historical evidence dated, and correct stale current instructions rather than copying another status summary into each guide.
