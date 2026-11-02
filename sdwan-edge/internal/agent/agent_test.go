package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
	"packetmotion/fabric-agent/internal/network"
	"path/filepath"
	"strings"
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
		case "/api/agent/v1/wireguard-key":
			w.Write([]byte(`{"registered":true}`))
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

func TestSchemaThreeBGPPlanStagesWithoutLocalRoutingOptIn(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	state := identity.State{NodeID: "node", Kind: "branch"}
	payload := `{"schemaVersion":3,"deviceKind":"branch","mode":"gateway","lanPrefix":"10.61.0.0/24","pollIntervalSeconds":30,"wireguard":{"tunnels":[{"name":"pm0123456789ab","address":"10.250.0.1/31","peerAddress":"10.250.0.0","publicKey":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=","endpoint":"192.0.2.1:22000","listenPort":0,"keepalive":25,"allowedPrefixes":["10.62.0.0/24"]}],"routing":{"lan":{"interfaceName":"ens34","address":"10.61.0.1/24","advertisedPrefix":"10.61.0.0/24"},"protectedPrefixes":["192.168.160.0/24"],"bgp":{"localAsn":65001,"routerId":"10.61.0.1","peers":[{"interfaceName":"pm0123456789ab","address":"10.250.0.0","remoteAsn":65000,"importPrefixes":["10.62.0.0/24"],"exportPrefixes":["10.61.0.0/24"],"localPreference":200}]}}}}`
	sum := sha256.Sum256([]byte(payload))
	checksum := hex.EncodeToString(sum[:])
	acknowledged, applied := false, false
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agent/v1/wireguard-key":
			w.Write([]byte(`{"registered":true}`))
		case "/api/agent/v1/heartbeat":
			w.Write([]byte(`{"accepted":true}`))
		case "/api/agent/v1/desired":
			fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":"%s"}`, payload, checksum)
		case "/api/agent/v1/ack":
			acknowledged = true
			w.Write([]byte(`{"accepted":true}`))
		case "/api/agent/v1/wireguard-status":
			var report struct {
				Status string `json:"status"`
			}
			if err := json.NewDecoder(r.Body).Decode(&report); err != nil || report.Status != "disabled" {
				t.Errorf("routing was applied without local opt-in: %+v, %v", report, err)
			}
			applied = report.Status == "applied"
			w.Write([]byte(`{"recorded":true}`))
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	client := &controller.Client{URL: server.URL, HTTP: server.Client()}
	if _, err := Poll(context.Background(), client, &state, directory, Snapshot(time.Now())); err != nil {
		t.Fatal(err)
	}
	if !acknowledged || applied || state.Revision != 1 {
		t.Fatal("schema-v3 plan was not staged separately from local network activation")
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
		case "/api/agent/v1/wireguard-key":
			w.Write([]byte(`{"registered":true}`))
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

func TestDiagnosticRequestIsReportedWithoutWireGuardOptIn(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	state := identity.State{NodeID: "node", Kind: "branch"}
	const requestID = "123e4567-e89b-42d3-a456-426614174000"
	reported := false
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agent/v1/wireguard-key":
			w.Write([]byte(`{"registered":true}`))
		case "/api/agent/v1/heartbeat":
			w.Write([]byte(`{"accepted":true}`))
		case "/api/agent/v1/desired":
			fmt.Fprintf(w, `{"revision":0,"diagnosticRequest":{"requestId":%q}}`, requestID)
		case "/api/agent/v1/device-state":
			var result map[string]any
			if err := json.NewDecoder(r.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
			report, ok := result["report"].(map[string]any)
			reported = result["requestId"] == requestID && result["status"] == "completed" && ok && report["wireguardEnabled"] == false
			w.Write([]byte(`{"recorded":true}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	client := &controller.Client{URL: server.URL, HTTP: server.Client()}
	interval, err := Poll(context.Background(), client, &state, directory, Snapshot(time.Now()))
	if err != nil || !reported || interval != 30*time.Second {
		t.Fatalf("device diagnostic outcome: interval=%s reported=%v err=%v", interval, reported, err)
	}
}

func TestDiagnosticIsReportedBeforeInvalidDesiredConfigIsRejected(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	state := identity.State{NodeID: "node", Kind: "branch"}
	const requestID = "123e4567-e89b-42d3-a456-426614174000"
	const payload = `{"schemaVersion":99,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30}`
	sum := sha256.Sum256([]byte(payload))
	checksum := hex.EncodeToString(sum[:])
	var diagnosticSent, rejected bool
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agent/v1/wireguard-key":
			w.Write([]byte(`{"registered":true}`))
		case "/api/agent/v1/desired":
			fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":"%s","diagnosticRequest":{"requestId":%q}}`, payload, checksum, requestID)
		case "/api/agent/v1/device-state":
			diagnosticSent = true
			w.Write([]byte(`{"recorded":true}`))
		case "/api/agent/v1/ack":
			var ack struct {
				Status string `json:"status"`
			}
			if err := json.NewDecoder(r.Body).Decode(&ack); err != nil {
				t.Fatal(err)
			}
			rejected = ack.Status == "rejected"
			w.Write([]byte(`{"accepted":true}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	client := &controller.Client{URL: server.URL, HTTP: server.Client()}
	if _, err := Reconcile(context.Background(), client, &state, directory); err == nil || !diagnosticSent || !rejected {
		t.Fatalf("invalid config handling: diagnostic=%v rejected=%v err=%v", diagnosticSent, rejected, err)
	}
}

func TestDiagnosticFailureIsPreservedAlongsideConfigFailure(t *testing.T) {
	for _, testCase := range []struct {
		name           string
		payload        string
		wantAck        string
		wantRevision   int
		wantConfigText string
		failAck        bool
		corruptHash    bool
		insecureState  bool
	}{
		{
			name:           "invalid schema",
			payload:        `{"schemaVersion":99,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30}`,
			wantAck:        "rejected",
			wantConfigText: "unsupported desired config",
		},
		{
			name:           "acknowledgement failure",
			payload:        `{"schemaVersion":1,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30}`,
			wantAck:        "received",
			wantRevision:   1,
			wantConfigText: "HTTP 503",
			failAck:        true,
		},
		{
			name:           "successful configuration with failed diagnostic",
			payload:        `{"schemaVersion":1,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30}`,
			wantAck:        "received",
			wantRevision:   1,
			wantConfigText: "HTTP 503",
		},
		{
			name:           "invalid checksum",
			payload:        `{"schemaVersion":1,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30}`,
			wantConfigText: "invalid/stale desired revision",
			corruptHash:    true,
		},
		{
			name:           "stage write failure",
			payload:        `{"schemaVersion":1,"deviceKind":"branch","mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30}`,
			wantConfigText: "state directory must be private",
			insecureState:  true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			directory := filepath.Join(t.TempDir(), "state")
			if testCase.insecureState {
				if err := os.Mkdir(directory, 0755); err != nil {
					t.Fatal(err)
				}
			}
			state := identity.State{NodeID: "node", Kind: "branch"}
			sum := sha256.Sum256([]byte(testCase.payload))
			checksum := hex.EncodeToString(sum[:])
			if testCase.corruptHash {
				checksum = "invalid"
			}
			const requestID = "123e4567-e89b-42d3-a456-426614174000"
			ackStatus := ""
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/agent/v1/wireguard-key":
					w.Write([]byte(`{"registered":true}`))
				case "/api/agent/v1/desired":
					fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":"%s","diagnosticRequest":{"requestId":%q}}`, testCase.payload, checksum, requestID)
				case "/api/agent/v1/device-state":
					w.Header().Set("X-Request-ID", requestID)
					w.WriteHeader(http.StatusServiceUnavailable)
				case "/api/agent/v1/ack":
					var ack struct {
						Status string `json:"status"`
					}
					if err := json.NewDecoder(r.Body).Decode(&ack); err != nil {
						t.Error(err)
					}
					ackStatus = ack.Status
					if testCase.failAck {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					w.Write([]byte(`{"accepted":true}`))
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			client := &controller.Client{URL: server.URL, HTTP: server.Client()}
			_, err := Reconcile(context.Background(), client, &state, directory)
			if err == nil || !strings.Contains(err.Error(), testCase.wantConfigText) || !strings.Contains(err.Error(), "controller rejected request (HTTP 503)") {
				t.Fatalf("expected config and diagnostic failures, got %v", err)
			}
			requestError := findRequestError(err, "device-state.report")
			if requestError == nil || requestError.RequestID != requestID {
				t.Fatalf("typed diagnostic metadata was lost while wrapping config failure: %+v err=%v", requestError, err)
			}
			if ackStatus != testCase.wantAck || state.Revision != testCase.wantRevision {
				t.Fatalf("unexpected config outcome: ack=%q revision=%d", ackStatus, state.Revision)
			}
		})
	}
}

func findRequestError(err error, operation string) *controller.RequestError {
	if typed, ok := err.(*controller.RequestError); ok && typed.Operation == operation {
		return typed
	}
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		for _, child := range joined.Unwrap() {
			if typed := findRequestError(child, operation); typed != nil {
				return typed
			}
		}
		return nil
	}
	if wrapped := errors.Unwrap(err); wrapped != nil {
		return findRequestError(wrapped, operation)
	}
	return nil
}

func TestDeviceStateWireShapeAndCompleteEnvelopeLimit(t *testing.T) {
	plan := &network.Plan{Tunnels: []network.Tunnel{{AllowedPrefixes: []string{}}}}
	report := &network.DeviceState{StateDirectory: "", AppliedPlan: plan}
	response := boundedDeviceStateResponse("123e4567-e89b-42d3-a456-426614174000", "completed", report)
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `"allowedPrefixes"`) {
		t.Fatalf("empty omitempty slice unexpectedly serialized: %s", encoded)
	}

	base, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	// ASCII path bytes grow the full request envelope one-for-one.
	report.StateDirectory = strings.Repeat("x", 32768-len(base))
	response = boundedDeviceStateResponse("123e4567-e89b-42d3-a456-426614174000", "completed", report)
	encoded, err = json.Marshal(response)
	if err != nil || len(encoded) != 32768 || response["status"] != "completed" {
		t.Fatalf("exact-boundary envelope not accepted: len=%d status=%v err=%v", len(encoded), response["status"], err)
	}
	report.StateDirectory += "x"
	response = boundedDeviceStateResponse("123e4567-e89b-42d3-a456-426614174000", "completed", report)
	if response["status"] != "unavailable" || response["report"] != nil {
		t.Fatal("oversized complete envelope must degrade to a bounded unavailable response")
	}
	encoded, err = json.Marshal(response)
	if err != nil || len(encoded) > 32768 {
		t.Fatalf("unavailable response exceeds ingress limit: len=%d err=%v", len(encoded), err)
	}
}

func TestDeviceStateEmptyPrefixesGoldenWireFixture(t *testing.T) {
	endpoint := "192.0.2.1:22000"
	response := boundedDeviceStateResponse("123e4567-e89b-42d3-a456-426614174000", "completed", &network.DeviceState{
		StateDirectory:   "/var/lib/packetmotion",
		Revision:         3,
		WireGuardEnabled: true,
		Files:            []network.StateFile{},
		AppliedPlan: &network.Plan{Tunnels: []network.Tunnel{{
			Name: "pm123456789abc", Address: "10.250.0.1/31", PeerAddress: "10.250.0.0",
			PublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", Endpoint: &endpoint,
			Keepalive: 25, AllowedPrefixes: []string{},
		}}},
		Interfaces:               []network.RuntimeInterface{},
		UnplannedOwnedInterfaces: []string{},
	})
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("testdata/device-state-empty-prefix.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded)+"\n" != string(want) {
		t.Fatalf("Go device-state wire shape changed; update the cross-language fixture deliberately\n got: %s\nwant: %s", encoded, want)
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
		case "/api/agent/v1/wireguard-key":
			w.Write([]byte(`{"registered":true}`))
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
				case "/api/agent/v1/wireguard-key":
					w.Write([]byte(`{"registered":true}`))
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
		case "/api/agent/v1/wireguard-key":
			w.Write([]byte(`{"registered":true}`))
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
		case "/api/agent/v1/wireguard-key":
			w.Write([]byte(`{"registered":true}`))
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

func TestNetworkEnginePreservesLocalAuthorizationAndManagementAddress(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	state := &identity.State{NodeID: "edge", RoutingEnabled: true, LANInterface: "ens34"}
	engine, err := NetworkEngine(context.Background(), state, directory, "https://192.0.2.10")
	if err != nil {
		t.Fatal(err)
	}
	if !engine.AllowRouting || engine.LANInterface != "ens34" || engine.NodeID != "edge" || len(engine.ManagementIPs) != 1 || engine.ManagementIPs[0] != "192.0.2.10" {
		t.Fatalf("missing safety inputs: %+v", engine)
	}
	state.RoutingEnabled = false
	engine, err = NetworkEngine(context.Background(), state, directory, "https://192.0.2.10")
	if err != nil || engine.AllowRouting {
		t.Fatalf("local opt-in bypassed: %v", err)
	}
}

func TestManagementOnlyRegistersStableKeyAndRetriesWithoutBlockingReceipt(t *testing.T) {
	for _, kind := range []string{"branch", "hub"} {
		t.Run(kind, func(t *testing.T) {
			directory := filepath.Join(t.TempDir(), "state")
			state := identity.State{NodeID: "node", Kind: kind}
			payload := fmt.Sprintf(`{"schemaVersion":1,"deviceKind":%q,"mode":"gateway","lanPrefix":null,"pollIntervalSeconds":30}`, kind)
			sum := sha256.Sum256([]byte(payload))
			checksum := hex.EncodeToString(sum[:])
			registrations, acks := 0, 0
			var postedKey string
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/agent/v1/wireguard-key":
					registrations++
					var body map[string]string
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body) != 1 || body["publicKey"] == "" || r.Method != http.MethodPost {
						t.Errorf("unexpected registration envelope")
					}
					if postedKey != "" && postedKey != body["publicKey"] {
						t.Error("retry rotated key")
					}
					postedKey = body["publicKey"]
					if registrations == 1 {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					w.Write([]byte(`{}`))
				case "/api/agent/v1/desired":
					fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":%q}`, payload, checksum)
				case "/api/agent/v1/ack":
					acks++
					w.Write([]byte(`{}`))
				default:
					t.Errorf("unexpected request %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			client := &controller.Client{URL: server.URL, HTTP: server.Client()}
			if _, err := Reconcile(context.Background(), client, &state, directory); err == nil {
				t.Fatal("registration failure was hidden")
			}
			if state.Revision != 1 || acks != 1 || state.WireGuardPublicKey != "" || state.PendingAcknowledgement {
				t.Fatal("failed registration blocked receipt or was persisted as accepted")
			}
			if _, err := Reconcile(context.Background(), client, &state, directory); err != nil {
				t.Fatal(err)
			}
			privateKey, publicKey, err := network.Key(directory)
			if err != nil || publicKey != postedKey || postedKey == privateKey || state.WireGuardPublicKey != publicKey {
				t.Fatal("registered key does not match local public key")
			}
			// Reload durable identity: accepted registration is not repeated on restart.
			loaded, err := identity.Load(directory)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := Reconcile(context.Background(), client, &loaded, directory); err != nil {
				t.Fatal(err)
			}
			if registrations != 2 || loaded.WireGuardEnabled {
				t.Fatal("registration repeated or enabled networking")
			}
			info, err := os.Stat(filepath.Join(directory, "wireguard.key"))
			if err != nil || info.Mode().Perm() != 0600 {
				t.Fatal("key permissions are not private")
			}
			entries, _ := os.ReadDir(directory)
			for _, entry := range entries {
				if entry.Name() != "identity.json" && entry.Name() != "desired.json" && entry.Name() != "wireguard.key" {
					t.Errorf("unexpected network state %s", entry.Name())
				}
			}
		})
	}
}

func TestSchemaFourTransitRulesRequireLocalTransitOptIn(t *testing.T) {
	payload := `{"schemaVersion":4,"deviceKind":"branch","mode":"gateway","lanPrefix":"10.61.0.0/24","pollIntervalSeconds":30,"wireguard":{"tunnels":[{"name":"pm0123456789ab","address":"10.250.0.1/31","peerAddress":"10.250.0.0","publicKey":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=","endpoint":"192.0.2.1:22000","listenPort":0,"keepalive":25,"allowedPrefixes":["10.62.0.0/24"]}],"routing":{"lan":{"interfaceName":"ens34","address":"10.61.0.1/24","advertisedPrefix":"10.61.0.0/24"},"protectedPrefixes":["192.168.160.0/24"],"transit":[{"id":"lan-to-peer","source":"10.61.0.0/24","destination":"10.62.0.0/24","protocol":"any"}],"bgp":{"localAsn":65001,"routerId":"10.61.0.1","peers":[{"interfaceName":"pm0123456789ab","address":"10.250.0.0","remoteAsn":65000,"importPrefixes":["10.62.0.0/24"],"exportPrefixes":["10.61.0.0/24"],"localPreference":200}]}}}}`
	sum := sha256.Sum256([]byte(payload))
	checksum := hex.EncodeToString(sum[:])
	for _, optIn := range []bool{false, true} {
		directory := filepath.Join(t.TempDir(), "state")
		state := identity.State{NodeID: "node", Kind: "branch", TransitEnabled: optIn}
		status := ""
		server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/api/agent/v1/desired":
				fmt.Fprintf(w, `{"revision":1,"payload":%s,"checksum":"%s"}`, payload, checksum)
			case "/api/agent/v1/ack":
				var body struct {
					Status string `json:"status"`
				}
				json.NewDecoder(r.Body).Decode(&body)
				status = body.Status
				w.Write([]byte(`{"accepted":true}`))
			default:
				w.Write([]byte(`{"accepted":true,"registered":true,"recorded":true}`))
			}
		}))
		client := &controller.Client{URL: server.URL, HTTP: server.Client()}
		_, err := Poll(context.Background(), client, &state, directory, Snapshot(time.Now()))
		server.Close()
		if optIn && (err != nil || state.Revision != 1) {
			t.Fatalf("opted-in agent did not stage transit rules: %v", err)
		}
		if !optIn && (err == nil || status != "rejected" || state.Revision != 0) {
			t.Fatalf("transit rules staged without local opt-in: %v %q", err, status)
		}
	}
}
