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
## UI-NETWORK-PREVIEW — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; lint, typecheck and whitespace checks PASS.
- Summary/reason: Added a preview-only device network configuration mockup for Business Policy, WAN/LAN IP addressing, operating/routing mode and hub preference, basic default-deny firewall examples, DNS/NAT and management access to support the requested SD-WAN-style configuration workflow.
- Files: sdwan-controller/src/components/fabric/network-configuration-preview.tsx; sdwan-controller/src/components/fabric/device-details.tsx; docs/development/ui-component-architecture.md; this log.
- Checks actually run: `npm run lint` PASS (Biome checked 74 files); `npm run typecheck` PASS (Next route type generation and `tsc --noEmit`); `git diff --check` PASS. No test suite or browser visual check run; UI visual rendering is UNVERIFIED.
- UI/network impact: Additive card on existing device detail, composed from current UI primitives and tokens. No API, database, dependency, agent or network behavior changed. Local preview action does not persist or publish values. Admin controls are editable examples; viewer controls remain read-only.
- Risks/limitations: Settings and rules are mock data only; they do not validate production configuration or represent applied device state. Visual layout has not been inspected in browser.
- Rollback: Remove `network-configuration-preview.tsx`, its import/composition in `device-details.tsx`, and the corresponding component architecture note; no data/schema rollback.
- Next: Review `/dashboard/devices/<id>` in desktop/mobile browser; implement persistence, validation, policy compilation and safe network apply only in their separately planned milestones.
## UI-REUSABLE-MODAL — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; lint, typecheck and whitespace checks PASS.
- Summary/reason: Added reusable accessible Modal and responsive ModalFooter primitives for future focused workflows, following the existing controller UI tokens and Button conventions.
- Files: sdwan-controller/src/components/ui/modal.tsx; docs/development/ui-component-architecture.md; this log.
- Checks actually run: `npm run lint` PASS (Biome checked 75 files); `npm run typecheck` PASS (Next route type generation and `tsc --noEmit`); `git diff --check` PASS. Browser interaction/visual tests not run; runtime focus behavior is UNVERIFIED.
- UI/network impact: Adds an unused shared UI primitive; no existing pages, navigation, API, database, dependencies, agent or network behavior changed. Existing mobile navigation dialog remains untouched.
- Risks/limitations: No consumer has been migrated to this new component; focus, backdrop and responsive behavior have not been exercised in a browser.
- Rollback: Remove `src/components/ui/modal.tsx` and its documentation entry; no data or schema rollback.
- Next: Use it when a concrete focused workflow needs a modal and add focused keyboard/browser coverage with that integration.
## UI-DEVICE-NETWORK-MODALS — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; lint, typecheck and whitespace checks PASS. Targeted browser modal verification UNVERIFIED because the isolated runner failed operator login before reaching the new scenario on reruns.
- Summary/reason: Reorganized the device network preview into compact section summaries and moved add/edit actions into reusable modals for Business Policy, firewall rules, interface/IP addressing, routing/hub preference, and essential settings. Local additions reset on reload and never publish to the device. Fixed modal initial focus to move to the first field after mount.
- Files: sdwan-controller/src/components/fabric/network-configuration-preview.tsx; sdwan-controller/src/components/ui/modal.tsx; sdwan-controller/src/components/fabric/device-details.tsx; sdwan-controller/tests/browser/inventory.spec.ts; docs/development/ui-component-architecture.md; docs/evidence/browser/device-detail-desktop.png; docs/evidence/browser/device-detail-mobile.png; this log.
- Checks actually run: `npm run lint` PASS (75 files); `npm run typecheck` PASS; `git diff --check` PASS. `npm run test:browser` initial run: 22/24 passed; the two new modal cases found initial field focus missing. Focus was fixed. Subsequent suite and targeted reruns failed before the affected page because the isolated test operator could not sign in (redirected to `/login`); login test screenshots/errors confirm the modal scenario was not reached. An initial existing browser run before the new scenario had passed all 22 then-existing tests. Desktop/mobile device-detail screenshots from that successful run show the reorganized layout; modal open state not captured.
- UI/network impact: Existing device detail is now shorter and uses section actions; forms appear in accessible modal dialogs. Responsive detail view inspected via generated screenshots. No API, DB, agent, or network changes. All settings remain browser-local preview data.
- Risks/limitations: Focus fix has not been confirmed by a successful browser rerun; new modal regression test is present but remains unverified due isolated operator login failures. UI does not persist, compile or apply network config.
- Rollback: Revert this feature component and its composition in `device-details.tsx`; remove the added browser test and architecture note. Keep append-only log and evidence history as required.
- Next: Rerun the targeted browser scenario when isolated operator login is working, inspect modal open/keyboard behavior on desktop/mobile, and then implement persistence/apply only in the planned network milestones.
## UI-COMMON-COMPONENTS — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; lint, typecheck and whitespace checks PASS.
- Summary/reason: Added commonly reused native form and layout primitives: Textarea, Checkbox, Separator, and FormField. Components use existing Tailwind tokens and React/native element conventions, with no new package or UI dependency.
- Files: sdwan-controller/src/components/ui/textarea.tsx; sdwan-controller/src/components/ui/checkbox.tsx; sdwan-controller/src/components/ui/separator.tsx; sdwan-controller/src/components/ui/form-field.tsx; docs/development/ui-component-architecture.md; this log.
- Checks actually run: `cd sdwan-controller && npm run lint` PASS (79 files); `cd sdwan-controller && npm run typecheck` PASS; `git diff --check` PASS. No tests added or run; no consumer integration or browser visual verification performed.
- UI/network impact: Adds unused shared primitives only. No existing page, API, database, dependency, agent or network behavior changed. Appearance follows current tokens; visual rendering is UNVERIFIED.
- Risks/limitations: FormField labels its generated ID, but controls should be given the matching `id` (or supplied `htmlFor`) explicitly. Checkbox should be paired with a visible label. No active screens were migrated.
- Rollback: Remove the four new component files and their architecture documentation section; no data/schema rollback.
- Next: Reuse these primitives in future forms where their behavior fits and verify the consuming workflow in the browser.
## WHITELABEL-LOGO — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; migration 0005 applied to the configured local development database. No operator was promoted automatically.
- Summary: Added a distinct superadmin role and CLI role assignment, preserving existing admin/viewer assignments. Added a superadmin-only branding editor and server-enforced same-origin upload/removal, bounded PNG/JPEG/WebP storage, public logo retrieval, and login/dashboard display with proportional scaling and a default fallback. The editor provides light/dark previews, transparency guidance, 600 × 180 px recommendation, and a 2 MiB limit.
- Files: `sdwan-controller/migrations/0005_branding.sql`; `scripts/set-operator-role.mjs`; `src/lib/branding.ts`; `src/app/api/branding/logo/route.ts`; `src/components/brand-logo.tsx`; `src/components/fabric/branding-settings.tsx`; dashboard/login and role authorization files; tests for authorization, asset validation, database persistence, and browser journey; `api/openapi.yaml`; controller README, workspace status, UI architecture docs; existing device-detail desktop/mobile browser evidence was regenerated during the full suite (both files were already modified before this task).
- Checks: `npm test` PASS (25); `npm run test:integration` PASS (18); `npm run lint` PASS; `npm run typecheck` PASS; `npm run build` PASS; focused white-label browser journey PASS on desktop and mobile (1 each); `npm run migrate:controller` PASS; `git diff --check` PASS. Full `npm run test:browser` was 20/26 on the first run, with unrelated baseline login, existing modal focus, mobile navigation, and then-unfixed branding selector/mobile cases. The branding cases were corrected and passed in focused reruns; the entire browser suite was not rerun after those fixes.
- UI/network impact: Branding controls appear only for superadmins; admins/viewers retain normal existing access. Login and dashboard navigation use the stored image with `object-fit: contain`. No network, agent, or forwarding behavior changed.
- Risks/limitations: A trusted operator still needs explicit assignment with `npm run set:operator-role -- <email> superadmin`. The 600 × 180 px size is a recommendation, not an enforced dimension; contrast should be checked in the provided previews.
- Rollback: Restore an operator's previous role with `set:operator-role`; revert the branding UI/API/service bindings while retaining applied migration 0005 and stored branding data. Do not edit or roll back the applied migration.
- Next: Assign the intended superadmin, then upload and review the logo in Settings before sharing the branded login/dashboard.
## DOCS-NPM-COMMANDS — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; package script coverage and whitespace checks PASS.
- Summary/reason: Added a complete categorized `npm run` reference to the controller README, with operator/superadmin, diagnostic-user, migration, device CA, development, and verification workflows.
- Files: `sdwan-controller/README.md`; this log.
- Checks actually run: Node coverage check confirmed all 19 scripts declared in `package.json` appear in the README; `git diff --check` PASS. No application tests run because this was a documentation-only change.
- UI/network impact: Documentation only; no UI, API, database, agent, or network behavior changed.
- Risks/limitations: Command behavior is described from the current package scripts and README guidance; the commands were not executed as part of this documentation update.
- Rollback: Revert the npm commands section in `sdwan-controller/README.md`; no data or schema rollback.
- Next: Follow the documented commands as needed for local setup and operations.
## DIAGNOSTICS-SUPERADMIN — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; focused browser authorization, unit/integration, lint, typecheck and production build checks PASS.
- Summary/reason: Removed the separate developer diagnostic login and CLI setup/reset workflow. Added a dashboard Diagnostics link visible only to superadmins and server-side `/diagnosticlogs` authorization using the current operator role; anonymous users redirect to login, admins/viewers redirect to dashboard. Updated README, security, operations, status, PRD and agent instructions.
- Files: `sdwan-controller/src/app/diagnosticlogs/page.tsx`; `src/components/controller-dashboard.tsx`; deleted `src/app/diagnosticlogs/login/route.ts`, `src/app/diagnosticlogs/logout/route.ts`, `src/lib/diagnostic-auth.ts`, `scripts/setup-developer.mjs`; `package.json`; `scripts/test-isolated.mjs`; browser authorization test replacing removed diagnostic login tests; `sdwan-controller/README.md`, `sdwan-controller/AGENTS.md`, root `AGENTS.md`; `docs/architecture/security-model.md`, `docs/operations/runtime-error-troubleshooting.md`, `docs/STATUS.md`, `docs/prd/packetmotion-fabric-v1.1.md`, `docs/development/implementation-plan.md`; this log.
- Checks actually run: `npm test` PASS (25); `npm run test:integration` PASS (15); focused `npm run test:browser -- tests/browser/diagnostic-logs.spec.ts` PASS (4: desktop/mobile superadmin access and admin/viewer/anonymous denial); `npm run lint` PASS (80 files); `npm run typecheck` PASS; `npm run build` PASS; `git diff --check` PASS; README coverage check PASS (all 18 remaining package scripts listed). Earlier intermediate focused browser iterations failed due test navigation/login setup and mobile drawer interaction; the test was revised to validate the route response and mobile menu visibility, then the final focused run passed.
- UI/network impact: Superadmin-only menu entry and read-only diagnostic page authorization; no network, agent, or forwarding behavior changed.
- Risks/limitations: Migration 0004 is already applied and remains immutable. Its `diagnostic_developer` table and any existing password hash remain unused in PostgreSQL; no code or command can authenticate with that credential. Removing the stored legacy row/table requires a separately authorized destructive migration.
- Rollback: Restore the prior diagnostics auth/page/routes/CLI and dashboard navigation if required; retain migration history and do not edit migration 0004. No network rollback.
- Next: Deploy the code so the route requires a superadmin session; decide separately whether to authorize a follow-up migration that removes the obsolete stored credential table/data.
## DOCS-ROLE-COMMAND-EXAMPLES — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; whitespace check PASS.
- Summary/reason: Clarified the operator-role command syntax and added concrete superadmin, admin, and viewer examples in the controller README.
- Files: `sdwan-controller/README.md`; this log.
- Checks actually run: `git diff --check` PASS. No application tests run; documentation-only change.
- UI/network impact: Documentation only; no application or database behavior changed.
- Risks/limitations: Examples use placeholder email addresses and must be replaced with existing operators.
- Rollback: Revert the added example commands and syntax clarification; no data/schema rollback.
- Next: Operators can copy the example matching the role they intend to assign.
## DOCS-NPM-COMMANDS-TOP — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; top-of-README script coverage and whitespace checks PASS.
- Summary/reason: Moved the complete npm command catalog and role examples to immediately after the README title so operators can find all commands first.
- Files: `sdwan-controller/README.md`; this log.
- Checks actually run: Node verification confirmed all 18 scripts in `package.json` appear before Quick start; `git diff --check` PASS. No application tests run; documentation-only change.
- UI/network impact: Documentation only; no application or network behavior changed.
- Risks/limitations: Examples use placeholder operator emails.
- Rollback: Move the npm command section back below Development; no data/schema rollback.
- Next: Use the top section as the command reference.
## OPERATOR-ROLE-LOCALHOST — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; localhost email support and role assignment verified.
- Summary/reason: Aligned the operator-role CLI email validation with initial admin setup so the supported development address `admin@localhost` is accepted. Added validation tests and documented the exact command. Ran the requested command successfully and promoted the existing local development operator to superadmin.
- Files: `sdwan-controller/scripts/set-operator-role.mjs`; new `scripts/lib/operator-role.mjs`; new `tests/operator-role.test.mjs`; `sdwan-controller/README.md`; this log.
- Checks actually run: `node --test tests/operator-role.test.mjs` PASS (2); `npm test` PASS (27); `npm run lint` PASS (80 files); `npm run typecheck` PASS; `git diff --check` PASS; `npm run set:operator-role -- admin@localhost superadmin` PASS (`Updated admin@localhost to superadmin`).
- UI/network impact: No network behavior changed. The configured local operator now has superadmin permissions, including branding and diagnostics.
- Risks/limitations: The role command updates the operator found by email in the configured `DATABASE_URL`; it does not create a missing operator.
- Rollback: Run `npm run set:operator-role -- admin@localhost admin` from `sdwan-controller/` to restore the prior role.
- Next: Sign in again if needed; existing sessions remain valid and role changes are loaded from PostgreSQL.
## LOGIN-REMOVE-ORG-LOGO — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; focused lint, typecheck and whitespace checks PASS.
- Summary/reason: Removed the organization logo container from the `/login` form panel as requested; retained the rest of the login layout and behavior.
- Files: `sdwan-controller/src/app/login/page.tsx`; this log.
- Checks actually run: `npm run lint` PASS (80 files); `npm run typecheck` PASS; `git diff --check` PASS. An initial typecheck caught a removed import still needed by the desktop hero; the import was restored and the final typecheck passed.
- UI/network impact: Removes the compact organization logo from the login page's form side. No network behavior changed.
- Risks/limitations: The branding logo remains visible in the desktop hero panel.
- Rollback: Restore the `BrandLogo` import and wrapper before the login form content.
- Next: Run focused lint and typecheck; update this entry with results.
## DEVICE-DETAIL-UX — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; lint, typecheck and whitespace checks PASS. Browser visual verification UNVERIFIED.
- Summary/reason: Improved the device detail header and status area so operators can scan device/site identity, kind, controller connection and last management check-in. Device ID is tucked into a disclosure and has a copy action. Enrollment action is clearer and remains limited to authorized operators with not-enrolled devices. Added explicit copy that status is management-only, without implying tunnel or routing health.
- Files: `sdwan-controller/src/components/fabric/device-details.tsx`; this log.
- Checks actually run: `cd sdwan-controller && npm run lint` PASS (80 files); `npm run typecheck` first exposed a missing `CardDescription` import, fixed; final `npm run typecheck` PASS; `git diff --check` PASS. Browser/visual checks not run.
- UI/network impact: Presentation-only device detail update using existing Button, Badge, Card, and icon dependencies. Responsive status cards and expandable ID details; no API, database, agent, or network behavior changed.
- Risks/limitations: Local browser rendering and clipboard interaction are not visually/functionally verified. Clipboard denial shows manual-copy guidance.
- Rollback: Revert the device detail composition in `device-details.tsx`; no data/schema rollback.
- Next: Review the device detail page at desktop and mobile widths in the local browser and update evidence if requested.
## DOCS-AUDIENCE-INDEX — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; index links and whitespace check PASS.
- Summary/reason: Added separate entry points for AI agent workflow and human-facing product/architecture/operations material without copying authoritative content. Updated root AGENTS.md so agents consult the agent index, update source documentation only when behavior/instructions/contracts/workflows/status are affected, and maintain the relevant index for document moves/additions.
- Files: `AGENTS.md`; `docs/README.md`; new `docs/agent/README.md`; new `docs/human/README.md`; this log.
- Checks actually run: manually inspected the new index links and all current `AGENTS.md` references; `git diff --check` PASS. No application tests run because this is documentation-only.
- UI/network impact: None; documentation navigation and maintenance rules only.
- Risks/limitations: Existing source documents stay at their current paths and are shared by both audiences to avoid duplicate content and breakage of established references. This task creates audience-specific indexes, not duplicated/moved copies.
- Rollback: Revert the index additions and root AGENTS.md edits; no application or data rollback.
- Next: Use the AI agent index for implementation work and the human index for product, architecture, and operational reading.
## DEVICES-UX-001 — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; lint/typecheck PASS; focused inventory browser run FAIL due isolated login failures; baseline browser PASS.
- Summary: improved the Devices inventory hierarchy with four compact summary cards, explicit management-heartbeat scope, device-kind icons and clearer connection-state badges, responsive search/refresh controls, clear-search action, and a stronger initial empty state. Summary metrics use server-provided whole-inventory connection count and visible filtered page count; no false whole-inventory count is inferred from a page.
- Files: sdwan-controller/src/components/fabric/device-inventory.tsx; this log.
- Checks actually run: `npm run lint` PASS (80 files); `npm run typecheck` PASS; `git diff --check -- src/components/fabric/device-inventory.tsx` PASS; `npm run test:baseline` PASS (desktop/mobile, 2 tests). `npm run test:browser -- --grep 'admin creates site/device|device table fetches bounded pages'` FAIL (4 desktop/mobile cases) because disposable operator login stayed on `/login`; an intermediate run reached page assertions and identified accessible-name/pagination copy compatibility details, which were corrected. Inventory browser coverage is UNVERIFIED after final correction because the subsequent run again failed at login. No successful device journey is claimed.
- UI/network impact: inventory presentation and accessible content only; existing roles, APIs, data, enrollment and network behavior preserved. The copy explicitly limits status to management heartbeat and does not imply tunnel/routing health.
- Risks: browser regression evidence for modified device rows remains incomplete due isolated fixture login instability. No schema/data/network change. Rollback: revert only this file's task-owned changes; preserve the pre-existing user modifications in this same file.
- Next: rerun focused inventory browser tests once isolated login is stable; inspect updated desktop/mobile screenshots.

