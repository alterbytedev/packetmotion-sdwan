# SD-WAN Controller

## Quick start: first local run

Use this sequence for a fresh local development setup. Keep this terminal in `sdwan-controller/` unless a step says otherwise.

1. **Install prerequisites.** Install Node.js 22.12.0 or newer and PostgreSQL. Start PostgreSQL and create an empty development database named `sdwan_controller` (or choose another database name). The PostgreSQL role in the connection URL needs permission to create tables in that database.
2. **Install the project dependencies.** From the repository root:

   ```sh
   cd sdwan-controller
   npm ci
   ```

3. **Configure the database connection.** Create the private local environment file, then edit its `DATABASE_URL` to match your PostgreSQL username, password, host, port, and database name:

   ```sh
   cp .env.example .env.local
   ```

   For a local PostgreSQL instance with the example database and role, the URL is `postgresql://postgres:YOUR_PASSWORD@localhost:5432/sdwan_controller`. Do not commit or share `.env.local`.
4. **Create the authentication tables.** This step creates `operators` and `login_attempts`; it does not create a PostgreSQL server or database:

   ```sh
   npm run migrate:auth
   ```

5. **Create/update the controller tables.** This applies the versioned inventory, device, diagnostics, and branding migrations:

   ```sh
   npm run migrate:controller
   ```

6. **Create the first superadmin.** Run this once for an empty operator database. Save the generated password shown in the terminal; it is printed only once. The default email is `admin@admin.local`:

   ```sh
   npm run init:superadmin
   ```

7. **Start the development server.** Keep this terminal running:

   ```sh
   npm run dev
   ```

