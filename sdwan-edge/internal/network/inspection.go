package network

import (
	"context"
	"encoding/json"
	"errors"
	"net/netip"
	"slices"
	"strconv"
	"strings"
)

// Inspection contains only selected network facts. It does not establish an
// interface's owner or grant permission to change any reported resource.
type Inspection struct {
	Interfaces []InspectedInterface `json:"interfaces"`
	Routes     []InspectedRoute     `json:"ipv4Routes"`
}
type InspectedInterface struct {
	Master      string   `json:"master,omitempty"`
	ParentName string `json:"parentName,omitempty"`
	Name        string   `json:"name"`
	Index       int      `json:"index"`
	ParentIndex int      `json:"parentIndex,omitempty"`
	Kind        string   `json:"kind"`
	VLANID      int      `json:"vlanId,omitempty"`
	Up          bool     `json:"up"`
	MTU         int      `json:"mtu"`
	Addresses   []string `json:"ipv4Addresses"`
}
type InspectedRoute struct {
	Destination string `json:"destination"`
	Device      string `json:"device,omitempty"`
	Gateway     string `json:"gateway,omitempty"`
	Protocol    string `json:"protocol,omitempty"`
	Table       string `json:"table,omitempty"`
}

// Inspect uses fixed read-only ip queries, never an apply or state-file path.
// Raw ip output (including interface aliases) is deliberately not returned.
func Inspect(ctx context.Context, run Runner) (Inspection, error) {
	if run == nil {
		run = Command
	}
	result := Inspection{Interfaces: []InspectedInterface{}, Routes: []InspectedRoute{}}
	data, err := run(ctx, "ip", []string{"-j", "-d", "address", "show"}, "")
	if err != nil {
		return result, errors.New("interface inspection unavailable")
	}
	var links []struct {
		Master      string   `json:"master"`
		Link string `json:"link"`
		Name        string   `json:"ifname"`
		Index       int      `json:"ifindex"`
		ParentIndex int      `json:"link_index"`
		LinkType    string   `json:"link_type"`
		Flags       []string `json:"flags"`
		MTU         int      `json:"mtu"`
		Info        struct {
			Kind string `json:"info_kind"`
			Data struct {
				ID int `json:"id"`
			} `json:"info_data"`
		} `json:"linkinfo"`
		Addresses []struct {
			Family string `json:"family"`
			Local  string `json:"local"`
			Bits   int    `json:"prefixlen"`
		} `json:"addr_info"`
	}
	if len(data) > 1024*1024 || json.Unmarshal(data, &links) != nil || links == nil || len(links) > 256 {
		return result, errors.New("invalid or oversized interface inspection")
	}
	for _, item := range links {
		if !inspectionName(item.Name) || item.Index <= 0 || item.ParentIndex < 0 || item.MTU < 0 || item.MTU > 1000000 || len(item.Addresses) > 256 {
			return Inspection{}, errors.New("invalid interface inspection")
		}
		kind := item.Info.Kind
		if kind == "" {
			kind = item.LinkType
		}
		if !inspectionName(kind) {
			kind = "unknown"
		}
		entry := InspectedInterface{Name: item.Name, Index: item.Index, ParentIndex: item.ParentIndex, Kind: kind, Up: slices.Contains(item.Flags, "UP"), MTU: item.MTU, Addresses: []string{}, Master: item.Master}
		if kind == "vlan" {
			if item.Info.Data.ID < 1 || item.Info.Data.ID > 4094 {
				return Inspection{}, errors.New("invalid VLAN inspection")
			}
			entry.VLANID = item.Info.Data.ID
			if inspectionName(item.Link){entry.ParentName=item.Link}
		}
		for _, address := range item.Addresses {
			if address.Family != "inet" {
				continue
			}
			ip, parseErr := netip.ParseAddr(address.Local)
			if parseErr != nil || !ip.Is4() || address.Bits < 0 || address.Bits > 32 {
				return Inspection{}, errors.New("invalid interface address inspection")
			}
			entry.Addresses = append(entry.Addresses, ip.String()+"/"+strconv.Itoa(address.Bits))
		}
		result.Interfaces = append(result.Interfaces, entry)
	}
	data, err = run(ctx, "ip", []string{"-j", "-4", "route", "show", "table", "all"}, "")
	if err != nil {
		return Inspection{}, errors.New("route inspection unavailable")
	}
	var routes []struct {
		Destination string          `json:"dst"`
		Device      string          `json:"dev"`
		Gateway     string          `json:"gateway"`
		Protocol    json.RawMessage `json:"protocol"`
		Table       json.RawMessage `json:"table"`
	}
	if len(data) > 1024*1024 || json.Unmarshal(data, &routes) != nil || routes == nil || len(routes) > 4096 {
		return Inspection{}, errors.New("invalid or oversized route inspection")
	}
	for _, route := range routes {
		if route.Destination != "default" {
			prefix, prefixErr := netip.ParsePrefix(route.Destination)
			ip, addrErr := netip.ParseAddr(route.Destination)
			if (prefixErr != nil || !prefix.Addr().Is4()) && (addrErr != nil || !ip.Is4()) {
				return Inspection{}, errors.New("invalid route destination inspection")
			}
		}
		if route.Device != "" && !inspectionName(route.Device) {
			return Inspection{}, errors.New("invalid route device inspection")
		}
		if route.Gateway != "" {
			ip, parseErr := netip.ParseAddr(route.Gateway)
			if parseErr != nil || !ip.Is4() {
				return Inspection{}, errors.New("invalid route gateway inspection")
			}
		}
		result.Routes = append(result.Routes, InspectedRoute{Destination: route.Destination, Device: route.Device, Gateway: route.Gateway, Protocol: inspectionLabel(route.Protocol), Table: inspectionLabel(route.Table)})
	}
	return result, nil
}

func inspectionName(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	for _, ch := range value {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || strings.ContainsRune("_.:-", ch)) {
			return false
		}
	}
	return true
}
func inspectionLabel(raw json.RawMessage) string {
	var label string
	if json.Unmarshal(raw, &label) == nil && inspectionName(label) {
		return label
	}
	var number int
	if json.Unmarshal(raw, &number) == nil && number >= 0 {
		return strconv.Itoa(number)
	}
	return "unknown"
}
