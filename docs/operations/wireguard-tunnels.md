# Selected hub WireGuard tunnels

This feature adds saved hub selection and automatic **tunnel** addressing. Signed agent release 0.2.0 includes local opt-in apply and device-state reporting. The default service remains unprivileged and does not enable WireGuard; a local operator must explicitly enable WireGuard. Agent 0.3.6 provides the command below to manage the required systemd drop-in. Do not treat received configuration as applied, or applied interfaces as verified LAN routing.

## Dashboard setup

1. A superadmin opens Settings → Tunnel addressing and chooses an unused canonical private IPv4 pool, for example `10.250.0.0/24`. Supported prefix lengths are 16–30. Confirm it does not overlap management, underlay, existing LANs or VPN routes across the deployment; the controller cannot discover every host's routes.
2. Upgrade the intended Hub and Edge agents from reviewed source after isolated validation. Signed 0.3.3 agents register public keys during management reconciliation, including with network apply disabled. Enable WireGuard locally as described below only when ready to apply tunnels. Agents register only their public keys; retain their private state.
3. On each Hub device detail page, set a reachable underlay IPv4 endpoint and base UDP port. The controller reserves 128 consecutive ports for that Hub, one per Edge adjacency. Overlapping ranges on the same endpoint address are rejected. Configure external firewalls/NAT to permit the necessary UDP traffic; the agent does not open them.
4. On an Edge detail page, select up to eight available keyed Hubs and save. Each pair receives a stable /31, separate interface and UDP port. Both peer revisions are published atomically. No branch LAN address is changed.
5. Inspect receipt status, Network apply and per-interface last handshake separately. Reports retain timestamps and revisions; a previous revision or old timestamp is not current proof. A zero handshake means none observed. Use tunnel-IP ping in the isolated lab to verify traffic.

Only superadmins change the pool. Admins and superadmins configure Hub endpoints and Edge selections; viewers can read. Optimistic versions reject concurrent stale saves; reload after a conflict. Deselecting a Hub removes its active peer configuration while retaining reserved addresses/port. Reserved pools and Hub base ports cannot be changed through normal settings; explicit migration/reclamation is not implemented. Revocation publishes removal to active counterparts; an offline counterpart applies removal only after reconnecting.

## Local activation gate

Before activation, arrange independent console access or a timed local rollback, and record the management route, node identity, current addresses/routes, kernel/tools versions, and any existing WireGuard ownership. Confirm the pool and endpoints avoid management/underlay routes. Use isolated Debian VMs before deployment. Do not replace an enrolled identity or its private keys.

With agent **0.3.6 or newer**, run on the appliance showing **Local activation required**:

```sh
sudo fabric-agent network enable
sudo fabric-agent network status
```

Use the installed service binary and independent VM console access. An unknown `network` command means the installed agent needs an upgrade: use **Advanced → Agent upgrade → 0.3.6** on that device, run its signed installer command locally, then confirm `fabric-agent --version`. Preserve the enrolled identity; no new token or reset is needed. Repeat activation only on peers that remain disabled. The SD-WAN activation tip appears only for a current disabled apply observation; it disappears after activation is reported. Healthy devices do not show this tip. Enrollment itself still starts management only.

Releases **0.3.4 and 0.3.5 have an activation preflight panic** when no custom command runner is supplied. Upgrade to **0.3.6** before using `network enable`; repeated enable attempts on the affected binary do not fix it. This panic occurs before writing the activation override or restarting the service, so a following status can correctly remain disabled. Do not reset enrollment, remove state, or redeploy unchanged configuration to work around it. The default-runner regression and real iproute2 preflight are now covered separately from injected-runner tests.

The root-only command inspects the running `fabric-agent.service` process and private state directory, checks installed iproute2/WireGuard/nftables tools, authenticates to the controller, and reuses the engine's read-only route/interface/management collision preflight. It creates only `/etc/systemd/system/fabric-agent.service.d/90-packetmotion-wireguard.conf`, setting the local `FABRIC_WIREGUARD_ENABLED=1` runtime default, CAP_NET_ADMIN and required address families. It does not rewrite ExecStart, binary/state paths, existing arguments or unrelated overrides, or enable routing. Explicit `--enable-wireguard=false` requires local review/removal first. The service must already be running the same installed binary; stopped or mismatched services receive recovery instructions instead of automatic replacement.