## CHANNEL-HARDENING-M1-M2 — 2026-10-14 — Codex /root

- Status: IMPLEMENTED; focused and broader verification PASS; final extended ingress smoke/build pending. User approved the implementation plan.
- Summary: Hardened existing shared Go agent rather than replacing it. Heartbeat/config attempts fail independently; pending heartbeats clear on heartbeat success, renewal runs before reconciliation, unsupported checksummed configurations receive rejected acknowledgements without advancing state. Receipt acknowledgement is durable and retried after restart. Unchanged configurations avoid writes/acks; corrupt cache is repaired. Optional revision/checksum retrieval omits unchanged payloads while retaining mTLS/device scope and legacy responses. Startup jitter and bounded HTTP connections/timeouts reduce reconnect pressure.
- Files: sdwan-edge/{cmd/fabric-agent/main.go,internal/agent/agent.go,internal/agent/agent_test.go,internal/controller/client.go,internal/identity/state.go}; sdwan-controller/src/{lib/fabric/channel.ts,app/api/agent/v1/desired/route.ts}; sdwan-controller/tests/integration/agent-channel.test.mjs; api/openapi.yaml; ingress smoke additions in progress.
- Tests: focused go test ./internal/agent ./internal/identity ./internal/controller PASS; go test ./... PASS; go test -race ./... PASS; go vet ./... PASS; go build -o /tmp/packetmotion-fabric-agent ./cmd/fabric-agent PASS; controller npm test PASS (27); lint/typecheck PASS; test:integration PASS (15); test:agent PASS. Initial integration run failed because deep equality compared objects from different VM prototypes; corrected to field assertions and rerun passed.
- UI/network impact: No UI or privileged network changes; desired remains staged, never applied. No migration.
- Risks: Polling remains bounded request/response; no streaming or production capacity guarantee. Current rejection/error retries use shared cycle backoff. Production/Debian/network-plane scenarios UNVERIFIED.
- Rollback: Deploy previous compatible agent/controller, preserving identity state, revisions, schema and logs; legacy clients request full payloads. Preserve pre-existing worktree edits.
- Next: Extended mTLS unchanged-read smoke, local concurrent baseline, build and operations documentation.

