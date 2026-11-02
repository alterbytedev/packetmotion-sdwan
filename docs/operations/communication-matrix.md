# Network communication matrix

This matrix describes the PacketMotion Fabric ports configured or required by the current implementation. It is a service-level reference, not a complete host firewall policy: actual addresses, NAT, state tracking, and upstream ACLs depend on deployment.

## Required and deployed flows

| Initiator → listener | Protocol and destination port | Purpose and authentication | Status and firewall guidance |
| --- | --- | --- | --- |
| Operator browser → controller NGINX | TCP 443 | HTTPS dashboard and operator APIs. Operator APIs use the signed-in session; `/api/agent/v1/*` additionally requires a verified device client certificate, except initial enrollment. | Required for the normal HTTPS deployment. Permit only from intended operator/device networks where practical. |
| Edge/Hub agent → controller NGINX | TCP 443 | Outbound HTTPS management API: enrollment, certificate renewal, desired revisions, acknowledgements, heartbeat, telemetry, WireGuard key/status. After enrollment, requests use mTLS. The agent initiates requests; the controller does not open a connection to the device. | Required after enrollment. Allow outbound HTTPS and stateful return traffic from each agent. No inbound management port is required on an Edge or Hub. |
| Edge/Hub agent → controller NGINX, initial enrollment only | TCP 443 | HTTPS enrollment with the one-use token and CSR; this endpoint does not require a client certificate because one has not been issued yet. | Preferred enrollment path. Enrollment is rate-limited at NGINX. |
| NGINX → Next.js controller | TCP, default 3000 | Private HTTP upstream for the dashboard and APIs. `setup-nginx.sh` defaults to `127.0.0.1:3000`; the container template uses its configured `CONTROLLER_UPSTREAM`. | Controller-internal only. Do not publish the upstream directly when NGINX is the ingress boundary. The port is configurable. |
| Next.js controller → PostgreSQL | TCP, port from `DATABASE_URL` (example/default 5432) | Application queries, transactions, migrations and notification waits. | Controller-internal only. Permit from the controller host/container to the configured database endpoint; do not expose PostgreSQL to Edge/Hub devices. |
| Edge → selected Hub WireGuard endpoint | UDP, per-link Hub port in its configured 128-port range; default base 20000, range 20000–20127 | WireGuard encrypted tunnel. The Edge sends to the Hub’s configured IPv4 endpoint and port. The Hub listens on the allocated port; the Edge uses an automatically selected local listen port and sends a 25-second persistent keepalive. | Optional, locally gated source 0.2.0 behavior. Permit UDP to each used Hub port and allow the corresponding stateful replies. Configure upstream firewall/NAT separately; the agent does not open ports. The supplied lab used UDP 22000 (not 2200). |

## Optional development/lab flows

| Initiator → listener | Protocol and destination port | Purpose | Limitations |
| --- | --- | --- | --- |
| Lab installer/device → controller NGINX | TCP 80 | In the Debian lab setup only: `/fabric/edge.sh`, signed release downloads, and one-time agent enrollment. Other HTTP paths return 404. | Cleartext, including the one-time token and CSR during enrollment. Isolated lab use only; do not expose publicly. The enrolled agent uses HTTPS/mTLS on TCP 443. |
| Developer browser → Next.js dev server | TCP 3000 by default | Local dashboard development without NGINX. | Development only. Use NGINX/TLS for device enrollment or production-like access. Do not expose as a production service. |

## Not currently required

| Protocol and port | Intended use | Current state |
| --- | --- | --- |
| TCP 179 | BGP between Edge and Hub | Not part of the active controller-to-agent routing workflow. BGP integration/activation remains pending; do not open this port based on source-engine tests or plans. |
| TCP 51820 | Commonly shown WireGuard example port | Not a PacketMotion default. WireGuard listen ports are configurable; this project defaults Hub base port to UDP 20000. |
| TCP/UDP 2200 | — | Not configured by this project. The recorded lab tunnel used **UDP 22000**. |

SSH, DNS, NTP, operating-system package repositories, monitoring, and backup traffic are host/deployment concerns and are not opened or managed by PacketMotion Fabric. Define those separately for the environment. Do not infer LAN forwarding or general BGP/nftables policy from an established WireGuard handshake: the current tunnel guard blocks forwarded tunnel traffic.

## Sources and status boundaries

- [HTTPS/mTLS ingress](../../deploy/proxy/README.md) documents NGINX listeners, paths and upstream trust.
- [Agent installation](agent-installation.md) documents outbound management and isolated HTTP enrollment.
- [WireGuard tunnels](wireguard-tunnels.md) documents port allocation, local activation, recovery and evidence limits.
- [Management channel](management-channel.md) documents HTTPS/mTLS request behavior and timing.

The default signed agent release 0.1.6 is management-only. Source 0.2.0 can apply WireGuard adjacencies only when locally enabled. A saved or received configuration is not proof that it was applied. LAN forwarding, general BGP/policy, NAT and routed failover remain pending or unverified; see [current delivery status](../STATUS.md).

Tunnel transit between device LANs is denied by default. Controller-defined allow rules (Settings → Transit policy) take effect only on appliances started with the local `--enable-transit` flag; see [Routed LAN](routed-lan.md#transit-allow-rules-milestone-3-source).
