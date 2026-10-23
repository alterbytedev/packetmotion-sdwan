# PacketMotion Fabric — Repository Agent Rules

## Guidance ownership
- This file owns shared safety, scope and execution rules. Scoped `AGENTS.md` files add area-specific guidance; source documents own detailed behavior and procedures.
- Start navigation with the [codebase map](docs/development/codebase-map.md), [agent index](docs/agent/README.md), and [human index](docs/human/README.md). Prefer links to authoritative guidance over duplicate status summaries.
- For readability work, preserve contracts, transaction/lock order, serialized checksum inputs, recovery behavior and UI appearance. Use small cohesive extractions and review against the starting worktree.

## Mandatory startup
1. Inspect the repository and git status; never overwrite user or other agent changes.
2. Read `docs/agent/README.md` for the agent workflow, then consult the relevant source documents under `docs/` and `docs/human/README.md` for current product, architecture, operations, or status context.
3. Review latest `docs/change-logs/` entries.
4. Identify scope, risks, impacted files, tests and rollback before editing.

## Protected existing application
- Existing Next.js application, authentication, dashboard, layouts, navigation, styling, Tailwind tokens, CSS and reusable components are the authoritative UI baseline.
- Preserve behavior and appearance. Do not scaffold a replacement, redesign pages, reset CSS, swap auth providers, or add competing UI libraries.
- Reuse existing patterns; inspect before assuming directories, packages, framework versions or APIs.
- Only change existing UI when essential to a requested feature; explain impact and verify visual regressions where tooling exists.

## Engineering
- Implement L3-first only: Next.js controller UI/API and Go edge/hub agents, PostgreSQL, Debian, WireGuard, FRRouting BGP IPv4, nftables.
- The default installed service and signed 0.1.6 release are management only: enrollment/mTLS, desired-revision retrieval and acknowledgement, certificate renewal, heartbeat and interface telemetry. Do not describe staged/received configuration as applied; source 0.2.0 adds locally gated owned WireGuard adjacency apply/recovery and handshake observations with isolated namespace evidence. Follow docs/operations/wireguard-tunnels.md and ADR 0004; the supplied Debian lab has handshake, tunnel-ping, reboot and controller-disconnection recovery evidence. Source and signed 0.3.0 bundles now include the local-only schema-v3 LAN/FRR BGP activation flow; these bundles are generated in controller public assets, but appliance rollout and BGP session verification remain pending. An owned nftables guard blocks tunnel transit; general nftables policy, LAN forwarding, routed failover, NAT and production/fleet deployment remain UNVERIFIED/pending.
- The controller is the existing Next.js application with server-only domain services and PostgreSQL. The shared agent is in `sdwan-edge/` and uses Go 1.27.2; there is no separate Go controller service.
- Separate management, control and data planes. Forwarding must survive controller loss.
- Do not implement EVPN, VXLAN, L2 extension, or speculative features.
- Validate actual versions and command syntax; never invent successful test results.
- Treat networking changes as hazardous: staged validation, management-path safety, last-known-good state, rollback and explicit lab-only destructive testing.
- Never log secrets. Use scoped privileges and typed, validated agent operations.

## Code Quality & Architecture Guardrails

Apply these principles to every feature assessment, bug fix, refactoring, and implementation, within the approved scope and delivery and local network activation boundaries above.

### Reuse before create
- Search for existing functions, components, services, APIs, utilities, schemas, and contracts before adding new ones. Reuse or extend suitable implementations.
- Keep shared business logic, validation, configuration handling, and state management authoritative in one place. Avoid parallel implementations.
- Do not introduce an abstraction solely to eliminate a few similar lines; use the UI reuse policy below for components.

### Architecture and state ownership
- Follow existing naming, directories, dependency direction, and coding patterns. Keep UI, API, domain logic, persistence, and system/network operations separate; keep controller Route Handlers thin and domain services server-only.
- Keep modules cohesive and independently testable, with explicit dependencies and predictable data flow. Avoid circular dependencies, unnecessary layers, and excessive indirection.
- Distinguish desired configuration, staged/received revisions, and observed operational state. Define ownership of validation, configuration, and reconciliation; do not create competing authoritative state across controller, agent, database, and operating system.
- Introduce a new architecture pattern only when existing patterns are demonstrably insufficient and the execution boundary permits the decision.

### Minimal, readable changes
- Make the smallest coherent change that fully meets the requirement. Avoid unrelated refactoring, formatting, dependency upgrades, and silent product behavior changes.
- Preserve backward compatibility unless a breaking change is explicitly approved. Keep changes easy to review, troubleshoot, test, and revert.
- Prefer simple, explicit code, clear names, focused functions, standard libraries, and existing dependencies. Centralize shared rules and configuration; avoid magic values and hidden side effects.
- Explain non-obvious decisions in comments rather than narrating obvious code.
- For every new feature, identify local files it generates, such as build output, test screenshots, traces, caches, and reports. If those artifacts are not required source, fixtures, reviewed evidence, or release assets, add the narrowest suitable `.gitignore` rule in the same change so routine use does not dirty the worktree or grow the Git repository. Avoid broad patterns that hide required files; verify ignore behavior with `git check-ignore`.

