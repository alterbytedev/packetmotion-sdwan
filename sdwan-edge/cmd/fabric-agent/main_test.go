package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"packetmotion/fabric-agent/internal/agent"
	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
)

func runCLI(args ...string) (string, string, error) {
	var stdout, stderr bytes.Buffer
	err := execute(args, &stdout, &stderr)
	return stdout.String(), stderr.String(), err
}

func TestVersionFlagsAndCommand(t *testing.T) {
	for _, args := range [][]string{{"--version"}, {"-version"}} {
		stdout, stderr, err := runCLI(args...)
		if err != nil {
			t.Fatalf("%v: unexpected error: %v", args, err)
		}
		if !strings.Contains(stdout, "fabric-agent version "+agent.Version+" (") || !strings.Contains(stdout, "/") {
			t.Errorf("%v: unexpected version output %q", args, stdout)
		}
		if stderr != "" {
			t.Errorf("%v: unexpected stderr %q", args, stderr)
		}
	}
	stdout, stderr, err := runCLI("version")
	if err != nil || stdout != agent.Version+"\n" || stderr != "" {
		t.Fatalf("legacy version command changed: stdout=%q stderr=%q err=%v", stdout, stderr, err)
	}
}

func TestHelpWithoutStartingAgent(t *testing.T) {
	stdout, stderr, err := runCLI("--help")
	if err != nil || !strings.Contains(stdout, "Commands: enroll, run, version") || stderr != "" {
		t.Fatalf("root help failed: stdout=%q stderr=%q err=%v", stdout, stderr, err)
	}
	stdout, stderr, err = runCLI("run", "--help")
	if err != nil || !strings.Contains(stderr, "-state-dir") || !strings.Contains(stderr, "-enable-routing") || strings.Contains(stderr, "-controller") || stdout != "" {
		t.Fatalf("run help failed: stdout=%q stderr=%q err=%v", stdout, stderr, err)
	}
	stdout, stderr, err = runCLI("enroll", "--help")
	if err != nil || !strings.Contains(stderr, "-controller") || !strings.Contains(stderr, "-server-ca") || strings.Contains(stderr, "-enable-routing") || stdout != "" {
		t.Fatalf("enroll help failed: stdout=%q stderr=%q err=%v", stdout, stderr, err)
	}
}

func TestUnknownCommandIsActionable(t *testing.T) {
	_, _, err := runCLI("unknown-command")
	if err == nil || !strings.Contains(err.Error(), "fabric-agent --help") {
		t.Fatalf("unknown command error = %v", err)
	}
}

func TestManagementRetriesRemainIndependentAndKeepHeartbeatSnapshot(t *testing.T) {
	now := time.Now()
	state := identity.State{ExpiresAt: now.Add(30 * 24 * time.Hour).Format(time.RFC3339)}
	scheduler := newManagementScheduler(state, now)
	scheduler.nextHeartbeat = now
	scheduler.nextDesired = now
	scheduler.nextRenewal = now
	heartbeatFailure := errors.New("heartbeat failed")
	configFailure := errors.New("config failed")
	snapshotCount := 0
	heartbeatCalls, renewalCalls, desiredCalls := 0, 0, 0
	operations := managementOperations{
		renew: func(context.Context) error { renewalCalls++; return errors.New("renewal failed") },
		heartbeat: func(_ context.Context, snapshot agent.Telemetry) error {
			heartbeatCalls++
			if snapshot.EventID != "stable-event" {
				t.Errorf("heartbeat snapshot changed across retries: %q", snapshot.EventID)
			}
			if heartbeatCalls == 1 {
				return heartbeatFailure
			}
			return nil
		},
		desired: func(_ context.Context, wait time.Duration) (time.Duration, error) {
			desiredCalls++
			if wait != 0 && wait > maxDesiredWait {
				t.Errorf("desired wait exceeds bound: %s", wait)
			}
			return 0, configFailure
		},
		snapshot: func() agent.Telemetry { snapshotCount++; return agent.Telemetry{EventID: "stable-event"} },
	}
	joined := scheduler.runCycle(context.Background(), now, &state, operations, false)
	if !errors.Is(joined, heartbeatFailure) || !errors.Is(joined, configFailure) || heartbeatCalls != 1 || desiredCalls != 1 || renewalCalls != 1 {
		t.Fatalf("independent operations did not all run: heartbeat=%d desired=%d renewal=%d err=%v", heartbeatCalls, desiredCalls, renewalCalls, joined)
	}
	if scheduler.heartbeatRetry <= initialRetryDelay || scheduler.desiredRetry <= initialRetryDelay || scheduler.renewalRetry <= initialRetryDelay {
		t.Fatal("failed operations did not advance their independent retry deadlines")
	}

	// Advance to heartbeat retry while the desired-state retry remains independently scheduled.
	scheduler.nextDesired = now.Add(time.Hour)
	scheduler.nextRenewal = now.Add(time.Hour)
	joined = scheduler.runCycle(context.Background(), scheduler.nextHeartbeat, &state, operations, false)
	if joined != nil || heartbeatCalls != 2 || desiredCalls != 1 || renewalCalls != 1 || snapshotCount != 1 {
		t.Fatalf("heartbeat retry was coupled to config retry or snapshot changed: heartbeat=%d desired=%d renewal=%d snapshots=%d err=%v", heartbeatCalls, desiredCalls, renewalCalls, snapshotCount, joined)
	}
	if scheduler.heartbeatRetry != initialRetryDelay {
		t.Fatalf("successful heartbeat did not reset its retry delay: %s", scheduler.heartbeatRetry)
	}
	scheduler.nextHeartbeat = scheduler.nextHeartbeat.Add(time.Hour)
	scheduler.nextDesired = now.Add(2 * time.Second)
	joined = scheduler.runCycle(context.Background(), scheduler.nextDesired, &state, operations, false)
	if !errors.Is(joined, configFailure) || heartbeatCalls != 2 || desiredCalls != 2 || renewalCalls != 1 {
		t.Fatalf("config retry changed another operation's schedule: heartbeat=%d desired=%d renewal=%d err=%v", heartbeatCalls, desiredCalls, renewalCalls, joined)
	}
}

