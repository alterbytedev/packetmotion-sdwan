# Controller-agent communication reliability plan

## Scope and status

Implement a bounded improvement to the existing HTTPS/mTLS management channel between the Next.js controller and shared Go agent. Keep the current transport, controller routes, single agent process, durable desired revisions, and local network activation gates. Do not deploy, write to a live database, access appliances, activate networking, or rebuild signed release assets. Correlation to the reported live incident remains **UNVERIFIED** without its request/reference ID and deployed version/migration evidence.

The source agent may change while immutable signed release bundles remain untouched. Source changes require a future signed release and staged canary before appliance use. P0–P8 local implementation and required checks are complete. The implementation keeps one sequential owner of mutable agent state while tracking independent retry deadlines. Live incident correlation, Docker transport smoke, and canary acceptance remain **UNVERIFIED**.

## Steps and acceptance

1. **Report compatibility and limits:** Treat omitted `allowedPrefixes` as an empty array only when the Go wire struct omits an empty slice; keep malformed values rejected. Enforce the 32 KiB limit against the complete serialized report request. Add Go serialization and controller boundary regression coverage. Acceptance: Go-generated empty-prefix reports persist; malformed arrays fail; oversized envelope fails; existing populated reports continue to work.
2. **Diagnostic delivery:** Attempt requested diagnostics independently of desired config validation, durable staging, acknowledgement, or local apply outcomes. Wake the existing bounded desired wait when a diagnostic is queued, while the durable request row remains authoritative. Return basic host state when WireGuard is locally disabled and mark unavailable privileged observations explicitly. Keep response size, secret exclusion, retry, and idempotent request-ID behavior bounded. Acceptance: invalid/rejected config and ack/apply failures do not starve a delivered diagnostic; a queued request wakes a waiter; report does not claim unsupported network observations.
3. **Independent management timing:** Keep identity and mutable network reconciliation single-owner. Decouple heartbeat and certificate renewal retry timing from desired/config failures with bounded timers and no busy loops. Acceptance: injected config failures do not starve heartbeat or renewal; retries are bounded and cancellation cleanly stops timers. If implementation needs a new concurrent architecture or mutable-state ownership change, stop at the existing sequential loop and document the residual limitation.
4. **Actionable safe errors/readiness:** Preserve typed operation/status/request ID and retry timing where present; report only bounded safe codes and metadata, never tokens, response bodies, URLs with credentials, or raw secrets. Improve existing device-source status labels/freshness using existing UI patterns. Readiness checks only required schema using existing migration conventions; optional diagnostic/history support must not make desired retrieval unavailable. Acceptance: tests cover status/request ID propagation, redaction, schema/readiness, and UI distinction between expired, failed, pending and completed requests.
5. **Completion:** Align `api/openapi.yaml` and operational docs, add a staged canary checklist with explicit live-only gates, run focused checks once after final edits and review diff. No appliance rollout, live DB mutation, proxy smoke, or network-fault test is claimed unless a disposable isolated runner is available and does not touch protected environments.

## Risks and rollback

Changes affect management reporting and retry behavior, not forwarding or network activation. Main risks are changing a wire contract, duplicate diagnostic submission, unexpected retry load, or coupling optional tables into core desired retrieval. Preserve schema compatibility, idempotency, bounded requests/backoff, and single ownership of identity/network operations. Roll back by reverting source/controller code and documentation; retain additive request/report records and migrations. Do not alter or replace existing release bundles.

## Validation record

Run focused Go agent and controller boundary/integration tests for touched behavior, then relevant Go race/vet and controller lint/typecheck/integration checks at completion. Run browser checks only if the existing device configuration source UI changes. Actual results and unverified live behavior belong in the append-only change log.

## Execution handoff for Luna

This section makes the five steps above executable as small sequential work packets. It preserves their acceptance criteria; model choice is not evidence of correctness. Implementation of this plan was explicitly approved by the user on 2026-10-16. Do not spawn agents or switch models as part of executing these instructions.

### Start and resume protocol

