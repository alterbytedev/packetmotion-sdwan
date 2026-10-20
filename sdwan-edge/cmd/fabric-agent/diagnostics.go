package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"syscall"
	"time"

	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
)

type operationEvent struct {
	Time             string `json:"time"`
	Operation        string `json:"operation"`
	RequestOperation string `json:"requestOperation,omitempty"`
	Status           string `json:"status"`
	Code             string `json:"code,omitempty"`
	HTTPStatus       int    `json:"httpStatus,omitempty"`
	Reference        string `json:"reference,omitempty"`
	RetryAt          string `json:"retryAt,omitempty"`
	NodeID           string `json:"nodeId,omitempty"`
	Revision         int    `json:"revision,omitempty"`
}

// Error strings and causes may contain URLs or secrets. Only static codes and
// validated transport metadata reach the journal, including for joined errors.
func failureDetails(err error) (string, int, string) {
	code := "operation_failed"
	status := 0
	reference := ""
	var request *controller.RequestError
	if errors.As(err, &request) {
		switch request.Code {
		case "bad_request", "unauthorized", "forbidden", "not_found", "conflict", "rate_limited", "server_error", "http_error", "request_cancelled", "transport_failed", "response_failed", "response_too_large", "invalid_response":
			code = request.Code
		}
		if request.StatusCode >= 100 && request.StatusCode <= 599 {
			status = request.StatusCode
		}
		if validNodeID(request.RequestID) {
			reference = request.RequestID
		}
	}
	var dns *net.DNSError
	var verify *tls.CertificateVerificationError
	var unknown x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		code = "timeout"
	case errors.Is(err, context.Canceled):
		code = "request_cancelled"
	case errors.As(err, &dns):
		code = "dns_failed"
	case errors.As(err, &verify), errors.As(err, &unknown), errors.As(err, &hostname), errors.As(err, &invalid):
		code = "tls_failed"
	case errors.Is(err, syscall.ECONNREFUSED):
		code = "connection_refused"
	case errors.Is(err, fs.ErrPermission):
		code = "permission_denied"
	case errors.Is(err, syscall.ENOSPC):
		code = "disk_full"
	}
	if local := localFailureCode(err); local != "" {
		code = local
	}

	return code, status, reference
}

func localFailureCode(err error) string {
	if err == nil {
		return ""
	}
	switch err.Error() {
	case "agent already enrolled; refusing to replace its identity":
		return "existing_identity"
	case "enroll this agent first":
		return "identity_unavailable"
	case "invalid device certificate", "invalid server CA", "invalid controller URL", "controller URL must be an origin":
		return "controller_setup_failed"
	case "local network operation failed":
		return "network_command_failed"
	case "invalid/stale desired revision", "invalid unchanged revision":
		return "invalid_desired_revision"
	case "invalid desired config", "unsupported desired config", "invalid network schema", "invalid WireGuard plan", "invalid LAN prefix":
		return "config_rejected"
	case "controller management route unavailable", "controller requires a direct management route", "controller management route uses WireGuard", "no validated controller management route", "management or underlay route unavailable":
		return "unsafe_management_route"
	case "management address safety check unavailable", "invalid management address cache":
		return "management_address_unavailable"
	case "network apply failed; previous plan restored":
		return "network_apply_rolled_back"
	case "network apply and rollback failed; local recovery required", "interrupted network apply recovery failed", "rollback persistence failed":
		return "network_recovery_required"
	case "routing requires local --enable-routing opt-in", "LAN interface is not locally authorized":
		return "routing_not_authorized"
	case "invalid local network journal", "invalid LAN ownership record", "invalid BGP ownership record":
		return "invalid_network_journal"
	case "LAN interface carries management or tunnel underlay", "owned LAN interface now carries management; manual recovery required":
		return "unsafe_management_interface"
	case "network plan overlaps controller management address", "LAN overlaps controller address":
		return "controller_prefix_overlap"
	}
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		for _, cause := range joined.Unwrap() {
			if code := localFailureCode(cause); code != "" {
				return code
			}
		}
	} else if cause := errors.Unwrap(err); cause != nil {
		return localFailureCode(cause)
	}
	return ""
}

func validNodeID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}

