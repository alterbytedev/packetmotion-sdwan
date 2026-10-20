package main

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"packetmotion/fabric-agent/internal/agent"
	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
)

const diagnosticNode = "12345678-1234-1234-1234-123456789abc"

func TestOperationReporterIsBoundedActionableAndRedacted(t *testing.T) {
	var output bytes.Buffer
	state := &identity.State{NodeID: diagnosticNode, Revision: 2, Key: "secret-private-key"}
	report := operationReporter(&output, state)
	err := &controller.RequestError{Code: "unauthorized", StatusCode: 401, RequestID: diagnosticNode, Cause: errors.New("secret-token https://user:password@controller/?cookie=secret")}
	report("heartbeat", err, time.Now().Add(time.Minute))
	report("heartbeat", err, time.Now().Add(time.Minute))
	if strings.Count(output.String(), "\n") != 1 {
		t.Fatal("repeated failure logged without a bound")
	}
	if !strings.Contains(output.String(), `"code":"unauthorized"`) || !strings.Contains(output.String(), `"retryAt":`) || !strings.Contains(output.String(), `"reference":"`+diagnosticNode+`"`) {
		t.Fatal("missing safe diagnostics")
	}
	report("heartbeat", nil, time.Time{})
	report("heartbeat", nil, time.Time{})
	if strings.Count(output.String(), "\n") != 2 {
		t.Fatal("recovery not logged exactly once")
	}
	report("desired", errors.New("password secret-token"), time.Time{})
	report("renewal", &controller.RequestError{Code: "secret-token", StatusCode: 999, RequestID: "password"}, time.Time{})
	for _, secret := range []string{"secret", "password", "cookie", "user:"} {
		if strings.Contains(output.String(), secret) {
			t.Fatalf("secret leaked: %s", secret)
		}
	}
	code, _, _ := failureDetails(&controller.RequestError{Cause: &net.DNSError{Err: "secret-token", Name: "secret-host"}})
	if code != "dns_failed" {
		t.Fatal("DNS failure was not classified")
	}
}

func TestStatusChecksIdentityAndControllerWithoutApplyingConfiguration(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "state")
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodGet || r.URL.Path != "/api/agent/v1/desired" {
			t.Error("status attempted a mutation")
		}
		w.Header().Set("X-Request-ID", diagnosticNode)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	state := identity.State{NodeID: diagnosticNode, AgentURL: server.URL, AllowLocal: true, Key: "private-key-sentinel", Revision: 4, PendingAcknowledgement: true}
	if err := identity.Save(directory, state); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(directory, "identity.json"))
	if err != nil {
		t.Fatal(err)
	}
	stdout, _, err := runCLI("status", "--state-dir", directory, "--expected-node-id", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "--check")
	if err == nil || !strings.Contains(stdout, `"status":"identity_mismatch"`) || calls != 0 {
		t.Fatal("mismatched identity used controller")
	}
	stdout, _, err = runCLI("status", "--state-dir", directory, "--expected-node-id", strings.ToUpper(diagnosticNode), "--check")
	if err == nil || !strings.Contains(stdout, `"controllerCheck":"unauthorized"`) || calls != 1 {
		t.Fatalf("missing authentication result: %s %v", stdout, err)
	}
	if strings.Contains(stdout, state.Key) {
		t.Fatal("status leaked private identity")
	}
	after, err := os.ReadFile(filepath.Join(directory, "identity.json"))
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("status changed identity")
	}
	stdout, _, err = runCLI("status", "--state-dir", directory)
	if err != nil || !strings.Contains(stdout, `"controllerCheck":"not_requested"`) || calls != 1 {
		t.Fatal("local status performed an unsolicited controller request")
	}
}

func TestSchedulerReportsIndependentOperationOutcomes(t *testing.T) {
	now := time.Now()
	state := &identity.State{ExpiresAt: now.Add(30 * 24 * time.Hour).Format(time.RFC3339)}
	scheduler := newManagementScheduler(*state, now)
	outcomes := map[string]error{}
	retries := map[string]time.Time{}
	err := scheduler.runCycle(context.Background(), now, state, managementOperations{
		heartbeat: func(context.Context, agent.Telemetry) error {
			return &controller.RequestError{Code: "unauthorized", StatusCode: 401}
		},
		desired:  func(context.Context, time.Duration) (time.Duration, error) { return 30 * time.Second, nil },
		snapshot: func() agent.Telemetry { return agent.Telemetry{} },
		report: func(operation string, err error, retry time.Time) {
			outcomes[operation] = err
			retries[operation] = retry
		},
	}, true)
	if err == nil || outcomes["heartbeat"] == nil || outcomes["desired"] != nil || !retries["heartbeat"].Equal(scheduler.nextHeartbeat) || !retries["desired"].IsZero() {
		t.Fatal("operation-specific results or retries lost")
	}
}

func TestJoinedNetworkFailureKeepsSafeReasonAndTransportReference(t *testing.T) {
	code, status, reference := failureDetails(errors.Join(errors.New("network apply failed; previous plan restored"), &controller.RequestError{Code: "server_error", StatusCode: 503, RequestID: diagnosticNode, Cause: errors.New("private-secret")}))
	if code != "network_apply_rolled_back" || status != 503 || reference != diagnosticNode {
		t.Fatalf("joined diagnostics lost: %s %d %s", code, status, reference)
	}
}
