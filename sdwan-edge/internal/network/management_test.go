package network

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagementAddressCacheIsBoundToOrigin(t *testing.T) {
	dir := privateDirectory(t)
	origin := "https://controller.example.test"
	lookup := func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("192.0.2.10")}}, nil
	}
	offline := func(context.Context, string) ([]net.IPAddr, error) { return nil, errors.New("DNS offline") }
	got, err := managementAddresses(context.Background(), dir, origin, lookup)
	if err != nil || len(got) != 1 || got[0] != "192.0.2.10" {
		t.Fatalf("resolve: %v %v", got, err)
	}
	got, err = managementAddresses(context.Background(), dir, origin, offline)
	if err != nil || got[0] != "192.0.2.10" {
		t.Fatalf("cached recovery: %v %v", got, err)
	}
	if _, err = managementAddresses(context.Background(), dir, "https://other.example.test", offline); err == nil {
		t.Fatal("cache accepted for another controller")
	}
	if err = os.WriteFile(filepath.Join(dir, "network-management.json"), []byte(`{"origin":"https://controller.example.test","addresses":["bad"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = managementAddresses(context.Background(), dir, origin, offline); err == nil {
		t.Fatal("invalid cached address accepted")
	}
}

func TestManagementSafetyBeforeMutation(t *testing.T) {
	tunnel := testTunnel(t)
	for _, test := range []struct {
		name, route, links string
		plan               Plan
		ips                []string
		fail               bool
	}{
		{name: "direct removal", route: `[{"dev":"eth0"}]`, plan: Plan{}, ips: []string{"192.0.2.10"}},
		{name: "owned tunnel removal", route: `[{"dev":"pm123456789abc"}]`, fail: true},
		{name: "foreign WireGuard", route: `[{"dev":"wg0"}]`, links: `[{"ifname":"wg0","linkinfo":{"info_kind":"wireguard"}}]`, fail: true},
		{name: "missing route", route: `[]`, fail: true},
		{name: "invalid route", route: `broken`, fail: true},
		{name: "unreachable", route: `[{"dev":"eth0","type":"unreachable"}]`, fail: true},
		{name: "all addresses checked", route: `[{"dev":"eth0"}]`, ips: []string{"192.0.2.10", "192.0.2.11"}, fail: true},
		{name: "tunnel overlap", route: `[{"dev":"eth0"}]`, plan: Plan{Tunnels: []Tunnel{tunnel}}, ips: []string{"10.250.0.0"}, fail: true},
		{name: "allowed prefix overlap", route: `[{"dev":"eth0"}]`, plan: Plan{Tunnels: []Tunnel{{AllowedPrefixes: []string{"192.0.2.0/24"}}}}, fail: true},
		{name: "LAN overlap", route: `[{"dev":"eth0"}]`, plan: Plan{Routing: &Routing{LAN: LAN{AdvertisedPrefix: "192.0.2.0/24"}}}, fail: true},
		{name: "BGP overlap", route: `[{"dev":"eth0"}]`, plan: Plan{Routing: &Routing{LAN: LAN{AdvertisedPrefix: "10.61.0.0/24"}, BGP: &BGP{Peers: []BGPPeer{{ImportPrefixes: []string{"192.0.2.0/24"}}}}}}, fail: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ips := test.ips
			if ips == nil {
				ips = []string{"192.0.2.10"}
			}
			engine := Engine{ManagementIPs: ips, Run: func(_ context.Context, name string, args []string, _ string) ([]byte, error) {
				if name != "ip" || args[0] != "-j" {
					t.Fatal("mutation during safety check")
				}
				if strings.Contains(strings.Join(args, " "), "route get") {
					if args[len(args)-1] == "192.0.2.11" {
						return nil, errors.New("no route")
					}
					return []byte(test.route), nil
				}
				if test.links != "" {
					return []byte(test.links), nil
				}
				return []byte(`[]`), nil
			}}
			err := engine.validateManagement(context.Background(), test.plan, nil)
			if (err != nil) != test.fail {
				t.Fatalf("unexpected safety result: %v", err)
			}
		})
	}
}

func TestManagementRouteChangeRollsBackBeforeConfirmation(t *testing.T) {
	tunnel := testTunnel(t)
	engine := Engine{Directory: privateDirectory(t), NodeID: "edge", ManagementIPs: []string{"192.0.2.10"}}
	present := false
	engine.Run = func(_ context.Context, name string, args []string, _ string) ([]byte, error) {
		command := strings.Join(args, " ")
		if name == "ip" && strings.Contains(command, "-details link") {
			if present {
				return []byte(fmt.Sprintf(`[{"ifname":%q,"group":%q,"linkinfo":{"info_kind":"wireguard"}}]`, tunnel.Name, engine.group())), nil
			}
			return []byte(`[]`), nil
		}
		if name == "ip" && strings.Contains(command, "route get") {
			if present {
				return []byte(fmt.Sprintf(`[{"dev":%q}]`, tunnel.Name)), nil
			}
			return []byte(`[{"dev":"eth0"}]`), nil
		}
		if name == "ip" && strings.Contains(command, "route show") {
			return []byte(`[]`), nil
		}
		if name == "nft" && command == "-j list tables" {
			return []byte(`{"nftables":[]}`), nil
		}
		if name == "ip" && len(args) > 1 && args[0] == "link" {
			if args[1] == "add" {
				present = true
			}
			if args[1] == "delete" {
				present = false
			}
		}
		return nil, nil
	}
	confirmed := false
	err := engine.Apply(context.Background(), Plan{Tunnels: []Tunnel{tunnel}}, func(context.Context) error { confirmed = true; return nil })
	if err == nil || !strings.Contains(err.Error(), "previous plan restored") || present || confirmed {
		t.Fatalf("unsafe management path committed: err=%v present=%v confirmed=%v", err, present, confirmed)
	}
	applied, err := readPlan(engine.Directory, "network-applied.json")
	if err != nil || len(applied.Tunnels) != 0 {
		t.Fatalf("rollback journal: %+v %v", applied, err)
	}
	if _, err = os.Stat(filepath.Join(engine.Directory, "network-pending.json")); !os.IsNotExist(err) {
		t.Fatal("pending journal retained after rollback")
	}
}
