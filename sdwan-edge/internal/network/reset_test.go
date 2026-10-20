package network

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestResetRequiresManagementSafetyInputs(t *testing.T) {
	engine := Engine{Directory: privateDirectory(t)}
	if engine.Reset(context.Background(), nil) == nil {
		t.Fatal("reset accepted without management confirmation")
	}
	if engine.Reset(context.Background(), func(context.Context) error { return nil }) == nil {
		t.Fatal("reset accepted without management IPs")
	}
}

func TestResetGuardRemovalChecksExactOwnership(t *testing.T) {
	for _, owner := range []string{"foreign", "owned", "absent"} {
		t.Run(owner, func(t *testing.T) {
			engine := Engine{NodeID: "reset-node"}
			mutations := 0
			engine.Run = func(_ context.Context, name string, args []string, input string) ([]byte, error) {
				if name != "nft" {
					t.Fatal("unexpected command")
				}
				command := strings.Join(args, " ")
				switch command {
				case "-j list tables":
					if owner == "absent" {
						return []byte(`{"nftables":[]}`), nil
					}
					return []byte(fmt.Sprintf(`{"nftables":[{"table":{"family":"inet","name":"pmwg%s"}}]}`, engine.group())), nil
				case "-j list table inet pmwg" + engine.group():
					comment := "foreign"
					if owner == "owned" {
						comment = "PacketMotion WireGuard " + engine.group()
					}
					return []byte(fmt.Sprintf(`{"nftables":[{"table":{"name":"pmwg%s","comment":%q}}]}`, engine.group(), comment)), nil
				case "-f /dev/stdin":
					mutations++
					if input != "delete table inet pmwg"+engine.group()+"\n" {
						t.Fatal("unscoped firewall deletion")
					}
					return nil, nil
				default:
					t.Fatal("unexpected firewall operation")
					return nil, nil
				}
			}
			err := engine.removeIsolation(context.Background())
			if owner == "foreign" && (err == nil || mutations != 0) {
				t.Fatal("foreign guard was modified")
			}
			if owner == "owned" && (err != nil || mutations != 1) {
				t.Fatal("owned guard not removed")
			}
			if owner == "absent" && (err != nil || mutations != 0) {
				t.Fatal("absent guard not idempotent")
			}
		})
	}
}