8. **Sign in.** Open [http://localhost:3000/login](http://localhost:3000/login) and enter the email and generated password. To use the server from another machine on a trusted network, start it with `npm run dev -- --hostname 0.0.0.0` and open `http://SERVER_ADDRESS:3000/login`; ensure the host firewall/network permits port 3000. In development, `allowedDevOrigins` includes the machine's interface IP addresses and the default remote hostname `100.83.173.93`. Set `NEXT_ALLOWED_DEV_ORIGINS` in `.env.local` to add browser-visible aliases (comma-separated hostnames, without scheme or port), then restart the dev server. `0.0.0.0` is only the server bind address, not the browser hostname.

For later runs, start PostgreSQL, then run `npm run dev`; do not repeat `init:superadmin`. On an existing installation whose first account is still an admin, promote that account once with `npm run set:operator-role -- admin@admin.local superadmin`; do not use `--override` for promotion. If login reports `relation "login_attempts" does not exist`, stop the dev server, confirm `.env.local` points to the intended database, run `npm run migrate:auth`, then start the dev server again. After signing in, open **Settings → Operator accounts**: superadmins can add admins or users (viewer access), and admins can add users (viewer access).

## npm commands

Run these commands from `sdwan-controller/`. They are the complete set of scripts declared in `package.json`.

### Run the controller

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Next.js development server on port 3000. |
| `npm run build` | Build the production application. |
| `npm run start` | Start the production build. Run `npm run build` first. |
| `npm run lint` | Lint controller source with Biome. |
| `npm run typecheck` | Generate Next.js route types and run TypeScript checks. |

### Database, operator, and branding setup

| Command | Purpose |
| --- | --- |
| `npm run migrate:auth` | Create or update authentication tables. Safe to rerun; does not change credentials. |
| `npm run setup:superadmin` | Alias for creating the initial superadmin. |
| `npm run setup:admin` | Legacy alias for initial admin setup. |
| `npm run migrate:controller` | Apply checksum-verified controller migrations, including branding and diagnostics schema. Run before starting an upgraded deployment. |
| `npm run init:superadmin` | Create the initial superadmin operator and session secret; generated password is printed once. Use for new installations. |
| `npm run init:superadmin --override` | Destructively replace all operator credentials, recreate the superadmin, and rotate the session secret, ending existing sessions. |
| `npm run init:admin` | Legacy initial-admin setup command; prefer `init:superadmin` for new installations. |
| `npm run set:operator-role -- <email> <role>` | Set an existing operator's role to `superadmin`, `admin`, or `viewer`. Use `superadmin` for white-label settings and diagnostics access. Keep at least one superadmin. |
| `npm run init:device-ca` | Create the device certificate authority files used for agent enrollment. Keep the private key secure. |

For example, from this directory, first apply controller migrations and then assign a role to an existing operator:

```sh
npm run migrate:controller
npm run set:operator-role -- admin@example.com superadmin
npm run set:operator-role -- admin@example.com admin
npm run set:operator-role -- viewer@example.com viewer
```

Replace the example email addresses with existing operator emails. The final command makes that operator read-only; only `superadmin` can edit branding or view diagnostics.

For the default development operator, use its `@localhost` email directly:

```sh
npm run set:operator-role -- admin@admin.local superadmin
```

The default development operator address `admin@admin.local` is supported too:

```sh
npm run set:operator-role -- admin@admin.local superadmin
```

### Diagnostics access

The read-only `/diagnosticlogs` page is available only to superadmins through the dashboard Diagnostics menu item. Admins, viewers, and signed-out visitors are redirected away; the page checks the current database role on every request. No separate diagnostic login or diagnostic user is used. Runtime error CLI access remains available to trusted host operators.

| Command | Purpose |
| --- | --- |
| `npm run errors:show -- <reference-id>` | Read the stored runtime diagnostic for the supplied reference ID from the controller database. |

Treat diagnostic output as sensitive operational data. See [Runtime error reports](#runtime-error-reports) and the [troubleshooting guide](../docs/operations/runtime-error-troubleshooting.md).

### Tests and verification

| Command | Purpose |
| --- | --- |
| `npm run test` | Run controller and repository-tooling unit/contract tests without a database. `npm test` is the equivalent npm shorthand. |
| `npm run test:integration` | Run integration tests against an isolated temporary PostgreSQL database. |
| `npm run test:browser` | Run browser journeys against an isolated database and server. |
| `npm run test:baseline` | Capture current login and navigation screenshots. |
| `npm run test:visual` | Compare protected browser regions with the screenshot baseline on the same OS/browser/font stack. |
| `npm run test:agent` | Run isolated enrollment and management-channel checks; requires Docker, OpenSSL, and Go 1.27.2. |

Integration and browser scripts use a dedicated test database account that can create databases; see [Isolated verification](#isolated-verification) for setup and cleanup behavior. `npm run test:agent` details and its scope are documented under [Go agent enrollment and management channel](#go-agent-enrollment-and-management-channel).


If an operator already exists, `npm run init:superadmin` intentionally exits without changing credentials. To deliberately replace all credentials, run `npm run init:superadmin --override`. This deletes all operator rows, creates a new superadmin, and rotates the session secret, ending existing sessions. Keep `.env.local` private and never commit it.

## Project overview

Next.js/TypeScript application for the controller UI and HTTP API, with PostgreSQL as the database. The shared Go edge/hub agent and its test tools live in `../sdwan-edge/` within this repository. There is no separate Go controller API service.

The controller includes an operator login and protected dashboard with `/dashboard` overview, `/dashboard/devices`, `/dashboard/devices/[id]`, `/dashboard/telemetry`, and `/dashboard/settings` routes. Operator email and scrypt password hash are stored in PostgreSQL; signed HTTP-only sessions use a secret from `.env.local`. Device/network inventory is persisted in PostgreSQL and managed from the existing Devices view. Registration does not enroll a device or establish connectivity. Enrollment tokens, mTLS Go agent enrollment, management configuration revisions and actual agent telemetry are implemented. WireGuard/BGP/firewall configuration and routed reachability telemetry remain pending.

## Operator access details

`npm run migrate:auth` creates or updates the authentication tables and is a required setup step for new and upgraded installations. It is safe to rerun and does not create, replace, or change operator credentials. Run it followed by `npm run migrate:controller` after deploying controller updates and before starting the application. Controller migrations are additive, checksum-verified, and serialized by a PostgreSQL lock. Existing operators receive the admin role without credential changes. `npm run init:superadmin` creates the first superadmin and writes `CONTROLLER_SESSION_SECRET` to `.env.local`; it is only for initial credential setup. To choose another initial email, set `CONTROLLER_ADMIN_EMAIL` in `.env.local` or the process environment before running init. Password hashes are stored in PostgreSQL using scrypt; plaintext passwords are only printed once during setup. Superadmins can create admin and viewer accounts in Settings; admins can create viewer accounts. New accounts receive a generated password shown once. To replace all operator credentials, explicitly run `npm run init:superadmin --override`.

Sessions last eight hours, use HTTP-only SameSite cookies, and require secure cookies in production; deploy behind HTTPS. Login attempts are limited to 10 per normalized email per minute using PostgreSQL, shared across controller instances. Expired limiter rows are removed during login limiter activity. A successful login clears that email's counter, and changing the password invalidates existing sessions. Superadmins and admins can manage operator accounts within their role limits; admins can also create inventory, while viewers are read-only. There is no self-service password reset; no tenant roles are implemented.

## Development

The controller runs on port 3000. `GET /api/health` checks application liveness only; `GET /api/ready` runs `SELECT 1` against PostgreSQL and returns 503 when the database is unavailable. Both checks are uncached. Readiness responses do not reveal database errors or connection details. No production database or secret is configured.

## Runtime error reports

Unexpected route/render errors show a friendly recovery page with a reference ID. Uncaught browser errors and rejected promises also replace the current screen with that fallback and submit a bounded same-origin report for the signed-in operator. Server errors are captured by Next.js instrumentation. Error details (message and a bounded, redacted stack), route pattern, sanitized error name/code, and occurrence counters are stored in PostgreSQL for 30 days. Secrets, request bodies, cookies, and query strings are not intentionally stored. The fallback never displays internal error details.

After applying controller migrations, look up a reference from the controller host with `npm run errors:show -- <reference-id>`. The command requires the same `DATABASE_URL` used by the controller and returns the stored diagnostic record. If PostgreSQL logging is unavailable, a safe reference/error-class record is written to process stderr; detailed stack persistence is then unavailable.

For an incident, copy the reference ID shown to the operator, then run the command from this directory. Check the error source, route/method, sanitized class/code, occurrence count, and redacted message/stack. Server render errors use Next.js' error digest as their reference; client and API errors use generated IDs. Browser submissions require an authenticated operator session. Expected validation and handled API errors are returned through their normal UI states and are not reported as uncaught runtime failures. The reporting route does not provide a public log viewer.

Runtime error records can include application context despite bounded redaction. Limit database and CLI access, and review diagnostic output before sharing it. Records older than 30 days are eligible for best-effort cleanup during error writes. If no errors are written, cleanup may not run until a later write. See the [runtime error troubleshooting guide](../docs/operations/runtime-error-troubleshooting.md) for deployment and diagnosis details.

The read-only web log is available at `/diagnosticlogs` to superadmins from the dashboard Diagnostics menu item. Admins, viewers, and signed-out visitors are redirected to the dashboard or login page, and the page rechecks the current role server-side. Each report has a **Copy report** action that copies its reference ID, UTC timestamps, occurrence count, source, route/method, error name/code, message, and stack trace as plain text for an issue or AI-assisted troubleshooting. Review copied diagnostic data before sharing it because application context can be sensitive. There is no separate diagnostic user or web credential. The legacy `diagnostic_developer` table from already-applied migration 0004 is unused and retained to honor migration immutability; no diagnostic login code reads it.

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

Roles reside in `operators.role`; existing accounts remain admins after the additive superadmin migration. New installations create the initial superadmin with `npm run init:superadmin`. In Settings, superadmins can create admins and viewers, while admins can create viewers. Only superadmins can edit the white-label logo. The host-only `npm run set:operator-role` command remains available for recovery and role changes. Keep at least one superadmin account. Permission changes are read from PostgreSQL, not cached in the signed cookie. The public logo endpoint exposes only the configured image; changes require a superadmin session and same-origin request.

## Isolated verification

`npm test` runs controller and repository-tooling unit/contract tests without a database. `npm run test:integration` and `npm run test:browser` create a unique temporary database, seed generated test credentials, and remove that database on normal completion including assertion failures. Set `TEST_DATABASE_URL` to a dedicated PostgreSQL account allowed to create databases; local runs may use DATABASE_URL from .env.local as the connection to create a separate test database. Existing operator/database records are never test fixtures. Forced process termination can leave a `fabric_test_*` database requiring later cleanup.

Install browser binaries with `npx playwright install chromium` before browser tests. Browser tests use port 3107 and `.next-isolated/`, independently of an existing development server. Python 3 is required for change-log flock tests on macOS/Linux. Do not run overlapping browser suites on the same test port/build directory.

M0 screenshots are retained under `../docs/evidence/browser/baseline/`. Run `npm run test:baseline` for current login/navigation screenshots and `npm run test:visual` for exact protected-region comparisons on the same OS/browser/font stack. CI runs journeys and captures artifacts; the macOS pixel baseline is not a cross-platform screenshot gate. Actual inventory acceptance and viewer/CSRF denial are tested through browser HTTP requests and PostgreSQL. Hosted CI results remain unverified until a workflow runs.

Rollback: revert M1 UI/API bindings and keep the additive migration and audit history. Do not drop tables or replace operator credentials as a routine rollback.

## Go agent enrollment and management channel

Add device returns a one-time enrollment token, stored only as SHA-256 hash in PostgreSQL and expiring in 15 minutes. Save/copy it from the temporary UI; reload/hide clears it. Existing unenrolled devices can issue a New token, which invalidates the previous token. Enrolled/revoked devices cannot issue new enrollment tokens. Admin-only revocation is available through POST /api/operator/nodes/{id}/revoke.

Before connecting a VM, run migrate:controller, create a dedicated device CA with npm run init:device-ca, and configure CONTROLLER_DEVICE_CA_CERT/KEY, CONTROLLER_AGENT_PROXY_SECRET and CONTROLLER_AGENT_URL. Set CONTROLLER_PUBLIC_ORIGIN to the browser-facing public HTTPS origin in production; enrollment instructions use it as their installer URL by default. Set CONTROLLER_ENROLLMENT_URL only when the device-reachable installer URL differs. Superadmins can configure private IPs for explicit HTTP lab instructions in Settings; this exposes enrollment traffic to the lab network. The proxy setup script sets CONTROLLER_AGENT_CA_SHA256, and generated lab commands pass that pin so the installer verifies and installs the HTTPS server CA before enrollment and service startup. Use HTTPS for all non-isolated deployments. Keep existing .env.local values and operator credentials. See [proxy deployment](../deploy/proxy/README.md) and [Go agent development](../sdwan-edge/README.md). OpenSSL is a controller runtime dependency for bounded CSR verification/certificate issuance.

Go agent initiates all requests. Enrollment submits token + CSR over server-authenticated HTTPS; subsequent heartbeat, desired config, acknowledgement and renewal use mTLS. NGINX verifies the certificate, strips caller identity headers and forwards authenticated identity over a protected upstream. Next.js checks expiry/revocation on every request, including reused TLS connections. Private keys stay on their respective host.

Configurations publishes immutable management revisions (polling interval plus recorded device kind/routing metadata). Telemetry displays actual OS, architecture, agent uptime and interfaces. Agent stores desired.json privately and reports received; it never reports applied or changes WireGuard/FRR/nftables in this MVP. Heartbeat freshness is the larger of 120 seconds or three configured polling intervals. Telemetry retention is 100 snapshots per node with retained-event idempotency; delayed retries outside retention may be treated as new observations.

Verification: npm run test:agent creates isolated PostgreSQL/PKI, starts a separate Next.js test server and pinned NGINX Docker container, builds the actual Go agent and proves Edge/Hub enrollment, config retrieval/staging, telemetry, certificate/header/bypass denial and revocation. Requires Docker, OpenSSL and Go 1.27.2. It cleans fixtures on normal success/failure; forced process termination may need fixture cleanup. The separate .next-agent directory avoids the live dev server. This test does not establish Debian systemd or network-plane readiness.

## UI component reuse

Use the existing `src/components/ui/` primitives and `src/components/fabric/` feature boundary. The [component architecture and audit](../docs/development/ui-component-architecture.md) documents props, variants, usage and validation; root AGENTS.md defines the mandatory reuse policy. Shared feedback and connection labels preserve current styling; mobile navigation supports keyboard focus containment, Escape and focus restoration.

## Selected hub tunnel source increment

Source 0.2.0 adds saved multi-hub selection and a local WireGuard activation gate. Apply controller migrations through 0009 before deploying its UI/API. Existing signed installer/release 0.1.6 and the default unprivileged service remain management-only. See [activation, recovery and evidence limits](../docs/operations/wireguard-tunnels.md). No automatic release or network activation is performed.
