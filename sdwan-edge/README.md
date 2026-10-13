# PacketMotion Fabric Go agent — management MVP

One binary runs on Edge and Hub. The controller assigns its registered kind (branch or hub wire values) during enrollment. The agent initiates HTTPS; after a one-use 15-minute token enrollment it uses its issued mTLS certificate. No inbound branch port is required. Next.js + PostgreSQL is the controller; there is no Go controller API.

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

## Enroll and run

Install the binary on the VM, create a private state directory owned by the service account, then enroll as that account. From Add device, save the one-time token. For a Bash terminal:

```sh
read -rsp 'Enrollment token: ' FABRIC_ENROLLMENT_TOKEN
export FABRIC_ENROLLMENT_TOKEN
./bin/fabric-agent enroll --controller https://controller.example.com --state-dir ./private-state
unset FABRIC_ENROLLMENT_TOKEN
./bin/fabric-agent run --state-dir ./private-state
```

For private HTTPS server CAs add --server-ca /path/server-ca.crt during enroll. TLS verification is never disabled. --allow-insecure-local permits HTTP only on loopback for same-machine development; it does not bypass the controller's trusted ingress requirement or replace mTLS deployment. Tokens are never command-line arguments or logged. The key and identity are stored mode 0600 in a mode 0700 state directory. Healthy identities are never overwritten by enrolling again. A pending enrollment key is reused on retry; if the response is lost after consumption, operator recovery is required rather than silently reusing the token.

Use run --once for a single verification cycle. Ordinary run sends real OS/architecture/uptime/interface telemetry, gets the latest desired revision, verifies checksum/type, atomically stores desired.json and identity state, then acknowledges received. Retries use jitter/backoff and preserve pending heartbeat event IDs. Certificates renew before expiry using the enrolled key, with overlapping validity to survive response loss. Forwarding is not changed by this MVP.

## Channel

- POST /api/agent/v1/enroll: token + signed CSR; receive node identity/client certificate.
- POST /api/agent/v1/heartbeat: bounded actual telemetry; node scope comes from mTLS, not body identity.
- GET /api/agent/v1/desired: latest revision + typed payload + SHA-256.
- POST /api/agent/v1/ack: received/rejected revision; no applied claim yet.
- POST /api/agent/v1/renew: renewal CSR for the enrolled key.

Dashboard config publish means persisting a new desired revision. Agents retrieve it on the next poll; there is no inbound RPC or arbitrary remote shell. The initial typed payload contains kind, routing mode, LAN prefix and polling interval. Full WireGuard/FRR/nftables generation/apply/rollback remains a later milestone. Controller connected reflects heartbeat freshness; it does not mean tunnels/BGP/application access work.

For optional systemd deployment see ../deploy/systemd/fabric-agent.service. Create the packetmotion service account, enroll it into /var/lib/packetmotion, install the binary, then enable the unit on the lab VM. The unit is a template and has not been started/verified on Debian in this task.
