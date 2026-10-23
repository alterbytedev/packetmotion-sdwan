package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"packetmotion/fabric-agent/internal/identity"
	"packetmotion/fabric-agent/internal/network"
)

//go:embed interface-guard.service
var interfaceGuardUnit string

func enableInterfacesCLI(args []string, writer io.Writer) error {
	flags := flag.NewFlagSet("network enable-interfaces", flag.ContinueOnError)
	flags.SetOutput(writer)
	names := flags.String("interfaces", "", "comma-separated dedicated physical interfaces")
	exclusive := flags.Bool("confirm-exclusive", false, "confirm these NICs are mapped, dedicated, unmanaged and have console recovery")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 || !*exclusive || *names == "" {
		return errors.New("use sudo fabric-agent network enable-interfaces --interfaces ens36 --confirm-exclusive after verifying the NIC mapping and console recovery")
	}
	if os.Geteuid() != 0 {
		return errors.New("local interface authorization requires sudo")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	lock, err := lockNetworkService("/run/packetmotion-installer")
	if err != nil {
		return err
	}
	defer lock.Close()
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	process, err := inspectService(ctx)
	if err != nil {
		return err
	}
	state, err := identity.Load(process.directory)
	if err != nil || !validNodeID(state.NodeID) {
		return errors.New("enrolled service identity required")
	}
	origin, err := url.Parse(state.AgentURL)
	if err != nil || origin.Hostname() == "" {
		return errors.New("invalid controller origin")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, origin.Hostname())
	if err != nil || len(addresses) == 0 {
		return errors.New("controller address lookup required before local authorization")
	}
	policy := network.InterfaceAuthorization{NodeID: state.NodeID, Interfaces: strings.Split(*names, ",")}
	if len(policy.Interfaces) > 16 {
		return errors.New("authorize at most 16 dedicated interfaces")
	}
	for _, address := range addresses {
		policy.ControllerIPs = append(policy.ControllerIPs, address.IP.String())
		if len(policy.ControllerIPs) == 16 {
			break
		}
	}
	var desired struct {
		Wireguard *network.Plan `json:"wireguard"`
	}
	if data, readErr := os.ReadFile(filepath.Join(process.directory, "desired.json")); readErr == nil {
		if json.Unmarshal(data, &desired) != nil {
			return errors.New("invalid staged configuration")
		}
	} else if !os.IsNotExist(readErr) {
		return readErr
	}
	for _, name := range policy.Interfaces {
		if !regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_.-]{0,14}$`).MatchString(name) {
			return errors.New("invalid physical interface name")
		}
		if desired.Wireguard != nil && desired.Wireguard.Routing != nil && desired.Wireguard.Routing.LAN.InterfaceName == name {
			return errors.New("interface already belongs to the LAN/routing engine")
		}
		c := network.InterfaceConfiguration{SchemaVersion: 1, NodeID: state.NodeID, InterfaceName: name, Kind: "physical", SafeCommitSeconds: 60, Interfaces: []network.InterfaceSetting{}}
		r, makeErr := network.NewInterfaceRequest("00000000-0000-0000-0000-000000000000", c)
		if makeErr != nil {
			return makeErr
		}
		if _, err = (network.InterfaceEngine{NodeID: state.NodeID, Authorization: policy}).Prepare(ctx, r, network.InterfaceBundle{}); err != nil {
			return fmt.Errorf("interface authorization refused: %s", network.InterfaceReason(err))
		}
	}
	if _, err = os.Stat(interfacePolicyPath); err == nil {
		return errors.New("interface policy already exists; review changes locally instead of overwriting existing authorization")
	} else if !os.IsNotExist(err) {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if err = verifyGuardExecutable(executable); err != nil {
		return err
	}
	unit, err := interfaceUnitFor(executable, process.directory)
	if err != nil {
		return err
	}
	unitPath := "/etc/systemd/system/fabric-interface-guard.service"
	if _, err = os.Lstat(unitPath); err == nil {
		return errors.New("interface guard unit already exists; review it locally instead of overwriting it")
	} else if !os.IsNotExist(err) {
		return err
	}
	for _, name := range []string{"pending.json", "confirmed.json"} {
		if _, err = os.Stat(filepath.Join(interfaceGuardDirectory, name)); err == nil {
			return errors.New("existing interface recovery state requires local review before authorizing a guard")
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	serialized, err := json.Marshal(policy)
	if err != nil {
		return err
	}
	if err = writeOverride(interfacePolicyPath, serialized); err != nil {
		return err
	}
	if err = writeOverride(unitPath, []byte(unit)); err != nil {
		_ = os.Remove(interfacePolicyPath)
		return err
	}
	if _, err = serviceCommand(ctx, "daemon-reload"); err != nil {
		_ = os.Remove(interfacePolicyPath)
		_ = os.Remove(unitPath)
		return err
	}
	if _, err = serviceCommand(ctx, "enable", "--now", "fabric-interface-guard.service"); err != nil {
		recovery, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, stopErr := serviceCommand(recovery, "disable", "--now", "fabric-interface-guard.service"); stopErr == nil {
			_ = os.Remove(interfacePolicyPath)
			_ = os.Remove(unitPath)
			_, _ = serviceCommand(recovery, "daemon-reload")
		}
		return errors.New("interface guard activation failed; inspect fabric-interface-guard.service locally; recovery journals were preserved")
	}
	fmt.Fprintln(writer, "Dedicated interface authorization installed. Queued controller commits may now apply with safe rollback. The agent reports readiness on its next heartbeat.")
	return nil
}
func interfaceUnitFor(executable, directory string) (string, error) {
	quote := func(value string) (string, error) {
		if !filepath.IsAbs(value) || strings.ContainsAny(value, "\r\n\x00") || strings.HasPrefix(value, "/root/") || strings.HasPrefix(value, "/home/") || strings.HasPrefix(value, "/run/user/") {
			return "", errors.New("invalid interface service path")
		}
		return strconv.Quote(strings.ReplaceAll(strings.ReplaceAll(value, "%", "%%"), "$", "$$")), nil
	}
	binary, err := quote(executable)
	if err != nil {
		return "", err
	}
	shared, err := quote(directory)
	if err != nil {
		return "", err
	}
	unit := strings.Replace(interfaceGuardUnit, "ExecStart=/usr/local/bin/fabric-agent interface-guard", "ExecStart="+binary+" interface-guard --state-dir "+shared, 1)
	unit = strings.Replace(unit, "ReadWritePaths=/var/lib/packetmotion", "ReadWritePaths="+shared, 1)
	return unit, nil
}

func verifyGuardExecutable(path string) error {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	for current := resolved; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || info.Mode().Perm()&0022 != 0 || info.Sys().(*syscall.Stat_t).Uid != 0 {
			return errors.New("interface guard executable and all parent directories must be root-owned and not group/world writable")
		}
		if current == resolved && (!info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0) {
			return errors.New("interface guard executable must be a regular executable file")
		}
		if current == filepath.Dir(current) {
			break
		}
	}
	return nil
}