## CHANNEL-HARDENING-M3-CLOSURE — 2026-10-14 — Codex /root

- Status: IMPLEMENTED and locally verified within approved management-channel plan. Production release readiness remains UNVERIFIED.
- Summary: Extended real Go/NGINX/Next smoke with compact unchanged response, repeat-cycle identity stability and a bounded concurrent-read baseline; documented deployment order, recovery, acknowledgement durability, telemetry latency and capacity limits. Added management operations guide to both audience indexes; updated agent guide and status. No architecture replacement or new UI dependency.
- Files: sdwan-controller/scripts/agent-smoke.mjs; sdwan-edge/README.md; docs/operations/management-channel.md (new); docs/agent/README.md; docs/human/README.md; docs/STATUS.md; this log. Core implementation files recorded in CHANNEL-HARDENING-M1-M2 above.
- Tests actually run: extended npm run test:agent PASS (real Edge/Hub binaries, NGINX syntax/mTLS, conditional reads, telemetry, scope/spoof/bypass/revocation checks); npm run build PASS; git diff --check PASS. Earlier final checks: npm test PASS (27), test:integration PASS (15), lint/typecheck PASS; Go tests/race/vet/build PASS. Go runtime verified go1.27.2 darwin/arm64; Linux amd64/arm64 builds checked separately below.
- Measurement: 40 unchanged authenticated reads, eight concurrent connections, 68.7 ms p95, 141.3 ms total, zero failed reads. Local Next development server, two enrolled devices; does NOT establish production fleet capacity or heartbeat write throughput.
- UI/network impact: Existing UI/auth unchanged; no migrations or privileged network modifications. Configuration stays staged/received. Browser/visual tests not run because no UI changes. Public deployment, Debian service/reboot, mixed fleet/retry storms and all network-plane behavior UNVERIFIED.
- Risks: Shared cycle backoff can slow telemetry after config/renewal failures; pending heartbeat is memory-only; no streaming SLA or durable telemetry event archive. Production PKI custody/storage and scale need deployment/lab evidence.
- Rollback: Revert only task-owned code and restore compatible binaries; retain identities, revisions, schema and logs. Controller-first upgrade; full-payload fallback preserves old/new interoperability.
- Next: Deploy to authorized isolated Debian lab and measure sustained mixed fleet load/outage recovery before production capacity commitments.