func TestSuccessfulRenewalResetsOnlyItsOwnRetrySchedule(t *testing.T) {
	now := time.Now()
	state := identity.State{ExpiresAt: now.Add(20 * 24 * time.Hour).Format(time.RFC3339)}
	scheduler := newManagementScheduler(state, now)
	scheduler.nextHeartbeat = now.Add(time.Hour)
	scheduler.nextDesired = now.Add(time.Hour)
	scheduler.nextRenewal = now
	scheduler.renewalRetry = 30 * time.Second
	scheduler.heartbeatRetry = 4 * time.Second
	scheduler.desiredRetry = 8 * time.Second
	operations := managementOperations{
		renew: func(context.Context) error {
			state.ExpiresAt = now.Add(40 * 24 * time.Hour).Format(time.RFC3339)
			return nil
		},
		heartbeat: func(context.Context, agent.Telemetry) error { t.Error("heartbeat was not due"); return nil },
		desired: func(context.Context, time.Duration) (time.Duration, error) {
			t.Error("desired read was not due")
			return 0, nil
		},
		snapshot: func() agent.Telemetry { return agent.Telemetry{} },
	}
	if err := scheduler.runCycle(context.Background(), now, &state, operations, false); err != nil {
		t.Fatal(err)
	}
	if scheduler.renewalRetry != initialRetryDelay || scheduler.heartbeatRetry != 4*time.Second || scheduler.desiredRetry != 8*time.Second {
		t.Fatalf("renewal reset affected independent retry state: renewal=%s heartbeat=%s desired=%s", scheduler.renewalRetry, scheduler.heartbeatRetry, scheduler.desiredRetry)
	}
	if !scheduler.nextRenewal.Equal(renewalDeadline(state, now)) || !scheduler.nextRenewal.After(now) {
		t.Fatalf("renewal deadline not based on persisted certificate expiry: %s", scheduler.nextRenewal)
	}
}

func TestManagementSchedulerBoundsRetriesWaitAndOnceMode(t *testing.T) {
	now := time.Now()
	deadline, next := retryDeadline(now, initialRetryDelay, nil)
	if deadline.Before(now.Add(initialRetryDelay)) || deadline.After(now.Add(1200*time.Millisecond)) || next != 2*initialRetryDelay {
		t.Fatalf("first retry is out of bounds: deadline=%s next=%s", deadline.Sub(now), next)
	}
	deadline, next = retryDeadline(now, maxRetryDelay, nil)
	if deadline.Sub(now) != maxRetryDelay || next != maxRetryDelay {
		t.Fatalf("retry cap changed: deadline=%s next=%s", deadline.Sub(now), next)
	}
	hintedDeadline, hintedNext := retryDeadline(now, initialRetryDelay, &controller.RequestError{RetryAfter: 30 * time.Second})
	if hintedDeadline.Sub(now) != 30*time.Second || hintedNext != 2*initialRetryDelay {
		t.Fatalf("bounded server retry hint was not preserved independently: deadline=%s next=%s", hintedDeadline.Sub(now), hintedNext)
	}

	state := identity.State{ExpiresAt: now.Add(30 * 24 * time.Hour).Format(time.RFC3339)}
	scheduler := newManagementScheduler(state, now)
	scheduler.nextHeartbeat = now.Add(5 * time.Second)
	if got := scheduler.desiredWait(now); got != 5*time.Second {
		t.Fatalf("long poll was not capped by next heartbeat: %s", got)
	}
	scheduler.nextRenewal = now
	if got := scheduler.desiredWait(now); got != 0 {
		t.Fatalf("overdue renewal must prevent another long wait: %s", got)
	}
	scheduler.nextRenewal = now.Add(time.Hour)
	var gotWait time.Duration = -1
	operations := managementOperations{
		renew:     func(context.Context) error { return nil },
		heartbeat: func(context.Context, agent.Telemetry) error { return nil },
		desired:   func(_ context.Context, wait time.Duration) (time.Duration, error) { gotWait = wait; return 0, nil },
		snapshot:  func() agent.Telemetry { return agent.Telemetry{} },
	}
	if err := scheduler.runCycle(context.Background(), now, &state, operations, true); err != nil || gotWait != 0 {
		t.Fatalf("--once must not long-poll: wait=%s err=%v", gotWait, err)
	}
}

func TestWaitUntilStopsOnCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitUntil(ctx, time.Now().Add(time.Hour)); !errors.Is(err, context.Canceled) {
		t.Fatalf("wait did not stop on cancellation: %v", err)
	}
}
