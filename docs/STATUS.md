# Delivery status

## Implemented M0/M1
```mermaid
flowchart LR
  M0[M0 foundation<br/>implemented] --> M1[M1 inventory<br/>implemented]
  M1 --> M2[M2 enrollment, revisions and telemetry<br/>implemented]
  M2 --> M3[M3 safe local apply<br/>pending]
  M3 --> M4[M4 WG, BGP and nftables<br/>pending]
  M4 --> M5[M5 resilience<br/>pending]
  M5 --> M6[M6 policies and resources<br/>pending]
  M6 --> M7[M7 scale and release gate<br/>pending]
```

Next.js operator login/logout, PostgreSQL scrypt credentials, signed sessions with credential fingerprint revocation, shared email limiter, auth migration, protected dashboard and liveness route are preserved.

M0 adds locked rotating change logs, isolated PostgreSQL integration/browser tests, pinned Playwright and CI configuration. Go source and a pinned Go toolchain are now part of the M2 agent implementation.

M1 adds checksum-verified serialized additive controller migrations, superadmin/admin/viewer authorization and operator provisioning (superadmins create admins or viewers; admins create viewers), persisted site/hub/branch inventory, transactional creation audit, same-origin bounded JSON operator endpoints and inventory controls/list in the existing Devices view. Registration is not enrollment; devices display Not enrolled. The operator flow is Devices -> Add device (Edge or Hub); internal site/network grouping remains hidden and is created transactionally with the device and audit. Devices now contains all onboarding/token instructions and a server-paginated searchable table. Provisioning navigation is removed; obsolete query-based dashboard view URLs no longer select Devices. Per-device URLs reuse agent configuration/telemetry with admin writes and viewer read access. Initial dashboard inventory is bounded to 25 rows; totals cover all devices. Production-scale search performance remains unverified. Existing credentials were verified unchanged during local development migration.

## Implemented management MVP (M2)
Add device issues a hashed, expiring, single-use enrollment token. New token replaces a pending token; revocation invalidates enrollment and device certificates. Next.js issues dedicated client certificates from verified CSRs, and mTLS agent endpoints trust only protected NGINX identity forwarding plus a shared upstream secret. Go agent in sdwan-edge is shared by Edge/Hub, initiates HTTPS, persists keys privately, stages checksummed typed desired revisions, acknowledges received/rejected, sends heartbeat/interface telemetry and renews certificates. Management Configurations/Telemetry views reuse the existing design. These are management-plane capabilities; the agent does not apply the staged configuration.

Rama approved enrollment/Go agent/channel work. No local network apply is implemented: received does not mean applied; controller heartbeat does not mean tunnel/BGP/application reachability. Safe local apply/recovery, WireGuard, FRR BGP, nftables, policies/resources and forwarding/failover validation remain pending (M3–M7). Public HTTPS ingress/CA configuration is required before a VM can enroll. The local VM lab remains Rama's responsibility.

## Verification
Actual per-task results and failed iterations are in [change logs](change-logs/log_change_001.md). PostgreSQL tests cover concurrent one-use enrollment, expired/replaced/revoked credentials, certificate scope, immutable revision/ack integrity, deduplication and audit rollback. The actual Go/NGINX/Next smoke verifies TLS ingress and controller communications. Original baseline and current UI evidence are retained under [evidence](evidence/README.md). Final counts/results are recorded in the milestone closure entry.

Operator management is available in Settings with server-enforced role limits and one-time generated passwords. Its desktop/mobile browser journey is UNVERIFIED in this checkout because the Playwright Chromium executable is unavailable. Hosted CI, live public ingress deployment, Debian systemd run, WireGuard/FRR/nftables apply/rollback/failover/reboot and scale targets remain UNVERIFIED. Enrollment response-loss recovery after consumption requires operator handling; certificate renewal uses overlapping validity to tolerate lost renewal responses.

## Rollback and next step
Disable agent ingress and revert new feature bindings if necessary; preserve additive schema, inventory and audit/change logs. No existing operator credential reset is required. Agent management MVP makes no network changes. Next: configure the HTTPS ingress for Rama's VM lab and design safe local apply/recovery (M3) before routing changes.

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
