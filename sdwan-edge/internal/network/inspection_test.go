package network

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestInspectReadOnlyAndSelectedFields(t *testing.T) {
	calls := [][]string{}
	run := func(_ context.Context, name string, args []string, input string) ([]byte, error) {
		if name != "ip" || input != "" {
			t.Fatal("unexpected command")
		}
		calls = append(calls, args)
		if len(calls) == 1 {
			return []byte(`[{"ifname":"ens34.100","ifindex":3,"link_index":2,"ifalias":"SECRET","link_type":"ether","mtu":1500,"flags":["UP"],"linkinfo":{"info_kind":"vlan","info_data":{"id":100}},"addr_info":[{"family":"inet","local":"10.61.100.1","prefixlen":24},{"family":"inet6","local":"fe80::1","prefixlen":64}]}]`), nil
		}
		return []byte(`[{"dst":"default","gateway":"192.0.2.1","dev":"ens33","protocol":"static","table":254,"secret":"SECRET"},{"dst":"10.61.100.0/24","dev":"ens34.100","protocol":2}]`), nil
	}
	result, err := Inspect(context.Background(), run)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(calls, [][]string{{"-j", "-d", "address", "show"}, {"-j", "-4", "route", "show", "table", "all"}}) {
		t.Fatalf("unexpected queries: %v", calls)
	}
	entry := result.Interfaces[0]
	if entry.ParentIndex != 2 || entry.VLANID != 100 || !entry.Up || !reflect.DeepEqual(entry.Addresses, []string{"10.61.100.1/24"}) || result.Routes[0].Table != "254" {
		t.Fatalf("incorrect inspection: %+v", result)
	}
	data, _ := json.Marshal(result)
	if strings.Contains(string(data), "SECRET") {
		t.Fatal("raw diagnostics leaked")
	}
}

func TestInspectRejectsUnsafeOrIncompleteEvidence(t *testing.T) {
	for _, data := range []string{`not-json`, strings.Repeat("x", 1024*1024+1), `[{"ifname":"bad\nname","ifindex":1}]`, `[{"ifname":"ens34.0","ifindex":1,"linkinfo":{"info_kind":"vlan","info_data":{"id":0}}}]`, `[{"ifname":"ens34","ifindex":1,"addr_info":[{"family":"inet","local":"10.0.0.1","prefixlen":33}]}]`} {
		if _, err := Inspect(context.Background(), func(context.Context, string, []string, string) ([]byte, error) { return []byte(data), nil }); err == nil {
			t.Fatal("invalid evidence accepted")
		}
	}
	calls := 0
	_, err := Inspect(context.Background(), func(context.Context, string, []string, string) ([]byte, error) {
		calls++
		if calls == 1 {
			return []byte(`[]`), nil
		}
		return nil, errors.New("SECRET raw output")
	})
	if err == nil || strings.Contains(err.Error(), "SECRET") {
		t.Fatal("unsafe route failure")
	}
}

func TestInspectEmptyAndRouteValidation(t *testing.T) {
	for _, route := range []string{`[]`, `[{"dst":"not-a-prefix"}]`, `[{"dst":"default","gateway":"::1"}]`, `[{"dst":"default","dev":"bad\nname"}]`} {
		calls := 0
		result, err := Inspect(context.Background(), func(context.Context, string, []string, string) ([]byte, error) {
			calls++
			if calls == 1 {
				return []byte(`[]`), nil
			}
			return []byte(route), nil
		})
		if route == `[]` {
			if err != nil || result.Interfaces == nil || result.Routes == nil {
				t.Fatal("invalid empty inspection")
			}
		} else if err == nil {
			t.Fatal("invalid route accepted")
		}
	}
}
