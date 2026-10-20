package network

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"packetmotion/fabric-agent/internal/identity"
)

// Cache the last validated controller addresses for cold-start recovery during
// DNS/controller outage. The cache is bound to the exact validated origin.
func ManagementAddresses(ctx context.Context, directory, origin string) ([]string, error) {
	return managementAddresses(ctx, directory, origin, net.DefaultResolver.LookupIPAddr)
}

func managementAddresses(ctx context.Context, directory, origin string, lookup func(context.Context, string) ([]net.IPAddr, error)) ([]string, error) {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil {
		return nil, errors.New("invalid management origin")
	}
	type cache struct {
		Origin    string   `json:"origin"`
		Addresses []string `json:"addresses"`
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	addresses, lookupErr := lookup(lookupCtx, parsed.Hostname())
	value := cache{Origin: origin, Addresses: []string{}}
	if lookupErr == nil {
		for _, address := range addresses {
			if ip, err := netip.ParseAddr(address.IP.String()); err == nil {
				value.Addresses = append(value.Addresses, ip.String())
				if len(value.Addresses) == 16 {
					break
				}
			}
		}
	}
	if len(value.Addresses) > 0 {
		data, _ := json.Marshal(value)
		previous, _ := os.ReadFile(filepath.Join(directory, "network-management.json"))
		if !bytes.Equal(previous, data) {
			if err = identity.WritePrivate(directory, "network-management.json", data); err != nil {
				return nil, err
			}
		}
		return value.Addresses, nil
	}
	data, err := os.ReadFile(filepath.Join(directory, "network-management.json"))
	if err != nil {
		return nil, errors.New("management address safety check unavailable")
	}
	if json.Unmarshal(data, &value) != nil || value.Origin != origin || len(value.Addresses) == 0 || len(value.Addresses) > 16 {
		return nil, errors.New("invalid management address cache")
	}
	for _, address := range value.Addresses {
		if _, err := netip.ParseAddr(address); err != nil {
			return nil, errors.New("invalid cached management address")
		}
	}
	return value.Addresses, nil
}

// Validate every resolved management destination, including on removal plans.
// Never acquire ownership of operator-managed routes to repair an unsafe path.
func (e Engine) validateManagement(ctx context.Context, plan Plan, inventory []link) error {
	// Standalone engine callers may omit this; production supplies controller IPs.
	if len(e.ManagementIPs) == 0 {
		return nil
	}
	if inventory == nil {
		var err error
		inventory, err = e.links(ctx)
		if err != nil {
			return err
		}
	}
	prefixes := []string{}
	for _, tunnel := range plan.Tunnels {
		prefixes = append(prefixes, tunnel.Address)
		prefixes = append(prefixes, tunnel.AllowedPrefixes...)
	}
	if plan.Routing != nil {
		prefixes = append(prefixes, plan.Routing.LAN.AdvertisedPrefix)
		if plan.Routing.BGP != nil {
			for _, peer := range plan.Routing.BGP.Peers {
				prefixes = append(prefixes, peer.ImportPrefixes...)
			}
		}
	}
	for _, value := range e.ManagementIPs {
		address, err := netip.ParseAddr(value)
		if err != nil {
			return errors.New("invalid controller management address")
		}
		for _, value := range prefixes {
			prefix, err := netip.ParsePrefix(value)
			if err != nil || prefix.Contains(address) {
				return errors.New("network plan overlaps controller management address")
			}
		}
		data, err := e.Run(ctx, "ip", []string{"-j", "route", "get", address.String()}, "")
		if err != nil {
			return errors.New("controller management route unavailable")
		}
		var routes []struct {
			Device string `json:"dev"`
			Type   string `json:"type"`
		}
		if json.Unmarshal(data, &routes) != nil || len(routes) == 0 {
			return errors.New("invalid controller management route")
		}
		for _, route := range routes {
			if route.Device == "" || route.Type == "blackhole" || route.Type == "unreachable" || route.Type == "prohibit" || interfaceName.MatchString(route.Device) {
				return errors.New("controller requires a direct management route")
			}
			for _, device := range inventory {
				if device.Name == route.Device && device.Info.Kind == "wireguard" {
					return errors.New("controller management route uses WireGuard")
				}
			}
		}
	}
	return nil
}
