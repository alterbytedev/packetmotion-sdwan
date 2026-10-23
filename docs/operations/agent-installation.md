# Edge and Hub agent installation

## Operator workflow

From **Devices → Add device**, create the device and copy the one-time enrollment token. On the target Debian host, download and inspect the installer, then run it with the Controller HTTPS origin:

```sh
curl -fsSLo install.sh https://controller.example.com/fabric/edge.sh
sudo bash install.sh --controller https://controller.example.com
```

The UI builds this command using `CONTROLLER_ENROLLMENT_URL` when configured. Otherwise, it uses the same-origin URL from the operator request, which is checked by the Controller's CSRF guard. In production, set `CONTROLLER_PUBLIC_ORIGIN` to the browser-facing HTTPS origin; set `CONTROLLER_ENROLLMENT_URL` only when the devices must use a different reachable origin. Do not use a browser-only hostname or localhost for a remote Debian device.

The Add device command is a single copy/paste operation. It pipes the one-time token through standard input, so the token is not placed in shell history or process arguments. It verifies a signed, versioned manifest and the selected precompiled Linux binary, creates the restricted `packetmotion` account, enrolls the Go agent, and enables `fabric-agent.service`. For manual installation, omit `--token-stdin` and the installer prompts for the token without echoing it. The agent connects outbound over HTTPS; no inbound device port is opened. For local development only, explicit loopback HTTP can be enabled with `--allow-insecure-local`.

The installer supports Linux `amd64` and `arm64`. It requires systemd and uses Debian package installation for missing `curl`, OpenSSL, Python 3, checksum, and systemd utilities. Review the downloaded installer before running it with root privileges. For isolated development labs only, a superadmin can allow private controller IPs in **Settings → Insecure HTTP lab controllers**. New device instructions then add `--allow-insecure-local`; this permits HTTP enrollment to private IPv4/IPv6 and loopback addresses. The setting controls generated instructions; it does not alter server TLS or block an operator from manually invoking the explicit development flag. A private HTTP installer exposes the one-time token and CSR to the lab network.

For a local binary check, run `fabric-agent --version`; it prints the version and build platform without reading enrollment state or contacting the Controller. `fabric-agent --help`, `fabric-agent enroll --help`, and `fabric-agent run --help` show the available commands and their options. The existing `fabric-agent version` command remains compatible and prints only the version.

On a device detail page, superadmins can select one of the five newest complete release bundles and copy a one-command upgrade. The command downloads the public installer and passes `--version`; the installer validates the numeric version, verifies the pinned Ed25519 signature and artifact hashes, then performs the in-place upgrade. It does not run from the controller: an operator must run the command in a root-capable shell on that Debian device. The existing enrolled identity and local systemd drop-ins are preserved; a failed service start restores the previous binary and attempts to restart it. A new-device enrollment command continues to use the installer's default release.

The dashboard Overview and device detail page show reported agent versions from the most recent heartbeat. A missing version means the agent has not sent a heartbeat containing version telemetry; it is not inferred from the selected download release.

The Debian lab NGINX bootstrap exposes HTTP on port 80 for the installer, signed release artifacts, and one-time enrollment endpoint only. This lets a device submit its token and CSR through the trusted proxy without TLS, but the management channel uses the configured HTTPS `CONTROLLER_AGENT_URL`. The generated lab command includes the controller server-CA SHA-256 fingerprint. The installer fetches the CA over HTTPS, verifies that pin, installs the CA in Debian's trust store, and saves it with the agent identity before enrolling; one copy/paste command then enrolls and starts management without a separate certificate command. Never trust a CA fetched over HTTP or skip the fingerprint check. Do not expose port 80 outside an isolated lab. Public addresses and hostnames still require HTTPS with a certificate trusted by the Debian host.

## Current-state reporting fix: 0.3.1

Signed Linux amd64/arm64 0.3.1 assets include the reporting and management retry fixes that postdate immutable release 0.3.0. Deploy the matching controller source and public assets, applying controller migrations through 0019 with `npm run migrate:controller` before starting the updated controller. Building assets locally does not update the running controller or appliance.

Once that deployment serves 0.3.1, run on the enrolled Edge host:

```sh
curl -fsSL https://192.168.160.200/fabric/edge.sh | sudo bash -s -- --controller https://192.168.160.200 --version 0.3.1
fabric-agent --version
```

