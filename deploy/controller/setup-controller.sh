#!/usr/bin/env bash
# PacketMotion Fabric — controller node setup (Debian).
#
# Orchestrates what was previously a manual sequence: pick the serving interface/IP, choose
# lab or production, provision TLS, configure the NGINX HTTPS/mTLS ingress (deploy/proxy/setup-nginx.sh,
# which stays the single owner of NGINX, PKI and controller .env.local ingress keys), migrate the
# database, create the first superadmin and run the Next.js controller under systemd.
#
# Re-runnable. Never replaces existing CA material. --dry-run changes nothing.
set -Eeuo pipefail
set +x
umask 077

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd -- "$HERE/../.." && pwd)
APP="$ROOT/sdwan-controller"
ENV_FILE="$APP/.env.local"
BASE=/etc/packetmotion-fabric
PKI="$BASE/pki"
STATE_FILE="$BASE/controller-setup.conf"
SERVICE=packetmotion-controller
SERVICE_FILE="/etc/systemd/system/$SERVICE.service"
MANAGED_MARK='# Managed by PacketMotion Fabric setup-controller.sh'

MODE='' ADDRESS='' IFACE='' HOST='' TLS='' TLS_CERT='' TLS_KEY=''
RUN_AS='' PORT=3000 DATABASE_URL_ARG='' SETUP_POSTGRES=''  # SETUP_POSTGRES: ''=ask (lab), 1=yes, 0=no
PG_CONTAINER=sdwan-postgres PG_VOLUME=sdwan-postgres-data PG_DB=sdwan_controller
DB_HOST='' DB_PORT=5432 DB_NAME='' DB_USER='' DB_PASSWORD_FILE='' DB_SSLMODE='' DB_SSL_CA='' DB_PASSWORD=''
DRY_RUN=0 NON_INTERACTIVE=0 YES=0 SKIP_BUILD=0 ALLOW_UNTRUSTED_CHAIN=0 ALLOW_ROOT_SERVICE=0 HTTP_ENROLL=''

usage() {
  cat <<'EOF'
Usage: sudo deploy/controller/setup-controller.sh [options]

Run with no options for the interactive wizard. Options for unattended use:
  --mode lab|production        lab = isolated network, production = hardened defaults
  --interface IFACE            serving interface (use with --address when it has several IPs)
  --address IPv4               serving IP; NGINX listens only on it
  --host NAME                  DNS name or IP in the certificate and in every enrollment URL
                               (default: the serving IP). Production should use a DNS name.
  --tls private-ca|custom      private-ca = generated self-signed CA (agents pin its fingerprint)
                               custom     = public/enterprise certificate you supply
  --tls-cert FILE --tls-key FILE   PEM full chain (leaf first) and private key, for --tls custom
  --allow-untrusted-chain      accept a custom chain that the OS trust store cannot verify
                               (edges would then need that CA installed; onboarding may fail)
  --run-as USER                service account (default: packetmotion-controller; lab may use root)
  --allow-root-service         permit root service in production (not recommended)
  --port N                     loopback port for Next.js (default 3000)
  --database-url URL           complete PostgreSQL URL (percent-encode special characters yourself)
  --db-host H --db-port N --db-name D --db-user U
                               PostgreSQL connection fields; the script builds and encodes the URL
  --db-password-file FILE      read the password from FILE (or set FABRIC_DB_PASSWORD; else prompted)
  --db-sslmode disable|verify-full   TLS to PostgreSQL (default: verify-full for a remote host in
                               production, otherwise disable)
  --db-ssl-ca FILE             CA certificate for verify-full when the server uses a private CA
  (database options apply only when .env.local has no DATABASE_URL yet)
  --no-http-enroll             lab: disable the cleartext TCP 80 installer/enrollment listener
  --setup-postgres             lab only: install Docker and run PostgreSQL 17 in a container for you
  --no-setup-postgres          never offer to install Docker/PostgreSQL
  --skip-build                 reuse the existing production build
  --non-interactive            never prompt; every choice must come from options
  --yes                        accept the listed risks (required with --non-interactive when any)
  --dry-run                    scan, validate and print the plan; change nothing (no root needed)
  -h, --help
EOF
}

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }
need_value() { (($# >= 2)) || die "Missing value for $1."; }

while (($#)); do
  case "$1" in
    --mode) need_value "$@"; MODE=$2; shift 2 ;;
    --interface) need_value "$@"; IFACE=$2; shift 2 ;;
    --address) need_value "$@"; ADDRESS=$2; shift 2 ;;
    --host) need_value "$@"; HOST=$2; shift 2 ;;
    --tls) need_value "$@"; TLS=$2; shift 2 ;;
    --tls-cert) need_value "$@"; TLS_CERT=$2; shift 2 ;;
    --tls-key) need_value "$@"; TLS_KEY=$2; shift 2 ;;
    --allow-untrusted-chain) ALLOW_UNTRUSTED_CHAIN=1; shift ;;
    --run-as) need_value "$@"; RUN_AS=$2; shift 2 ;;
    --allow-root-service) ALLOW_ROOT_SERVICE=1; shift ;;
    --port) need_value "$@"; PORT=$2; shift 2 ;;
    --database-url) need_value "$@"; DATABASE_URL_ARG=$2; shift 2 ;;
    --db-host) need_value "$@"; DB_HOST=$2; shift 2 ;;
    --db-port) need_value "$@"; DB_PORT=$2; shift 2 ;;
    --db-name) need_value "$@"; DB_NAME=$2; shift 2 ;;
    --db-user) need_value "$@"; DB_USER=$2; shift 2 ;;
    --db-password-file) need_value "$@"; DB_PASSWORD_FILE=$2; shift 2 ;;
    --db-sslmode) need_value "$@"; DB_SSLMODE=$2; shift 2 ;;
    --db-ssl-ca) need_value "$@"; DB_SSL_CA=$2; shift 2 ;;
    --no-http-enroll) HTTP_ENROLL=0; shift ;;
    --setup-postgres) SETUP_POSTGRES=1; shift ;;
    --no-setup-postgres) SETUP_POSTGRES=0; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" ;;
  esac
