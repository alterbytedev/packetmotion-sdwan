# FRR Configuration Management Plan

## Goal

Make PacketMotion-owned FRRouting configuration easy for an engineer to inspect in the repository, safe to render and apply on an appliance, and measurable at realistic scale. Keep controller intent typed and validated. Do not accept or execute arbitrary controller-supplied `vtysh` text, and do not replace `/etc/frr/frr.conf` or disturb operator-owned FRR configuration.

This plan improves the existing Go agent and FRR BGP path. It does not authorize appliance rollout, enable routing, expand forwarding policy, or change local activation gates. Treat the current worktree as shared: inspect `git status` and preserve pre-existing edits. Do not overwrite or regenerate signed release assets.

## Current starting point

- `sdwan-edge/internal/network/bgp.go` validates typed BGP data. `sdwan-edge/internal/network/bgp_render.go` contains the readable FRR command template and converts a validated plan into the private owned candidate. `vtysh -C -f` validates a candidate; the agent applies commands with `vtysh -f` and verifies selected running-config invariants.
- `sdwan-edge/internal/network/wireguard.go` coordinates FRR with the locally gated, journaled network transaction and rollback.
- Controller desired state carries typed schema data. It must not gain a raw CLI/script field.
- Existing ownership, management-route protection, local routing opt-in, rollback and activation rules are defined by [ADR 0005](../adr/0005-routed-lan-ownership.md), [routed LAN operations](../operations/routed-lan.md), and [WireGuard operations](../operations/wireguard-tunnels.md). Read those before editing.
- Existing syntax/lifecycle evidence is version-specific. Check the current change log and status for what actually ran; do not copy historical PASS claims forward.

## Non-goals

- No arbitrary `vtysh`, shell, file path, executable, or command list from controller or operator API.
- No replacement/reload of the complete integrated FRR configuration and no ownership of management routes or unrelated protocols.
- No new controller service, streaming transport, database migration, operator UI, production rollout, physical appliance mutation, or change to local opt-in in this plan.
- No claim of fleet scalability from peer-count validation or unit tests alone.

## Execution rules

1. Work in small milestones. Before each milestone, inspect current source, scoped `AGENTS.md`, status, latest change log, relevant tests, and the initial worktree diff. The checkout may contain concurrent work; edit only owned lines/files and never use whole-file checkout/reset.
2. Keep one source of truth for BGP intent and one typed renderer. Preserve serialized desired-state bytes/checksums, journal ordering, lock ordering, ownership boundaries, and rollback behavior.
   - Keep FRR command syntax in a readable multiline command template in the relevant `*_render.go` file. Go code should validate typed intent, prepare named template data, and convert the template to a candidate; it should not assemble long FRR commands with scattered `fmt.Sprintf` calls or accept command text from controller state.
   - Apply this convention to every future FRR feature and to cleanup/removal commands as well as apply candidates. Use a feature-specific template and converter when the command block has a separate owner; keep the typed model, deterministic ordering, ownership checks, and exact-output fixture close to that template.
3. Keep the normal agent unprivileged. Do not broaden FRR socket permissions or local flags. Any required privilege/ownership change is a stop-and-propose decision requiring a separately approved plan and ADR update.
4. After each meaningful implementation change, run the smallest relevant tests immediately. Do not claim real FRR, appliance, Debian, or scale evidence unless it actually ran in an isolated environment with the version recorded.
5. Append a change-log entry for each meaningful task using the repository writer. Report tests, limitations, network impact, risks, rollback, and next step.

## Milestone 1 — Make rendering reviewable

**Goal:** A reviewer can identify the typed input and inspect the exact PacketMotion-owned FRR configuration it produces without reading a long string-building function.

**Inspect first:** `sdwan-edge/internal/network/bgp.go`, `wireguard.go`, `lan.go`, their tests, `sdwan-edge/AGENTS.md`, and ADR 0005.

**Work:**

- Extract only FRR rendering and its narrowly related types/helpers into a cohesive package/file under `sdwan-edge/internal/network/`; avoid a generic template framework.
- Keep rendering deterministic: stable ordering for peers, filters, and commands; normalized line endings; explicit final newline. Do not reorder serialized controller payloads or alter their checksums.
- Add representative typed input fixtures and checked-in expected rendered output for the existing supported BGP case, including multiple peers and preferred/backup values where supported. Fixtures are review artifacts, not deployable configs.
- Add exact renderer tests for output and tests that invalid or oversized input is rejected before invoking `vtysh`.
- Keep candidates private on appliances. Document where the temporary/local candidate is written and which repository fixture corresponds to its renderer; never commit device state, keys, or runtime candidates.

