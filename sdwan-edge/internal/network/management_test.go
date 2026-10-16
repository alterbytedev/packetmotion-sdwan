package network

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestManagementAddressCacheBoundToControllerOrigin(t *testing.T) {
	directory := privateDirectory(t)
	addresses, err := ManagementAddresses(context.Background(), directory, "https://192.0.2.1")
	if err != nil || len(addresses) != 1 || addresses[0] != "192.0.2.1" {
		t.Fatal(addresses, err)
	}
	info, err := os.Stat(filepath.Join(directory, "network-management.json"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("cache must remain private", err)
	}
	// A numeric hostname whose address cannot be resolved forces the cache path
	// without depending on a real DNS outage or the caller's DNS configuration.
	origin := "https://256.256.256.256"
	data := []byte(`{"origin":"` + origin + `","addresses":["192.0.2.1"]}`)
	if err := os.WriteFile(filepath.Join(directory, "network-management.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	addresses, err = ManagementAddresses(context.Background(), directory, origin)
	if err != nil || len(addresses) != 1 || addresses[0] != "192.0.2.1" {
		t.Fatal("offline cache unavailable", addresses, err)
	}
	if _, err = ManagementAddresses(context.Background(), directory, "https://257.257.257.257"); err == nil {
		t.Fatal("foreign-origin cache accepted")
	}
}
