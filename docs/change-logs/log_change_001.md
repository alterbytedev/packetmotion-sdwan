# PacketMotion Fabric — Change Log 001

> Initialized as an empty log for future agent tasks. Do not fabricate change records.

## ALIGN-001 — 2026-10-12T03:54:07.158656+00:00

- Agent: Codex /root. Milestone: architecture/documentation alignment. Status: COMPLETE (documentation only).
- Summary/reason: Rama selected Next.js controller API + PostgreSQL and outbound Go edge/hub agents to reduce maintenance boundaries. Updated instructions, PRD, architecture, testing strategy, master prompt and M0-M7 plan; recorded accepted ADR and restored missing status/index references.
- Files: AGENTS.md; PROMPT_CODEX_PLAN_MODE.md; sdwan-controller/AGENTS.md; sdwan-controller/README.md; docs/prd/packetmotion-fabric-v1.1.md; docs/architecture/network-design.md; docs/architecture/security-model.md; docs/development/implementation-plan.md; docs/development/testing-strategy.md; docs/adr/0001-nextjs-controller-go-agents.md; docs/STATUS.md; docs/README.md; this log.
- Checks actually run: git diff --check PASS; inline Python validation of local Markdown references, M0-M7 milestones, FR-001 through FR-012 retention and architecture alignment PASS. Application/network tests not run for document-only changes; proxy, capacity and network behavior remain UNVERIFIED.
- UI/network impact: no application source, UI, auth, dependency, database or network configuration changed.
- Risks: trusted proxy identity boundary, PKI and capacity require implementation/lab verification; lab access unresolved.
- Rollback: revert only alignment documents if decision changes; retain this append-only record and append a superseding decision.
- Next: review aligned plan and approve application implementation.

## M0-TOOLING — 2026-10-12 — Codex /root

- Status: tooling implemented; browser baseline in progress.
- Summary/reason: isolated database test runner, pinned Playwright, CI and locked rotating change-log writer; preserve the existing development server using a separate test build directory.
- Files: scripts/append-change-log.mjs; tests/change-log.test.mjs; .github/workflows/ci.yml; .gitignore; sdwan-controller/package.json/package-lock.json; next.config.ts; tsconfig.json; scripts/test-isolated.mjs; tests/integration/operator-auth.test.mjs (moved); playwright.config.ts; tests/browser/baseline.spec.ts.
- Actual tests: logger first run FAIL (unescaped template backticks), corrected; node --test tests/change-log.test.mjs PASS 3 tests (16 concurrent writers, rotation, killed-lock recovery/stale index, oversized rejection). npm test PASS 16; npm run test:integration PASS 1 with isolated DB removal. First baseline attempt FAIL due to existing dev-server lock; isolated distDir added. Browser binaries installation in progress. No CI hosted execution claimed.
- UI/network impact: existing rendering/auth unchanged; test-mode build-directory isolation only. No device/network operations.
- Risks/rollback: Python 3/flock is required on macOS/Linux; concurrent shared-network filesystems are not supported or tested. Remove tooling/config edits to roll back, preserve logs. Full disk during append is not a tested crash scenario.
- Next: capture desktop/mobile baseline, finish M0 regression, then M1.

## M0-BASELINE — 2026-10-12 — Codex /root

