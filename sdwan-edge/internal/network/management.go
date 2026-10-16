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
	addresses, lookupErr := net.DefaultResolver.LookupIPAddr(lookupCtx, parsed.Hostname())
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