**Acceptance:** `go test ./internal/network/...` passes; fixture output is deterministic across repeat runs; changing a supported policy line creates an obvious fixture diff; syntax validation still uses the installed FRR tool when available; no desired JSON/checksum changes; no arbitrary CLI input added.

## Milestone 2 — Bound and verify scale

**Goal:** Establish tested operating bounds for realistic larger typed BGP plans and ensure config generation/application time does not create unbounded agent delay.

**Work:**

- Inventory all current bounds in controller validation, Go validation, HTTP payload limits, candidate file handling, waiter/agent scheduling, and FRR syntax/apply execution. Reuse current limits unless measured evidence justifies a change.
- Add deterministic benchmark or repeatable test scenarios for small, expected, and maximum supported plans. Include render size, render duration, syntax-validation duration when FRR is installed, and operation duration. Keep benchmarks opt-in if they are noisy; do not make ordinary tests time-sensitive.
- Set explicit context/time bounds around external `vtysh` invocations if not already enforced by the shared command runner. Confirm cancellation kills/reaps the child process and rollback still gets its own bounded recovery context.
- Measure the sequential agent loop behavior during a deliberately slow FRR operation. If heartbeat/renewal responsiveness is inadequate, document measured delay and propose the smallest safe scheduler change separately; do not add concurrent network mutation owners.
- Set peer/prefix/payload limits only from measured FRR and controller constraints. Keep clear rejection errors and test just-under/over-bound cases.

**Acceptance:** documented supported FRR/OS/tool versions and tested bounds; tests cover maximum accepted and first rejected plan; external commands have bounded execution and cleanup; ordinary `go test ./...`, `go test -race ./...`, `go vet ./...`, and build pass as appropriate; benchmark output is recorded with hardware/runtime/version and is not presented as a fleet guarantee.

## Milestone 3 — Prove update and recovery lifecycle

**Goal:** A typed FRR update either reaches the expected PacketMotion-owned state or restores the last-known-good owned state without changing management routes or unrelated FRR configuration.

**Work:**

- Extend isolated FRR tests using the repository's supported lab pattern. Cover first apply, idempotent reapply, larger update, peer/prefix removal, syntax rejection, partial command failure, confirmation failure, rollback, restart recovery, and an existing unrelated management static route/config section.
- Assert the exact owned objects before and after each operation. Assert unrelated FRR content/routes remain unchanged. Include controller loss during local recovery; restoration must not require the controller.
- Verify no secrets enter fixtures, logs, error summaries, controller snapshots, or command history.
- Record exact Debian, FRR, Go versions and commands. Separate syntax validation from daemon/session/route lifecycle evidence.

**Acceptance:** isolated lifecycle scenarios pass on the declared FRR version(s), all failure cases preserve or restore last-known-good owned state, unrelated config/routes remain intact, and unsupported versions/config shapes fail closed. Physical appliance, host-to-host forwarding, reboot, and fleet behavior stay explicitly UNVERIFIED unless separately exercised.

## Human inspection outcome

At completion, code review should be able to answer from repository files:

1. What typed fields can influence PacketMotion's FRR config?
2. What exact FRR text does a representative input render to?
3. Which FRR objects does PacketMotion own and remove?
4. What is the maximum accepted plan and why?
5. What happens on syntax error, timeout, partial apply, controller loss, restart, and rollback failure?
6. Which FRR/OS combinations and lifecycle scenarios have actual evidence?

Keep a concise operator guide pointing to the typed schema, renderer, fixtures, ownership ADR, local activation steps, and evidence. Do not duplicate implementation status across several documents; update the authoritative operations/status source only when behavior or evidence changes.

## Stop conditions and rollback

Stop and report before proceeding if the work requires arbitrary CLI strings, full `frr.conf` replacement, broader FRR socket permissions, new privileges, changes to management/default routes, changes to network activation gates, modifying signed release bundles, physical appliance access, or a new architecture/contract decision.

For source rollback, revert only the milestone's owned code/tests/docs and retain unrelated worktree changes, migrations, audit/history, and immutable release artifacts. Never roll back an activated appliance by stopping the agent or deleting its journal. Follow ADR 0005 and the routed-LAN recovery instructions for local owned-state restoration.

## Suggested implementation prompt

> Execute Milestone 1 of `docs/development/frr-configuration-management-plan.md` only. Preserve the existing worktree and inspect all relevant Go source/tests and current change-log evidence first. Keep typed BGP intent, serialized desired checksums, FRR ownership, local activation gates, transaction ordering, and rollback unchanged. Add deterministic human-reviewable renderer fixtures and focused tests. Do not change controller contracts, UI, privileges, release bundles, or appliance state. Run only the relevant Go checks, append the required change log, and report exact files, checks, UI/network impact, risks, rollback, remaining UNVERIFIED behavior, and next milestone. Stop if Milestone 1 requires an architecture or ownership change.
