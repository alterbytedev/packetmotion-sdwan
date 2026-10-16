package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
	"path/filepath"
	"testing"
	"time"
)

func TestReceivedConfigurationIsPersistedButNeverApplied(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	state := identity.State{NodeID: "node", Kind: "branch"}
	payload := `{"schemaVersion":1,"deviceKind":"branch","mode":"gateway","lanPrefix":"10.61.0.0/24","pollIntervalSeconds":30}`
	sum := sha256.Sum256([]byte(payload))
	checksum := hex.EncodeToString(sum[:])
	ack := false
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agent/v1/heartbeat":
			w.Write([]byte(`{"accepted":true}`))
		case "/api/agent/v1/desired":
			fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":"%s"}`, payload, checksum)
		case "/api/agent/v1/ack":
			ack = true
			w.Write([]byte(`{"accepted":true}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client := &controller.Client{URL: server.URL, HTTP: server.Client()}
	if _, err := Poll(context.Background(), client, &state, directory, Snapshot(time.Now())); err != nil {
		t.Fatal(err)
	}
	if !ack || state.Revision != 1 {
		t.Fatal("missing received acknowledgement")
	}
	before, err := os.ReadFile(filepath.Join(directory, "desired.json"))
	if err != nil {
		t.Fatal(err)
	}
	checksum = "forged"
	if _, err = Poll(context.Background(), client, &state, directory, Snapshot(time.Now())); err == nil {
		t.Fatal("forged config accepted")
	}
	after, _ := os.ReadFile(filepath.Join(directory, "desired.json"))
	if string(before) != string(after) {
		t.Fatal("invalid config replaced staged state")
	}
}

func TestCycleWaitRequestsBoundedDesiredStateWait(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	state := identity.State{NodeID: "node", Kind: "branch"}
	payload := `{"schemaVersion":1,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30}`
	sum := sha256.Sum256([]byte(payload))
	checksum := hex.EncodeToString(sum[:])
	gotHeartbeat, gotWait, gotAck := false, "", false
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agent/v1/heartbeat":
			gotHeartbeat = true
			w.Write([]byte(`{}`))
		case "/api/agent/v1/desired":
			gotWait = r.URL.Query().Get("wait")
			if r.URL.Query().Get("revision") != "0" || gotWait != "7" {
				t.Errorf("unexpected long-poll query: %s", r.URL.RawQuery)
			}
			fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":"%s"}`, payload, checksum)
		case "/api/agent/v1/ack":
			gotAck = true
			w.Write([]byte(`{}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	client := &controller.Client{URL: server.URL, HTTP: server.Client()}
	interval, heartbeatErr, configErr := CycleWait(context.Background(), client, &state, directory, Snapshot(time.Now()), 7*time.Second)
	if heartbeatErr != nil || configErr != nil || !gotHeartbeat || gotWait != "7" || !gotAck || state.Revision != 1 || interval != 30*time.Second {
		t.Fatalf("long-poll cycle failed: heartbeat=%v config=%v wait=%q ack=%v rev=%d interval=%s", heartbeatErr, configErr, gotWait, gotAck, state.Revision, interval)
	}
}

func TestEnrollingAgainNeverOverwritesExistingOrUnsafeIdentity(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	key, err := identity.CreateKey()
	if err != nil {
		t.Fatal(err)
	}
	state := identity.State{NodeID: "existing", Key: key, Controller: "https://controller.test"}
	if err = identity.Save(directory, state); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(directory, "identity.json"))
	if _, err = Enroll(context.Background(), "https://controller.test", "", "token", directory, false); err == nil {
		t.Fatal("existing identity replaced")
	}
	os.Chmod(filepath.Join(directory, "identity.json"), 0644)
	if _, err = Enroll(context.Background(), "https://controller.test", "", "token", directory, false); err == nil {
		t.Fatal("unsafe identity replaced")
	}
	after, _ := os.ReadFile(filepath.Join(directory, "identity.json"))
	if string(before) != string(after) {
		t.Fatal("identity content changed")
	}
}

func TestPendingEnrollmentCanRebindControllerWithoutReplacingKey(t *testing.T) {
	key, err := identity.CreateKey()
	if err != nil {
		t.Fatal(err)
	}
	state := identity.State{Key: key, Controller: "http://192.168.160.200:3000", AllowLocal: false}
	updated, err := rebindPendingIdentity(state, "http://192.168.160.200", "new-ca", true)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Controller != "http://192.168.160.200" || updated.ServerCA != "new-ca" || updated.Key != key || updated.NodeID != "" || !updated.AllowLocal {
		t.Fatalf("pending identity was not safely rebound: %+v", updated)
	}
	state.NodeID = "already-enrolled"
	if _, err := rebindPendingIdentity(state, "http://192.168.160.200", "new-ca", true); err == nil {
		t.Fatal("rebind accepted an enrolled identity")
	}
}

func TestReconciliationRetriesAfterRestartAndRepairsCache(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	state := identity.State{NodeID: "node", Kind: "branch"}
	payload := `{"schemaVersion":1,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30}`
	sum := sha256.Sum256([]byte(payload))
	checksum := hex.EncodeToString(sum[:])
	acknowledgements := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agent/v1/desired":
			if r.URL.Query().Get("checksum") == checksum {
				fmt.Fprintf(w, `{"revision":1,"checksum":"%s","unchanged":true}`, checksum)
			} else {
				fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":"%s"}`, payload, checksum)
			}
		case "/api/agent/v1/ack":
			acknowledgements++
			if acknowledgements == 1 {
				w.WriteHeader(503)
			} else {
				w.Write([]byte(`{}`))
			}
		}
	}))
	defer server.Close()
	client := &controller.Client{URL: server.URL, HTTP: server.Client()}
	if _, err := Reconcile(context.Background(), client, &state, directory); err == nil {
		t.Fatal("missing failure")
	}
	state, err := identity.Load(directory)
	if err != nil || !state.PendingAcknowledgement {
		t.Fatal("pending ack not durable", err)
	}
	if _, err = Reconcile(context.Background(), client, &state, directory); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(filepath.Join(directory, "identity.json"))
	if _, err = Reconcile(context.Background(), client, &state, directory); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(filepath.Join(directory, "identity.json"))
	if acknowledgements != 2 || !info.ModTime().Equal(after.ModTime()) {
		t.Fatal("unchanged config rewrote state or ack")
	}
	if err = os.WriteFile(filepath.Join(directory, "desired.json"), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = Reconcile(context.Background(), client, &state, directory); err != nil {
		t.Fatal(err)
	}
	repaired, _ := os.ReadFile(filepath.Join(directory, "desired.json"))
	if string(repaired) != payload {
		t.Fatal("cache not repaired")
	}
}

