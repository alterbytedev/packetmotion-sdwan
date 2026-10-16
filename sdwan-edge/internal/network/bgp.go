package network

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"packetmotion/fabric-agent/internal/identity"
)

type BGP struct {
	LocalASN int       `json:"localAsn"`
	RouterID string    `json:"routerId"`
	Peers    []BGPPeer `json:"peers"`
}
type BGPPeer struct {
	InterfaceName   string   `json:"interfaceName"`
	Address         string   `json:"address"`
	RemoteASN       int      `json:"remoteAsn"`
	ImportPrefixes  []string `json:"importPrefixes"`
	ExportPrefixes  []string `json:"exportPrefixes"`
	LocalPreference int      `json:"localPreference"`
}
type BGPPeerObservation struct {
	Address          string `json:"address"`
	State            string `json:"state"`
	ReceivedPrefixes int    `json:"receivedPrefixes"`
}
type bgpOwner struct {
	ASN int `json:"asn"`
}

func privateASN(value int) bool { return value >= 64512 && value <= 65534 }
func validateBGP(plan Plan) error {
	if plan.Routing == nil || plan.Routing.BGP == nil {
		return nil
	}
	routing := plan.Routing
	bgp := routing.BGP
	lan, _ := netip.ParsePrefix(routing.LAN.Address)
	routerID, err := netip.ParseAddr(bgp.RouterID)
	if !privateASN(bgp.LocalASN) || err != nil || routerID != lan.Addr() || len(bgp.Peers) > 128 {
		return errors.New("invalid BGP identity")
	}
	names := map[string]bool{}
	for _, peer := range bgp.Peers {
		index := slices.IndexFunc(plan.Tunnels, func(t Tunnel) bool { return t.Name == peer.InterfaceName && t.PeerAddress == peer.Address })
		if index < 0 || names[peer.InterfaceName] || !privateASN(peer.RemoteASN) || peer.RemoteASN == bgp.LocalASN ||
			len(peer.ImportPrefixes) != 1 || len(peer.ExportPrefixes) != 1 || peer.ExportPrefixes[0] != routing.LAN.AdvertisedPrefix ||
			(peer.LocalPreference != 100 && peer.LocalPreference != 200) {
			return errors.New("invalid BGP adjacency")
		}
		names[peer.InterfaceName] = true
		remote, err := netip.ParsePrefix(peer.ImportPrefixes[0])
		local, _ := netip.ParsePrefix(routing.LAN.AdvertisedPrefix)
		if err != nil || !remote.Addr().Is4() || !remote.Addr().IsPrivate() || remote != remote.Masked() || remote.Bits() < 8 || remote.Bits() > 30 || remote.Overlaps(local) {
			return errors.New("invalid BGP import prefix")
		}
		for _, value := range routing.ProtectedPrefixes {
			protected, _ := netip.ParsePrefix(value)
			if protected.Overlaps(remote) {
				return errors.New("BGP import overlaps a protected network")
			}
		}
		for _, tunnel := range plan.Tunnels {
			overlay, _ := netip.ParsePrefix(tunnel.Address)
			if overlay.Overlaps(remote) {
				return errors.New("BGP import overlaps overlay")
			}
		}
		if !slices.Equal(plan.Tunnels[index].AllowedPrefixes, peer.ImportPrefixes) {
			return errors.New("WireGuard and BGP prefix ownership disagree")
		}
	}
	for _, tunnel := range plan.Tunnels {
		if len(tunnel.AllowedPrefixes) > 0 && !names[tunnel.Name] {
			return errors.New("WireGuard prefix has no approved BGP peer")
		}
	}
	return nil
}
func (e Engine) ownedFilter(name string) bool {
	return regexp.MustCompile("^" + e.bgpPrefix() + "(OWNER|pm[0-9a-f]{12}_(IN|OUT))$").MatchString(name)
}
func (e Engine) bgpPrefix() string { return "PM" + e.group() + "_" }
func (e Engine) bgpOwner() (bgpOwner, error) {
	data, err := os.ReadFile(filepath.Join(e.Directory, "routing-owner.json"))
	if errors.Is(err, fs.ErrNotExist) {
		return bgpOwner{}, nil
	}
	if err != nil {
		return bgpOwner{}, err
	}
	var owner bgpOwner
	if json.Unmarshal(data, &owner) != nil || !privateASN(owner.ASN) {
		return owner, errors.New("invalid BGP ownership record")
	}
	return owner, nil
}
func (e Engine) runningFRR(ctx context.Context) (string, error) {
	data, err := e.Run(ctx, "vtysh", []string{"-c", "show running-config"}, "")
	return string(data), err
}
func bgpRouters(config string) []int {
	result := []int{}
	for _, line := range strings.Split(config, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 3 && fields[0] == "router" && fields[1] == "bgp" {
			asn, _ := strconv.Atoi(fields[2])
			if len(fields) != 3 {
				asn = 0
			}
			result = append(result, asn)
		}
	}
	return result
}
func (e Engine) preflightBGP(ctx context.Context, plan Plan) error {
	owner, err := e.bgpOwner()
	if err != nil {
		return err
	}
	active := plan.Routing != nil && plan.Routing.BGP != nil
	if !active && owner.ASN == 0 {
		return nil
	}
	config, err := e.runningFRR(ctx)
	if err != nil {
		return errors.New("FRR ownership inspection unavailable")
	}
	routers := bgpRouters(config)
	for _, asn := range routers {
		if owner.ASN == 0 || asn != owner.ASN || !strings.Contains(config, "ip prefix-list "+e.bgpPrefix()+"OWNER ") {
			return errors.New("existing BGP configuration is not owned by this agent")
		}
	}
	if active {
		if owner.ASN != 0 && owner.ASN != plan.Routing.BGP.LocalASN {
			return errors.New("BGP ASN replacement requires operator recovery")
		}
		// Never adopt an existing filter name on first apply.
		if owner.ASN == 0 && strings.Contains(config, e.bgpPrefix()) {
			return errors.New("FRR filter namespace is already owned")
		}
		file, err := e.bgpCandidate(plan)
		if err != nil {
			return err
		}
		if _, err = e.Run(ctx, "vtysh", []string{"-C", "-f", file}, ""); err != nil {
			return errors.New("BGP candidate syntax validation failed")
		}
	}
	return nil
}
func (e Engine) bgpCandidate(plan Plan) (string, error) {
	config := e.renderBGP(plan)
	if err := identity.WritePrivate(e.Directory, "routing-candidate.conf", []byte(config)); err != nil {
		return "", err
	}
	return filepath.Join(e.Directory, "routing-candidate.conf"), nil
}
func (e Engine) renderBGP(plan Plan) string {
	bgp := plan.Routing.BGP
	var b strings.Builder
	fmt.Fprintf(&b, "ip prefix-list %sOWNER seq 5 deny 0.0.0.0/0 le 32\n", e.bgpPrefix())
	for _, peer := range bgp.Peers {
		name := e.bgpPrefix() + peer.InterfaceName
		fmt.Fprintf(&b, "ip prefix-list %s_IN seq 5 permit %s\nip prefix-list %s_IN seq 10 deny 0.0.0.0/0 le 32\n", name, peer.ImportPrefixes[0], name)
		fmt.Fprintf(&b, "ip prefix-list %s_OUT seq 5 permit %s\nip prefix-list %s_OUT seq 10 deny 0.0.0.0/0 le 32\n", name, peer.ExportPrefixes[0], name)
		fmt.Fprintf(&b, "route-map %s_IN permit 10\n match ip address prefix-list %s_IN\n set local-preference %d\nexit\nroute-map %s_IN deny 100\nexit\n", name, name, peer.LocalPreference, name)
	}
	fmt.Fprintf(&b, "router bgp %d\n bgp router-id %s\n no bgp default ipv4-unicast\n bgp ebgp-requires-policy\n bgp network import-check\n", bgp.LocalASN, bgp.RouterID)
	for _, peer := range bgp.Peers {
		index := slices.IndexFunc(plan.Tunnels, func(t Tunnel) bool { return t.Name == peer.InterfaceName })
		address, _ := netip.ParsePrefix(plan.Tunnels[index].Address)
		fmt.Fprintf(&b, " neighbor %s remote-as %d\n neighbor %s update-source %s\n neighbor %s timers 3 9\n", peer.Address, peer.RemoteASN, peer.Address, address.Addr(), peer.Address)
	}
	b.WriteString(" address-family ipv4 unicast\n")
	fmt.Fprintf(&b, "  network %s\n  maximum-paths 1\n", plan.Routing.LAN.AdvertisedPrefix)
	for _, peer := range bgp.Peers {
		name := e.bgpPrefix() + peer.InterfaceName
		fmt.Fprintf(&b, "  neighbor %s activate\n  neighbor %s route-map %s_IN in\n  neighbor %s prefix-list %s_OUT out\n  neighbor %s maximum-prefix 1\n", peer.Address, peer.Address, name, peer.Address, name, peer.Address)
	}
	b.WriteString(" exit-address-family\nexit\n")
	return b.String()
}

