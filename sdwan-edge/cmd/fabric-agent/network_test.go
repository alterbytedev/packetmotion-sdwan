package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestActivationPreservesServiceArguments(t *testing.T) {
	args := []string{"/custom/fabric-agent", "run", "--state-dir", "/srv/private agent", "--enable-routing", "--lan-interface=ens34"}
	p, err := parseServiceProcess("12", args, nil)
	if err != nil || p.directory != "/srv/private agent" || p.enabled {
		t.Fatalf("unexpected process: %+v %v", p, err)
	}
	if strings.Join(args, "|") != "/custom/fabric-agent|run|--state-dir|/srv/private agent|--enable-routing|--lan-interface=ens34" {
		t.Fatal("arguments mutated")
	}
	p, err = parseServiceProcess("12", args, []string{"SECRET=do-not-print", "FABRIC_WIREGUARD_ENABLED=1"})
	if err != nil || !p.enabled {
		t.Fatalf("environment opt-in ignored: %v", err)
	}
	for _, arg := range []string{"--enable-wireguard=false", "-enable-wireguard=0"} {
		if _, err = parseServiceProcess("12", append(args, arg), nil); err == nil {
			t.Fatal("explicit false would override local activation")
		}
	}
	if _, err = parseServiceProcess("12", []string{"agent", "enroll"}, nil); err == nil {
		t.Fatal("accepted non-service command")
	}
	if strings.Contains(networkOverride, "ExecStart") || strings.Contains(networkOverride, "enable-routing") {
		t.Fatal("activation changed arguments or routing")
	}
}

func TestActivationRollbackAndRetry(t *testing.T) {
	for _, exists := range []bool{false, true} {
		for _, failure := range []string{"daemon-reload", "restart", "is-active", ""} {
			t.Run(failure+map[bool]string{true: "-existing", false: "-new"}[exists], func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "fabric-agent.service.d", "90-packetmotion-wireguard.conf")
				previous := []byte("# previously reviewed local configuration\n")
				if exists {
					if err := writeOverride(path, previous); err != nil {
						t.Fatal(err)
					}
				}
				failed := false
				calls := []string{}
				command := func(ctx context.Context, args ...string) ([]byte, error) {
					calls = append(calls, args[0])
					if args[0] == failure && !failed {
						failed = true
						return nil, errors.New("sensitive subprocess output")
					}
					return nil, nil
				}
				err := activateService(context.Background(), path, command, nil)
				data, readErr := os.ReadFile(path)
				if failure != "" {
					if err == nil || strings.Contains(err.Error(), "sensitive") {
						t.Fatalf("unsafe failure: %v", err)
					}
					if exists && (readErr != nil || string(data) != string(previous)) {
						t.Fatal("previous override not restored")
					}
					if !exists && !os.IsNotExist(readErr) {
						t.Fatal("new override not removed")
					}
					if calls[len(calls)-1] != "restart" {
						t.Fatal("previous service not restarted")
					}
				} else {
					if err != nil || readErr != nil || string(data) != networkOverride {
						t.Fatalf("activation: %v %v", err, readErr)
					}
					if err = activateService(context.Background(), path, command, nil); err != nil {
						t.Fatal(err)
					}
				}
			})
		}
	}
}

func TestActivationRejectsUnsafeOverride(t *testing.T) {
	dir := t.TempDir()
	victim := filepath.Join(dir, "victim")
	os.WriteFile(victim, []byte("preserved"), 0600)
	path := filepath.Join(dir, "override.conf")
	if err := os.Symlink(victim, path); err != nil {
		t.Fatal(err)
	}
	called := false
	err := activateService(context.Background(), path, func(context.Context, ...string) ([]byte, error) { called = true; return nil, nil }, nil)
	data, _ := os.ReadFile(victim)
	if err == nil || called || string(data) != "preserved" {
		t.Fatal("unsafe override was followed")
	}
}

func TestActivationPostRestartFailureRestoresPreviousOverride(t *testing.T) {
	path := filepath.Join(t.TempDir(), "override.conf")
	previous := []byte("# prior config\n")
	if err := writeOverride(path, previous); err != nil {
		t.Fatal(err)
	}
	err := activateService(context.Background(), path, func(context.Context, ...string) ([]byte, error) { return nil, nil }, func(context.Context) error { return errors.New("management unavailable") })
	data, _ := os.ReadFile(path)
	if err == nil || string(data) != string(previous) {
		t.Fatal("post-start failure did not restore override")
	}
}

func TestLocalOptInEnvironmentIsExplicit(t *testing.T) {
	t.Setenv("FABRIC_WIREGUARD_ENABLED", "1")
	_, help, err := runCLI("run", "--help")
	if err != nil || !strings.Contains(help, "(default true)") {
		t.Fatal("local service opt-in was ignored")
	}
	t.Setenv("FABRIC_WIREGUARD_ENABLED", "0")
	_, help, err = runCLI("run", "--help")
	if err != nil || strings.Contains(help, "(default true)") {
		t.Fatal("default service unexpectedly enabled networking")
	}
}

func TestOverrideRecoveryKeepsPrivateContentsPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "override.conf")
	if err := writeOverride(path, []byte("# private previous override\n")); err != nil {
		t.Fatal(err)
	}
	err := activateService(context.Background(), path, func(context.Context, ...string) ([]byte, error) { return nil, errors.New("failure") }, nil)
	if err == nil {
		t.Fatal("failure hidden")
	}
	info, statErr := os.Stat(path)
	if statErr != nil || info.Mode().Perm() != 0600 {
		t.Fatal("override contents became publicly readable")
	}
}

func TestActivationSharesInstallerLock(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "private-runtime")
	first, err := lockNetworkService(directory)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := lockNetworkService(directory); err == nil {
		second.Close()
		t.Fatal("concurrent installer/activation accepted")
	}
	first.Close()
	next, err := lockNetworkService(directory)
	if err != nil {
		t.Fatal("lock not released", err)
	}
	next.Close()
}

func TestNetworkInspectionHelpAndArgumentBoundary(t *testing.T) {
	stdout, stderr, err := runCLI("network", "--help")
	if err != nil || stderr != "" || !strings.Contains(stdout, "network inspect") {
		t.Fatal("inspection not discoverable")
	}
	for _, args := range [][]string{{"network", "inspect", "--enable"}, {"network", "inspect", "ens33"}} {
		stdout, _, err = runCLI(args...)
		if err == nil || stdout != "" {
			t.Fatal("inspection accepted extra arguments")
		}
	}
}
