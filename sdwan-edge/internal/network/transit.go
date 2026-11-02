package network

import (
	"errors"
	"fmt"
	"net/netip"
	"regexp"
	"slices"
	"strings"
)

const maxTransitRules = 64

// TransitRule permits forwarded IPv4 traffic from one approved LAN prefix to
// another across the owned tunnels. Prefixes are limited to this node's LAN and
// its BGP peers' imported LANs; the guard keeps denying everything else.
type TransitRule struct {
	ID          string `json:"id"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Protocol    string `json:"protocol"`
}

var transitID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,35}$`)

// transitEndpoints maps each approved prefix to the interface that carries it:
// the LAN interface for the local prefix, the peer tunnel for an imported one.
// Binding the interface to the prefix is what rejects spoofed sources.
func transitEndpoints(routing Routing) map[netip.Prefix]string {
	endpoints := map[netip.Prefix]string{}
	if lan, err := netip.ParsePrefix(routing.LAN.AdvertisedPrefix); err == nil {
		endpoints[lan] = routing.LAN.InterfaceName
	}
	if routing.BGP != nil {
		for _, peer := range routing.BGP.Peers {
			if len(peer.ImportPrefixes) == 1 {
				if remote, err := netip.ParsePrefix(peer.ImportPrefixes[0]); err == nil {
					endpoints[remote] = peer.InterfaceName
				}
			}
		}
	}
	return endpoints
}

func validateTransit(routing Routing) error {
	if len(routing.Transit) == 0 {
		return nil
	}
	if routing.BGP == nil || len(routing.Transit) > maxTransitRules {
		return errors.New("invalid transit policy")
	}
	endpoints := transitEndpoints(routing)
	seen := map[string]bool{}
	pairs := map[[2]netip.Prefix]bool{}
	for _, rule := range routing.Transit {
		source, sourceErr := netip.ParsePrefix(rule.Source)
		destination, destinationErr := netip.ParsePrefix(rule.Destination)
		_, sourceKnown := endpoints[source]
		_, destinationKnown := endpoints[destination]
		if !transitID.MatchString(rule.ID) || seen[rule.ID] || sourceErr != nil || destinationErr != nil || !sourceKnown || !destinationKnown || source == destination ||
			!slices.Contains([]string{"any", "tcp", "udp", "icmp"}, rule.Protocol) || pairs[[2]netip.Prefix{source, destination}] {
			return errors.New("invalid transit rule")
		}
		seen[rule.ID] = true
		pairs[[2]netip.Prefix{source, destination}] = true
	}
	return nil
}

// renderTransitRules returns allow rules for the owned forward chain. They must
// precede the group drops. Return traffic is admitted only as established or
// related, so a flow that no rule allowed to start can never be established.
func renderTransitRules(routing Routing, group string) string {
	endpoints := transitEndpoints(routing)
	var script strings.Builder
	for _, rule := range routing.Transit {
		source, _ := netip.ParsePrefix(rule.Source)
		destination, _ := netip.ParsePrefix(rule.Destination)
		protocol := ""
		if rule.Protocol != "any" {
			protocol = " ip protocol " + rule.Protocol
		}
		fmt.Fprintf(&script, " iifname %q oifname %q ip saddr %s ip daddr %s%s accept;\n", endpoints[source], endpoints[destination], source, destination, protocol)
	}
	if script.Len() > 0 {
		fmt.Fprintf(&script, " meta iifgroup %s ct state established,related accept;\n meta oifgroup %s ct state established,related accept;\n", group, group)
	}
	return script.String()
}
