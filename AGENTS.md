# PacketMotion Fabric — Repository Agent Rules

## Mandatory startup
1. Inspect the repository and git status; never overwrite user or other agent changes.
2. Read `docs/prd/packetmotion-fabric-v1.1.md`, `docs/development/testing-strategy.md`, `docs/development/implementation-plan.md`, and relevant architecture docs.
3. Review latest `docs/change-logs/` entries.
4. Identify scope, risks, impacted files, tests and rollback before editing.

## Protected existing application
- Existing Next.js application, authentication, dashboard, layouts, navigation, styling, Tailwind tokens, CSS and reusable components are the authoritative UI baseline.
- Preserve behavior and appearance. Do not scaffold a replacement, redesign pages, reset CSS, swap auth providers, or add competing UI libraries.
- Reuse existing patterns; inspect before assuming directories, packages, framework versions or APIs.
- Only change existing UI when essential to a requested feature; explain impact and verify visual regressions where tooling exists.

## Engineering
- Implement L3-first only: Next.js controller UI/API and Go edge/hub agents, PostgreSQL, Debian, WireGuard, FRRouting BGP IPv4, nftables.
- The current delivered agent scope is management only: enrollment/mTLS, desired-revision retrieval and acknowledgement, certificate renewal, heartbeat and interface telemetry. Do not describe staged/received configuration as applied; network generation, privileged apply, rollback, tunnel/BGP health, and routed reachability are not implemented until code and evidence are added.
- The controller is the existing Next.js application with server-only domain services and PostgreSQL. The shared agent is in `sdwan-edge/` and uses Go 1.27.2; there is no separate Go controller service.
- Separate management, control and data planes. Forwarding must survive controller loss.
- Do not implement EVPN, VXLAN, L2 extension, or speculative features.
- Validate actual versions and command syntax; never invent successful test results.
- Treat networking changes as hazardous: staged validation, management-path safety, last-known-good state, rollback and explicit lab-only destructive testing.
- Never log secrets. Use scoped privileges and typed, validated agent operations.

## Testing
- Follow `docs/development/testing-strategy.md`. Risk-based, not every function.
- Immediately run targeted tests after each critical change; integration/failure tests for real network behavior.
- Available controller checks include `npm test`, `npm run test:integration`, `npm run test:browser`, `npm run test:visual`, `npm run test:agent`, lint, typecheck and build; use only checks relevant to the change. Available Go checks are listed in `sdwan-edge/AGENTS.md`. Network-plane claims require isolated VM/lab evidence.
- Mark unrun tests UNVERIFIED. Bug fixes require regression tests where feasible.

## Change management
- Every meaningful task (including failed attempts that modified files) must append a concise record to `docs/change-logs/log_change_NNN.md`.
- Rotate at 500 KiB; continue sequential numbering without overwriting history; maintain `docs/change-logs/README.md`.
- For concurrency, serialize appends with a lock or equivalent safe mechanism. Do not claim the logs are safe under concurrent writes without testing.
- Every response after changes: status, summary, changed files, tests actually run, UI/network impact, risks, rollback, log path, next step.
- Update docs and architecture decisions when behavior changes.

## Execution boundary
- Initial Plan Mode: inspect and propose, do not modify application code.
- After explicit plan approval, execute milestones sequentially with tests and logs. Stop for destructive/irreversible changes, missing credentials, infrastructure access, or decisions that materially change the architecture.
- Do not claim completion without satisfying acceptance criteria.

## UI Component Reusability & Design Consistency Policy
1. Before creating any UI component, inspect the existing reusable component library.
2. Search for an existing component that satisfies the requirement.
3. Reuse it when suitable.
4. Extend it using props, variants, or composition when reasonable.
5. Create a new component only when reuse or extension would introduce unnecessary complexity.
6. New generic UI components must follow the established shared-component conventions.
7. Feature-specific components should remain within their relevant feature boundaries.
8. Do not introduce duplicate components with equivalent responsibilities.
9. Preserve the established design system, styling, and visual identity.
10. Follow existing accessibility, responsive, and interaction patterns.
11. Do not introduce new UI libraries without justification.
12. When creating a reusable component, document its purpose, props, variants, and usage in the repository's existing documentation conventions; use docs/development/ui-component-architecture.md for controller UI.
13. Every future feature implementation must follow this policy.

## Runtime Error Reporting & Troubleshooting
1. Preserve the friendly recovery experience for unexpected runtime errors and keep internal details out of user-facing UI.
2. Keep the reference ID correlated across the UI fallback, server/API diagnostics, and persisted `runtime_errors` record where the error path supports it.
3. Diagnose a reference with `npm run errors:show -- <reference-id>` from `sdwan-controller/`; do not add a public endpoint or UI for browsing diagnostic logs.
4. Keep browser reports bounded, same-origin, and authenticated; validate all browser-supplied fields on the server.
5. Redact secrets from messages and stacks. Never record credentials, tokens, cookies, request bodies, or connection strings.
6. Treat persisted diagnostics as sensitive operational data. Document retention behavior and limit database/CLI access to authorized operators and developers.
7. Apply controller migrations with `npm run migrate:controller` before deploying code that depends on them. Never edit an applied migration; add a follow-up migration instead.
8. When changing error capture, verify the relevant server/browser capture path, safe persistence, reference correlation, and recovery controls with focused tests.
9. Document capture coverage and limitations, including behavior when PostgreSQL is unavailable and any authentication requirement for browser-submitted reports.
10. Keep diagnostic log access isolated from operator and agent identities; never grant dashboard privileges to the diagnostic-only developer account.
11. Provision or rotate the `developer` password only through the controller CLI; generate it randomly, store only its password hash, and display it only at creation/reset.
12. Protect diagnostic pages with rate-limited authentication, secure HTTP-only cookies, and read-only access to logs. Password resets must invalidate existing diagnostic sessions.