- CHANNEL-HARDENING final cross-build evidence: `GOOS=linux GOARCH=amd64 go build -o /tmp/packetmotion-fabric-agent-linux-amd64 ./cmd/fabric-agent` PASS; equivalent Linux arm64 build PASS. Artifacts are in /tmp; no binaries added to the repository. Final whitespace check PASS.

## BOOTSTRAP-MAC-ETHN — 2026-10-14 — Codex /root

- Status: IMPLEMENTED and statically/fixture verified. User explicitly requested automatic physical interface scan, MAC sort and eth0/eth1/etc names. Debian VM reboot/connectivity remains UNVERIFIED.
- Summary: Standalone v1.8 bootstrap embeds a Python helper, adds python3 package, automatically scans permanent physical Ethernet MACs, sorts byte order, and stages a fixed ethN mapping. An early systemd service waits for udev, performs two-phase temporary-name renaming to handle ethN collisions/swaps, and gates supported networking/FRR services. No live rename; no host bootstrap executed. Existing GRUB arguments preserved. Known network, FRR, nftables/WireGuard and PacketMotion helper references migrate simultaneously with private backups, permissions/ownership preservation and recoverable transaction metadata. Live/duplicate/wildcard/custom-rule/foreign-service/hardware-change conflicts fail safely; rollback preserves edits. New step explicitly marks names staged/unverified; reboot defaults to later.
- Files: sdwan-edge/sdwan-provisioning-scripts/packetmotion-fabric-bootstrap-v1.8.sh; new adjacent README.md; new tests/bootstrap-interface-names.test.mjs; sdwan-edge/README.md; docs/agent/README.md; docs/human/README.md; this log. Prior worktree edits retained.
- Tests actually run: bash syntax via bash -n PASS; node --test tests/bootstrap-interface-names.test.mjs PASS (2 Node tests including 13 Python fixture scenarios for sorting/migration/swaps/idempotence/rollback/write failure/rule conflicts/hardware changes/live refusal/rename recovery). Initial wildcard detector falsely matched the wildcard in a normal include path; fixed tokenization and reran PASS. cd sdwan-controller && npm test PASS (29). Disposable Debian bookworm/trixie containers: fixture staging, systemd-analyze verify on generated unit and shellcheck -S error PASS. Container static validation does NOT verify actual NIC renaming or boot. No Go/UI code changed; Go/browser/visual tests not run.
- UI/network impact: No Controller UI/auth or management-agent changes. When executed on an appliance, bootstrap stages next-boot physical NIC renaming and modifies known persistent interface references. Installed helper is root-only; backups are sensitive and private. Unsupported/custom consumers require review before reboot; no claim of exhaustive host config migration.
- Risks/limits: Boot naming fails closed for unexpected/late hardware, occupied targets or already-UP changing ports; console required. No hotplug remapping; additional/replaced NICs require review. Other managers/custom scripts/early networking are not proven. Data-plane/SSH connectivity, real Debian boot and console rollback remain UNVERIFIED.
- Rollback: On appliance console run /usr/local/libexec/packetmotion-interface-names rollback, then systemctl daemon-reload and reboot after success; helper restores unchanged staged files and removes generated service/drop-ins/enablement. Reconcile operator-modified files against private backups before rollback. Repository rollback reverts only this task's edits, preserving history and unrelated changes.
- Next: In isolated Debian 12/13 VM with console, run bootstrap, reboot, verify MAC-to-ethN mapping, management address/default route/SSH and console rollback.
## BRANDING-UX-001 — 2026-10-14 — Codex /root

