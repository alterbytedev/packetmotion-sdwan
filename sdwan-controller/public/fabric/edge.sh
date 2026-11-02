#!/usr/bin/env bash
set -Eeuo pipefail
set +x
VERSION='0.4.0'
PUBLIC_KEY='-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfhP9C+VjuVmj0Bq77IBhT2kZ6gBwrHUpWgYv2g8ESTM=
-----END PUBLIC KEY-----'
CONTROLLER=''
ALLOW_LOCAL=0
SERVER_CA_SHA256=''
TOKEN_STDIN=0
REQUESTED_VERSION=''
EXPECTED_NODE_ID=''
ENABLE_WIREGUARD=1
STAGE=preflight
RESET_REQUIRED=0
RESET_ACTIVE=0
RESET_BACKUP=
RESET_STAGE=
RESET_WAS_ACTIVE=0
STATE_DIR=/var/lib/packetmotion
BIN=/usr/local/bin/fabric-agent
UNIT=/etc/systemd/system/fabric-agent.service
WORK=''
ENROLL_BIN=''
ENROLL_CA=''
progress() { STAGE=$1; printf 'PacketMotion installer: stage=%s\n' "$STAGE"; }
fail() { printf 'PacketMotion installer: stage=%s error=%s\n' "$STAGE" "$1" >&2; printf 'Check: sudo systemctl show fabric-agent -p ActiveState -p SubState -p Result -p ExecMainStatus; sudo journalctl -u fabric-agent -n 50 --no-pager\n' >&2; exit 1; }
check_existing_identity() {
  if [[ "$IDENTITY_STATE" == enrolled ]]; then
    printf 'Existing local identity: device=%s. Archiving a dashboard entry does not remove this identity.\n' "$IDENTITY_NODE_ID"
    if [[ -n "$EXPECTED_NODE_ID" && "${IDENTITY_NODE_ID,,}" != "${EXPECTED_NODE_ID,,}" ]]; then
      RESET_REQUIRED=1
      printf 'Existing identity differs; an explicit terminal reset confirmation will be required before replacement.\n'
      return
    fi
    if [[ $TOKEN_STDIN -eq 1 && -z "$EXPECTED_NODE_ID" ]]; then
      fail 'an enrolled identity already exists; a new token will not replace it. Use a device-specific enrollment command or run without --token-stdin to upgrade the existing identity'
    fi
    printf 'Continuing with the existing identity; no enrollment token will be consumed.\n'
  fi
}

