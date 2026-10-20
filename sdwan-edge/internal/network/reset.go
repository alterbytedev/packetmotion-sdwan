package network

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// Reset removes only this identity's owned bundle. Local root confirmation is
// enforced by the CLI; controller desired configuration cannot invoke cleanup.
// Keep the old isolation guard throughout rollback; delete it only after an
// empty plan and a fresh controller confirmation have succeeded.
func (e Engine) Reset(ctx context.Context, confirm func(context.Context) error) error {
	if confirm == nil || len(e.ManagementIPs) == 0 {
		return errors.New("network reset requires management confirmation")
	}
	return e.withLock(func(engine Engine) error {
		name := "network-applied.json"
		if _, err := os.Stat(filepath.Join(engine.Directory, "network-pending.json")); err == nil {
			name = "network-pending.json"
		} else if !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		previous, err := readPlan(engine.Directory, name)
		if err != nil {
			return err
		}
		// The locally confirmed operation authorizes removal of owned routing only.
		// Recovery may first restore a pending previous bundle through the same engine.
		engine.AllowRouting = true
		if previous.Routing != nil {
			engine.LANInterface = previous.Routing.LAN.InterfaceName
		}
		if err = engine.preflight(ctx, Plan{Tunnels: []Tunnel{}}); err != nil {
			return err
		}
		if err = confirm(ctx); err != nil {
			return err
		}
		if err = engine.applyLocked(ctx, Plan{Tunnels: []Tunnel{}}, confirm); err != nil {
			return err
		}
		links, err := engine.links(ctx)
		if err != nil {
			return err
		}
		for _, link := range links {
			if engine.owns(link) {
				return errors.New("owned interfaces remain; isolation retained")
			}
		}
		return engine.removeIsolation(ctx)
	})
}