Activation shares the installer lock to serialize upgrades, identity replacement and local activation, writes its root-private drop-in atomically, reloads/restarts the service and checks service activation plus controller authentication after restart. A normal restart/verification failure restores the previous contents of this one drop-in (or removes a newly created one), reloads and requests restart of the previous service. Recovery failure is explicit and requires console investigation. Already enabled services are inspected without restarting. `network status` distinguishes the runtime opt-in, the previous successful apply journal, pending recovery and live handshake timestamps; it does not label a received revision or an old journal as current applied configuration. Verify current revision/checksum in SD-WAN after the next check-in.

This service-file rollback is **not** a tunnel teardown or a guarantee of kernel rollback after a successful apply. The existing engine owns network journal recovery. Abrupt CLI termination, power loss, disk faults, effective custom systemd restrictions and real Debian service/reboot failure canaries remain separate verification requirements; retain console access and do not delete recovery files. Missing tools must be installed locally (`iproute2`, `wireguard-tools`, `nftables`); the command does not install packages or open firewalls. Required executables are `/usr/sbin/ip`, `/usr/bin/wg` and `/usr/sbin/nft`, with kernel WireGuard support.

The manual `--enable-wireguard` opt-in and example at `deploy/systemd/fabric-agent.service.d/wireguard.conf.example` remain available for reviewed custom installations. The default signed installer does not grant network capabilities. Earlier immutable bundles are preserved. The original two-host 0.2.0 lab used an explicitly reviewed separate binary/drop-in, distinct from this new activation command.

Private files in the 0700 state directory include `wireguard.key` (0600), `network-applied.json`, `network-pending.json` and `network.lock`. Keep the key and journal; do not share them in diagnostic reports. Keys are protected by filesystem permissions, not application-level encryption. JSON plans contain peer public keys, not private keys.

## Safety and recovery

- Preflight validates typed /31 adjacencies, keys, endpoints, owned interface names/groups, host route collisions and controller-address overlap. It never accepts arbitrary shell commands. Only owned WireGuard interfaces, their connected /31 routes and the owned nftables forwarding-isolation table are changed. The guard drops forwarded packets entering/leaving this node’s tunnel group and preserves input/output and unrelated forwarding. It is installed before bringing up tunnels and refreshed even for unchanged plans. Host forwarding sysctls are preserved.
- A topology change rebuilds this agent's owned tunnels and can interrupt their traffic. Each command has a five-second timeout; the apply phase has a 90-second deadline. Failed application/management confirmation restores the previous plan with a separate bounded recovery context. A failed rollback keeps the pending journal and requires local investigation.
- Startup recovers pending state and restores missing locally applied interfaces before controller requests. This supports local recovery during controller outage. It is not proof of Debian reboot persistence or independent hardware watchdog behavior.
- Changing routes outside the agent or manually changing owned interfaces is unsupported. The unchanged-plan fast path checks presence/ownership, and handshake reporting checks expected peers; it does not fully verify every kernel setting for drift.
- Stopping/disabling the agent or reverting to the management binary does **not** remove active WireGuard interfaces. To remove managed tunnels normally, deselect all Hubs while both peers can reconnect, verify an applied empty plan, then remove the opt-in drop-in. A harmless group-scoped nftables guard can remain after empty plans; remove only its exact owned table after verifying that no owned interfaces remain. During emergency console recovery, identify exact interfaces by node group/name/type and remove only confirmed PacketMotion interfaces. Preserve journals/identity and never flush host routes or firewall rules.
- Restoring a prior source version does not reverse database data. Preserve additive migrations, reservations, audit history and append-only change logs. A destructive pool migration requires separate approval.

## Reproducible isolated check

From `sdwan-edge/` on Linux with Go, `unshare`, `nsenter`, iproute2, wireguard-tools, ping and sufficient namespace privileges:

