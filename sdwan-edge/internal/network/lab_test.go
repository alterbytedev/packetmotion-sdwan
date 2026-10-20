package network

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"packetmotion/fabric-agent/internal/controller"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Run only inside a disposable outer network namespace. Child namespaces and
// all veth interfaces are destroyed when the test exits. No host interfaces used.
func TestNamespaceWireguardLifecycle(t *testing.T) {
	if os.Getenv("FABRIC_WIREGUARD_LAB") != "1" {
		t.Skip("requires disposable Linux network namespace")
	}
	if os.Getenv("FABRIC_WIREGUARD_OUTER_NS") == "" {
		t.Fatal("outer namespace guard required")
	}
	selfNS, _ := os.Readlink("/proc/self/ns/net")
	initNS, _ := os.Readlink("/proc/1/ns/net")
	if selfNS == "" || selfNS == initNS {
		t.Fatal("refusing lab outside a disposable outer network namespace")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	run := func(args ...string) string {
		t.Helper()
		data, err := exec.CommandContext(ctx, args[0], args[1:]...).CombinedOutput()
		if err != nil {
			t.Fatalf("lab setup %v: %v (%s)", args, err, data)
		}
		return string(data)
	}
	namespace := func() int {
		cmd := exec.Command("unshare", "--net", "sleep", "120")
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
		// Wait until unshare has entered its namespace, rather than using a fixed sleep.
		parent, _ := os.Readlink("/proc/self/ns/net")
		for i := 0; i < 100; i++ {
			target, _ := os.Readlink(fmt.Sprintf("/proc/%d/ns/net", cmd.Process.Pid))
			if target != "" && target != parent {
				return cmd.Process.Pid
			}
			time.Sleep(5 * time.Millisecond)
		}
		t.Fatal("child namespace not ready")
		return 0
	}
	runner := func(pid int) Runner {
		return func(ctx context.Context, name string, args []string, input string) ([]byte, error) {
			binary := map[string]string{"ip": "/usr/sbin/ip", "wg": "/usr/bin/wg", "nft": "/usr/sbin/nft"}[name]
			command := exec.CommandContext(ctx, "nsenter", append([]string{"-t", strconv.Itoa(pid), "-n", binary}, args...)...)
			command.Stdin = strings.NewReader(input)
			data, err := command.Output()
			if err != nil {
				return nil, errors.New("lab network command failed")
			}
			return data, nil
		}
	}
	run("ip", "link", "set", "lo", "up")
	edgePID := namespace()
	hubPIDs := []int{namespace(), namespace()}
	edge := Engine{Directory: privateDirectory(t), NodeID: "edge", Run: runner(edgePID)}
	// A separate controller segment stays outside the selected Hub tunnels.
	run("ip", "link", "add", "controllerwan", "type", "veth", "peer", "name", "management")
	run("ip", "link", "set", "management", "netns", strconv.Itoa(edgePID))
	run("ip", "address", "add", "192.168.244.1/24", "dev", "controllerwan")
	run("ip", "link", "set", "controllerwan", "up")
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "address", "add", "192.168.244.2/24", "dev", "management")
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "link", "set", "management", "up")
	edge.ManagementIPs = []string{"192.168.244.1"}
	var revision atomic.Int64
	revision.Store(1)
	var requests atomic.Int64
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		if host != "192.168.244.2" {
			t.Errorf("controller traffic came from %s", host)
		}
		switch r.URL.Path {
		case "/api/agent/v1/desired":
			_ = json.NewEncoder(w).Encode(map[string]int64{"revision": revision.Load()})
		case "/api/agent/v1/heartbeat", "/api/agent/v1/ack":
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected management path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
		requests.Add(1)
	}))
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	_ = server.Listener.Close()
	server.Listener = listener
	server.Start()
	t.Cleanup(server.Close)
	origin := fmt.Sprintf("http://192.168.244.1:%d", listener.Addr().(*net.TCPAddr).Port)
	management := func() {
		t.Helper()
		route := run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "-j", "route", "get", "192.168.244.1")
		if !strings.Contains(route, `"dev":"management"`) {
			t.Fatalf("controller route changed: %s", route)
		}
		command := exec.CommandContext(ctx, "nsenter", "-t", strconv.Itoa(edgePID), "-n", os.Args[0], "-test.run=^TestNamespaceManagementHTTPHelper$")
		command.Env = append(os.Environ(), "FABRIC_NAMESPACE_CONTROLLER_URL="+origin, fmt.Sprintf("FABRIC_NAMESPACE_REVISION=%d", revision.Load()))
		if data, err := command.CombinedOutput(); err != nil {
			t.Fatalf("management transport failed: %v %s", err, data)
		}
	}
	management()
	_, edgePublic, err := Key(edge.Directory)
	if err != nil {
		t.Fatal(err)
	}
	edgePlan := Plan{Tunnels: []Tunnel{}}
	var hubEngines []Engine
	var hubPlans []Plan
	for i, pid := range hubPIDs {
		a, b := fmt.Sprintf("lh%d", i), fmt.Sprintf("le%d", i)
		run("ip", "link", "add", a, "type", "veth", "peer", "name", b)
		run("ip", "link", "set", a, "netns", strconv.Itoa(pid))
		run("ip", "link", "set", b, "netns", strconv.Itoa(edgePID))
		for _, side := range []struct {
			pid       int
			dev, addr string
		}{{pid, a, fmt.Sprintf("192.0.%d.1/24", i+2)}, {edgePID, b, fmt.Sprintf("192.0.%d.2/24", i+2)}} {
			run("nsenter", "-t", strconv.Itoa(side.pid), "-n", "ip", "addr", "add", side.addr, "dev", side.dev)
			run("nsenter", "-t", strconv.Itoa(side.pid), "-n", "ip", "link", "set", side.dev, "up")
			run("nsenter", "-t", strconv.Itoa(side.pid), "-n", "ip", "link", "set", "lo", "up")
		}
		hub := Engine{Directory: privateDirectory(t), NodeID: fmt.Sprintf("hub%d", i), Run: runner(pid)}
		_, public, err := Key(hub.Directory)
		if err != nil {
			t.Fatal(err)
		}
		name := fmt.Sprintf("pm%012x", i+1)
		hubAddress, edgeAddress := fmt.Sprintf("10.250.0.%d", 2*i), fmt.Sprintf("10.250.0.%d", 2*i+1)
		endpoint := fmt.Sprintf("192.0.%d.1:22000", i+2)
		hubPlan := Plan{Tunnels: []Tunnel{{Name: name, Address: hubAddress + "/31", PeerAddress: edgeAddress, PublicKey: edgePublic, ListenPort: 22000}}}
		if err = hub.Apply(ctx, hubPlan, nil); err != nil {
			t.Fatal(err)
		}
		hubEngines = append(hubEngines, hub)
		hubPlans = append(hubPlans, hubPlan)
		edgePlan.Tunnels = append(edgePlan.Tunnels, Tunnel{Name: name, Address: edgeAddress + "/31", PeerAddress: hubAddress, PublicKey: public, Endpoint: &endpoint, Keepalive: 25})
	}
	ping := func(address string) {
		t.Helper()
		run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ping", "-c", "1", "-W", "3", address)
	}
	if err = edge.Apply(ctx, edgePlan, func(context.Context) error { ping("192.0.2.1"); return nil }); err != nil {
		t.Fatal(err)
	}
	for _, tunnel := range edgePlan.Tunnels {
		ping(tunnel.PeerAddress)
	}
	observations, err := edge.Handshakes(ctx, edgePlan)
	if err != nil || len(observations) != 2 {
		t.Fatalf("missing handshakes: %v", err)
	}
	for _, h := range observations {
		if h.LastHandshake == 0 {
			t.Fatal("no real handshake")
		}
	}
	invalid := Plan{Tunnels: append([]Tunnel{}, edgePlan.Tunnels...)}
	invalid.Tunnels[0].Name = "eth0"
	if err = edge.Apply(ctx, invalid, nil); err == nil {
		t.Fatal("unsafe plan accepted")
	}
	ping("10.250.0.0")
	management()
	// An operator-installed route through a tunnel must fail before removal.
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "route", "add", "192.168.244.1/32", "dev", edgePlan.Tunnels[0].Name)
	if err = edge.Apply(ctx, Plan{Tunnels: []Tunnel{}}, nil); err == nil {
		t.Fatal("tunnel management route accepted")
	}
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "route", "del", "192.168.244.1/32")
	management()
	// Typed LAN apply must preserve management and restore the original NIC state.
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "link", "add", "lanspare", "type", "dummy")
	routed := Plan{Tunnels: edgePlan.Tunnels, Routing: &Routing{LAN: LAN{InterfaceName: "lanspare", Address: "10.61.0.1/24", AdvertisedPrefix: "10.61.0.0/24"}, ProtectedPrefixes: []string{"192.0.2.0/24", "192.0.3.0/24"}}}
	if err = edge.Apply(ctx, routed, nil); err == nil {
		t.Fatal("routing applied without local opt-in")
	}
	edge.AllowRouting = true
	edge.LANInterface = "lanspare"
	edge.ManagementIPs = []string{"192.168.244.1"}
	if err = edge.Apply(ctx, routed, nil); err != nil {
		t.Fatal(err)
	}
	present, err := edge.lanPresent(ctx, routed.Routing)
	if err != nil || !present {
		t.Fatal("LAN address not configured")
	}
	if err = edge.Apply(ctx, routed, nil); err != nil {
		t.Fatal("unchanged LAN did not reconcile safely", err)
	}
	changed := *routed.Routing
	changed.LAN.Address = "10.61.0.2/24"
	if err = edge.Apply(ctx, Plan{Tunnels: edgePlan.Tunnels, Routing: &changed}, func(context.Context) error { return errors.New("injected management verification failure") }); err == nil {
		t.Fatal("failed LAN revision accepted")
	}
	present, err = edge.lanPresent(ctx, routed.Routing)
	if err != nil || !present {
		t.Fatal("previous LAN not restored")
	}
	unsafe := *routed.Routing
	unsafe.LAN.InterfaceName = "le0"
	edge.LANInterface = "le0"
	if err = edge.Apply(ctx, Plan{Tunnels: edgePlan.Tunnels, Routing: &unsafe}, nil); err == nil {
		t.Fatal("management interface accepted")
	}
	edge.LANInterface = "lanspare"
	if err = edge.Apply(ctx, edgePlan, nil); err != nil {
		t.Fatal(err)
	}
	inventory, err := edge.addresses(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, link := range inventory {
		if link.Name == "lanspare" && (len(ipv4Addresses(link)) != 0 || strings.Contains(strings.Join(link.Flags, " "), "UP")) {
			t.Fatal("original LAN state not restored")
		}
	}
	ping("192.0.2.1")
	ping("10.250.0.0")
	// Prove the guard blocks forwarding even on a router with ip_forward=1.
	// The Edge intentionally acts as a hostile peer by widening its own AllowedIPs.
	lanPID := namespace()
	run("ip", "link", "add", "lanh", "type", "veth", "peer", "name", "lanc")
	run("ip", "link", "set", "lanh", "netns", strconv.Itoa(hubPIDs[0]))
	run("ip", "link", "set", "lanc", "netns", strconv.Itoa(lanPID))
	for _, side := range []struct {
		pid       int
		dev, addr string
	}{{hubPIDs[0], "lanh", "10.88.0.1/24"}, {lanPID, "lanc", "10.88.0.2/24"}} {
		run("nsenter", "-t", strconv.Itoa(side.pid), "-n", "ip", "addr", "add", side.addr, "dev", side.dev)
		run("nsenter", "-t", strconv.Itoa(side.pid), "-n", "ip", "link", "set", side.dev, "up")
	}
	run("nsenter", "-t", strconv.Itoa(hubPIDs[0]), "-n", "sysctl", "-w", "net.ipv4.ip_forward=1")
	run("nsenter", "-t", strconv.Itoa(lanPID), "-n", "ip", "route", "add", "10.250.0.0/31", "via", "10.88.0.1")
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "wg", "set", edgePlan.Tunnels[0].Name, "peer", edgePlan.Tunnels[0].PublicKey, "allowed-ips", "10.250.0.0/32,10.88.0.0/24")
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "route", "add", "10.88.0.0/24", "dev", edgePlan.Tunnels[0].Name)
	blocked := func() {
		t.Helper()
		if exec.CommandContext(ctx, "nsenter", "-t", strconv.Itoa(edgePID), "-n", "ping", "-c", "1", "-W", "1", "10.88.0.2").Run() == nil {
			t.Fatal("tunnel forwarded LAN traffic")
		}
	}
	blocked()
	// Positive control: with only the test guard removed, forwarding is possible.
	run("nsenter", "-t", strconv.Itoa(hubPIDs[0]), "-n", "nft", "delete", "table", "inet", "pmwg"+hubEngines[0].group())
	ping("10.88.0.2")
	if err = hubEngines[0].Apply(ctx, hubPlans[0], nil); err != nil {
		t.Fatal(err)
	}
	blocked()
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "route", "del", "10.88.0.0/24")
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "wg", "set", edgePlan.Tunnels[0].Name, "peer", edgePlan.Tunnels[0].PublicKey, "allowed-ips", "10.250.0.0/32")
	// Failed management verification restores both previously working tunnels.
	if err = edge.Apply(ctx, Plan{Tunnels: []Tunnel{}}, func(context.Context) error { return errors.New("injected management failure") }); err == nil {
		t.Fatal("failed confirmation accepted")
	}
	for _, tunnel := range edgePlan.Tunnels {
		ping(tunnel.PeerAddress)
	}
	// Interface loss models reboot; local state restores before controller contact.
	for _, tunnel := range edgePlan.Tunnels {
		run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "link", "del", tunnel.Name)
	}
	if err = edge.Restore(ctx); err != nil {
		t.Fatal(err)
	}
	for _, tunnel := range edgePlan.Tunnels {
		ping(tunnel.PeerAddress)
	}
	// Durable interrupted-apply journal is recovered on restart.
	if err = writePlan(edge.Directory, "network-pending.json", edgePlan); err != nil {
		t.Fatal(err)
	}
	if err = edge.Restore(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(edge.Directory, "network-pending.json")); !os.IsNotExist(err) {
		t.Fatal("journal not cleared")
	}
	ping("10.250.0.0")
	if err = edge.Apply(ctx, Plan{Tunnels: edgePlan.Tunnels[:1]}, nil); err != nil {
		t.Fatal(err)
	}
	ping("10.250.0.0")
	ping("192.0.2.1")
	if err = edge.Apply(ctx, Plan{Tunnels: []Tunnel{}}, nil); err != nil {
		t.Fatal(err)
	}
	links, err := edge.links(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range links {
		if edge.owns(l) {
			t.Fatal("removed tunnel still exists")
		}
	}
	revision.Add(1)
	management()
	if err = edge.Restore(ctx); err != nil {
		t.Fatal(err)
	}
	management()
	if err = edge.Apply(ctx, edgePlan, func(context.Context) error { management(); return nil }); err != nil {
		t.Fatal(err)
	}
	revision.Add(1)
	management()
	if err = edge.Restore(ctx); err != nil {
		t.Fatal(err)
	}
	management()
	for _, tunnel := range edgePlan.Tunnels {
		ping(tunnel.PeerAddress)
	}
	if requests.Load() < 18 {
		t.Fatal("missing management requests across topology transitions")
	}
	// Cleanup must refuse an unavailable management path and retain working tunnels.
	if err = edge.Reset(ctx, func(context.Context) error { return errors.New("offline") }); err == nil {
		t.Fatal("reset ignored failed management confirmation")
	}
	for _, tunnel := range edgePlan.Tunnels {
		ping(tunnel.PeerAddress)
	}
	confirmations := 0
	if err = edge.Reset(ctx, func(context.Context) error {
		confirmations++
		if confirmations == 2 {
			return errors.New("injected post-cleanup management failure")
		}
		return nil
	}); err == nil {
		t.Fatal("reset committed despite failed post-cleanup confirmation")
	}
	for _, tunnel := range edgePlan.Tunnels {
		ping(tunnel.PeerAddress)
	}
	if !strings.Contains(run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "nft", "list", "tables"), "pmwg"+edge.group()) {
		t.Fatal("rollback lost isolation guard")
	}
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "link", "add", "foreignwg", "type", "wireguard")
	run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "nft", "add", "table", "inet", "unrelated_reset_test")
	if err = edge.Reset(ctx, func(context.Context) error { management(); return nil }); err != nil {
		t.Fatal("confirmed cleanup", err)
	}
	management()
	links, err = edge.links(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, link := range links {
		if edge.owns(link) {
			t.Fatal("old owned tunnel survived cleanup")
		}
	}
	if !strings.Contains(run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "ip", "-j", "link", "show", "foreignwg"), "foreignwg") {
		t.Fatal("foreign WireGuard interface removed")
	}
	tables := run("nsenter", "-t", strconv.Itoa(edgePID), "-n", "nft", "list", "tables")
	if strings.Contains(tables, "pmwg"+edge.group()) || !strings.Contains(tables, "unrelated_reset_test") {
		t.Fatal("cleanup removed foreign firewall state or retained owned guard")
	}

}

// Run the real HTTP client from the edge namespace in a separate process.
func TestNamespaceManagementHTTPHelper(t *testing.T) {
	origin := os.Getenv("FABRIC_NAMESPACE_CONTROLLER_URL")
	if origin == "" {
		t.Skip("namespace helper only")
	}
	client, err := controller.New(origin, "", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	defer client.HTTP.CloseIdleConnections()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var desired struct {
		Revision int `json:"revision"`
	}
	if err = client.Request(ctx, http.MethodGet, "/api/agent/v1/desired", nil, &desired); err != nil {
		t.Fatal(err)
	}
	expected, err := strconv.Atoi(os.Getenv("FABRIC_NAMESPACE_REVISION"))
	if err != nil || desired.Revision != expected {
		t.Fatal("desired revision did not synchronize")
	}
	for _, path := range []string{"/api/agent/v1/ack", "/api/agent/v1/heartbeat"} {
		if err = client.Request(ctx, http.MethodPost, path, map[string]int{"revision": desired.Revision}, nil); err != nil {
			t.Fatal(err)
		}
	}
}
