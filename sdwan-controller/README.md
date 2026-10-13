# SD-WAN Controller

## Quick start

```sh
npm ci
cp .env.example .env.local
# Edit .env.local and set DATABASE_URL for your local PostgreSQL database.
npm run migrate:auth
npm run migrate:controller
npm run init:admin
npm run dev
```

Open [http://localhost:3000/login](http://localhost:3000/login). The init command prints the admin email and a generated password once; save the password. The default email is `admin@localhost`.

If an admin already exists, init preserves it. To replace the admin credentials, run:

```sh
npm run init:admin --override
```

Override removes other operator rows and rotates the session secret, ending existing sessions. Keep `.env.local` private and never commit it.

## Project overview

Next.js/TypeScript application for the controller UI and HTTP API, with PostgreSQL as the database. The shared Go edge/hub agent and its test tools live in `../sdwan-edge/` within this repository. There is no separate Go controller API service.

The controller includes an operator login and protected dashboard with `/dashboard` overview, `/dashboard/devices`, `/dashboard/devices/[id]`, `/dashboard/telemetry`, and `/dashboard/settings` routes. Operator email and scrypt password hash are stored in PostgreSQL; signed HTTP-only sessions use a secret from `.env.local`. Device/network inventory is persisted in PostgreSQL and managed from the existing Devices view. Registration does not enroll a device or establish connectivity. Enrollment tokens, mTLS Go agent enrollment, management configuration revisions and actual agent telemetry are implemented. WireGuard/BGP/firewall configuration and routed reachability telemetry remain pending.

## Operator access details

`npm run migrate:auth` creates or updates the authentication tables and is a required setup step for new and upgraded installations. It is safe to rerun and does not create, replace, or change operator credentials. Run it followed by `npm run migrate:controller` after deploying controller updates and before starting the application. Controller migrations are additive, checksum-verified, and serialized by a PostgreSQL lock. Existing operators receive the admin role without credential changes. `npm run init:admin` creates the first operator and writes `CONTROLLER_SESSION_SECRET` to `.env.local`; it is only for initial credential setup. To choose another initial email, set `CONTROLLER_ADMIN_EMAIL` in `.env.local` or the process environment before running init. Password hashes are stored in PostgreSQL using scrypt; plaintext passwords are only printed once during setup. To replace operator credentials, explicitly run `npm run init:admin --override`.

Sessions last eight hours, use HTTP-only SameSite cookies, and require secure cookies in production; deploy behind HTTPS. Login attempts are limited to 10 per normalized email per minute using PostgreSQL, shared across controller instances. Expired limiter rows are removed during login limiter activity. A successful login clears that email's counter, and changing the password invalidates existing sessions. Operator roles are admin and viewer: admins create inventory, viewers only read. There is no self-service password reset or operator-management UI; no tenant roles are implemented.

## Development

The controller runs on port 3000. `GET /api/health` checks application liveness only; `GET /api/ready` runs `SELECT 1` against PostgreSQL and returns 503 when the database is unavailable. Both checks are uncached. Readiness responses do not reveal database errors or connection details. No production database or secret is configured.

## Runtime error reports

Unexpected route/render errors show a friendly recovery page with a reference ID. Uncaught browser errors and rejected promises also replace the current screen with that fallback and submit a bounded same-origin report for the signed-in operator. Server errors are captured by Next.js instrumentation. Error details (message and a bounded, redacted stack), route pattern, sanitized error name/code, and occurrence counters are stored in PostgreSQL for 30 days. Secrets, request bodies, cookies, and query strings are not intentionally stored. The fallback never displays internal error details.

After applying controller migrations, look up a reference from the controller host with `npm run errors:show -- <reference-id>`. The command requires the same `DATABASE_URL` used by the controller and returns the stored diagnostic record. If PostgreSQL logging is unavailable, a safe reference/error-class record is written to process stderr; detailed stack persistence is then unavailable.

For an incident, copy the reference ID shown to the operator, then run the command from this directory. Check the error source, route/method, sanitized class/code, occurrence count, and redacted message/stack. Server render errors use Next.js' error digest as their reference; client and API errors use generated IDs. Browser submissions require an authenticated operator session. Expected validation and handled API errors are returned through their normal UI states and are not reported as uncaught runtime failures. The reporting route does not provide a public log viewer.

Runtime error records can include application context despite bounded redaction. Limit database and CLI access, and review diagnostic output before sharing it. Records older than 30 days are eligible for best-effort cleanup during error writes. If no errors are written, cleanup may not run until a later write. See the [runtime error troubleshooting guide](../docs/operations/runtime-error-troubleshooting.md) for deployment and diagnosis details.

The read-only web log is available at `/diagnosticlogs` using a separate developer credential. Each report has a **Copy report** action that copies its reference ID, UTC timestamps, occurrence count, source, route/method, error name/code, message, and stack trace as plain text for an issue or AI-assisted troubleshooting. Review copied diagnostic data before sharing it because application context can be sensitive. After `npm run migrate:controller`, run `npm run init:developer` to generate the `developer` password; it is shown once and only its scrypt hash is stored. Use `npm run reset:developer` to generate a replacement and invalidate existing diagnostic sessions. Keep the password in an approved secret manager. This account cannot sign in to the operator dashboard or change controller data.

```sh
npm test
npm run test:integration
npm run test:browser
npm run lint
npm run typecheck
npm run build
npm start
```

Dependencies are pinned in package.json/package-lock.json. Linting uses Biome; type checking uses TypeScript. Node 22.12.0 or newer is required; `.nvmrc` records the local setup version.

For contributors and AI agents, start with [AGENTS.md](AGENTS.md). See [current delivery status](../docs/STATUS.md) and the [documentation index](../docs/README.md).

## Ownership and edge communication

- `src/app/`: Next.js pages and Route Handler APIs.
- `src/lib/db.ts`: server-only PostgreSQL connection pool.
- Controller owns site/device records, activation tokens, enrollment credential issuance, desired config revisions, acknowledgements, and telemetry persistence.
- Go agent owns local identity, outbound controller communication, typed desired-config staging, interface discovery, and telemetry collection. Applying and rolling back network configuration remain future work.

Publishing config persists a new desired revision in this controller; the outbound edge connection retrieves and stages it, then acknowledges receipt. The agent does not apply network changes in this MVP. Inbound branch management ports are not required. Direct controller-to-edge notifications can be designed later if needed.

The inventory API contract is [`../api/openapi.yaml`](../api/openapi.yaml); it includes the implemented management agent v1 endpoints for enrollment, desired-state retrieval, acknowledgements, renewal, and telemetry. Provisioning redacts enrollment credentials from access logs, referrers, and audit records.

Production management ingress requires verified HTTPS/mTLS, transactional token binding, hashed short-lived activation tokens, proxy identity validation, and authenticated device scoping. A trusted reverse proxy verifies device certificates and forwards identity through a protected controller connection; direct bypass and spoofed identity headers are rejected. This boundary is verified in the isolated Go/NGINX smoke test; the public VM ingress deployment is still pending.

## UI components

`components.json` configures shadcn/ui with the New York style and Tailwind CSS 4. Shared Button, Input, Card, and Badge components live in `src/components/ui/`; icons use Lucide. The desktop sidebar becomes a dismissible navigation drawer on mobile. The health refresh button checks `/api/health` and does not claim database readiness.

## Inventory and roles (M1)

Open Devices and select Add device. Enter a name, choose Edge (connects a local LAN) or Hub (connects edge devices), then routing mode and optional canonical IPv4 LAN subnet. There is no site creation/selection step. An internal network group is created atomically with the device and audit events; conflicting names and overlapping LAN prefixes are rejected. Existing site records and legacy siteId API calls remain supported. Device names are unique within each site. Every successful creation commits an audit event in the same transaction. New devices show Not enrolled until the agent redeems the issued token. Controller connected/offline reflects check-in freshness, not routed network health. Devices is the single onboarding location: Add device returns one-use enrollment instructions; New token is available for pending devices. The old Provisioning URL is no longer supported. Inventory is an asynchronous table with debounced server search by name/type, pagination (25 default, 10/25/50/100 rows), loading/error states and manual refresh. Click a device name or Configure to open its stable device URL, scoped agent configuration and telemetry; viewers have read-only access. Configurations and Telemetry retain navigation shortcuts to device selection. Dashboard counts cover all devices while the initial serialized inventory is bounded to 25 rows. Substring search/offset pagination has not been benchmarked at production scale.

`GET/POST /api/operator/sites` and `/api/operator/nodes` use the existing operator cookie. GET permits admin/viewer; POST requires admin, JSON and an exact same-origin Origin header. Node creation accepts either mode/lanPrefix for the one-step device flow or a legacy siteId, not both. The UI label Edge uses the existing branch wire/storage value. Bodies are limited to 8192 bytes. Set `CONTROLLER_PUBLIC_ORIGIN=https://your-controller.example` (no trailing slash) in production before enabling inventory mutations; development derives the origin from the request Host. Production mutations fail closed without this configuration. Protect the Next.js upstream from untrusted proxy access before the M2 device API is exposed.

Roles reside in `operators.role`; existing accounts become admin. Account creation/role-management UI is deferred. A database administrator can assign an existing account with `UPDATE operators SET role = 'viewer' WHERE email = 'viewer@example.com';`. Maintain an admin account. Permission changes are read from PostgreSQL, not cached in the signed cookie. Credential override retains audit history with the actor email snapshot.

## Isolated verification

`npm test` runs controller and repository-tooling unit/contract tests without a database. `npm run test:integration` and `npm run test:browser` create a unique temporary database, seed generated test credentials, and remove that database on normal completion including assertion failures. Set `TEST_DATABASE_URL` to a dedicated PostgreSQL account allowed to create databases; local runs may use DATABASE_URL from .env.local as the connection to create a separate test database. Existing operator/database records are never test fixtures. Forced process termination can leave a `fabric_test_*` database requiring later cleanup.

Install browser binaries with `npx playwright install chromium` before browser tests. Browser tests use port 3107 and `.next-isolated/`, independently of an existing development server. Python 3 is required for change-log flock tests on macOS/Linux. Do not run overlapping browser suites on the same test port/build directory.

M0 screenshots are retained under `../docs/evidence/browser/baseline/`. Run `npm run test:baseline` for current login/navigation screenshots and `npm run test:visual` for exact protected-region comparisons on the same OS/browser/font stack. CI runs journeys and captures artifacts; the macOS pixel baseline is not a cross-platform screenshot gate. Actual inventory acceptance and viewer/CSRF denial are tested through browser HTTP requests and PostgreSQL. Hosted CI results remain unverified until a workflow runs.

Rollback: revert M1 UI/API bindings and keep the additive migration and audit history. Do not drop tables or replace operator credentials as a routine rollback.

## Go agent enrollment and management channel

Add device returns a one-time enrollment token, stored only as SHA-256 hash in PostgreSQL and expiring in 15 minutes. Save/copy it from the temporary UI; reload/hide clears it. Existing unenrolled devices can issue a New token, which invalidates the previous token. Enrolled/revoked devices cannot issue new enrollment tokens. Admin-only revocation is available through POST /api/operator/nodes/{id}/revoke.

Before connecting a VM, run migrate:controller, create a dedicated device CA with npm run init:device-ca, and configure CONTROLLER_DEVICE_CA_CERT/KEY, CONTROLLER_AGENT_PROXY_SECRET, CONTROLLER_ENROLLMENT_URL and CONTROLLER_AGENT_URL. Use an externally reachable HTTPS origin, not localhost from a VM. Keep existing .env.local values and operator credentials. See [proxy deployment](../deploy/proxy/README.md) and [Go agent development](../sdwan-edge/README.md). OpenSSL is a controller runtime dependency for bounded CSR verification/certificate issuance. No actual TLS ingress has been deployed to your VM lab by these scripts.

Go agent initiates all requests. Enrollment submits token + CSR over server-authenticated HTTPS; subsequent heartbeat, desired config, acknowledgement and renewal use mTLS. NGINX verifies the certificate, strips caller identity headers and forwards authenticated identity over a protected upstream. Next.js checks expiry/revocation on every request, including reused TLS connections. Private keys stay on their respective host.

Configurations publishes immutable management revisions (polling interval plus recorded device kind/routing metadata). Telemetry displays actual OS, architecture, agent uptime and interfaces. Agent stores desired.json privately and reports received; it never reports applied or changes WireGuard/FRR/nftables in this MVP. Heartbeat freshness is the larger of 120 seconds or three configured polling intervals. Telemetry retention is 100 snapshots per node with retained-event idempotency; delayed retries outside retention may be treated as new observations.

Verification: npm run test:agent creates isolated PostgreSQL/PKI, starts a separate Next.js test server and pinned NGINX Docker container, builds the actual Go agent and proves Edge/Hub enrollment, config retrieval/staging, telemetry, certificate/header/bypass denial and revocation. Requires Docker, OpenSSL and Go 1.27.2. It cleans fixtures on normal success/failure; forced process termination may need fixture cleanup. The separate .next-agent directory avoids the live dev server. This test does not establish Debian systemd or network-plane readiness.

## UI component reuse

Use the existing `src/components/ui/` primitives and `src/components/fabric/` feature boundary. The [component architecture and audit](../docs/development/ui-component-architecture.md) documents props, variants, usage and validation; root AGENTS.md defines the mandatory reuse policy. Shared feedback and connection labels preserve current styling; mobile navigation supports keyboard focus containment, Escape and focus restoration.
