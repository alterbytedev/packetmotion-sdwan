package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"packetmotion/fabric-agent/internal/identity"
	"packetmotion/fabric-agent/internal/network"
)

const networkOverride = "[Service]\nEnvironment=FABRIC_WIREGUARD_ENABLED=1\nCapabilityBoundingSet=CAP_NET_ADMIN\nAmbientCapabilities=CAP_NET_ADMIN\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK\n"
const networkOverridePath = "/etc/systemd/system/fabric-agent.service.d/90-packetmotion-wireguard.conf"

type serviceProcess struct {
	pid       string
	directory string
	enabled   bool
}

// Inspect the running process rather than decoding systemd's escaped ExecStart.
// ExecStart, custom arguments and the private state directory are never rewritten.
func inspectService(ctx context.Context) (serviceProcess, error) {
	var result serviceProcess
	data, err := serviceCommand(ctx, "show", "--property=MainPID", "--value", "fabric-agent.service")
	if err != nil {
		return result, err
	}
	result.pid = strings.TrimSpace(string(data))
	pid, err := strconv.Atoi(result.pid)
	if err != nil || pid <= 0 {
		return result, errors.New("agent is stopped; start fabric-agent.service and retry")
	}
	executable, err := os.Executable()
	if err != nil {
		return result, err
	}
	running, err := os.Readlink("/proc/" + result.pid + "/exe")
	if err != nil || running != executable {
		return result, errors.New("run the installed service binary; restart the service after an upgrade, then retry")
	}
	args, err := os.ReadFile("/proc/" + result.pid + "/cmdline")
	if err != nil {
		return result, errors.New("cannot inspect agent process; run with sudo")
	}
	environment, err := os.ReadFile("/proc/" + result.pid + "/environ")
	if err != nil {
		return result, errors.New("cannot inspect agent environment; run with sudo")
	}
	return parseServiceProcess(result.pid, strings.Split(strings.TrimSuffix(string(args), "\x00"), "\x00"), strings.Split(string(environment), "\x00"))
}

func parseServiceProcess(pid string, args, environment []string) (serviceProcess, error) {
	result := serviceProcess{pid: pid, directory: "/var/lib/packetmotion"}
	if len(args) < 2 || args[1] != "run" {
		return result, errors.New("unsupported service command; expected fabric-agent run")
	}
	for _, value := range environment {
		if value == "FABRIC_WIREGUARD_ENABLED=1" {
			result.enabled = true
		}
	}
	for i := 2; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--state-dir" || arg == "-state-dir":
			i++
			if i >= len(args) {
				return result, errors.New("missing service state directory")
			}
			result.directory = args[i]
		case strings.HasPrefix(arg, "--state-dir=") || strings.HasPrefix(arg, "-state-dir="):
			result.directory = strings.SplitN(arg, "=", 2)[1]
		case arg == "--enable-wireguard" || arg == "-enable-wireguard":
			result.enabled = true
		case strings.HasPrefix(arg, "--enable-wireguard=") || strings.HasPrefix(arg, "-enable-wireguard="):
			enabled, err := strconv.ParseBool(strings.SplitN(arg, "=", 2)[1])
			if err != nil || !enabled {
				return result, errors.New("service explicitly disables WireGuard; remove its --enable-wireguard=false override locally and retry")
			}
			result.enabled = true
		}
	}
	if !filepath.IsAbs(result.directory) {
		return result, errors.New("service state directory must be absolute")
	}
	return result, nil
}

func serviceCommand(ctx context.Context, args ...string) ([]byte, error) {
	callCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	// Do not include subprocess output in errors: journals/environment can contain secrets.
	output, err := exec.CommandContext(callCtx, "/usr/bin/systemctl", args...).Output()
	if err != nil {
		return nil, fmt.Errorf("systemd %s failed; inspect sudo systemctl status fabric-agent --no-pager locally", args[0])
	}
	return output, nil
}

// Each replacement is atomic and synced; only our own drop-in is managed.
func writeOverride(path string, value []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm()&0022 != 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		return errors.New("unsafe systemd drop-in directory")
	}
	if info, err = os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return errors.New("refusing non-regular activation override")
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	file, err := os.CreateTemp(dir, ".wireguard-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(value)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(file.Name(), path); err != nil {
		return err
	}
	parent, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer parent.Close()
	return parent.Sync()
}

