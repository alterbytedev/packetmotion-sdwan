package network

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

type routingLab struct {
	t   *testing.T
	ctx context.Context
}

func (l routingLab) command(args ...string) string {
	l.t.Helper()
	data, err := exec.CommandContext(l.ctx, args[0], args[1:]...).CombinedOutput()
	if err != nil {
		l.t.Fatalf("lab command %v failed: %v (%s)", args, err, data)
	}
	return string(data)
}
func (l routingLab) namespace() int {
	l.t.Helper()
	process := exec.Command("unshare", "--net", "sleep", "180")
	if err := process.Start(); err != nil {
		l.t.Fatal(err)
	}
	l.t.Cleanup(func() { _ = process.Process.Kill(); _ = process.Wait() })
	parent, _ := os.Readlink("/proc/self/ns/net")
	for i := 0; i < 100; i++ {
		target, _ := os.Readlink(fmt.Sprintf("/proc/%d/ns/net", process.Process.Pid))
		if target != "" && target != parent {
			return process.Process.Pid
		}
		time.Sleep(5 * time.Millisecond)
	}
	l.t.Fatal("namespace did not start")
	return 0
}
func (l routingLab) ns(pid int, args ...string) string {
	return l.command(append([]string{"nsenter", "-t", strconv.Itoa(pid), "-n"}, args...)...)
}
func (l routingLab) runner(pid int, sockets string) Runner {
	return func(ctx context.Context, name string, args []string, input string) ([]byte, error) {
		binary := map[string]string{"ip": "/usr/sbin/ip", "wg": "/usr/bin/wg", "nft": "/usr/sbin/nft", "vtysh": "/usr/bin/vtysh"}[name]
		if binary == "" {
			return nil, errors.New("unsupported lab command")
		}
		if name == "vtysh" {
			args = append([]string{"--vty_socket", sockets}, args...)
		}
		command := exec.CommandContext(ctx, "nsenter", append([]string{"-t", strconv.Itoa(pid), "-n", binary}, args...)...)
		command.Stdin = strings.NewReader(input)
		output, err := command.Output()
		if err != nil {
			if name == "vtysh" {
				if exit, ok := err.(*exec.ExitError); ok {
					return nil, fmt.Errorf("lab vtysh failed: %s", exit.Stderr)
				}
			}
			return nil, fmt.Errorf("lab %s operation failed", name)
		}
		return output, nil
	}
}
func (l routingLab) daemon(pid int, name, sockets, config string) {
	l.t.Helper()
	args := []string{"-t", strconv.Itoa(pid), "-n", "/usr/lib/frr/" + name, "-f", config, "-i", filepath.Join(sockets, name+".pid"), "--vty_socket", sockets, "-z", filepath.Join(sockets, "zserv.api"), "-u", "root", "-g", "root", "-P", "0"}
	if name == "staticd" || name == "mgmtd" {
		args = append(args[:4], args[6:]...)
	}
	if name == "bgpd" {
		args = append(args, "-S")
	}
	args = append(args, "-N", fmt.Sprintf("pmtest%d", pid))
	group, err := user.LookupGroup("frrvty")
	if err != nil {
		l.t.Fatal(err)
	}
	// Set supplementary membership only in the disposable daemon process.
	command := exec.Command("setpriv", append([]string{"--groups", group.Gid, "nsenter"}, args...)...)
	file, err := os.Create(filepath.Join(sockets, name+".log"))
	if err != nil {
		l.t.Fatal(err)
	}
	command.Stdout = file
	command.Stderr = file
	if err = command.Start(); err != nil {
		l.t.Fatal(err)
	}
	l.t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait(); _ = file.Close() })
	for i := 0; i < 100; i++ {
		if _, err := os.Stat(filepath.Join(sockets, name+".vty")); err == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	data, _ := os.ReadFile(filepath.Join(sockets, name+".log"))
	l.t.Fatalf("%s failed to start (%s)", name, data)
}
func TestNamespaceRoutedLANLifecycle(t *testing.T) {
	if os.Getenv("FABRIC_ROUTING_LAB") != "1" {
		t.Skip("requires explicit disposable namespace routing lab")
	}
	self, _ := os.Readlink("/proc/self/ns/net")
	initial, _ := os.Readlink("/proc/1/ns/net")
	if self == "" || self == initial {
		t.Fatal("refusing host network namespace")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	lab := routingLab{t, ctx}
	// FRR resolves supplementary groups from NSS rather than the child process.
	// Overlay group membership only inside this disposable mount namespace.
	mountSelf, _ := os.Readlink("/proc/self/ns/mnt")
	mountInitial, _ := os.Readlink("/proc/1/ns/mnt")
	if mountSelf == "" || mountSelf == mountInitial {
		t.Fatal("refusing host mount namespace")
	}
	lab.command("mount", "--make-rprivate", "/")
	groups, err := os.ReadFile("/etc/group")
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(string(groups), "\n")
	for i, line := range lines {
		if strings.HasPrefix(line, "frrvty:") {
			fields := strings.Split(line, ":")
			if fields[3] == "" {
				fields[3] = "root"
			} else {
				fields[3] += ",root"
			}
			lines[i] = strings.Join(fields, ":")
		}
	}
	groupFile := filepath.Join(t.TempDir(), "group")
	if err := os.WriteFile(groupFile, []byte(strings.Join(lines, "\n")), 0644); err != nil {
		t.Fatal(err)
	}
	lab.command("mount", "--bind", groupFile, "/etc/group")
	t.Cleanup(func() { _ = exec.Command("umount", "/etc/group").Run() })

	edgePID, hubPID, edgeHost, hubHost := lab.namespace(), lab.namespace(), lab.namespace(), lab.namespace()
	pair := func(aPID, bPID int, aName, bName string) {
		lab.command("ip", "link", "add", aName, "type", "veth", "peer", "name", bName)
		lab.command("ip", "link", "set", aName, "netns", strconv.Itoa(aPID))
		lab.command("ip", "link", "set", bName, "netns", strconv.Itoa(bPID))
	}
	pair(edgePID, hubPID, "edgewan", "hubwan")
	pair(edgePID, edgeHost, "edgelan", "edgehost")
	pair(hubPID, hubHost, "hublan", "hubhost")
	for _, side := range []struct {
		pid       int
		dev, addr string
	}{{edgePID, "edgewan", "192.0.2.2/24"}, {hubPID, "hubwan", "192.0.2.1/24"}, {edgeHost, "edgehost", "10.61.0.10/24"}, {hubHost, "hubhost", "10.62.0.10/24"}} {
		lab.ns(side.pid, "ip", "address", "add", side.addr, "dev", side.dev)
		lab.ns(side.pid, "ip", "link", "set", side.dev, "up")
		lab.ns(side.pid, "ip", "link", "set", "lo", "up")
	}
	lab.ns(edgeHost, "ip", "route", "add", "default", "via", "10.61.0.1")
	lab.ns(hubHost, "ip", "route", "add", "default", "via", "10.62.0.1")
	edgeDir, hubDir := privateDirectory(t), privateDirectory(t)
	edgeSockets, hubSockets := filepath.Join(edgeDir, "frr"), filepath.Join(hubDir, "frr")
	for _, path := range []string{edgeSockets, hubSockets} {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	config := filepath.Join(t.TempDir(), "frr.conf")
	if err := os.WriteFile(config, []byte("frr defaults traditional\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, side := range []struct {
		pid     int
		sockets string
	}{{edgePID, edgeSockets}, {hubPID, hubSockets}} {
		runtimeDir := fmt.Sprintf("/run/frr/pmtest%d", side.pid)
		if err := os.Mkdir(runtimeDir, 0700); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.RemoveAll(runtimeDir) })
		for _, name := range []string{"mgmtd", "zebra", "staticd", "bgpd"} {
			lab.daemon(side.pid, name, side.sockets, config)
		}
	}
	edge := Engine{Directory: edgeDir, NodeID: "routed-edge", Run: lab.runner(edgePID, edgeSockets), AllowRouting: true, LANInterface: "edgelan", ManagementIPs: []string{"192.0.2.1"}}
	hub := Engine{Directory: hubDir, NodeID: "routed-hub", Run: lab.runner(hubPID, hubSockets), AllowRouting: true, LANInterface: "hublan", ManagementIPs: []string{"192.0.2.2"}}
	_, edgePublic, err := Key(edgeDir)
	if err != nil {
		t.Fatal(err)
	}
	_, hubPublic, err := Key(hubDir)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := "192.0.2.1:22000"
	name := "pm000000000001"
	edgePlan := Plan{Tunnels: []Tunnel{{Name: name, Address: "10.250.0.1/31", PeerAddress: "10.250.0.0", PublicKey: hubPublic, Endpoint: &endpoint, Keepalive: 25, AllowedPrefixes: []string{"10.62.0.0/24"}}}, Routing: &Routing{
		LAN: LAN{InterfaceName: "edgelan", Address: "10.61.0.1/24", AdvertisedPrefix: "10.61.0.0/24"}, ProtectedPrefixes: []string{"192.0.2.0/24"},
		BGP: &BGP{LocalASN: 65001, RouterID: "10.61.0.1", Peers: []BGPPeer{{InterfaceName: name, Address: "10.250.0.0", RemoteASN: 65000, ImportPrefixes: []string{"10.62.0.0/24"}, ExportPrefixes: []string{"10.61.0.0/24"}, LocalPreference: 200}}},
	}}
	hubPlan := Plan{Tunnels: []Tunnel{{Name: name, Address: "10.250.0.0/31", PeerAddress: "10.250.0.1", PublicKey: edgePublic, ListenPort: 22000, AllowedPrefixes: []string{"10.61.0.0/24"}}}, Routing: &Routing{
		LAN: LAN{InterfaceName: "hublan", Address: "10.62.0.1/24", AdvertisedPrefix: "10.62.0.0/24"}, ProtectedPrefixes: []string{"192.0.2.0/24"},
		BGP: &BGP{LocalASN: 65000, RouterID: "10.62.0.1", Peers: []BGPPeer{{InterfaceName: name, Address: "10.250.0.1", RemoteASN: 65001, ImportPrefixes: []string{"10.61.0.0/24"}, ExportPrefixes: []string{"10.62.0.0/24"}, LocalPreference: 100}}},
	}}
	// Preserve an existing FRR-owned management default throughout all BGP operations.
	if _, err = edge.Run(ctx, "vtysh", []string{"-c", "configure terminal", "-c", "ip route 0.0.0.0/0 192.0.2.1 edgewan", "-c", "end"}, ""); err != nil {
		t.Fatal(err)
	}
	if err = edge.Apply(ctx, edgePlan, nil); err != nil {
		t.Fatal("edge apply", err)
	}
	if err = hub.Apply(ctx, hubPlan, nil); err != nil {
		t.Fatal("hub apply", err)
	}
	wait := func(check func() bool, message string) {
		t.Helper()
		for i := 0; i < 80; i++ {
			if check() {
				return
			}
			time.Sleep(250 * time.Millisecond)
		}
		summary, _ := edge.Run(ctx, "vtysh", []string{"-c", "show bgp ipv4 unicast summary json"}, "")
		routes, _ := edge.Run(ctx, "ip", []string{"-j", "route", "show"}, "")
		t.Fatalf("%s: summary=%s routes=%s", message, summary, routes)
	}
	wait(func() bool {
		peers, err := edge.BGPPeers(ctx, edgePlan)
		return err == nil && len(peers) == 1 && peers[0].State == "Established" && peers[0].ReceivedPrefixes == 1
	}, "BGP did not establish/learn approved LAN")
	wait(func() bool {
		data, err := edge.Run(ctx, "ip", []string{"-j", "route", "show", "10.62.0.0/24"}, "")
		return err == nil && strings.Contains(string(data), "10.250.0.0")
	}, "approved BGP kernel route missing")
	configText, err := edge.runningFRR(ctx)
	if err != nil || !strings.Contains(configText, "ip route 0.0.0.0/0 192.0.2.1 edgewan") {
		t.Fatal("management static route changed")
	}
	// A failed management confirmation must restore the full LAN/BGP bundle.
	failed := edgePlan
	failed.Routing = &Routing{LAN: edgePlan.Routing.LAN, ProtectedPrefixes: edgePlan.Routing.ProtectedPrefixes, BGP: &BGP{LocalASN: 65001, RouterID: "10.61.0.2", Peers: edgePlan.Routing.BGP.Peers}}
	failed.Routing.LAN.Address = "10.61.0.2/24"
	if err := edge.Apply(ctx, failed, func(context.Context) error { return errors.New("injected management failure") }); err == nil {
		t.Fatal("failed confirmation committed")
	}
	restored, err := edge.lanPresent(ctx, edgePlan.Routing)
	if err != nil || !restored {
		t.Fatal("previous LAN not restored", err)
	}
	restored, err = edge.bgpPresent(ctx, edgePlan)
	if err != nil || !restored {
		t.Fatal("previous BGP not restored", err)
	}
	wait(func() bool {
		peers, err := edge.BGPPeers(ctx, edgePlan)
		return err == nil && len(peers) == 1 && peers[0].State == "Established" && peers[0].ReceivedPrefixes == 1
	}, "BGP did not recover after rollback")
	// Routing alone must not permit transit while the isolation guard is active.
	if exec.CommandContext(ctx, "nsenter", "-t", strconv.Itoa(edgeHost), "-n", "ping", "-c", "1", "-W", "1", "10.62.0.10").Run() == nil {
		t.Fatal("transit allowed without explicit permission")
	}
	// A peer advertising an additional unauthorized/default prefix cannot install it.
	_, err = hub.Run(ctx, "vtysh", []string{"-c", "configure terminal", "-c", "router bgp 65000", "-c", "address-family ipv4 unicast", "-c", "network 192.0.2.0/24", "-c", "end"}, "")
	if err != nil {
		t.Fatal(err)
	}
	routes, err := edge.Run(ctx, "ip", []string{"-j", "route", "show", "proto", "bgp"}, "")
	if err != nil {
		t.Fatal(err)
	}
	var received []struct {
		Destination string `json:"dst"`
	}
	if json.Unmarshal(routes, &received) != nil {
		t.Fatal("invalid route inventory")
	}
	for _, route := range received {
		if route.Destination != "10.62.0.0/24" {
			t.Fatal("unapproved BGP route installed")
		}
	}
	// Removing BGP/LAN intent restores only owned configuration and keeps management.
	if err = edge.Apply(ctx, Plan{Tunnels: []Tunnel{}}, nil); err != nil {
		t.Fatal(err)
	}
	after, err := edge.runningFRR(ctx)
	if err != nil || strings.Contains(after, "router bgp") || !strings.Contains(after, "ip route 0.0.0.0/0 192.0.2.1 edgewan") {
		t.Fatal("BGP cleanup affected unrelated management config")
	}
}
