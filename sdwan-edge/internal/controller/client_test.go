package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPSAndRedirectBoundaries(t *testing.T) {
	for _, address := range []string{"http://remote.example", "https://user:secret@example.test", "https://example.test/path", "http://192.168.1.1"} {
		if err := ValidateURL(address, true); err == nil {
			t.Fatalf("accepted unsafe origin")
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
