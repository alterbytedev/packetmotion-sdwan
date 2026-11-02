#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

HOST=192.168.160.200
UPSTREAM=127.0.0.1:3000
LISTEN=''          # empty keeps the historical wildcard listeners
TLS_CERT=''        # empty keeps the generated lab server CA flow
TLS_KEY=''
HTTP_ENROLL=1      # 0 = TCP 80 only redirects to HTTPS (production)
REISSUE_LEAF=0     # replace only the server leaf; the server CA (and agent pins) stay
while (($#)); do
  case "$1" in
    --host) (($# >= 2)) || { echo 'Missing --host value.' >&2; exit 2; }; HOST=$2; shift 2 ;;
    --upstream) (($# >= 2)) || { echo 'Missing --upstream value.' >&2; exit 2; }; UPSTREAM=$2; shift 2 ;;
    --listen) (($# >= 2)) || { echo 'Missing --listen value.' >&2; exit 2; }; LISTEN=$2; shift 2 ;;
    --tls-cert) (($# >= 2)) || { echo 'Missing --tls-cert value.' >&2; exit 2; }; TLS_CERT=$2; shift 2 ;;
    --tls-key) (($# >= 2)) || { echo 'Missing --tls-key value.' >&2; exit 2; }; TLS_KEY=$2; shift 2 ;;
    --no-http-enroll) HTTP_ENROLL=0; shift ;;
    --reissue-leaf) REISSUE_LEAF=1; shift ;;
    --help|-h) echo 'Usage: sudo deploy/proxy/setup-nginx.sh [--host IP-or-DNS] [--upstream 127.0.0.1:3000] [--listen IPv4] [--tls-cert FULLCHAIN --tls-key KEY] [--no-http-enroll] [--reissue-leaf]'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 && -f /etc/debian_version ]] || { echo 'Run as root on Debian.' >&2; exit 1; }
[[ "$UPSTREAM" =~ ^127\.0\.0\.1:[0-9]{1,5}$ ]] || { echo 'Upstream must be loopback IPv4:port.' >&2; exit 1; }
(( ${UPSTREAM##*:} > 0 && ${UPSTREAM##*:} <= 65535 )) || { echo 'Invalid upstream port.' >&2; exit 1; }
if [[ -n "$LISTEN" ]]; then
  python3 -c 'import ipaddress,sys; ipaddress.IPv4Address(sys.argv[1])' "$LISTEN" 2>/dev/null || { echo '--listen must be an IPv4 address.' >&2; exit 1; }
fi
if [[ -n "$TLS_CERT$TLS_KEY" ]]; then
  [[ -f "$TLS_CERT" && -f "$TLS_KEY" ]] || { echo '--tls-cert and --tls-key must both name existing files.' >&2; exit 1; }
fi
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

if [[ -n "$TLS_CERT" ]]; then
  # Operator-supplied (public or enterprise) certificate: no local server CA, so agents use the OS trust store.
  SERVER_CERT=$TLS_CERT; SERVER_KEY=$TLS_KEY; SERVER_CA=""
  openssl x509 -in "$SERVER_CERT" -noout >/dev/null 2>&1 || { echo "--tls-cert is not a valid PEM certificate." >&2; exit 1; }
  [[ "$(openssl x509 -in "$SERVER_CERT" -noout -pubkey | openssl sha256)" == "$(openssl pkey -in "$SERVER_KEY" -pubout 2>/dev/null | openssl sha256)" ]] || { echo "--tls-key does not match --tls-cert." >&2; exit 1; }
  if [[ "$HOST" =~ ^[0-9.]+$ ]]; then openssl x509 -in "$SERVER_CERT" -noout -checkip "$HOST" >/dev/null || { echo "TLS certificate does not cover --host." >&2; exit 1; }
  else openssl x509 -in "$SERVER_CERT" -noout -checkhost "$HOST" >/dev/null || { echo "TLS certificate does not cover --host." >&2; exit 1; }; fi
else
  if (( REISSUE_LEAF )) && [[ -e "$PKI/server.crt" || -e "$PKI/server.key" ]]; then
    stamp=$(date +%Y%m%d%H%M%S); mv -f "$PKI/server.crt" "$PKI/server.crt.old-$stamp" 2>/dev/null || true; mv -f "$PKI/server.key" "$PKI/server.key.old-$stamp" 2>/dev/null || true
  fi
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
    if python3 -c 'import ipaddress,sys; ipaddress.ip_address(sys.argv[1])' "$HOST" >/dev/null 2>&1
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
fi

if [[ ! -f "$SECRET_FILE" ]]; then openssl rand -hex 32 > "$SECRET_FILE"; fi
chmod 0600 "$SECRET_FILE"
PROXY_SECRET=$(cat "$SECRET_FILE")
[[ "$PROXY_SECRET" =~ ^[a-f0-9]{64,}$ ]] || { echo 'Existing proxy secret is invalid.' >&2; exit 1; }
FINGERPRINT=""
if [[ -z "$TLS_CERT" ]]; then
  install -o root -g root -m 0644 "$SERVER_CA" "$PUBLIC_CA"
  FINGERPRINT=$(openssl x509 -in "$SERVER_CA" -noout -fingerprint -sha256 | cut -d= -f2)
fi

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
if [[ -n "$LISTEN" ]]; then LISTEN80="listen $LISTEN:80;"; LISTEN443="listen $LISTEN:443 ssl;"
else LISTEN80=$'listen 80;\n  listen [::]:80;'; LISTEN443='listen 443 ssl;'; fi
# The lab server CA download only exists when this script owns the server CA.
CA_LOCATION=''
if [[ -z "$TLS_CERT" ]]; then
  CA_LOCATION=$'  location = /fabric/server-ca.crt {\n    alias '"$PUBLIC_CA"$';\n    default_type application/x-pem-file;\n    add_header Cache-Control no-store;\n  }'
fi
{
echo '# Managed by PacketMotion Fabric setup-nginx.sh'
if (( HTTP_ENROLL )); then
cat <<EOF
server {
  $LISTEN80
  server_name $HOST;
  access_log off;
  client_max_body_size 32k;
  client_body_timeout 15s;

  location = /fabric/edge.sh {
    limit_req zone=packetmotion_enrollment burst=5 nodelay;
    proxy_pass http://$UPSTREAM;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto http;
    proxy_set_header X-Fabric-Proxy-Secret $PROXY_SECRET;
    proxy_set_header X-Fabric-Client-Serial "";
    proxy_set_header X-Fabric-Client-Verified "";
    proxy_set_header Cookie "";
  }
  location ^~ /fabric/releases/ {
    proxy_pass http://$UPSTREAM;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto http;
    proxy_set_header X-Fabric-Proxy-Secret "";
    proxy_set_header X-Fabric-Client-Serial "";
    proxy_set_header X-Fabric-Client-Verified "";
    proxy_set_header Cookie "";
  }
  location = /api/agent/v1/enroll {
    limit_req zone=packetmotion_enrollment burst=5 nodelay;
    proxy_pass http://$UPSTREAM;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto http;
    proxy_set_header X-Fabric-Proxy-Secret $PROXY_SECRET;
    proxy_set_header X-Fabric-Client-Serial "";
    proxy_set_header X-Fabric-Client-Verified "";
    proxy_set_header Cookie "";
  }
  location / { return 404; }
}
EOF
else
# Production: no cleartext enrollment, installer or release path; TCP 80 only redirects browsers.
cat <<EOF
server {
  $LISTEN80
  server_name $HOST;
  access_log off;
  location / { return 301 https://$HOST\$request_uri; }
}
EOF
fi
cat <<EOF

server {
  $LISTEN443
  server_name $HOST;
  ssl_certificate $SERVER_CERT;
  ssl_certificate_key $SERVER_KEY;
  ssl_client_certificate $DEVICE_CERT;
  ssl_verify_client optional;
  ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 32k;
  client_body_timeout 15s;
  access_log off;

$CA_LOCATION
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
    proxy_read_timeout 35s;
    proxy_send_timeout 35s;
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
    proxy_set_header X-Fabric-Proxy-Secret $PROXY_SECRET;
    proxy_set_header X-Fabric-Client-Serial "";
    proxy_set_header X-Fabric-Client-Verified "";
  }
}
EOF
} > "$SITE_TMP"
chmod 0640 "$SITE_TMP" "$LIMITS_TMP"
SITE_BAK=''
if [[ -e "$SITE" ]]; then SITE_BAK="$SITE.bak.$(date +%Y%m%d%H%M%S)"; cp -p "$SITE" "$SITE_BAK"; fi
mv -f "$SITE_TMP" "$SITE"
mv -f "$LIMITS_TMP" "$LIMITS"
ln -sfn "$SITE" "$LINK"
if ! nginx -t; then
  # Never leave a configuration that would fail the next nginx restart.
  if [[ -n "$SITE_BAK" ]]; then mv -f "$SITE_BAK" "$SITE"; else rm -f "$SITE" "$LINK"; fi
  echo 'nginx rejected the new configuration; the previous site file was restored.' >&2; exit 1
fi

cp -p "$ENV_FILE" "$ENV_FILE.before-nginx-$(date +%Y%m%d%H%M%S)"
PROXY_SECRET="$PROXY_SECRET" ORIGIN="https://$HOST" DEVICE_CERT="$DEVICE_CERT" DEVICE_KEY="$DEVICE_KEY" SERVER_CA_SHA256="$FINGERPRINT" \
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
# A pin only exists for the generated lab CA. Public certificates must clear any stale pin,
# otherwise Devices would tell new edges to fetch and pin a CA that is no longer served.
if os.environ["SERVER_CA_SHA256"]:
  values["CONTROLLER_AGENT_CA_SHA256"]=os.environ["SERVER_CA_SHA256"].removeprefix("sha256 Fingerprint=")
with open(path,encoding="utf-8") as f: lines=f.read().splitlines()
keys=set(values)|{"CONTROLLER_AGENT_CA_SHA256"}
lines=[line for line in lines if not any(re.match(r"^\s*#?\s*"+re.escape(key)+r"=",line) for key in keys)]
lines.extend(f"{key}={value}" for key,value in values.items())
tmp=path+".packetmotion-tmp"
with open(tmp,"w",encoding="utf-8") as f: f.write("\n".join(lines)+"\n")
os.chmod(tmp,0o600); os.replace(tmp,path)
PY

if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl enable --now nginx; fi
echo 'NGINX HTTPS/mTLS is configured on TCP 443.'
if (( HTTP_ENROLL )); then
  echo 'HTTP dev enrollment is available on TCP 80 for installer, signed releases and enrollment only; management paths remain HTTPS/mTLS on 443.'
else
  echo 'TCP 80 only redirects to HTTPS; installer, releases and enrollment are served over HTTPS only.'
fi
echo "Controller origin: https://$HOST"
echo "Controller environment updated at $ENV_FILE; restart Next.js to load it."
if [[ -n "$TLS_CERT" ]]; then
  echo "Server certificate: $SERVER_CERT (operator supplied). Edges use their OS trust store; no CA pin is published."
  echo 'Renewing the certificate: replace the files and run systemctl reload nginx. Enrolled agents are unaffected.'
else
  echo "Server CA SHA-256 fingerprint: $FINGERPRINT"
  echo "Server CA download: https://$HOST/fabric/server-ca.crt"
  echo 'On pmedge, download the CA with curl -k, verify the displayed SHA-256 fingerprint, install it in /usr/local/share/ca-certificates, then run update-ca-certificates.'
  echo 'Keep TCP 443 limited to the trusted lab. The server CA private key remains under /etc/packetmotion-fabric/pki.'
fi
