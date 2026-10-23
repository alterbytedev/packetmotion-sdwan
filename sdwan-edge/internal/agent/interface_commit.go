package agent

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"packetmotion/fabric-agent/internal/controller"
	"packetmotion/fabric-agent/internal/identity"
	"packetmotion/fabric-agent/internal/network"
)

type interfaceHistory struct {
	Results []network.InterfaceResult `json:"results"`
}
type interfaceConfirmation struct {
	CommitID string `json:"commitId"`
	Checksum string `json:"checksum"`
	Nonce    string `json:"nonce"`
}

func reconcileInterfaceCommit(ctx context.Context, client *controller.Client, state *identity.State, directory string, request *network.InterfaceRequest) error {
	var acknowledgements map[string]int
	if err := network.ReadInterfaceFile(directory, "interface-report-acks.json", &acknowledgements); err != nil && !os.IsNotExist(err) {
		return err
	}
	if acknowledgements == nil {
		acknowledgements = map[string]int{}
	}
	var history interfaceHistory
	if err := network.ReadInterfaceFile(directory, "interface-history.json", &history); err != nil && !os.IsNotExist(err) {
		return err
	}
	if len(history.Results) > 50 {
		return errors.New("invalid interface history size")
	}
	var latest network.InterfaceResult
	if err := network.ReadInterfaceFile(directory, "interface-result.json", &latest); err == nil {
		if latest.CommitID != "" {
			history.Results = append(history.Results, latest)
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	for _, result := range history.Results {
		if acknowledgements[result.CommitID] >= result.Sequence {
			continue
		}
		if err := client.Request(ctx, http.MethodPost, "/api/agent/v1/interface-result", result, nil); err != nil {
			return err
		}
		acknowledgements[result.CommitID] = result.Sequence
		// Match the guard's bounded retained history; old acknowledged IDs are not
		// needed once neither current status nor retained history references them.
		if len(acknowledgements) > 100 {
			retained := map[string]int{}
			for _, item := range history.Results {
				if seq, ok := acknowledgements[item.CommitID]; ok {
					retained[item.CommitID] = seq
				}
			}
			acknowledgements = retained
		}
		if err := network.WriteInterfaceFile(directory, "interface-report-acks.json", acknowledgements); err != nil {
			return err
		}
	}
	if latest.Status == "awaiting_confirmation" && time.Now().Before(interfaceDeadline(latest.Deadline)) {
		// Force a new authenticated TCP/TLS round trip. A receipt acknowledgement or
		// cached connection alone cannot confirm a pending interface transaction.
		client.HTTP.CloseIdleConnections()
		input := interfaceConfirmation{CommitID: latest.CommitID, Checksum: latest.Checksum, Nonce: latest.Nonce}
		var confirmed interfaceConfirmation
		if err := client.Request(ctx, http.MethodPost, "/api/agent/v1/interface-confirm", input, &confirmed); err != nil {
			return err
		}
		if confirmed != input {
			return errors.New("interface confirmation mismatch")
		}
		if err := network.WriteInterfaceFile(directory, "interface-confirmation.json", confirmed); err != nil {
			return err
		}
	}
	if request != nil {
		c, err := request.Configuration()
		if err != nil || c.NodeID != state.NodeID {
			return errors.New("invalid interface request")
		}
		var capability network.InterfaceCapability
		if err = network.ReadInterfaceFile(directory, "interface-capability.json", &capability); err != nil || time.Since(interfaceDeadline(capability.UpdatedAt)) < -5*time.Second || time.Since(interfaceDeadline(capability.UpdatedAt)) > 15*time.Second || capability.NodeID != state.NodeID {
			return client.Request(ctx, http.MethodPost, "/api/agent/v1/interface-result", network.InterfaceResult{CommitID: request.CommitID, Checksum: request.Checksum, Status: "rejected", Reason: "local_activation_required", Sequence: 1, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}, nil)
		}
		var staged network.InterfaceRequest
		if network.ReadInterfaceFile(directory, "interface-request.json", &staged) == nil && staged.CommitID == request.CommitID && staged.Checksum == request.Checksum {
			if _, err := staged.Configuration(); err == nil {
				return nil
			}
		}
		if err = network.WriteInterfaceFile(directory, "interface-request.json", request); err != nil {
			return err
		}
	}
	return nil
}

func interfaceCommitInProgress(directory string) bool {
	var request network.InterfaceRequest
	if network.ReadInterfaceFile(directory, "interface-request.json", &request) != nil {
		return false
	}
	var result network.InterfaceResult
	if network.ReadInterfaceFile(directory, "interface-result.json", &result) == nil && result.CommitID == request.CommitID && result.Status != "applying" && result.Status != "awaiting_confirmation" {
		return false
	}
	info, err := os.Stat(filepath.Join(directory, "interface-request.json"))
	if err != nil || time.Since(info.ModTime()) > 75*time.Second {
		return false
	}
	var capability network.InterfaceCapability
	return network.ReadInterfaceFile(directory, "interface-capability.json", &capability) == nil && time.Since(interfaceDeadline(capability.UpdatedAt)) >= -5*time.Second && time.Since(interfaceDeadline(capability.UpdatedAt)) < 15*time.Second
}
func interfaceDeadline(value string) time.Time {
	stamp, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Unix(0, 0)
	}
	return stamp
}