// Log the first outcome, changes, and at most one unchanged outcome per minute.
// There are only three scheduler operation names; no unbounded diagnostic queue.
func operationReporter(writer io.Writer, state *identity.State) func(string, error, time.Time) {
	type previous struct {
		key string
		at  time.Time
	}
	seen := map[string]previous{}
	return func(operation string, err error, retryAt time.Time) {
		now := time.Now().UTC()
		event := operationEvent{Time: now.Format(time.RFC3339), Operation: operation, Status: "ok", NodeID: state.NodeID, Revision: state.Revision}
		if err != nil {
			event.Status = "failed"
			event.Code, event.HTTPStatus, event.Reference = failureDetails(err)
			var request *controller.RequestError
			if errors.As(err, &request) {
				switch request.Operation {
				case "desired.read", "heartbeat.write", "config.acknowledge", "certificate.renew", "device-state.report", "wireguard.key-register", "wireguard.report", "device.enroll", "device.recover", "management.request":
					event.RequestOperation = request.Operation
				}
			}
			if !retryAt.IsZero() {
				event.RetryAt = retryAt.UTC().Format(time.RFC3339)
			}
		}
		key := event.Status + ":" + event.Code + ":" + strconv.Itoa(event.HTTPStatus)
		if operation == "desired" {
			key += ":" + strconv.Itoa(state.Revision)
		}
		prior, ok := seen[operation]
		if ok && prior.key == key && now.Sub(prior.at) < time.Minute {
			return
		}
		_ = json.NewEncoder(writer).Encode(event)
		seen[operation] = previous{key, now}
	}
}

func safeOrigin(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return "invalid"
	}
	return parsed.Scheme + "://" + parsed.Host
}

func localStatus(ctx context.Context, writer io.Writer, directory, expected string, check bool) error {
	state, err := identity.Load(directory)
	if err != nil {
		return errors.New("identity unavailable; inspect the state directory permissions and enrollment output")
	}
	status := "enrolled"
	if state.NodeID == "" {
		status = "enrollment_pending"
	}
	if expected != "" && state.NodeID != "" && !strings.EqualFold(state.NodeID, expected) {
		status = "identity_mismatch"
	}
	output := struct {
		CheckedAt              string `json:"checkedAt"`
		Status                 string `json:"status"`
		NodeID                 string `json:"nodeId"`
		Controller             string `json:"controller"`
		Revision               int    `json:"revision"`
		PendingAcknowledgement bool   `json:"pendingAcknowledgement"`
		CertificateExpiresAt   string `json:"certificateExpiresAt"`
		ControllerCheck        string `json:"controllerCheck"`
		HTTPStatus             int    `json:"httpStatus,omitempty"`
		Reference              string `json:"reference,omitempty"`
	}{CheckedAt: time.Now().UTC().Format(time.RFC3339), Status: status, NodeID: state.NodeID, Controller: safeOrigin(state.AgentURL), Revision: state.Revision, PendingAcknowledgement: state.PendingAcknowledgement, CertificateExpiresAt: state.ExpiresAt, ControllerCheck: "not_requested"}
	if state.AgentURL == "" {
		output.Controller = safeOrigin(state.Controller)
	}
	if check && status == "enrolled" {
		client, clientErr := controller.New(state.AgentURL, state.ServerCA, state.Certificate, state.Key, state.AllowLocal)
		if clientErr != nil {
			output.ControllerCheck = "client_setup_failed"
			err = errors.New("controller client setup failed")
		} else {
			defer client.HTTP.CloseIdleConnections()
			checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()
			err = client.Request(checkCtx, http.MethodGet, "/api/agent/v1/desired", nil, nil)
			if err != nil {
				output.ControllerCheck, output.HTTPStatus, output.Reference = failureDetails(err)
			} else {
				output.ControllerCheck = "reachable"
			}
		}
	}
	if writeErr := json.NewEncoder(writer).Encode(output); writeErr != nil {
		return writeErr
	}
	if status == "identity_mismatch" {
		return errors.New("existing identity belongs to another dashboard device; preserve its state and use operator recovery")
	}
	if err != nil {
		return errors.New("controller check failed; see controllerCheck and the service journal")
	}
	return nil
}