func activateService(ctx context.Context, path string, command func(context.Context, ...string) ([]byte, error), verify func(context.Context) error) error {
	previous, err := os.ReadFile(path)
	existed := err == nil
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err = writeOverride(path, []byte(networkOverride)); err != nil {
		return err
	}
	for _, args := range [][]string{{"daemon-reload"}, {"restart", "fabric-agent.service"}, {"is-active", "--quiet", "fabric-agent.service"}, {"verify"}} {
		if args[0] == "verify" {
			if verify != nil {
				err = verify(ctx)
			}
		} else {
			_, err = command(ctx, args...)
		}
		if err != nil {
			restoreErr := error(nil)
			if existed {
				restoreErr = writeOverride(path, previous)
			} else {
				restoreErr = os.Remove(path)
			}
			// Recovery has its own deadline, even when the activation context was cancelled.
			recovery, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			_, reloadErr := command(recovery, "daemon-reload")
			_, restartErr := command(recovery, "restart", "fabric-agent.service")
			if restoreErr != nil || reloadErr != nil || restartErr != nil {
				return errors.New("activation failed and service recovery needs attention; use the VM console to inspect fabric-agent service/drop-ins; identity and network recovery files were preserved")
			}
			return errors.New("activation failed; previous override restored and service restarted; inspect sudo journalctl -u fabric-agent -n 80 --no-pager locally before retrying")
		}
	}
	return nil
}

func lockNetworkService(directory string) (*os.File, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		return nil, errors.New("unsafe installer lock directory; inspect locally before retrying")
	}
	file, err := os.OpenFile(filepath.Join(directory, "install.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, errors.New("unsafe installer lock file")
	}
	if err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, errors.New("another installer or activation is running; retry after it finishes")
	}
	return file, nil
}

func networkCLI(args []string, writer io.Writer) error {
	if len(args) > 0 && args[0] == "enable-interfaces" {
		return enableInterfacesCLI(args[1:], writer)
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "help") {
		_, err := fmt.Fprintln(writer, "Usage: fabric-agent network inspect | sudo fabric-agent network enable|status\ninspect: read-only interface, VLAN, IPv4 route and network-service discovery; no enrollment required.\nDedicated interface apply: sudo fabric-agent network enable-interfaces --interfaces ens36 --confirm-exclusive\nUse only mapped dedicated NICs with console recovery. Management/WAN DHCP and advertisement are not enabled by this command.\nLocal WireGuard activation and routing retain their separate authorizations.")
		return err
	}
	if len(args) != 1 || (args[0] != "enable" && args[0] != "status" && args[0] != "inspect") {
		return errors.New("usage: fabric-agent network inspect | sudo fabric-agent network enable|status")
	}
	if args[0] == "inspect" {
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		return inspectHostNetwork(ctx, writer)
	}
	if os.Geteuid() != 0 {
		return errors.New("local network inspection/activation requires sudo; retry sudo fabric-agent network " + args[0])
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	// Share the installer's lock: activation must not race an upgrade or identity replacement.
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
		return errors.New("enrolled service identity unavailable; preserve state and inspect enrollment/service permissions")
	}
	if args[0] == "status" {
		return printNetworkStatus(ctx, writer, process, state)
	}
	if process.enabled {
		fmt.Fprintln(writer, "Local WireGuard activation is already enabled; no restart needed.")
		return printNetworkStatus(ctx, writer, process, state)
	}
	for _, binary := range []string{"/usr/sbin/ip", "/usr/bin/wg", "/usr/sbin/nft"} {
		info, err := os.Stat(binary)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
			return fmt.Errorf("missing required tool %s; install iproute2, wireguard-tools and nftables, then retry", binary)
		}
	}
	fmt.Fprintln(writer, "Checking controller authentication before local activation…")
	if err = localStatus(ctx, io.Discard, process.directory, state.NodeID, true); err != nil {
		return errors.New("controller check failed; restore management connectivity before enabling WireGuard; run sudo fabric-agent status --check with the service state directory")
	}
	// Reuse the engine's read-only collision and management-route validation.
	engine, plan, err := activationPlan(ctx, process.directory, state)
	if err != nil {
		return err
	}
	if err = engine.CheckActivation(ctx, plan); err != nil {
		return fmt.Errorf("network preflight refused activation: %w; correct local routes/configuration and retry", err)
	}
	current, err := inspectService(ctx)
	if err != nil || current != process {
		return errors.New("agent restarted during preflight; retry activation")
	}
	fmt.Fprintln(writer, "Enabling owned WireGuard apply and restarting fabric-agent; routing authorization is unchanged.")
	verify := func(checkCtx context.Context) error {
		timer := time.NewTimer(3 * time.Second)
		defer timer.Stop()
		select {
		case <-checkCtx.Done():
			return checkCtx.Err()
		case <-timer.C:
		}
		next, checkErr := inspectService(checkCtx)
		if checkErr != nil {
			return checkErr
		}
		if !next.enabled || next.directory != process.directory {
			return errors.New("service activation not effective")
		}
		return localStatus(checkCtx, io.Discard, next.directory, state.NodeID, true)
	}
	if err = activateService(ctx, networkOverridePath, serviceCommand, verify); err != nil {
		return err
	}
	next, err := inspectService(ctx)
	if err != nil {
		return err
	}
	if !next.enabled {
		return errors.New("service override did not activate WireGuard; inspect later systemd overrides locally")
	}
	fmt.Fprintln(writer, "Local activation enabled. Configuration apply and handshake are checked separately; refresh Connections after the next check-in.")
	return printNetworkStatus(ctx, writer, next, state)
}

