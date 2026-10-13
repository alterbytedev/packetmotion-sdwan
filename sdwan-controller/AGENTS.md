# Controller agent instructions

Read [shared workspace instructions](../AGENTS.md) and [current status](../docs/STATUS.md) first. This guide applies to `sdwan-controller/`.

## Ownership and structure

- `src/app/`: Next.js App Router pages, server actions, Route Handler APIs.
- `src/components/`: operator UI; shared shadcn/ui components under `ui/`.
- `src/lib/`: server authentication/session utilities, PostgreSQL pool, shared helpers.
- `scripts/`: local setup tools. `tests/`: Node test-runner tests.

Use TypeScript and nearby conventions. Biome is configured; do not introduce a second formatter. UI uses Tailwind CSS 4, shadcn/ui, and Lucide. Product copy is English-only.

## Current constraints

Operator login, protected dashboard, admin/viewer roles, audited site/node inventory, controller migrations, runtime-error reporting and isolated diagnostic-log access are implemented. One-use enrollment, trusted-proxy mTLS device APIs, management desired revisions/acknowledgements, heartbeat/interface telemetry and the shared read-only Go agent are implemented. Actual network configuration generation/apply/rollback and tunnel/BGP/routed-reachability telemetry remain pending. A received revision is not an applied revision. The deployment is single-customer; no tenant system is planned. Do not present empty dashboard views as persisted network data. `/api/health` checks application liveness; `/api/ready` checks PostgreSQL readiness. A PostgreSQL client pool is not an implemented database schema.

Go appliance code and tests live in `../sdwan-edge/` within this repository. The implemented inventory API contract lives in `../api/openapi.yaml`; agent v1 endpoints are documented there. Next.js is the controller API; do not introduce a separate Go controller service. Enforce authenticated device scope, transactional token binding, and durable controller-side deduplication. Keep operator sessions separate from device identity. Never trust caller-supplied identity headers without a verified proxy boundary.

## Commands and verification

Run from this repository, using the Node version in `.nvmrc` and committed lockfile. For isolated agent-channel integration, `npm run test:agent` additionally requires Docker, OpenSSL and Go 1.27.2; it exercises the real Go binary and NGINX proxy boundary but does not verify Debian service installation or forwarding:

```sh
npm ci
npm test
npm run test:integration
npm run test:browser
npm run lint
npm run typecheck
npm run build
```

Use `npm run dev` for local UI testing. Follow [README.md](README.md) for development environment and bootstrap operator setup; do not overwrite an existing `.env.local` or run operator setup for documentation-only work. Keep secrets server-only and uncommitted. Database/API changes require development PostgreSQL verification once implemented; UI changes should verify responsive behavior and authentication boundaries.

Update the README and [workspace status](../docs/STATUS.md) when implemented capabilities change. Run Git commands here and preserve unrelated working-tree changes.

## Runtime errors and operational diagnosis

- Preserve the friendly error fallback and reference ID behavior documented in [runtime error troubleshooting](../docs/operations/runtime-error-troubleshooting.md).
- Browser reports are accepted only from the same origin and for signed-in operators. Keep report payloads bounded and validate them server-side.
- Run `npm run migrate:controller` before deploying code that relies on controller migrations. Treat applied migrations as immutable.
- Inspect a report from this directory with `npm run errors:show -- <reference-id>`. Diagnostic records contain bounded message/stack data and are sensitive; restrict access and review output before sharing it.
- Error details cannot be persisted when PostgreSQL or the runtime-error migration is unavailable; only safe metadata is emitted to process stderr.
- Update the controller README, workspace status, troubleshooting guide, and change log when capture behavior, retention, or operator workflow changes.
- Keep `/diagnosticlogs` credentials separate from operator and agent identities. Use `npm run init:developer` once and `npm run reset:developer` to rotate the generated password; never grant this account dashboard or mutation access.
- Diagnostic UI and queries must remain read-only. Keep its session HTTP-only, rate-limited, and invalidated by credential rotation.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
