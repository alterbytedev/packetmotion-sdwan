# Go agent rules

Read [shared rules](../AGENTS.md), the [codebase map](../docs/development/codebase-map.md), [testing strategy](../docs/development/testing-strategy.md) and [API contract](../api/openapi.yaml).

## Scope and ownership

- This directory holds one shared Go 1.27.2 agent for Edge (`branch` on the wire) and Hub.
- `cmd/fabric-agent/` owns CLI configuration and scheduling; `internal/controller/` owns HTTP/TLS; `internal/identity/` owns private state; `internal/agent/` owns management workflows.
- Enrollment, heartbeat/interface telemetry, certificate renewal, checksummed desired-revision staging and received/rejected acknowledgements are implemented. Source 0.2.0 adds locally gated WireGuard adjacency apply/recovery and handshake observations in `internal/network/`; see [activation and evidence limits](../docs/operations/wireguard-tunnels.md). An owned nftables guard blocks tunnel transit. General FRR/nftables policy, LAN forwarding, routed failover and production/fleet deployment remain pending; supplied Debian lab evidence is recorded in the change log.

## Safety and readability

- Connections initiate outbound HTTPS and verify server TLS by default. `--allow-insecure-local` permits private/loopback HTTP only for isolated trusted labs; this exposes enrollment and management traffic. Controller Settings limits which private IPs appear in generated lab instructions.
- Never print tokens/private keys, run arbitrary shell commands or enable network apply through controller configuration. The default service remains unprivileged; only the local opt-in permits typed owned WireGuard operations. Keep state/key files private and uncommitted.
- Preserve persistence order, retry behavior, JSON contracts and checksum bytes when refactoring. Received configuration must never be described as applied.
- Use `gofmt`, explicit names and focused functions. Explain persistence and recovery invariants where they matter.

## Verification and records

Run relevant checks from `sdwan-edge/`:

```sh
go test ./...
go test -race ./...
go vet ./...
go build ./cmd/fabric-agent
```

Choose checks according to the shared testing strategy. `npm run test:agent` from `sdwan-controller/` exercises the real Go/NGINX/Next management boundary and requires Docker, OpenSSL and Go 1.27.2. It does not prove Debian installation or forwarding.

Record actual results and UNVERIFIED gaps. Append change logs through the root locked writer; preserve immutable served releases during source-only readability work.

## Routed LAN work in progress

`internal/network/` now contains an engine-level LAN/FRR transaction behind
`Engine.AllowRouting` and a specific `LANInterface`. Controller activation and
CLI wiring are pending; schema 2 rejects routing intent. Preserve the existing
FRR management routes and global configuration. Inspect
[ADR 0005](../docs/adr/0005-routed-lan-ownership.md) before changing ownership or
privileges. The opt-in `FABRIC_ROUTING_LAB=1` lifecycle test must run under both a
private mount namespace and a private network namespace; it starts separate FRR
daemons and never validates physical appliance reachability or failover.
