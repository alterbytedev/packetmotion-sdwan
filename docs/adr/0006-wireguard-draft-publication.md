# ADR 0006 — WireGuard draft and explicit publication

- Date: 2026-10-20
- Status: user-approved Save draft → Deploy workflow; source acceptance verified locally, appliance rollout is separate.

## Context

The former dashboard save immediately changed active controller topology and published peer revisions. Operators interpreted saved allocations and management receipt as a working tunnel, despite the separate local network privilege gate. Editing a pending configuration must not accidentally leak into agent reads, LAN publications or recovery plans.

## Decision

Persist one shared candidate draft per device in `wireguard_drafts`, independent of the active `wireguard_devices` / `wireguard_links` topology. Only explicit deployment can promote a candidate through the existing topology mutation/publication owner. Save never reserves resources or publishes. Deploy rechecks current operator role and independent draft/base versions under the existing topology advisory lock and node lock, then promotes topology, publishes affected peer revisions and clears the draft in one PostgreSQL transaction. Failed deployment retains the prior state and candidate. No-draft retries publish nothing.

Agents, plan generation and other existing topology mutations read active state only. Keep the legacy immediate PUT compatible; the dashboard uses additive draft/deploy endpoints. Existing legacy edits invalidate candidate base versions. Retain the last deployment's counterpart IDs so detached peers remain visible in current-state results. Status follows each node's current desired revision/checksum, receipt and fresh observations rather than creating another authoritative deployment state machine.

Apply and recovery ownership on appliances is unchanged. Controller publication cannot grant CAP_NET_ADMIN, enable local apply, restart services or prove connectivity. UI separates unpublished changes, receipt, local apply and recent handshake evidence, with actionable next steps. Copy reports contain controller observations, not raw appliance logs or secrets.

## Alternatives

Changing the existing PUT silently would break compatibility. Persisting edits directly into active topology without publishing would allow unrelated LAN or lifecycle publications to leak unreviewed changes. A separate Go service, remote shell or parallel agent queue is unnecessary.

## Consequences and verification

Migration 0020 must precede updated UI/API rollout. Drafts are controller-only intent and have no effect until deployed. Topology allocation can still fail at deploy if prerequisites/capacity changed after Save; errors retain the candidate for correction. Roll back application code while retaining the additive table/history; do not drop active topology or roll back applied migrations. Integration tests cover draft isolation, stale versions, role demotion, atomic failure, concurrency, idempotency and detached targets; browser tests cover desktop/mobile Save/Deploy/status/viewer behavior. No new appliance activation or network-plane evidence is claimed.