```sh
unshare --mount --net --fork env FABRIC_WIREGUARD_LAB=1 FABRIC_WIREGUARD_OUTER_NS=1 \
  go test -v ./internal/network -run TestNamespaceWireguardLifecycle -count=1
```

The test refuses the PID-1 network namespace, creates disposable Edge/Hub namespaces plus a test LAN namespace and veth pairs inside the disposable outer namespace, then cleans up child processes. It verifies two real handshakes and tunnel pings, management underlay connectivity, rollback on failed confirmation, restoration after interface removal, interrupted-journal recovery, deselection and removal, and a positive/negative forwarding guard test with IP forwarding enabled. It does not exercise physical Debian NICs, systemd, NAT, general forwarding policy, BGP, disk faults, process-kill windows or the actual mTLS proxy.

## User-provided Debian lab

Hub `192.168.160.142` and Edge `192.168.160.141` use ens33 management through `192.168.160.2`; those addresses/routes were preserved. Reviewed source 0.2.0 is installed separately from their original binaries. Root-only state/service/network snapshots and a rollback helper are retained in `/root/packetmotion-wireguard-lab-20261015` on each appliance. Do not share those backups: they contain identity material. The helper removes only this node’s owned tunnel interfaces/guard and lab drop-in, then restores its original management service. It does not erase controller reservations or identity. Successful lab validation cancels the temporary rollback timers; the helper remains available for manual console recovery. Current exact validation and remaining gaps are recorded in the change log.

Final lab checks also verified actual reboots of both appliances, re-created guards/interfaces and preserved management routes, current applied reports with real handshakes, and Edge tunnel recovery while its controller HTTPS traffic was deliberately blocked. The temporary outage rule was removed. These observations apply to the supplied two-host lab; NAT, multiple physical Hubs, sustained load/MTU, disk faults, arbitrary process-kill timing, LAN forwarding and BGP/failover remain unverified.

## Draft and explicit deployment workflow

The dashboard Hub endpoint and Hub connections forms now use **Save draft → Deploy changes**. Save draft persists only editable intent on the controller; it does not reserve addresses/ports, update active links, publish revisions or wake agents. Reload restores the saved draft. Unsaved edits must be saved before Deploy is available. Saving values equal to the published settings clears unpublished changes. Drafts are shared per device, with independent optimistic versions; concurrent changes require reload/review rather than silent overwrites.

Deploy rechecks the current operator role, draft/base versions and all existing key, pool, endpoint, capacity and ownership constraints, then applies the existing controller topology transaction and publishes affected peer revisions atomically. Failure preserves the draft and prior topology/revisions. Retrying an already completed deployment with no new draft creates no additional revision. Active plan generation, agent reads, LAN publications and revocation never read drafts. Removing a Hub includes its removal revision and retains it in the last-deployment status list. Address/port reservations are still retained.

Deploy is disabled with no unpublished changes or while local edits remain unsaved. A disabled Deploy button means there is nothing new to publish; it does not imply a healthy tunnel. Each affected device shows its latest published revision, receipt, matching/recent apply report, heartbeat and a suggested next step. Disabled local apply requires console activation on **both** peers; failed apply requires local log/preflight investigation; applied interfaces without recent handshakes require endpoint/UDP/firewall/peer checks. A recent handshake is not a tunnel ping or LAN-forwarding proof. Offline and stale observations are explicit; successful receipt alone is never shown as applied. Reports follow each device's latest revision, including later publications by other operations.

The conditional local activation details show the 0.3.6 command above and do not execute commands remotely. Copy deployment report exports only controller-held device observations and assessments, without keys/credentials or raw service logs. This is not the proposed full on-demand remote diagnostic collector.

Apply additive controller migration `0020_wireguard_drafts.sql` with `npm run migrate:controller` **before deploying the updated UI/API**. Existing records have no draft and retain their active topology. The original `PUT /api/operator/nodes/{id}/wireguard` remains an immediate-publication compatibility API; the dashboard exclusively saves through `/wireguard/draft` and publishes through `/wireguard/deploy`. A legacy update makes an existing draft's base version stale; re-save after review before deploying. LAN, agent check-in settings and other forms retain their existing workflows.
