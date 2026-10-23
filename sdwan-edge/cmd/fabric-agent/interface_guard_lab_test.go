package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"packetmotion/fabric-agent/internal/network"
)

func TestInterfaceGuardNamespaceLifecycle(t *testing.T) {
	if os.Getenv("FABRIC_INTERFACE_LAB") != "1" {
		t.Skip("requires explicitly isolated mount/network namespace")
	}
	for _, kind := range []string{"net", "mnt"} {
		own, _ := os.Readlink("/proc/self/ns/" + kind)
		host, _ := os.Readlink("/proc/1/ns/" + kind)
		if own == "" || own == host {
			t.Fatal("refusing unisolated interface test")
		}
	}
	binary := os.Getenv("FABRIC_INTERFACE_BINARY")
	if !filepath.IsAbs(binary) {
		t.Fatal("absolute tested binary required")
	}
	ctx := context.Background()
	command := func(name string, args ...string) {
		t.Helper()
		if _, err := network.Command(ctx, name, args, ""); err != nil {
			t.Fatalf("%s %v failed: %v", name, args, err)
		}
	}
	command("ip", "link", "set", "dev", "lo", "up")
	command("ip", "link", "add", "name", "mgmt0", "type", "dummy")
	command("ip", "address", "add", "192.0.2.1/24", "dev", "mgmt0")
	command("ip", "link", "set", "dev", "mgmt0", "up")
	command("ip", "link", "add", "name", "ens36", "type", "veth", "peer", "name", "labpeer")
	shared := t.TempDir()
	root := t.TempDir()
	os.Chmod(shared, 0700)
	os.Chmod(root, 0700)
	node := "123e4567-e89b-42d3-a456-426614174000"
	policyPath := filepath.Join(t.TempDir(), "policy.json")
	if err := os.Chmod(filepath.Dir(policyPath), 0700); err != nil {
		t.Fatal(err)
	}
	policy := network.InterfaceAuthorization{NodeID: node, Interfaces: []string{"ens36"}, ControllerIPs: []string{"192.0.2.10"}, AllowVirtualLab: true}
	if err := network.WriteInterfaceFile(filepath.Dir(policyPath), filepath.Base(policyPath), policy); err != nil {
		t.Fatal(err)
	}
	var process *exec.Cmd
	var log bytes.Buffer
	start := func() {
		t.Helper()
		log.Reset()
		process = exec.Command(binary, "interface-guard", "--guard-state-dir", root, "--state-dir", shared, "--policy", policyPath)
		process.Stderr = &log
		if err := process.Start(); err != nil {
			t.Fatal(err)
		}
	}
	stop := func() {
		if process != nil {
			_ = process.Process.Signal(os.Interrupt)
			_ = process.Wait()
			process = nil
		}
	}
	defer stop()
	waitResult := func(commit, status string, timeout time.Duration) network.InterfaceResult {
		t.Helper()
		end := time.Now().Add(timeout)
		for time.Now().Before(end) {
			var r network.InterfaceResult
			if network.ReadInterfaceFile(shared, "interface-result.json", &r) == nil && r.CommitID == commit && r.Status == status {
				return r
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatalf("no %s result: %s", status, log.String())
		return network.InterfaceResult{}
	}
	makeRequest := func(id, address string) network.InterfaceRequest {
		c := network.InterfaceConfiguration{SchemaVersion: 1, NodeID: node, InterfaceName: "ens36", Kind: "physical", SafeCommitSeconds: 60, Interfaces: []network.InterfaceSetting{{InterfaceName: "ens36", Role: "lan", Mode: "static", Address: &address, Enabled: true, MTU: 1450}}}
		r, err := network.NewInterfaceRequest(id, c)
		if err != nil {
			t.Fatal(err)
		}
		if err = network.WriteInterfaceFile(shared, "interface-request.json", r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	confirm := func(r network.InterfaceResult) {
		t.Helper()
		if err := network.WriteInterfaceFile(shared, "interface-confirmation.json", interfaceConfirmation{CommitID: r.CommitID, Checksum: r.Checksum, Nonce: r.Nonce}); err != nil {
			t.Fatal(err)
		}
	}
	start()
	first := makeRequest("123e4567-e89b-42d3-a456-426614174001", "10.61.100.1/24")
	pending := waitResult(first.CommitID, "awaiting_confirmation", 10*time.Second)
	confirm(pending)
	waitResult(first.CommitID, "applied", 10*time.Second)
	snapshot, err := network.Inspect(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, s := range snapshot.Interfaces {
		if s.Name == "ens36" && s.Up && s.MTU == 1450 && len(s.Addresses) == 1 && s.Addresses[0] == "10.61.100.1/24" {
			found = true
		}
	}
	if !found {
		t.Fatal("confirmed address not installed")
	}
	// Agent/service restart recovery must work before controller availability.
	stop()
	start()
	time.Sleep(time.Second)
	second := makeRequest("123e4567-e89b-42d3-a456-426614174002", "10.61.101.1/24")
	waitResult(second.CommitID, "awaiting_confirmation", 10*time.Second)
	stop()
	start()
	recovered := waitResult(second.CommitID, "rolled_back", 10*time.Second)
	if recovered.Reason != "interrupted_apply" {
		t.Fatal("interrupted apply reason lost")
	}
	// No confirmation simulates controller disconnection. Verify the actual
	// 60-second watchdog, not a shortened test-only deadline.
	third := makeRequest("123e4567-e89b-42d3-a456-426614174003", "10.61.102.1/24")
	pending = waitResult(third.CommitID, "awaiting_confirmation", 10*time.Second)
	deadline, err := time.Parse(time.RFC3339Nano, pending.Deadline)
	if err != nil {
		t.Fatal(err)
	}
	result := waitResult(third.CommitID, "rolled_back", 70*time.Second)
	stamp, _ := time.Parse(time.RFC3339Nano, result.UpdatedAt)
	if stamp.Before(deadline) || stamp.Sub(deadline) > 8*time.Second {
		t.Fatal("rollback did not honor the 60-second deadline")
	}
	if result.Reason != "controller_confirmation_timeout" {
		t.Fatal("timeout reason lost")
	}
	snapshot, err = network.Inspect(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range snapshot.Interfaces {
		if s.Name == "ens36" && (len(s.Addresses) != 1 || s.Addresses[0] != "10.61.100.1/24") {
			t.Fatal("last confirmed state not restored")
		}
		if s.Name == "mgmt0" && (len(s.Addresses) != 1 || s.Addresses[0] != "192.0.2.1/24") {
			t.Fatal("management changed")
		}
	}
	// Failed candidates must not be automatically reapplied by a repeated fetch.
	time.Sleep(1500 * time.Millisecond)
	var latest network.InterfaceResult
	if err = network.ReadInterfaceFile(shared, "interface-result.json", &latest); err != nil || latest.CommitID != third.CommitID || latest.Status != "rolled_back" {
		t.Fatal("failed candidate was reapplied")
	}
	data, err := network.Command(ctx, "nft", []string{"list", "tables"}, "")
	if err != nil || !strings.Contains(string(data), "pmif") {
		t.Fatal("owned forwarding isolation missing")
	}
	// Real VLAN create/delete with rollback-compatible ownership.
	vlan := 100
	address := "10.62.100.1/24"
	c := network.InterfaceConfiguration{SchemaVersion: 1, NodeID: node, InterfaceName: "ens36", Kind: "vlan", SafeCommitSeconds: 60, Interfaces: []network.InterfaceSetting{{InterfaceName: "ens36", VLANID: &vlan, Role: "lan", Mode: "static", Address: &address, Enabled: true, MTU: 1400}}}
	r, err := network.NewInterfaceRequest("123e4567-e89b-42d3-a456-426614174004", c)
	if err != nil {
		t.Fatal(err)
	}
	if err = network.WriteInterfaceFile(shared, "interface-request.json", r); err != nil {
		t.Fatal(err)
	}
	pending = waitResult(r.CommitID, "awaiting_confirmation", 10*time.Second)
	confirm(pending)
	waitResult(r.CommitID, "applied", 10*time.Second)
	snapshot, err = network.Inspect(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	found = false
	for _, s := range snapshot.Interfaces {
		if s.Kind == "vlan" && s.VLANID == 100 && len(s.Addresses) == 1 && s.Addresses[0] == address {
			found = true
		}
	}
	if !found {
		t.Fatal("VLAN did not apply")
	}
	c.Interfaces = []network.InterfaceSetting{}
	r, err = network.NewInterfaceRequest("123e4567-e89b-42d3-a456-426614174005", c)
	if err != nil {
		t.Fatal(err)
	}
	if err = network.WriteInterfaceFile(shared, "interface-request.json", r); err != nil {
		t.Fatal(err)
	}
	pending = waitResult(r.CommitID, "awaiting_confirmation", 10*time.Second)
	confirm(pending)
	waitResult(r.CommitID, "applied", 10*time.Second)
	snapshot, err = network.Inspect(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range snapshot.Interfaces {
		if s.Kind == "vlan" && s.VLANID == 100 {
			t.Fatal("owned VLAN not deleted")
		}
	}
}