- Status: implementation complete; browser journey remains UNVERIFIED due to isolated runner timeout.
- Summary/reason: clarified the superadmin logo workflow with side-by-side light/dark preview panels, explicit default/custom/preview-unavailable states, compact file guidance, accessible file control name, progress and result announcements, and conditional removal action. Updated the existing branding browser assertions for state, upload guidance, control access, and removal availability.
- Files: sdwan-controller/src/components/fabric/branding-settings.tsx; sdwan-controller/tests/browser/inventory.spec.ts (pre-existing unrelated test edits preserved).
- Checks: npm run typecheck PASS; npm run lint PASS; git diff --check PASS. `npm run test:browser -- --grep "white-label branding"` attempted repeatedly and FAILED because `page.waitForResponse` for the logo PUT timed out at the file upload step in both desktop and mobile isolated runs. Earlier attempt passed desktop but mobile failed due login fallback selector; that selector was adapted, but latest repeat still times out. No successful browser journey claimed.
- UI/network impact: settings presentation and accessible feedback only; no network plane, API, schema, auth or dependency changes.
- Risks: end-to-end upload flow is not verified in this local isolated browser runner. Preview assumes the default state until an upload in this component session; persisted custom logo state is not initialized from the server.
- Rollback: revert only this component's changes; preserve pre-existing tests and branding API/schema work.
- Next: investigate isolated runner upload request timeout separately, then verify desktop/mobile branding journey.

## GITIGNORE-PNG-001 — 2026-10-14 — Codex /root

- Status: COMPLETE.
- Summary/reason: added a PNG-specific ignore rule under dependency directories so package artwork cannot surface as untracked files while keeping reviewed browser evidence available to Git.
- Files: .gitignore; this log.
- Checks actually run: `git check-ignore -v sdwan-controller/node_modules/playwright-core/lib/server/chromium/appIcon.png` PASS; `git check-ignore -v docs/evidence/browser/device-detail-desktop.png` correctly reports tracked evidence is not ignored; `git diff --check -- .gitignore` PASS. No application tests run; ignore-only change.
- UI/network impact: none; tracked screenshot evidence remains tracked.
- Risks: none identified. Rollback: remove the `**/node_modules/**/*.png` rule.
- Next: inspect `git status` before committing; existing local changes are preserved.
## BOOTSTRAP-PRESERVE-NIC-NAMES — 2026-10-15 — Codex /root