Confirm version 0.3.1 and a fresh heartbeat, then select **Collect current state** again; an already expired request is not resumed. A completed basic report is valid when local WireGuard collection is disabled. If collection fails, retain the request reference and inspect `journalctl -u fabric-agent --since '5 minutes ago' --no-pager` locally; share only redacted diagnostics. A connected heartbeat alone does not prove report delivery. Appliance reporting, restart and outage canary scenarios remain UNVERIFIED until exercised.

For binary rollback, rerun the same installer command with `--version 0.3.0`; existing identity and local service drop-ins are preserved. Retain additive controller migrations/data. Rolling back restores the older reporting limitations.

## Building and publishing artifacts

The `Build and publish agent release` GitHub Actions workflow runs on `main` when shared agent Go source, installer source, the service definition, or the release builder changes. It runs the pinned Go checks, builds signed Linux `amd64` and `arm64` bundles, and commits the immutable bundle plus rendered installer into `sdwan-controller/public/fabric/`. The dashboard's release selector reads those complete bundles at controller build/runtime. The controller deployment must include that generated commit before operators can select the new release.

Configure the repository Actions secret `FABRIC_RELEASE_SIGNING_KEY` with the release private key PEM. Keep the corresponding public key in `sdwan-edge/release/release-public.pem`. The workflow fails closed when the secret is missing, verifies the public-key signature locally before publishing, and never prints the private key. Increment `internal/agent/agent.go`'s semantic `Version` for each changed agent release; an existing version is immutable, and the release builder rejects different contents under the same version. Give the workflow permission to push to `main`; if branch protection blocks its bot push, the release remains unpublished until the repository's approved deployment policy is configured.

Use Go 1.27.2 and OpenSSL with the repository's pinned Ed25519 release public key. Supply the matching release private key through a protected path; never commit or place it under the public directory.

```sh
cd sdwan-controller
FABRIC_RELEASE_SIGNING_KEY=/secure/path/fabric-release-private.pem npm run build:agent-release
npm run build
```

The release command cross-compiles static Linux `amd64` and `arm64` binaries, creates a manifest containing their SHA-256 digests and the systemd unit digest, signs the manifest, verifies the signature, and publishes immutable versioned files under `sdwan-controller/public/fabric/releases/<version>/`. It atomically updates `public/fabric/edge.sh` to reference that release. If the version already exists, the command checks that the signed manifest and every artifact exactly match before refreshing the installer. Increment the agent version to publish changed binaries or service definitions. Run it before the Next.js production build so the static artifacts are included in the deployment.

The local workspace may use its ignored `.pki/edge-release-private.pem` for development builds. Before production, securely custody and back up the signing key. Rotating the key requires updating the pinned public key in `sdwan-edge/release/release-public.pem`, rebuilding the installer, and coordinating the deployed installer version. The installer verifies the manifest signature before trusting any binary or service checksum; HTTPS and a same-origin checksum alone are not the artifact trust mechanism. Keep the installer available to upgrade hosts compatible with the release signature and selected version.

## Recovery and status meaning

Installation is safe to retry. A valid enrolled identity is preserved and the installer performs an agent upgrade without prompting for a new token. A pending local key can retry enrollment with a replacement token and may be rebound to the explicitly supplied controller origin; its private key is retained. If the Controller consumed a token but the agent never received its certificate, retrying that token will fail; an admin may use **Reset enrollment** only while the device has never sent a heartbeat. This revokes the old certificate and issues a new token. Active identities cannot be rebound or reset through this recovery path.

Controller status is evidence-based: Pending has no enrolled identity; Enrolling has an identity but no heartbeat; Syncing has a fresh heartbeat but the latest desired revision is not acknowledged as received; Management connected requires a fresh heartbeat and a received acknowledgement for that revision. `received` means staged locally, not applied. Tunnel, BGP, forwarding, and routed reachability health remain unavailable until those data-plane functions and checks are implemented.

If systemd cannot start after a successful enrollment, the identity remains on disk so a retry can repair the service. If the token was consumed and no identity was received, use the admin recovery action. Do not erase `/var/lib/packetmotion` or disable TLS verification as a troubleshooting shortcut.

## Selected hub tunnel source increment

