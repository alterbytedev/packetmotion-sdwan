package network

import (
	"context"
	"encoding/json"
	"errors"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"packetmotion/fabric-agent/internal/identity"
)

// Routing is a typed bundle. Later milestones add only validated BGP peers and
// permissions; arbitrary CLI/configuration text is never accepted from a server.
type Routing struct {
	BGP               *BGP     `json:"bgp,omitempty"`
	LAN               LAN      `json:"lan"`
	ProtectedPrefixes []string `json:"protectedPrefixes"`
}
type LAN struct {
	InterfaceName    string `json:"interfaceName"`
	Address          string `json:"address"`
	AdvertisedPrefix string `json:"advertisedPrefix"`
}
type lanOriginal struct {
	InterfaceName  string   `json:"interfaceName"`
	WasUp          bool     `json:"wasUp"`
	OwnedAddresses []string `json:"ownedAddresses"`
}
type addressLink struct {
	Name      string   `json:"ifname"`
	LinkType  string   `json:"link_type"`
	Flags     []string `json:"flags"`
	Addresses []struct {
		Family string `json:"family"`
		Local  string `json:"local"`
		Bits   int    `json:"prefixlen"`
	} `json:"addr_info"`
}

var lanName = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_.-]{0,14}$`)

func validLANName(name string) bool {
	return lanName.MatchString(name) && name != "lo" && !strings.HasPrefix(name, "pm")
}
func validateRouting(r Routing) error {
	prefix, err := netip.ParsePrefix(r.LAN.Address)
	advertised, advertisedErr := netip.ParsePrefix(r.LAN.AdvertisedPrefix)
	if !validLANName(r.LAN.InterfaceName) || err != nil || !prefix.Addr().Is4() || !prefix.Addr().IsPrivate() || prefix.Bits() < 8 || prefix.Bits() > 30 || advertisedErr != nil || advertised != prefix.Masked() || prefix.Addr() == prefix.Masked().Addr() {
		return errors.New("invalid LAN profile")
	}
	// The last address may end in any octet for subnets smaller than /24.
	if !prefix.Contains(prefix.Addr().Next()) {
		return errors.New("LAN address is broadcast")
	}
	if len(r.ProtectedPrefixes) < 1 || len(r.ProtectedPrefixes) > 32 {
		return errors.New("protected networks required")
	}
	for _, value := range r.ProtectedPrefixes {
		protected, err := netip.ParsePrefix(value)
		if err != nil || !protected.Addr().Is4() || protected != protected.Masked() || protected.Bits() == 0 || protected.Overlaps(advertised) {
			return errors.New("invalid or overlapping protected network")
		}
	}
	return nil
}
func (e Engine) addresses(ctx context.Context) ([]addressLink, error) {
	data, err := e.Run(ctx, "ip", []string{"-j", "address", "show"}, "")
	if err != nil {
		return nil, err
	}
	var result []addressLink
	if json.Unmarshal(data, &result) != nil {
		return nil, errors.New("invalid address inventory")
	}
	return result, nil
}
func (e Engine) originalLANs() ([]lanOriginal, error) {
	files, err := filepath.Glob(filepath.Join(e.Directory, "lan-original-*.json"))
	if err != nil {
		return nil, err
	}
	result := []lanOriginal{}
	for _, path := range files {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var record lanOriginal
		if json.Unmarshal(data, &record) != nil || !validLANName(record.InterfaceName) || filepath.Base(path) != "lan-original-"+record.InterfaceName+".json" || len(record.OwnedAddresses) > 2 {
			return nil, errors.New("invalid LAN ownership record")
		}
		for _, address := range record.OwnedAddresses {
			p, err := netip.ParsePrefix(address)
			if err != nil || !p.Addr().Is4() {
				return nil, errors.New("invalid owned LAN address")
			}
		}
		result = append(result, record)
	}
	return result, nil
}
func (e Engine) writeOriginal(record lanOriginal) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return identity.WritePrivate(e.Directory, "lan-original-"+record.InterfaceName+".json", data)
}
func ipv4Addresses(link addressLink) []string {
	result := []string{}
	for _, addr := range link.Addresses {
		if addr.Family == "inet" {
			ip, err := netip.ParseAddr(addr.Local)
			if err == nil {
				result = append(result, netip.PrefixFrom(ip, addr.Bits).String())
			}
		}
	}
	return result
}
func (e Engine) protectedInterfaces(ctx context.Context, plan Plan) (map[string]bool, error) {
	targets := append([]string{}, e.ManagementIPs...)
	for _, tunnel := range plan.Tunnels {
		if tunnel.Endpoint != nil {
			endpoint, _ := netip.ParseAddrPort(*tunnel.Endpoint)
			targets = append(targets, endpoint.Addr().String())
		}
	}
	protected := map[string]bool{}
	managementFound := false
	for index, target := range targets {
		addr, err := netip.ParseAddr(target)
		if err != nil {
			return nil, errors.New("invalid local management address")
		}
		data, err := e.Run(ctx, "ip", []string{"-j", "route", "get", addr.String()}, "")
		if err != nil {
			return nil, errors.New("management or underlay route unavailable")
		}
		var routes []struct {
			Device string `json:"dev"`
		}
		if json.Unmarshal(data, &routes) != nil {
			return nil, errors.New("invalid management route inventory")
		}
		for _, route := range routes {
			if route.Device != "" {
				protected[route.Device] = true
				if index < len(e.ManagementIPs) {
					managementFound = true
				}
			}
		}
	}
	if !managementFound {
		return nil, errors.New("no validated controller management route")
	}
	return protected, nil
}
func (e Engine) preflightLAN(ctx context.Context, plan Plan) error {
	originals, err := e.originalLANs()
	if err != nil {
		return err
	}
	if plan.Routing == nil && len(originals) == 0 {
		return nil
	}
	if !e.AllowRouting {
		return errors.New("routing requires local --enable-routing opt-in")
	}
	protected, err := e.protectedInterfaces(ctx, plan)
	if err != nil {
		return err
	}
	for _, record := range originals {
		if protected[record.InterfaceName] {
			return errors.New("owned LAN interface now carries management; manual recovery required")
		}
	}
	if plan.Routing == nil {
		return nil
	}
	lan := plan.Routing.LAN
	if e.LANInterface != lan.InterfaceName || !validLANName(e.LANInterface) {
		return errors.New("LAN interface is not locally authorized")
	}
	if protected[lan.InterfaceName] {
		return errors.New("LAN interface carries management or tunnel underlay")
	}
	inventory, err := e.addresses(ctx)
	if err != nil {
		return err
	}
	index := slices.IndexFunc(inventory, func(link addressLink) bool { return link.Name == lan.InterfaceName })
	if index < 0 {
		return errors.New("LAN interface not found")
	}
	if inventory[index].LinkType != "ether" {
		return errors.New("LAN must be an explicitly authorized Ethernet interface")
	}
	owned := []string{}
	for _, record := range originals {
		if record.InterfaceName == lan.InterfaceName {
			owned = record.OwnedAddresses
		}
	}
	for _, address := range ipv4Addresses(inventory[index]) {
		if !slices.Contains(owned, address) {
			return errors.New("LAN interface already has an unmanaged IPv4 address")
		}
	}
	data, err := e.Run(ctx, "ip", []string{"-j", "route", "show", "table", "all"}, "")
	if err != nil {
		return err
	}
	var routes []struct {
		Destination string `json:"dst"`
		Device      string `json:"dev"`
		Type        string `json:"type"`
	}
	if json.Unmarshal(data, &routes) != nil {
		return errors.New("invalid LAN route inventory")
	}
	target, _ := netip.ParsePrefix(lan.AdvertisedPrefix)
	for _, route := range routes {
		prefix, parseErr := netip.ParsePrefix(route.Destination)
		if parseErr != nil {
			if addr, err := netip.ParseAddr(route.Destination); err == nil {
				prefix = netip.PrefixFrom(addr, addr.BitLen())
			} else {
				continue
			}
		}
		if prefix.Bits() == 0 {
			continue
		}
		if !prefix.Overlaps(target) {
			continue
		}
		existingOwned := false
		for _, address := range owned {
			p, _ := netip.ParsePrefix(address)
			if route.Device == lan.InterfaceName && (prefix == p.Masked() || prefix == netip.PrefixFrom(p.Addr(), 32) || (route.Type == "broadcast" && prefix.Bits() == 32 && p.Contains(prefix.Addr()))) {
				existingOwned = true
			}
		}
		if !existingOwned {
			return errors.New("LAN overlaps an existing host route")
		}
	}
	for _, ip := range e.ManagementIPs {
		addr, _ := netip.ParseAddr(ip)
		if target.Contains(addr) {
			return errors.New("LAN overlaps controller address")
		}
	}
	return nil
}

// Ownership is durable before an address is added. At most the old/new address
// can be owned during transition; rollback removes only those exact addresses.
func (e Engine) reconcileLAN(ctx context.Context, routing *Routing) error {
	originals, err := e.originalLANs()
	if err != nil {
		return err
	}
	inventory, err := e.addresses(ctx)
	if err != nil {
		return err
	}
	var desired *LAN
	if routing != nil {
		desired = &routing.LAN
	}
	for _, record := range originals {
		index := slices.IndexFunc(inventory, func(l addressLink) bool { return l.Name == record.InterfaceName })
		if index < 0 {
			return errors.New("owned LAN interface disappeared")
		}
		present := ipv4Addresses(inventory[index])
		for _, owned := range record.OwnedAddresses {
			if desired != nil && desired.InterfaceName == record.InterfaceName && desired.Address == owned {
				continue
			}
			if slices.Contains(present, owned) {
				if _, err = e.Run(ctx, "ip", []string{"address", "del", owned, "dev", record.InterfaceName}, ""); err != nil {
					return err
				}
			}
		}
		if desired == nil || desired.InterfaceName != record.InterfaceName {
			state := "down"
			if record.WasUp {
				state = "up"
			}
			if _, err = e.Run(ctx, "ip", []string{"link", "set", "dev", record.InterfaceName, state}, ""); err != nil {
				return err
			}
			if err = os.Remove(filepath.Join(e.Directory, "lan-original-"+record.InterfaceName+".json")); err != nil {
				return err
			}
		}
	}
	if desired == nil {
		return nil
	}
	index := slices.IndexFunc(inventory, func(l addressLink) bool { return l.Name == desired.InterfaceName })
	if index < 0 {
		return errors.New("LAN interface disappeared")
	}
	record := lanOriginal{InterfaceName: desired.InterfaceName, WasUp: slices.Contains(inventory[index].Flags, "UP")}
	for _, existing := range originals {
		if existing.InterfaceName == desired.InterfaceName {
			record = existing
		}
	}
	record.OwnedAddresses = []string{desired.Address}
	if err = e.writeOriginal(record); err != nil {
		return err
	}
	if !slices.Contains(ipv4Addresses(inventory[index]), desired.Address) {
		if _, err = e.Run(ctx, "ip", []string{"address", "add", desired.Address, "dev", desired.InterfaceName}, ""); err != nil {
			return err
		}
	}
	_, err = e.Run(ctx, "ip", []string{"link", "set", "dev", desired.InterfaceName, "up"}, "")
	return err
}
func (e Engine) lanPresent(ctx context.Context, routing *Routing) (bool, error) {
	if routing == nil {
		records, err := e.originalLANs()
		return len(records) == 0, err
	}
	inventory, err := e.addresses(ctx)
	if err != nil {
		return false, err
	}
	for _, link := range inventory {
		if link.Name == routing.LAN.InterfaceName {
			return slices.Contains(link.Flags, "UP") && slices.Contains(ipv4Addresses(link), routing.LAN.Address), nil
		}
	}
	return false, nil
}

func (e Engine) hasLANRecords() bool {
	files, _ := filepath.Glob(filepath.Join(e.Directory, "lan-original-*.json"))
	return len(files) > 0
}
