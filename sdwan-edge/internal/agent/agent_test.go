package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
