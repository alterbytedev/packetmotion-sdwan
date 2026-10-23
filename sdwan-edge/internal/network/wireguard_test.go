package network

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func privateDirectory(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	return dir
}
func testTunnel(t *testing.T) Tunnel {
	t.Helper()
	_, public, err := Key(privateDirectory(t))
	if err != nil {
		t.Fatal(err)
	}
	ep := "192.168.99.1:22000"
	return Tunnel{Name: "pm123456789abc", Address: "10.250.0.1/31", PeerAddress: "10.250.0.0", PublicKey: public, Endpoint: &ep, Keepalive: 25}
}
func TestKeyAndValidation(t *testing.T) {
	dir := privateDirectory(t)
	secret, public, err := Key(dir)
	if err != nil {
		t.Fatal(err)
	}
	next, nextPublic, err := Key(dir)
	if err != nil || secret != next || public != nextPublic {
		t.Fatal("key not stable")
	}
	tunnel := testTunnel(t)
	if err := Validate(Plan{Tunnels: []Tunnel{tunnel}}); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*Tunnel){
		func(v *Tunnel) { v.Name = "eth0" }, func(v *Tunnel) { v.Address = "192.168.99.0/24" },
		func(v *Tunnel) { v.PeerAddress = "10.99.0.1" }, func(v *Tunnel) { v.PublicKey = "bad" },
		func(v *Tunnel) { s := "10.250.0.0:22000"; v.Endpoint = &s }, func(v *Tunnel) { v.Keepalive = 0 },
	} {
		v := tunnel
		mutate(&v)
		if Validate(Plan{Tunnels: []Tunnel{v}}) == nil {
			t.Fatal("accepted unsafe plan")
		}
	}
	if Validate(Plan{Tunnels: []Tunnel{tunnel, tunnel}}) == nil {
		t.Fatal("duplicate accepted")
	}
	if err := os.Chmod(filepath.Join(dir, "wireguard.key"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Key(dir); err == nil {
		t.Fatal("public key file accepted")
	}
}

func TestDeviceStateReportsOnlyKnownFilesAndOwnedInterfaces(t *testing.T) {
	directory := privateDirectory(t)
	secret, _, err := Key(directory)
	if err != nil {
		t.Fatal(err)
	}
	tunnel := testTunnel(t)
	plan := Plan{Tunnels: []Tunnel{tunnel}}
	if err = writePlan(directory, "network-applied.json", plan); err != nil {
		t.Fatal(err)
	}
	engine := Engine{Directory: directory, NodeID: "diagnostic-node"}
	links := fmt.Sprintf(`[{"ifname":%q,"group":%q,"flags":["UP"],"linkinfo":{"info_kind":"wireguard"}},{"ifname":"pm000000000000","group":%q,"flags":["UP"],"linkinfo":{"info_kind":"wireguard"}}]`, tunnel.Name, engine.group(), engine.group())
	engine.Run = func(_ context.Context, name string, args []string, _ string) ([]byte, error) {
		joined := strings.Join(args, " ")
		if name == "ip" && strings.Contains(joined, "-details link") {
			return []byte(links), nil
		}
		if name == "ip" && strings.Contains(joined, "address show") {
			return []byte(fmt.Sprintf(`[{"ifname":%q,"addr_info":[{"family":"inet","local":"10.250.0.1","prefixlen":31}]}]`, tunnel.Name)), nil
		}
		if name == "wg" && strings.Contains(joined, "latest-handshakes") {
			return []byte(tunnel.PublicKey + "\t0\n"), nil
		}
		t.Fatalf("unexpected diagnostic command: %s %s", name, joined)
		return nil, nil
	}
	state, err := engine.DeviceState(context.Background(), 3, true)
	if err != nil {
		t.Fatal(err)
	}
	if state.Revision != 3 || state.AppliedPlan == nil || !state.Interfaces[0].Present || !state.Interfaces[0].Up || state.Interfaces[0].LastHandshake == nil || *state.Interfaces[0].LastHandshake != 0 {
		t.Fatalf("device state missing observations: %#v", state)
	}
	if len(state.Interfaces[0].Addresses) != 1 || state.Interfaces[0].Addresses[0] != "10.250.0.1/31" || len(state.UnplannedOwnedInterfaces) != 1 {
		t.Fatalf("device state did not scope owned interfaces: %#v", state)
	}
	data, err := json.Marshal(state)
	if err != nil || strings.Contains(string(data), secret) || !state.Files[3].Present {
		t.Fatal("device state included key material or omitted the private-key path")
	}
}
func TestPreflightNeverMutatesForeignInterfacesOrOverlappingRoutes(t *testing.T) {
	tunnel := testTunnel(t)
	for _, inventory := range []struct{ links, routes string }{
		{`[{"ifname":"pm123456789abc","ifalias":"foreign","linkinfo":{"info_kind":"wireguard"}}]`, `[]`},
		{`[]`, `[{"dst":"10.250.0.0/16","dev":"eth0"}]`},
	} {
		calls := 0
		engine := Engine{Directory: privateDirectory(t), NodeID: "node", Run: func(_ context.Context, name string, args []string, _ string) ([]byte, error) {
			calls++
			if name != "ip" || args[0] != "-j" {
				t.Fatal("mutation before validation")
			}
			if strings.Contains(strings.Join(args, " "), "route") {
				return []byte(inventory.routes), nil
			}
			return []byte(inventory.links), nil
		}}
		if engine.Apply(context.Background(), Plan{Tunnels: []Tunnel{tunnel}}, nil) == nil {
			t.Fatal("unsafe apply accepted")
		}
		if calls > 2 {
			t.Fatal("unexpected commands")
		}
	}
}
func TestFailedApplyRestoresEmptyPlan(t *testing.T) {
	tunnel := testTunnel(t)
	engine := Engine{Directory: privateDirectory(t), NodeID: "node"}
	engine.Run = func(_ context.Context, _ string, args []string, _ string) ([]byte, error) {
		if args[0] == "-j" {
			return []byte(`[]`), nil
		}
		return nil, errors.New("injected mutation failure")
	}
	err := engine.Apply(context.Background(), Plan{Tunnels: []Tunnel{tunnel}}, nil)
	// With an empty previous plan rollback needs no mutations and succeeds.
	if err == nil {
		t.Fatal("failure hidden")
	}
	if _, err := os.Stat(filepath.Join(engine.Directory, "network-pending.json")); !os.IsNotExist(err) {
		t.Fatal("successful rollback retained journal")
	}
	data, err := os.ReadFile(filepath.Join(engine.Directory, "network-applied.json"))
	if err != nil {
		t.Fatal(err)
	}
	var restored Plan
	if json.Unmarshal(data, &restored) != nil || len(restored.Tunnels) != 0 {
		t.Fatal("incorrect restored plan")
	}
}

func TestLocalActivationPreflightIsReadOnly(t *testing.T) {
	engine := Engine{Directory: privateDirectory(t), NodeID: "node", Run: func(_ context.Context, name string, args []string, input string) ([]byte, error) {
		if name != "ip" || len(args) == 0 || args[0] != "-j" || input != "" {
			t.Fatal("activation preflight mutated host")
		}
		return []byte(`[]`), nil
	}}
	if err := engine.CheckActivation(context.Background(), Plan{Tunnels: []Tunnel{testTunnel(t)}}); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(engine.Directory)
	if err != nil || len(entries) != 0 {
		t.Fatal("activation preflight wrote state")
	}
}

// The local CLI constructs an Engine without a custom runner. A cancelled
// context exercises that production path without reading or changing host state.
func TestLocalActivationPreflightDefaultsRunner(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	engine := Engine{Directory: privateDirectory(t), NodeID: "node"}
	if err := engine.CheckActivation(ctx, Plan{}); err == nil {
		t.Fatal("cancelled preflight unexpectedly succeeded")
	}
	entries, err := os.ReadDir(engine.Directory)
	if err != nil || len(entries) != 0 {
		t.Fatal("cancelled activation wrote state")
	}
	if engine.Run != nil {
		t.Fatal("value receiver changed caller state")
	}
}
