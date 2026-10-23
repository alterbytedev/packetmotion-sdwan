package network

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func testRoutedPlan(t *testing.T) Plan {
	t.Helper()
	tunnel := testTunnel(t)
	tunnel.AllowedPrefixes = []string{"10.62.0.0/24"}
	return Plan{Tunnels: []Tunnel{tunnel}, Routing: &Routing{
		LAN: LAN{InterfaceName: "ens34", Address: "10.61.0.1/24", AdvertisedPrefix: "10.61.0.0/24"}, ProtectedPrefixes: []string{"192.168.160.0/24"},
		BGP: &BGP{LocalASN: 65001, RouterID: "10.61.0.1", Peers: []BGPPeer{{InterfaceName: tunnel.Name, Address: tunnel.PeerAddress, RemoteASN: 65000, ImportPrefixes: []string{"10.62.0.0/24"}, ExportPrefixes: []string{"10.61.0.0/24"}, LocalPreference: 200}}},
	}}
}

func testTwoPeerRoutedPlan(t *testing.T) Plan {
	t.Helper()
	data, err := os.ReadFile("testdata/frr/bgp-two-peers-plan.json")
	if err != nil {
		t.Fatal(err)
	}
	var plan Plan
	if err := json.Unmarshal(data, &plan); err != nil {
		t.Fatal(err)
	}
	return plan
}

func TestBGPRendererMatchesReviewFixtureAndIsDeterministic(t *testing.T) {
	plan := testTwoPeerRoutedPlan(t)
	if err := Validate(plan); err != nil {
		t.Fatalf("fixture plan is invalid: %v", err)
	}
	engine := Engine{NodeID: "fixture-node"}
	got := engine.renderBGP(plan)
	want, err := os.ReadFile("testdata/frr/bgp-two-peers.conf")
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Fatalf("rendered FRR config differs from review fixture:\n%s", got)
	}

	reversed := plan
	reversed.Tunnels = append([]Tunnel(nil), plan.Tunnels...)
	reversed.Routing = &Routing{LAN: plan.Routing.LAN, ProtectedPrefixes: append([]string(nil), plan.Routing.ProtectedPrefixes...), BGP: &BGP{
		LocalASN: plan.Routing.BGP.LocalASN, RouterID: plan.Routing.BGP.RouterID,
		Peers: append([]BGPPeer(nil), plan.Routing.BGP.Peers...),
	}}
	for left, right := 0, len(reversed.Tunnels)-1; left < right; left, right = left+1, right-1 {
		reversed.Tunnels[left], reversed.Tunnels[right] = reversed.Tunnels[right], reversed.Tunnels[left]
	}
	for left, right := 0, len(reversed.Routing.BGP.Peers)-1; left < right; left, right = left+1, right-1 {
		reversed.Routing.BGP.Peers[left], reversed.Routing.BGP.Peers[right] = reversed.Routing.BGP.Peers[right], reversed.Routing.BGP.Peers[left]
	}
	if other := engine.renderBGP(reversed); other != got {
		t.Fatal("rendered output changed when peer/tunnel input order changed")
	}
}

func TestOversizedBGPPlanIsRejectedBeforeAnyCommand(t *testing.T) {
	plan := testRoutedPlan(t)
	peer := plan.Routing.BGP.Peers[0]
	plan.Routing.BGP.Peers = make([]BGPPeer, 129)
	for i := range plan.Routing.BGP.Peers {
		plan.Routing.BGP.Peers[i] = peer
	}
	calls := 0
	engine := Engine{Run: func(context.Context, string, []string, string) ([]byte, error) {
		calls++
		return nil, errors.New("unexpected command")
	}}
	if err := engine.preflight(context.Background(), plan); err == nil {
		t.Fatal("oversized BGP plan was accepted")
	}
	if calls != 0 {
		t.Fatalf("oversized plan invoked %d system commands before rejection", calls)
	}
}

func TestBGPRendererDoesNotMutateTypedPeerInput(t *testing.T) {
	plan := testTwoPeerRoutedPlan(t)
	firstName, secondName := plan.Routing.BGP.Peers[0].InterfaceName, plan.Routing.BGP.Peers[1].InterfaceName
	Engine{NodeID: "fixture-node"}.renderBGP(plan)
	if plan.Routing.BGP.Peers[0].InterfaceName != firstName || plan.Routing.BGP.Peers[1].InterfaceName != secondName {
		t.Fatal("renderer mutated desired BGP peer order")
	}
}

