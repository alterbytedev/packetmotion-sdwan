package controller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHTTPSAndRedirectBoundaries(t *testing.T) {
	for _, address := range []string{"http://remote.example", "https://user:secret@example.test", "https://example.test/path", "http://198.51.100.2"} {
		if err := ValidateURL(address, true); err == nil {
			t.Fatalf("accepted unsafe origin")
		}
	}
	if err := ValidateURL("http://192.168.1.1", false); err == nil {
		t.Fatal("accepted private HTTP origin without explicit opt-in")
	}
	for _, address := range []string{"http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "http://192.168.160.200:3000", "http://10.0.0.1:3000", "http://[fd00::1]:3000"} {
		if err := ValidateURL(address, true); err != nil {
			t.Fatalf("rejected approved development origin %q: %v", address, err)
		}
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"ok":true}`)) }))
	defer server.Close()
	client, err := New(server.URL, "", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if err = client.Request(context.Background(), "GET", "/", nil, nil); err == nil {
		t.Fatal("untrusted TLS server accepted")
	}
	client.HTTP = server.Client()
	if err = client.Request(context.Background(), "GET", "/", nil, nil); err != nil {
		t.Fatal(err)
	}
}

func TestRequestErrorsKeepOnlyValidatedSafeMetadata(t *testing.T) {
	for _, status := range []int{
		http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden,
		http.StatusConflict, http.StatusTooManyRequests, http.StatusServiceUnavailable,
	} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("X-Request-ID", "123e4567-e89b-42d3-a456-426614174000")
				w.Header().Set("Retry-After", "10")
				w.WriteHeader(status)
				_, _ = w.Write([]byte("token=BODY_SECRET_SENTINEL"))
			}))
			defer server.Close()
			client := &Client{URL: server.URL, HTTP: server.Client()}
			err := client.Request(context.Background(), http.MethodGet, "/api/agent/v1/desired?revision=4", nil, nil)
			var requestError *RequestError
			if !errors.As(err, &requestError) {
				t.Fatalf("expected typed request error, got %T: %v", err, err)
			}
			if requestError.Operation != "desired.read" || requestError.StatusCode != status || requestError.RequestID != "123e4567-e89b-42d3-a456-426614174000" || requestError.RetryAfter != 10*time.Second {
				t.Fatalf("unexpected safe metadata: %+v", requestError)
			}
			if strings.Contains(err.Error(), "BODY_SECRET_SENTINEL") || strings.Contains(err.Error(), server.URL) || strings.Contains(fmt.Sprint(requestError), "token") {
				t.Fatalf("request error leaked response or URL data: %v", err)
			}
		})
	}
}

func TestRequestErrorIgnoresInvalidMetadataAndCapsRetryHint(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		requestID  string
		retryAfter string
		wantID     string
		wantRetry  time.Duration
	}{
		{name: "malformed", requestID: "request-id-with-secret", retryAfter: "tomorrow"},
		{name: "oversized", requestID: strings.Repeat("a", 100), retryAfter: "999999999999999999999999"},
		{name: "capped", requestID: "123e4567-e89b-42d3-a456-426614174000", retryAfter: "120", wantID: "123e4567-e89b-42d3-a456-426614174000", wantRetry: maxRetryAfter},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("X-Request-ID", testCase.requestID)
				w.Header().Set("Retry-After", testCase.retryAfter)
				w.WriteHeader(http.StatusServiceUnavailable)
			}))
			defer server.Close()
			client := &Client{URL: server.URL, HTTP: server.Client()}
			err := client.Request(context.Background(), http.MethodPost, "/api/agent/v1/heartbeat", nil, nil)
			var requestError *RequestError
			if !errors.As(err, &requestError) || requestError.RequestID != testCase.wantID || requestError.RetryAfter != testCase.wantRetry || requestError.Code != "server_error" {
				t.Fatalf("invalid metadata was retained or cap failed: %+v err=%v", requestError, err)
			}
		})
	}
}

func TestRequestErrorPreservesCancellationWithoutLeakingTransportDetails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	client := &Client{URL: server.URL, HTTP: server.Client()}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := client.Request(ctx, http.MethodPost, "/api/agent/v1/heartbeat", nil, nil)
	var requestError *RequestError
	if !errors.As(err, &requestError) || !errors.Is(err, context.Canceled) || requestError.Code != "request_cancelled" {
		t.Fatalf("cancellation metadata not preserved: typed=%+v err=%v", requestError, err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("BODY_SECRET_SENTINEL") }
func (failingReader) Close() error             { return nil }

func TestResponseReadDecodeAndSizeErrorsAreSafe(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		status int
		body   io.ReadCloser
		output any
		code   string
	}{
		{name: "read failure", status: http.StatusOK, body: failingReader{}, code: "response_failed"},
		{name: "decode failure", status: http.StatusOK, body: io.NopCloser(strings.NewReader("not-json")), output: new(map[string]any), code: "invalid_response"},
		{name: "too large", status: http.StatusOK, body: io.NopCloser(strings.NewReader(strings.Repeat("x", maxResponseBytes+1))), code: "response_too_large"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			client := &Client{URL: "https://controller.test", HTTP: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: testCase.status, Header: make(http.Header), Body: testCase.body}, nil
			})}}
			err := client.Request(context.Background(), http.MethodGet, "/api/agent/v1/desired", nil, testCase.output)
			var requestError *RequestError
			if !errors.As(err, &requestError) || requestError.Code != testCase.code || strings.Contains(err.Error(), "BODY_SECRET_SENTINEL") {
				t.Fatalf("unsafe response error: %+v err=%v", requestError, err)
			}
		})
	}
}
