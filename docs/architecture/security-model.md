# Security Model
- Preserve existing authentication; inspect session, API auth and RBAC before extending.
- Separate human sessions from agent identity; authenticate agents with mTLS or equivalently strong mutual device identity.
- Enrollment credentials must be scoped, expiring, one-time-use and revocable.
- Default-deny cross-site forwarding, explicit source/destination/protocol/port grants.
- Validate and constrain prefix advertisements and WireGuard AllowedIPs.
- Avoid generic remote shell execution; use typed configuration and narrowly scoped privileged helpers.
- Encrypt and restrict private key storage; never log secrets or expose them in audit history.
- Protect management connectivity during firewall, routing and interface changes; use staged apply and timed local rollback.
- Audit user, agent, action, revision, outcome and timestamps without sensitive payloads.
- Test negative authorization, malformed inputs, revocation, and policy bypass attempts.

## Controller boundary (management MVP implemented; public deployment pending)
```mermaid
sequenceDiagram
  participant A as Go agent
  participant P as Trusted TLS proxy
  participant C as Next.js controller
  participant D as PostgreSQL
  A->>C: Enroll over server-authenticated TLS with one-use token and signed CSR
  C->>D: Consume token and bind issued certificate to node
  C-->>A: Client certificate
  A->>P: Management request over mTLS
  P->>P: Verify certificate; strip caller identity headers
  P->>C: Forward over private authenticated upstream
  C->>D: Check certificate serial, expiry, revocation and scope
  C-->>A: Scoped response
```

Next.js Route Handlers and Server Actions use shared server-only services for authorization, validation, persistence and transactional audit. Existing operator auth is preserved. Enrollment occurs over server-authenticated TLS using one-time credentials; subsequent agent requests use mTLS verified by a trusted proxy. Strip caller identity headers and authenticate/protect the proxy upstream; prevent direct API bypass. Check device revocation and resource scope for every request, including keep-alive connections. Redact enrollment URLs, tokens and key material from proxy/application logs. Test this boundary against the deployed proxy before exposing agent endpoints. See ADR 0001.

## Management MVP implementation status
The local development signer and agent store PEM keys in private 0600 files/0700 state directories. Application-level key encryption/KMS is not implemented; encrypted host storage and production CA custody must be established before pilot. mTLS ingress and application revocation are verified in the isolated Go/NGINX test; deployment of the actual public HTTPS ingress and Debian service remains separate. Management config is staged/received only; the default service exposes no privileged networking. Source 0.2.0 adds locally gated owned WireGuard apply with a durable previous-plan journal; broader network LKG and data-plane policy remain pending. See ADR 0004 and the WireGuard operations guide for NET_ADMIN custody/evidence limits.

## Diagnostic log access
Runtime diagnostics are available through a read-only `/diagnosticlogs` page protected by the current superadmin operator session. The dashboard menu only exposes it to superadmins; the server page independently checks the current PostgreSQL role and redirects admins, viewers, and signed-out visitors. Diagnostic records remain sensitive, so database and CLI access must be restricted and output reviewed before sharing. The UI exposes no mutation or log deletion operations. There is no separate diagnostic developer identity; the legacy `diagnostic_developer` table created by migration 0004 is unused and retained because applied migrations are immutable.

The WireGuard adjacency source increment installs a narrowly owned nftables table that drops forwarded traffic entering/leaving this node’s tunnel interface group, even if the host already has IP forwarding enabled. Input/output policy and unrelated forwarding remain unchanged. See ADR 0004 for privilege custody and isolated/lab evidence; full LAN policy is not implemented.
