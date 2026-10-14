# Debian appliance bootstrap

`packetmotion-fabric-bootstrap-v1.8.sh` is an interactive root installer for Debian 12/13. It installs packages and changes host networking, FRR, SSH (only when selected), hostname and forwarding. Run only on an authorized appliance/lab with console recovery access; it is separate from the read-only Go management agent.

## Automatic Ethernet names

At the end of installation, the script scans physical Ethernet ports under `/sys/class/net`, validates permanent unicast MAC addresses, sorts lowercase MACs in ascending order, and stages `eth0`, `eth1`, etc. Zero-padded MAC sorting is numeric byte order. Example:

| Current | MAC | Next boot |
|---|---|---|
| ens34 | 00:50:56:00:00:01 | eth0 |
| ens33 | 00:50:56:00:00:02 | eth1 |

Loopback, wireless, bridges, VLANs, WireGuard and other virtual interfaces are excluded. MACs must be unique; MAC changes or adding/removing ports require reviewing/restaging the mapping, rather than silently shifting existing physical port assignments. VM cloning must preserve unique stable MACs. MAC order determines port numbers; it does not identify WAN/LAN roles.

The bootstrap leaves active interface names in place and stages a boot-only systemd service. After udev settles, before sysinit/network startup, it renames all changing ports through temporary `pmnicN` names and then assigns final `ethN` names. This handles existing eth0/eth1 swaps. Direct `.link` assignment to `ethN` can collide with kernel-assigned names; see [systemd's naming guidance](https://github.com/systemd/systemd/blob/main/man/systemd.link.xml). Existing GRUB arguments are retained.

The service refuses to rename a changing port already marked UP, detects missing/extra hardware and virtual interfaces occupying target names, and reverses completed renames if an operation fails. Supported networking/FRR services depend on successful naming. Failure requires console recovery; networking is not allowed to start against an incorrect port mapping.

## Configuration migration

Before reboot, the installer backs up and simultaneously updates exact interface tokens in these known files:

- `/etc/network/interfaces` and `/etc/network/interfaces.d/*`;
- systemd `.network`/`.netdev`, NetworkManager connection profiles, netplan YAML, dhcpcd and default networking configuration;
- FRR `.conf`, nftables configuration/includes under `/etc/nftables.d`, and WireGuard `.conf`;
- PacketMotion DHCP and link/DNS helper scripts.

VLAN/alias suffixes are retained (`ens33.100` becomes `eth0.100`); similarly prefixed unrelated tokens remain untouched. File permissions and ownership are retained. Backups and transaction metadata live in a private directory under `/var/lib/packetmotion-interface-names`. Configuration is staged after the bootstrap's final FRR save so later installer writes do not undo the migration.

Competing custom naming rules, external ifupdown includes, matching wildcard selectors, symlink configs, nonpermanent/duplicate MACs and early-boot networking command-line parameters stop staging. The helper also refuses to overwrite foreign service configuration. Repeated staging with unchanged hardware/configuration is a no-op. Modified staged files are preserved and require review before restaging or rollback.

The migration is bounded to the paths above: inspect custom scripts, other firewall includes, additional network managers and initramfs/cloud networking before reboot. Staged files refer to future names; do not reload networking or FRR between staging and reboot. The reboot prompt defaults to later. No live rename or reboot is performed while editing/testing this repository.

## Verify and recover

Use the VM/physical console for the first reboot, then verify actual names/MACs, addresses and default route:

```sh
ip -br link
ip -br addr
ip route show default
systemctl status packetmotion-interface-names.service
journalctl -b -u packetmotion-interface-names.service
```

Confirm SSH and management connectivity on the intended port. Names are only staged until reboot; installation output is not proof that boot renaming or connectivity succeeded.

From the console, restore task-owned configuration and remove the boot enablement:

```sh
/usr/local/libexec/packetmotion-interface-names rollback
systemctl daemon-reload
reboot
```

Rollback performs no live rename. It restores original files and removes generated service/drop-ins and its enablement link. It refuses to overwrite files changed since staging; reconcile those files manually against the private backup first. If power/process loss leaves an incomplete transaction, rollback recognizes both pre-write and staged content. Keep backups until connectivity is verified. The installed helper remains available for recovery.

## Verification evidence

Run `node --test tests/bootstrap-interface-names.test.mjs` from repository root. It extracts the embedded helper and tests isolated filesystem fixtures and mocked rename commands, with no host network mutations. The root tests are also included by the Controller's `npm test`.

Bash syntax, fixture behavior and Debian container static systemd/ShellCheck validation do not prove a real Debian boot. VM boot, NIC discovery timing, actual name swaps, management connectivity and reboot rollback remain UNVERIFIED until tested on an isolated Debian 12/13 appliance.