Source 0.2.0 adds saved multi-hub selection and a local WireGuard activation gate. Apply controller migrations through 0009 before deploying its UI/API. Existing signed installer/release 0.1.6 and the default unprivileged service remain management-only. See [activation, recovery and evidence limits](wireguard-tunnels.md). No automatic release or network activation is performed.

## Reusing a Debian appliance and diagnosing Pending

Archiving a dashboard entry revokes that entry's credentials and withdraws its desired peer plans. It does not remove `/var/lib/packetmotion/identity.json` or network recovery journals from the Debian appliance. Creating a new dashboard Edge creates a different device ID. The existing enrolled identity cannot enroll as that new ID automatically.

The updated installer accepts `--expected-node-id <dashboard-device-id>` in generated enrollment commands. It prints the existing local device ID. Signed release 0.3.2 and the updated installer offer an explicitly confirmed reset when that ID differs from the requested device; older selected releases cannot perform this reset. A piped enrollment token without an expected device ID also stops when an enrolled identity exists, preventing an old installer command from silently becoming an upgrade. An explicit upgrade without a token preserves the existing identity. The installer reports its current stage and systemd ActiveState/SubState/Result/ExecMainStatus; a successful service-start request is not proof of a heartbeat or synchronization.

For a Pending device, open its Overview → Connection check and refresh. The controller shows token availability/expiry, enrollment acceptance, last heartbeat, current revision receipt, certificate expiry and up to ten recent lifecycle events. No accepted enrollment means the controller cannot yet know which local installer or service failure occurred. Inspect the terminal output and the Debian journal:

```sh
sudo systemctl show fabric-agent -p ActiveState -p SubState -p Result -p ExecMainStatus
sudo journalctl -u fabric-agent -n 50 --no-pager
```

With a status-enabled source agent, compare identities and check controller authentication without applying configuration:

```sh
sudo -u packetmotion fabric-agent status --state-dir /var/lib/packetmotion --expected-node-id <dashboard-device-id> --check
```

Without `--check`, this command only reads local state. A mismatch performs no controller request and leaves identity/network files unchanged. `--check` makes one bounded desired-state GET (which the controller may record as delivery), does not stage/acknowledge/apply the response, and reports a safe result such as `reachable`, `unauthorized`, `dns_failed`, `tls_failed`, `connection_refused` or `timeout`. It does not inspect systemd or prove network health. Status output omits credentials and key material. Use the actual state directory if the local unit overrides the default.

Do not manually delete or move identity/network recovery files as an automatic fix: existing interfaces and LAN/FRR ownership can remain after archiving. Preserve these private files and use reviewed operator recovery with console access before replacing an appliance identity. Do not share identity files or enrollment tokens in diagnostic reports.

Dashboard/install-script changes require controller deployment. Timestamped agent operation logs, `status`, management-route wiring fixes and `reset-network` are packaged in signed release 0.3.2. Older immutable signed binaries are unchanged and may not recognize these commands. No new database migration is required by these diagnostics.

## Confirmed replacement enrollment (0.3.2)

Use the newly generated enrollment command for the replacement dashboard entry. If the default local identity differs from `--expected-node-id`, the installer downloads and verifies the signed reset-capable bundle, validates the effective service state directory and local override locations, and asks on `/dev/tty` for `RESET <old-node-id>`. Enter, other text, EOF or no controlling terminal cancels without consuming the token or stopping the service. Confirmation never reads from the piped enrollment-token stream. There is no unattended `--yes` reset. Same-identity/no-token upgrades retain their existing behavior.

The prompt covers removal of the old identity-owned network bundle and retirement of **all local overrides for fabric-agent.service** under `/etc/systemd/system/fabric-agent.service.d`, including the old lab binary override. It does not reset unrelated services, host management addressing/default routes, the global FRR configuration, foreign WireGuard interfaces or firewall tables. An active service using a different state directory, symlinked state/unit/override directory, or effective override outside the local service directory is refused for manual review. Installer processes serialize identity/service replacement through a root-private runtime flock.

After confirmation the installer enrolls a separate private staging identity, checks that its node ID matches the requested entry, and verifies authenticated controller access before stopping the old service. Token consumption at this stage is real: a later failure does not unconsume the token or revoke the new certificate. Its private staging directory is printed and preserved for recovery. Review pending/enrolling dashboard state before issuing another token; do not repeatedly delete staging identities.