// Only an owned BGP instance and names under its marker prefix may be removed.
// Static routes, other protocols and /etc/frr/frr.conf are never rewritten.
func (e Engine) withdrawBGP(ctx context.Context) error {
	owner, err := e.bgpOwner()
	if err != nil || owner.ASN == 0 {
		return err
	}
	config, err := e.runningFRR(ctx)
	if err != nil {
		return err
	}
	routers := bgpRouters(config)
	commands := []string{}
	if len(routers) > 0 {
		if len(routers) != 1 || routers[0] != owner.ASN || !strings.Contains(config, "ip prefix-list "+e.bgpPrefix()+"OWNER ") {
			return errors.New("BGP ownership changed; refusing cleanup")
		}
		commands = append(commands, fmt.Sprintf("no router bgp %d", owner.ASN))
	}
	seen := map[string]bool{}
	for _, line := range strings.Split(config, "\n") {
		fields := strings.Fields(line)
		command := ""
		if len(fields) > 2 && fields[0] == "ip" && fields[1] == "prefix-list" && e.ownedFilter(fields[2]) {
			command = "no ip prefix-list " + fields[2]
		}
		if len(fields) > 1 && fields[0] == "route-map" && e.ownedFilter(fields[1]) {
			command = "no route-map " + fields[1]
		}
		if command != "" && !seen[command] {
			commands = append(commands, command)
			seen[command] = true
		}
	}
	if len(commands) == 0 {
		return nil
	}
	if err = identity.WritePrivate(e.Directory, "routing-remove.conf", []byte(strings.Join(commands, "\n")+"\n")); err != nil {
		return err
	}
	_, err = e.Run(ctx, "vtysh", []string{"-f", filepath.Join(e.Directory, "routing-remove.conf")}, "")
	return err
}
func (e Engine) applyBGP(ctx context.Context, plan Plan) error {
	if plan.Routing == nil || plan.Routing.BGP == nil {
		return nil
	}
	owner := bgpOwner{ASN: plan.Routing.BGP.LocalASN}
	data, _ := json.Marshal(owner)
	if err := identity.WritePrivate(e.Directory, "routing-owner.json", data); err != nil {
		return err
	}
	candidate, err := e.bgpCandidate(plan)
	if err != nil {
		return err
	}
	_, err = e.Run(ctx, "vtysh", []string{"-f", candidate}, "")
	return err
}
func (e Engine) bgpPresent(ctx context.Context, plan Plan) (bool, error) {
	owner, err := e.bgpOwner()
	if err != nil {
		return false, err
	}
	active := plan.Routing != nil && plan.Routing.BGP != nil
	if !active && owner.ASN == 0 {
		return true, nil
	}
	config, err := e.runningFRR(ctx)
	if err != nil {
		return false, err
	}
	routers := bgpRouters(config)
	if !active {
		return len(routers) == 0 && !strings.Contains(config, e.bgpPrefix()), nil
	}
	if len(routers) != 1 || routers[0] != plan.Routing.BGP.LocalASN || !strings.Contains(config, "ip prefix-list "+e.bgpPrefix()+"OWNER ") {
		return false, nil
	}
	neighborCount := 0
	networkCount := 0
	for _, line := range strings.Split(config, "\n") {
		fields := strings.Fields(line)
		if len(fields) > 0 && fields[0] == "network" {
			networkCount++
		}
		if len(fields) > 0 && (fields[0] == "redistribute" || strings.Contains(line, "default-originate")) {
			return false, nil
		}
		if len(fields) >= 3 && fields[0] == "neighbor" && fields[2] == "remote-as" {
			neighborCount++
		}
	}
	if neighborCount != len(plan.Routing.BGP.Peers) || networkCount != 1 || !strings.Contains(config, "network "+plan.Routing.LAN.AdvertisedPrefix) {
		return false, nil
	}
	for _, peer := range plan.Routing.BGP.Peers {
		name := e.bgpPrefix() + peer.InterfaceName
		required := []string{
			fmt.Sprintf("neighbor %s remote-as %d", peer.Address, peer.RemoteASN),
			fmt.Sprintf("neighbor %s maximum-prefix 1", peer.Address),
			fmt.Sprintf("ip prefix-list %s_IN seq 10 deny 0.0.0.0/0 le 32", name),
			fmt.Sprintf("ip prefix-list %s_OUT seq 10 deny 0.0.0.0/0 le 32", name),
			fmt.Sprintf("neighbor %s route-map %s_IN in", peer.Address, name),
			fmt.Sprintf("neighbor %s prefix-list %s_OUT out", peer.Address, name),
			fmt.Sprintf("ip prefix-list %s_IN seq 5 permit %s", name, peer.ImportPrefixes[0]),
			fmt.Sprintf("ip prefix-list %s_OUT seq 5 permit %s", name, peer.ExportPrefixes[0]),
		}
		for _, line := range required {
			if !strings.Contains(config, line) {
				return false, nil
			}
		}
	}
	return true, nil
}
func (e Engine) BGPPeers(ctx context.Context, plan Plan) ([]BGPPeerObservation, error) {
	result := []BGPPeerObservation{}
	if plan.Routing == nil || plan.Routing.BGP == nil {
		return result, nil
	}
	if e.Run == nil {
		e.Run = Command
	}
	data, err := e.Run(ctx, "vtysh", []string{"-c", "show bgp ipv4 unicast summary json"}, "")
	if err != nil {
		return nil, err
	}
	type peerStatus struct {
		State    string `json:"state"`
		Prefixes int    `json:"pfxRcd"`
	}
	var summary struct {
		Peers map[string]peerStatus `json:"peers"`
		IPv4  struct {
			Peers map[string]peerStatus `json:"peers"`
		} `json:"ipv4Unicast"`
	}
	if json.Unmarshal(data, &summary) != nil {
		return nil, errors.New("invalid BGP observation")
	}
	// FRR 10.3 returns the selected AF directly; other supported outputs wrap it.
	peers := summary.Peers
	if peers == nil {
		peers = summary.IPv4.Peers
	}
	for _, peer := range plan.Routing.BGP.Peers {
		entry, found := peers[peer.Address]
		if !found {
			result = append(result, BGPPeerObservation{Address: peer.Address, State: "Unavailable"})
			continue
		}
		state := entry.State
		if !slices.Contains([]string{"Idle", "Connect", "Active", "OpenSent", "OpenConfirm", "Established"}, state) {
			state = "Unavailable"
		}
		count := entry.Prefixes
		if count < 0 || count > 1 {
			return nil, errors.New("BGP prefix count exceeds approved bound")
		}
		result = append(result, BGPPeerObservation{Address: peer.Address, State: state, ReceivedPrefixes: count})
	}
	return result, nil
}