read_enrollment_token() {
  if [[ $TOKEN_STDIN -eq 1 ]]; then
  IFS= read -r TOKEN || fail 'unable to read enrollment token from stdin'
  elif [[ -r /dev/tty ]]; then
  IFS= read -r -s -p 'Paste the one-time enrollment token from the dashboard (input hidden): ' TOKEN </dev/tty || fail 'unable to read enrollment token'
  printf '\n' >/dev/tty
  else
  fail 'no terminal available to prompt for the enrollment token; run from an interactive shell or add --token-stdin and pipe the token'
  fi
  [[ "$TOKEN" =~ ^pm_enroll_[a-f0-9]{64}$ ]] || { unset TOKEN; fail 'enrollment token format is invalid'; }
}
enroll_directory() {
  local destination=$1
  ARGS=(enroll --controller "$CONTROLLER" --state-dir "$destination")
  [[ $ALLOW_LOCAL -eq 0 ]] || ARGS+=(--allow-insecure-local)
  if [[ -n "$SERVER_CA_FILE" ]]; then
  ENROLL_CA="$destination/.fabric-server-ca-$$.crt"
  install -o packetmotion -g packetmotion -m 0600 "$SERVER_CA_FILE" "$ENROLL_CA"
  ARGS+=(--server-ca "$ENROLL_CA")
  fi
  ENROLL_BIN="$destination/.fabric-agent-enroll-$$"
  install -o packetmotion -g packetmotion -m 0700 "$WORK/$ASSET" "$ENROLL_BIN"
  if ! printf '%s\n' "$TOKEN" | runuser -u packetmotion -- "$ENROLL_BIN" "${ARGS[@]}" >/dev/null; then unset TOKEN; fail 'enrollment failed; no service was enabled'; fi
  rm -f -- "$ENROLL_BIN"
  ENROLL_BIN=''
  unset TOKEN
  if [[ -n "$ENROLL_CA" ]]; then rm -f -- "$ENROLL_CA"; ENROLL_CA=''; fi
}
read_reset_confirmation() {
  local answer
  read -r -p "Type RESET $IDENTITY_NODE_ID to continue (Enter cancels): " answer </dev/tty || return 1
  [[ "$answer" == "RESET $IDENTITY_NODE_ID" ]]
}
confirm_identity_reset() {
  printf 'Replace local device %s with dashboard device %s.\n' "$IDENTITY_NODE_ID" "$EXPECTED_NODE_ID"
  printf 'This stops fabric-agent, backs up its private state/unit/binary/local overrides, removes only the old identity-owned WireGuard/LAN/FRR/nftables configuration, and starts the replacement in management-only mode.\n'
  printf 'Host management addresses/default routes and unrelated networking are preserved. All local fabric-agent service overrides will be retired; networking opt-ins require a new local review.\n'
  read_reset_confirmation || fail 'reset cancelled; existing identity/service unchanged and token not consumed'
}
validate_reset_service() {
  local pid overrides path
  [[ ! -L "$STATE_DIR" && ! -L "$UNIT" && ! -L "$UNIT.d" ]] || fail 'symlinked state/unit/override directory requires manual recovery'
  overrides=$(systemctl --no-pager show fabric-agent.service -p DropInPaths --value) || fail 'cannot inspect service overrides'
  for path in $overrides; do
    [[ "$path" == "$UNIT.d/"*.conf ]] || fail 'an override outside the local fabric-agent directory requires manual recovery'
  done
  pid=$(systemctl --no-pager show fabric-agent.service -p MainPID --value) || fail 'cannot inspect running service'
  if [[ "$pid" =~ ^[1-9][0-9]*$ ]]; then
    if ! python3 - "$pid" "$STATE_DIR" <<'PYSERVICE'
import os,sys
args=open('/proc/'+sys.argv[1]+'/cmdline','rb').read().decode().split('\0')
if len(args)<2 or args[1]!='run': raise SystemExit(2)
values=[]
for i,arg in enumerate(args):
 if arg in ('--state-dir','-state-dir'):
  if i+1>=len(args): raise SystemExit(2)
  values.append(args[i+1])
 elif arg.startswith(('--state-dir=','-state-dir=')): values.append(arg.split('=',1)[1])
if len(values)>1 or os.path.realpath(values[0] if values else '/var/lib/packetmotion')!=os.path.realpath(sys.argv[2]): raise SystemExit(2)
PYSERVICE
    then fail 'running service uses a different state directory; reset refused'; fi
  fi
}
rollback_identity_reset() {
  printf 'Reset failed; restoring prior files. Private recovery backup: %s\n' "$RESET_BACKUP" >&2
  systemctl stop fabric-agent.service >/dev/null 2>&1 || return 1
  [[ ! -e "$STATE_DIR" ]] || { mv -- "$STATE_DIR" "$RESET_BACKUP/failed-state" || return 1; }
  cp -a -- "$RESET_BACKUP/state" "$STATE_DIR" || return 1
  [[ ! -e "$UNIT.d" ]] || { mv -- "$UNIT.d" "$RESET_BACKUP/failed-dropins" || return 1; }
  [[ ! -d "$RESET_BACKUP/dropins" ]] || { cp -a -- "$RESET_BACKUP/dropins" "$UNIT.d" || return 1; }
  if [[ -e "$RESET_BACKUP/unit" ]]; then cp -a -- "$RESET_BACKUP/unit" "$UNIT" || return 1; else rm -f -- "$UNIT" || return 1; fi
  if [[ -e "$RESET_BACKUP/binary" ]]; then cp -a -- "$RESET_BACKUP/binary" "$BIN" || return 1; else rm -f -- "$BIN" || return 1; fi
  systemctl daemon-reload || return 1
  if [[ $RESET_WAS_ACTIVE -eq 1 ]]; then
    systemctl start fabric-agent.service || return 1
  fi
  printf 'Prior credentials may already be revoked. File restoration is not proof of controller or network recovery.\n' >&2
}
interface_guard_reset_preflight() {
  [[ ! -e /etc/packetmotion/interface-policy.json && ! -L /etc/packetmotion/interface-policy.json && ! -e /var/lib/packetmotion-interfaces/confirmed.json && ! -e /var/lib/packetmotion-interfaces/pending.json ]] || fail 'interface guard ownership must be cleared and retired locally before replacing the device identity; preserve recovery journals'
  if systemctl is-active --quiet fabric-interface-guard.service; then
    fail 'stop and retire the interface guard after clearing applied settings before replacing the device identity'
  fi
}
replace_enrolled_identity() {
  progress reset-preflight
  interface_guard_reset_preflight
  "$WORK/$ASSET" reset-network --help >/dev/null 2>&1 || fail 'selected signed release lacks reset-network; select a reset-capable release'
  validate_reset_service
  progress reset-confirmation
  confirm_identity_reset
  RESET_STAGE=$(mktemp -d "${STATE_DIR}.enrollment.XXXXXXXX")
  chown packetmotion:packetmotion "$RESET_STAGE"
  chmod 0700 "$RESET_STAGE"
  printf 'Replacement enrollment state: %s (preserved on failure).\n' "$RESET_STAGE"
  progress replacement-enrollment
  read_enrollment_token
  enroll_directory "$RESET_STAGE"
  "$WORK/$ASSET" status --state-dir "$RESET_STAGE" --expected-node-id "$EXPECTED_NODE_ID" --check || fail 'replacement authentication failed; old service/state unchanged; replacement state preserved'
  progress backup-old-installation
  [[ ! -L "${STATE_DIR}-backups" ]] || fail 'backup directory cannot be a symlink'
  install -d -o root -g root -m 0700 "${STATE_DIR}-backups"
  RESET_BACKUP=$(mktemp -d "${STATE_DIR}-backups/re-enroll.XXXXXXXX")
  RESET_WAS_ACTIVE=0
  if systemctl is-active --quiet fabric-agent.service; then RESET_WAS_ACTIVE=1; fi
  systemctl stop fabric-agent.service || fail 'could not stop previous service; reset refused'
  # Snapshot after stopping the sole state writer. No cleanup starts before all copies succeed.
  if ! cp -a -- "$STATE_DIR" "$RESET_BACKUP/state" ||
     { [[ -e "$UNIT" ]] && ! cp -a -- "$UNIT" "$RESET_BACKUP/unit"; } ||
     { [[ -e "$BIN" ]] && ! cp -a -- "$BIN" "$RESET_BACKUP/binary"; } ||
     { [[ -d "$UNIT.d" ]] && ! cp -a -- "$UNIT.d" "$RESET_BACKUP/dropins"; } ||
     ! sync -f "$RESET_BACKUP"; then
    [[ $RESET_WAS_ACTIVE -eq 0 ]] || systemctl start fabric-agent.service || true
    fail 'backup failed; cleanup not attempted'
  fi
  RESET_ACTIVE=1
  printf 'Private rollback backup: %s\n' "$RESET_BACKUP"
  progress owned-network-cleanup
  "$WORK/$ASSET" reset-network --state-dir "$STATE_DIR" --management-state-dir "$RESET_STAGE" --confirm-node-id "$IDENTITY_NODE_ID" || fail 'owned cleanup failed; restoring previous files; replacement enrollment state preserved'
  mv -- "$STATE_DIR" "$RESET_BACKUP/cleaned-state"
  mv -- "$RESET_STAGE" "$STATE_DIR"
  RESET_STAGE=''
  [[ ! -d "$UNIT.d" ]] || mv -- "$UNIT.d" "$RESET_BACKUP/retired-dropins"
  install -o root -g root -m 0755 "$WORK/$ASSET" "$BIN"
  install -o root -g root -m 0644 "$WORK/fabric-agent.service" "$UNIT"
  progress replacement-service-start
  systemctl daemon-reload
  systemctl enable --now fabric-agent.service
  systemctl is-active --quiet fabric-agent.service || fail 'replacement service did not remain active'
  "$BIN" status --state-dir "$STATE_DIR" --expected-node-id "$EXPECTED_NODE_ID" --check || fail 'replacement controller authentication failed'
  RESET_ACTIVE=0
  systemctl --no-pager show fabric-agent.service -p ExecStart -p ActiveState -p SubState -p ExecMainStatus
  printf 'Replacement enrolled and service active in management-only mode. Verify fresh heartbeat/receipt in dashboard. Old owned network config was removed. Private backup: %s\n' "$RESET_BACKUP"
}

