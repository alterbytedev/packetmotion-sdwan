# Controller node installation

`deploy/controller/setup-controller.sh` provisions a Debian controller node end to end. It composes the existing pieces instead of replacing them: [`deploy/proxy/setup-nginx.sh`](../../deploy/proxy/README.md) remains the single owner of NGINX, the device/server CAs and the ingress keys in `sdwan-controller/.env.local`; the controller migrations and `init:superadmin` are the existing npm scripts.

```sh
sudo deploy/controller/setup-controller.sh --dry-run     # scan + plan, changes nothing
sudo deploy/controller/setup-controller.sh               # interactive wizard
```

## What it does

1. **Scans** every global IPv4 address (`ip -j -4 addr`), marking the default-route interface and flagging virtual/overlay, DHCP-assigned, CGNAT and public addresses. You choose the serving address; NGINX listens only on it.
2. **Mode** — `lab` or `production` (below).
3. **Certificate** — `private-ca` (generated self-signed CA, edges pin its SHA-256, the existing mechanism) or `custom` (public or enterprise certificate you supply).
4. Applies migrations (`migrate:auth`, `migrate:controller`), configures NGINX/PKI/`.env.local`, creates the first superadmin only when no operator exists, builds, and runs Next.js on `127.0.0.1:<port>` under systemd (`packetmotion-controller.service`).
5. **Verifies**: `/api/ready`, HTTPS health through the chosen address, that the agent API answers 403 without a device certificate, and that the installer is served over HTTPS.

## Modes

| | lab | production |
| --- | --- | --- |
| TCP 80 | optional cleartext installer/enrollment (today's behaviour) | redirect to HTTPS only |
| Service account | root allowed (checkout under `/root`) | dedicated non-root account; root needs `--allow-root-service` |
| Certificate | any | `custom` recommended; `private-ca` allowed for closed networks with a warning |
| Identity | IP or name | DNS name strongly recommended |

## PostgreSQL connection

When `.env.local` has no `DATABASE_URL`, the script collects the connection as separate fields (host, port, database, user, password; or `--db-host/--db-port/--db-name/--db-user`, `--db-password-file` or `FABRIC_DB_PASSWORD`) and builds the URL itself, percent-encoding special characters. `--database-url` remains for a ready-made URL. TLS is `disable` or `verify-full` (default `verify-full` for a remote host in production; `--db-ssl-ca` for a private CA). After `npm ci` and before anything is written or migrated, it runs `SELECT 1` and stops with a clear message on failure. Risks it asks you to accept: the `postgres` superuser in production, cleartext to a remote host, a group/world-readable password file. It also warns if the connected role is a superuser. The script never creates the database or role; create a dedicated role that owns only its database. The password appears only in `.env.local` (mode 0600). UNVERIFIED: the connection test and URL encoding against a real PostgreSQL.

## Lab PostgreSQL helper

In lab mode, when no `DATABASE_URL` exists yet (no `.env.local`, or none in it) and `--database-url` was not given, the wizard offers to set up the database (`--setup-postgres` / `--no-setup-postgres` for unattended runs). If accepted it installs `docker.io` from Debian if Docker is missing, then runs `postgres:17` as container `sdwan-postgres` (data volume `sdwan-postgres-data`, `--restart unless-stopped`) published on `127.0.0.1:5432` only, with a random password written only to `.env.local`. It refuses (plan blocker) when TCP 5432 is busy or a container of that name already exists, and is rejected in production, where backups, hardening and a least-privilege role are the operator's decision. UNVERIFIED: the Docker/PostgreSQL install path has not been run on a clean host.

## Certificates

* `private-ca`: unchanged flow. The CA is created once and never replaced; a new host reissues only the leaf (`--reissue-leaf`), so existing pins stay valid.
* `custom`: `--tls custom --tls-cert fullchain.pem --tls-key key.pem`. The script checks key/certificate match, expiry (warns under 30 days), that the SAN covers the host, that the first certificate is a leaf, and that the chain verifies against the OS trust store. Edges use the OS trust store, so an untrusted chain would break onboarding; it is refused unless `--allow-untrusted-chain`. The files are copied to `/etc/packetmotion-fabric/pki/tls/`. `CONTROLLER_AGENT_CA_SHA256` is removed from `.env.local` so Devices stops issuing pinned commands. Renew by re-running with the new files (or replacing them and `systemctl reload nginx`); enrolled agents are unaffected.

## Effect on edge onboarding and enrolled edges

* Enrollment commands are generated from `CONTROLLER_ENROLLMENT_URL` and `CONTROLLER_AGENT_CA_SHA256`; the script writes both consistently for the chosen certificate source.
* The agent appends a pinned CA to the system trust store, so moving a controller from `private-ca` to a public certificate keeps enrolled edges working. The reverse does not for edges that never stored the CA.
* Agents store the controller URL and do not follow redirects. Changing the host or IP orphans enrolled edges; the script lists this as a risk to accept. Use a stable DNS name.
* Production disables TCP 80 enrollment. If **Settings → Insecure HTTP lab controllers** still lists the host, Devices would generate `http://` commands that fail; remove the entry.

## Not covered

No firewall changes (allow TCP 443; TCP 80 only for lab or the redirect). Production never installs PostgreSQL: supply `--database-url` or an existing `.env.local`. Automated ACME/Let's Encrypt issuance and renewal are not implemented. The script refuses to run when the Next.js port is already held by another process (for example a dev server). Verified: syntax, dry-run planning, certificate validation and NGINX rendering by automated tests (`tests/controller-setup.test.mjs`). UNVERIFIED: an actual install on a clean Debian host, systemd service behaviour, non-root service permissions, and edge onboarding through a public certificate.
