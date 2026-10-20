package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"packetmotion/fabric-agent/internal/identity"
)

func TestResetCLIRejectsUnconfirmedOrMismatchedIdentityBeforeNetworking(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("root validation path")
	}
	directory := filepath.Join(t.TempDir(), "old")
	other := filepath.Join(t.TempDir(), "new")
	if err := identity.Save(directory, identity.State{NodeID: diagnosticNode, Key: "private-key-sentinel"}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(directory, "identity.json"))
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	for _, test := range []struct{ management, expected string }{{other, ""}, {directory, diagnosticNode}, {other, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}, {other, diagnosticNode}} {
		if err := resetNetwork(context.Background(), &output, directory, test.management, test.expected); err == nil {
			t.Fatal("unsafe reset accepted")
		}
	}
	after, err := os.ReadFile(filepath.Join(directory, "identity.json"))
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("rejected reset changed identity")
	}
	if output.Len() != 0 {
		t.Fatal("rejected reset emitted private state")
	}
}