1. Read root/scoped `AGENTS.md`, the agent index, testing strategy and this plan. Inspect `git status --short`, the latest change-log entry, and the diff for the next packet's files. Read the relevant local Next.js documentation before changing controller framework code.
2. Preserve the dirty worktree. Snapshot the specific files you will edit outside the repository, including untracked files, so your own delta can be reviewed. Never reset, stash, clean, or revert unrelated work. If files change unexpectedly while working, compare again before editing.
3. Execute packets P0–P8 in order. Work on one packet at a time. Reuse completed behavior after verifying it; do not rewrite it because this plan describes it as a task.
4. For each packet: reproduce the missing behavior with a focused regression test; implement the smallest fix; run the stated checks; review your delta; append the result with `node scripts/append-change-log.mjs <entry-file>` from repository root. Do not commit automatically.
5. Record packet ID, changed files, exact commands/outcomes, acceptance cases still missing, UI/network impact, risks, rollback and next packet in each log entry. Existing implementation without passing evidence is **UNVERIFIED**, not complete.
6. Proceed to the next packet after its acceptance tests pass. If a required test environment is unavailable, record the gap; independent source work may continue but dependent verified acceptance and overall completion remain blocked. Never weaken an assertion or remove a failing test merely to progress.

### P0 — Reconcile the current worktree (original step 1 prerequisite)

**Read:** `sdwan-controller/src/lib/fabric/device-state.ts`, `src/lib/fabric/channel.ts`, `src/app/api/agent/v1/desired/route.ts`; `sdwan-edge/internal/agent/agent.go`, `internal/network/diagnostics.go`; their existing tests. Controller paths below are relative to `sdwan-controller/`; Go paths are relative to `sdwan-edge/`.

At plan refinement on 2026-10-16, source inspection already found these partial changes:

| Behavior | Observed code; evidence still required |
| --- | --- |
| Omitted prefixes | `sanitizeReport` accepts omitted `allowedPrefixes` and normalizes to `[]`. Verify null and malformed values remain rejected. |
| Envelope size | `reportDeviceState` measures the serialized request envelope against 32768 bytes. Verify the exact transmitted body and boundaries. |
| Diagnostic ordering | `ReconcileWait` attempts the report after desired fetch, before config validation/staging/ack/apply. Early returns can still lose the diagnostic error. |
| Request wake | `requestDeviceState` queues `pg_notify` inside its transaction. `waitForDesiredConfig` still determines readiness only from revision changes, missing an already-pending request. |
| Disabled WireGuard | `DeviceState` returns basic file metadata without privileged commands. Explicit observation availability still needs review. |
| Remaining coupling | Main loop uses shared error backoff; desired route directly depends on diagnostic/history tables; readiness only executes `SELECT 1`. |

These are observations, not test results or claims about deployed binaries. Re-read them at execution time. Produce a short log mapping each packet to missing tests/behavior; preserve any work already implementing it. Live incident correlation is a separate unresolved evidence item and must not block reproducible local regression fixes.

### P1 — Wire compatibility and body limit (original step 1)

**Files:** controller `src/lib/fabric/device-state.ts`, `src/lib/fabric/agent-http.ts`, `tests/integration/device-state.test.mjs`; Go `internal/agent/agent.go`, `internal/agent/agent_test.go`, `internal/network/diagnostics.go`. Read `internal/network/wireguard.go` for the existing Tunnel JSON tags; do not change desired-plan serialization or checksums.

**Implementation contract:** omission alone means an empty prefix array; explicit null, strings, objects, invalid items and excessive counts remain invalid. Keep the shared ingress limit at 32768 UTF-8 bytes for the entire request, including request ID/status/report. Oversized reports send the existing bounded unavailable response, not a truncated successful snapshot. Retain authenticated node scoping and duplicate-request behavior.

**Required tests:** omitted, empty and populated prefixes; explicit null and malformed arrays; wrong node, stale ID, duplicate response; complete envelopes at/below/above the byte limit including multibyte text. Generate a deterministic sanitized fixture using the actual Go report structs and serializer, and consume that fixture through controller validation/persistence tests. Keep its generator/assertion in Go tests so changing the wire struct cannot silently leave a hand-written fixture passing. Do not use private identity/key contents in fixtures. A nil-to-empty slice assignment does not defeat `omitempty`; verify emitted JSON.

**Checks:** Go `go test ./internal/agent ./internal/network`; controller `npm run test:integration`. Add a focused Node test using the existing loader for the ingress limit if the integration test does not exercise `readAgentJson`; run that file directly with `node --test <file>`.

### P2 — Isolate diagnostic attempt from config outcomes (original step 2, agent)

**Files:** Go `internal/agent/agent.go`, `internal/agent/agent_test.go`, `internal/network/diagnostics.go`, nearby network tests.

