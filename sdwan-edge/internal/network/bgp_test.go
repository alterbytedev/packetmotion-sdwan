package network

import (
	"context"
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
func TestBGPValidationBindsWireguardAndRouteOwnership(t *testing.T) {
	good := testRoutedPlan(t)
	if err := Validate(good); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*Plan){
		func(p *Plan) { p.Routing.BGP.LocalASN = 64500 }, func(p *Plan) { p.Routing.BGP.RouterID = "192.168.160.141" },
		func(p *Plan) { p.Routing.BGP.Peers[0].ImportPrefixes = []string{"0.0.0.0/0"} },
		func(p *Plan) { p.Routing.BGP.Peers[0].ImportPrefixes = []string{"192.168.160.0/24"} },
		func(p *Plan) { p.Tunnels[0].AllowedPrefixes = nil },
		func(p *Plan) { p.Routing.BGP.Peers[0].RemoteASN = 65001 },
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
