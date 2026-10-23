# PacketMotion Fabric Go agent

One binary runs on Edge and Hub. The controller assigns its registered kind (branch or hub wire values) during enrollment. The agent initiates HTTPS; after a one-use 15-minute token enrollment it uses its issued mTLS certificate. For the explicitly enabled isolated lab only, HTTP is also allowed to loopback or `192.168.160.200`; this exposes enrollment and management traffic to network observation or modification. No inbound branch port is required. Next.js + PostgreSQL is the controller; there is no Go controller API. Operator installation and release publishing are documented in [agent installation](../docs/operations/agent-installation.md).

## Build and verify

Go is pinned to 1.27.2 in go.mod. From this directory:

```sh
go test ./...
go test -race ./...
go vet ./...
go build -o bin/fabric-agent ./cmd/fabric-agent
GOOS=linux GOARCH=amd64 go build -o bin/fabric-agent-linux-amd64 ./cmd/fabric-agent
GOOS=linux GOARCH=arm64 go build -o bin/fabric-agent-linux-arm64 ./cmd/fabric-agent
```

Signed agent 0.3.1 packages the diagnostic-report compatibility, collection ordering, independent management retry schedules, and safe transport-error fixes. The 0.3.0 bundles remain immutable and predate these fixes. Deploy the matching controller with migrations through 0019 before upgrading; live report collection remains unverified until checked on the device.

