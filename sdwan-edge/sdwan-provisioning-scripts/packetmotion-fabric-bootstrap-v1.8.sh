#!/usr/bin/env bash

set -Eeuo pipefail

# PacketMotion Fabric v1.8 — Debian 12/13 interactive bootstrap

# Root password SSH is unsafe on Internet-facing systems.

(( EUID == 0 )) || { echo 'Run as root: su -'; exit 1; }
[[ -t 0 ]] || { echo 'Run from an interactive terminal.'; exit 1; }
umask 077
command -v flock >/dev/null || { echo 'Install util-linux first.'; exit 1; }
exec 9>/run/packetmotion-bootstrap.lock
flock -n 9 || { echo 'Another PacketMotion installation is running.'; exit 1; }

LOG=/var/log/packetmotion-install.log

mkdir -p /var/log; touch "$LOG"; chmod 600 "$LOG"

exec 3>&1 4>&2

exec >>"$LOG" 2>&1

if [[ -t 3 && -z ${NO_COLOR:-} ]]; then

  G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; B=$'\e[1m'; N=$'\e[0m'

else G=''; Y=''; R=''; C=''; B=''; N=''; fi

PASS=0; WARN=0; FAIL=0; STEP=0

line(){ printf '%s\n' '┌──────────────────────────────────────────────────────────────────────────┐' >&3; }

heading(){ printf '\n%b╔══════════════════════════════════════════════════════════════════════════╗%b\n' "$C" "$N" >&3; printf '║ %-72s ║\n' "$1" >&3; printf '╚══════════════════════════════════════════════════════════════════════════╝\n' >&3; }

step(){ STEP=$((STEP+1)); printf '\n%b[%d/13] %s%b\n' "$B" "$STEP" "$1" "$N" >&3; }

status(){ local kind=$1 name=$2 detail=$3 color=$G; case "$kind" in WARN) color=$Y; WARN=$((WARN+1));; FAIL) color=$R; FAIL=$((FAIL+1));; PASS) PASS=$((PASS+1));; esac; printf '│ %-25.25s │ %b%-5s%b │ %-32.32s │\n' "$name" "$color" "$kind" "$N" "$detail" >&3; }

table_start(){ printf '┌───────────────────────────┬───────┬──────────────────────────────────┐\n' >&3; printf '│ %-25s │ %-5s │ %-32s │\n' 'CHECK' 'STATE' 'DETAIL' >&3; printf '├───────────────────────────┼───────┼──────────────────────────────────┤\n' >&3; }

table_end(){ printf '└───────────────────────────┴───────┴──────────────────────────────────┘\n' >&3; }

# Stream command output to terminal AND installation log in real time.

# stdout/stderr of the installer already point at LOG; fd 3 is original terminal.

run(){

  local label=$1 rc

  shift

  printf '\n  %b→%b %s\n' "$C" "$N" "$label" >&3

  printf '  %s | START | %s\n' "$(date -Is)" "$label"

  if "$@" 2>&1 | tee /dev/fd/3; then

    printf '  %b✓ DONE%b %s\n' "$G" "$N" "$label" >&3

    printf '  %s | DONE | %s\n' "$(date -Is)" "$label"

  else

    rc=$?

    printf '  %b✗ FAILED%b %s (exit %d; log %s)\n' "$R" "$N" "$label" "$rc" "$LOG" >&3

    return "$rc"

  fi

}



error(){ local rc=$?; printf '\n%bINSTALLATION STOPPED%b at line %s (exit %s). Log: %s\n' "$R" "$N" "$1" "$rc" "$LOG" >&3; exit "$rc"; }

trap 'error "$LINENO"' ERR
trap 'if declare -F wg_test_cleanup >/dev/null; then wg_test_cleanup; fi' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

heading 'PACKETMOTION FABRIC  |  EDGE BOOTSTRAP v1.8'

printf '  Host: %-22s  Started: %s\n  Log:  %s\n' "$(hostname)" "$(date -Is)" "$LOG" >&3

step 'Validate operating system'

source /etc/os-release

if [[ "$ID" != debian || ( "$VERSION_ID" != 12 && "$VERSION_ID" != 13 ) ]]; then echo 'Requires Debian 12 or 13' >&3; exit 1; fi

printf '  Debian %s | %s | kernel %s\n' "$VERSION_ID" "$(dpkg --print-architecture)" "$(uname -r)" >&3