### Reliability and network ownership
- Make provisioning and reconciliation idempotent. Handle partial failures, retries, restarts, concurrent operations, and disconnected devices safely.
- Validate configuration before applying it; preserve last-known-good state and provide meaningful errors and predictable recovery. These are requirements for future apply work, not evidence that apply or rollback exists today.
- Prefer established Linux, WireGuard, FRRouting, and nftables capabilities over custom networking implementations. Avoid competing owners for the same interfaces, routes, firewall rules, or tunnels.
- For approved network work, consider convergence, asymmetric routing, NAT, overlapping subnets, management-path safety, and failure scenarios. Keep changes observable, consistently staged, and operationally reversible, with isolated lab evidence.

### Performance and resource efficiency
- Avoid unnecessary polling, queries, API calls, and background processes; use the existing event-driven management mechanisms where appropriate.
- Bound retries, concurrency, queues, and logging. Prevent goroutine and memory leaks; keep controller and agent resource use predictable.
- Optimize measured bottlenecks rather than assumptions; do not add infrastructure or background services speculatively.

### Validation and final self-review
- Before implementation, identify reusable behavior, overlapping functionality, ownership, and the smallest safe integration point.
- Test behavior, integration boundaries, configuration changes, and important failure/retry scenarios according to the risk-based testing policy below.
- Review the final diff for duplicate logic/state, unnecessary complexity, unused imports, dead code, inconsistent naming, and accidental parallel implementations. Remove safely superseded code within the task scope; preserve unrelated work.
- Before claiming completion, verify architecture consistency, clear responsibilities, failure/retry safety, troubleshooting through redacted diagnostics and observed state, and scoped, tested, reversible changes. Report untested scenarios, remaining risks, and technical debt introduced or discovered.
- Prefer a simpler, equally reliable implementation whenever available.

Core principle: Build the smallest correct, reusable, maintainable solution that fits the existing system; do not optimize for code quantity or architectural sophistication.

## Testing
- Follow `docs/development/testing-strategy.md`. Risk-based, not every function.
- During each iteration, run the smallest relevant checks; immediately run targeted tests after each critical change. Documentation-only changes need diff review, logic/API changes need focused unit/integration tests, Go agent changes need relevant Go tests, and UI changes need checks of the affected page. Browser suites are not required after every edit.
- At feature completion, targeted browser tests are required for changes to login, sessions, roles, navigation, or enrollment forms. Layout, CSS, and shared UI component changes require visual verification of affected views. Run broader regression checks according to impact at milestone completion or before merge/release; retain security, recovery, and isolated network integration/failure requirements.
- Do not repeat passing checks unless subsequent changes, failures, or new evidence affect their validity. Record the checks run and reasons for skipping others; never treat manual page inspection as an automated browser test.
- Available controller checks include `npm test`, `npm run test:integration`, `npm run test:browser`, `npm run test:visual`, `npm run test:agent`, lint, typecheck and build; use only checks relevant to the change. Available Go checks are listed in `sdwan-edge/AGENTS.md`. Network-plane claims require isolated VM/lab evidence.
- Mark unrun tests and unproven behavior UNVERIFIED, with the reason; checks outside the change's scope need not be executed. Bug fixes require regression tests where feasible.

## Change management
- Every meaningful task (including failed attempts that modified files) must append a concise record to `docs/change-logs/log_change_NNN.md`.
- Rotate at 500 KiB; continue sequential numbering without overwriting history; maintain `docs/change-logs/README.md`.
- For concurrency, serialize appends with a lock or equivalent safe mechanism. Do not claim the logs are safe under concurrent writes without testing.
- Every response after changes: status, summary, changed files, tests actually run, UI/network impact, risks, rollback, log path, next step.
- Update documentation when the change makes existing instructions, behavior descriptions, setup steps, API contracts, architecture, security guidance, status, or user workflows inaccurate or incomplete. If none of those are affected, do not add a documentation edit just to satisfy a checklist; still append the required change log.
- Keep agent workflow and implementation guidance discoverable through `docs/agent/README.md`; keep product, architecture, operational, status, and evidence material discoverable through `docs/human/README.md`. Update the relevant index when adding, moving, or renaming a document.
- Update architecture decision records when a consequential architecture decision changes; routine implementation details belong in the relevant source document and change log.

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
10. Keep diagnostic logs unavailable to admin, viewer and agent identities. `/diagnosticlogs` uses an operator session restricted to the current `superadmin` role, and the page must enforce that role server-side even when the menu hides the link.
11. Do not maintain a separate diagnostic developer user or login.
12. Keep diagnostic pages read-only and treat log output as sensitive operational data; retain rate-limited authenticated browser reporting and redaction controls.