func TestBGPRemovalRendererProducesReviewableFRRCommands(t *testing.T) {
	got := renderBGPRemoval(bgpFRRRemovalData{
		RouterASN: 65001,
		Objects: []bgpFRRRemovalObject{
			{PrefixList: "PM1955453032_pm111111111111_IN"},
			{RouteMap: "PM1955453032_pm111111111111_IN"},
		},
	})
	want := "no router bgp 65001\nno ip prefix-list PM1955453032_pm111111111111_IN\nno route-map PM1955453032_pm111111111111_IN\n"
	if got != want {
		t.Fatalf("rendered removal commands differ from expected:\n%s", got)
	}
	if empty := renderBGPRemoval(bgpFRRRemovalData{}); empty != "" {
		t.Fatalf("empty cleanup rendered commands: %q", empty)
	}
}

func TestBGPValidationBindsWireguardAndRouteOwnership(t *testing.T) {
	good := testRoutedPlan(t)
	if err := Validate(good); err != nil {
		t.Fatal(err)
	}
	ibgp := testRoutedPlan(t)
	ibgp.Routing.BGP.Peers[0].RemoteASN = ibgp.Routing.BGP.LocalASN
	if err := Validate(ibgp); err != nil {
		t.Fatalf("same-AS iBGP adjacency rejected: %v", err)
	}
	for _, mutate := range []func(*Plan){
		func(p *Plan) { p.Routing.BGP.LocalASN = 64500 }, func(p *Plan) { p.Routing.BGP.RouterID = "192.168.160.141" },
		func(p *Plan) { p.Routing.BGP.Peers[0].ImportPrefixes = []string{"0.0.0.0/0"} },
		func(p *Plan) { p.Routing.BGP.Peers[0].ImportPrefixes = []string{"192.168.160.0/24"} },
		func(p *Plan) { p.Tunnels[0].AllowedPrefixes = nil },
		func(p *Plan) { p.Routing.BGP.Peers[0].RemoteASN = 64500 },
		func(p *Plan) { p.Routing.BGP.Peers[0].ExportPrefixes = []string{"10.0.0.0/8"} },
	} {
		plan := testRoutedPlan(t)
		mutate(&plan)
		if Validate(plan) == nil {
			t.Fatal("unsafe BGP plan accepted")
		}
	}
}
func TestGeneratedBGPConfigPassesActualFRRSyntaxValidation(t *testing.T) {
	if _, err := os.Stat("/usr/bin/vtysh"); err != nil {
		t.Skip("FRR syntax validator not installed")
	}
	plan := testRoutedPlan(t)
	engine := Engine{Directory: privateDirectory(t), NodeID: "syntax-test"}
	file, err := engine.bgpCandidate(plan)
	if err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command("/usr/bin/vtysh", "-C", "-f", file).CombinedOutput()
	if err != nil {
		t.Fatalf("FRR rejected generated candidate: %v (%s)", err, output)
	}
	config := engine.renderBGP(plan)
	if strings.Contains(config, "redistribute") || strings.Contains(config, "default-originate") || strings.Contains(config, "write memory") {
		t.Fatal("unscoped configuration generated")
	}
	if !strings.Contains(config, "maximum-paths 1") || !strings.Contains(config, "bgp ebgp-requires-policy") {
		t.Fatal("missing route safety settings")
	}
}
func TestForeignBGPInstanceRefusedBeforeAnyMutation(t *testing.T) {
	plan := testRoutedPlan(t)
	engine := Engine{Directory: privateDirectory(t), NodeID: "foreign-test"}
	engine.Run = func(_ context.Context, name string, args []string, input string) ([]byte, error) {
		if name != "vtysh" || len(args) != 2 || args[0] != "-c" || args[1] != "show running-config" || input != "" {
			t.Fatal("mutation during ownership preflight")
		}
		return []byte("ip route 0.0.0.0/0 192.168.160.2 ens33\nrouter bgp 64555\n"), nil
	}
	if engine.preflightBGP(context.Background(), plan) == nil {
		t.Fatal("foreign BGP adopted")
	}
	if _, err := os.Stat(filepath.Join(engine.Directory, "routing-owner.json")); !os.IsNotExist(err) {
		t.Fatal("foreign BGP ownership recorded")
	}
}

func TestBGPPeerObservationAcceptsFRRAddressFamilyShapes(t *testing.T) {
	plan := testRoutedPlan(t)
	address := plan.Routing.BGP.Peers[0].Address
	for _, wrapped := range []bool{false, true} {
		engine := Engine{Run: func(_ context.Context, _ string, _ []string, _ string) ([]byte, error) {
			data := `{"peers":{"` + address + `":{"state":"Established","pfxRcd":1}}}`
			if wrapped {
				data = `{"ipv4Unicast":` + data + `}`
			}
			return []byte(data), nil
		}}
		observations, err := engine.BGPPeers(context.Background(), plan)
		if err != nil || len(observations) != 1 || observations[0].State != "Established" || observations[0].ReceivedPrefixes != 1 {
			t.Fatalf("shape wrapped=%v: %v %v", wrapped, observations, err)
		}
	}
}
