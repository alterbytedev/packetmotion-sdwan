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
	"net/url"
	"os"
	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
	"packetmotion/fabric-agent/internal/network"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const Version = "0.3.3"

type Enrolled struct {
	NodeID      string `json:"nodeId"`
	Kind        string `json:"kind"`
	Certificate string `json:"certificate"`
	CA          string `json:"ca"`
	ExpiresAt   string `json:"expiresAt"`
	AgentURL    string `json:"agentUrl"`
}
type Desired struct {
	Unchanged         bool               `json:"unchanged"`
	Revision          int                `json:"revision"`
	Payload           json.RawMessage    `json:"payload"`
	Checksum          string             `json:"checksum"`
	DiagnosticRequest *DiagnosticRequest `json:"diagnosticRequest,omitempty"`
}
type DiagnosticRequest struct {
	RequestID string `json:"requestId"`
}
type Config struct {
	Wireguard           *network.Plan `json:"wireguard,omitempty"`
	SchemaVersion       int           `json:"schemaVersion"`
	DeviceKind          string        `json:"deviceKind"`
	Mode                string        `json:"mode"`
	LANPrefix           *string       `json:"lanPrefix"`
	PollIntervalSeconds int           `json:"pollIntervalSeconds"`
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

func rebindPendingIdentity(previous identity.State, address, serverCA string, allowLocal bool) (identity.State, error) {
	if previous.NodeID != "" {
		return identity.State{}, errors.New("agent already enrolled; refusing to replace its identity")
	}
	previous.Controller = address
	previous.ServerCA = serverCA
	previous.AllowLocal = allowLocal
	return previous, nil
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
			// A key saved before a token exchange is not an enrolled identity. Keep
			// that key, but bind the pending attempt to the explicitly supplied
			// controller so a URL/port correction does not require deleting state.
			previous, err = rebindPendingIdentity(previous, address, serverCA, allowLocal)
			if err != nil {
				return state, err
			}
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

// Poll runs both management operations even when one fails.
func Poll(ctx context.Context, client *controller.Client, state *identity.State, directory string, snapshot Telemetry) (time.Duration, error) {
	interval, heartbeatErr, configErr := Cycle(ctx, client, state, directory, snapshot)
	return interval, errors.Join(heartbeatErr, configErr)
}

func Heartbeat(ctx context.Context, client *controller.Client, snapshot Telemetry) error {
	return client.Request(ctx, http.MethodPost, "/api/agent/v1/heartbeat", snapshot, nil)
}

func Cycle(ctx context.Context, client *controller.Client, state *identity.State, directory string, snapshot Telemetry) (time.Duration, error, error) {
	heartbeatErr := Heartbeat(ctx, client, snapshot)
	interval, configErr := Reconcile(ctx, client, state, directory)
	return interval, heartbeatErr, configErr
}

func CycleWait(ctx context.Context, client *controller.Client, state *identity.State, directory string, snapshot Telemetry, wait time.Duration) (time.Duration, error, error) {
	heartbeatErr := Heartbeat(ctx, client, snapshot)
	interval, configErr := ReconcileWait(ctx, client, state, directory, wait)
	return interval, heartbeatErr, configErr
}

func Reconcile(ctx context.Context, client *controller.Client, state *identity.State, directory string) (time.Duration, error) {
	return ReconcileWait(ctx, client, state, directory, 0)
}

// registerWireGuardKey needs only private state and the authenticated management
// channel. Publishing a public key never grants permission to apply networking.
func registerWireGuardKey(ctx context.Context, client *controller.Client, state *identity.State, directory string) error {
	_, publicKey, err := network.Key(directory)
	if err != nil {
		return err
	}
	if state.WireGuardPublicKey == publicKey {
		return nil
	}
	if err := client.Request(ctx, http.MethodPost, "/api/agent/v1/wireguard-key", map[string]string{"publicKey": publicKey}, nil); err != nil {
		return err
	}
	next := *state
	next.WireGuardPublicKey = publicKey
	if err := identity.Save(directory, next); err != nil {
		return err
	}
	*state = next
	return nil
}

func ReconcileWait(ctx context.Context, client *controller.Client, state *identity.State, directory string, wait time.Duration) (interval time.Duration, resultErr error) {
	registrationErr := registerWireGuardKey(ctx, client, state, directory)
	// Registration retries must not prevent desired-state staging or acknowledgement.
	defer func() { resultErr = errors.Join(resultErr, registrationErr) }()
	var desired Desired
	path := "/api/agent/v1/desired"
	var cached []byte
	if state.Revision > 0 || wait > 0 {
		cached, _ = os.ReadFile(filepath.Join(directory, "desired.json"))
		knownChecksum := ""
		if state.Revision > 0 {
			sum := sha256.Sum256(cached)
			if len(cached) > 0 && hex.EncodeToString(sum[:]) == state.Checksum {
				knownChecksum = state.Checksum
			} else {
				cached = nil
			}
		}
		query := url.Values{}
		query.Set("revision", fmt.Sprint(state.Revision))
		if knownChecksum != "" {
			query.Set("checksum", knownChecksum)
		}
		if wait > 0 {
			seconds := int(wait.Round(time.Second) / time.Second)
			if seconds < 1 {
				seconds = 1
			}
			if seconds > 25 {
				seconds = 25
			}
			query.Set("wait", fmt.Sprint(seconds))
		} else {
			query.Del("wait")
		}
		path += "?" + query.Encode()
	}
	if err := client.Request(ctx, http.MethodGet, path, nil, &desired); err != nil {
		return 0, err
	}
	// Diagnostic collection is independent of config parsing, staging, ack, and
	// optional local network apply. The report describes state at check-in time.
	diagnosticErr := reportDeviceState(ctx, client, state, directory, desired.DiagnosticRequest)
	if desired.Revision == 0 {
		return 30 * time.Second, diagnosticErr
	}
	if desired.Unchanged {
		if cached == nil || desired.Revision != state.Revision || desired.Checksum != state.Checksum {
			return 0, errors.Join(errors.New("invalid unchanged revision"), diagnosticErr)
		}
		desired.Payload = cached
	}
	sum := sha256.Sum256(desired.Payload)
	if desired.Revision < state.Revision || (desired.Revision == state.Revision && state.Checksum != "" && desired.Checksum != state.Checksum) || desired.Checksum != hex.EncodeToString(sum[:]) {
		return 0, errors.Join(errors.New("invalid/stale desired revision"), diagnosticErr)
	}
	var config Config
	decoder := json.NewDecoder(bytes.NewReader(desired.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		return rejectWithDiagnostic(ctx, client, desired, "invalid desired config", diagnosticErr)
	}
	if (config.SchemaVersion < 1 || config.SchemaVersion > 3) || config.DeviceKind != state.Kind || (config.Mode != "gateway" && config.Mode != "subnet-router") || config.PollIntervalSeconds < 10 || config.PollIntervalSeconds > 300 {
		return rejectWithDiagnostic(ctx, client, desired, "unsupported desired config", diagnosticErr)
	}
	if (config.SchemaVersion >= 2 && config.Wireguard == nil) || (config.SchemaVersion == 1 && config.Wireguard != nil) || (config.SchemaVersion == 3 && (config.Wireguard == nil || config.Wireguard.Routing == nil)) || (config.SchemaVersion == 2 && config.Wireguard != nil && config.Wireguard.Routing != nil) {
		return rejectWithDiagnostic(ctx, client, desired, "invalid network schema", diagnosticErr)
	}
	if config.Wireguard != nil {
		if err := network.Validate(*config.Wireguard); err != nil {
			return rejectWithDiagnostic(ctx, client, desired, "invalid WireGuard plan", diagnosticErr)
		}
	}
	if config.LANPrefix != nil {
		if _, network, err := net.ParseCIDR(*config.LANPrefix); err != nil || network.IP.To4() == nil {
			return rejectWithDiagnostic(ctx, client, desired, "invalid LAN prefix", diagnosticErr)
		}
	}
	// Receipt is durable staging; optional local network apply is reported separately.
	if cached == nil || desired.Revision != state.Revision || desired.Checksum != state.Checksum {
		if err := identity.WritePrivate(directory, "desired.json", desired.Payload); err != nil {
			return 0, errors.Join(err, diagnosticErr)
		}
		next := *state
		next.Revision, next.Checksum, next.PendingAcknowledgement = desired.Revision, desired.Checksum, true
		if err := identity.Save(directory, next); err != nil {
			return 0, errors.Join(err, diagnosticErr)
		}
		*state = next
	}
	if state.PendingAcknowledgement {
		if err := client.Request(ctx, http.MethodPost, "/api/agent/v1/ack", map[string]any{"revision": desired.Revision, "checksum": desired.Checksum, "status": "received"}, nil); err != nil {
			return 0, errors.Join(err, diagnosticErr)
		}
		next := *state
		next.PendingAcknowledgement = false
		if err := identity.Save(directory, next); err != nil {
			return 0, errors.Join(err, diagnosticErr)
		}
		*state = next
	}
	var wireguardErr error
	if config.Wireguard != nil {
		wireguardErr = reconcileWireguard(ctx, client, state, directory, *config.Wireguard)
	}
	return time.Duration(config.PollIntervalSeconds) * time.Second, errors.Join(wireguardErr, diagnosticErr)
}

func reportDeviceState(ctx context.Context, client *controller.Client, state *identity.State, directory string, request *DiagnosticRequest) error {
	if request == nil {
		return nil
	}
	if len(request.RequestID) != 36 || request.RequestID[8] != '-' || request.RequestID[13] != '-' || request.RequestID[18] != '-' || request.RequestID[23] != '-' {
		return errors.New("invalid device state request")
	}
	for _, char := range request.RequestID {
		if char != '-' && !strings.ContainsRune("0123456789abcdefABCDEF", char) {
			return errors.New("invalid device state request")
		}
	}
	status := "completed"
	reason := ""
	var report *network.DeviceState
	engine := network.Engine{Directory: directory, NodeID: state.NodeID,
		AllowRouting: state.RoutingEnabled, LANInterface: state.LANInterface}
	value, err := engine.DeviceState(ctx, state.Revision, state.WireGuardEnabled)
	if err != nil {
		status = "unavailable"
		reason = "collection_failed"
	} else {
		if value.AppliedPlan != nil {
			for i := range value.AppliedPlan.Tunnels {
				if value.AppliedPlan.Tunnels[i].AllowedPrefixes == nil {
					value.AppliedPlan.Tunnels[i].AllowedPrefixes = []string{}
				}
			}
		}
		report = &value
	}
	return client.Request(ctx, http.MethodPost, "/api/agent/v1/device-state", boundedDeviceStateResponse(request.RequestID, status, report, reason), nil)
}

func boundedDeviceStateResponse(requestID, status string, report *network.DeviceState, reasons ...string) map[string]any {
	response := map[string]any{"requestId": requestID, "status": status, "report": report}
	if len(reasons) > 0 && reasons[0] != "" {
		response["reason"] = reasons[0]
	}
	encoded, err := json.Marshal(response)
	if err != nil || len(encoded) > 32768 {
		return map[string]any{"requestId": requestID, "status": "unavailable", "reason": "collection_failed", "report": nil}
	}
	return response
}

func reject(ctx context.Context, client *controller.Client, desired Desired, reason string) (time.Duration, error) {
	err := client.Request(ctx, http.MethodPost, "/api/agent/v1/ack", map[string]any{"revision": desired.Revision, "checksum": desired.Checksum, "status": "rejected"}, nil)
	return 0, errors.Join(errors.New(reason), err)
}

func rejectWithDiagnostic(ctx context.Context, client *controller.Client, desired Desired, reason string, diagnosticErr error) (time.Duration, error) {
	interval, rejectErr := reject(ctx, client, desired, reason)
	return interval, errors.Join(rejectErr, diagnosticErr)
}

// Renew is independent of configuration and heartbeat success. Persist before switching clients.
func Renew(ctx context.Context, client *controller.Client, state *identity.State, directory string) (*controller.Client, error) {
	expires, err := time.Parse(time.RFC3339, state.ExpiresAt)
	if err != nil {
		return client, errors.New("invalid certificate expiry")
	}
	if time.Until(expires) >= 7*24*time.Hour {
		return client, nil
	}
	csr, err := identity.CSR(state.Key)
	if err != nil {
		return client, err
	}
	var renewed struct {
		Certificate string `json:"certificate"`
		CA          string `json:"ca"`
		ExpiresAt   string `json:"expiresAt"`
	}
	if err = client.Request(ctx, http.MethodPost, "/api/agent/v1/renew", map[string]string{"csr": csr}, &renewed); err != nil {
		return client, err
	}
	next := *state
	next.Certificate, next.CA, next.ExpiresAt = renewed.Certificate, renewed.CA, renewed.ExpiresAt
	if expiry, parseErr := time.Parse(time.RFC3339, next.ExpiresAt); parseErr != nil || !expiry.After(expires) {
		return client, errors.New("invalid renewed expiry")
	}
	replacement, err := controller.New(next.AgentURL, next.ServerCA, next.Certificate, next.Key, next.AllowLocal)
	if err != nil {
		return client, err
	}
	if err = identity.Save(directory, next); err != nil {
		replacement.HTTP.CloseIdleConnections()
		return client, err
	}
	client.HTTP.CloseIdleConnections()
	*state = next
	return replacement, nil
}

// A local opt-in gates NET_ADMIN use; controller configuration cannot enable it.
func reconcileWireguard(ctx context.Context, client *controller.Client, state *identity.State, directory string, plan network.Plan) error {
	status := "disabled"
	handshakes := []network.Handshake{}
	bgpPeers := []network.BGPPeerObservation{}
	var applyErr error
	if state.WireGuardEnabled {
		engine, err := NetworkEngine(ctx, state, directory, client.URL)
		if err != nil {
			return err
		}
		applyErr = engine.Apply(ctx, plan, func(checkCtx context.Context) error {
			client.HTTP.CloseIdleConnections()
			return client.Request(checkCtx, http.MethodGet, "/api/agent/v1/desired", nil, nil)
		})
		status = "failed"
		if applyErr == nil {
			handshakes, applyErr = engine.Handshakes(ctx, plan)
			if applyErr == nil {
				status = "applied"
				if plan.Routing != nil && plan.Routing.BGP != nil {
					bgpPeers, applyErr = engine.BGPPeers(ctx, plan)
					if applyErr != nil {
						bgpPeers = make([]network.BGPPeerObservation, 0, len(plan.Routing.BGP.Peers))
						for _, peer := range plan.Routing.BGP.Peers {
							bgpPeers = append(bgpPeers, network.BGPPeerObservation{Address: peer.Address, State: "Unavailable"})
						}
						applyErr = nil
					}
				}
			}
		}
	}
	if status != "applied" {
		handshakes = []network.Handshake{}
		bgpPeers = []network.BGPPeerObservation{}
	}
	reportErr := client.Request(ctx, http.MethodPost, "/api/agent/v1/wireguard-status", map[string]any{
		"revision": state.Revision, "checksum": state.Checksum, "status": status, "handshakes": handshakes, "bgpPeers": bgpPeers,
	}, nil)
	return errors.Join(applyErr, reportErr)
}

// NetworkEngine shares local authorization and controller safety inputs between
// startup recovery and reconciliation. Controller intent cannot enable routing.
func NetworkEngine(ctx context.Context, state *identity.State, directory, origin string) (network.Engine, error) {
	addresses, err := network.ManagementAddresses(ctx, directory, origin)
	if err != nil {
		return network.Engine{}, err
	}
	return network.Engine{Directory: directory, NodeID: state.NodeID,
		AllowRouting: state.RoutingEnabled, LANInterface: state.LANInterface,
		ManagementIPs: addresses}, nil
}