After stopping the previous service, the installer snapshots the full old state, installed binary, service unit and local overrides under `/var/lib/packetmotion-backups/re-enroll.<random>` (root-only 0700 parent), and flushes that backup before network cleanup. The root-only signed `reset-network` command requires the exact old node ID plus a separate enrolled management identity. It reuses the network engine lock, validation, journal and rollback to remove only the old owned WireGuard/LAN/FRR bundle, verifies a fresh controller request, and deletes only the exact ownership-commented isolation table after no owned tunnel remains. Recovery may first restore an interrupted previous bundle; it never performs a host firewall/route flush. Missing required network tools, unsafe management/underlay ownership or unrecognized journals fail closed. Existing `ip`, `wg`, `nft` and, for routing cleanup, local FRR/vty access are required.

On success the cleaned old directory and retired overrides remain in the private backup, the new identity becomes `/var/lib/packetmotion`, and the signed default service runs `/usr/local/bin/fabric-agent` in **management-only mode**. Old WireGuard/routing opt-ins are deliberately retired, and must be reviewed anew before enabling tunnels for the replacement identity. Verify a fresh heartbeat and received revision on the new dashboard entry; service liveness or a successful status GET alone is not that evidence. Old controller entries/certificates are not archived/revoked by this local operation; do that separately in the dashboard when appropriate.

Failures after the snapshot attempt restore the old files/unit/binary/overrides and request restart only if the service was previously active. The failed/replacement state is retained privately. This file rollback does not prove kernel restoration or revive controller-revoked credentials; use console recovery if restart or network recovery fails. Backup/staging directories contain private keys and have no automatic retention/deletion policy. Keep them root-only and do not share them. Namespace tests and mocked installer transactions pass; a real Debian systemd replacement/reboot/failure canary remains UNVERIFIED. Deploy the updated controller installer and 0.3.2 assets together before using this workflow.

## Public-key registration fix (0.3.3)

Signed 0.3.3 registers the local WireGuard public key through the authenticated
management channel even when network apply is disabled. Earlier releases gated
registration on `--enable-wireguard`, leaving replacement management-only agents
connected but unable to save hub connections. Upgrade the existing identity using
the device page's **Upgrade agent** command and select 0.3.3; no new enrollment
token or identity reset is needed. Confirm the effective systemd ExecStart uses the
installed binary, then refresh the device page after management reconciliation.

The private key remains in the agent's private state directory and is reused.
Registration failures are retried and reported without preventing desired-state
staging/acknowledgement. Registration does not enable apply or prove connectivity.
Local apply still requires the reviewed service opt-in described in
[WireGuard operations](wireguard-tunnels.md). Live appliance upgrade and hub
connectivity remain UNVERIFIED until checked there.

## Local WireGuard activation after enrollment (0.3.6)

Enrollment and **Save draft → Deploy changes** do not grant local network privileges.
If Overlay reports **Local activation required**, use the appliance's console:

```sh
sudo fabric-agent network enable
sudo fabric-agent network status
```

Upgrade older agents through **Advanced → Agent upgrade → 0.3.6** first; preserve identity and
verify the effective service runs that installed binary. No re-enrollment is needed.
The command checks controller access and routes, installs a scoped local service
opt-in, and restarts the service with its existing paths/arguments. Check each peer;
only disabled peers need activation. The controller shows this tip only while a
current observation needs activation, and hides it once the device reports active.
It is intentionally not an extra enrollment prompt for healthy devices.
Read [activation, recovery and evidence limits](wireguard-tunnels.md#local-activation-gate)
before enabling. Receipt, apply, handshake and tunnel-IP reachability remain separate.

## Interface safe commit increment — 2026-10-22

Agent 0.4.0 adds current interface CIDRs and dedicated static LAN/VLAN safe apply through a locally authorized independent guard. Controller migrations 0022/0023 add candidates and immutable commit history; Underlay row actions offer Save and apply and Edit and retry. WAN/DHCP/gateway/advertisements remain blocked by this adapter, and forwarding stays isolated. Earlier metadata-only descriptions above describe the previous increment. See [interface operations](../operations/interface-management.md) for ownership, activation, recovery and evidence limits.
