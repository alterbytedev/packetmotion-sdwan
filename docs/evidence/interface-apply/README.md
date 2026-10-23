# Interface apply evidence — 2026-10-22

`namespace-lifecycle-2026-10-22.txt` records the passing isolated Linux network/mount namespace lifecycle. It ran the real source agent binary and actual ip/nft operations: static address/MTU apply, matching confirmation, service restart, interrupted rollback, actual 60-second missing-confirmation rollback, failed candidate suppression and VLAN create/delete. This does not prove physical switch reachability or Debian reboot/systemd watchdog execution.

Reproduction (requires an explicitly disposable root Linux environment with iproute2, nftables and Go 1.27.2):

```sh
go -C sdwan-edge build -o /tmp/packetmotion-interface-apply-agent ./cmd/fabric-agent
unshare --mount --net --propagation private env FABRIC_INTERFACE_LAB=1 FABRIC_INTERFACE_BINARY=/tmp/packetmotion-interface-apply-agent go -C sdwan-edge test ./cmd/fabric-agent -run '^TestInterfaceGuardNamespaceLifecycle$' -count=1 -v
unshare --mount --net --propagation private env FABRIC_INTERFACE_LAB=1 go -C sdwan-edge test ./internal/network -run '^TestInterfaceEngineNamespaceVLAN$' -count=1 -v
```

Tests refuse shared network/mount namespaces. Do not remove those checks.

`../browser/interface-apply/` contains reviewed desktop/mobile UI evidence. Browser commit results are synthetic fixtures; these images do not establish kernel execution. TLS agent protocol and disposable controller integration tests separately cover authenticated reporting, nonce binding, deduplication, reservations and corrected retries.

The supplied Hub received only an agent software upgrade. Its real heartbeat reported 0.4.0, ens33 192.168.160.142/24, ens34–ens36 unassigned and tunnel 10.250.0.2/31. No physical interface apply was performed: ens36 switch mapping, participating Edge and console recovery remain unknown. See the operation guide and change log for that upgrade and rollback.
