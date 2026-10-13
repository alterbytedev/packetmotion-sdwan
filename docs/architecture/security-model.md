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
Next.js Route Handlers and Server Actions use shared server-only services for authorization, validation, persistence and transactional audit. Existing operator auth is preserved. Enrollment occurs over server-authenticated TLS using one-time credentials; subsequent agent requests use mTLS verified by a trusted proxy. Strip caller identity headers and authenticate/protect the proxy upstream; prevent direct API bypass. Check device revocation and resource scope for every request, including keep-alive connections. Redact enrollment URLs, tokens and key material from proxy/application logs. Test this boundary against the deployed proxy before exposing agent endpoints. See ADR 0001.

## Management MVP implementation status
The local development signer and agent store PEM keys in private 0600 files/0700 state directories. Application-level key encryption/KMS is not implemented; encrypted host storage and production CA custody must be established before pilot. mTLS ingress and application revocation are verified in the isolated Go/NGINX test; deployment of the actual public HTTPS ingress and Debian service remains separate. Management config is staged/received only; privileged networking and LKG rollback are not exposed yet.

## Diagnostic log access
Runtime diagnostics are available through a read-only developer page protected by a dedicated password and session cookie, separate from operator and agent identities. The fixed username is `developer`; `init:developer` generates the initial random password and `reset:developer` rotates it. Only a scrypt hash is stored, login attempts use the shared database rate limiter, and rotating the hash invalidates existing sessions. Diagnostic records remain sensitive, so database and CLI access must be restricted and output reviewed before sharing. The UI exposes no mutation or log deletion operations.