**Implementation contract:** once a valid desired response delivers a diagnostic ID, attempt collection before config processing. A diagnostic failure must not prevent config processing; a config failure must not hide a diagnostic failure. Preserve both through existing error wrapping/joining without changing durable staging/ack order. Failed desired transport cannot deliver a new request; document that limit. Retrying the same pending ID remains bounded by the management scheduler and controller expiry; do not add a queue, new worker or new durable state owner.

Return basic state when local WireGuard opt-in is false, with zero network commands. Add optional, backward-compatible observation availability metadata only if existing fields cannot distinguish “not collected” from “no interfaces”; missing metadata in older reports means unknown. Define the Go/controller/OpenAPI field together and test old and new payloads. Never infer capability from a version string or treat basic state as kernel verification.

**Required tests:** delivered diagnostic with invalid checksum, rejected schema, stage-write failure, ack failure and local apply failure; report POST failure with successful config; simultaneous report/config failure; repeat ID; invalid ID; cancellation; WireGuard disabled performs no privileged command and reads no secret file content. Use existing fake HTTP/command runners, not host networking.

**Checks:** `go test ./internal/agent ./internal/network`; controller integration if the report contract changes.

### P3 — Diagnostic wake and optional dependencies (original steps 2 and 4, controller)

**Files:** controller `src/lib/fabric/{channel,revision-events,device-state,command-history}.ts`, `src/app/api/agent/v1/desired/route.ts`, `tests/{agent-desired-route,revision-events}.test.mjs`, `tests/integration/{device-state,agent-channel,command-history}.test.mjs`.

**Implementation contract:** reuse the existing node-scoped PostgreSQL notification channel and bounded waiter registry. Durable revision OR pending diagnostic state makes the wait ready. Check after waiter registration and reread after wake/timeout, so requests created before registration or lost notifications are not forgotten. Keep one wait per node, capacity bounds, abort cleanup, and no extra polling loop. Notifications emitted in a transaction become visible only after commit.

Desired retrieval must still work when optional diagnostic/history schema is absent. Handle only confirmed missing optional schema at its narrow boundary, using PostgreSQL error codes/catalog evidence; never blanket-catch authentication, database outage, permission errors or missing core schema. Do not swallow an error inside an already-aborted PostgreSQL transaction and then claim commit succeeded. Keep revision publication/audit transactions intact; this packet targets desired reads and optional delivery bookkeeping. Reuse one narrow availability helper if multiple callers require it; do not create a generic data access layer.

**Required tests:** request pending before wait, queued during wait, notification lost (timeout reread), other-node isolation, aborted/duplicate waiter cleanup, missing optional table still returns desired revision, missing core table/outage still fails, and optional bookkeeping failure emits safe diagnostics. Missing-table tests must use mocks or an isolated test database; never rename/drop a live table.

**Checks:** `node --test tests/agent-desired-route.test.mjs tests/revision-events.test.mjs`; `npm run test:integration`.

### P4 — Independent retry deadlines in the existing loop (original step 3)

**Files:** Go `cmd/fabric-agent/main.go`, `main_test.go`, `internal/agent/agent.go` and tests. Read `CycleWait`, heartbeat and `Renew` before extracting any helper.

**Implementation contract:** retain one sequential owner of identity, client replacement and network reconciliation. Track desired, heartbeat and renewal next-attempt deadlines/backoff independently. Reuse existing heartbeat interval, renewal-due logic, jitter and bounded retry policy; document exact limits in tests. Reset only the operation that succeeded. Preserve pending heartbeat snapshot/event ID across failures. Run due heartbeat/renewal work before entering another desired wait; cap that wait by the next independent deadline and existing 25-second maximum. Sleep cancellably until the earliest deadline when nothing is due; no busy retry on a rejected config or terminal HTTP error. Preserve `--once` semantics.

Use a small scheduler helper with injected time/operations if needed for deterministic tests; no goroutine-per-operation architecture. Sequential HTTP/apply calls can still delay other work by their bounded execution time: explicitly document this residual limit rather than claiming strict timing independence. If satisfying a requirement needs concurrent mutation, stop and present that decision instead of inventing an architecture.

**Required tests:** repeated config failure still attempts due heartbeat and renewal; heartbeat failure does not suppress desired fetch/renewal; renewal failure does not suppress other work; per-operation reset, capped retries/jitter, stable retried telemetry ID, long-poll deadline, cancellation/timer cleanup, and `--once`. Use fake time or bounded injected operations, not minute-long sleeps.

