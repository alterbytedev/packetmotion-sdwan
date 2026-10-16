# Delivery status

## Implemented M0/M1
```mermaid
flowchart LR
  M0[M0 foundation<br/>implemented] --> M1[M1 inventory<br/>implemented]
  M1 --> M2[M2 enrollment, revisions and telemetry<br/>implemented]
  M2 --> M21[M2.1 bounded long-poll management sync<br/>implemented locally; deployment pending]
  M21 --> M3[M3 scoped WG apply<br/>source and supplied Debian lab verified]
  M3 --> M4[M4 WG namespace evidence<br/>BGP and nftables pending]
  M4 --> M5[M5 resilience<br/>pending]
  M5 --> M6[M6 policies and resources<br/>pending]
  M6 --> M7[M7 scale and release gate<br/>pending]
```

Next.js operator login/logout, PostgreSQL scrypt credentials, signed sessions with credential fingerprint revocation, shared email limiter, auth migration, protected dashboard and liveness route are preserved.

M0 adds locked rotating change logs, isolated PostgreSQL integration/browser tests, pinned Playwright and CI configuration. Go source and a pinned Go toolchain are now part of the M2 agent implementation.

M1 adds checksum-verified serialized additive controller migrations, superadmin/admin/viewer authorization and operator provisioning (superadmins create admins or viewers; admins create viewers), persisted site/hub/branch inventory, transactional creation audit, same-origin bounded JSON operator endpoints and inventory controls/list in the existing Devices view. Device creation issues a one-use enrollment token and an initial typed desired revision. The operator flow is Devices -> Add device (Edge or Hub); internal site/network grouping remains hidden and is created transactionally with the device and audit. Devices now contains onboarding/token instructions and a server-paginated searchable table. Provisioning navigation is removed; obsolete query-based dashboard view URLs no longer select Devices. Per-device URLs reuse agent configuration/telemetry with admin writes and viewer read access. Initial dashboard inventory is bounded to 25 rows; totals cover all devices. Production-scale search performance remains unverified. Existing credentials were verified unchanged during local development migration.

Device details now group Overview, Connections, Configuration and Telemetry into accessible tabs. Admins can rename a device or archive it from the detail page. Archiving revokes credentials and withdraws active peer plans while retaining audit history and WireGuard reservations; local tunnel state may remain on a disconnected appliance until local cleanup. Migration 0011 adds the archive marker and audit actions.

## Implemented management MVP (M2)
Add device issues a hashed, expiring, single-use enrollment token and initial desired revision. Next.js issues dedicated client certificates from verified CSRs, and mTLS agent endpoints trust only protected NGINX identity forwarding plus a shared upstream secret. Go agent in sdwan-edge is shared by Edge/Hub, initiates HTTPS by default, persists keys privately, stages checksummed typed desired revisions, acknowledges received/rejected, sends heartbeat/interface telemetry and renews certificates. An explicit development flag permits HTTP to private/loopback addresses; superadmin Controller Settings controls which private IP is included in generated install instructions. This exposes management traffic and is for isolated labs only. The installer and static amd64/arm64 binaries are published under Controller `public/fabric/`; a signed manifest binds the downloads, and the installer prompts for the token without echoing it before enabling a systemd service. UI status distinguishes Pending, Enrolling, Syncing, Management connected, Offline, and Revoked; latest revision receipt is shown separately. Admin recovery can rotate a consumed enrollment only before the first heartbeat. Management Configurations/Telemetry views reuse the existing design. These describe the default service and signed management release. Source 0.2.0 adds locally gated WireGuard adjacency apply below.

Received does not mean applied; management connectivity does not mean tunnel/BGP/application reachability. Source 0.2.0 implements bounded owned WireGuard adjacency apply/recovery behind a local opt-in, with namespace evidence. Debian deployment, general network apply, FRR BGP, nftables, policies/resources and LAN forwarding/failover validation remain pending. Public HTTPS ingress/CA configuration is required before a VM can enroll. Debian/systemd lifecycle and network behavior still require VM lab evidence.

## Verification
Actual per-task results and failed iterations are in [change logs](change-logs/log_change_001.md). PostgreSQL tests cover concurrent one-use enrollment, expired/replaced/revoked credentials, certificate scope, immutable revision/ack integrity, deduplication and audit rollback. The actual Go/NGINX/Next smoke verifies TLS ingress and controller communications. Original baseline and current UI evidence are retained under [evidence](evidence/README.md). Final counts/results are recorded in the milestone closure entry.

