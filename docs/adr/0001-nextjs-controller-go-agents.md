# ADR 0001 — Next.js controller API and Go agents

Status: Accepted by Rama, 2026-10-12. Implementation and capacity: UNVERIFIED.

## Context
The existing Next.js operator authentication and dashboard must be preserved. Rama is the primary maintainer. A separate Go controller would add deployment, internal authentication, and debugging boundaries without a demonstrated MVP need.

## Decision
Next.js owns the controller UI, Route Handler APIs, server-only domain services, and PostgreSQL persistence. Go agents run on Debian hubs and branches and initiate HTTPS polling to the controller. No separate Go controller API is planned. Scope remains single-customer L3 MVP.

Operator sessions use existing auth; device identity is separate. A trusted reverse proxy verifies agent mTLS certificates and replaces caller identity headers. The upstream connection must be private and authenticated, with no direct bypass. Next.js checks device registration, revocation, and resource scope on every request. Enrollment uses server-authenticated TLS and a scoped, expiring, hashed, single-use credential before mTLS identity exists. Proxy products and exact configuration require verification in the enrollment milestone.

Route Handlers and Server Actions call the same server-only services. Authorization, validation, revision integrity, and transactional audit live in those services. Server Components call services directly rather than making HTTP requests to their own API. Agents never use operator cookies. No generic command execution API is permitted.

## Alternatives
A separate Go API offers direct TLS handling and an independent runtime but adds operational work. Direct browser access to a separate backend adds another auth boundary. These are deferred until evidence warrants reconsideration.

## Consequences and scaling
Deploy an always-on Next.js Node service/container with PostgreSQL and a TLS proxy. Keep agent endpoints short and stateless; use bounded telemetry batches, durable deduplication, indexed queries, retention, polling jitter and exponential backoff. Fetch configuration only when revisions change. Long-running jobs may use a separate worker if needed; no worker or queue is required merely by this decision.

Horizontal replicas require a shared session secret, database-backed state, bounded database connections and coordinated migrations. Certificate revocation must be checked on every request, including existing keep-alive connections. Capacity is measured, not promised: baseline 2 hubs + 2 branches, pre-pilot gate 2 hubs + 10 branches, then synthetic-agent load tests.

Forwarding, BGP failover, applied-state persistence and timed rollback remain local and survive controller outage.

## Verification and reconsideration
Test proxy bypass/header spoofing, certificate failures and revocation, operator/device scope, concurrent enrollment, revision replay, controller outage and load before release. No network or capacity results are claimed by this ADR. Reconsider Go API only after measured bottlenecks or a concrete operational requirement, through a new ADR and approval.
