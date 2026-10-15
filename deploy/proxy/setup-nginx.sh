#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

HOST=192.168.160.200
UPSTREAM=127.0.0.1:3000
while (($#)); do
  case "$1" in
    --host) (($# >= 2)) || { echo 'Missing --host value.' >&2; exit 2; }; HOST=$2; shift 2 ;;
    --upstream) (($# >= 2)) || { echo 'Missing --upstream value.' >&2; exit 2; }; UPSTREAM=$2; shift 2 ;;
    --help|-h) echo 'Usage: sudo deploy/proxy/setup-nginx.sh [--host IP-or-DNS] [--upstream 127.0.0.1:3000]'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 && -f /etc/debian_version ]] || { echo 'Run as root on Debian.' >&2; exit 1; }
[[ "$UPSTREAM" =~ ^127\.0\.0\.1:[0-9]{1,5}$ ]] || { echo 'Upstream must be loopback IPv4:port.' >&2; exit 1; }
(( ${UPSTREAM##*:} > 0 && ${UPSTREAM##*:} <= 65535 )) || { echo 'Invalid upstream port.' >&2; exit 1; }
python3 - "$HOST" <<'PY'
import ipaddress, re, sys
try:
    ipaddress.ip_address(sys.argv[1])
except ValueError:
    if not re.fullmatch(r"(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*", sys.argv[1]):
        raise SystemExit('Host must be an IP address or DNS name without scheme/port.')
PY

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd -- "$HERE/../.." && pwd)
APP="$ROOT/sdwan-controller"
ENV_FILE="$APP/.env.local"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE." >&2; exit 1; }
if command -v ss >/dev/null && ss -H -ltn 'sport = :443' | grep -q .; then
  if [[ ! -f /etc/nginx/sites-available/packetmotion-fabric.conf ]] || \
    ! grep -q '^# Managed by PacketMotion Fabric setup-nginx.sh$' /etc/nginx/sites-available/packetmotion-fabric.conf; then
    echo 'TCP 443 is occupied by an unmanaged listener; refusing to replace it.' >&2; exit 1
  fi
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx openssl python3

BASE=/etc/packetmotion-fabric
PKI="$BASE/pki"
PUBLIC_CA=/var/lib/packetmotion-fabric/server-ca.crt
SITE=/etc/nginx/sites-available/packetmotion-fabric.conf
LINK=/etc/nginx/sites-enabled/packetmotion-fabric.conf
LIMITS=/etc/nginx/conf.d/packetmotion-fabric-limits.conf
SECRET_FILE="$BASE/proxy-secret"
mkdir -p "$PKI" /var/lib/packetmotion-fabric
chmod 0700 "$BASE" "$PKI"
chmod 0755 /var/lib/packetmotion-fabric

DEVICE_KEY="$PKI/device-ca.key"
DEVICE_CERT="$PKI/device-ca.crt"
if [[ ! -e "$DEVICE_KEY" && ! -e "$DEVICE_CERT" ]]; then
  (cd "$APP" && node scripts/init-device-ca.mjs "$PKI")
elif [[ ! -f "$DEVICE_KEY" || ! -f "$DEVICE_CERT" ]]; then
  echo 'Device CA files are incomplete; refusing to replace them.' >&2; exit 1
fi
chmod 0600 "$DEVICE_KEY" "$DEVICE_CERT"

SERVER_CA_KEY="$PKI/server-ca.key"
SERVER_CA="$PKI/server-ca.crt"
SERVER_KEY="$PKI/server.key"
SERVER_CERT="$PKI/server.crt"
if [[ ! -e "$SERVER_CA_KEY" && ! -e "$SERVER_CA" ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$SERVER_CA_KEY" 2>/dev/null
  openssl req -new -x509 -key "$SERVER_CA_KEY" -sha256 -days 3650 -subj '/CN=PacketMotion Lab Server CA' \
    -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' -out "$SERVER_CA"
elif [[ ! -f "$SERVER_CA_KEY" || ! -f "$SERVER_CA" ]]; then
  echo 'Server CA files are incomplete; refusing to replace them.' >&2; exit 1
fi
chmod 0600 "$SERVER_CA_KEY" "$SERVER_CA"

if [[ ! -e "$SERVER_KEY" && ! -e "$SERVER_CERT" ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$SERVER_KEY" 2>/dev/null
  openssl req -new -key "$SERVER_KEY" -subj "/CN=$HOST" -out "$PKI/server.csr"
  if python3 - "$HOST" <<'PY' >/dev/null 2>&1
import ipaddress, sys
ipaddress.ip_address(sys.argv[1])
PY
  then SAN="IP:$HOST"; else SAN="DNS:$HOST"; fi
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$SAN" > "$PKI/server.ext"
  openssl x509 -req -in "$PKI/server.csr" -CA "$SERVER_CA" -CAkey "$SERVER_CA_KEY" -CAcreateserial \
    -out "$SERVER_CERT" -days 825 -sha256 -extfile "$PKI/server.ext"
  chmod 0600 "$SERVER_KEY" "$SERVER_CERT"
  rm -f "$PKI/server.csr" "$PKI/server.ext" "$PKI/server-ca.srl"
elif [[ ! -f "$SERVER_KEY" || ! -f "$SERVER_CERT" ]]; then
  echo 'Server certificate files are incomplete; refusing to replace them.' >&2; exit 1
fi
if [[ "$HOST" =~ ^[0-9.]+$ ]]; then
  openssl x509 -in "$SERVER_CERT" -noout -checkip "$HOST" >/dev/null || { echo 'Existing TLS certificate does not cover --host.' >&2; exit 1; }
else
  openssl x509 -in "$SERVER_CERT" -noout -checkhost "$HOST" >/dev/null || { echo 'Existing TLS certificate does not cover --host.' >&2; exit 1; }
fi

if [[ ! -f "$SECRET_FILE" ]]; then openssl rand -hex 32 > "$SECRET_FILE"; fi
chmod 0600 "$SECRET_FILE"
PROXY_SECRET=$(cat "$SECRET_FILE")
[[ "$PROXY_SECRET" =~ ^[a-f0-9]{64,}$ ]] || { echo 'Existing proxy secret is invalid.' >&2; exit 1; }
install -o root -g root -m 0644 "$SERVER_CA" "$PUBLIC_CA"

for file in "$SITE" "$LIMITS"; do
  if [[ -e "$file" ]] && ! grep -q '^# Managed by PacketMotion Fabric setup-nginx.sh$' "$file"; then
    echo "$file already exists and is not managed by this script; refusing to overwrite it." >&2; exit 1
  fi
done
if [[ -e "$LINK" && ! -L "$LINK" ]]; then echo "$LINK is not a symlink; refusing to replace it." >&2; exit 1; fi

SITE_TMP=$(mktemp /etc/nginx/sites-available/.packetmotion.XXXXXX)
LIMITS_TMP=$(mktemp /etc/nginx/conf.d/.packetmotion.XXXXXX)
cat > "$LIMITS_TMP" <<'EOF'
# Managed by PacketMotion Fabric setup-nginx.sh
limit_req_zone $binary_remote_addr zone=packetmotion_enrollment:10m rate=5r/s;
EOF
cat > "$SITE_TMP" <<EOF
# Managed by PacketMotion Fabric setup-nginx.sh
server {
  listen 443 ssl;
  server_name $HOST;
  ssl_certificate $SERVER_CERT;
  ssl_certificate_key $SERVER_KEY;
  ssl_client_certificate $DEVICE_CERT;
  ssl_verify_client optional;
  ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 32k;
  client_body_timeout 15s;
  access_log off;

  location = /fabric/server-ca.crt {
    alias $PUBLIC_CA;
    default_type application/x-pem-file;
    add_header Cache-Control no-store;
  }
  location = /api/agent/v1/enroll {
    limit_req zone=packetmotion_enrollment burst=5 nodelay;
    proxy_pass http://$UPSTREAM;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Fabric-Proxy-Secret $PROXY_SECRET;
    proxy_set_header X-Fabric-Client-Serial "";
    proxy_set_header X-Fabric-Client-Verified "";
    proxy_set_header Cookie "";
  }
  location /api/agent/v1/ {
    if (\$ssl_client_verify != SUCCESS) { return 403; }
    proxy_pass http://$UPSTREAM;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Fabric-Proxy-Secret $PROXY_SECRET;
    proxy_set_header X-Fabric-Client-Serial \$ssl_client_serial;
    proxy_set_header X-Fabric-Client-Verified \$ssl_client_verify;
    proxy_set_header Cookie "";
  }
  location / {
    proxy_pass http://$UPSTREAM;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Fabric-Proxy-Secret "";
    proxy_set_header X-Fabric-Client-Serial "";
    proxy_set_header X-Fabric-Client-Verified "";
  }
}
EOF
chmod 0640 "$SITE_TMP" "$LIMITS_TMP"
mv -f "$SITE_TMP" "$SITE"
mv -f "$LIMITS_TMP" "$LIMITS"
ln -sfn "$SITE" "$LINK"
nginx -t

cp -p "$ENV_FILE" "$ENV_FILE.before-nginx-$(date +%Y%m%d%H%M%S)"
PROXY_SECRET="$PROXY_SECRET" ORIGIN="https://$HOST" DEVICE_CERT="$DEVICE_CERT" DEVICE_KEY="$DEVICE_KEY" \
python3 - "$ENV_FILE" <<'PY'
import os, re, sys
path=sys.argv[1]
values={
 "CONTROLLER_PUBLIC_ORIGIN":os.environ["ORIGIN"],
 "CONTROLLER_ENROLLMENT_URL":os.environ["ORIGIN"],
 "CONTROLLER_AGENT_URL":os.environ["ORIGIN"],
 "CONTROLLER_AGENT_PROXY_SECRET":os.environ["PROXY_SECRET"],
 "CONTROLLER_DEVICE_CA_CERT":os.environ["DEVICE_CERT"],
 "CONTROLLER_DEVICE_CA_KEY":os.environ["DEVICE_KEY"],
}
with open(path,encoding="utf-8") as f: lines=f.read().splitlines()
keys=set(values)
lines=[line for line in lines if not any(re.match(r"^\s*#?\s*"+re.escape(key)+r"=",line) for key in keys)]
lines.extend(f"{key}={value}" for key,value in values.items())
tmp=path+".packetmotion-tmp"
with open(tmp,"w",encoding="utf-8") as f: f.write("\n".join(lines)+"\n")
os.chmod(tmp,0o600); os.replace(tmp,path)
PY

if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl enable --now nginx; fi
FINGERPRINT=$(openssl x509 -in "$SERVER_CA" -noout -fingerprint -sha256 | cut -d= -f2)
echo 'NGINX HTTPS/mTLS is configured on TCP 443.'
echo "Controller origin: https://$HOST"
echo "Server CA SHA-256 fingerprint: $FINGERPRINT"
echo "Server CA download: https://$HOST/fabric/server-ca.crt"
echo "Controller environment updated at $ENV_FILE; restart Next.js to load it."
echo 'On pmedge, download the CA with curl -k, verify the displayed SHA-256 fingerprint, install it in /usr/local/share/ca-certificates, then run update-ca-certificates.'
echo 'Keep TCP 443 limited to the trusted lab. The server CA private key remains under /etc/packetmotion-fabric/pki.'
