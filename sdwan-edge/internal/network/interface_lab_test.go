package network

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestInterfaceEngineNamespaceVLAN(t *testing.T) {
	if os.Getenv("FABRIC_INTERFACE_LAB") != "1" {
		t.Skip("isolated namespace only")
	}
	for _, kind := range []string{"net", "mnt"} {
		own, _ := os.Readlink("/proc/self/ns/" + kind)
		host, _ := os.Readlink("/proc/1/ns/" + kind)
		if own == "" || own == host {
			t.Fatal("refusing unisolated network test")
		}
	}
	ctx := context.Background()
	run := func(ctx context.Context, name string, args []string, input string) ([]byte, error) {
		data, err := Command(ctx, name, args, input)
		if err != nil {
			t.Logf("failed operation: %s %v", name, args)
		}
		return data, err
	}
	for _, args := range [][]string{{"link", "add", "name", "mgmt0", "type", "dummy"}, {"address", "add", "192.0.2.1/24", "dev", "mgmt0"}, {"link", "set", "dev", "mgmt0", "up"}, {"link", "add", "name", "ens36", "type", "veth", "peer", "name", "labpeer"}} {
		if _, err := run(ctx, "ip", args, ""); err != nil {
			t.Fatal(err)
		}
	}
	c := interfaceTestConfiguration()
	c.Kind = "vlan"
	tag := 100
	c.Interfaces[0].VLANID = &tag
	r, err := NewInterfaceRequest("123e4567-e89b-42d3-a456-426614174001", c)
	if err != nil {
		t.Fatal(err)
	}
	engine := InterfaceEngine{Run: run, NodeID: c.NodeID, Authorization: InterfaceAuthorization{NodeID: c.NodeID, Interfaces: []string{"ens36"}, ControllerIPs: []string{"192.0.2.10"}, AllowVirtualLab: true}}
	j, err := engine.Prepare(ctx, r, InterfaceBundle{})
	if err != nil {
		t.Fatal("prepare: ", err)
	}
	if err = engine.Apply(ctx, j); err != nil {
		t.Fatal("apply: ", err)
	}
	data, _ := run(ctx, "ip", []string{"-j", "-details", "link", "show"}, "")
	t.Log(string(data))
	c.Interfaces = []InterfaceSetting{}
	r, err = NewInterfaceRequest("123e4567-e89b-42d3-a456-426614174002", c)
	if err != nil {
		t.Fatal(err)
	}
	next, err := engine.Prepare(ctx, r, j.Next)
	if err != nil {
		t.Fatal("delete prepare: ", err)
	}
	if err = engine.Apply(ctx, next); err != nil {
		t.Fatal("delete apply: ", err)
	}
	data, err = run(ctx, "ip", []string{"-j", "-d", "address", "show"}, "")
	if err != nil || strings.Contains(string(data), "pmv") {
		t.Fatal("owned VLAN remained")
	}
	if err = engine.Rollback(ctx, next); err != nil {
		t.Fatal("rollback removed VLAN: ", err)
	}
}
