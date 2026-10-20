package controller

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxResponseBytes = 64 * 1024
const maxRetryAfter = 60 * time.Second

type RequestError struct {
	Operation  string
	Code       string
	StatusCode int
	RequestID  string
	RetryAfter time.Duration
	Cause      error
}

func (e *RequestError) Error() string {
	switch e.Code {
	case "bad_request", "unauthorized", "forbidden", "not_found", "conflict", "rate_limited", "server_error", "http_error":
		return fmt.Sprintf("controller rejected request (HTTP %d)", e.StatusCode)
	case "request_cancelled":
		return "controller request cancelled"
	case "transport_failed":
		return "controller connection failed"
	case "response_failed":
		return "controller response failed"
	case "response_too_large":
		return "controller response too large"
	case "invalid_response":
		return "invalid controller response"
	default:
		return "controller request failed"
	}
}

func (e *RequestError) Unwrap() error { return e.Cause }

func operationFor(method, path string) string {
	path, _, _ = strings.Cut(path, "?")
	operations := map[string]string{
		"GET /api/agent/v1/desired":             "desired.read",
		"POST /api/agent/v1/heartbeat":          "heartbeat.write",
		"POST /api/agent/v1/ack":                "config.acknowledge",
		"POST /api/agent/v1/renew":              "certificate.renew",
		"POST /api/agent/v1/device-state":       "device-state.report",
		"POST /api/agent/v1/wireguard-key":      "wireguard.key-register",
		"POST /api/agent/v1/wireguard-status":   "wireguard.report",
		"POST /api/agent/v1/enroll":             "device.enroll",
		"POST /api/agent/v1/enrollment/recover": "device.recover",
	}
	if operation := operations[method+" "+path]; operation != "" {
		return operation
	}
	return "management.request"
}

func safeRequestID(value string) string {
	if len(value) != 36 {
		return ""
	}
	for i, char := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if char != '-' {
				return ""
			}
			continue
		}
		if !strings.ContainsRune("0123456789abcdefABCDEF", char) {
			return ""
		}
	}
	return value
}

func safeRetryAfter(value string, now time.Time) time.Duration {
	if seconds, err := strconv.ParseUint(value, 10, 64); err == nil {
		if seconds > uint64(maxRetryAfter/time.Second) {
			return maxRetryAfter
		}
		delay := time.Duration(seconds) * time.Second
		if delay > maxRetryAfter {
			return maxRetryAfter
		}
		return delay
	}
	if retryAt, err := http.ParseTime(value); err == nil && retryAt.After(now) {
		delay := retryAt.Sub(now)
		if delay > maxRetryAfter {
			return maxRetryAfter
		}
		return delay
	}
	return 0
}

func statusCodeName(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "bad_request"
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusConflict:
		return "conflict"
	case http.StatusTooManyRequests:
		return "rate_limited"
	default:
		if status >= 500 {
			return "server_error"
		}
		return "http_error"
	}
}

type Client struct {
	URL  string
	HTTP *http.Client
}

func ValidateURL(address string, allowLocal bool) error {
	parsed, err := url.Parse(address)
	if err != nil {
		return errors.New("invalid controller URL")
	}
	if parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return errors.New("controller URL must be an origin")
	}
	if parsed.Scheme == "https" {
		return nil
	}
	if allowLocal && parsed.Scheme == "http" && isAllowedInsecureHost(parsed.Hostname()) {
		return nil
	}
	return errors.New("HTTPS is required (HTTP requires --allow-insecure-local and a loopback or approved lab controller address)")
}

func isAllowedInsecureHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

func New(address, serverCA, cert, key string, allowLocal bool) (*Client, error) {
	if err := ValidateURL(address, allowLocal); err != nil {
		return nil, err
	}
	configuration := &tls.Config{MinVersion: tls.VersionTLS12}
	if serverCA != "" {
		roots, err := x509.SystemCertPool()
		if err != nil {
			roots = x509.NewCertPool()
		}
		if !roots.AppendCertsFromPEM([]byte(serverCA)) {
			return nil, errors.New("invalid server CA")
		}
		configuration.RootCAs = roots
	}
	if cert != "" {
		pair, err := tls.X509KeyPair([]byte(cert), []byte(key))
		if err != nil {
			return nil, errors.New("invalid device certificate")
		}
		configuration.Certificates = []tls.Certificate{pair}
	}
	transport := &http.Transport{
		TLSClientConfig:       configuration,
		MaxIdleConns:          2,
		MaxIdleConnsPerHost:   2,
		MaxConnsPerHost:       2,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}
	return &Client{
		URL: strings.TrimRight(address, "/"),
		HTTP: &http.Client{
			Timeout:   35 * time.Second,
			Transport: transport,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return errors.New("redirects are not permitted")
			},
		},
	}, nil
}

func (c *Client) Request(ctx context.Context, method, path string, input, output any) error {
	operation := operationFor(method, path)
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return &RequestError{Operation: operation, Code: "request_encoding_failed", Cause: errors.New("invalid request data")}
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.URL+path, body)
	if err != nil {
		return &RequestError{Operation: operation, Code: "request_encoding_failed", Cause: errors.New("invalid request")}
	}
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return &RequestError{Operation: operation, Code: "request_cancelled", Cause: ctx.Err()}
		}
		return &RequestError{Operation: operation, Code: "transport_failed"}
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return &RequestError{Operation: operation, Code: "response_failed"}
	}
	if len(data) > maxResponseBytes {
		return &RequestError{Operation: operation, Code: "response_too_large"}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &RequestError{
			Operation: operation, Code: statusCodeName(response.StatusCode), StatusCode: response.StatusCode,
			RequestID: safeRequestID(response.Header.Get("X-Request-ID")), RetryAfter: safeRetryAfter(response.Header.Get("Retry-After"), time.Now()),
		}
	}
	if output != nil {
		if err = json.Unmarshal(data, output); err != nil {
			return &RequestError{Operation: operation, Code: "invalid_response"}
		}
	}
	return nil
}
