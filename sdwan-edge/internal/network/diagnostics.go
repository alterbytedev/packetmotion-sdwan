package network

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
)

type StateFile struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Present bool   `json:"present"`
}

type RuntimeInterface struct {
	Name          string   `json:"name"`
	Present       bool     `json:"present"`
	Up            bool     `json:"up"`
	Addresses     []string `json:"addresses"`
	LastHandshake *int64   `json:"lastHandshake"`
}

type DeviceState struct {
	StateDirectory           string             `json:"stateDirectory"`
	Revision                 int                `json:"revision"`
	WireGuardEnabled         bool               `json:"wireguardEnabled"`
	Files                    []StateFile        `json:"files"`
	AppliedPlan              *Plan              `json:"appliedPlan"`
	Interfaces               []RuntimeInterface `json:"interfaces"`
	UnplannedOwnedInterfaces []string           `json:"unplannedOwnedInterfaces"`
}

// DeviceState reads only the agent's known state files and PacketMotion-owned
// WireGuard interfaces. It never opens the private-key file or returns secrets.
func (e Engine) DeviceState(ctx context.Context, revision int, enabled bool) (DeviceState, error) {
	if e.Run == nil {
		e.Run = Command
	}
	directory, err := filepath.Abs(e.Directory)
	if err != nil {
		return DeviceState{}, errors.New("agent state location unavailable")
	}
	state := DeviceState{
		StateDirectory:   directory,
		Revision:         revision,
		WireGuardEnabled: enabled,
		Files: []StateFile{
			{Name: "Staged desired configuration", Path: filepath.Join(directory, "desired.json")},
			{Name: "Locally applied WireGuard plan", Path: filepath.Join(directory, "network-applied.json")},
			{Name: "Pending recovery journal", Path: filepath.Join(directory, "network-pending.json")},
			{Name: "WireGuard private key (never collected)", Path: filepath.Join(directory, "wireguard.key")},
		},
		Interfaces:               []RuntimeInterface{},
		UnplannedOwnedInterfaces: []string{},
	}
	for i := range state.Files {
		_, statErr := os.Lstat(state.Files[i].Path)
		state.Files[i].Present = statErr == nil
		if statErr != nil && !errors.Is(statErr, fs.ErrNotExist) {
			return DeviceState{}, errors.New("agent state location unavailable")
		}
	}
	if !enabled {
		return state, nil
	}
	if !state.Files[1].Present {
		return state, nil
	}
	plan, err := readPlan(directory, "network-applied.json")
	if err != nil {
		return DeviceState{}, errors.New("locally applied WireGuard plan unavailable")
	}
	state.AppliedPlan = &plan
	links, err := e.links(ctx)
	if err != nil {
		return DeviceState{}, err
	}
	addresses, err := e.addresses(ctx)
	if err != nil {
		return DeviceState{}, err
	}
	owned := map[string]link{}
	for _, item := range links {
		if e.owns(item) {
			owned[item.Name] = item
		}
	}
	planned := make(map[string]bool, len(plan.Tunnels))
	for _, tunnel := range plan.Tunnels {
		planned[tunnel.Name] = true
		item := RuntimeInterface{Name: tunnel.Name, Addresses: []string{}}
		if current, exists := owned[tunnel.Name]; exists {
			item.Present = true
			item.Up = slices.Contains(current.Flags, "UP")
			for _, addressLink := range addresses {
				if addressLink.Name != tunnel.Name {
					continue
				}
				for _, address := range addressLink.Addresses {
					item.Addresses = append(item.Addresses, address.Local+"/"+strconv.Itoa(address.Bits))
				}
			}
			handshakes, handshakeErr := e.Handshakes(ctx, Plan{Tunnels: []Tunnel{tunnel}})
			if handshakeErr != nil {
				return DeviceState{}, handshakeErr
			}
			if len(handshakes) == 1 {
				stamp := handshakes[0].LastHandshake
				item.LastHandshake = &stamp
			}
		}
		state.Interfaces = append(state.Interfaces, item)
	}
	for name := range owned {
		if !planned[name] {
			state.UnplannedOwnedInterfaces = append(state.UnplannedOwnedInterfaces, name)
		}
	}
	slices.Sort(state.UnplannedOwnedInterfaces)
	return state, nil
}