cleanup() {
  if [[ $RESET_ACTIVE -eq 1 ]]; then
    RESET_ACTIVE=0
    rollback_identity_reset || printf 'Automatic file rollback failed; preserve the private backup and use console recovery.\n' >&2
  fi
  [[ -z "$WORK" ]] || rm -rf -- "$WORK"
  [[ -z "$ENROLL_BIN" ]] || rm -f -- "$ENROLL_BIN"
  [[ -z "$ENROLL_CA" ]] || rm -f -- "$ENROLL_CA"
}
trap cleanup EXIT
# Local WireGuard opt-in, run on this appliance by the operator running the
# installer; on by default, skipped with --management-only. Failure never undoes enrollment or the upgrade: the
# management-only service stays running and the manual command is printed.
enable_wireguard() {
  [[ $ENABLE_WIREGUARD -eq 1 ]] || return 0
  progress wireguard-activation
  if ! printf '%s\n' "$SELECTED_VERSION" | python3 -c 'import sys;sys.exit(0 if tuple(map(int,sys.stdin.read().split(".")))>=(0,3,6) else 1)'; then
    printf 'WireGuard activation skipped: agent %s predates "network enable" (needs 0.3.6 or newer).\n' "$SELECTED_VERSION"
    return 0
  fi
  if "$BIN" network enable && "$BIN" network status; then return 0; fi
  printf 'WireGuard activation did not complete; the agent keeps running management-only. Fix the reported prerequisite (iproute2, wireguard-tools, nftables) and run: sudo fabric-agent network enable\n' >&2
}
trap 'fail "unexpected command failure; inspect the current stage and service status"' ERR
while (($#)); do
  case "$1" in
    --controller) (($# >= 2)) || fail 'missing controller URL'; CONTROLLER=$2; shift 2 ;;
    --allow-insecure-local) ALLOW_LOCAL=1; shift ;;
    --server-ca-sha256) (($# >= 2)) || fail 'missing server CA SHA-256 fingerprint'; SERVER_CA_SHA256=$2; shift 2 ;;
    --token-stdin) TOKEN_STDIN=1; shift ;;
    --expected-node-id) (($# >= 2)) || fail 'missing expected device ID'; EXPECTED_NODE_ID=$2; shift 2 ;;
    --enable-wireguard) ENABLE_WIREGUARD=1; shift ;; # default; accepted for older commands
    --management-only) ENABLE_WIREGUARD=0; shift ;;
    --version) (($# >= 2)) || fail 'missing agent version'; REQUESTED_VERSION=$2; shift 2 ;;
    *) fail 'unknown installer option' ;;
  esac
done
[[ $EUID -eq 0 ]] || fail 'run with sudo'
[[ "$(uname -s)" == Linux && -f /etc/debian_version ]] || fail 'this installer supports Debian Linux only'
[[ -n "$CONTROLLER" ]] || fail 'controller URL is required'
case "$CONTROLLER" in
  https://*) ;;
  http://*) [[ $ALLOW_LOCAL -eq 1 ]] || fail 'HTTP requires --allow-insecure-local and a private or loopback IP' ;;
  *) fail 'controller URL must use HTTPS' ;;
