package network

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestLANValidationRejectsOverlapsAndInvalidHostAddresses(t *testing.T) {
	good := Routing{LAN: LAN{InterfaceName: "ens34", Address: "10.61.0.1/24", AdvertisedPrefix: "10.61.0.0/24"}, ProtectedPrefixes: []string{"192.168.160.0/24"}}
	if err := validateRouting(good); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*Routing){
		func(r *Routing) { r.LAN.InterfaceName = "lo" }, func(r *Routing) { r.LAN.InterfaceName = "pm123456789abc" },
		func(r *Routing) { r.LAN.Address = "10.61.0.0/24" }, func(r *Routing) { r.LAN.Address = "10.61.0.255/24" },
		func(r *Routing) { r.LAN.AdvertisedPrefix = "10.0.0.0/8" }, func(r *Routing) { r.ProtectedPrefixes = []string{"10.61.0.0/24"} },
	} {
		r := good
		mutate(&r)
		if validateRouting(r) == nil {
			t.Fatal("unsafe LAN accepted")
		}
	}
}
func TestRestoreAcquiresLockBeforeReadingLocalState(t *testing.T) {
	dir := privateDirectory(t)
	lock, err := os.OpenFile(filepath.Join(dir, "network.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	if err = os.WriteFile(filepath.Join(dir, "network-applied.json"), []byte("invalid state"), 0600); err != nil {
		t.Fatal(err)
	}
	engine := Engine{Directory: dir}
	if err = engine.Restore(context.Background()); !errors.Is(err, ErrReconcileBusy) {
		t.Fatal("state read before lock", err)
	}
}
