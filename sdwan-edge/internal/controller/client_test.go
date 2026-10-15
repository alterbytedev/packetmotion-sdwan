package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
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
