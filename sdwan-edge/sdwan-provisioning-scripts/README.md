# Debian appliance bootstrap

`packetmotion-fabric-bootstrap-v1.8.sh` is an interactive root installer for Debian 12/13. It installs packages and configures host networking, FRR, SSH (only when selected), hostname and forwarding. Run only on an authorized appliance/lab with console recovery access; it is separate from the read-only Go management agent.

## Ethernet interface names

The bootstrap preserves the interface names provided by Debian/kernel/udev, such as `ens33`, `enp1s0` or an existing `eth0`. DHCP, static setup, FRR, firewall and helper configuration all use the selected/current name. It does not rename interfaces or rewrite their names in configuration files. If a host has custom `.link` files or udev naming rules, inspect those separately; this installer leaves them untouched.

Keeping one name from discovery through network service startup avoids a timing/configuration split where DHCP or a network manager is configured for the original name but a later boot service renames the device. It also avoids boot failure when a target `ethN` is already occupied or the NIC arrives after the rename unit runs. The name itself does not establish WAN/LAN roles; select the intended interface in the network wizard.

## Verify and recover

After installation or a reboot, verify the actual name, addresses and default route:

```sh
ip -br link
ip -br addr
ip route show default
systemctl status packetmotion-dhcp.service
journalctl -b -u packetmotion-dhcp.service
```

For DHCP, confirm the selected interface name shown by `ip -br link` matches `ExecStart` in `/usr/local/sbin/packetmotion-dhcp`, then check its lease and service logs. The bootstrap does not configure DHCP for every host interface; the operator selects one uplink. If networking is unavailable, use the console and configure the active interface name consistently in the host's network manager. No automatic rename rollback is needed because this version does not change interface names.

Changing from static configuration to DHCP may leave a previous static address or default route; the installer calls this out but does not claim to remove every external manager's state. Review `/etc/frr/frr.conf`, `/etc/network/interfaces*`, systemd-networkd, NetworkManager, netplan and local scripts for competing configuration. Avoid running multiple managers on the same interface.

## Verification evidence

Run `bash -n sdwan-edge/sdwan-provisioning-scripts/packetmotion-fabric-bootstrap-v1.8.sh` from repository root for syntax validation. A successful syntax check does not prove DHCP lease acquisition or real Debian boot behavior. DHCP, management connectivity and recovery remain UNVERIFIED until tested on an isolated Debian 12/13 appliance.