The `Build and publish agent release` workflow runs pinned Go tests and builds signed `amd64`/`arm64` bundles when agent source changes reach `main`. It publishes the immutable bundles and installer into the controller's public assets so the dashboard can list them on the next controller deployment. Configure the repository Actions secret `FABRIC_RELEASE_SIGNING_KEY`; increment `internal/agent/agent.go`'s semantic version for every changed release. See the [release workflow operations](../docs/operations/agent-installation.md#building-and-publishing-artifacts).

## CLI reference

Source adds `fabric-agent network inspect`: read-only selected IPv4 interface/VLAN/route discovery, known network-service status and configuration-path presence. It does not load enrollment identity, read configuration contents, change networking or establish ownership. It is included in signed 0.4.0; earlier immutable releases are unchanged. See [inspection evidence and pending interface-apply gates](../docs/operations/interface-management.md).

`fabric-agent --version` prints the agent version and build OS/architecture without loading identity state or contacting the Controller. `fabric-agent version` remains available with its original version-only output. Use `fabric-agent --help` for commands, `fabric-agent enroll --help` for enrollment options, and `fabric-agent run --help` for runtime options.

Enrollment options include `--controller`, `--state-dir`, `--server-ca`, and the lab-only `--allow-insecure-local`. Runtime options include `--state-dir`, `--once`, and the local network activation gates `--enable-wireguard`, `--enable-routing`, and `--lan-interface`. Routing remains locally authorized and requires both WireGuard opt-in and a specific LAN interface; the Controller cannot enable it.

## Enroll and run

The Controller-published installer downloads and verifies the matching precompiled binary, prompts for the token without echoing it, enrolls the agent, and installs/starts the restricted systemd unit. It supports Linux amd64 and arm64. See the [operator installation guide](../docs/operations/agent-installation.md) for the install command, build/release process, recovery, and verification limits.

For manual development only, the CLI still accepts a token through stdin or `FABRIC_ENROLLMENT_TOKEN`; never place the token in command arguments or logs. Private key and identity are stored as mode 0600 files under a mode 0700 state directory. Healthy identities are never overwritten by enrolling again. A pending enrollment key is reused on retry; if the response is lost after consumption, use the authorized operator recovery action instead of erasing local identity or reusing the spent token.

Use run --once for a single verification cycle. Ordinary run sends real OS/architecture/uptime/interface telemetry on the configured interval, gets the latest desired revision, verifies checksum/type, atomically stores desired.json and identity state, then acknowledges received. Desired state is long-polled independently for up to 25 seconds (with negative jitter), so a dashboard publish can wake it promptly without waiting for the heartbeat cadence or creating extra heartbeat writes. Retries use startup jitter (up to five seconds) and bounded cycle backoff (up to 60 seconds plus 20% jitter). Pending heartbeat event IDs are preserved until heartbeat success; a later configuration failure does not retain an already accepted snapshot. Heartbeat and configuration are attempted independently, and renewal is attempted independently before each management request. Certificates renew before expiry using the enrolled key, with overlapping validity to survive response loss. The default service does not change networking. Source 0.2.0 has optional local WireGuard adjacency apply; see the activation section below.

## Channel

- POST /api/agent/v1/enroll: token + signed CSR; receive node identity/client certificate.
- POST /api/agent/v1/heartbeat: bounded actual telemetry; node scope comes from mTLS, not body identity.
- GET /api/agent/v1/desired: latest revision + typed payload + SHA-256; optional `wait=1..25` long-poll using the last revision/checksum.
- POST /api/agent/v1/ack: received/rejected revision; no applied claim yet.
- POST /api/agent/v1/device-state: response to an optional superadmin diagnostic request; reports only known local paths and owned WireGuard state, never key contents.
- POST /api/agent/v1/renew: renewal CSR for the enrolled key.

Dashboard config publish means persisting a new desired revision and waking the agent's bounded long-poll through a PostgreSQL notification hint. Agents still make outbound HTTPS/mTLS requests; there is no WebSocket/gRPC stream, inbound RPC or arbitrary remote shell. The initial typed payload contains kind, routing mode, LAN prefix and polling interval. Source 0.2.0 adds selected WireGuard adjacency generation/apply/recovery; FRR/nftables and LAN forwarding remain later milestones. Controller connected reflects heartbeat freshness; it does not mean tunnels/BGP/application access work.

The systemd unit is included in the signed release manifest and installed by the Controller-published installer. Debian service startup, reboot persistence, and upgrade rollback still require VM lab verification.

## Reconciliation and compatibility

Receipt acknowledgements remain pending in private identity state until the controller accepts them; restart retries a pending acknowledgement. Unchanged revisions do not rewrite state or repeat successful acknowledgements. The agent verifies its staged file checksum before requesting the optional unchanged response; a missing/corrupt file triggers a full fetch and repair. Unsupported checksummed typed configurations are acknowledged rejected without advancing the staged revision. Forged checksums and stale revisions are refused locally rather than acknowledged.

Deploy the controller before the updated agent. Legacy clients receive full responses; updated clients also accept full responses from older controllers. Rolling back retains the existing identity format (additional JSON fields are ignored by older agents); never delete identity state merely to downgrade. Local receipt durability does not provide a network apply journal or rollback.

The optional on-demand device-state request is returned with desired responses and may arrive on an unchanged revision. Source 0.2.0 agents collect only their own applied WireGuard journal and owned interfaces; they do not read arbitrary paths or private-key contents. Agents without the local WireGuard opt-in report collection unsupported. The latest controller report expires after 24 hours.

See [management communication operations](../docs/operations/management-channel.md) for latency, recovery and capacity limits.

For the separate Debian package/host bootstrap, see the [provisioning guide](sdwan-provisioning-scripts/README.md). The bootstrap preserves Debian/kernel interface names and configures the selected uplink; it is separate from agent management reconciliation.

## Source 0.2.0 WireGuard opt-in

See [selected hub tunnels](../docs/operations/wireguard-tunnels.md), [routed LAN delivery](../docs/operations/routed-lan.md) and [ADR 0004](../docs/adr/0004-wireguard-adjacencies.md). `run --enable-wireguard` registers a persistent local public key and applies typed schema-v2 adjacencies with local NET_ADMIN authorization. Signed agent 0.3.0 supports schema-v3 LAN/FRR BGP plans over those adjacencies. Applying one additionally requires `--enable-routing --lan-interface <locally-authorized-interface>` and local FRR vty socket permission. The controller cannot enable either local flag. Private keys remain in state. Default service startup does not enable network changes; signed release 0.2.0 does not support schema v3. The installer can upgrade an enrolled agent in place while preserving its identity, but software installation must be started on the device host. `wireguard-status` includes revision-scoped apply, handshake and BGP peer observations in source 0.3.0. Startup recovery precedes controller requests. The existing nftables tunnel-forwarding deny remains active, so BGP session and route exchange do not by themselves enable LAN transit.

The namespace check is documented in operations; ordinary Go tests skip it. Debian deployment/reboot and full proxy-to-kernel validation remain pending. Do not activate real appliances before management-path and lab review.

Signed release 0.3.2 adds bounded local operation logs, `status`, management-route recovery wiring and root-only `reset-network`. The installer offers a terminal-confirmed old-identity reset with private backup, owned network cleanup and retirement of local fabric-agent overrides, then starts the replacement in management-only mode. Read [replacement enrollment and recovery limits](../docs/operations/agent-installation.md#confirmed-replacement-enrollment-032) before use. Earlier signed bundles remain immutable. Local packaging and isolated namespace evidence do not prove a deployed Debian reset or reboot canary.

## Simple local activation (0.3.6)

After upgrading the enrolled service binary, use `sudo fabric-agent network enable`
on a device reporting disabled network apply. Inspect with
`sudo fabric-agent network status`. The command preserves ExecStart/state/arguments,
checks controller access and read-only network preflight, and manages one local
systemd opt-in. It does not authorize routing or execute from the controller.
`FABRIC_WIREGUARD_ENABLED=1` is a local runtime default; an explicit run flag takes
precedence. The default service/installer remains management only.
See [activation and recovery](../docs/operations/wireguard-tunnels.md#local-activation-gate).

## Interface safe commit increment — 2026-10-22

Agent 0.4.0 adds current interface CIDRs and dedicated static LAN/VLAN safe apply through a locally authorized independent guard. Controller migrations 0022/0023 add candidates and immutable commit history; Underlay row actions offer Save and apply and Edit and retry. WAN/DHCP/gateway/advertisements remain blocked by this adapter, and forwarding stays isolated. Earlier metadata-only descriptions above describe the previous increment. See [interface operations](../docs/operations/interface-management.md) for ownership, activation, recovery and evidence limits.
