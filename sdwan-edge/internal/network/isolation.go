package network

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// Isolate only this node's interface group at the forward hook. Input/output
// management traffic and forwarding through unrelated interfaces are unchanged.
// The nft transaction replaces only a table bearing our exact ownership comment.
func (e Engine) ensureIsolation(ctx context.Context) error { return e.reconcileIsolation(ctx, false) }
func (e Engine) removeIsolation(ctx context.Context) error { return e.reconcileIsolation(ctx, true) }
func (e Engine) reconcileIsolation(ctx context.Context, remove bool) error {
	rules := fmt.Sprintf(" meta iifgroup %s drop;\n meta oifgroup %s drop;\n", e.group(), e.group())
	return reconcileOwnedIsolation(ctx, e.Run, "pmwg"+e.group(), "PacketMotion WireGuard "+e.group(), rules, remove)
}

func reconcileOwnedIsolation(ctx context.Context, run Runner, name, comment, rules string, remove bool) error {
	data, err := run(ctx, "nft", []string{"-j", "list", "tables"}, "")
	if err != nil {
		return err
	}
	var inventory struct {
		Objects []struct {
			Table *struct {
				Family string `json:"family"`
				Name   string `json:"name"`
			} `json:"table"`
		} `json:"nftables"`
	}
	if json.Unmarshal(data, &inventory) != nil {
		return errors.New("invalid firewall inventory")
	}
	exists := false
	for _, object := range inventory.Objects {
		if object.Table != nil && object.Table.Family == "inet" && object.Table.Name == name {
			exists = true
		}
	}
	script := ""
	if exists {
		data, err = run(ctx, "nft", []string{"-j", "list", "table", "inet", name}, "")
		if err != nil {
			return err
		}
		var table struct {
			Objects []struct {
				Table *struct {
					Name    string `json:"name"`
					Comment string `json:"comment"`
				} `json:"table"`
			} `json:"nftables"`
		}
		if json.Unmarshal(data, &table) != nil {
			return errors.New("invalid firewall table")
		}
		owned := false
		for _, object := range table.Objects {
			if object.Table != nil && object.Table.Name == name && object.Table.Comment == comment {
				owned = true
			}
		}
		if !owned {
			return errors.New("firewall table name is already owned")
		}
		script = "delete table inet " + name + "\n"
	}
	if remove {
		if !exists {
			return nil
		}
		_, err = run(ctx, "nft", []string{"-f", "/dev/stdin"}, script)
		return err
	}
	script += fmt.Sprintf("table inet %s {\n comment \"%s\";\n chain forward {\n type filter hook forward priority -300; policy accept;\n%s }\n}\n", name, comment, rules)
	_, err = run(ctx, "nft", []string{"-f", "/dev/stdin"}, script)
	return err
}
