package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
	"packetmotion/fabric-agent/internal/network"
)

func TestInterfaceResultReportingAndFreshConfirmation(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	node := "123e4567-e89b-42d3-a456-426614174000"
	address := "10.61.100.1/24"
	c := network.InterfaceConfiguration{SchemaVersion: 1, NodeID: node, InterfaceName: "ens36", Kind: "physical", SafeCommitSeconds: 60, Interfaces: []network.InterfaceSetting{{InterfaceName: "ens36", Role: "lan", Mode: "static", Address: &address, Enabled: true, MTU: 1500}}}
	request, err := network.NewInterfaceRequest("123e4567-e89b-42d3-a456-426614174001", c)
	if err != nil {
		t.Fatal(err)
	}
	capability := network.InterfaceCapability{NodeID: node, ProtocolVersion: 1, Mode: "dedicated-static", Interfaces: []string{"ens36"}, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if err = network.WriteInterfaceFile(dir, "interface-capability.json", capability); err != nil {
		t.Fatal(err)
	}
	reports, confirmations := 0, 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agent/v1/interface-result":
			reports++
			w.Write([]byte(`{"accepted":true}`))
		case "/api/agent/v1/interface-confirm":
			confirmations++
			var input interfaceConfirmation
			if json.NewDecoder(r.Body).Decode(&input) != nil {
				t.Error("invalid confirmation")
			}
			_ = json.NewEncoder(w).Encode(input)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client := &controller.Client{URL: server.URL, HTTP: server.Client()}
	state := identity.State{NodeID: node}
	if err = reconcileInterfaceCommit(context.Background(), client, &state, dir, &request); err != nil {
		t.Fatal(err)
	}
	var staged network.InterfaceRequest
	if err = network.ReadInterfaceFile(dir, "interface-request.json", &staged); err != nil || staged.Checksum != request.Checksum {
		t.Fatal("request not staged")
	}
	result := network.InterfaceResult{CommitID: request.CommitID, Checksum: request.Checksum, Status: "awaiting_confirmation", Nonce: strings.Repeat("a", 64), Sequence: 2, Deadline: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if err = network.WriteInterfaceFile(dir, "interface-result.json", result); err != nil {
		t.Fatal(err)
	}
	if err = reconcileInterfaceCommit(context.Background(), client, &state, dir, nil); err != nil {
		t.Fatal(err)
	}
	if reports != 1 || confirmations != 1 {
		t.Fatal("missing authenticated report/confirmation")
	}
	var confirmation interfaceConfirmation
	if err = network.ReadInterfaceFile(dir, "interface-confirmation.json", &confirmation); err != nil || confirmation.Nonce != result.Nonce {
		t.Fatal("confirmation not bound to transaction")
	}
	if err = reconcileInterfaceCommit(context.Background(), client, &state, dir, nil); err != nil {
		t.Fatal(err)
	}
	if reports != 1 {
		t.Fatal("acknowledged result repeatedly reported")
	}
	result.Status = "rolled_back"
	result.Sequence = 3
	result.Reason = "controller_confirmation_timeout"
	if err = network.WriteInterfaceFile(dir, "interface-history.json", interfaceHistory{Results: []network.InterfaceResult{result}}); err != nil {
		t.Fatal(err)
	}
	if err = network.WriteInterfaceFile(dir, "interface-result.json", result); err != nil {
		t.Fatal(err)
	}
	if err = reconcileInterfaceCommit(context.Background(), client, &state, dir, nil); err != nil {
		t.Fatal(err)
	}
	if reports != 2 {
		t.Fatal("rollback result not replayed")
	}
}
func TestCurrentAddressesReportedWithoutNetworkActivation(t *testing.T) {
	snapshot := Snapshot(time.Now())
	found := false
	for _, item := range snapshot.Interfaces {
		if item.Name == "lo" && item.Addresses != nil {
			for _, address := range *item.Addresses {
				if strings.HasPrefix(address, "127.") {
					found = true
				}
			}
		}
	}
	if !found {
		t.Fatal("current loopback addresses missing")
	}
	if snapshot.InterfaceApply != nil {
		t.Fatal("default service unexpectedly enabled interface apply")
	}
}
