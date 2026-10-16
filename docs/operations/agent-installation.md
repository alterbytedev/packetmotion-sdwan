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

The Debian lab NGINX bootstrap exposes HTTP on port 80 for the installer, signed release artifacts, and one-time enrollment endpoint only. This lets a device submit its token and CSR through the trusted proxy without TLS, but the management channel uses the configured HTTPS `CONTROLLER_AGENT_URL`. The generated lab command includes the controller server-CA SHA-256 fingerprint. The installer fetches the CA over HTTPS, verifies that pin, installs the CA in Debian's trust store, and saves it with the agent identity before enrolling; one copy/paste command then enrolls and starts management without a separate certificate command. Never trust a CA fetched over HTTP or skip the fingerprint check. Do not expose port 80 outside an isolated lab. Public addresses and hostnames still require HTTPS with a certificate trusted by the Debian host.

## Building and publishing artifacts

Use Go 1.27.2 and OpenSSL with the repository's pinned Ed25519 release public key. Supply the matching release private key through a protected path; never commit or place it under the public directory.

```sh
cd sdwan-controller
FABRIC_RELEASE_SIGNING_KEY=/secure/path/fabric-release-private.pem npm run build:agent-release
npm run build
```

The release command cross-compiles static Linux `amd64` and `arm64` binaries, creates a manifest containing their SHA-256 digests and the systemd unit digest, signs the manifest, verifies the signature, and publishes immutable versioned files under `sdwan-controller/public/fabric/releases/<version>/`. It atomically updates `public/fabric/edge.sh` to reference that release. If the version already exists, the command checks that the signed manifest and every artifact exactly match before refreshing the installer. Increment the agent version to publish changed binaries or service definitions. Run it before the Next.js production build so the static artifacts are included in the deployment.

The local workspace may use its ignored `.pki/edge-release-private.pem` for development builds. Before production, securely custody and back up the signing key. Rotating the key requires updating the pinned public key in `sdwan-edge/release/release-public.pem`, rebuilding the installer, and coordinating the deployed installer version. The installer verifies the manifest signature before trusting any binary or service checksum; HTTPS and a same-origin checksum alone are not the artifact trust mechanism.

## Recovery and status meaning

Installation is safe to retry. A valid enrolled identity is preserved and the installer performs an agent upgrade without prompting for a new token. A pending local key can retry enrollment with a replacement token and may be rebound to the explicitly supplied controller origin; its private key is retained. If the Controller consumed a token but the agent never received its certificate, retrying that token will fail; an admin may use **Reset enrollment** only while the device has never sent a heartbeat. This revokes the old certificate and issues a new token. Active identities cannot be rebound or reset through this recovery path.

Controller status is evidence-based: Pending has no enrolled identity; Enrolling has an identity but no heartbeat; Syncing has a fresh heartbeat but the latest desired revision is not acknowledged as received; Management connected requires a fresh heartbeat and a received acknowledgement for that revision. `received` means staged locally, not applied. Tunnel, BGP, forwarding, and routed reachability health remain unavailable until those data-plane functions and checks are implemented.

If systemd cannot start after a successful enrollment, the identity remains on disk so a retry can repair the service. If the token was consumed and no identity was received, use the admin recovery action. Do not erase `/var/lib/packetmotion` or disable TLS verification as a troubleshooting shortcut.

## Selected hub tunnel source increment

Source 0.2.0 adds saved multi-hub selection and a local WireGuard activation gate. Apply controller migrations through 0009 before deploying its UI/API. Existing signed installer/release 0.1.6 and the default unprivileged service remain management-only. See [activation, recovery and evidence limits](wireguard-tunnels.md). No automatic release or network activation is performed.