- Status: IMPLEMENTED; Bash syntax and whitespace checks PASS. Node regression test and real DHCP/boot verification UNVERIFIED because Node and an isolated Debian appliance are unavailable in this environment.
- Summary/reason: Removed the embedded MAC-sorted `ethN` rename helper, configuration rewrite/backup transaction, generated boot service and networking-manager drop-ins from bootstrap v1.8. The installer now leaves kernel/udev interface names intact, preserving the selected current name consistently for DHCP, static setup and FRR. Removed the now-unused `python3` install dependency. Replaced rename-helper fixture tests with checks for valid syntax and absence of name mutation.
- Analysis: DHCP mode chooses `NETWORK_IFACE`, invokes dhcpcd using that name, and writes a service command pinned to the same name. Renaming at early boot while rewriting only a bounded set of host configs can desynchronize DHCP/network-manager references; boot ordering or NIC discovery/target-name conflicts can also prevent networking services from starting. Preserving names removes these rename-specific causes. It does not prove all DHCP failures originate there; competing managers, stale static routes, DHCP server/VLAN/driver issues remain possible.
- Files: `sdwan-edge/sdwan-provisioning-scripts/packetmotion-fabric-bootstrap-v1.8.sh`; provisioning README; `sdwan-edge/README.md`; `docs/agent/README.md`; `docs/human/README.md`; `tests/bootstrap-interface-names.test.mjs`; this log.
- Checks actually run: `bash -n sdwan-edge/sdwan-provisioning-scripts/packetmotion-fabric-bootstrap-v1.8.sh` PASS; `git diff --check` PASS. `node --test tests/bootstrap-interface-names.test.mjs` NOT RUN because `node` is not installed (`node: command not found`). No appliance/bootstrap execution or DHCP request performed.
- UI/network impact: No UI/controller/agent changes. Bootstrap host behavior changes: no interface renaming or migration; DHCP/static networking continue using the selected existing interface name. Network operation on Debian remains unverified.
- Risks/limits: Existing installations where the previous v1.8 already staged renaming retain their installed helper/service and rewritten config; this repository script change does not automatically roll back a previously staged transaction on an appliance. New runs no longer create it. Check an affected host's `/var/lib/packetmotion-interface-names/transaction.json`, service/drop-ins, and configs before manual recovery. DHCP may fail for unrelated host/network configuration causes.
- Rollback: Revert task-owned changes to the bootstrap, provisioning docs/index wording, and regression test. Do not rerun a pre-change script without console recovery planning.
- Next: Run the focused Node test in a Node-enabled checkout; on an isolated Debian 12/13 VM verify selected `ens*`/`enp*` name persists over reboot, DHCP lease/default route and service logs, and console recovery.

## NODE-RUNTIME-001 — 2026-10-14 — Codex /root

- Status: COMPLETE; runtime alignment and dependency installation PASS.
- Summary/reason: Installed official Node.js v22.12.0 under `/opt/node-v22.12.0-linux-x64` and linked `node`, `npm`, and `npx` through `/usr/local/bin` so the repository's existing `.nvmrc` and `engines.node >=22.12.0` requirements are met by the host shell. `npm install` had emitted EBADENGINE under the prior Node v20.19.2 runtime.
- Files: No tracked application/configuration files changed; this change-log entry records the host environment change. Existing unrelated `mynotes.txt` edit preserved.
- Checks actually run: `node --version` -> v22.12.0; `npm --version` -> 10.9.0; `npm install` PASS, up to date, audited 97 packages, 0 vulnerabilities, no EBADENGINE warning. No application tests run because no application code changed.
- UI/network impact: None; host JavaScript runtime/toolchain only.
- Risks/limitations: Node is installed system-wide for this host under `/opt`, with `/usr/local/bin` links; other users/shells must have `/usr/local/bin` before `/usr/bin` in PATH. Rollback by removing the three `/usr/local/bin` links and `/opt/node-v22.12.0-linux-x64`; existing `/usr/bin/node` remains untouched.
- Next: Run project commands from this checkout with Node 22.12.0 or newer.

## TAILWIND-NATIVE-BINDING-001 — 2026-10-15 — Codex /root

- Status: RESOLVED for this local checkout; production build PASS.
- Summary/reason: Restored the missing platform-specific Tailwind CSS Oxide native optional dependency (`@tailwindcss/oxide-linux-x64-gnu@4.2.1`) in local `node_modules`. The committed package manifest and lockfile already declare the correct optional package/version; no source or dependency manifest changes were needed.
- Files: This change log only; local ignored `sdwan-controller/node_modules` updated. Existing `mynotes.txt` and prior change-log edits were preserved.
- Checks actually run: Verified the installed native package reports version 4.2.1; `cd sdwan-controller && npm run build` PASS (Next.js 16.4.0, compilation, TypeScript and page generation).
- UI/network impact: None; no application code, UI, schema or networking behavior changed.
- Risks/limits: Repair applies to this checkout and can be lost if dependencies are reinstalled while optional packages are omitted or filtered. Rollback: remove the local `sdwan-controller/node_modules/@tailwindcss/oxide-linux-x64-gnu` directory; rerun `npm ci` with optional dependencies enabled to restore the reproducible install.
- Next: If this repeats after reinstall, check npm install flags/config (`omit=optional`, `--no-optional`, platform filtering) and reinstall using the committed lockfile.

## TAILWIND-NATIVE-BINDING-002 — 2026-10-15 — Codex /root

- Status: CURRENT CHECKOUT VERIFIED; reported dev-server error not reproducible.
- Summary/reason: Investigated the reported missing @tailwindcss/oxide-linux-x64-gnu native optional dependency. It is currently installed under local ignored node_modules, and direct Node loading returns the Oxide Scanner; the Next.js production build succeeds. Earlier log entry TAILWIND-NATIVE-BINDING-001 records restoration in this checkout, so this report likely came from a stale dev process or a subsequent dependency state that is no longer present. No dependency manifests, lockfiles, application code, or user changes were modified.
- Files: This change log only; existing edits to sdwan-controller/package-lock.json and mynotes.txt were preserved.
- Checks actually run: node --version -> v22.12.0; runtime platform -> linux x64, glibc 2.41; npm config get omit -> null; npm config get optional -> null; npm ls @tailwindcss/oxide @tailwindcss/oxide-linux-x64-gnu --depth=1 shows oxide@4.2.1; direct require(@tailwindcss/oxide-linux-x64-gnu) PASS; npm run build PASS (Next.js 16.4.0 compilation, TypeScript, static generation).
- UI/network impact: None; no source or UI changes.
- Risks/limits: Build verifies the current production build path, not the specific already-running Turbopack dev process in the report. Rollback: no code rollback required; if needed, stop the dev server and restart it, preserving node_modules and lockfiles.
- Next: Stop the current npm run dev process and start it again. If the error returns, inspect the exact shell’s Node platform/architecture, npm config get omit, npm ls @tailwindcss/oxide-linux-x64-gnu, and whether the .node file exists; install with npm install --include=optional --no-save without deleting the lockfile or node_modules.