Controller Settings includes a superadmin-managed private IP allowlist for generated HTTP lab onboarding instructions. Applying migration 0007 is required. Source and signed installer artifacts are at agent release 0.1.6. Add device generates a single copy/paste command that securely pipes the one-time token through stdin; for private-IP HTTP labs it also pins and installs the HTTPS server CA before enrollment. Pending identity state can be rebound to the explicitly supplied controller origin; enrolled identities remain protected. Actual Debian host installation remains UNVERIFIED.

Operator management is available in Settings with server-enforced role limits and one-time generated passwords. Enrollment API/agent integration and migration recovery tests pass. A signed static release for Linux amd64/arm64 is built into the Controller public folder. Installer behavior on an actual Debian systemd VM, live public ingress deployment, WireGuard/FRR/nftables apply/rollback/failover/reboot, and scale targets remain UNVERIFIED. Certificate renewal uses overlapping validity to tolerate lost renewal responses.

## Rollback and next step
Disable agent ingress and revert new feature bindings if necessary; preserve additive schema, inventory and audit/change logs. Apply controller migrations through 0009 before deploying current code. The default service makes no network changes. Next: validate optional source 0.2.0 WireGuard activation on isolated Debian VMs before release.

## M2.1 — responsive management synchronization

Rama requested a dashboard–Edge communication model similar to NetBird. The controller and signed Go agent release 0.1.6 now use bounded agent-initiated HTTPS/mTLS long-poll for desired revisions while retaining Next.js and PostgreSQL. Dashboard publish uses PostgreSQL notification only as a wake-up hint; each wait checks durable state before and after waiting. Focused controller unit tests, isolated PostgreSQL wake integration, Go tests, and signed release checks pass. The Docker/NGINX/Go smoke was attempted but Docker's OCI runtime could not execute NGINX (status 126); full smoke and Debian deployment remain UNVERIFIED. This is HTTP request/response long-poll, not WebSocket/gRPC or full NetBird architecture. Signal/Relay services, peer negotiation, and network forwarding remain separate future decisions. See [control-channel implementation and limits](architecture/agent-control-channel.md) and [ADR 0003](adr/0003-event-driven-agent-management.md).

## UI consistency audit — 2026-10-12

Shared feedback styles/announcements and typed controller-status labels reduce duplicated markup. Existing Button now covers the password toggle. Device form/table semantics, mobile navigation focus and clipboard failure feedback are verified with the existing desktop/mobile browser suite. Existing theme, auth, routes, APIs and management/data-plane behavior are preserved. Component documentation and permanent root reuse policy are in place; exact verification and limits are recorded in the [UI architecture](development/ui-component-architecture.md) and change log.

Dashboard screens now use `/dashboard`, `/dashboard/devices`, `/dashboard/devices/[id]`, `/dashboard/telemetry`, and `/dashboard/settings`. The shared shell, authorization, and data services remain reused. Legacy `?view=` URLs are not preserved or redirected, per the direct route migration.

## Maintainability and diagnostics — 2026-10-12

`GET /api/health` is the liveness check. `GET /api/ready` checks PostgreSQL with a lightweight query and returns a generic 503 with a request ID when it is unavailable; it never returns driver messages. Unexpected operator and agent API errors include a generated request ID and emit structured stdout metadata with scope, sanitized error class, and constrained error code. Dashboard health/settings sections are application components under `components/fabric/` and preserve the existing markup and tokens.

## White-label branding — 2026-10-14

Controller migration 0005 adds the `superadmin` role without changing existing admin/viewer assignments and stores one bounded raster logo. Existing operators can be assigned with `npm run set:operator-role -- <email> superadmin`. Branding Settings are only rendered for superadmins, and upload/removal APIs enforce that role and same-origin requests server-side. PNG/JPEG/WebP logos are limited to 2 MiB; the Settings preview shows light and dark surfaces and recommends 600 × 180 px. The asset is displayed proportionally on the login page and dashboard navigation with the default mark when unset. Applying migration 0005 is required before deploying this code. No network or agent behavior changed.

## Runtime error reports — 2026-10-12

Next.js server errors and uncaught browser runtime errors have friendly recovery UI with a reference ID. Diagnostics persist in PostgreSQL table `runtime_errors`; `/api/runtime-errors` accepts bounded same-origin browser reports from signed-in operators, and server failures are captured by Next.js `onRequestError`. Stored message/stack fields are bounded and redacted; entries older than 30 days are pruned during report writes. Developers can inspect a reference with `npm run errors:show -- <reference-id>` from `sdwan-controller/`. Controller migration `0003_runtime_errors.sql` must be applied first. No monitoring/error-reporting dependency was added.