func TestManagementOperationsFailIndependentlyAndRejectUnsupportedConfig(t *testing.T) {
	for _, heartbeatFails := range []bool{false, true} {
		t.Run(fmt.Sprint(heartbeatFails), func(t *testing.T) {
			directory := filepath.Join(t.TempDir(), "state")
			state := identity.State{Kind: "branch"}
			payload := `{"schemaVersion":2,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30}`
			sum := sha256.Sum256([]byte(payload))
			checksum := hex.EncodeToString(sum[:])
			var status string
			desiredCalls := 0
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/agent/v1/heartbeat":
					if heartbeatFails {
						w.WriteHeader(503)
					} else {
						w.Write([]byte(`{}`))
					}
				case "/api/agent/v1/desired":
					desiredCalls++
					fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":"%s"}`, payload, checksum)
				case "/api/agent/v1/ack":
					var ack struct {
						Status string `json:"status"`
					}
					json.NewDecoder(r.Body).Decode(&ack)
					status = ack.Status
					w.Write([]byte(`{}`))
				}
			}))
			defer server.Close()
			client := &controller.Client{URL: server.URL, HTTP: server.Client()}
			_, heartbeatErr, configErr := Cycle(context.Background(), client, &state, directory, Snapshot(time.Now()))
			if (heartbeatErr != nil) != heartbeatFails || configErr == nil || desiredCalls != 1 || status != "rejected" || state.Revision != 0 {
				t.Fatal("operations coupled or invalid revision staged")
			}
		})
	}
}

