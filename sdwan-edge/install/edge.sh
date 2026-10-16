#!/usr/bin/env bash
set -Eeuo pipefail
set +x
VERSION='@@VERSION@@'
PUBLIC_KEY='@@PUBLIC_KEY@@'
CONTROLLER=''
ALLOW_LOCAL=0
SERVER_CA_SHA256=''
TOKEN_STDIN=0
STATE_DIR=/var/lib/packetmotion
BIN=/usr/local/bin/fabric-agent
UNIT=/etc/systemd/system/fabric-agent.service
WORK=''
ENROLL_BIN=''
ENROLL_CA=''
fail() { printf 'PacketMotion installer: %s\n' "$1" >&2; exit 1; }
cleanup() {
  [[ -z "$WORK" ]] || rm -rf -- "$WORK"
  [[ -z "$ENROLL_BIN" ]] || rm -f -- "$ENROLL_BIN"
  [[ -z "$ENROLL_CA" ]] || rm -f -- "$ENROLL_CA"
}
trap cleanup EXIT
while (($#)); do
  case "$1" in
    --controller) (($# >= 2)) || fail 'missing controller URL'; CONTROLLER=$2; shift 2 ;;
    --allow-insecure-local) ALLOW_LOCAL=1; shift ;;
    --server-ca-sha256) (($# >= 2)) || fail 'missing server CA SHA-256 fingerprint'; SERVER_CA_SHA256=$2; shift 2 ;;
    --token-stdin) TOKEN_STDIN=1; shift ;;
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
for tool in curl openssl python3 sha256sum systemctl runuser useradd update-ca-certificates; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || fail "required tool is missing: $tool"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq || fail 'unable to update Debian package metadata'
    apt-get install -y -qq ca-certificates curl openssl python3 coreutils systemd util-linux passwd || fail 'unable to install required Debian dependencies'
    break
  fi
done
for tool in curl openssl python3 sha256sum systemctl runuser useradd update-ca-certificates; do command -v "$tool" >/dev/null 2>&1 || fail "required tool is missing: $tool"; done
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
ARCH=$(uname -m)
case "$ARCH" in x86_64|amd64) GOARCH=amd64;; aarch64|arm64) GOARCH=arm64;; *) fail 'unsupported Linux architecture';; esac
BASE=${CONTROLLER%/}/fabric/releases/$VERSION
[[ -n "$WORK" ]] || WORK=$(mktemp -d)
chmod 0700 "$WORK"
curl --fail --silent --show-error --location --max-filesize 4096 --proto "=$CURL_PROTO" "${TLS_ARGS[@]}" "$BASE/manifest.json" -o "$WORK/manifest.json" || fail 'unable to download release manifest'
curl --fail --silent --show-error --location --max-filesize 1024 --proto "=$CURL_PROTO" "${TLS_ARGS[@]}" "$BASE/manifest.sig" -o "$WORK/manifest.sig" || fail 'unable to download manifest signature'
printf '%s\n' "$PUBLIC_KEY" > "$WORK/release-public.pem"
openssl pkeyutl -verify -pubin -inkey "$WORK/release-public.pem" -sigfile "$WORK/manifest.sig" -rawin -in "$WORK/manifest.json" >/dev/null 2>&1 || fail 'release manifest signature is invalid'
ASSET="fabric-agent-linux-$GOARCH"
EXPECTED=$(python3 - "$WORK/manifest.json" "$VERSION" "$ASSET" <<'PY'
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
install -d -o packetmotion -g packetmotion -m 0700 "$STATE_DIR"
install -d -o root -g root -m 0755 /usr/local/bin /etc/systemd/system
IDENTITY_STATE=missing
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
  OLD="$WORK/previous-agent"
  [[ ! -x "$BIN" ]] || cp -p "$BIN" "$OLD"
  systemctl stop fabric-agent.service >/dev/null 2>&1 || true
  install -o root -g root -m 0755 "$WORK/$ASSET" "$BIN.new"
  mv -f "$BIN.new" "$BIN"
  install -o root -g root -m 0644 "$WORK/fabric-agent.service" "$UNIT"
  systemctl daemon-reload
  if ! systemctl enable --now fabric-agent.service; then
    if [[ -x "$OLD" ]]; then install -o root -g root -m 0755 "$OLD" "$BIN"; systemctl daemon-reload; systemctl restart fabric-agent.service || true; fi
    fail 'agent upgrade could not start; previous binary was restored'
  fi
  printf 'PacketMotion agent upgraded and running.\n'
  exit 0
fi
if [[ $TOKEN_STDIN -eq 1 ]]; then
  IFS= read -r TOKEN || fail 'unable to read enrollment token from stdin'
elif [[ -r /dev/tty ]]; then
  IFS= read -r -s -p 'Enrollment token: ' TOKEN </dev/tty || fail 'unable to read enrollment token'
  printf '\n' >/dev/tty
else
  fail 'interactive terminal required to enter enrollment token'
fi
[[ "$TOKEN" =~ ^pm_enroll_[a-f0-9]{64}$ ]] || { unset TOKEN; fail 'enrollment token format is invalid'; }
ARGS=(enroll --controller "$CONTROLLER" --state-dir "$STATE_DIR")
[[ $ALLOW_LOCAL -eq 0 ]] || ARGS+=(--allow-insecure-local)
if [[ -n "$SERVER_CA_FILE" ]]; then
  ENROLL_CA="$STATE_DIR/.fabric-server-ca-$$.crt"
  install -o packetmotion -g packetmotion -m 0600 "$SERVER_CA_FILE" "$ENROLL_CA"
  ARGS+=(--server-ca "$ENROLL_CA")
fi
ENROLL_BIN="$STATE_DIR/.fabric-agent-enroll-$$"
install -o packetmotion -g packetmotion -m 0700 "$WORK/$ASSET" "$ENROLL_BIN"
if ! printf '%s\n' "$TOKEN" | runuser -u packetmotion -- "$ENROLL_BIN" "${ARGS[@]}" >/dev/null; then unset TOKEN; fail 'enrollment failed; no service was enabled'; fi
rm -f -- "$ENROLL_BIN"
ENROLL_BIN=''
unset TOKEN
install -o root -g root -m 0755 "$WORK/$ASSET" "$BIN"
install -o root -g root -m 0644 "$WORK/fabric-agent.service" "$UNIT"
systemctl daemon-reload
if ! systemctl enable --now fabric-agent.service; then
  systemctl disable --now fabric-agent.service >/dev/null 2>&1 || true
  rm -f "$UNIT" "$BIN"
  fail 'agent enrollment completed but service could not start; identity is preserved for recovery'
fi
printf 'PacketMotion agent enrolled and running. Configuration will synchronize over HTTPS.\n'