The read-only `/diagnosticlogs` page lists the 100 most recently updated reports for superadmins. A Diagnostics link appears in the dashboard menu only for superadmins; server-side role checks redirect admins, viewers, and signed-out users. No separate developer diagnostic user or login remains. The legacy table from migration 0004 is unused and retained because applied migrations are immutable. See the [runtime error troubleshooting guide](operations/runtime-error-troubleshooting.md).

## Management communication hardening — 2026-10-14

The shared agent now attempts renewal/heartbeat/config independently, persists pending receipt acknowledgements for restart retry, rejects unsupported verified configurations without advancing state, repairs corrupt staging caches, and avoids repeated unchanged writes/acknowledgements. Optional revision/checksum queries omit unchanged payloads while preserving device authentication/scope and full responses for legacy clients. Startup jitter and bounded HTTP connections/deadlines reduce reconnect pressure. See [operations and limits](operations/management-channel.md). Polling remains periodic; configuration/renewal failure can slow cycles via shared backoff. No streaming, network apply or production capacity guarantee is introduced.

## Selected hub WireGuard adjacencies — source 0.2.0

Settings persists a superadmin-configured private tunnel pool; device details persist Hub endpoint/base port and up to eight selected Hubs per Edge. Stable /31 and port reservations are transactional, retain removed reservations, reject overlap/exhaustion/stale saves, and publish both peer plans atomically. Revocation removes active peer plans. Migrations 0008/0009 are required. The device view separates receipt, revision-scoped local apply and timestamped handshakes. The illustrative preview no longer has a competing hub selector.

Go source 0.2.0 adds local `--enable-wireguard`, private keys, typed owned WireGuard operations, route/interface/controller-address preflight, durable previous-plan recovery, management confirmation and separate status reporting. Startup restores local state before controller access. Installer/signed 0.1.6 release and default unprivileged service are unchanged. Optional NET_ADMIN activation needs isolated Debian validation.

A disposable namespace test exercised one Edge/two Hubs with real handshakes/pings, management-confirmation rollback, interface-loss restoration, interrupted-journal recovery and peer removal with intact underlay. Controller/browser/Go results are in the task log. This is not a Debian reboot test. The supplied Debian deployment/systemd/reboot and real mTLS-to-kernel path now have evidence below. NAT, sustained traffic/MTU, arbitrary process-kill/disk faults, general BGP/nftables/LAN policy and automatic hub failover remain UNVERIFIED. See [activation/recovery](operations/wireguard-tunnels.md) and [ADR 0004](adr/0004-wireguard-adjacencies.md).

### Debian lab activation

The user-provided Debian 13 Hub 192.168.160.142 and Edge 192.168.160.141 now run source 0.2.0 through explicit capability drop-ins. Controller migrations 0008/0009 were applied. Automatic allocation produced Hub 10.250.0.0/31 and Edge 10.250.0.1/31, UDP 22000. Real handshakes, bidirectional tunnel ping, mTLS key/status exchange, applied observations and ens33 management reachability were verified. Because both hosts already forward IPv4, an owned group-scoped nftables guard blocks tunnel transit; positive/negative namespace tests verified it. Broader nftables policy remains pending. The installer/signed release remains 0.1.6. See the final task log for recovery/reboot outcomes and remaining evidence limits.

Final supplied-lab checks passed actual Edge/Hub reboot persistence and Edge local interface recovery with controller HTTPS blocked. After both reboots, Hub tunnel ping passed 3/3 and Edge passed 5/5; both desired/observed revisions match with applied status and real handshake timestamps. Final targeted desktop/mobile browser regression passed 8/8 and production build passed. Earlier broad browser attempts had navigation/login instability; the preview focus expectation was corrected to match existing Modal focus order, then the targeted suite passed. No full-browser or fleet-capacity claim is made.

## Routed LAN increment — milestone 1

Migration 0010 and controller services/UI add audited saved LAN interface/address/advertisement profiles and protected management/underlay networks. Saving intent does not publish or apply physical interfaces, BGP or forwarding rules. The existing tunnel transit block remains active. Further safe-apply/BGP/policy/failover work follows the approved plan; physical LAN mapping/test hosts and a second Hub are required for its appliance evidence. See [delivery guide](operations/routed-lan.md).