**Checks:** `go test ./cmd/fabric-agent ./internal/agent`; `go test -race ./cmd/fabric-agent ./internal/agent`.

### P5 — Safe actionable transport errors (original step 4)

**Files:** Go `internal/controller/client.go`, `client_test.go`, management loop/tests; controller `src/lib/fabric/agent-http.ts` only if needed for existing response metadata.

**Implementation contract:** use a small typed error carrying an allowlisted operation, safe code, HTTP status, validated/bounded `X-Request-ID`, and bounded retry metadata if supplied. Preserve cancellation/deadline detection. Do not carry raw response bodies, full URLs, query strings, credentials, TLS material or arbitrary header text into logs. Invalid request IDs/retry hints are ignored; valid retry hints cannot bypass scheduler bounds. Keep existing TLS validation, redirect refusal and response limits. Log safe fields at bounded retry attempts, not every tight-loop iteration.

**Required tests:** 400/401/403/409/429/503, valid/malicious/oversized request IDs and retry hints, timeout/cancellation, response read/decode failures and oversize responses. Seed body/header/URL errors with recognizable secret sentinels and assert none appear in the exposed error or log output. Test that typed metadata survives wrapping through the management layer.

**Checks:** `go test ./internal/controller ./internal/agent ./cmd/fabric-agent`.

### P6 — Required-schema readiness and truthful request states (original step 4)

**Files:** controller `src/app/api/ready/route.ts`, `tests/integration/readiness.test.mjs`, `src/lib/fabric/device-state.ts`, `src/components/fabric/device-configuration-sources.tsx`, integration/device-state and browser/inventory tests; `api/openapi.yaml`.

**Readiness contract:** enumerate actual required core management tables/columns from device authentication, desired retrieval, ack, heartbeat and renewal queries and migrations before changing readiness. Record that list in the owning code/test; do not invent a migration-version cutoff or require every optional dashboard feature. Reuse migration conventions; readiness is read-only and must not apply migrations. Missing core schema returns safe not-ready metadata; absent diagnostic/history schema alone does not block core readiness. Preserve no-store and request-ID behavior.

**State contract:** current `unavailable` conflates timeout and agent collection failure. Preserve existing status values and legacy responses; use a nullable, allowlisted reason field to distinguish new timeout/collection-failure records if no existing reliable field supplies that distinction. Add a new next-numbered migration if persistence requires it; never edit migration 0016 or infer the cause from timing alone. Existing unavailable rows with no reason display “unavailable; reason unknown.” The controller owns timeout reasons; the device cannot assert controller expiry. WireGuard disabled is a completed basic report with observations unavailable, not a claim that the device lacks all diagnostics. Keep two-minute request validity, 24-hour retention, request-ID deduplication and superadmin authorization.

**Required tests:** core schema present/missing, optional schema absent, outage and safe correlation; pending/completed/unsupported/agent failure/timeout/legacy unknown reason; stale replacement ID cannot overwrite newer request; old agents remain accepted. Browser test the Configuration sources states, refresh/collect, displayed timestamps and role denial with existing components; preserve layout and responsive appearance.

**Checks:** `npm run test:integration`, lint/typecheck; focused browser test using an existing or newly added descriptive test title with `npm run test:browser -- --grep '<actual test title>'`. Inspect desktop/mobile views if layout changes. If schema or API changes occur, run `node --test tests/api-contract.test.mjs`. No live migration command is authorized.

### P7 — Contract, operations and canary instructions (original step 5)

**Files:** `api/openapi.yaml`, `docs/operations/management-channel.md`, `docs/STATUS.md`, controller/agent READMEs only where changed behavior requires it; this plan's progress record. Existing agent/human indexes already link this plan; update them only if documents move or new documents are added.

Document implemented fields/statuses, error metadata, limits, compatibility, scheduler residual delays, optional-schema behavior, source-versus-signed-release distinction and unverified live incident correlation. Add the staged canary checklist to the existing management-channel document, not a duplicate status document.

The checklist must require separately authorized isolated hosts/proxy, exact source/binary versions, test-database migrations, baseline heartbeat/revision/certificate evidence, basic diagnostic request with WireGuard disabled, invalid config plus diagnostic, report retry/duplicate/expiry, controller outage/recovery, renewal and restart observations. Capture redacted request IDs/results. Keep existing network activation gates untouched. Record each scenario PASS/FAIL/UNVERIFIED; stop on management-path degradation and restore prior source/binary using existing recovery guidance. No production or fleet rollout follows automatically.

