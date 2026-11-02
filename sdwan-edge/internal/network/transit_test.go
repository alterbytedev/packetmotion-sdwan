package network

import (
	"context"
	"strings"
	"testing"
)

func testTransitPlan(t *testing.T) Plan {
	t.Helper()
	plan := testRoutedPlan(t)
	plan.Routing.Transit = []TransitRule{
		{ID: "lan-to-peer", Source: "10.61.0.0/24", Destination: "10.62.0.0/24", Protocol: "any"},
		{ID: "peer-to-lan", Source: "10.62.0.0/24", Destination: "10.61.0.0/24", Protocol: "icmp"},
	}
	return plan
}

func TestTransitRulesRenderExactScriptBoundToInterfaces(t *testing.T) {
	plan := testTransitPlan(t)
	if err := Validate(plan); err != nil {
		t.Fatal(err)
	}
	tunnel := plan.Tunnels[0].Name
	want := " iifname \"ens34\" oifname \"" + tunnel + "\" ip saddr 10.61.0.0/24 ip daddr 10.62.0.0/24 accept;\n" +
		" iifname \"" + tunnel + "\" oifname \"ens34\" ip saddr 10.62.0.0/24 ip daddr 10.61.0.0/24 ip protocol icmp accept;\n" +
		" meta iifgroup 4242 ct state established,related accept;\n meta oifgroup 4242 ct state established,related accept;\n"
	if got := renderTransitRules(*plan.Routing, "4242"); got != want {
		t.Fatalf("unexpected transit rules:\n%s", got)
	}
	if renderTransitRules(*testRoutedPlan(t).Routing, "4242") != "" {
		t.Fatal("no rules must keep the blanket denial only")
	}
}

func TestTransitValidationRejectsUnapprovedRules(t *testing.T) {
	for name, rule := range map[string]TransitRule{
		"foreign destination": {ID: "a", Source: "10.61.0.0/24", Destination: "172.16.0.0/24", Protocol: "any"},
		"protected source":    {ID: "a", Source: "192.168.160.0/24", Destination: "10.61.0.0/24", Protocol: "any"},
		"same prefix":         {ID: "a", Source: "10.61.0.0/24", Destination: "10.61.0.0/24", Protocol: "any"},
		"bad protocol":        {ID: "a", Source: "10.61.0.0/24", Destination: "10.62.0.0/24", Protocol: "gre"},
		"bad id":              {ID: "A b", Source: "10.61.0.0/24", Destination: "10.62.0.0/24", Protocol: "any"},
		"wider prefix":        {ID: "a", Source: "10.0.0.0/8", Destination: "10.62.0.0/24", Protocol: "any"},
	} {
		plan := testRoutedPlan(t)
		plan.Routing.Transit = []TransitRule{rule}
		if Validate(plan) == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	duplicate := testTransitPlan(t)
	duplicate.Routing.Transit[1].ID = duplicate.Routing.Transit[0].ID
	if Validate(duplicate) == nil {
		t.Fatal("duplicate id accepted")
	}
	tooMany := testRoutedPlan(t)
	for i := 0; i <= maxTransitRules; i++ {
		tooMany.Routing.Transit = append(tooMany.Routing.Transit, TransitRule{ID: "r", Source: "10.61.0.0/24", Destination: "10.62.0.0/24", Protocol: "any"})
	}
	if Validate(tooMany) == nil {
		t.Fatal("oversized policy accepted")
	}
}

func TestIsolationAppliesAllowRulesOnlyWithLocalOptIn(t *testing.T) {
	plan := testTransitPlan(t)
	for _, allowed := range []bool{false, true} {
		var script string
		engine := Engine{NodeID: "11111111-1111-4111-8111-111111111111", AllowTransit: allowed, Run: func(_ context.Context, name string, args []string, input string) ([]byte, error) {
			if name == "nft" && len(args) > 0 && args[0] == "-j" {
				return []byte(`{"nftables":[]}`), nil
			}
			script = input
			return nil, nil
		}}
		if err := engine.ensureIsolation(context.Background(), plan); err != nil {
			t.Fatal(err)
		}
		if got := strings.Contains(script, "iifname"); got != allowed {
			t.Fatalf("allow=%v produced script:\n%s", allowed, script)
		}
		if !strings.Contains(script, "iifgroup "+engine.group()+" drop;") {
			t.Fatalf("blanket drop missing:\n%s", script)
		}
	}
}