func TestRenewalFailurePreservesIdentity(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	key, err := identity.CreateKey()
	if err != nil {
		t.Fatal(err)
	}
	state := identity.State{Key: key, Certificate: "old", ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}
	if err = identity.Save(directory, state); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(directory, "identity.json"))
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"certificate":"invalid","expiresAt":"%s"}`, time.Now().Add(30*24*time.Hour).UTC().Format(time.RFC3339))
	}))
	defer server.Close()
	client := &controller.Client{URL: server.URL, HTTP: server.Client()}
	next, err := Renew(context.Background(), client, &state, directory)
	after, _ := os.ReadFile(filepath.Join(directory, "identity.json"))
	if err == nil || next != client || state.Certificate != "old" || string(before) != string(after) {
		t.Fatal("failed renewal replaced identity")
	}
}

func TestWireguardReceiptDoesNotClaimApplyWithoutLocalOptIn(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	payload := `{"schemaVersion":2,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30,"wireguard":{"tunnels":[]}}`
	sum := sha256.Sum256([]byte(payload))
	checksum := hex.EncodeToString(sum[:])
	state := identity.State{NodeID: "node", Kind: "branch"}
	gotAck, gotDisabled := false, false
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agent/v1/desired":
			fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":"%s"}`, payload, checksum)
		case "/api/agent/v1/ack":
			gotAck = true
			w.Write([]byte(`{}`))
		case "/api/agent/v1/wireguard-status":
			var report struct {
				Status   string `json:"status"`
				Revision int    `json:"revision"`
			}
			if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
				t.Error(err)
			}
			gotDisabled = report.Status == "disabled" && report.Revision == 1
			w.Write([]byte(`{}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client := &controller.Client{URL: server.URL, HTTP: server.Client()}
	if _, err := Reconcile(context.Background(), client, &state, directory); err != nil {
		t.Fatal(err)
	}
	if !gotAck || !gotDisabled {
		t.Fatal("receipt and network status were not separated")
	}
	if _, err := os.Stat(filepath.Join(directory, "network-applied.json")); !os.IsNotExist(err) {
		t.Fatal("disabled agent attempted network apply")
	}
}

func TestWireguardSchemaCannotEnableRoutedLAN(t *testing.T) {
	directory := t.TempDir()
	state := identity.State{Kind: "branch"}
	payload := `{"schemaVersion":2,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30,"wireguard":{"tunnels":[],"routing":{"lan":{"interfaceName":"ens34","address":"10.61.0.1/24","advertisedPrefix":"10.61.0.0/24"},"protectedPrefixes":["192.168.160.0/24"]}}}`
	sum := sha256.Sum256([]byte(payload))
	rejected := false
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agent/v1/desired":
			fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":"%s"}`, payload, hex.EncodeToString(sum[:]))
		case "/api/agent/v1/ack":
			var ack struct {
				Status string `json:"status"`
			}
			if err := json.NewDecoder(r.Body).Decode(&ack); err != nil {
				t.Error(err)
			}
			rejected = ack.Status == "rejected"
			w.Write([]byte(`{}`))
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
		}
	}))
	defer server.Close()
	_, err := Reconcile(context.Background(), &controller.Client{URL: server.URL, HTTP: server.Client()}, &state, directory)
	if err == nil || !rejected || state.Revision != 0 {
		t.Fatal("schema 2 accepted routed configuration")
	}
	if _, err := os.Stat(filepath.Join(directory, "desired.json")); !os.IsNotExist(err) {
		t.Fatal("unsupported configuration staged")
	}
}