func activationPlan(ctx context.Context, directory string, state identity.State) (network.Engine, network.Plan, error) {
	engine := network.Engine{Directory: directory, NodeID: state.NodeID}
	var plan network.Plan
	origin, err := url.Parse(state.AgentURL)
	if err != nil || origin.Hostname() == "" {
		return engine, plan, errors.New("invalid controller origin")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, origin.Hostname())
	if err != nil || len(addresses) == 0 {
		return engine, plan, errors.New("controller address lookup failed; repair DNS and retry")
	}
	for _, address := range addresses {
		engine.ManagementIPs = append(engine.ManagementIPs, address.IP.String())
	}
	data, err := os.ReadFile(filepath.Join(directory, "desired.json"))
	if os.IsNotExist(err) {
		return engine, plan, nil
	}
	if err != nil {
		return engine, plan, errors.New("cannot read staged configuration")
	}
	var desired struct {
		Wireguard *network.Plan `json:"wireguard"`
	}
	if json.Unmarshal(data, &desired) != nil {
		return engine, plan, errors.New("invalid staged configuration; inspect service reconciliation before enabling")
	}
	if desired.Wireguard != nil {
		plan = *desired.Wireguard
	}
	return engine, plan, nil
}

func printNetworkStatus(ctx context.Context, writer io.Writer, process serviceProcess, state identity.State) error {
	fmt.Fprintf(writer, "Device: %s\nReceived revision: %d (receipt is not apply)\n", state.NodeID, state.Revision)
	if !process.enabled {
		fmt.Fprintln(writer, "Local activation: disabled\nNext: sudo fabric-agent network enable")
		return nil
	}
	fmt.Fprintln(writer, "Local activation: enabled")
	data, err := os.ReadFile(filepath.Join(process.directory, "network-applied.json"))
	if os.IsNotExist(err) {
		fmt.Fprintln(writer, "Apply: awaiting successful apply; refresh Connections or inspect sudo journalctl -u fabric-agent -n 80 --no-pager locally.")
		return nil
	}
	if err != nil {
		return errors.New("cannot read local apply journal; inspect state permissions")
	}
	var plan network.Plan
	if json.Unmarshal(data, &plan) != nil {
		return errors.New("invalid apply journal; preserve recovery files and inspect service logs")
	}
	if _, err = os.Stat(filepath.Join(process.directory, "network-pending.json")); err == nil {
		fmt.Fprintln(writer, "Apply: recovery pending; inspect service logs and preserve network recovery files.")
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	engine := network.Engine{Directory: process.directory, NodeID: state.NodeID}
	handshakes, err := engine.Handshakes(ctx, plan)
	if err != nil {
		return errors.New("live handshake inspection failed; inspect agent logs and refresh controller observations")
	}
	fmt.Fprintln(writer, "Apply journal: previous successful plan; verify current revision/checksum in controller Connections.")
	if len(handshakes) == 0 {
		fmt.Fprintln(writer, "Tunnels: none in the applied journal. Save draft and Deploy hub connections if needed.")
		return nil
	}
	recent := true
	for _, item := range handshakes {
		age := time.Now().Unix() - item.LastHandshake
		if item.LastHandshake == 0 || age > 180 || age < -300 {
			recent = false
		}
		fmt.Fprintf(writer, "Tunnel %s: last handshake Unix %d\n", item.Name, item.LastHandshake)
	}
	if recent {
		fmt.Fprintln(writer, "Recent handshake observed; verify tunnel-IP reachability separately.")
	} else {
		fmt.Fprintln(writer, "Awaiting recent handshake. Check counterpart activation, Hub endpoint, UDP port and firewall/NAT in Connections.")
	}
	return nil
}
