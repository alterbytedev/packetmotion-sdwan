package network

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func interfaceTestConfiguration() InterfaceConfiguration {
	address := "10.61.100.1/24"
	return InterfaceConfiguration{SchemaVersion: 1, NodeID: "123e4567-e89b-42d3-a456-426614174000", InterfaceName: "ens36", Kind: "physical", SafeCommitSeconds: 60, Interfaces: []InterfaceSetting{{InterfaceName: "ens36", Role: "lan", Mode: "static", Address: &address, Enabled: true, MTU: 1500}}}
}
func TestInterfaceCommitValidation(t *testing.T) {
	c := interfaceTestConfiguration()
	r, err := NewInterfaceRequest("123e4567-e89b-42d3-a456-426614174001", c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.Configuration(); err != nil {
		t.Fatal(err)
	}
	r.Checksum = strings.Repeat("0", 64)
	if _, err = r.Configuration(); err == nil {
		t.Fatal("forged checksum accepted")
	}
	for _, mutate := range []func(*InterfaceConfiguration){
		func(c *InterfaceConfiguration) { c.SafeCommitSeconds = 0 }, func(c *InterfaceConfiguration) { c.Interfaces[0].Role = "wan" }, func(c *InterfaceConfiguration) { c.Interfaces[0].Mode = "dhcp" },
		func(c *InterfaceConfiguration) { s := "10.61.100.0/24"; c.Interfaces[0].AdvertisedPrefix = &s }, func(c *InterfaceConfiguration) { s := "10.61.100.255/24"; c.Interfaces[0].Address = &s },
		func(c *InterfaceConfiguration) { c.Interfaces[0].InterfaceName = "lo" },
	} {
		c = interfaceTestConfiguration()
		mutate(&c)
		if _, err = NewInterfaceRequest("123e4567-e89b-42d3-a456-426614174001", c); err == nil {
			t.Fatal("unsafe commit accepted")
		}
	}
}
func TestInterfacePreflightProtectsManagementAndForeignAddresses(t *testing.T) {
	for _, scenario := range []string{"safe", "management", "foreign", "unauthorized"} {
		t.Run(scenario, func(t *testing.T) {
			c := interfaceTestConfiguration()
			r, _ := NewInterfaceRequest("123e4567-e89b-42d3-a456-426614174001", c)
			run := func(_ context.Context, name string, args []string, input string) ([]byte, error) {
				cmd := strings.Join(args, " ")
				if name != "ip" || !strings.HasPrefix(cmd, "-j") {
					t.Fatal("mutation in preflight")
				}
				switch {
				case strings.Contains(cmd, "address show"):
					address := `[]`
					if scenario == "foreign" {
						address = `[{"family":"inet","local":"10.1.1.1","prefixlen":24}]`
					}
					return []byte(`[{"ifname":"ens36","ifindex":2,"link_type":"ether","mtu":1500,"addr_info":` + address + `}]`), nil
				case strings.Contains(cmd, "route show"):
					device := "ens33"
					if scenario == "management" {
						device = "ens36"
					}
					return []byte(`[{"dst":"default","dev":"` + device + `"}]`), nil
				case strings.Contains(cmd, "route get"):
					return []byte(`[{"dev":"ens33"}]`), nil
				case strings.Contains(cmd, "link show"):
					return []byte(`[{"ifname":"ens36","linkinfo":{}}]`), nil
				}
				return nil, errors.New("unexpected inspection")
			}
			policy := InterfaceAuthorization{NodeID: c.NodeID, Interfaces: []string{"ens36"}, ControllerIPs: []string{"192.0.2.10"}}
			if scenario == "unauthorized" {
				policy.Interfaces = []string{"ens35"}
			}
			_, err := (InterfaceEngine{Run: run, NodeID: c.NodeID, Authorization: policy}).Prepare(context.Background(), r, InterfaceBundle{})
			if scenario == "safe" && err != nil {
				t.Fatal(err)
			}
			if scenario != "safe" && err == nil {
				t.Fatal("unsafe preflight accepted")
			}
		})
	}
}
func TestInterfaceRollbackDoesNotTouchOtherParents(t *testing.T) {
	c := interfaceTestConfiguration()
	r, _ := NewInterfaceRequest("123e4567-e89b-42d3-a456-426614174001", c)
	other := interfaceTestConfiguration()
	other.InterfaceName = "ens35"
	other.Interfaces[0].InterfaceName = "ens35"
	address := "10.62.100.1/24"
	other.Interfaces[0].Address = &address
	calls := []string{}
	run := func(_ context.Context, name string, args []string, input string) ([]byte, error) {
		command := strings.Join(args, " ")
		calls = append(calls, name+" "+command)
		if name == "nft" {
			if args[0] == "-j" {
				return []byte(`{"nftables":[]}`), nil
			}
			if strings.Contains(input, `\n`) {
				t.Fatal("literal newline escapes in nft script")
			}
			return nil, nil
		}
		if strings.Contains(command, "address show") {
			return []byte(`[{"ifname":"ens35","ifindex":2,"link_type":"ether","mtu":1500,"addr_info":[{"family":"inet","local":"10.62.100.1","prefixlen":24}]},{"ifname":"ens36","ifindex":3,"link_type":"ether","mtu":1500,"addr_info":[{"family":"inet","local":"10.61.100.1","prefixlen":24}]}]`), nil
		}
		if strings.Contains(command, "route show") {
			return []byte(`[]`), nil
		}
		return nil, nil
	}
	j := InterfaceJournal{Request: r, Next: InterfaceBundle{Configurations: []InterfaceConfiguration{c, other}}, Previous: InterfaceBundle{Configurations: []InterfaceConfiguration{other}}, Before: []InterfaceOriginal{{Name: "ens36", Up: false, MTU: 1400, Addresses: []string{}}}}
	if err := (InterfaceEngine{Run: run, NodeID: c.NodeID}).Rollback(context.Background(), j); err != nil {
		t.Fatal(err)
	}
	for _, call := range calls {
		if strings.Contains(call, "del 10.62.") || strings.Contains(call, "dev ens35") {
			t.Fatalf("unrelated parent mutated: %s", call)
		}
	}
}
