package agent

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
	"runtime"
	"time"
)

const Version = "0.1.0"

type Enrolled struct {
	NodeID      string `json:"nodeId"`
	Kind        string `json:"kind"`
	Certificate string `json:"certificate"`
	CA          string `json:"ca"`
	ExpiresAt   string `json:"expiresAt"`
	AgentURL    string `json:"agentUrl"`
}
type Desired struct {
	Revision int             `json:"revision"`
	Payload  json.RawMessage `json:"payload"`
	Checksum string          `json:"checksum"`
}
type Config struct {
	SchemaVersion       int     `json:"schemaVersion"`
	DeviceKind          string  `json:"deviceKind"`
	Mode                string  `json:"mode"`
	LANPrefix           *string `json:"lanPrefix"`
	PollIntervalSeconds int     `json:"pollIntervalSeconds"`
}
type Interface struct {
	Name string `json:"name"`
	Up   bool   `json:"up"`
	MTU  int    `json:"mtu"`
}
type Telemetry struct {
	EventID       string      `json:"eventId"`
	AgentVersion  string      `json:"agentVersion"`
	OS            string      `json:"os"`
	Arch          string      `json:"arch"`
	UptimeSeconds int64       `json:"uptimeSeconds"`
	Interfaces    []Interface `json:"interfaces"`
}

func Enroll(ctx context.Context, address, serverCA, token, directory string, allowLocal bool) (identity.State, error) {
	state := identity.State{Controller: address, ServerCA: serverCA, AllowLocal: allowLocal}
	if err := controller.ValidateURL(address, allowLocal); err != nil {
		return state, err
	}
	if previous, err := identity.Load(directory); err == nil {
		if previous.NodeID != "" {
			return state, errors.New("agent already enrolled; refusing to replace its identity")
		}
		if previous.Controller != address {
			return state, errors.New("pending identity belongs to a different controller")
		}
		state = previous
	} else if !errors.Is(err, fs.ErrNotExist) {
		return state, errors.New("existing identity cannot be read safely; refusing to replace it")
	}
	key := state.Key
	var err error
	if key == "" {
		key, err = identity.CreateKey()
	}
	if err != nil {
		return state, err
	}
	state.Key = key
	// Save the key before enrollment so a response loss does not destroy its identity.
	if err = identity.Save(directory, state); err != nil {
		return state, err
	}
	client, err := controller.New(address, serverCA, "", "", allowLocal)
	if err != nil {
		return state, err
	}
	csr, err := identity.CSR(key)
	if err != nil {
		return state, err
	}
	var reply Enrolled
	if err = client.Request(ctx, http.MethodPost, "/api/agent/v1/enroll", map[string]string{"token": token, "csr": csr}, &reply); err != nil {
		return state, err
	}
	if reply.NodeID == "" || (reply.Kind != "branch" && reply.Kind != "hub") {
		return state, errors.New("invalid enrollment identity")
	}
	state.NodeID = reply.NodeID
	state.Kind = reply.Kind
	state.Certificate = reply.Certificate
	state.CA = reply.CA
	state.ExpiresAt = reply.ExpiresAt
	state.AgentURL = reply.AgentURL
	if state.AgentURL == "" {
		state.AgentURL = address
	}
	if _, err = controller.New(state.AgentURL, serverCA, state.Certificate, state.Key, allowLocal); err != nil {
		return state, err
	}
	return state, identity.Save(directory, state)
}
func Snapshot(start time.Time) Telemetry {
	var id [16]byte
	_, _ = rand.Read(id[:])
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	snapshot := Telemetry{EventID: fmt.Sprintf("%x-%x-%x-%x-%x", id[0:4], id[4:6], id[6:8], id[8:10], id[10:16]), AgentVersion: Version, OS: runtime.GOOS, Arch: runtime.GOARCH, UptimeSeconds: int64(time.Since(start).Seconds()), Interfaces: []Interface{}}
	interfaces, err := net.Interfaces()
	if err == nil {
		for _, entry := range interfaces {
			snapshot.Interfaces = append(snapshot.Interfaces, Interface{Name: entry.Name, Up: entry.Flags&net.FlagUp != 0, MTU: entry.MTU})
			if len(snapshot.Interfaces) == 64 {
				break
			}
		}
	}
	return snapshot
}
func Poll(ctx context.Context, client *controller.Client, state *identity.State, directory string, snapshot Telemetry) (time.Duration, error) {
	if err := client.Request(ctx, http.MethodPost, "/api/agent/v1/heartbeat", snapshot, nil); err != nil {
		return 0, err
	}
	var desired Desired
	if err := client.Request(ctx, http.MethodGet, "/api/agent/v1/desired", nil, &desired); err != nil {
		return 0, err
	}
	if desired.Revision == 0 {
		return 30 * time.Second, nil
	}
	sum := sha256.Sum256(desired.Payload)
	if desired.Revision < state.Revision || (desired.Revision == state.Revision && state.Checksum != "" && desired.Checksum != state.Checksum) || desired.Checksum != hex.EncodeToString(sum[:]) {
		return 0, errors.New("invalid/stale desired revision")
	}
	var config Config
	decoder := json.NewDecoder(bytes.NewReader(desired.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		return 0, errors.New("invalid desired config")
	}
	if config.SchemaVersion != 1 || config.DeviceKind != state.Kind || (config.Mode != "gateway" && config.Mode != "subnet-router") || config.PollIntervalSeconds < 10 || config.PollIntervalSeconds > 300 {
		return 0, errors.New("unsupported desired config")
	}
	if config.LANPrefix != nil {
		if _, network, err := net.ParseCIDR(*config.LANPrefix); err != nil || network.IP.To4() == nil {
			return 0, errors.New("invalid LAN prefix")
		}
	}
	// Management MVP stages durable configuration only; it does not apply networking.
	if err := identity.WritePrivate(directory, "desired.json", desired.Payload); err != nil {
		return 0, err
	}
	state.Revision = desired.Revision
	state.Checksum = desired.Checksum
	if err := identity.Save(directory, *state); err != nil {
		return 0, err
	}
	if err := client.Request(ctx, http.MethodPost, "/api/agent/v1/ack", map[string]any{"revision": desired.Revision, "checksum": desired.Checksum, "status": "received"}, nil); err != nil {
		return 0, err
	}
	return time.Duration(config.PollIntervalSeconds) * time.Second, nil
}
