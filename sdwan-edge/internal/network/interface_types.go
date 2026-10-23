package network

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/netip"
	"regexp"
)

// InterfaceRequest is a revisioned typed operation delivered through mTLS. The
// guard additionally enforces its root-owned local authorization policy.
type InterfaceRequest struct {
	CommitID string          `json:"commitId"`
	Checksum string          `json:"checksum"`
	Payload  json.RawMessage `json:"payload"`
}
type InterfaceConfiguration struct {
	SchemaVersion     int                `json:"schemaVersion"`
	NodeID            string             `json:"nodeId"`
	InterfaceName     string             `json:"interfaceName"`
	Kind              string             `json:"kind"`
	SafeCommitSeconds int                `json:"safeCommitSeconds"`
	Interfaces        []InterfaceSetting `json:"interfaces"`
}
type InterfaceSetting struct {
	InterfaceName    string  `json:"interfaceName"`
	VLANID           *int    `json:"vlanId"`
	Role             string  `json:"role"`
	Mode             string  `json:"mode"`
	Address          *string `json:"address"`
	Gateway          *string `json:"gateway"`
	AdvertisedPrefix *string `json:"advertisedPrefix"`
	Enabled          bool    `json:"enabled"`
	MTU              int     `json:"mtu"`
}
type InterfaceResult struct {
	Operation string `json:"operation"`
	Sequence  int    `json:"sequence"`
	CommitID  string `json:"commitId"`
	Checksum  string `json:"checksum"`
	Status    string `json:"status"`
	Reason    string `json:"reason"`
	Nonce     string `json:"nonce"`
	Deadline  string `json:"deadline"`
	UpdatedAt string `json:"updatedAt"`
}

func NewInterfaceRequest(id string, c InterfaceConfiguration) (InterfaceRequest, error) {
	data, err := json.Marshal(c)
	if err != nil {
		return InterfaceRequest{}, err
	}
	sum := sha256.Sum256(data)
	r := InterfaceRequest{CommitID: id, Checksum: hex.EncodeToString(sum[:]), Payload: data}
	_, err = r.Configuration()
	return r, err
}
func InterfaceReason(err error) string {
	if err == nil {
		return ""
	}
	switch err.Error() {
	case "local_authorization_denied", "inventory_unavailable", "management_route_unavailable", "management_interface_protected", "physical_parent_required", "foreign_interface_address", "foreign_vlan_interface", "interface_subnet_overlap", "interface_route_overlap":
		return err.Error()
	}
	return "validation_failed"
}

type InterfaceAuthorization struct {
	AllowVirtualLab bool     `json:"allowVirtualLab,omitempty"`
	NodeID          string   `json:"nodeId"`
	Interfaces      []string `json:"interfaces"`
	ControllerIPs   []string `json:"controllerIps"`
}
type InterfaceCapability struct {
	NodeID          string   `json:"nodeId"`
	ProtocolVersion int      `json:"protocolVersion"`
	Mode            string   `json:"mode"`
	Interfaces      []string `json:"interfaces"`
	UpdatedAt       string   `json:"updatedAt"`
}

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)
var physicalPattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_.-]{0,14}$`)

func (r InterfaceRequest) Configuration() (InterfaceConfiguration, error) {
	var c InterfaceConfiguration
	sum := sha256.Sum256(r.Payload)
	if !uuidPattern.MatchString(r.CommitID) || len(r.Payload) > 8192 || hex.EncodeToString(sum[:]) != r.Checksum {
		return c, errors.New("invalid interface commit checksum")
	}
	if err := decodeInterfaceJSON(r.Payload, &c); err != nil {
		return c, err
	}
	if c.SchemaVersion != 1 || !uuidPattern.MatchString(c.NodeID) || !physicalPattern.MatchString(c.InterfaceName) || c.InterfaceName == "lo" || len(c.InterfaceName) >= 2 && c.InterfaceName[:2] == "pm" || c.SafeCommitSeconds != 60 || (c.Kind != "physical" && c.Kind != "vlan") || len(c.Interfaces) > 16 {
		return c, errors.New("invalid interface commit")
	}
	tags := map[int]bool{}
	for _, s := range c.Interfaces {
		if s.InterfaceName != c.InterfaceName || s.Role != "lan" || s.Mode != "static" || s.Gateway != nil || s.AdvertisedPrefix != nil || s.MTU < 576 || s.MTU > 9000 || s.Address == nil {
			return c, errors.New("interface apply supports dedicated static LAN settings without advertisement only")
		}
		p, err := netip.ParsePrefix(*s.Address)
		if err != nil || !p.Addr().Is4() || !p.Addr().IsPrivate() || p.Bits() < 8 || p.Bits() > 30 || p.Addr() == p.Masked().Addr() {
			return c, errors.New("invalid static interface address")
		}
		last := p.Masked().Addr().As4()
		n := uint32(last[0])<<24 | uint32(last[1])<<16 | uint32(last[2])<<8 | uint32(last[3])
		n |= (1 << uint(32-p.Bits())) - 1
		host := p.Addr().As4()
		if uint32(host[0])<<24|uint32(host[1])<<16|uint32(host[2])<<8|uint32(host[3]) == n {
			return c, errors.New("broadcast interface address")
		}
		tag := 0
		if s.VLANID != nil {
			tag = *s.VLANID
		}
		if (c.Kind == "physical" && tag != 0) || (c.Kind == "vlan" && (tag < 1 || tag > 4094)) || tags[tag] {
			return c, errors.New("invalid interface VLAN scope")
		}
		tags[tag] = true
	}
	if c.Kind == "physical" && len(c.Interfaces) > 1 {
		return c, errors.New("invalid physical interface scope")
	}
	return c, nil
}
func interfaceNameFor(s InterfaceSetting) string {
	if s.VLANID == nil {
		return s.InterfaceName
	}
	sum := sha256.Sum256([]byte(s.InterfaceName + ":" + jsonNumber(*s.VLANID)))
	return "pmv" + hex.EncodeToString(sum[:])[:12]
}

// Failures identify a typed operation, never arbitrary command text or stderr.
type InterfaceOperationError struct{ Step string }

func (e *InterfaceOperationError) Error() string { return "interface operation failed: " + e.Step }
func interfaceOperationStep(name string, args []string) string {
	if name == "nft" {
		return "isolate_forwarding"
	}
	if len(args) < 2 {
		return "inspect_state"
	}
	if args[0] == "address" {
		if args[1] == "del" {
			return "remove_address"
		}
		return "assign_address"
	}
	if args[0] == "link" {
		switch args[1] {
		case "add":
			return "create_vlan"
		case "delete":
			return "delete_vlan"
		case "set":
			for _, arg := range args {
				if arg == "mtu" {
					return "set_mtu"
				}
			}
			return "set_link_state"
		}
	}
	return "inspect_state"
}
