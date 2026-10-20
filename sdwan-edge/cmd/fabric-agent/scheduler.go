package main

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"packetmotion/fabric-agent/internal/agent"
	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
	"time"
)

const (
	initialRetryDelay = time.Second
	maxRetryDelay     = time.Minute
	maxDesiredWait    = 25 * time.Second
)

type managementOperations struct {
	renew     func(context.Context) error
	heartbeat func(context.Context, agent.Telemetry) error
	desired   func(context.Context, time.Duration) (time.Duration, error)
	snapshot  func() agent.Telemetry
	now       func() time.Time
	report    func(string, error, time.Time)
}

type managementScheduler struct {
	heartbeatInterval time.Duration
	nextHeartbeat     time.Time
	nextRenewal       time.Time
	nextDesired       time.Time
	heartbeatRetry    time.Duration
	renewalRetry      time.Duration
	desiredRetry      time.Duration
	pendingHeartbeat  *agent.Telemetry
}

func newManagementScheduler(state identity.State, now time.Time) *managementScheduler {
	return &managementScheduler{
		heartbeatInterval: 30 * time.Second,
		nextHeartbeat:     now,
		nextRenewal:       renewalDeadline(state, now),
		nextDesired:       now,
		heartbeatRetry:    initialRetryDelay,
		renewalRetry:      initialRetryDelay,
		desiredRetry:      initialRetryDelay,
	}
}

func renewalDeadline(state identity.State, now time.Time) time.Time {
	expires, err := time.Parse(time.RFC3339, state.ExpiresAt)
	if err != nil {
		return now
	}
	due := expires.Add(-7 * 24 * time.Hour)
	if due.Before(now) {
		return now
	}
	return due
}

func retryDeadline(now time.Time, delay time.Duration, cause error) (time.Time, time.Duration) {
	if delay < initialRetryDelay {
		delay = initialRetryDelay
	}
	next := delay * 2
	if next > maxRetryDelay {
		next = maxRetryDelay
	}
	jitterMax := delay / 5
	if jitterMax > 0 {
		if jitter, err := rand.Int(rand.Reader, big.NewInt(int64(jitterMax)+1)); err == nil {
			delay += time.Duration(jitter.Int64())
		}
	}
	if delay > maxRetryDelay {
		delay = maxRetryDelay
	}
	var requestError *controller.RequestError
	if errors.As(cause, &requestError) && requestError.RetryAfter > delay && requestError.RetryAfter <= maxRetryDelay {
		delay = requestError.RetryAfter
	}
	return now.Add(delay), next
}

func (s *managementScheduler) desiredWait(now time.Time) time.Duration {
	wait := maxDesiredWait
	for _, deadline := range []time.Time{s.nextHeartbeat, s.nextRenewal} {
		if !deadline.After(now) {
			return 0
		}
		if deadline.Sub(now) < wait {
			wait = deadline.Sub(now)
		}
	}
	return wait
}

func (s *managementScheduler) nextDeadline() time.Time {
	next := s.nextDesired
	if s.nextHeartbeat.Before(next) {
		next = s.nextHeartbeat
	}
	if s.nextRenewal.Before(next) {
		next = s.nextRenewal
	}
	return next
}

func waitUntil(ctx context.Context, deadline time.Time) error {
	delay := time.Until(deadline)
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func schedulerNow(fallback time.Time, operations managementOperations) time.Time {
	if operations.now != nil {
		return operations.now()
	}
	return fallback
}

func (s *managementScheduler) runCycle(ctx context.Context, now time.Time, state *identity.State, operations managementOperations, once bool) error {
	var cycleErrors []error
	operationNow := schedulerNow(now, operations)
	if !operationNow.Before(s.nextRenewal) {
		if err := operations.renew(ctx); err != nil {
			s.nextRenewal, s.renewalRetry = retryDeadline(schedulerNow(operationNow, operations), s.renewalRetry, err)
			if operations.report != nil {
				operations.report("renewal", err, s.nextRenewal)
			}
			cycleErrors = append(cycleErrors, err)
		} else {
			if operations.report != nil {
				operations.report("renewal", nil, time.Time{})
			}
			s.renewalRetry = initialRetryDelay
			s.nextRenewal = renewalDeadline(*state, schedulerNow(operationNow, operations))
		}
	}

	operationNow = schedulerNow(operationNow, operations)
	heartbeatAt := operationNow
	heartbeatSent := false
	if !operationNow.Before(s.nextHeartbeat) {
		if s.pendingHeartbeat == nil {
			snapshot := operations.snapshot()
			s.pendingHeartbeat = &snapshot
		}
		if err := operations.heartbeat(ctx, *s.pendingHeartbeat); err != nil {
			s.nextHeartbeat, s.heartbeatRetry = retryDeadline(schedulerNow(operationNow, operations), s.heartbeatRetry, err)
			if operations.report != nil {
				operations.report("heartbeat", err, s.nextHeartbeat)
			}
			cycleErrors = append(cycleErrors, err)
		} else {
			s.pendingHeartbeat = nil
			if operations.report != nil {
				operations.report("heartbeat", nil, time.Time{})
			}
			s.heartbeatRetry = initialRetryDelay
			s.nextHeartbeat = heartbeatAt.Add(s.heartbeatInterval)
			heartbeatSent = true
		}
	}

	operationNow = schedulerNow(operationNow, operations)
	if !operationNow.Before(s.nextDesired) {
		wait := s.desiredWait(operationNow)
		if once {
			wait = 0
		}
		interval, err := operations.desired(ctx, wait)
		if err != nil {
			s.nextDesired, s.desiredRetry = retryDeadline(schedulerNow(operationNow, operations), s.desiredRetry, err)
			if operations.report != nil {
				operations.report("desired", err, s.nextDesired)
			}
			cycleErrors = append(cycleErrors, err)
		} else {
			if operations.report != nil {
				operations.report("desired", nil, time.Time{})
			}
			s.desiredRetry = initialRetryDelay
			s.nextDesired = schedulerNow(operationNow, operations)
			if interval > 0 {
				s.heartbeatInterval = interval
				if heartbeatSent {
					s.nextHeartbeat = heartbeatAt.Add(interval)
				}
			}
		}
	}
	return errors.Join(cycleErrors...)
}

func runManagementLoop(ctx context.Context, once bool, state *identity.State, operations managementOperations) error {
	scheduler := newManagementScheduler(*state, time.Now())
	for {
		err := scheduler.runCycle(ctx, time.Now(), state, operations, once)
		if once {
			return err
		}
		if ctx.Err() != nil {
			return nil
		}
		deadline := scheduler.nextDeadline()
		if time.Until(deadline) <= 0 {
			continue
		}
		if err := waitUntil(ctx, deadline); err != nil {
			return nil
		}
	}
}
