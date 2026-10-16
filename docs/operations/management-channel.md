# Controller–Edge management communication

## Architecture and guarantees

The existing Next.js controller owns server-only domain services and PostgreSQL. The shared Go agent initiates outbound HTTPS by default; dedicated client certificates authenticate Edge/Hub devices through NGINX. The authenticated upstream checks active certificate/node scope on every request, including reused TLS connections. For isolated development labs only, an explicit agent/install flag permits HTTP to private or loopback IPs; the superadmin-configured Settings allowlist controls whether the operator UI emits that flag. HTTP mode exposes enrollment and management traffic. Operator sessions remain separate. No inbound Edge management listener, message broker, streaming service, or generic remote shell is introduced.

Enrollment uses the existing expiring single-use token and locally generated private key. State is private (0700 directory, 0600 files), written using fsync and rename. If a token was consumed but the device never received its identity, an admin can reset enrollment while no heartbeat exists; this revokes the issued certificate and returns the device to pending enrollment. PEM storage is not application-level encrypted; production CA custody and encrypted host storage remain deployment requirements.

## Responsive synchronization target

Agent release 0.1.6 uses an agent-initiated HTTPS/mTLS bounded long-poll on the existing desired-state endpoint. The agent asks the controller to wait up to 25 seconds for a newer revision, independently of its heartbeat cadence. Dashboard publish writes the immutable revision in PostgreSQL and emits a transaction-bound notification as a wake-up hint; each waiter rereads durable state before sleeping and after wake/timeout. A lost notification therefore delays delivery only until timeout. The endpoint remains compatible with older clients that omit `wait`. Pending enrollment keys can be rebound to the supplied controller origin; enrolled identities are not replaceable. This is request/response long-poll, not a persistent bidirectional WebSocket/gRPC stream. See [ADR 0003](../adr/0003-event-driven-agent-management.md) and the [control-channel design and evidence limits](../architecture/agent-control-channel.md).

## Reconciliation and recovery

Each cycle attempts renewal when due, heartbeat, and configuration reconciliation. Heartbeat acceptance releases its pending event independently of configuration success; retry IDs remain stable until heartbeat succeeds. The pending heartbeat is memory-only and is replaced after process restart; this is bounded current-state telemetry, not a durable event archive.

A desired revision is validated and staged, then acknowledged received. Pending receipt acknowledgements persist across restart and retry idempotently. Unknown schema/type/fields or invalid LAN prefixes with verified checksums receive rejected acknowledgements; invalid checksums and stale revisions fail locally. Nothing in this channel applies network configuration. Keep the last valid staged state when the controller returns invalid configuration.

For unchanged revisions the agent checks its cached file and supplies revision/checksum. The controller returns a small unchanged marker only if both match the device's latest revision. Missing/corrupt cache causes full retrieval and repair. Successful unchanged receipts do not write state or repeat acknowledgements. Fetch and acknowledgement races with a new publish produce a conflict; the next cycle fetches the newer revision.

Renewal persists the replacement before switching clients, preserving the old identity on errors. Existing overlapping-certificate issuance tolerates response loss. If a certificate expires while disconnected, ordinary mTLS renewal cannot recover; use an authorized operator and the existing enrollment/revocation recovery workflow. Never disable TLS verification or erase identity as an automatic retry.

## Timing and capacity

Telemetry is sampled on the configured healthy interval of 10–300 seconds. Desired-state waits run independently, each capped at 25 seconds and up to 20% negative jitter; a publish can wake them immediately without causing an extra heartbeat. Normal startup adds up to five seconds of jitter; `run --once` skips startup delay and does not wait. Failures share exponential cycle backoff capped at 60 seconds plus up to 20% jitter; healthy telemetry timing is not guaranteed during configuration or renewal failures. No latency SLA is established.

HTTP connections are bounded to two per origin with handshake/header/overall deadlines and idle connection cleanup. Heartbeats follow the configured interval; desired-state waits reconnect at most every 25 seconds, and a new revision adds an acknowledgement. Each active wait holds one HTTP connection and one PostgreSQL LISTEN connection per controller process, plus short database reads; only one wait per node per process is accepted and total waiters are capped at 2,000. Approximate steady request rate is heartbeat count / configured interval plus up to device count / 25 seconds for waits, excluding acknowledgements, renewals, retries, and reconnects. Fleet sizing and multi-process waiter coordination have not been measured. PostgreSQL heartbeat processing remains transactional with bounded retention of 100 samples per device; deduplication is limited to retained event IDs. Configuration history remains immutable and has no new retention policy.

The isolated `npm run test:agent` smoke includes real Go agent long-poll wake-up after dashboard publish and also measures 40 authenticated unchanged reads over eight concurrent connections. The previous 2026-10-14 sample (before long-poll) completed in 141.3 ms with 68.7 ms p95 and zero failed reads; it is not a long-poll performance result. The updated end-to-end smoke is UNVERIFIED because Docker could not execute its NGINX container in this environment. PostgreSQL long-poll wake/timeout behavior and Go unit tests pass. This does not simulate a fleet, heartbeat write load, retry storms, WAN latency, or production deployment. Production fleet capacity, Debian service/reboot behavior and data-plane forwarding remain UNVERIFIED. Before a pilot, run sustained mixed heartbeat/config/renewal traffic at the intended device count and intervals; record p95/p99 latency, errors, PostgreSQL pool/lock pressure, CPU/memory, outages/reconnects and resource limits before setting capacity or latency commitments.

## Deploy and rollback

Deploy the controller first, then agent binaries. No migration is introduced by this hardening. Existing clients continue to receive full desired responses; new agents accept full responses from old controllers. See the [ingress guide](../../deploy/proxy/README.md) and [agent guide](../../sdwan-edge/README.md). Never expose the private controller upstream or proxy secret.

Rollback by deploying the controller handler with immediate desired responses and agent 0.1.2 periodic-polling binaries, preserving identities, revision records, audit data, schema and append-only change logs. No database migration is introduced. Dashboard appearance/auth and privileged network state are unchanged.

## Selected hub tunnel source increment

Source 0.2.0 adds saved multi-hub selection and a local WireGuard activation gate. Apply controller migrations through 0009 before deploying its UI/API. Existing signed installer/release 0.1.6 and the default unprivileged service remain management-only. See [activation, recovery and evidence limits](wireguard-tunnels.md). No automatic release or network activation is performed.