done

[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && ((PORT > 0 && PORT <= 65535)) || die '--port must be 1-65535.'
[[ -z "$MODE" || "$MODE" == lab || "$MODE" == production ]] || die '--mode must be lab or production.'
[[ -z "$TLS" || "$TLS" == private-ca || "$TLS" == custom ]] || die '--tls must be private-ca or custom.'
[[ -f /etc/debian_version ]] || die 'This script supports Debian only.'
((DRY_RUN)) || [[ $EUID -eq 0 ]] || die 'Run as root (or use --dry-run).'
if ((NON_INTERACTIVE == 0)) && [[ ! -t 0 ]]; then die 'No terminal available; use --non-interactive with explicit options.'; fi
for tool in python3 openssl ip; do command -v "$tool" >/dev/null || die "Required tool is missing: $tool"; done

# ---------------------------------------------------------------- prompts
ask_choice() { # prompt default option...  -> echoes the chosen option
  local prompt=$1 default=$2; shift 2
  local reply
  if ((NON_INTERACTIVE)); then echo "$default"; return; fi
  while true; do
    read -r -p "$prompt [$default]: " reply </dev/tty || die 'Input closed.'
    reply=${reply:-$default}
    for option in "$@"; do [[ "$reply" == "$option" ]] && { echo "$reply"; return; }; done
    echo "  Choose one of: $*" >&2
  done
}
confirm() { # message -> 0 when accepted
  ((YES)) && return 0
  ((NON_INTERACTIVE)) && return 1
  local reply; read -r -p "$1 [y/N]: " reply </dev/tty || return 1
  [[ "$reply" =~ ^[Yy]$ ]]
}

# ------------------------------------------------- previous choices (re-run)
state_value() { [[ -f "$STATE_FILE" ]] && sed -n "s/^$1=//p" "$STATE_FILE" | head -n1 || true; }
PREV_HOST=$(state_value HOST); PREV_TLS=$(state_value TLS)
env_value() { [[ -f "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 || true; }
PREV_AGENT_URL=$(env_value CONTROLLER_AGENT_URL)

# ------------------------------------------------------ interface scan
# One line per IPv4: iface|ip|prefix|state|dynamic|kind|flags. FABRIC_SETUP_IP_JSON is a test hook.
scan_interfaces() {
  local json
  if [[ -n "${FABRIC_SETUP_IP_JSON:-}" ]]; then json=$(<"$FABRIC_SETUP_IP_JSON"); else json=$(ip -j -4 addr show); fi
  local default_dev=''
  if [[ -z "${FABRIC_SETUP_IP_JSON:-}" ]]; then
    default_dev=$(ip -j route get 1.1.1.1 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)[0].get("dev",""))' 2>/dev/null || true)
  else default_dev=${FABRIC_SETUP_DEFAULT_DEV:-}; fi
  DEFAULT_DEV=$default_dev python3 -c '
import ipaddress, json, os, re, sys
virtual = re.compile(r"^(docker|veth|br-|virbr|wg|wt|tun|tap|tailscale|zt|cni|flannel|kube)")
for link in json.load(sys.stdin):
    name = link["ifname"]
    for a in link.get("addr_info", []):
        ip = ipaddress.ip_address(a["local"])
        if ip.is_loopback or ip.is_link_local:
            continue
        if ip in ipaddress.ip_network("100.64.0.0/10"):
            kind = "overlay/CGNAT"
        elif any(ip in ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
            kind = "private"  # RFC 1918 only: ip.is_private also covers reserved/documentation ranges
        else:
            kind = "public"
        flags = []
        if name == os.environ["DEFAULT_DEV"]: flags.append("default-route")
        if virtual.match(name): flags.append("virtual")
        if a.get("dynamic"): flags.append("dhcp")
        print("|".join([name, str(ip), str(a["prefixlen"]), link.get("operstate", "UNKNOWN"), "1" if a.get("dynamic") else "0", kind, ",".join(flags)]))
' <<<"$json"
}

mapfile -t ROWS < <(scan_interfaces)
((${#ROWS[@]})) || die 'No usable global IPv4 address found on any interface.'

print_interfaces() {
  printf '\n  %-3s %-14s %-18s %-8s %-14s %s\n' '#' 'INTERFACE' 'ADDRESS' 'STATE' 'TYPE' 'NOTES'
  local i=1 row
  for row in "${ROWS[@]}"; do
    IFS='|' read -r n ip prefix state dyn kind flags <<<"$row"
    printf '  %-3s %-14s %-18s %-8s %-14s %s\n' "$i" "$n" "$ip/$prefix" "$state" "$kind" "${flags//,/, }"
    i=$((i + 1))
  done
  echo
}

row_for_address() { local row; for row in "${ROWS[@]}"; do [[ "$(cut -d'|' -f2 <<<"$row")" == "$1" ]] && { echo "$row"; return 0; }; done; return 1; }

SELECTED=''
if [[ -n "$ADDRESS" ]]; then
  SELECTED=$(row_for_address "$ADDRESS") || die "--address $ADDRESS is not assigned to any local interface."
  [[ -z "$IFACE" || "$IFACE" == "$(cut -d'|' -f1 <<<"$SELECTED")" ]] || die "--address $ADDRESS is not on interface $IFACE."
elif [[ -n "$IFACE" ]]; then
  mapfile -t on_iface < <(printf '%s\n' "${ROWS[@]}" | awk -F'|' -v n="$IFACE" '$1==n')
  ((${#on_iface[@]} == 1)) || die "Interface $IFACE has ${#on_iface[@]} usable addresses; pass --address."
  SELECTED=${on_iface[0]}
elif ((NON_INTERACTIVE)); then
  die 'Non-interactive mode needs --address (or --interface with a single address).'
else
  echo 'Detected interfaces and IPv4 addresses:'
  print_interfaces
  echo 'The controller listens only on the address you pick. Edges must be able to reach it there.'
  while [[ -z "$SELECTED" ]]; do
    read -r -p "Select the serving address [1-${#ROWS[@]}]: " choice </dev/tty || die 'Input closed.'
    [[ "$choice" =~ ^[0-9]+$ ]] && ((choice >= 1 && choice <= ${#ROWS[@]})) && SELECTED=${ROWS[choice - 1]} || echo '  Invalid selection.' >&2
  done
fi
IFS='|' read -r IFACE ADDRESS _prefix IF_STATE IF_DYNAMIC IF_KIND IF_FLAGS <<<"$SELECTED"

RISKS=()
BLOCKERS=()
[[ "$IF_STATE" == UP || "$IF_STATE" == UNKNOWN ]] || die "Interface $IFACE is $IF_STATE; bring it up first."
[[ ",$IF_FLAGS," != *,virtual,* ]] || RISKS+=("$IFACE looks like a virtual/overlay/container interface; edges on the underlay may not reach $ADDRESS.")
[[ "$IF_DYNAMIC" != 1 ]] || RISKS+=("$ADDRESS on $IFACE is DHCP-assigned. If it changes, the certificate, NGINX binding and every enrolled edge URL break. Reserve it or use a static address.")
[[ "$IF_KIND" != public ]] || RISKS+=("$ADDRESS is a public address: ensure a host/edge firewall allows only TCP 443 (and 80 for ACME/redirect) from intended networks.")

# --------------------------------------------------------- mode and TLS
if [[ -z "$MODE" ]]; then
  if ((NON_INTERACTIVE)); then die '--mode is required with --non-interactive.'; fi
  cat <<'EOF'

Deployment mode:
  lab         Isolated test network. Self-signed CA, optional cleartext TCP 80 installer/enrollment,
              service may run as root. Matches today's behaviour.
  production  No cleartext enrollment (TCP 80 only redirects), non-root service, certificate
              validation, and a DNS name is strongly recommended.
EOF
  MODE=$(ask_choice 'Mode (lab/production)' lab lab production)
fi

if [[ -z "$TLS" ]]; then
  if ((NON_INTERACTIVE)); then TLS=private-ca; else
    cat <<'EOF'

Server certificate:
  private-ca  Generate a self-signed CA + server certificate. Edges download the CA and verify its
              SHA-256 pin during install (existing mechanism). Fine for closed networks.
  custom      Supply a public (e.g. Let's Encrypt, commercial) or enterprise certificate and key.
              Edges use their OS trust store; no pin is published.
EOF
    default_tls=private-ca; [[ "$MODE" == production ]] && default_tls=custom
    TLS=$(ask_choice 'Certificate source (private-ca/custom)' "$default_tls" private-ca custom)
  fi
fi

if [[ "$TLS" == custom ]]; then
  if [[ -z "$TLS_CERT" && $NON_INTERACTIVE -eq 0 ]]; then read -r -p 'Path to PEM full chain (leaf first): ' TLS_CERT </dev/tty; fi
  if [[ -z "$TLS_KEY" && $NON_INTERACTIVE -eq 0 ]]; then read -r -p 'Path to PEM private key: ' TLS_KEY </dev/tty; fi
  [[ -f "$TLS_CERT" && -f "$TLS_KEY" ]] || die '--tls custom needs readable --tls-cert and --tls-key files.'
else
  [[ -z "$TLS_CERT$TLS_KEY" ]] || die '--tls-cert/--tls-key are only valid with --tls custom.'
fi

if [[ -z "$HOST" ]]; then
  if ((NON_INTERACTIVE)); then HOST=$ADDRESS; else
    [[ "$MODE" == production ]] && echo 'Production: use the DNS name edges will resolve. A name survives IP renumbering; an IP does not.'
    read -r -p "Controller host name or IP for certificate and URLs [${PREV_HOST:-$ADDRESS}]: " HOST </dev/tty
    HOST=${HOST:-${PREV_HOST:-$ADDRESS}}
  fi
fi
python3 - "$HOST" <<'PY' || die 'Host must be an IP address or DNS name without scheme or port.'
import ipaddress, re, sys
try:
    ipaddress.ip_address(sys.argv[1])
except ValueError:
    if not re.fullmatch(r"(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*", sys.argv[1]):
        raise SystemExit(1)
PY
HOST_IS_IP=0; python3 -c 'import ipaddress,sys; ipaddress.ip_address(sys.argv[1])' "$HOST" 2>/dev/null && HOST_IS_IP=1

# ------------------------------------------------ mode-dependent policy
if [[ "$MODE" == production ]]; then
  [[ -z "$HTTP_ENROLL" ]] || warn '--no-http-enroll is implied in production.'
  HTTP_ENROLL=0
  ((HOST_IS_IP)) && RISKS+=("Production is using an IP ($HOST) as its identity. Prefer a DNS name; changing the IP later orphans enrolled edges.")
  [[ "$TLS" == custom ]] || RISKS+=('Production with a self-signed CA: only suitable for closed networks; every new edge must be able to fetch /fabric/server-ca.crt and verify the pin.')
  if [[ -z "$RUN_AS" ]]; then RUN_AS=packetmotion-controller; fi
  if [[ "$RUN_AS" == root ]] && ((ALLOW_ROOT_SERVICE == 0)); then die 'Production refuses a root service; omit --run-as or pass --allow-root-service.'; fi
else
  HTTP_ENROLL=${HTTP_ENROLL:-1}
  [[ -n "$RUN_AS" ]] || RUN_AS=$([[ "$APP" == /root/* || "$APP" == /home/* ]] && echo root || echo packetmotion-controller)
  [[ "$HTTP_ENROLL" == 0 ]] || RISKS+=('Lab: TCP 80 sends one-use enrollment tokens and CSRs in cleartext. Keep this network isolated.')
fi
[[ "$RUN_AS" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die '--run-as is not a valid account name.'

# ------------------------------------------------ optional lab PostgreSQL
# Offered only when the controller has no database configured yet. Production databases are an
# operator decision (managed service, backups, hardening) and are never created by this script.
ENV_HAS_DB=0; [[ -n "$(env_value DATABASE_URL)" ]] && ENV_HAS_DB=1
DB_FIELDS=0; [[ -n "$DB_HOST$DB_NAME$DB_USER$DB_PASSWORD_FILE" ]] && DB_FIELDS=1
HAVE_DB=$ENV_HAS_DB; { [[ -n "$DATABASE_URL_ARG" ]] || ((DB_FIELDS)); } && HAVE_DB=1
if [[ "$SETUP_POSTGRES" == 1 && "$MODE" != lab ]]; then die '--setup-postgres is lab only; provision the production database yourself and pass --database-url.'; fi
if ((HAVE_DB)); then
  [[ "$SETUP_POSTGRES" != 1 ]] || die '--setup-postgres conflicts with an existing DATABASE_URL, --database-url or --db-* options.'
  SETUP_POSTGRES=0
elif [[ "$MODE" != lab ]]; then SETUP_POSTGRES=0
elif [[ -z "$SETUP_POSTGRES" ]]; then
  if ((NON_INTERACTIVE)); then SETUP_POSTGRES=0; else
    echo; echo 'No database is configured. This lab can install Docker and run PostgreSQL 17 in a container for you'
    echo "(container $PG_CONTAINER, data volume $PG_VOLUME, reachable on 127.0.0.1 only, random password)."
    SETUP_POSTGRES=$([[ "$(ask_choice 'Install Docker and PostgreSQL for me? (yes/no)' yes yes no)" == yes ]] && echo 1 || echo 0)
  fi
fi
if [[ "$SETUP_POSTGRES" == 1 ]]; then
  if command -v ss >/dev/null && ss -H -ltn 'sport = :5432' | grep -q .; then
    BLOCKERS+=("TCP 5432 is already in use. Point --database-url at that PostgreSQL, or free the port.")
  fi
  if command -v docker >/dev/null && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$PG_CONTAINER"; then
    BLOCKERS+=("A container named $PG_CONTAINER already exists but no DATABASE_URL is configured; its password is unknown. Pass --database-url or remove the container.")
  fi
fi

# --------------------------------------------- custom certificate checks
validate_custom_cert() {
  local cert=$1 key=$2
  openssl x509 -in "$cert" -noout >/dev/null 2>&1 || die "$cert is not a PEM certificate (leaf must be first)."
  [[ "$(openssl x509 -in "$cert" -noout -pubkey | openssl sha256)" == "$(openssl pkey -in "$key" -pubout 2>/dev/null | openssl sha256)" ]] \
    || die 'The private key does not match the certificate.'
  openssl x509 -in "$cert" -noout -checkend 0 >/dev/null || die 'The certificate has expired.'
  if ((HOST_IS_IP)); then openssl x509 -in "$cert" -noout -checkip "$HOST" >/dev/null || die "The certificate does not list IP $HOST in its SAN."
  else openssl x509 -in "$cert" -noout -checkhost "$HOST" >/dev/null || die "The certificate does not cover $HOST."; fi
  local text; text=$(openssl x509 -in "$cert" -noout -text)  # not piped: grep -q would SIGPIPE openssl under pipefail
  ! grep -q 'CA:TRUE' <<<"$text" || die 'The first certificate in the file is a CA, not a server leaf. Put the leaf first.'
  openssl x509 -in "$cert" -noout -checkend $((30 * 86400)) >/dev/null || RISKS+=('The certificate expires within 30 days; arrange renewal (replace the files and reload NGINX).')
  # Agents verify with the OS trust store, so an untrusted chain breaks enrollment and heartbeats.
  if ! openssl verify -untrusted "$cert" "$cert" >/dev/null 2>&1; then
    if ((ALLOW_UNTRUSTED_CHAIN)); then RISKS+=('The certificate chain does not verify against this host trust store; edges must trust the issuing CA or they cannot enroll.')
    else die 'The chain does not verify against the OS trust store (missing intermediates, or a private CA). Include intermediates in --tls-cert, or use --allow-untrusted-chain knowingly.'; fi
  fi
}
[[ "$TLS" != custom ]] || validate_custom_cert "$TLS_CERT" "$TLS_KEY"

# --------------------------------------------- impact on enrolled edges
NEW_ORIGIN="https://$HOST"
if [[ -n "$PREV_AGENT_URL" && "$PREV_AGENT_URL" != "$NEW_ORIGIN" ]]; then
  RISKS+=("Controller origin changes from $PREV_AGENT_URL to $NEW_ORIGIN. Enrolled edges keep the old URL in their identity and will lose management connectivity (agents do not follow redirects).")
fi
if [[ -n "$PREV_TLS" && "$PREV_TLS" != "$TLS" ]]; then
  if [[ "$TLS" == private-ca ]]; then RISKS+=('Switching from a custom to a private-CA certificate: already-enrolled edges that never stored this CA will reject it.')
  else RISKS+=('Switching to a custom certificate: the CA pin is withdrawn. Enrolled edges keep working if they trust the new issuer (public CAs are in Debian ca-certificates).'); fi
fi
# Hard stop: a leftover dev server would also answer the readiness probe and hide a failed start,
# and `next build` would overwrite the .next directory it is serving.
if command -v ss >/dev/null && ss -H -ltn "sport = :$PORT" | grep -q . && ! systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  BLOCKERS+=("TCP $PORT is already in use by another process (for example a development server). Stop it, or choose another --port.")
fi

# ------------------------------------------------- PostgreSQL connection
# Fields are collected separately and the URL is built here so special characters in the password
# are percent-encoded correctly and the password never appears on a command line.
DB_PLAN=''
if ((ENV_HAS_DB)); then
  DB_PLAN='existing DATABASE_URL in .env.local'
  { [[ -n "$DATABASE_URL_ARG" ]] || ((DB_FIELDS)); } && warn 'Database options ignored: .env.local already has a DATABASE_URL.'
elif [[ "$SETUP_POSTGRES" == 1 ]]; then
  DB_PLAN="install Docker if missing; PostgreSQL 17 container '$PG_CONTAINER' on 127.0.0.1:5432"
elif [[ -n "$DATABASE_URL_ARG" ]]; then
  [[ "$DATABASE_URL_ARG" =~ ^postgres(ql)?:// ]] || die 'DATABASE_URL must start with postgresql://'
  DB_PLAN='PostgreSQL URL supplied with --database-url (password not shown)'
elif ((DB_FIELDS == 0)) && ((NON_INTERACTIVE)); then
  BLOCKERS+=('No database is configured. Pass --database-url or --db-host/--db-user/--db-password-file (or --setup-postgres in a lab).')
  DB_PLAN='NOT CONFIGURED'
else
  if ((NON_INTERACTIVE == 0)); then
    echo; echo 'PostgreSQL connection (the controller needs an existing database; this script will not create it).'
    [[ -n "$DB_HOST" ]] || { read -r -p 'Host [127.0.0.1]: ' DB_HOST </dev/tty; DB_HOST=${DB_HOST:-127.0.0.1}; }
    read -r -p "Port [$DB_PORT]: " reply </dev/tty; DB_PORT=${reply:-$DB_PORT}
    [[ -n "$DB_NAME" ]] || { read -r -p 'Database [sdwan_controller]: ' DB_NAME </dev/tty; DB_NAME=${DB_NAME:-sdwan_controller}; }
    [[ -n "$DB_USER" ]] || { read -r -p 'User (a dedicated role, not postgres) [sdwan_controller]: ' DB_USER </dev/tty; DB_USER=${DB_USER:-sdwan_controller}; }
  fi
  DB_NAME=${DB_NAME:-sdwan_controller}
  [[ -n "$DB_HOST" && -n "$DB_USER" ]] || die '--db-host and --db-user are required.'
  [[ "$DB_HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]] || die 'Invalid --db-host (use a DNS name or IPv4 address).'
  [[ "$DB_PORT" =~ ^[0-9]{1,5}$ ]] && ((DB_PORT > 0 && DB_PORT <= 65535)) || die 'Invalid --db-port.'
  [[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || die 'Invalid --db-name (letters, digits, underscore).'
  [[ "$DB_USER" =~ ^[A-Za-z_][A-Za-z0-9_.-]{0,62}$ ]] || die 'Invalid --db-user.'
  if [[ -n "$DB_PASSWORD_FILE" ]]; then
    [[ -f "$DB_PASSWORD_FILE" ]] || die "--db-password-file $DB_PASSWORD_FILE not found."
    (( 8#$(stat -c %a "$DB_PASSWORD_FILE") & 8#077 )) && RISKS+=("$DB_PASSWORD_FILE is readable by group/others; use mode 0600 and delete it after setup.")
    DB_PASSWORD=$(<"$DB_PASSWORD_FILE")
  elif [[ -n "${FABRIC_DB_PASSWORD:-}" ]]; then DB_PASSWORD=$FABRIC_DB_PASSWORD
  elif ((NON_INTERACTIVE == 0)); then read -r -s -p 'Password: ' DB_PASSWORD </dev/tty; echo
  fi
  [[ -n "$DB_PASSWORD" ]] || die 'A database password is required (prompt, --db-password-file or FABRIC_DB_PASSWORD).'
  case "$DB_HOST" in localhost|127.*) DB_LOOPBACK=1 ;; *) DB_LOOPBACK=0 ;; esac
  if [[ -z "$DB_SSLMODE" ]]; then DB_SSLMODE=disable; [[ "$MODE" == production && $DB_LOOPBACK -eq 0 ]] && DB_SSLMODE=verify-full; fi
  [[ "$DB_SSLMODE" == disable || "$DB_SSLMODE" == verify-full ]] || die '--db-sslmode must be disable or verify-full.'
  [[ -z "$DB_SSL_CA" || -f "$DB_SSL_CA" ]] || die "--db-ssl-ca $DB_SSL_CA not found."
  if [[ "$DB_SSLMODE" == disable && $DB_LOOPBACK -eq 0 ]]; then
    RISKS+=("PostgreSQL traffic to $DB_HOST is not encrypted (password and data in cleartext). Use --db-sslmode verify-full.")
  fi
  [[ "$DB_USER" != postgres || "$MODE" != production ]] || RISKS+=('The controller would connect as the postgres superuser. Create a dedicated role that owns only its database.')
  DATABASE_URL_ARG=$(DB_HOST=$DB_HOST DB_PORT=$DB_PORT DB_NAME=$DB_NAME DB_USER=$DB_USER DB_PASSWORD=$DB_PASSWORD DB_SSLMODE=$DB_SSLMODE DB_SSL_CA=$DB_SSL_CA python3 -c '
import os
from urllib.parse import quote
e = os.environ
url = "postgresql://%s:%s@%s:%s/%s" % (quote(e["DB_USER"], safe=""), quote(e["DB_PASSWORD"], safe=""), e["DB_HOST"], e["DB_PORT"], quote(e["DB_NAME"], safe=""))
if e["DB_SSLMODE"] == "verify-full":
    url += "?sslmode=verify-full" + ("&sslrootcert=" + quote(e["DB_SSL_CA"], safe="") if e["DB_SSL_CA"] else "")
print(url)')
  DB_PLAN="PostgreSQL $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME, TLS $DB_SSLMODE (password not shown)"
fi

# -------------------------------------------------------------- the plan
cat <<EOF

Plan
  mode                 $MODE
  serving interface    $IFACE ($ADDRESS)  [$IF_KIND${IF_FLAGS:+; $IF_FLAGS}]
  controller identity  $NEW_ORIGIN
  certificate          $([[ "$TLS" == custom ]] && echo "operator supplied ($TLS_CERT)" || echo 'generated self-signed CA (agents pin the fingerprint)')
  TCP 443              NGINX on $ADDRESS: operator UI + mTLS agent API
  TCP 80               $([[ "$HTTP_ENROLL" == 1 ]] && echo "NGINX on $ADDRESS: lab installer/enrollment (cleartext)" || echo "NGINX on $ADDRESS: redirect to HTTPS only")
  Next.js              127.0.0.1:$PORT as '$RUN_AS' via systemd ($SERVICE)
  database             $DB_PLAN
EOF
if ((${#RISKS[@]})); then
  echo; echo 'Risks to accept:'; printf '  - %s\n' "${RISKS[@]}"
fi
if ((${#BLOCKERS[@]})); then
  echo; echo 'Blockers (apply will refuse until fixed):'; printf '  - %s\n' "${BLOCKERS[@]}"
fi
if ((DRY_RUN)); then echo; echo 'Dry run: nothing was changed.'; exit 0; fi
((${#BLOCKERS[@]} == 0)) || die 'Resolve the blockers above and re-run.'
echo
if ((${#RISKS[@]})); then confirm 'Accept these risks and continue?' || die 'Aborted. Resolve the risks or pass --yes.'; else confirm 'Apply this plan?' || { ((NON_INTERACTIVE)) || die 'Aborted.'; }; fi

# ------------------------------------------------------------- apply
NODE_BIN=$(command -v node || true); NPM_BIN=$(command -v npm || true)
[[ -n "$NODE_BIN" && -n "$NPM_BIN" ]] || die 'Node.js 22.12+ and npm are required (see sdwan-controller/.nvmrc).'
"$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' || die "Node.js $("$NODE_BIN" -v) is too old; 22.12.0 or newer is required."

command -v curl >/dev/null || die 'Required tool is missing: curl'
if [[ "$SETUP_POSTGRES" == 1 ]]; then
  info 'Docker and PostgreSQL (lab)'
  if ! command -v docker >/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq docker.io
  fi
  systemctl enable --now docker >/dev/null 2>&1 || die 'Docker did not start; check systemctl status docker.'
  PG_PASSWORD=$(openssl rand -hex 16)
  PG_ENV=$(mktemp); printf 'POSTGRES_PASSWORD=%s\nPOSTGRES_DB=%s\n' "$PG_PASSWORD" "$PG_DB" > "$PG_ENV"  # env-file keeps the password out of the process list
  docker volume inspect "$PG_VOLUME" >/dev/null 2>&1 || docker volume create "$PG_VOLUME" >/dev/null
  docker run -d --name "$PG_CONTAINER" --restart unless-stopped --env-file "$PG_ENV" \
    -p 127.0.0.1:5432:5432 -v "$PG_VOLUME:/var/lib/postgresql/data" postgres:17 >/dev/null || { rm -f "$PG_ENV"; die 'Could not start the PostgreSQL container.'; }
  rm -f "$PG_ENV"
  for _ in $(seq 1 60); do docker exec "$PG_CONTAINER" pg_isready -U postgres -d "$PG_DB" >/dev/null 2>&1 && break; sleep 1; done
  docker exec "$PG_CONTAINER" pg_isready -U postgres -d "$PG_DB" >/dev/null 2>&1 || die "PostgreSQL did not become ready; see docker logs $PG_CONTAINER."
  DATABASE_URL_ARG="postgresql://postgres:$PG_PASSWORD@127.0.0.1:5432/$PG_DB"
  echo "PostgreSQL is ready (container $PG_CONTAINER, 127.0.0.1:5432). The password is stored only in $ENV_FILE."
fi

info 'Dependencies'
cd "$APP"
[[ -d node_modules ]] || "$NPM_BIN" ci

info 'Database connectivity'
# Fails fast with a clear message, before anything is written or migrated.
DB_CHECK=$(DATABASE_URL=$([[ $ENV_HAS_DB -eq 1 ]] || echo "$DATABASE_URL_ARG") "$NODE_BIN" -e '
const { createRequire } = require("node:module");
if (!process.env.DATABASE_URL) createRequire(process.cwd() + "/")("@next/env").loadEnvConfig(process.cwd());
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
pool.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
  .then((r) => { console.log(r.rows[0] && r.rows[0].rolsuper ? "superuser" : "ok"); })
  .catch((e) => { console.error(String(e.code || e.message).replace(/postgres(ql)?:\/\/\S+/g, "<url>")); process.exitCode = 1; })
  .finally(() => pool.end());') || die "Cannot connect to PostgreSQL ($DB_CHECK). Check host, port, credentials, TLS and pg_hba.conf; nothing was changed."
[[ "$DB_CHECK" != superuser || "$MODE" != production ]] || warn 'The database user is a PostgreSQL superuser. Use a dedicated least-privilege role for production.'
echo 'PostgreSQL connection OK.'

info 'Controller configuration (.env.local)'
if [[ ! -f "$ENV_FILE" || $ENV_HAS_DB -eq 0 ]]; then
  [[ -n "$DATABASE_URL_ARG" ]] || {
    die 'No database is configured.'
  }
  [[ -f "$ENV_FILE" ]] || cp "$APP/.env.example" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  DATABASE_URL_VALUE=$DATABASE_URL_ARG python3 - "$ENV_FILE" <<'PY'
import os, sys
path = sys.argv[1]
lines = [l for l in open(path, encoding="utf-8").read().splitlines() if not l.startswith("DATABASE_URL=")]
lines.insert(0, "DATABASE_URL=" + os.environ["DATABASE_URL_VALUE"])
open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY
fi

info 'Migrations'
"$NPM_BIN" run migrate:auth
"$NPM_BIN" run migrate:controller

info 'Ingress, certificates and controller origin (deploy/proxy/setup-nginx.sh)'
NGINX_ARGS=(--host "$HOST" --upstream "127.0.0.1:$PORT" --listen "$ADDRESS")
[[ "$HTTP_ENROLL" == 1 ]] || NGINX_ARGS+=(--no-http-enroll)
if [[ "$TLS" == custom ]]; then
  # Copy to a stable root-owned location so renewal does not depend on the operator's path.
  install -d -m 0700 "$BASE" "$PKI/tls"
  install -m 0644 "$TLS_CERT" "$PKI/tls/server-public.crt"
  install -m 0600 "$TLS_KEY" "$PKI/tls/server-public.key"
  NGINX_ARGS+=(--tls-cert "$PKI/tls/server-public.crt" --tls-key "$PKI/tls/server-public.key")
elif [[ -f "$PKI/server.crt" ]]; then
  # A new host needs a new leaf; the server CA is kept so existing agent pins stay valid.
  if (( HOST_IS_IP )); then openssl x509 -in "$PKI/server.crt" -noout -checkip "$HOST" >/dev/null 2>&1 || NGINX_ARGS+=(--reissue-leaf)
  else openssl x509 -in "$PKI/server.crt" -noout -checkhost "$HOST" >/dev/null 2>&1 || NGINX_ARGS+=(--reissue-leaf); fi
fi
"$ROOT/deploy/proxy/setup-nginx.sh" "${NGINX_ARGS[@]}"

info 'First operator account'
HAS_OPERATOR=$("$NODE_BIN" -e '
const { createRequire } = require("node:module");
createRequire(process.cwd() + "/")("@next/env").loadEnvConfig(process.cwd());
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
pool.query("SELECT 1 FROM operators LIMIT 1").then((r) => console.log(r.rowCount ? "yes" : "no"))
  .catch(() => { console.log("unknown"); }).finally(() => pool.end());')
case "$HAS_OPERATOR" in
  no) echo 'Creating the first superadmin. The generated password is shown once.'; "$NPM_BIN" run init:superadmin ;;
  yes) echo 'An operator already exists; leaving credentials unchanged.' ;;
  *) warn 'Could not check operators; run npm run init:superadmin manually if no account exists.' ;;
esac

info 'Production build'
if ((SKIP_BUILD == 0)) || [[ ! -d "$APP/.next" ]]; then NODE_ENV=production "$NPM_BIN" run build; fi

info "Service account and permissions ($RUN_AS)"
if [[ "$RUN_AS" != root ]]; then
  id "$RUN_AS" >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$RUN_AS"
  # The app signs device certificates at runtime, so it needs the device CA (not the TLS keys).
  chgrp "$RUN_AS" "$BASE" "$PKI" "$ENV_FILE" "$PKI/device-ca.crt" "$PKI/device-ca.key"
  chmod 0750 "$BASE" "$PKI"; chmod 0640 "$ENV_FILE" "$PKI/device-ca.crt" "$PKI/device-ca.key"
  chown -R "$RUN_AS" "$APP/.next"
  runuser -u "$RUN_AS" -- test -r "$APP/package.json" && runuser -u "$RUN_AS" -- "$NODE_BIN" --version >/dev/null 2>&1 \
    || die "$RUN_AS cannot read $APP (parent directories such as /root are private) or run $NODE_BIN. Move the checkout to /opt/packetmotion-fabric or use --run-as root in a lab."
fi

info 'systemd units'
[[ ! -e "$SERVICE_FILE" ]] || grep -qxF "$MANAGED_MARK" "$SERVICE_FILE" || die "$SERVICE_FILE exists and is not managed by this script."
cat > "$SERVICE_FILE" <<EOF
$MANAGED_MARK
[Unit]
Description=PacketMotion Fabric controller (Next.js)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=$RUN_AS
WorkingDirectory=$APP
Environment=NODE_ENV=production
ExecStart=$NODE_BIN $APP/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port $PORT
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
EOF
# NGINX binds the selected address, so it must start after the interface has it.
install -d /etc/systemd/system/nginx.service.d
printf '%s\n[Unit]\nAfter=network-online.target\nWants=network-online.target\n' "$MANAGED_MARK" > /etc/systemd/system/nginx.service.d/packetmotion-network.conf
{ echo "MODE=$MODE"; echo "HOST=$HOST"; echo "ADDRESS=$ADDRESS"; echo "TLS=$TLS"; echo "RUN_AS=$RUN_AS"; } > "$STATE_FILE"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

info 'Verification'
ready=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/ready" 2>/dev/null; then ready=1; break; fi
  sleep 1
done
((ready)) || { journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true; die "Controller did not become ready on 127.0.0.1:$PORT (/api/ready checks PostgreSQL)."; }
CURL_TLS=()
[[ "$TLS" == private-ca ]] && CURL_TLS=(--cacert "$PKI/server-ca.crt")
RESOLVE=(--resolve "$HOST:443:$ADDRESS")
curl -fsS -o /dev/null "${CURL_TLS[@]}" "${RESOLVE[@]}" "https://$HOST/api/health" || die "HTTPS health check failed on https://$HOST (certificate or NGINX problem)."
code=$(curl -sS -o /dev/null -w '%{http_code}' "${CURL_TLS[@]}" "${RESOLVE[@]}" "https://$HOST/api/agent/v1/config" || true)
[[ "$code" == 403 ]] && echo 'Agent API correctly rejects a request without a device certificate (403).' || warn "Agent API probe returned HTTP $code (expected 403)."
curl -fsS -o /dev/null "${CURL_TLS[@]}" "${RESOLVE[@]}" "https://$HOST/fabric/edge.sh" && echo 'Edge installer is reachable over HTTPS.' || warn 'The edge installer was not reachable over HTTPS.'

cat <<EOF

Controller is up at $NEW_ORIGIN (listening on $ADDRESS).
  Allow: TCP 443 from operators and edges$([[ "$HTTP_ENROLL" == 1 ]] && echo '; TCP 80 from the isolated lab only' || echo '; TCP 80 only if you want the HTTP->HTTPS redirect').
  This script does not change any host firewall.
  Next: sign in, then Devices -> add a device; the generated enrollment command uses $NEW_ORIGIN$([[ "$TLS" == private-ca ]] && echo ' and the CA pin' || echo ' with the OS trust store').
  Logs: journalctl -u $SERVICE   Status: systemctl status $SERVICE
EOF