- Status: M0 PASS for current controller scope. Go toolchain pin deferred until agent work M2; no Go source is needed for M0/M1.
- Summary/files: isolated tests/CI/locked logger completed; docs/evidence/README.md, browser/baseline/*.png and docs/change-logs/README.md document usage and limitations.
- Tests: npm test PASS 16; npm run test:integration PASS 1; npm run lint/typecheck/build PASS; npm run test:baseline PASS 2 (desktop/mobile login, protected dashboard, navigation, logout) after Chromium installation. An intermediate baseline run failed because the browser installation was incomplete; rerun passed. CI configuration exists but hosted GitHub run is UNVERIFIED. Temporary databases removed on each normal run, including test failures.
- UI/network impact: original app rendering preserved and six baseline screenshots captured; no device/network changes. Playwright is a pinned development dependency.
- Risks/rollback: baseline evidence capture is not yet a pixel comparison; interrupted test-runner cleanup after SIGKILL is not guaranteed. Revert M0 tooling if needed, retain history. No production/operator credentials changed.
- Next: M1 additive migration, authorization/audit/inventory services and existing Devices view binding.

## M1-SERVICES — 2026-10-12 — Codex /root

- Status: service/migration checks PASS; UI and full milestone regression pending.
- Summary: additive admin/viewer roles, site/node inventory, transactional audit, checksum/advisory-lock migrations, shared server-only authorization/validation services and same-origin bounded JSON API endpoints. Existing auth/session format preserved. Operator role is rechecked under row lock before writes. Site overlap checks serialize across transactions.
- Files: sdwan-controller/migrations/0001_inventory_roles_audit.sql; scripts/migrate-controller.mjs; scripts/lib/migrations.mjs; src/lib/fabric/{types,authorization,audit,validation,inventory,http}.ts; src/app/api/operator/{sites,nodes}/route.ts; tests/support/load-ts.cjs; tests/inventory.test.mjs; tests/integration/inventory.test.mjs; scripts/test-isolated.mjs; package.json.
- Tests run: node --test tests/inventory.test.mjs PASS 3; npm run test:integration PASS 5 including migration rerun/concurrency/checksum, persisted inventory/audit, overlapping concurrent creates, audit rollback, stale admin role and auth login/logout. Isolated database removed. UI/real HTTP journey pending.
- Impact: no device networking changed; role/authz is additive. Audit snapshots actor email; actor FK nullable on credential override so existing init:admin --override remains usable without deleting audit history.
- Risks/rollback: overlap invariant currently enforced by service locking; privileged direct SQL can bypass it. Keep additive schema; revert service/API bindings to roll back. No destructive DB rollback.
- Next: existing dashboard inventory forms/list, browser negative cases and regression.

## M1-UI-ITERATION — 2026-10-12 — Codex /root

- Status: UI implementation present; browser gate undergoing correction, not complete.
- Files: src/components/fabric/device-inventory.tsx; src/components/controller-dashboard.tsx; src/app/dashboard/page.tsx; src/lib/fabric/http.ts; .env.example; next.config.ts; tests/browser/{fixture,baseline.spec,inventory.spec}.ts; tests/auth.test.mjs; tests/api-contract.test.mjs; api/openapi.yaml; package.json/package-lock.json; tests/login.test.mjs; tests/session.test.mjs; scripts/test-isolated.mjs.
- Summary: reuse existing Cards/Buttons/Inputs for admin site/node creation, persisted inventory, Viewer role and explicit Not enrolled status. Share actual session exports in tests instead of duplicate test signing implementations. Added OpenAPI contract and real browser security checks.
- Actual results: lint initially FAIL 5 findings (custom Input labels and control-character regex), fixed then lint/typecheck PASS. Regression npm test PASS 19 and build PASS before latest auth/contract additions. Targeted auth lookup-order test PASS 1; OpenAPI targeted validation PASS 1. Browser attempt 1 PASS 4/FAIL 2 (implicit select label lookup), fixed explicit labels. Attempt 2 PASS 4/FAIL 2 (legitimate POST blocked by internal/public origin mismatch), fixed public origin configuration and development Host handling; rerun pending. No failure is represented as PASS.
- UI/network impact: Devices gets additive inventory controls/list, current operator role and actual registered device counts; global CSS/layout/navigation/auth preserved. No device or host networking changed.
- Risk/rollback: production operator mutations require CONTROLLER_PUBLIC_ORIGIN; trusted proxy remains M2 UNVERIFIED. Revert inventory UI/API binding and retain additive schema and history.
- Next: final browser/regression/visual checks, local additive migration, operator docs.

## M1-LOCAL-MIGRATION-VISUAL — 2026-10-12 — Codex /root

- Status: local migration and visual/browser gates PASS; final full regression pending.
- Summary/files: deployed additive controller migration to local development DB; preserved credentials. Responsive inventory mobile cards, explicit production Origin configuration, OpenAPI and docs/README/status updated. Added scripts/compare-browser-baseline.mjs with pinned pngjs and protected-region-comparison.json; baseline originals retained.
- Actual checks: targeted request tests PASS 3 including production Origin missing/configured cases. Latest npm run test:integration PASS 5 (rerun also preserves inventory/audit); npm run test:browser PASS 6 after responsive mobile change. Local migration CLI PASS, SELECT id/email/password_hash before/after deep equality PASS (values never logged). Protected login/header pixel comparison PASS, zero changed pixels in four same-OS Chromium regions. Original and new inventory screenshots manually reviewed. An optional Pillow comparison attempt was unavailable (PIL missing); used pngjs instead. Hosted CI/network/agent/load checks UNVERIFIED.
- UI/network impact: preserved theme/layout/navigation/login; Devices adds registration and mobile status cards, no actual network operations. No test records inserted into existing development inventory.
- Risks/rollback: requires migrate:controller after migrate:auth and CONTROLLER_PUBLIC_ORIGIN for production writes; account-management UI deferred. Keep additive schema/data and audit/change logs, revert owned UI/API bindings for application rollback.
- Next: final regression, diff and evidence review; close M0/M1 only.

## M1-ORIGIN-REGRESSION — 2026-10-12 — Codex /root

- Status: reproduced and fixed; broader regression rerunning.
- Summary/reason: security review found production missing configured origin and missing request Origin could compare null == null. Added explicit !expectedOrigin rejection and regression coverage. Degraded inventory UI reports Role unavailable instead of inventing a viewer role.
- Files: sdwan-controller/src/lib/fabric/http.ts; tests/inventory.test.mjs; src/components/controller-dashboard.tsx; formatting of dashboard/page.tsx and touched component.
- Actual test: node --test tests/inventory.test.mjs before fix FAIL 1/3 (201 instead of expected 403); after fix PASS 3/3. Earlier full suite PASS 21, integration PASS 5, lint/typecheck/build PASS and visual comparison PASS are superseded for modified files until current regression finishes.
- UI/network impact: no normal authenticated behavior/layout change; production originless mutation now denied. No device or host network changes.
- Risks/rollback: CONTROLLER_PUBLIC_ORIGIN must be configured for production mutations; do not remove the fail-closed guard. Application rollback via previous UI/API version with retained schema/logs.
- Next: finish final regression and close approved M0/M1 scope.

## M0-M1-CLOSURE — 2026-10-12 — Codex /root

- Status: COMPLETE for approved M0/M1 controller scope. Hosted CI, M2–M7, device/network and load gates remain UNVERIFIED/unimplemented.
- Delivered: isolated unit/integration/browser testing, pinned Playwright and OpenAPI/PNG validation tooling, protected baseline evidence, CI configuration, tested locked rotating logger; additive role/site/node/audit schema with checksum-verified serialized migrations; Next.js operator inventory APIs and shared server-only validation/authorization/audit services; existing Devices view creation/search/list with mobile status cards and actual recorded counts. Go toolchain is deferred to M2 because no agent source exists yet.
- Changed file groups: root scripts/tests/CI and ignore rules; sdwan-controller package/lock/test configuration and test suites; scripts/migrate-controller.mjs/scripts/lib/migrations.mjs; migrations/0001_inventory_roles_audit.sql; src/lib/fabric/; src/app/api/operator/; dashboard/page.tsx; controller-dashboard.tsx; components/fabric/device-inventory.tsx; api/openapi.yaml; README/AGENTS/.env.example; docs/STATUS.md, implementation plan, evidence and this log. Detailed iteration entries identify exact files/failures.
- Actual final results: npm test PASS 21; npm run test:integration PASS 5 (latest test-file serialization rerun also PASS 5); npm run test:browser PASS 6 desktop/mobile (auth/navigation/logout, persisted admin UI create/reload, viewer/forged cookie, same-origin/prefix/site negative cases); npm run lint PASS 29 files; npm run typecheck PASS; npm run build PASS incl new API routes; npm run test:visual PASS zero changed pixels in four protected same-local-browser login/header regions. git diff --check PASS; inline local Markdown link validation PASS. Syntax checks on logger/test runner/migration CLI PASS.
- Database evidence: local additive controller migration applied through CLI; in-process before/after operator id/email/password_hash comparison PASS, no values logged. Temporary integration/browser databases removed. Existing development inventory was not populated by tests. Migration rerun preserves credentials and inventory/audit; concurrent overlapping app creates have one winner; audit failure rolls back state.
- UI/network impact: login/auth source, globals.css, app layout and shared UI component files unchanged (git diff --exit-code PASS). Existing dashboard shell/theme/navigation preserved, inventory content and dynamic roles/counts intentionally extended. Final mobile screenshot reviewed: Not enrolled visible without horizontal scrolling. No device/host networking changed.
- Limitations/risks: production writes need CONTROLLER_PUBLIC_ORIGIN; device TLS/proxy and enrollment pending M2; account/role-management UI deferred; DB-administrator direct SQL can bypass service checks; SIGKILL can leave temporary test DBs; change-log partial disk-write recovery/network-filesystem concurrency not claimed. Pixel comparisons are scoped and same-OS only, not a complete cross-platform visual guarantee.
- Rollback: revert M1 dashboard/API/service bindings; retain additive schema, inventory and audit/change logs. Do not drop tables or replace existing credentials as routine rollback. Revert M0 tooling independently if needed while preserving history.
- Next: M2 secure enrollment and read-only Go agent after scope approval; local VM lab is Rama's responsibility later.

## PROVISIONING-UX-001 — 2026-10-12 — Codex /root

- Status: COMPLETE for operator-facing provisioning UX; actual enrollment remains M2 pending.
- Summary/reason: Rama identified developer setup instructions as unsuitable product copy. Replaced PostgreSQL/API setup and placeholder activation URL with Add site -> Register device -> Connect device preparation flow. Progress uses actual inventory, CTA routes to functioning Devices registration; viewer receives View devices. Lists persisted hub/branch records and explicitly indicates connection unavailable without generating fake tokens/actions.
- Files: sdwan-controller/src/components/fabric/device-provisioning.tsx; src/components/controller-dashboard.tsx; tests/browser/baseline.spec.ts; tests/browser/inventory.spec.ts; README.md; docs/STATUS.md; docs/evidence/browser/provisioning-{desktop,mobile}.png; current browser captures/comparison metadata; this log.
- Actual tests: initial lint/typecheck and browser 6/6 PASS; after extending populated-inventory/viewer checks and page description, npm run test:browser PASS 6 desktop/mobile (empty/populated preparation, actionable CTA, role-aware links plus existing auth/CSRF/inventory checks); npm run lint PASS 30 files; npm run typecheck PASS; npm run build PASS; npm run test:visual PASS 0 changed pixels across four protected login/header regions. git diff --check PASS. Desktop and mobile provisioning screenshots visually reviewed.
- UI/network impact: changed Provisioning content only plus view description; existing Cards/Buttons/theme/navigation/auth reused. No backend/schema/agent/network changes and no enrollment availability claim.
- Risks/limitations: connecting a device requires future M2 implementation; this task improves the usable preparation flow. Hosted CI/network checks not run for this UI scope.
- Rollback: revert provisioning component/import/render, description and associated browser/docs changes; retain append-only log. No database rollback needed.
- Next: product flow ready for M2 enrollment integration when that scope is approved.

## SIMPLE-DEVICES-001 — 2026-10-12 — Codex /root

- Status: one-step service checks PASS; browser/regression pending.
- Summary/reason: Rama requested simpler consistent device flow and clarification of branch. UI uses Device as the object and Edge/Hub as types; no site creation/selection prerequisite. Internal network/site grouping retained for subnet integrity and old records/API compatibility. Node POST accepts mode/lanPrefix and creates internal network + node + both audit events in a single transaction; legacy siteId remains supported.
- Files: src/lib/fabric/{inventory,validation}.ts; src/components/fabric/{device-inventory,device-provisioning}.tsx; controller-dashboard.tsx; tests/browser/{baseline,inventory}.spec.ts; tests/integration/inventory.test.mjs; api/openapi.yaml; scripts/compare-browser-baseline.mjs.
- Actual immediate checks: targeted inventory tests PASS 3, lint PASS 30 files, typecheck PASS. New one-step PostgreSQL test PASS (automatic grouping, overlap rejection, no orphan after node-audit failure); full integration/browser run pending. No old records deleted or database schema changed.
- Impact/risk: UI no longer exposes Sites; Edge maps to existing branch enum in API/storage. Existing site naming uniqueness applies to newly auto-created network groups. Visual comparator now measures header chrome (72px) instead of editable introduction text because Rama requested terminology changes; original baselines retained, no claim that revised copy is pixel-identical.
- Rollback: revert new input variant/UI flow while retaining existing schema/records and logs.
- Next: finalize browser/regression, documentation and evidence.

## SIMPLE-DEVICES-CLOSURE — 2026-10-12 — Codex /root

- Status: COMPLETE. UI is Devices -> Add device, one form; visible types Edge and Hub. Edge connects a local LAN (existing branch wire enum), Hub connects edges. Sites are not exposed as a prerequisite, table column or separate list. Provisioning and overview use the same terms and progress derives from actual registered devices.
- Files: src/components/fabric/device-inventory.tsx; device-provisioning.tsx; src/components/controller-dashboard.tsx; src/lib/fabric/{inventory,validation}.ts; tests/integration/inventory.test.mjs; tests/browser/{baseline,inventory}.spec.ts; api/openapi.yaml; scripts/compare-browser-baseline.mjs; README.md; docs/STATUS.md; implementation-plan.md; evidence README/captures/comparison and this log.
- Actual final tests: npm test PASS 21; npm run test:integration PASS 6 including one-step atomic creation, no orphan network/node after audit failure, overlap denial and legacy-site compatibility; npm run test:browser PASS 6 desktop/mobile including direct creation with no pre-existing site, viewer denial and live overview progress; lint PASS 30 files; typecheck PASS; production build PASS; protected visual check PASS zero differences in login and navigation header chrome, with intentional page-copy changes excluded. git diff --check PASS. Mobile inventory screenshot reviewed.
- UI/network impact: existing design/auth/navigation reused; no database schema changes or record deletion, and no actual networking/agent changes. The internal site/network record is created with node/audit in the same transaction. Legacy siteId requests remain accepted; mixing them with new-network fields is rejected.
- Risks/limitations: old site-name uniqueness can reject a newly auto-created group of the same name; error is a conflict, never silent overwrite. Device connection/enrollment remains unavailable pending M2. Capacity/network and hosted CI gates remain UNVERIFIED.
- Rollback: revert device-first input/UI variant while preserving existing tables/records and append-only logs. No destructive migration is required.
- Next: refresh Devices/Provisioning to use the simpler flow; M2 actual enrollment remains pending scope approval.

## M2-FOUNDATION — 2026-10-12 — Codex /root

- Status: controller service integration PASS; real proxy/Go/UI gates pending.
- Scope approved by Rama: Add device -> enrollment token; shared MVP Go agent for Edge/Hub; outbound authenticated config retrieval and telemetry/ack channel. HTTPS polling + mTLS preserves ADR 0001. No WireGuard/FRR/nftables apply.
- Files: sdwan-controller/migrations/0002_device_identity.sql; src/lib/fabric/{enrollment,pki,device-auth,agent-http,channel,renewal,inventory,audit}.ts; agent v1 routes; operator per-device enrollment/revoke/config/telemetry routes; scripts/init-device-ca.mjs; tests/integration/agent-channel.test.mjs and adjusted inventory tests; sdwan-edge/go.mod, AGENTS.md, cmd/fabric-agent and internal/{identity,controller,agent}/ source/tests; ignore rules.
- Actual results: OpenSSL 3.6.5 syntax inspected; Go 1.27.2 installed and module pinned. First proposed node-forge dependency audit found 1 high severity unpatched verification vulnerability; removed it and its types, npm uninstall audit reported 0 vulnerabilities. Signer uses validated OpenSSL CSR verification/native certificate checks instead. First integration attempt PASS 3/FAIL 1 due to quoting in an updated legacy test; corrected. Latest lint/typecheck PASS, test:integration PASS 8. Initial Go compilation PASS (no tests yet at that point); new race/vet/build gates running, not claimed complete.
- Impact: new identity/revision/telemetry schema is additive; tokens only hashed in PostgreSQL; agent private key stays local. No existing credentials replaced or real network operations.
- Risks/rollback: production requires configured device CA and protected trusted proxy upstream; actual proxy bypass/revocation and Go interop not yet verified. Revert new route/UI bindings, retain schema/audit/logs. Certificate enrollment response-loss recovery needs operator handling; staged networking is not applied.
- Next: token UI, real NGINX mTLS/Go smoke test and full regression/evidence.

## M2-INTEROP — 2026-10-12 — Codex /root

- Status: real Go/NGINX/controller smoke PASS; full regression/UI renewal tests still pending.
- Summary/files: enrollment token UI and New token actions; registered connection DTO; real shared Go agent, durable private state, TLS verification, jitter/backoff, heartbeat/desired/ack and renewal; NGINX template with client verification, stripped spoofable headers and private upstream secret. scripts/agent-smoke.mjs and isolated runner add actual mTLS interoperability gate.
- Actual tests: Go test -race ./... PASS 3 packages, go vet/build PASS. Controller integration PASS 8, lint/typecheck PASS. Real proxy smoke initially failed due to POST response token envelope mismatch; corrected API envelope. Second attempt failed because NGINX 403 HTML was parsed as JSON; harness corrected, failed-run container/temporary PKI removed. Next smoke PASS: actual Go enrollment, config persisted as received, actual OS/interface telemetry, no certificate/header spoof/direct bypass rejected, revoked identity denied. NGINX image digest inspected and pinned after first successful run; keep-alive revocation assertion added for rerun. No claim of real network apply.
- Impact: token plaintext only returned on issuance, never stored or printed; UI token is ephemeral state. Agent state key is 0600 in 0700 directory. No production TLS deployment has been made; local VM endpoint configuration remains required.
- Risks/rollback: enrollment response loss after token consumption requires operator recovery; received config is not applied. Actual network rollback remains later M3/M4. Disable agent ingress/revert UI/routes while preserving schema and audit/logs.
- Next: complete channel hardening, UI regression, contract/docs, local additive migration and closure.

## M2-UI-CHANNEL — 2026-10-12 — Codex /root

- Status: core management channel tested; final docs/contract/regression/deployment preparation ongoing.
- Files: enrollment-details/device-inventory/device-provisioning/agent-configuration/agent-telemetry components; dashboard; node create/token API envelopes; inventory connection DTO; channel locking; API OpenAPI 3.1 mutualTLS contract; Go checksum/strict decoding/state; NGINX template, systemd template, sdwan-edge/README.md; browser fixtures/assertions and real smoke test.
- Actual checks: integration PASS 8; real Go/NGINX smoke PASS including revoked identity on reused TLS keep-alive connection and trusted-header/direct-bypass denial. Go race/vet PASS 3 packages. Browser initially PASS 5/FAIL 1 because New token changed desktop cell accessible name; updated scoped assertion, latest browser PASS 6 including one-time token hide and UI publish revision. Telemetry component lint initially FAIL (refresh trigger dependency); changed request key and removed obsolete unused EmptyState helper; lint/typecheck PASS. Go checksum-field edit initially build FAIL (field write omitted), corrected then race/vet PASS. OpenAPI 3.1 validation PASS with native mutualTLS security scheme. Latest npm test PASS 21.
- Impact: existing login/theme/layout/navigation preserved; tokens only in ephemeral issuance UI. Configurations publishes management settings; Telemetry shows actual check-ins; status is controller-only, distinct from routed traffic health. No networking apply occurs. Connection status freshness adapts to configured poll interval.
- Risks/limitations: valid HTTPS ingress/CA configuration required for real VM connection; missing enrollment address is shown honestly. No Debian systemd/network proof yet. Renewal overlap handles response loss; enrollment response-loss recovery remains operator-managed. Telemetry dedup retention is explicitly 100 snapshots per device.
- Rollback: disable agent ingress and new feature bindings, preserve schema/audit/logs; no credential reset or networking rollback needed for this management-only MVP.
- Next: final regression, repeat real smoke with latest code, local additive migration and documentation.

## M2-MANAGEMENT-CLOSURE — 2026-10-12 — Codex /root

- Status: COMPLETE for approved enrollment + shared Go management-agent/channel development. Networking safe apply/rollback, real VM ingress deployment and pilot remain UNVERIFIED/pending.
- Delivered files/groups: sdwan-edge/{go.mod,AGENTS.md,README.md,cmd/fabric-agent,internal/agent,internal/controller,internal/identity}; controller migrations/0002_device_identity.sql; enrollment/pki/device-auth/agent-http/channel/renewal services; agent v1 enroll/heartbeat/desired/ack/renew and operator node token/revoke/config/telemetry routes; ephemeral token UI/New token, AgentConfiguration and AgentTelemetry, actual controller-only status/overview; init-device-ca/test-agent smoke tooling; api/openapi.yaml (OpenAPI 3.1/mutualTLS); deploy/proxy template/README and systemd template; CI, env example, docs/status/plan/ADR 0002 and test/evidence updates.
- Actual final results: npm test PASS 21; npm run test:integration PASS 8 (latest renewal issuance + overlapping retry test also PASS); npm run test:agent PASS using real Go Edge AND Hub against pinned NGINX mTLS + actual Next/PostgreSQL; wrong-issuer/missing-cert/header-spoof/direct-upstream denial, cross-device ack rejection and revoked identity on reused keep-alive connection all tested. Go test -race ./... PASS in 3 packages, go vet PASS; native build and Linux amd64/arm64 cross-build PASS (cross-build is not execution on Debian). Controller lint PASS 48 files, typecheck/build PASS, browser PASS 6 desktop/mobile including one-time token hide and management config publishing; visual protected login/header chrome PASS four regions with zero changed pixels; npm audit reports 0 vulnerabilities; git diff --check and local docs links PASS. Protected login/auth/CSS/layout/shared UI source unchanged via git diff --exit-code.
- Iterations: initial vulnerable node-forge candidate removed before final result; test quoting/API token envelope/NGINX HTML parsing and desktop accessible-name regressions corrected and rerun. Initial telemetry lint dependency/obsolete helper and missing Go checksum-field compile issue corrected. A late test-edit command used wrong working-directory prefix and made no changes; corrected command ran renewal test PASS. No failure is counted as PASS.
- Database: local additive M2 migration applied; before/after operator id/email/password_hash deep equality PASS with no credential values printed. Temporary smoke PKI/databases/containers cleaned after normal runs; one crashed-harness container/PKI fixture explicitly cleaned. Public ingress/CA env values were not fabricated or deployed for Rama's VM lab.
- Behavior/security: token expires in 15 min, single consumption, hash-only DB storage; mTLS certificate binds registered device, per-request expiry/revocation; agent initiates all HTTPS connections. Publish writes immutable typed desired revision, agent verifies and privately stages it, acknowledges received; heartbeat carries actual OS/arch/uptime/interfaces. Checksum/revision guard and safe state file permissions prevent invalid replacement. Healthy or unsafe existing identities are refused on re-enroll rather than overwritten. Keys are development plaintext PEM protected by filesystem permissions; encrypted storage/production CA custody still required before pilot.
- UI/network impact: established shell/theme/auth preserved; functional management configuration/telemetry replace previous placeholders, controller heartbeat is separate from network connectivity. No WireGuard/FRR/nftables/host routing changes or remote shell operations performed.
- Limitations: config apply/LKG recovery, tunnel/BGP/resource health, Debian systemd execution, scale and hosted CI not verified. Enrollment response lost after token consumption needs operator recovery. Telemetry dedup covers latest 100 retained events; requests beyond retention can be new observations. VM must use an externally reachable verified HTTPS origin and correctly configured private proxy/signer; localhost from a VM is not controller host.
- Rollback: disable agent ingress/revert new route/UI bindings, preserve additive schema and audit/change logs; no operator credential replacement or network rollback required for this management-only agent.
- Next: configure CA/proxy HTTPS and install the built agent in Rama's local VM lab; plan safe actual networking apply as a separate M3/M4 scope.

## M2-DOC-STATUS — 2026-10-12 — Codex /root

- Status: COMPLETE documentation consistency follow-up.
- Files: docs/architecture/security-model.md; sdwan-controller/README.md; this log.
- Summary: replaced stale not-implemented/not-verified wording for the controller identity boundary with implemented management MVP, isolated proxy verification, and public deployment still pending. At-rest production storage and real network gates remain explicitly unverified.
- Check: git diff --check PASS. No application/network change or additional test run needed.
- Rollback: revert these wording changes; retain log. Next: configure HTTPS ingress for the VM lab per deployment README.

## DEVICES-ASYNC-CONSOLIDATION — 2026-10-12 — Codex /root

- Status: COMPLETE for Rama's approved UI/API refinement. Devices is the single onboarding location; Provisioning navigation and unused component removed, old URL redirects after authentication. Add device/New token retain ephemeral one-use instructions. Device name/Configure opens a stable per-device URL containing scoped management configuration and telemetry. Existing Configurations/Telemetry navigation now points operators to device selection; controller health remains available.
- Files: sdwan-controller/src/app/dashboard/page.tsx; src/components/controller-dashboard.tsx; src/components/fabric/device-inventory.tsx, device-details.tsx (new), device-provisioning.tsx (removed); src/lib/fabric/inventory.ts and types.ts; src/app/api/operator/nodes/route.ts; tests/integration/inventory.test.mjs; tests/browser/baseline.spec.ts, inventory.spec.ts, fixture.ts; api/openapi.yaml; controller README; docs/STATUS.md, development/implementation-plan.md, evidence/README.md and browser captures/comparison.
- Behavior: asynchronous table on desktop/mobile; debounced literal case-insensitive server search by name/Edge/Hub; default 25 rows, selectable 10/25/50/100, validated bounds, stable name/id ordering, repeatable-read count/page consistency, last-page clamping, loading/error/retry, aborted superseded requests and manual refresh. Dashboard serialization limited to 25 devices with actual aggregate totals; no full inventory downloaded for browser filtering. Detail lookup validates UUID and fails closed. Admin publishes management configuration; viewer reads and cannot publish through UI or API.
- Actual final verification: npm test PASS 21; test:integration PASS 9 (new deterministic bounded pagination, literal wildcard search, search across pages, bad arguments, anonymous/viewer authorization, missing detail, bounded dashboard tests); test:browser PASS 10 desktop/mobile (31-device multi-page/search/page-size flow, scoped config persistence, viewer API 403, old Provisioning redirect, auth/logout, stale-response rejection and API failure/retry). Real test:agent PASS Go Edge and Hub through NGINX mTLS including telemetry/config and revocation. Latest lint PASS 48 files, typecheck PASS, production build PASS. test:visual PASS four protected login/header regions with zero changed pixels. Desktop/mobile inventory/detail screenshots inspected. Protected auth/session/login/layout/CSS/shared UI source git diff --exit-code PASS; git diff --check PASS. Temporary test databases removed after runs.
- Iterations: initial npm commands ran from repository root (ENOENT; rerun in controller); initial lint rejected array-index key, corrected. New integration test initially failed because VM test loader lacked global URLSearchParams; explicit node:url import corrected, rerun PASS. First browser run had ambiguous Devices locator and duplicate sibling React keys, corrected. Screenshot test initially omitted info parameter (type/build/browser failure), corrected. Later error test matched Next route announcer too; scoped alert locator corrected. Concurrent verification run hit 5-second login waits; isolated rerun PASS. A subsequent isolated run had 9 PASS/1 FAIL waiting for initial configuration load; allowed 15 seconds for isolated dev-server loading (also login helper), latest full run PASS 10 in 50.3 seconds. Root formatter invocation failed nested-config resolution without writes; reran from controller. No failed run counted as PASS.
- UI/network impact: requested navigation/content refinements use existing cards/buttons/inputs/theme; mobile inventory is a horizontally scrollable table. Authentication and shared design source preserved. No dependencies, schema migrations, credentials, host networking or Go behavior changed. Configuration remains management-agent settings received/staged, not WireGuard/FRR/nftables application.
- Limits/risks: substring search and offset pagination bound transfer/rendering but have not been benchmarked at production scale; no production capacity claim. Live status changes require manual refresh. Existing full inventory service remains available for legacy sites API/tests; dashboard/device listing uses bounded queries. UI and real agent tests are isolated local evidence, not public ingress/VM deployment verification.
- Rollback: revert this Devices view/detail and paginated nodes GET variant, restore old navigation/component if needed; keep existing database records and append-only logs. No database or networking rollback required. Next: use Devices onboarding for Rama's configured HTTPS VM lab; actual network apply remains later scope.
## DASHBOARD-CONFIGURATIONS-MENU-001 — 2026-10-12 — Codex /root

- Status: COMPLETE; targeted checks PASS.
- Summary/reason: Rama asked to remove the Configurations menu from the dashboard. Removed it from shared navigation and view typing; the prior `?view=configurations` URL redirects to Devices so existing links remain usable.
- Files: sdwan-controller/src/components/controller-dashboard.tsx; sdwan-controller/src/app/dashboard/page.tsx; docs/change-logs/log_change_002.md.
- Checks: `git diff --check -- sdwan-controller/src/components/controller-dashboard.tsx sdwan-controller/src/app/dashboard/page.tsx` PASS; inspected remaining references (only overview copy and compatibility redirect remain). No test suite requested or run.
- UI/network impact: one dashboard navigation item removed; legacy view URL lands on Devices. No network/controller behavior changed.
- Risks: existing bookmarks land on Devices. Rollback: restore the navigation/view entry and remove redirect.
- Next: none.
## DASHBOARD-CONFIGURATIONS-MENU-FIX-001 — 2026-10-12 — Codex /root

- Status: COMPLETE; static checks PASS.
- Summary/reason: Restored the FileSliders icon import still used by the overview's Active configurations summary card after removing the Configurations navigation item.
- Files: sdwan-controller/src/components/controller-dashboard.tsx; docs/change-logs/log_change_002.md.
- Checks: `git diff --check -- sdwan-controller/src/components/controller-dashboard.tsx` PASS; confirmed FileSliders import and overview use are both present. Runtime/browser check not run.
- UI/network impact: fixes overview render crash; Configurations menu remains removed. No network behavior changed.
- Risks: none known. Rollback: revert this import-only correction, though that would reintroduce the reported crash.
- Next: none.
## DEVICES-PAGE-SIZE-SELECT-001 — 2026-10-12 — Codex /root

- Status: COMPLETE; lint and diff checks PASS.
- Summary/reason: Improved the Rows per page selector on Devices with a rounded-lg shape consistent with existing form controls, stronger border and text contrast, a subtle shadow, and visible keyboard focus ring.
- Files: sdwan-controller/src/components/fabric/device-inventory.tsx; sdwan-controller/src/components/controller-dashboard.tsx; docs/change-logs/log_change_001.md.
- Actual checks: `cd sdwan-controller && npm run lint` PASS (48 files, no warnings); `git diff --check -- sdwan-controller/src/components/fabric/device-inventory.tsx sdwan-controller/src/components/controller-dashboard.tsx` PASS. No browser visual run.
- UI/network impact: presentational change on Devices page only; no API, data, or network behavior changed.
- Risks: native select popup appearance remains browser/OS controlled. Rollback: restore the prior selector class.
- Next: none.
## DEVICES-PAGE-SIZE-ARROW-SPACING-001 — 2026-10-12 — Codex /root

- Status: COMPLETE; lint and diff checks PASS.
- Summary/reason: Increased right padding on the Rows per page select so its native dropdown arrow sits farther from the rounded border.
- Files: sdwan-controller/src/components/fabric/device-inventory.tsx; docs/change-logs/log_change_001.md.
- Actual checks: `cd sdwan-controller && npm run lint` PASS (48 files); targeted `git diff --check` PASS. No browser visual run.
- UI/network impact: small Devices selector spacing adjustment; no behavior or network impact.
- Risks: native arrow rendering varies by browser/OS. Rollback: restore `px-3` padding.
- Next: none.
## DEVICES-PAGE-SIZE-CUSTOM-ARROW-001 — 2026-10-12 — Codex /root

- Status: COMPLETE; lint and diff checks PASS.
- Summary/reason: Replaced the OS-native Rows per page arrow with a Lucide chevron positioned 12px from the right edge and reserved 48px of right-side content space, giving the arrow consistent padding from the border across browsers.
- Files: sdwan-controller/src/components/fabric/device-inventory.tsx; docs/change-logs/log_change_001.md.
- Actual checks: `cd sdwan-controller && npm run lint` PASS (48 files, no warnings); targeted `git diff --check` PASS. No browser visual check.
- UI/network impact: Devices pagination selector only; no API/data/network behavior changed.
- Risks: Native option popup styling remains browser/OS controlled; the closed control now has a consistent custom chevron. Rollback: restore the native arrow and prior selector padding.
- Next: none.
## CONTROLLER-REUSABLE-SELECT-001 — 2026-10-12 — Codex /root

- Status: COMPLETE; lint, typecheck and diff checks PASS.
- Summary/reason: Added a shared Select UI component with consistent rounded border, text spacing, custom inset chevron, focus ring and disabled styling. Replaced all four existing controller dropdown usages: Add device type/mode, rows per page, agent configuration device picker and telemetry device picker.
- Files: sdwan-controller/src/components/ui/select.tsx (new); sdwan-controller/src/components/fabric/{device-inventory,agent-configuration,agent-telemetry}.tsx; docs/change-logs/log_change_001.md.
- Actual checks: `cd sdwan-controller && npm run lint` PASS (49 files, no warnings); `npm run typecheck` PASS; targeted `git diff --check` PASS; `rg` confirmed native selects only exist inside the shared Select component.
- UI/network impact: consistent controller dropdown appearance and keyboard focus across current views; no API/data/network behavior changed.
- Risks: native option menu remains browser/OS controlled. Rollback: restore native selects and remove shared component.
- Next: none.

## UI-AUDIT-M1 — 2026-10-12 — Codex /root

- Status: COMPLETE approved audit/documentation milestone.
- Files: AGENTS.md; docs/development/ui-component-architecture.md (new); docs/README.md; active change log.
- Summary: recorded repository audit, established component boundaries, existing sizing decisions, scoped refactor/validation/rollback; appended all 13 permanent component-first rules without removing instructions.
- Checks: git diff --check on owned documentation PASS. Application tests UNVERIFIED at this documentation milestone.
- UI/network impact: none. Risks: pre-existing dirty tree preserved. Rollback: reverse only these documentation additions; retain logs.
- Next: shared feedback/status consolidation and keyboard/clipboard fixes.

## UI-AUDIT-M2 — 2026-10-12 — Codex /root

- Status: IMPLEMENTED; lint/typecheck/unit/integration checks PASS; browser validation in progress.
- Files: sdwan-controller/src/components/ui/{feedback.tsx (new),button.tsx}; components/login-form.tsx,controller-dashboard.tsx; components/fabric/{connection-status.ts (new),agent-configuration.tsx,agent-telemetry.tsx,device-details.tsx,device-inventory.tsx,enrollment-details.tsx}; tests/browser/{ui-consistency.spec.ts (new),inventory.spec.ts}; active log.
- Consolidation: Feedback owns error/success/loading announcement and existing inline/panel styles; typed feature-local connectionStatusLabels replaces three repeated mappings; Button variants replace password-toggle custom button while preserving footprint. Labels/table scope/loading semantics improved. Drawer gets inert closed navigation/background, focus containment, Escape/restore and breakpoint handling; clipboard rejection is caught with no token logging.
- Actual checks: npm run lint PASS 51 files after correcting conditional dialog ARIA declaration; npm run typecheck PASS; npm test PASS 21 (including locked logger concurrency/rotation tests); npm run test:integration PASS 9, isolated database removed. Initial protected-region comparison PASS zero changed pixels, full final comparison pending latest captures.
- Iterations: formatter invoked from root fetched unrelated biome@0.3.3 into npm cache; no dependency manifest or lockfile edits; switched to installed controller Biome. First browser run exposed an existing stale Browse devices expectation after Configurations redirect plus two new ambiguous locators; corrected test selectors/redirect expectation. No failing run counted as PASS.
- UI/network impact: preserved theme/control dimensions and route/auth/API/data behavior; keyboard/accessibility/clipboard feedback fixes only. No network changes.
- Risks/rollback: shared presentation and drawer responsive focus; revert only session-owned edits using pre-edit snapshot, retain user changes and append-only logs. Next: complete browser/visual/build checks and record evidence/limits.

## UI-AUDIT-M3 — 2026-10-12 — Codex /root

- Status: COMPLETE for approved UI consistency/reuse plan; all required local checks PASS.
- Modified/created application files: sdwan-controller/src/components/ui/feedback.tsx (new), ui/button.tsx; components/login-form.tsx, controller-dashboard.tsx; components/fabric/connection-status.ts (new), agent-configuration.tsx, agent-telemetry.tsx, device-details.tsx, device-inventory.tsx, enrollment-details.tsx. Tests: tests/browser/ui-consistency.spec.ts (new), inventory.spec.ts (existing stale redirect expectation corrected).
- Documentation: root AGENTS.md (all 13 permanent policy rules appended), docs/development/ui-component-architecture.md (new audit, props/variants/examples, scope/results/limits), docs/README.md, docs/STATUS.md, docs/evidence/README.md, sdwan-controller/README.md, active log/index through locked writer.
- Evidence: six new browser/device-form-{desktop,mobile}.png, navigation-open-{desktop,mobile}.png, ui-consistency-{desktop,mobile}.png; refreshed existing login/overview/devices/inventory/device-detail captures and protected-region-comparison.json. Original browser/baseline images preserved. Pre-session captures retained in /tmp/packetmotion-ui-audit/evidence-before. New captures exclude enrollment tokens; identities are disposable test fixtures.
- Consolidation: shared Feedback replaces repeated inline/panel alert/status markup across six consumers plus enrollment; feature-local typed connectionStatusLabels replaces three duplicated status label mappings; Button unstyled/icon-sm variants replace password custom control. Existing Select/Card/Input/Badge and contextual dimensions retained. Drawer keyboard/inert/Escape/focus restoration/breakpoint behavior, device label/table scope and clipboard failure/recovery improved.
- Actual checks from sdwan-controller: npm run lint PASS 51 files; npm run typecheck PASS; npm test PASS 21 (including real logger concurrent-writer/rotation/release tests); npm run test:integration PASS 9; latest npm run test:browser PASS 16 in 46.8s; npm run test:visual PASS four protected regions with zero changed pixels; npm run build PASS (Next 16.4.0 production compilation, TypeScript, page generation). Root git diff --check PASS. Isolated test databases removed by harness.
- Browser tests: six new desktop/mobile cases cover password keyboard/aria-pressed, hidden navigation inertness, modal semantics/focus wrapping/Escape/restore, selection and breakpoint transition, native Select keyboard, field labels, clipboard denial/recovery/status and page-level overflow. Existing auth/viewer/pagination/search/error/stale-response/config persistence checks remain passing.
- Failed iterations: first browser run 10 PASS/6 FAIL (stale existing Browse devices expectation plus two new ambiguous locators), second 14 PASS/2 FAIL because new clipboard alert selector also matched Next route announcer; scoped to enrollment region and latest full rerun PASS. Root formatter invocation mistakenly downloaded unrelated biome@0.3.3 into npm cache; no repository dependency change, corrected to installed Biome. Conditional ARIA lint declaration corrected before final PASS. Failed runs are not PASS evidence.
- Visual review: actual desktop/mobile form, open navigation, inventory feedback and scoped device-detail renders inspected. Protected login/header pixel comparison is actual regression evidence; editable content had rendered review, not full pixel comparison. Desktop navigation screenshot is intentionally captured after mobile viewport resize.
- UI/network impact: existing identity/theme/layout/native selects preserved; small field consistency/accessibility and new clipboard error feedback only. Auth implementation, API contracts, database schemas, routing and business/network logic unchanged; no new dependencies or network operations.
- Risks/limitations: local Chromium only; native popup OS styling, real OS clipboard permissions and screen-reader speech UNVERIFIED. Test clipboard results are browser stubs. No full-content pixel regression claim. Pre-existing dirty application/docs/tooling preserved.
- Rollback: reverse only this session's edits (pre-edit component/policy snapshot /tmp/packetmotion-ui-audit/before), remove new Feedback/status/test/doc artifacts if reverting consumers, restore pre-session evidence as appropriate; retain append-only logs. No credential/data/schema/network rollback needed.
- Next: ready for review; future UI work must follow the appended policy. No deployment or commit performed.

## DASHBOARD-APP-ROUTER-PATHS — 2026-10-12 — Codex /root

- Status: COMPLETE; direct folder route migration.
- Summary: overview remains `/dashboard`; inventory is `/dashboard/devices`; device detail is `/dashboard/devices/[id]`; telemetry and settings use `/dashboard/telemetry` and `/dashboard/settings`. No redirect or compatibility handling for old `?view=` URLs. Updated navigation, overview links, device detail links, page tests and operator documentation. Shared `ControllerDashboard` shell and auth/inventory loading are reused through `dashboardPageData`.
- Files: sdwan-controller/src/app/dashboard/page.tsx; new app/dashboard/devices/page.tsx, devices/[id]/page.tsx, telemetry/page.tsx, settings/page.tsx; src/lib/dashboard-page.ts (new); src/components/controller-dashboard.tsx; src/components/fabric/device-{inventory,details}.tsx; tests/browser/{baseline,inventory,ui-consistency}.spec.ts; sdwan-controller/README.md; docs/{STATUS.md,development/implementation-plan.md,development/ui-component-architecture.md,evidence/README.md}; refreshed docs/evidence/browser route captures; active change log.
- Checks actually run after migration: `npm run lint` PASS (56 files); `npm run typecheck` PASS; `npm run test:browser` PASS 16 desktop/mobile (40.8 sec), including protected login, direct overview/devices/telemetry/settings paths, device details/config persistence, viewer restrictions and menu interactions; `npm run test:visual` PASS zero changed pixels in four protected regions; `npm run build` PASS, build lists all five routes including `/dashboard/devices/[id]`; `git diff --check` PASS. `npm test` and DB integration not rerun; route-only scope covered through browser tests, no service/API/schema changes.
- Iterations: first browser run 14 PASS/2 FAIL due focus expectation after full route navigation remounted the shared shell; removed that invalid expectation and kept explicit Escape focus restoration and new route assertions. Final browser rerun PASS 16. No old query URLs remain in app, README, or browser tests; older append-only changelog entries describe prior state and remain historical.
- UI/network impact: URL/navigation behavior changed as explicitly requested; visual shell, auth, feature behavior, APIs/data and network behavior preserved. No new dependencies.
- Risks/rollback: old bookmarked query-view links now display overview because the route query is ignored; browser bookmark update may be needed. Rollback: restore prior query-based links/page resolution and remove new route pages/helper/docs statements; retain append-only logs. No data/network rollback needed.
- Next: use the new path routes going forward.

## MAINTAINABILITY-DIAGNOSTICS — 2026-10-12 — Codex /root

- Status: COMPLETE for the selected documentation, readiness/diagnostic and dashboard extraction improvements. No schema, auth, routing, agent protocol, or network behavior changes.
- Summary/files: corrected stale controller README and delivery status statements about Go agent/config application and implemented management APIs; added `/api/ready` as an uncached PostgreSQL `SELECT 1` readiness probe while preserving `/api/health` liveness semantics; added generated request IDs to operator/agent responses and safe structured internal error logs (scope, sanitized class, constrained code; no messages/stacks/inputs/secrets); extracted the existing dashboard health card and Settings section into `components/fabric/controller-health-card.tsx` and `controller-settings.tsx` without changing their styles; documented purposes and usage. Added `tests/integration/readiness.test.mjs`, `tests/diagnostics.test.mjs`, and exposed `console` in the TypeScript test loader for logger assertions. Files also include `src/app/api/health/route.ts`, `src/app/api/ready/route.ts`, `src/lib/diagnostics.ts`, `src/lib/fabric/http.ts`, `src/lib/fabric/agent-http.ts`, `src/components/controller-dashboard.tsx`, `sdwan-controller/README.md`, `docs/STATUS.md`, and `docs/development/ui-component-architecture.md`.
- Actual checks: `npm test` PASS 23; `npm run test:integration` PASS 11 including database success/failure redaction; `npm run test:browser` PASS 16 desktop/mobile; `npm run lint` PASS (60 files); `npm run typecheck` PASS; `npm run build` PASS and `/api/ready` appears in the App Router route list; `git diff --check` PASS. Initial diagnostics unit test attempt exposed a test-loader console isolation issue; loader was corrected and the suite then passed. No screenshot/pixel comparison was run in this session.
- UI/network impact: dashboard retains its existing visual classes, layout, and behavior; browser interactions passed. `/api/health` behavior remains unchanged. `/api/ready` adds a safe operational endpoint. No network or database schema modifications.
- Risks/limitations: request IDs are per request and logs are process output; centralized log retention/search is an operations concern. Readiness indicates PostgreSQL query availability only, not migrations, agent ingress, or routed network health. No hosted CI or production ingress tested.
- Rollback: remove the readiness route, diagnostics helper/integrations and extracted component imports/files, then revert doc additions; no data migration or runtime network rollback is needed. Preserve append-only change logs.
- Next: use `/api/ready` in deployment readiness probes and consider adding route-level correlation to other API families as they are touched.

## RUNTIME-ERROR-REPORTING — 2026-10-12 — Codex /root

- Status: IMPLEMENTED; focused browser/runtime and database verification PASS. Additive migration 0003 was applied to the local development database (`localhost/sdwan_controller`); operator credentials were preserved.
- Summary: built-in Next.js App Router `error.tsx` and `global-error.tsx` plus a root browser error guard display a friendly retry/dashboard screen and reference ID for render errors, uncaught browser errors, and unhandled promise rejections. Next.js `onRequestError` stores server-side runtime failures with its digest as the reference. `/api/runtime-errors` accepts bounded, same-origin reports from signed-in operators only. Existing unexpected operator/agent API failures also persist by their generated request ID. PostgreSQL records bounded, redacted message/stack, sanitized error class/code, route/method and repeat count; stale rows are pruned after 30 days. `npm run errors:show -- <reference-id>` retrieves the server-side diagnostic record. No third-party dependency/library added.
- Files: new `sdwan-controller/migrations/0003_runtime_errors.sql`, `src/app/{error.tsx,global-error.tsx}`, `src/app/api/runtime-errors/route.ts`, `src/components/{runtime-error-fallback,runtime-error-guard}.tsx`, `src/instrumentation{,-client}.ts`, `src/lib/report-client-error.ts`, `scripts/show-runtime-error.mjs`, tests/diagnostics.test.mjs, tests/integration/runtime-errors.test.mjs; updates to src/app/layout.tsx, src/lib/diagnostics.ts, src/lib/fabric/{http,agent-http}.ts, tests/integration/inventory.test.mjs, tests/browser/{fixture.ts,ui-consistency.spec.ts}, package.json, README.md and docs/STATUS.md.
- Actual checks: `npm test` PASS 23; `npm run test:integration` PASS 14 including sanitization, same-origin, anonymous rejection and migration repeatability; `npm run test:browser` PASS 18 desktop/mobile, including a thrown click-handler error, friendly page/reference ID and persisted redacted DB record; `npm run lint` PASS (68 files); `npm run typecheck` PASS; `npm run build` PASS and lists `/api/runtime-errors`; `git diff --check` PASS. Local `npm run migrate:controller` PASS and `to_regclass` confirmed the new table/migration record.
- Iterations: unit tests first expected one database call, then were updated for the once-daily retention query plus insert. A browser rerun briefly hit an orphaned port-3107 Next dev server left by an interrupted prior test process; stopped only that test-owned process and reran the complete browser suite PASS. No application changes were needed for that environment issue.
- UI/network impact: no theme or navigation redesign; runtime failures now replace the affected screen with a friendly fallback and safe reference. No routing, auth-provider, agent protocol or network behavior changes. One new additive PostgreSQL table/index and one same-origin report route.
- Risks/limitations: if PostgreSQL is unavailable or migration 0003 has not been applied, the app still shows the fallback and emits safe metadata to stderr, but detailed error records cannot be persisted. Browser report submission requires a signed-in operator. Next development mode may show its developer overlay in addition to the app fallback; production build passed, but no production-mode browser screenshot was run. Secret redaction is bounded-pattern sanitization, not a guarantee for every possible secret format.
- Rollback: disable/remove the UI/reporting code and route while preserving migration history and stored records. Keep migration 0003 immutable; do not drop the diagnostic table during routine rollback. No credential, traffic, or network rollback required.
- Next: apply `npm run migrate:controller` in each deployment before rollout; use the displayed reference with `npm run errors:show -- <reference-id>` on a host with database access.

## RUNTIME-ERROR-DOCUMENTATION — 2026-10-12 — Codex /root

- Status: COMPLETE; documentation and agent guidance updated.
- Summary: added a runtime error troubleshooting guide with reference lookup, capture coverage, sensitive-data handling, retention limits, migration/deployment steps, and failure limitations. Added permanent root and controller AGENTS instructions for safe capture and diagnosis; linked the guide from the documentation index and controller README.
- Files: `AGENTS.md`, `sdwan-controller/AGENTS.md`, `sdwan-controller/README.md`, `docs/README.md`, new `docs/operations/runtime-error-troubleshooting.md`.
- Tests/checks: `git diff --check` PASS. No code tests run because this session only changed documentation and agent instructions; implementation test results are recorded in the preceding `RUNTIME-ERROR-REPORTING` entry.
- UI/network impact: documentation only; no runtime, UI, API, database, or network behavior changed.
- Risks/limitations: diagnostic data remains sensitive even after bounded redaction; cleanup is best-effort on error writes, not scheduled. If PostgreSQL/migration is unavailable, detailed records are not persisted.
- Rollback: revert the documentation and AGENTS additions; runtime error implementation is unaffected.
- Next: apply `npm run migrate:controller` per deployment instructions before rollout, then use the troubleshooting guide when a reference ID is reported.

## DIAGNOSTIC-LOGS-WEB-UI — 2026-10-12 — Codex /root

- Status: IMPLEMENTED; local developer access provisioned and rotated. Additive controller migration 0004 applied to the verified local database `localhost/sdwan_controller` only.
- Summary: added a read-only `/diagnosticlogs` view of the 100 latest reports with expandable stack/timestamp details, dedicated fixed username `developer`, bounded same-origin login/logout routes, shared database login rate limiting, an HTTP-only isolated session, and immediate session invalidation after password rotation. `npm run init:developer` creates access once; `npm run reset:developer` generates a replacement. Both print a random password once while storing only a scrypt hash. Kept operator and device identities separate. Updated troubleshooting/security/status docs and root/controller AGENTS policies.
- Files: root `AGENTS.md`; `docs/architecture/security-model.md`, `docs/STATUS.md`, `docs/operations/runtime-error-troubleshooting.md`; controller `AGENTS.md`, `README.md`, `package.json`; new migration `migrations/0004_diagnostic_developer.sql`, `scripts/setup-developer.mjs`, `src/lib/diagnostic-auth.ts`, `src/app/diagnosticlogs/{page.tsx,login/route.ts,logout/route.ts}`, `tests/browser/diagnostic-logs.spec.ts`, `tests/integration/diagnostic-logs.test.mjs`; updates to `scripts/test-isolated.mjs`, `tests/integration/inventory.test.mjs`, and `tests/support/load-ts.cjs`.
- Checks: `npm run lint` PASS; `npm run typecheck` PASS; `npm test` PASS 23; `npm run test:integration` PASS 17; focused diagnostic browser checks PASS 4 desktop/mobile; full browser suite PASS 21/22, with the unrelated existing desktop baseline operator-login test timing out during cold dev startup (mobile baseline passed); `npm run build` PASS; `git diff --check` PASS. `npm run migrate:controller`, `npm run init:developer`, and `npm run reset:developer` succeeded against local development DB; never record generated password here.
- UI/network impact: additive diagnostics page/API and one database table; all UI is read-only and no network, routing, auth-provider, or agent behavior changed.
- Risks/limitations: stacks are sensitive despite bounded redaction. Diagnostic login requires migration 0004 and `CONTROLLER_SESSION_SECRET`; production provisioning remains an operator deployment step. Full browser suite has one unrelated/flaky desktop baseline login failure noted above.
- Rollback: revert the page/routes/auth/CLI while keeping migration 0004 and stored diagnostic records; no network rollback. To revoke diagnostic access, run `npm run reset:developer` and discard the printed password.
- Next: in each target environment run `npm run migrate:controller`, then `npm run init:developer`; keep the generated credential in the approved secret manager. Use `npm run reset:developer` for rotation.
## DIAGNOSTIC-LOG-COPY — 2026-10-12 — Codex /root

- Status: IMPLEMENTED; clipboard interaction browser verification UNVERIFIED due Next.js dev Fast Refresh navigation churn during the click test.
- Summary: added a per-row Copy report action to `/diagnosticlogs`. The copied plain-text report includes reference ID, first/last seen UTC timestamps, occurrence count, source, method/route, error name/code, message and stack trace. Uses the existing outline Button and Feedback primitives, accessible button naming, keyboard-native button behavior, and success/error live announcements. No external library or telemetry added.
- Files: `sdwan-controller/src/app/diagnosticlogs/page.tsx`; new `sdwan-controller/src/app/diagnosticlogs/copy-log-button.tsx`; `sdwan-controller/README.md`; `docs/operations/runtime-error-troubleshooting.md`; `docs/development/ui-component-architecture.md`.
- Tests/checks: `npm run lint` PASS (73 files); `npm run typecheck` PASS; `git diff --check` PASS; focused desktop diagnostic login/sign-out browser test PASS (1). Attempts to extend the browser test to click/read clipboard timed out because the Next.js dev page repeatedly refreshed/navigated, detaching the button; the click-and-clipboard path is UNVERIFIED. Full suite and production build not run.
- UI/network impact: adds a small per-row action using established styles and existing components; no route, API, auth, database, or network behavior change. Report data is copied locally by the browser; user should review sensitive diagnostic context before sharing.
- Risks: browser clipboard permissions/interaction still need a stable browser run; copy failures are surfaced to the user. Rollback: remove the client action and import/usage, then revert its documentation changes; no data rollback.
- Next: rerun the copy interaction against a stable browser session/build and verify clipboard contents.

## REPO-GITIGNORE — 2026-10-13 — Codex /root

- Status: COMPLETE.
- Summary: expanded root ignore coverage for OS/editor files, local environment configuration with explicit example-template exceptions, Next.js and TypeScript output, test reports, Go binaries/coverage, local runtime credentials/state, temporary databases, generated controller Next type entrypoint, and append-log coordination files. Added scoped `.gitignore` files for the Next.js controller and Go edge agent so each subproject can be used reliably on its own.
- Files: `.gitignore`; `sdwan-controller/.gitignore` (new); `sdwan-edge/.gitignore` (new); this change log.
- Checks: `git check-ignore -v` confirmed controller `.env.local`, Next `.next-agent` output, Go `bin` output, generated `sdwan-controller/next-env.d.ts`, and the append lock are ignored. `sdwan-controller/.env.example` is not ignored. No application tests run; ignore configuration only.
- UI/network impact: none.
- Risks/limitations: broad `*.key` is retained for repository-local key protection and could hide a non-secret source fixture with that suffix; use a narrowly scoped force-add only for reviewed safe fixtures. Existing tracked evidence and sources remain unaffected by ignore rules.
- Rollback: remove the two nested ignore files and restore the previous root `.gitignore`; leave append-only history intact.
- Next: review the three ignore files with the next repository changes.

## ROOT-README — 2026-10-13 — Codex /root

- Status: COMPLETE.
- Summary: created a repository-front README with product scope and current limitations, architecture flow, repository map, controller/agent getting-started routes, verification commands, security/deployment notes, and links to requirements, status, implementation, testing and operations docs.
- Files: `README.md` (new); this change log.
- Checks: `git diff --check` PASS. README links were checked against existing repository paths. No application tests run; documentation-only change.
- UI/network impact: none; the README explicitly states that network apply/rollback and failover are not implemented.
- Risks/limitations: local setup and test commands rely on the linked controller and agent guides for environment-specific steps; actual ingress and Debian deployment remain unverified as stated in project docs.
- Rollback: remove the new root `README.md`; preserve the append-only change log.
- Next: use this README as the repository landing page and keep its capability summary aligned with `docs/STATUS.md`.

## DOCS-MERMAID-AUDIT — 2026-10-13 — Codex /root

- Status: COMPLETE; all 15 Markdown files under `docs/` reviewed for diagram usefulness.
- Summary: added Mermaid visuals where relationships or flows benefit from a visual: product management/data-plane boundary, M0–M7 delivery state, risk-based testing flow, agent enrollment/trusted proxy security sequence, management/control/data plane design, runtime error reporting and recovery paths, controller/agent architecture decision, and agent management polling sequence. Kept index, ADR index, changelog, evidence, and UI component reference documents as text because diagrams would add little over links, chronological records, screenshots, and tables.
- Files: `docs/prd/packetmotion-fabric-v1.1.md`; `docs/STATUS.md`; `docs/development/testing-strategy.md`; `docs/architecture/security-model.md`; `docs/architecture/network-design.md`; `docs/operations/runtime-error-troubleshooting.md`; `docs/adr/0001-nextjs-controller-go-agents.md`; `docs/adr/0002-agent-management-channel.md`; this change log.
- Checks: `git diff --check` PASS. Python structural check confirmed one Mermaid block per touched document and balanced Markdown fences. All 15 Markdown files under docs were enumerated and reviewed. No application tests or Mermaid renderer run.
- UI/network impact: documentation only; diagrams label planned data/control-plane capabilities as pending and do not claim network implementation.
- Risks/limitations: Mermaid rendering depends on the Markdown host; source uses standard flowchart and sequenceDiagram syntax. Visual rendering was not checked in a specific host.
- Rollback: revert only the eight documentation diagrams; preserve this append-only audit entry.
- Next: check rendered Mermaid display in the documentation host during review.

## REPO-DOCS-ALIGNMENT — 2026-10-13 — Codex /root

- Status: COMPLETE; repository guidance and delivery docs aligned to current code.
- Summary: scanned the working tree, controller/Go sources, migrations, package commands, API contract, current agent instructions, PRD, testing and implementation docs, status, architecture references, and latest log entries. Clarified management MVP versus unapplied network-plane scope; documented actual controller/agent verification commands and evidence limits; corrected M2/M3 descriptions and the planned migration-number collision (0004 is already in use); marked prior host-tool observations historical.
- Files: `AGENTS.md`, `sdwan-controller/AGENTS.md`, `sdwan-edge/AGENTS.md`, `docs/STATUS.md`, `docs/development/implementation-plan.md`, `docs/development/testing-strategy.md`, `docs/prd/packetmotion-fabric-v1.1.md`, this log.
- Checks: `git diff --check` PASS. Documentation links/commands and stale milestone references reviewed against repository paths and package scripts. No application tests run; docs and instructions only.
- UI/network impact: none; documentation only. No application, UI, API, database, agent, or network behavior changed.
- Risks/limitations: future implementation state may change; status and command documentation should be refreshed with subsequent code milestones. VM/lab capabilities remain UNVERIFIED as recorded.
- Rollback: revert the documentation and AGENTS changes; keep this append-only record.
- Next: implement only after the relevant milestone is approved; update the status and evidence alongside each delivered capability.

## GITHUB-ACTIONS-PAUSE — 2026-10-13 — Codex /root

- Status: COMPLETE; the repository GitHub Actions workflow is paused and its source is preserved for later re-enablement.
- Summary: renamed `.github/workflows/ci.yml` to `.github/workflows/ci.yml.disabled`. GitHub Actions discovers workflow definitions with `.yml` or `.yaml` extensions, so the renamed file is not loaded as a workflow; rename it back to `ci.yml` to re-enable it.
- Files: `.github/workflows/ci.yml` (renamed to `.github/workflows/ci.yml.disabled`); this change log.
- Checks: `git diff --check` PASS; inspected `.github/workflows/` to confirm there is no remaining `.yml` or `.yaml` workflow file. No application tests run; this changes workflow discovery only.
- UI/network impact: none. CI checks will no longer run automatically through this repository workflow while it is paused; local commands remain available.
- Risks/limitations: other workflows in GitHub settings or external CI systems are unaffected; none were present in this repository's `.github/workflows/` directory at inspection.
- Rollback: rename `.github/workflows/ci.yml.disabled` back to `.github/workflows/ci.yml`.
- Next: re-enable by restoring the `.yml` extension when requested.
