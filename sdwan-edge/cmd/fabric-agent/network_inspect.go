package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"packetmotion/fabric-agent/internal/network"
)

type inspectedService struct {
	Unit   string `json:"unit"`
	Load   string `json:"loadState"`
	Active string `json:"activeState"`
}
type inspectedPath struct {
	Path  string `json:"path"`
	State string `json:"state"`
}

type inspectionOutput struct{ bytes.Buffer }

func (b *inspectionOutput) Write(data []byte) (int, error) {
	if b.Len()+len(data) > 1024 {
		return 0, errors.New("service inspection response too large")
	}
	return b.Buffer.Write(data)
}

// No identity load, network activation, state writes, service changes or remote
// calls. Unit properties and path presence are evidence, not ownership inference.
func inspectHostNetwork(ctx context.Context, writer io.Writer) error {
	snapshot, err := network.Inspect(ctx, nil)
	if err != nil {
		return err
	}
	report := struct {
		CapturedAt      string             `json:"capturedAt"`
		Network         network.Inspection `json:"network"`
		Services        []inspectedService `json:"services"`
		ConfigPaths     []inspectedPath    `json:"configPaths"`
		Ownership       string             `json:"ownership"`
		ActivationReady bool               `json:"activationReady"`
	}{CapturedAt: time.Now().UTC().Format(time.RFC3339), Network: snapshot, Services: []inspectedService{}, ConfigPaths: []inspectedPath{}, Ownership: "unverified: confirm per-interface owner, management path, switch mapping and console recovery locally"}
	for _, unit := range []string{"networking.service", "systemd-networkd.service", "NetworkManager.service", "packetmotion-dhcp.service", "frr.service", "systemd-resolved.service", "fabric-agent.service"} {
		report.Services = append(report.Services, inspectNetworkService(ctx, unit))
	}
	for _, path := range []string{"/etc/network/interfaces", "/etc/network/interfaces.d", "/etc/systemd/network", "/etc/NetworkManager/system-connections", "/etc/netplan", "/usr/local/sbin/packetmotion-dhcp", "/etc/frr/frr.conf", "/etc/resolv.conf"} {
		state := "present"
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			state = "absent"
		} else if err != nil {
			state = "unavailable"
		}
		report.ConfigPaths = append(report.ConfigPaths, inspectedPath{Path: path, State: state})
	}
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}

func inspectNetworkService(ctx context.Context, unit string) inspectedService {
	result := inspectedService{Unit: unit, Load: "unknown", Active: "unknown"}
	callCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	// Output is a fixed pair of systemd enum properties; stderr is discarded.
	command := exec.CommandContext(callCtx, "/usr/bin/systemctl", "show", "--property=LoadState", "--property=ActiveState", unit)
	var output inspectionOutput
	command.Stdout = &output
	if command.Run() != nil {
		return result
	}
	for _, line := range strings.Split(output.String(), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch key {
		case "LoadState":
			switch value {
			case "loaded", "not-found", "masked", "error", "bad-setting", "merged", "stub":
				result.Load = value
			}
		case "ActiveState":
			switch value {
			case "active", "inactive", "failed", "activating", "deactivating", "reloading", "maintenance", "refreshing":
				result.Active = value
			}
		}
	}
	return result
}