esac
CURL_PROTO=https
TLS_ARGS=(--tlsv1.2)
if [[ "$CONTROLLER" == http://* ]]; then CURL_PROTO=http; TLS_ARGS=(); fi
for tool in curl openssl python3 sha256sum systemctl runuser useradd update-ca-certificates flock; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || fail "required tool is missing: $tool"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq || fail 'unable to update Debian package metadata'
    apt-get install -y -qq ca-certificates curl openssl python3 coreutils systemd util-linux passwd || fail 'unable to install required Debian dependencies'
    break
  fi
done
for tool in curl openssl python3 sha256sum systemctl runuser useradd update-ca-certificates flock; do command -v "$tool" >/dev/null 2>&1 || fail "required tool is missing: $tool"; done
CONTROLLER=$(python3 - "$CONTROLLER" "$ALLOW_LOCAL" <<'PYURL'
import sys
from urllib.parse import urlsplit
u=urlsplit(sys.argv[1])
import ipaddress
try:
 host_ip=ipaddress.ip_address(u.hostname)
 private=(host_ip.is_loopback or (host_ip.version == 4 and any(host_ip in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'))) or (host_ip.version == 6 and host_ip in ipaddress.ip_network('fc00::/7')))
except ValueError:
 private=u.hostname == 'localhost'
if u.scheme not in ('https','http') or not u.hostname or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:
 raise SystemExit(2)
if u.scheme == 'http' and (not private or sys.argv[2] != '1'):
 raise SystemExit(2)
print(f'{u.scheme}://{u.netloc}')
PYURL
) || fail 'controller must be a valid origin; HTTP requires --allow-insecure-local and a private or loopback IP'
SERVER_CA_FILE=''
if [[ "$CONTROLLER" == http://* && -z "$SERVER_CA_SHA256" ]]; then
  if ! python3 - "$CONTROLLER" <<'PYLOOPBACK'
import ipaddress,sys
from urllib.parse import urlsplit
host=urlsplit(sys.argv[1]).hostname
try: loopback=ipaddress.ip_address(host).is_loopback
except ValueError: loopback=host == 'localhost'
raise SystemExit(0 if loopback else 1)
PYLOOPBACK
  then
    fail 'private-IP HTTP lab enrollment requires --server-ca-sha256 so HTTPS management can be trusted automatically'
  fi
fi
[[ -d /run/systemd/system ]] || fail 'systemd is required'
# Serialize identity/service replacement across installer processes.
[[ ! -L /run/packetmotion-installer ]] || fail 'installer lock directory cannot be a symlink'
install -d -o root -g root -m 0700 /run/packetmotion-installer
[[ ! -L /run/packetmotion-installer/install.lock ]] || fail 'installer lock cannot be a symlink'
exec 9>/run/packetmotion-installer/install.lock
flock -n 9 || fail 'another PacketMotion installer is already running'
# End installer lock.

[[ -z "$EXPECTED_NODE_ID" || "$EXPECTED_NODE_ID" =~ ^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$ ]] || fail 'expected device ID must be a UUID'
progress identity-check
IDENTITY_STATE=missing
IDENTITY_NODE_ID=
if [[ -e "$STATE_DIR/identity.json" ]]; then
  IDENTITY_STATE=$(python3 - "$STATE_DIR/identity.json" <<'PYIDENTITY'
import json,sys
try:
 data=json.load(open(sys.argv[1], encoding='utf-8'))
 print("enrolled" if data.get("nodeId") else "pending" if data.get("privateKey") else "invalid")
except Exception: print("invalid")
PYIDENTITY
)
fi
[[ "$IDENTITY_STATE" != invalid ]] || fail 'existing identity is invalid; preserve it and use operator recovery'
if [[ "$IDENTITY_STATE" == enrolled ]]; then
  IDENTITY_NODE_ID=$(python3 - "$STATE_DIR/identity.json" <<'PYNODE'
import json,re,sys
value=json.load(open(sys.argv[1],encoding='utf-8')).get('nodeId')
if not isinstance(value,str) or not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',value): raise SystemExit(2)
print(value)
PYNODE
) || fail 'existing device ID is invalid; preserve state and use operator recovery'
fi
check_existing_identity
progress release-download
ARCH=$(uname -m)
case "$ARCH" in x86_64|amd64) GOARCH=amd64;; aarch64|arm64) GOARCH=arm64;; *) fail 'unsupported Linux architecture';; esac
SELECTED_VERSION=${REQUESTED_VERSION:-$VERSION}
[[ "$SELECTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'agent version must use numeric major.minor.patch form'
BASE=${CONTROLLER%/}/fabric/releases/$SELECTED_VERSION
[[ -n "$WORK" ]] || WORK=$(mktemp -d)
chmod 0700 "$WORK"
curl --fail --silent --show-error --location --max-filesize 4096 --proto "=$CURL_PROTO" "${TLS_ARGS[@]}" "$BASE/manifest.json" -o "$WORK/manifest.json" || fail 'unable to download release manifest'
curl --fail --silent --show-error --location --max-filesize 1024 --proto "=$CURL_PROTO" "${TLS_ARGS[@]}" "$BASE/manifest.sig" -o "$WORK/manifest.sig" || fail 'unable to download manifest signature'
printf '%s\n' "$PUBLIC_KEY" > "$WORK/release-public.pem"
progress signature-verification
openssl pkeyutl -verify -pubin -inkey "$WORK/release-public.pem" -sigfile "$WORK/manifest.sig" -rawin -in "$WORK/manifest.json" >/dev/null 2>&1 || fail 'release manifest signature is invalid'
ASSET="fabric-agent-linux-$GOARCH"
EXPECTED=$(python3 - "$WORK/manifest.json" "$SELECTED_VERSION" "$ASSET" <<'PY'
import json,sys
data=json.load(open(sys.argv[1], encoding='utf-8'))
if data.get('version') != sys.argv[2]: raise SystemExit(2)
value=data.get('files',{}).get(sys.argv[3])
if not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value): raise SystemExit(2)
print(value)
PY
) || fail 'release manifest is invalid'
curl --fail --silent --show-error --location --max-filesize 52428800 --proto "=$CURL_PROTO" "${TLS_ARGS[@]}" "$BASE/$ASSET" -o "$WORK/$ASSET" || fail 'unable to download agent binary'
curl --fail --silent --show-error --location --max-filesize 8192 --proto "=$CURL_PROTO" "${TLS_ARGS[@]}" "$BASE/fabric-agent.service" -o "$WORK/fabric-agent.service" || fail 'unable to download service definition'
UNIT_HASH=$(python3 - "$WORK/manifest.json" <<'PYUNIT'
import json,sys
value=json.load(open(sys.argv[1], encoding='utf-8')).get('files',{}).get('fabric-agent.service')
if not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value): raise SystemExit(2)
print(value)
PYUNIT
) || fail 'service definition is not covered by the signed manifest'
printf '%s  %s\n' "$EXPECTED" "$WORK/$ASSET" | sha256sum --check --status || fail 'agent binary checksum does not match signed manifest'
printf '%s  %s\n' "$UNIT_HASH" "$WORK/fabric-agent.service" | sha256sum --check --status || fail 'service definition checksum does not match signed manifest'
if [[ -n "$SERVER_CA_SHA256" ]]; then
  EXPECTED_CA_SHA256=${SERVER_CA_SHA256//:/}
  [[ "$EXPECTED_CA_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]] || fail 'server CA fingerprint must be SHA-256 (64 hexadecimal characters)'
  EXPECTED_CA_SHA256=${EXPECTED_CA_SHA256^^}
  SERVER_CA_URL=$(python3 - "$CONTROLLER" <<'PYCAURL'
import sys
from urllib.parse import urlsplit, urlunsplit
u=urlsplit(sys.argv[1])
print(urlunsplit(('https',u.netloc,'/fabric/server-ca.crt','','')))
PYCAURL
)
  curl --fail --silent --show-error --location --max-filesize 16384 --proto '=https' --tlsv1.2 --insecure "$SERVER_CA_URL" -o "$WORK/server-ca.crt" || fail 'unable to download pinned server CA over HTTPS'
  openssl x509 -in "$WORK/server-ca.crt" -noout >/dev/null 2>&1 || fail 'downloaded server CA is not a valid PEM certificate'
  openssl x509 -in "$WORK/server-ca.crt" -noout -text | grep -q 'CA:TRUE' || fail 'downloaded server certificate is not a CA certificate'
  ACTUAL_CA_SHA256=$(openssl x509 -in "$WORK/server-ca.crt" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | tr '[:lower:]' '[:upper:]')
  [[ "$ACTUAL_CA_SHA256" == "$EXPECTED_CA_SHA256" ]] || fail 'server CA fingerprint does not match the controller-provided pin'
  SERVER_CA_FILE="$WORK/server-ca.crt"
  install -o root -g root -m 0644 "$SERVER_CA_FILE" /usr/local/share/ca-certificates/packetmotion-fabric-server-ca.crt || fail 'unable to install pinned server CA'
  update-ca-certificates >/dev/null || fail 'unable to update system CA trust store'
  printf 'Controller server CA fingerprint verified and installed.\n'
fi
chmod 0755 "$WORK/$ASSET"
"$WORK/$ASSET" version >/dev/null 2>&1 || fail 'downloaded agent binary failed its version check'
if ! id packetmotion >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/packetmotion --create-home --shell /usr/sbin/nologin packetmotion || fail 'unable to create agent service account'
fi
if [[ $RESET_REQUIRED -eq 0 ]]; then install -d -o packetmotion -g packetmotion -m 0700 "$STATE_DIR"; fi
install -d -o root -g root -m 0755 /usr/local/bin /etc/systemd/system
if [[ $RESET_REQUIRED -eq 1 ]]; then
  replace_enrolled_identity
  exit 0
fi
if [[ "$IDENTITY_STATE" == enrolled ]]; then
  OLD="$WORK/previous-agent"
  [[ ! -x "$BIN" ]] || cp -p "$BIN" "$OLD"
  progress service-upgrade
  systemctl stop fabric-agent.service >/dev/null 2>&1 || true
  install -o root -g root -m 0755 "$WORK/$ASSET" "$BIN.new"
  mv -f "$BIN.new" "$BIN"
  install -o root -g root -m 0644 "$WORK/fabric-agent.service" "$UNIT"
  systemctl daemon-reload
  if ! systemctl enable --now fabric-agent.service; then
    if [[ -x "$OLD" ]]; then install -o root -g root -m 0755 "$OLD" "$BIN"; systemctl daemon-reload; systemctl restart fabric-agent.service || true; fi
    fail 'agent upgrade could not start; previous binary was restored'
  fi
  systemctl show fabric-agent.service -p ActiveState -p SubState -p Result -p ExecMainStatus
  enable_wireguard
  printf 'PacketMotion agent %s upgrade requested; verify heartbeat on the existing dashboard device.\n' "$SELECTED_VERSION"
  exit 0
fi
progress enrollment
read_enrollment_token
enroll_directory "$STATE_DIR"
install -o root -g root -m 0755 "$WORK/$ASSET" "$BIN"
install -o root -g root -m 0644 "$WORK/fabric-agent.service" "$UNIT"
progress service-start
systemctl daemon-reload
if ! systemctl enable --now fabric-agent.service; then
  systemctl disable --now fabric-agent.service >/dev/null 2>&1 || true
  rm -f "$UNIT" "$BIN"
  fail 'agent enrollment completed but service could not start; identity is preserved for recovery'
fi
systemctl show fabric-agent.service -p ActiveState -p SubState -p Result -p ExecMainStatus
enable_wireguard
printf 'PacketMotion agent %s enrolled; service start requested. Verify a fresh heartbeat and configuration receipt in the dashboard.\n' "$SELECTED_VERSION"