**Checks:** API contract test if edited, scoped documentation diff review and `git diff --check`. Never convert this checklist into claimed canary evidence.

### P8 — Final verification and review (original step 5)

From `sdwan-controller/`, run `npm test`, `npm run test:integration`, `npm run lint`, `npm run typecheck`, `npm run build`; reuse still-valid passing results from final code. Run the focused browser cases from P6 if UI changed. From `sdwan-edge/`, run `go test ./...`, `go test -race ./...`, `go vet ./...`, `go build -o /tmp/packetmotion-communication-agent ./cmd/fabric-agent` with pinned Go 1.27.2. Inspect installed versions first; missing tools are a verification gap, not permission to upgrade dependencies.

Before integration/browser checks, read `scripts/test-isolated.mjs`: it creates a disposable database, but its administrative connection comes from `TEST_DATABASE_URL` or `DATABASE_URL`. Confirm that target is disposable/local and authorized without printing credentials. Do not run directly against a live database. The current integration runner executes all integration files and does not forward arbitrary test-name filters; do not label that run focused. Unit files can run directly using the existing loader.

Run `npm run test:agent` only if its Docker/PKI/Go/proxy environment is isolated and available; otherwise mark the full transport scenario UNVERIFIED. Ordinary Go tests do not prove privileged namespace, appliance or forwarding behavior. Do not enable lab flags or alter host networking to make checks pass.

Review against your starting snapshots, not just HEAD: no duplicate state owner, changes to serialized desired checksums, altered lock/transaction order, secret leakage, unbounded retries, unrelated UI changes or release asset edits. Check every acceptance row below. Append final evidence and list unresolved risks explicitly. Rollback is a reviewed inverse of this task's own edits, keeping additive migration/data and all pre-existing work; never use whole-file checkout on the dirty worktree.

### Acceptance ledger and handoff prompt

All rows start **UNVERIFIED**. Update with dated change-log references only after actual tests; “code exists” is not a passing result.

| Original step | Packets | Required outcome | Evidence |
| --- | --- | --- | --- |
| 1 | P0, P1 | Real Go empty-prefix wire report persists; malformed/oversize requests rejected | Go serializer checks a committed exact wire fixture; isolated controller DB test persists that same Go-verified fixture and normalizes omitted prefixes to `[]`. UTF-8 ingress boundaries and malformed/oversized report rejection PASS (COMMUNICATION-P4-P8-001) |
| 2 | P2, P3 | Diagnostic survives config failures; durable pending requests wake; basic state truthful | Go diagnostic/config error-joining tests PASS; controller pending-before/during-wait and optional-table tests PASS; isolated database wake and state tests PASS (COMMUNICATION-P2-001, COMMUNICATION-P4-P8-001) |
| 3 | P4 | Independent bounded retries; cancellation; single mutable-state owner | Scheduler tests, full Go tests/race/vet/build PASS; operations remain sequential with bounded call-delay residual (COMMUNICATION-P4-P8-001) |
| 4 | P3, P5, P6 | Optional dependencies isolated; safe metadata; core readiness; distinct truthful UI states | Typed transport redaction/retry metadata tests PASS; core/optional-schema readiness and isolated reason authorization/persistence tests PASS; focused desktop/mobile browser test PASS (COMMUNICATION-P4-P8-001) |
| 5 | P7, P8 | Contracts/docs aligned; applicable checks pass; live evidence limits explicit | OpenAPI and operations/status docs updated; controller unit/integration/lint/typecheck/build and Go test/race/vet/build checks PASS. Live incident correlation, Docker transport smoke, and canary remain UNVERIFIED (COMMUNICATION-P4-P8-001) |

Suggested instruction after choosing Luna and approving implementation:

> Implement `docs/development/controller-agent-communication-plan.md` using its P0–P8 execution handoff. Implementation of the scoped plan is approved. Preserve existing edits; verify partial fixes before changing them. Complete packets sequentially with their regression tests and locked change-log entries. Keep the original acceptance criteria. Do not deploy, mutate live databases, access appliances, rebuild releases or activate networking. Stop only for the documented safety/access/architecture boundaries; report verification gaps honestly. Resume from recorded evidence rather than restarting completed packets.