## ALLOWED-DEV-ORIGIN-001 — 2026-10-15 — Codex /root

- Status: IMPLEMENTED; focused static checks PASS.
- Summary/reason: Added Next.js allowedDevOrigins for the reported remote development client hostname 100.83.173.93. The setting applies to dev-only resources; did not add a global wildcard. The cross-origin warning concerned /__nextjs_original-stack-frames and does not independently explain the separate GET / 500.
- Files: sdwan-controller/next.config.ts; this log. Existing package-lock.json and mynotes.txt edits were preserved.
- Checks actually run: npm run typecheck PASS (next typegen and tsc); npx biome lint next.config.ts PASS; git diff --check -- sdwan-controller/next.config.ts PASS. Did not run/restart the dev server; runtime behavior remains unverified until restart.
- UI/network impact: No product UI or forwarding behavior changes. Development server now permits requests to dev-only endpoints from hostname 100.83.173.93.
- Risks/limits: This explicitly trusts that development hostname; dev server must restart to load config. Production behavior is unaffected by Next.js dev-only origin handling. Rollback: remove allowedDevOrigins entry from next.config.ts.
- Next: Restart npm run dev. If GET / remains 500, capture the corresponding server-side exception; the origin warning and page 500 may be separate issues.

## TAILWIND-DEV-RESTART-003 — 2026-10-15 — Codex /root

- Status: LOCAL DEVELOPMENT SERVER RECOVERED; NetBird path UNVERIFIED.
- Summary/reason: Confirmed the reported failure on the active Next.js 16.4.0 Turbopack server: GET / returned HTTP 500 while its CSS build referenced a missing Tailwind Oxide binding. The binding package and .node binary are present and load successfully from sdwan-controller. Stopped and restarted only the controller dev process; without deleting node_modules or changing dependency files, GET / now returns HTTP 307 to the login page, and the new dev log contains no Oxide binding error.
- Files: This change log only. Existing edits to sdwan-controller/next.config.ts, sdwan-controller/package-lock.json, mynotes.txt, and this log were preserved.
- Checks actually run: From sdwan-controller: Node v22.12.0; direct native package resolution/load PASS; npm ls confirms @tailwindcss/oxide 4.2.1; active-server curl before restart HTTP 500; after restart curl localhost HTTP 307; new Next dev log inspected. Direct curl to http://100.83.173.93:3000 timed out from this host, so the external NetBird path is UNVERIFIED. git diff --check on owned log change PASS; workspace-wide diff check reports an existing trailing blank line in mynotes.txt, left unchanged.
- UI/network impact: No application source, UI, schema, dependency or forwarding behavior changed. Controller dev server restarted and listens on 0.0.0.0:3000.
- Risks/limits: Restart cleared the observed stale/failing Turbopack process state but does not establish why it lost access to an already-installed binding or prove that another reinstall will behave the same. Login redirect confirms the root route renders, not database-backed login success. NetBird connectivity from a remote client remains unverified.
- Rollback: No tracked application rollback required. If dev errors recur, inspect the serving process and native package resolution from sdwan-controller, then restart that process; preserve package-lock.json and node_modules.
- Next: Reload http://100.83.173.93:3000/ in the NetBird client. If it still fails, compare the browser's exact URL/error with current server output; verify the server host's NetBird address and port 3000 reachability.

## CONTROLLER-FIRST-RUN-DOCS-001 — 2026-10-15 — Codex /root

- Status: COMPLETE (documentation only).
- Summary/reason: Rewrote the controller Quick Start as an ordered first local run: prerequisites and database creation, dependency install, `.env.local` configuration, auth/controller migrations, one-time initial operator creation, long-running dev server, and first login. Added later-run guidance, remote host binding note, and recovery for a missing `login_attempts` table. Clarified that migrations create tables inside an existing database, not PostgreSQL or the database itself.
- Files: `sdwan-controller/README.md`; this log. Existing edits to `mynotes.txt`, `sdwan-controller/next.config.ts`, and `sdwan-controller/package-lock.json` were preserved.
- Checks actually run: Manually reviewed the rendered Markdown section and command order; `git diff --check -- sdwan-controller/README.md` PASS. No application tests run because behavior did not change.
- UI/network impact: None; documentation only. The README documents binding to `0.0.0.0` for a trusted remote development client and the port 3000 firewall requirement.
- Risks/rollback: Documentation could still need tailoring for PostgreSQL installation differences across operating systems. Rollback by reverting only this README section; retain the append-only log.
- Next: Follow the steps on a fresh development database and refine OS-specific PostgreSQL setup if needed.

## CONTROLLER-FIRST-RUN-POSITION-002 — 2026-10-15 — Codex /root

- Status: COMPLETE (documentation only).
- Summary/reason: Moved the first local run Quick Start to directly below the controller README title so setup steps are the first content readers see.
- Files: `sdwan-controller/README.md`; this log.
- Checks actually run: Reviewed the README opening and command placement; `git diff --check -- sdwan-controller/README.md docs/change-logs/log_change_001.md` PASS.
- UI/network impact: None; documentation ordering only.
- Risks/rollback: None identified. Roll back by moving the section to its prior location.
- Next: Follow the quick start on a clean development database when setting up a new environment.
## OPERATOR-HIERARCHY-001 — 2026-10-15 — Codex /root