# Linux bootstrap settings get APT online; FRR owns selected static IPs afterward.
NETWORK_MODE=keep
NETWORK_IFACE=
NETWORK_ADDRESS=
NETWORK_GATEWAY=
DHCP_BOOTSTRAP_STARTED=0
HOSTNAME_VALUE=$(hostname -s)
DOMAIN_VALUE=$(hostname -d 2>/dev/null || true)
FRR_HOSTNAME_VALUE=$HOSTNAME_VALUE
[[ -z "$DOMAIN_VALUE" ]] || FRR_HOSTNAME_VALUE="$HOSTNAME_VALUE.$DOMAIN_VALUE"
valid_ipv4() {
  local value=$1 octet
  local -a octets
  [[ "$value" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS=. read -r -a octets <<< "$value"
  for octet in "${octets[@]}"; do
    (( 10#$octet <= 255 )) || return 1
  done
}

valid_gateway() {
  local address=$1 gateway=$2 prefix mask host_ip gateway_ip octet
  local -a octets
  prefix=${address##*/}
  host_ip=0
  gateway_ip=0
  IFS=. read -r -a octets <<< "${address%/*}"
  for octet in "${octets[@]}"; do host_ip=$(( (host_ip << 8) | 10#$octet )); done
  IFS=. read -r -a octets <<< "$gateway"
  for octet in "${octets[@]}"; do gateway_ip=$(( (gateway_ip << 8) | 10#$octet )); done
  mask=$(( (0xffffffff << (32 - 10#$prefix)) & 0xffffffff ))
  (( host_ip != gateway_ip && (host_ip & mask) == (gateway_ip & mask) )) || return 1
  if (( 10#$prefix <= 30 )); then
    (( (host_ip & ~mask) != 0 && (host_ip | mask) != 0xffffffff &&
       (gateway_ip & ~mask) != 0 && (gateway_ip | mask) != 0xffffffff )) || return 1
  fi
}

network_prompt() {
  local label=$1 default=$2 answer
  printf '  %s [%s]: ' "$label" "$default" >&3
  if ! IFS= read -r answer; then
    printf '\n  Input closed; installation cancelled.\n' >&3
    exit 1
  fi
  REPLY=${answer:-$default}
}

confirm_choice() {
  local label=$1
  while :; do
    network_prompt "$label (1=Yes, 2=Cancel)" 2
    case "$REPLY" in 1) return 0;; 2) return 1;; esac
    printf '  Choose 1 or 2.\n' >&3
  done
}

hostname_wizard() {
  local hostname_value domain_value fqdn hosts_tmp
  printf '\n  Configure the Linux system hostname and DNS domain. FRR CLI will use the hostname.\n  Example: hostname=pmcontroller, domain=lab.local -> FQDN pmcontroller.lab.local\n  1) Change hostname/domain   2) Keep current values\n' >&3
  while :; do
    network_prompt 'Hostname option (1-2)' 2
    case "$REPLY" in 1) break;; 2) return 0;; esac
    printf '  Choose 1 or 2.\n' >&3
  done
  while :; do
    network_prompt 'System hostname (e.g. pmcontroller)' "$HOSTNAME_VALUE"
    hostname_value=${REPLY,,}
    if [[ "$hostname_value" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then break; fi
    printf '  Enter a valid hostname label (1-63 characters; no leading/trailing hyphen).\n' >&3
  done
  while :; do
    network_prompt 'DNS domain (e.g. lab.local; blank for none)' "$DOMAIN_VALUE"
    domain_value=${REPLY,,}
    if [[ -z "$domain_value" || ( ${#domain_value} -le 253 && "$domain_value" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$ ) ]]; then break; fi
    printf '  Enter a valid DNS domain, or leave it blank.\n' >&3
  done
  fqdn=$hostname_value
  [[ -z "$domain_value" ]] || fqdn="$hostname_value.$domain_value"
  printf '  Linux hostname/FQDN: %s\n  FRR CLI prompt hostname: %s\n' "$fqdn" "$hostname_value" >&3
  confirm_choice 'Apply hostname and domain?' || return 0
  HOSTNAME_VALUE=$hostname_value
  DOMAIN_VALUE=$domain_value
  FRR_HOSTNAME_VALUE=$fqdn
  [[ ! -f /etc/hostname ]] || cp -a /etc/hostname "/etc/hostname.bak.$(date +%Y%m%d%H%M%S)"
  printf '%s\n' "$fqdn" > /etc/hostname
  run 'Set Linux hostname' hostnamectl set-hostname "$fqdn"
  if [[ -f /etc/hosts ]]; then
    cp -a /etc/hosts "/etc/hosts.bak.$(date +%Y%m%d%H%M%S)"
    hosts_tmp=$(mktemp /etc/hosts.packetmotion.XXXXXX)
    awk -v short="$hostname_value" -v fqdn="$fqdn" '
      /^127\.0\.1\.1([[:space:]]|$)/ { print "127.0.1.1\t" fqdn " " short; found=1; next }
      { print }
      END { if (!found) print "127.0.1.1\t" fqdn " " short }
    ' /etc/hosts > "$hosts_tmp"
    cat "$hosts_tmp" > /etc/hosts
    rm -f "$hosts_tmp"
  fi
  if [[ -n "$domain_value" ]]; then
    if [[ -L /etc/resolv.conf ]]; then
      printf '  /etc/resolv.conf is managed by a symlink; DNS domain was not written there. Configure search domain in its resolver manager.\n' >&3
    else
      [[ ! -f /etc/resolv.conf ]] || cp -a /etc/resolv.conf "/etc/resolv.conf.bak.$(date +%Y%m%d%H%M%S)"
      if grep -Eq '^[[:space:]]*search[[:space:]]' /etc/resolv.conf 2>/dev/null; then
        sed -i "s/^[[:space:]]*search[[:space:]].*/search $domain_value/" /etc/resolv.conf
      else
        printf 'search %s\n' "$domain_value" >> /etc/resolv.conf
      fi
    fi
  fi
}

network_wizard() {
  local iface address gateway dns prefix current mode index selection default_selection
  local -a interfaces
  local config=/usr/local/sbin/packetmotion-network-init
  printf '\n  1) DHCP   - Automatic address; choose when the network provides DHCP.\n  2) Static - Fixed address; example: 192.168.1.20/24, gateway 192.168.1.1.\n  3) Keep   - Keep current settings; choose when connectivity already works.\n' >&3
  while :; do
    network_prompt 'Network option (1-3; e.g. 3 to keep current)' 3
    case "$REPLY" in 1) mode=dhcp; break;; 2) mode=static; break;; 3) return 0;; esac
    printf '  Choose 1, 2, or 3.\n' >&3
  done
  command -v ip >/dev/null || { printf '  Install iproute2 first, or skip the wizard.\n' >&3; return 1; }
  iface=$(ip -4 route show default | awk 'NR == 1 {print $5}')
  mapfile -t interfaces < <(ip -o link show | awk -F ': ' '{sub(/@.*/, "", $2); print $2}')
  (( ${#interfaces[@]} > 0 )) || { printf '  No network interfaces available.\n' >&3; return 1; }
  default_selection=
  printf '\n  Available interfaces:\n' >&3
  for index in "${!interfaces[@]}"; do
    printf '  %d) %s' "$((index + 1))" "${interfaces[$index]}" >&3
    if [[ "${interfaces[$index]}" == lo ]]; then
      printf ' (loopback; unavailable for Internet)' >&3
    elif [[ "${interfaces[$index]}" == "$iface" ]]; then
      default_selection=$((index + 1))
      printf ' (current Internet interface)' >&3
    fi
    printf '\n' >&3
  done
  while :; do
    network_prompt "Internet interface number (e.g. ${default_selection:-1} for listed uplink)" "$default_selection"
    if [[ "$REPLY" =~ ^[0-9]{1,6}$ ]]; then
      selection=$((10#$REPLY))
      if (( selection >= 1 && selection <= ${#interfaces[@]} )); then
        iface=${interfaces[$((selection - 1))]}
        if [[ "$iface" =~ ^[a-zA-Z0-9_.:-]{1,15}$ && "$iface" != lo ]] && ip link show dev "$iface" >/dev/null 2>&1; then break; fi
      fi
    fi
    printf '  Choose an available interface number other than loopback.\n' >&3
  done
  printf '  Disable competing DHCP/static settings in your network manager for this interface.\n  Example interface names: ens18, enp1s0, eth0.\n' >&3
  if [[ "$mode" == dhcp ]]; then
    printf '  Interface: %s | DHCP | SSH may disconnect.\n' "$iface" >&3
    confirm_choice 'Apply DHCP?' || return 0
    NETWORK_MODE=dhcp
    NETWORK_IFACE=$iface
    if command -v dhcpcd >/dev/null; then
      if ! run 'Request initial uplink DHCP lease' dhcpcd -4 -L -w -t 30 "$iface"; then
        printf '  No DHCP lease acquired; existing connectivity is required for APT. The service will retry after installation.\n' >&3
      else
        DHCP_BOOTSTRAP_STARTED=1
      fi
    else
      printf '  DHCP client will be installed by APT; existing Internet access is required until then.\n' >&3
    fi
    return 0
  fi
  current=$(ip -o -4 addr show dev "$iface" scope global | awk 'NR == 1 {print $4}')
  while :; do
    network_prompt 'IPv4 address/prefix (e.g. 192.168.1.20/24)' "$current"
    address=$REPLY
    prefix=${address##*/}
    if [[ "$address" == */* && "$prefix" =~ ^[0-9]{1,2}$ ]] && valid_ipv4 "${address%/*}" && (( 10#$prefix >= 1 && 10#$prefix <= 31 )); then break; fi
    printf '  Enter a valid IPv4 address with a prefix from 1 to 31.\n' >&3
  done
  current=$(ip -4 route show default dev "$iface" | awk 'NR == 1 {print $3}')
  while :; do
    network_prompt 'IPv4 gateway (e.g. 192.168.1.1)' "$current"
    gateway=$REPLY
    if valid_ipv4 "$gateway" && valid_gateway "$address" "$gateway"; then break; fi
    printf '  Use a different gateway in the same subnet; avoid network/broadcast addresses.\n' >&3
  done
  while :; do
    network_prompt 'DNS server IPv4 address (e.g. 1.1.1.1 or 8.8.8.8)' '1.1.1.1'
    dns=$REPLY
    if valid_ipv4 "$dns"; then break; fi
    printf '  Enter a valid IPv4 DNS server.\n' >&3
  done
  # Respect resolver-managed symlinks rather than overwriting their targets.
  if [[ -L /etc/resolv.conf ]] && ! { command -v resolvectl >/dev/null && systemctl is-active --quiet systemd-resolved; }; then
    printf '  Resolver is managed externally. Configure DNS with its manager and rerun, or skip the wizard.\n' >&3
    return 1
  fi
  printf '\n  Interface: %s | Address: %s | Gateway: %s | DNS: %s\n' "$iface" "$address" "$gateway" "$dns" >&3
  printf '  Applying replaces the default route and DNS; SSH may disconnect. Existing addresses are retained.\n' >&3
  confirm_choice 'Apply Static?' || return 0
  NETWORK_MODE=static
  NETWORK_IFACE=$iface
  NETWORK_ADDRESS=$address
  NETWORK_GATEWAY=$gateway
  install -d -m 755 /usr/local/sbin
  [[ ! -f "$config" ]] || cp -a "$config" "${config}.bak.$(date +%Y%m%d%H%M%S)"
  if [[ -e /etc/resolv.conf && ! -L /etc/resolv.conf ]]; then
    cp -a /etc/resolv.conf "/etc/resolv.conf.bak.$(date +%Y%m%d%H%M%S)"
  fi
  {
    printf '#!/usr/bin/env bash\nset -Eeuo pipefail\n'
    printf 'ip link set dev %q up\n' "$iface"
    printf 'ip -4 address replace %q dev %q\n' "$address" "$iface"
    printf 'ip -4 route replace default via %q dev %q\n' "$gateway" "$iface"
    if command -v resolvectl >/dev/null && systemctl is-active --quiet systemd-resolved; then
      printf 'resolvectl dns %q %q\nresolvectl domain %q %q\n' "$iface" "$dns" "$iface" '~.'
    else
      printf '[[ ! -L /etc/resolv.conf ]] || { echo "Resolver management changed; configure DNS manually" >&2; exit 1; }\n'
      printf 'printf "nameserver %%s\\n" %q > /etc/resolv.conf\n' "$dns"
    fi
  } > "$config"
  chmod 700 "$config"
  run 'Apply Internet network configuration' "$config"
  printf '  Static settings will persist after installation.\n' >&3
  if ping -c 1 -W 3 "$gateway" >/dev/null 2>&1; then
    printf '  Gateway responds.\n' >&3
  else
    printf '  Gateway did not answer ICMP; check connectivity (ICMP may be blocked).\n' >&3
  fi
  printf '  APT will verify repository access next. Manual reapply: %s\n' "$config" >&3
}

SSH_MODE=keep
printf '\n  SSH access:\n  1) Keep - Preserve current login settings (recommended; example: key-based login stays unchanged).\n  2) Lab  - Enable root password login for an isolated lab (example: root + password).\n' >&3
while :; do
  network_prompt 'SSH option (1=Keep, 2=Lab)' 1
  case "$REPLY" in
    1) break;;
    2)
      confirm_choice 'Enable root password SSH for this lab?' || continue
      SSH_MODE=lab
      break;;
  esac
  printf '  Choose 1 or 2.\n' >&3
done

step 'Initialize Internet network configuration'
network_wizard

step 'Configure system hostname and domain'
hostname_wizard

step 'Update system packages (live APT output)'

export DEBIAN_FRONTEND=noninteractive

run 'APT index refresh (repository downloads)' apt-get -o Dpkg::Progress-Fancy=0 -o APT::Color=0 update

run 'APT upgrade (package changes)' apt-get -o Dpkg::Progress-Fancy=0 -o APT::Color=0 upgrade -y

step 'Install required components (live dpkg output)'

run 'Install routing, tunnel and diagnostic packages' apt-get -o Dpkg::Progress-Fancy=0 -o APT::Color=0 install -y \
  sudo openssh-server ca-certificates curl gnupg iproute2 iputils-ping \
  dnsutils traceroute tcpdump ethtool jq vim nano git chrony wireguard \
  wireguard-tools nftables frr frr-pythontools kmod conntrack iperf3 \
  mtr-tiny iputils-arping lsof logrotate procps psmisc netcat-openbsd \
  openssl htop iftop nload strace pciutils tshark dhcpcd-base

step 'Enable FRR routing daemons'

FRR_FILE=/etc/frr/daemons

cp -a "$FRR_FILE" "${FRR_FILE}.bak.$(date +%Y%m%d%H%M%S)"

DAEMONS=(zebra bgpd ospfd ospf6d bfdd staticd)

for d in "${DAEMONS[@]}"; do

  if grep -q "^${d}=" "$FRR_FILE"; then sed -i "s/^${d}=.*/${d}=yes/" "$FRR_FILE"; else echo "${d}=yes" >> "$FRR_FILE"; fi

done

run 'Enable time synchronization' systemctl enable --now chrony
run 'Enable FRR service' systemctl enable frr

# Remove the unsupported directive left by earlier installer runs. Preserve
# routing configuration while keeping FRR's stock greeting out of CLI output.
for config in /etc/frr/vtysh.conf /etc/frr/frr.conf; do
  if [[ -f "$config" ]] && grep -Eq '^[[:space:]]*no[[:space:]]+banner[[:space:]]+motd[[:space:]]*$' "$config"; then
    cp -a "$config" "${config}.bak.$(date +%Y%m%d%H%M%S)"
    run 'Remove unsupported FRR banner directive' sed -i '/^[[:space:]]*no[[:space:]]\+banner[[:space:]]\+motd[[:space:]]*$/d' "$config"
  fi
done

# Old releases of this installer wrote banner commands into the integrated
# routing config. MOTD configuration belongs in vtysh.conf, so migrate it
# there and leave frr.conf with valid routing configuration only.
if [[ -f /etc/frr/frr.conf ]] && grep -Eq '^[[:space:]]*banner[[:space:]]+motd([[:space:]]|$)' /etc/frr/frr.conf; then
  cp -a /etc/frr/frr.conf "/etc/frr/frr.conf.bak.$(date +%Y%m%d%H%M%S)"
  run 'Remove MOTD directive from integrated FRR config' sed -i '/^[[:space:]]*banner[[:space:]]\+motd\([[:space:]].*\)\?$/d' /etc/frr/frr.conf
fi

# FRR's configured hostname controls the vtysh CLI prompt. Preserve the
# existing integrated config and update only its top-level hostname command.
[[ ! -f /etc/frr/frr.conf ]] || cp -a /etc/frr/frr.conf "/etc/frr/frr.conf.bak.$(date +%Y%m%d%H%M%S)"
if grep -Eq '^[[:space:]]*hostname[[:space:]]+' /etc/frr/frr.conf 2>/dev/null; then
  sed -i "s/^[[:space:]]*hostname[[:space:]].*/hostname $FRR_HOSTNAME_VALUE/" /etc/frr/frr.conf
else
  sed -i "1i hostname $FRR_HOSTNAME_VALUE" /etc/frr/frr.conf
fi
chown frr:frr /etc/frr/frr.conf
chmod 640 /etc/frr/frr.conf
if vtysh -C -f /etc/frr/frr.conf >/dev/null 2>&1; then
  run 'Validate FRR configuration' vtysh -C -f /etc/frr/frr.conf
else
  printf '  FRR configuration validation failed; refusing to restart FRR.\n' >&3
  exit 1
fi
run 'Restart FRR service with configured CLI hostname' systemctl restart frr
if vtysh -c 'show running-config' | grep -Fqx "hostname $FRR_HOSTNAME_VALUE"; then
  printf '  FRR CLI hostname verified: %s\n' "$FRR_HOSTNAME_VALUE" >&3
else
  status FAIL 'FRR CLI hostname' 'configured hostname not active'
fi

# Use integrated configuration so write memory persists all enabled daemons.
[[ ! -f /etc/frr/vtysh.conf ]] || cp -a /etc/frr/vtysh.conf "/etc/frr/vtysh.conf.bak.$(date +%Y%m%d%H%M%S)"
if [[ -f /etc/frr/vtysh.conf ]]; then
  run 'Remove conflicting FRR persistence setting' sed -i '/^[[:space:]]*\(no[[:space:]]\+\)\?service[[:space:]]\+integrated-vtysh-config[[:space:]]*$/d' /etc/frr/vtysh.conf
fi
printf 'service integrated-vtysh-config\n' >> /etc/frr/vtysh.conf
# Remove any unsupported banner directive written by earlier installer runs.
run 'Remove previous VTYSH banner setting' sed -i '/^[[:space:]]*banner[[:space:]]\+motd\([[:space:]].*\)\?$/d' /etc/frr/vtysh.conf
chown frr:frrvty /etc/frr/vtysh.conf
chmod 640 /etc/frr/vtysh.conf

if [[ "$NETWORK_MODE" != keep && -f /etc/systemd/system/packetmotion-network-init.service ]]; then
  run 'Disable legacy Linux static boot configuration' systemctl disable --now packetmotion-network-init.service
fi

if [[ "$NETWORK_MODE" == static ]]; then
  if [[ -f /etc/systemd/system/packetmotion-dhcp.service ]]; then
    run 'Stop previous PacketMotion DHCP client' systemctl disable --now packetmotion-dhcp.service
  fi
  [[ ! -f /etc/frr/frr.conf ]] || cp -a /etc/frr/frr.conf "/etc/frr/frr.conf.bak.$(date +%Y%m%d%H%M%S)"
  run 'Save static uplink configuration' vtysh -c 'configure terminal' \
    -c "interface $NETWORK_IFACE" -c 'no shutdown' \
    -c "ip address $NETWORK_ADDRESS" -c 'exit' \
    -c "ip route 0.0.0.0/0 $NETWORK_GATEWAY $NETWORK_IFACE" -c 'end'
  # Keep only Linux DNS/link setup in the helper; FRR restores IPs/routes.
  run 'Finalize static startup configuration' \
    sed -i '/^ip -4 address replace /d; /^ip -4 route replace /d' /usr/local/sbin/packetmotion-network-init
  [[ ! -f /etc/systemd/system/packetmotion-network-init.service ]] || cp -a /etc/systemd/system/packetmotion-network-init.service "/etc/systemd/system/packetmotion-network-init.service.bak.$(date +%Y%m%d%H%M%S)"
  cat > /etc/systemd/system/packetmotion-network-init.service <<'NETWORK_SERVICE'
[Unit]
Description=PacketMotion uplink link and DNS setup (static IP managed by FRR)
Wants=network-pre.target
Before=network-pre.target frr.service
After=systemd-resolved.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/packetmotion-network-init
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
NETWORK_SERVICE
  run 'Reload static uplink service' systemctl daemon-reload
  run 'Enable uplink link and DNS setup' systemctl enable --now packetmotion-network-init.service
  run 'Reapply static uplink DNS' /usr/local/sbin/packetmotion-network-init
elif [[ "$NETWORK_MODE" == dhcp ]]; then
  install -d -m 755 /usr/local/sbin
  [[ ! -f /usr/local/sbin/packetmotion-dhcp ]] || cp -a /usr/local/sbin/packetmotion-dhcp "/usr/local/sbin/packetmotion-dhcp.bak.$(date +%Y%m%d%H%M%S)"
  {
    printf '#!/usr/bin/env bash\nset -Eeuo pipefail\n'
    printf 'exec %q -B -4 -L -w -t 30 %q\n' "$(command -v dhcpcd)" "$NETWORK_IFACE"
  } > /usr/local/sbin/packetmotion-dhcp
  chmod 700 /usr/local/sbin/packetmotion-dhcp
  [[ ! -f /etc/systemd/system/packetmotion-dhcp.service ]] || cp -a /etc/systemd/system/packetmotion-dhcp.service "/etc/systemd/system/packetmotion-dhcp.service.bak.$(date +%Y%m%d%H%M%S)"
  cat > /etc/systemd/system/packetmotion-dhcp.service <<'DHCP_SERVICE'
[Unit]
Description=PacketMotion Linux uplink DHCP client
Wants=network.target
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/sbin/packetmotion-dhcp
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
DHCP_SERVICE
  # Stop only the selected interface's standalone client before systemd owns it.
  if (( DHCP_BOOTSTRAP_STARTED )); then
    run 'Stop bootstrap DHCP client' dhcpcd -4 -x "$NETWORK_IFACE"
  fi
  run 'Reload DHCP service configuration' systemctl daemon-reload
  run 'Enable uplink DHCP client' systemctl enable packetmotion-dhcp.service
  run 'Start uplink DHCP client' systemctl restart packetmotion-dhcp.service
  printf '  DHCP lease status: journalctl -u packetmotion-dhcp.service; ip -4 addr show dev %s\n' "$NETWORK_IFACE" >&3
  printf '  Remove previous static address and default route settings when switching to DHCP.\n' >&3
fi


step 'Install PacketMotion CLI launcher'

# Wrapper only: preserve stock FRR/vtysh, support all vtysh arguments.
VTYSH_BIN=$(command -v vtysh)
[[ -x "$VTYSH_BIN" ]] || { echo 'vtysh binary not found' >&3; exit 1; }
install -d -m 755 /usr/local/bin
cat > /usr/local/bin/packetmotion <<'PM_LAUNCHER'
#!/bin/sh
# PacketMotion Fabric CLI launcher — FRRouting backend.
if [ "$#" -eq 0 ] && [ -t 1 ]; then
  frr_version=$(/usr/bin/vtysh --help 2>/dev/null | sed -n 's/^Integrated shell for FRR (version \([^)]*\)).*/\1/p')
  printf '\n  PacketMotion Fabric\n  Secure Connectivity Platform\n  CLI v1.8\n  FRRouting version %s\n\n' "${frr_version:-unknown}"
fi
# Keep vtysh attached directly to the terminal so interactive input and
# prompts work normally. FRR does not provide a supported greeting-suppression
# option; do not wrap it in a PTY/pipeline, which can leave the CLI blank.
exec /usr/bin/vtysh "$@"
PM_LAUNCHER
chmod 755 /usr/local/bin/packetmotion
run 'Verify PacketMotion launcher' /usr/local/bin/packetmotion -c 'show version'

step 'Configure kernel forwarding'

printf 'net.ipv4.ip_forward = 1\n' > /etc/sysctl.d/99-packetmotion.conf

run 'Enable IPv4 forwarding' sysctl -p /etc/sysctl.d/99-packetmotion.conf

step 'Prepare WireGuard'

install -d -m 700 /etc/wireguard

printf '  WireGuard installed; unique keys/tunnels generated during enrollment.\n' >&3

step 'Configure SSH access'

if [[ "$SSH_MODE" == lab ]]; then

  root_status=$(passwd -S root | awk '{print $2}')

  if [[ "$root_status" != P ]]; then

    printf '  Root has no usable password. Set one now (hidden input).\n' >&3

    [[ -t 0 ]] || { echo 'Interactive terminal required for root password setup' >&3; exit 1; }

    passwd root < /dev/tty >&3 2>&3

  fi

  install -d -m 755 /etc/ssh/sshd_config.d

  SSH_DROPIN=/etc/ssh/sshd_config.d/00-packetmotion-lab.conf

  [[ ! -f "$SSH_DROPIN" ]] || cp -a "$SSH_DROPIN" "${SSH_DROPIN}.bak.$(date +%Y%m%d%H%M%S)"

  cat > "$SSH_DROPIN" <<'SSH'

# LAB ONLY: do not expose root password SSH to the Internet.

PermitRootLogin yes

PasswordAuthentication yes

KbdInteractiveAuthentication no

PubkeyAuthentication yes

SSH

else
  printf '  Existing SSH login settings retained.\n' >&3
fi

run 'Validate SSH configuration' sshd -t

run 'Enable SSH service' systemctl enable --now ssh

run 'Reload SSH service' systemctl reload ssh

step 'Configure diagnostic log retention'

cat > /etc/logrotate.d/packetmotion-install <<'ROTATE'

/var/log/packetmotion-install.log {

    weekly

    rotate 8

    compress

    missingok

    notifempty

    create 0600 root root

}

ROTATE

printf '  PacketMotion install log rotation configured.\n' >&3

step 'Verify installation' 

table_start

for svc in frr ssh chrony; do

  if systemctl is-active --quiet "$svc"; then status PASS "$svc service" active; else status FAIL "$svc service" inactive; fi

done

for d in "${DAEMONS[@]}"; do

  if grep -qx "$d=yes" "$FRR_FILE" && pgrep -x "$d" >/dev/null; then status PASS "FRR $d" 'enabled + running'; else status FAIL "FRR $d" 'missing / stopped'; fi

done

for pair in 'BGP|show bgp summary' 'OSPF|show ip ospf neighbor' 'BFD|show bfd peers'; do

  name=${pair%%|*}; command=${pair#*|}

  if vtysh -c "$command" >/dev/null 2>&1; then status PASS "$name CLI" ready; else status FAIL "$name CLI" unavailable; fi

done

if [[ -x /usr/local/bin/packetmotion ]] && /usr/local/bin/packetmotion -c 'show version' >/dev/null 2>&1; then status PASS 'PacketMotion CLI' ready; else status FAIL 'PacketMotion CLI' unavailable; fi

for tool in tcpdump tshark conntrack iperf3 mtr arping nc iftop nload strace openssl; do

  if command -v "$tool" >/dev/null 2>&1; then status PASS "Tool $tool" installed; else status FAIL "Tool $tool" missing; fi

done

# Linux IFNAMSIZ allows at most 15 visible characters. v1.5 used a 20-char

# name (pm-wg-bootstrap-test), causing a false "permission denied" warning.

# Generate a short, process-specific name and never delete pre-existing links.

WG_TEST_IF="pmwg${BASHPID}"

WG_TEST_IF="${WG_TEST_IF:0:15}"

WG_TEST_CREATED=0

wg_test_cleanup() {

  if (( WG_TEST_CREATED )); then

    ip link delete "$WG_TEST_IF" >>"$LOG" 2>&1 || true

    WG_TEST_CREATED=0

  fi

}

if ip link show dev "$WG_TEST_IF" >/dev/null 2>&1; then

  status WARN 'WireGuard functional' 'temporary name already exists'

else

  WG_TEST_ERROR=$(mktemp /tmp/pm-wg-check.XXXXXX)

  if ip link add "$WG_TEST_IF" type wireguard 2>"$WG_TEST_ERROR"; then

    WG_TEST_CREATED=1

    if ip -d link show dev "$WG_TEST_IF" 2>&1 | grep -q 'wireguard'; then

      if ip link delete "$WG_TEST_IF" 2>>"$WG_TEST_ERROR"; then

        WG_TEST_CREATED=0

        status PASS 'WireGuard functional' 'interface create/delete OK'

      else

        printf 'WireGuard cleanup error: %s\n' "$(cat "$WG_TEST_ERROR")"

        status WARN 'WireGuard functional' 'interface cleanup failed'

      fi

    else

      status WARN 'WireGuard functional' 'interface type not confirmed'

    fi

  else

    WG_ERROR=$(tr '\n' ' ' < "$WG_TEST_ERROR")

    printf 'WireGuard interface creation error: %s\n' "$WG_ERROR"

    status WARN 'WireGuard functional' "${WG_ERROR:-creation failed; see log}"

  fi

  wg_test_cleanup

  rm -f "$WG_TEST_ERROR"

fi

if nft -c -f /etc/nftables.conf >/dev/null 2>&1; then

  status PASS 'nftables syntax' valid

else

  status WARN 'nftables syntax' 'check /etc/nftables.conf'

fi

if wg --version >/dev/null 2>&1; then status PASS WireGuard installed; else status FAIL WireGuard missing; fi

if [[ -d /sys/module/wireguard ]] || modprobe -n wireguard >/dev/null 2>&1; then status PASS 'WireGuard kernel' supported; else status WARN 'WireGuard kernel' 'not confirmed'; fi

if [[ $(sysctl -n net.ipv4.ip_forward) == 1 ]]; then status PASS 'IPv4 forwarding' enabled; else status FAIL 'IPv4 forwarding' disabled; fi

if nft --version >/dev/null 2>&1; then status PASS nftables installed; else status FAIL nftables missing; fi

if sshd -t; then status PASS 'SSH syntax' valid; else status FAIL 'SSH syntax' invalid; fi

ssh_effective=$(sshd -T)

if [[ "$SSH_MODE" == lab ]]; then
  for entry in 'permitrootlogin yes' 'passwordauthentication yes'; do
    if grep -qx "$entry" <<<"$ssh_effective"; then status PASS "SSH ${entry%% *}" "${entry##* }"; else status FAIL "SSH ${entry%% *}" 'effective setting differs'; fi
  done
else
  status PASS 'SSH login settings' 'existing policy retained'
fi

if ss -ltn '( sport = :22 )' | grep -q LISTEN; then status PASS 'SSH TCP/22' listening; else status WARN 'SSH TCP/22' 'check custom port'; fi

if [[ "$NETWORK_MODE" != keep ]]; then
  if ip -o -4 addr show dev "$NETWORK_IFACE" scope global | grep -q 'inet '; then
    status PASS 'Uplink IPv4' configured
  else
    status FAIL 'Uplink IPv4' 'no address acquired'
  fi
  if ip -4 route show default dev "$NETWORK_IFACE" | grep -q '^default '; then
    status PASS 'Uplink default route' configured
  else
    status FAIL 'Uplink default route' missing
  fi
  if [[ "$NETWORK_MODE" == dhcp ]]; then
    if systemctl is-active --quiet packetmotion-dhcp.service; then
      status PASS 'DHCP service' active
    else
      status FAIL 'DHCP service' inactive
    fi
  fi
fi

table_end

run 'Save final FRR configuration (write memory)' vtysh -c 'write memory'

heading 'INSTALLATION SUMMARY'

printf '  %-18s %s\n' 'OS' "Debian $VERSION_ID" 'Hostname' "$(hostname)" 'FRR version' "$(dpkg-query -W -f='${Version}' frr)" 'Kernel' "$(uname -r)" 'Log' "$LOG" >&3

printf '\n  %bPASS %-3d%b  |  %bWARN %-3d%b  |  %bFAIL %-3d%b\n' "$G" "$PASS" "$N" "$Y" "$WARN" "$N" "$R" "$FAIL" "$N" >&3

if (( FAIL > 0 )); then printf '  %bRESULT: VERIFICATION FAILED%b\n' "$R" "$N" >&3; exit 1; fi

if (( WARN > 0 )); then printf '  %bRESULT: INSTALLED WITH WARNINGS%b\n' "$Y" "$N" >&3; else printf '  %bRESULT: INSTALLATION SUCCESSFUL%b\n' "$G" "$N" >&3; fi

printf '\n  Network inventory (read-only):\n' >&3

ip -br addr >&3 || true

ip route show default >&3 || true

printf '\n  Capture example: tcpdump -ni any udp port 51820\n' >&3

printf '  Save routing changes: packetmotion -c "write memory"\n' >&3

printf '  CLI: packetmotion (interactive), packetmotion -c \"show ip route\"\n' >&3

printf '  Next: Test SSH access; configure WG peers, BGP policies and firewall.\n' >&3
if [[ "$SSH_MODE" == lab ]]; then
  printf '  Reminder: root password SSH is for isolated labs only.\n' >&3
fi

printf '\n  A reboot is recommended to ensure the new Linux hostname is reflected by all services.\n' >&3
while :; do
  network_prompt 'Reboot now? (1=Yes, 2=No; e.g. 2 to reboot later)' 1
  case "$REPLY" in
    1) run 'Reboot system' systemctl reboot; break;;
    2) printf '  Reboot skipped. Reboot later with: systemctl reboot\n' >&3; break;;
    *) printf '  Choose 1 or 2.\n' >&3;;
  esac
done
