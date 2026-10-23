package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"packetmotion/fabric-agent/internal/network"
)

func TestInterfaceOutboxNeverDropsUnacknowledgedResults(t *testing.T) {
	private := t.TempDir()
	shared := t.TempDir()
	os.Chmod(private, 0700)
	os.Chmod(shared, 0700)
	for index := 0; index < 50; index++ {
		if err := guardHistoryResult(private, shared, network.InterfaceResult{CommitID: fmt.Sprintf("123e4567-e89b-42d3-a456-%012d", index), Sequence: 3, Status: "rolled_back"}); err != nil {
			t.Fatal(err)
		}
	}
	latest := network.InterfaceResult{CommitID: "123e4567-e89b-42d3-a456-999999999999", Sequence: 1, Status: "rejected"}
	if err := guardHistoryResult(private, shared, latest); err == nil {
		t.Fatal("unacknowledged result overwritten")
	}
	var history guardHistory
	if err := network.ReadInterfaceFile(private, "history.json", &history); err != nil || len(history.Results) != 50 {
		t.Fatal("outbox altered on overflow")
	}
	ack := map[string]int{history.Results[0].CommitID: 3}
	if err := network.WriteInterfaceFile(shared, "interface-report-acks.json", ack); err != nil {
		t.Fatal(err)
	}
	if err := guardHistoryResult(private, shared, latest); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(shared, "interface-history.json"))
	if err != nil || info.Mode().Perm() != 0644 {
		t.Fatal("shared report unavailable to unprivileged agent")
	}
}
func TestInterfaceGuardUnitPreservesStatePathAndHasIndependentRecovery(t *testing.T) {
	unit, err := interfaceUnitFor("/usr/local/bin/fabric-agent", "/srv/private agent")
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"Type=notify", "WatchdogSec=10", "KillMode=control-group", `--state-dir "/srv/private agent"`, `ReadWritePaths="/srv/private agent"`} {
		if !strings.Contains(unit, text) {
			t.Fatalf("missing service boundary %s", text)
		}
	}
	if _, err = interfaceUnitFor("/usr/local/bin/fabric-agent", "/srv/bad\npath"); err == nil {
		t.Fatal("unit injection accepted")
	}
	stdout, _, err := runCLI("network", "enable-interfaces", "--help")
	if err != nil || !strings.Contains(stdout, "confirm-exclusive") {
		t.Fatal("local authorization help missing")
	}
}