- Status: IMPLEMENTED; type, lint, unit/contract, integration and production build checks PASS. Browser verification UNVERIFIED because Playwright Chromium is not installed in this environment.
- Summary/reason: Aligned first-run setup and account provisioning with the requested hierarchy. `npm run init:superadmin` creates the first superadmin. Settings lets superadmins add admins or viewers and admins add viewers (users); the server API enforces these limits and returns a generated password once. Existing admin command remains for compatibility. README quick start, OpenAPI contract, login setup guidance and delivery status now describe the flow.
- Files: `sdwan-controller/package.json`; `sdwan-controller/scripts/setup-admin.mjs`; `sdwan-controller/src/app/login/actions.ts`; `sdwan-controller/src/app/api/operator/operators/route.ts` (new); `sdwan-controller/src/lib/fabric/operator-management.ts` (new); `sdwan-controller/src/components/controller-dashboard.tsx`; `sdwan-controller/src/components/fabric/controller-settings.tsx`; `sdwan-controller/src/components/fabric/operator-manager.tsx` (new); `sdwan-controller/src/components/login-form.tsx`; `sdwan-controller/tests/api-contract.test.mjs`; `sdwan-controller/tests/integration/operator-management.test.mjs` (new); `sdwan-controller/tests/browser/operator-management.spec.ts` (new); `sdwan-controller/README.md`; `api/openapi.yaml`; `docs/STATUS.md`; this log. Pre-existing edits in `mynotes.txt`, `sdwan-controller/next.config.ts`, and `sdwan-controller/package-lock.json` were preserved.
- Checks actually run: `npm run typecheck` PASS; `npm run lint` PASS; `npm test` PASS (29 tests); `npm run test:integration` PASS (17 tests, isolated DB removed); `npm run build` PASS (includes `/api/operator/operators`). `npm run test:browser -- --grep 'operator management follows'` attempted and could not launch either desktop/mobile Chromium because the Playwright executable is not installed; isolated test DB was removed. `git diff --check` PASS for task-owned files.
- UI/network impact: Additive account management appears in existing Settings for superadmin/admin; existing visual system reused. No networking, forwarding, inventory schema or database migration changes.
- Risks/limits: Generated passwords are displayed once but accounts are not forced to change them at first login. Existing deployments keep current roles; promote a trusted existing account with `npm run set:operator-role -- <email> superadmin`. Desktop/mobile browser journey remains UNVERIFIED. `init:superadmin --override` removes all operator rows and rotates the session secret; README marks it as destructive.
- Rollback: Revert the task-owned account UI/API/setup/documentation changes; existing operator rows and credentials remain intact unless an operator explicitly runs the documented `--override` command. No database migration rollback is needed.
- Next: Install the pinned Playwright browser in a verification environment and run the focused desktop/mobile operator-management browser journey; promote an existing trusted operator where upgrading an existing database.
## SUPERADMIN-EMAIL-001 — 2026-10-15 — Codex /root

- Status: COMPLETE.
- Summary/reason: Set the first-run superadmin default and examples to `admin@admin.local`, matching the requested local email-style address. Updated the already-created local superadmin record from `admin@localhost` to `admin@admin.local`; preserved its role and password. Updated only comments/default guidance in ignored `.env.local`; no secrets were recorded.
- Files: `sdwan-controller/scripts/setup-admin.mjs`; `sdwan-controller/.env.example`; `sdwan-controller/README.md`; ignored local `sdwan-controller/.env.local`; this log. Existing unrelated edits were preserved.
- Checks actually run: Pre-change DB lookup found one `admin@localhost` superadmin and no target collision. Transactional PostgreSQL update PASS; returned role remained `superadmin`. Confirmed source/example/README no longer use `admin@localhost` for the default; `git diff --check` PASS for tracked task files. No application tests run; this was a default/account email update.
- UI/network impact: No UI, auth algorithm or network behavior changed. The account now signs in as `admin@admin.local`; the email change invalidated sessions using the previous email.
- Risks/rollback: Use the same existing password with the new email. Roll back by changing the operator email back to `admin@localhost` and restoring the bootstrap/docs defaults if requested. `.env.local` remains private and ignored.
- Next: Sign in with `admin@admin.local`; choose an actual mailbox address when creating additional accounts if email delivery is configured externally.

## REMOTE-DASHBOARD-INTERACTIONS-001 — 2026-10-15 — Codex /root

- Status: IMPLEMENTED; lint, typecheck, and focused remote-origin asset check PASS.
- Summary/reason: Remote browser hostname `100.83.173.93` was not the same as the dev server bind address `0.0.0.0`. Next.js blocks cross-origin dev-only assets/endpoints unless their browser hostname is listed, which can leave the page visible without working client navigation. Replaced the bind-address entry with an explicit `NEXT_ALLOWED_DEV_ORIGINS` hostname list, defaulting to the known remote hostname, and documented how to set it for other remote hostnames.
- Files: `sdwan-controller/next.config.ts`; `sdwan-controller/README.md`; this log.
- Checks actually run: `npm run lint -- next.config.ts` PASS (Biome checked 83 files); `npm run typecheck` PASS; `git diff --check -- sdwan-controller/next.config.ts sdwan-controller/README.md` PASS. Restarted the existing dev server. Local `/` returns 307 to login as expected. Requested an actual Next dev chunk while simulating cross-site no-cors loading from `http://100.83.173.93:3000`; response 200. Browser click journey from a separate remote client remains unverified.
- UI/network impact: Restores remote dev client assets/interactions for the listed hostname; no production UI, authentication, or network-forwarding behavior changed.
- Risks/limits: Other client hostnames must be added in `.env.local` as comma-separated hostnames without scheme or port, then restart Next dev. Do not use a wildcard unless the dev environment requires it. Rollback: restore the prior `allowedDevOrigins` config and README sentence.
- Next: Reload the remote dashboard. If its browser-visible hostname differs from `100.83.173.93`, set `NEXT_ALLOWED_DEV_ORIGINS` to that hostname and restart the dev server.
