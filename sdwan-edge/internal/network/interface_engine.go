package network

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"slices"
	"strconv"
	"strings"
)

type InterfaceOriginal struct {
	Name      string   `json:"name"`
	Up        bool     `json:"up"`
	MTU       int      `json:"mtu"`
	Addresses []string `json:"addresses"`
}
type InterfaceBundle struct {
	LastResult     *InterfaceResult         `json:"lastResult,omitempty"`
	Configurations []InterfaceConfiguration `json:"configurations"`
	Originals      []InterfaceOriginal      `json:"originals"`
}
type InterfaceJournal struct {
	Request  InterfaceRequest    `json:"request"`
	Previous InterfaceBundle     `json:"previous"`
	Next     InterfaceBundle     `json:"next"`
	Before   []InterfaceOriginal `json:"before"`
	Created  []string            `json:"created"`
	Result   InterfaceResult     `json:"result"`
}

type InterfaceEngine struct {
	Run           Runner
	NodeID        string
	Authorization InterfaceAuthorization
}

func (e InterfaceEngine) runner() Runner {
	if e.Run != nil {
		return e.Run
	}
	return Command
}
func (e InterfaceEngine) group() string {
	group := (Engine{NodeID: e.NodeID + ":interfaces"}).group()
	if group == (Engine{NodeID: e.NodeID}).group() {
		value, _ := strconv.ParseUint(group, 10, 32)
		return strconv.FormatUint(value^1, 10)
	}
	return group
}
func interfaceSettings(bundle InterfaceBundle) []InterfaceSetting {
	result := []InterfaceSetting{}
	for _, c := range bundle.Configurations {
		result = append(result, c.Interfaces...)
	}
	return result
}
func (e InterfaceEngine) Prepare(ctx context.Context, r InterfaceRequest, previous InterfaceBundle) (InterfaceJournal, error) {
	c, err := r.Configuration()
	j := InterfaceJournal{Request: r, Previous: previous, Before: []InterfaceOriginal{}, Created: []string{}}
	if err != nil {
		return j, err
	}
	if c.NodeID != e.NodeID || e.Authorization.NodeID != e.NodeID || !slices.Contains(e.Authorization.Interfaces, c.InterfaceName) {
		return j, errors.New("local_authorization_denied")
	}
	run := e.runner()
	snapshot, err := Inspect(ctx, run)
	if err != nil {
		return j, errors.New("inventory_unavailable")
	}
	protectedTargets := append([]string{}, e.Authorization.ControllerIPs...)
	if slices.ContainsFunc(snapshot.Interfaces, func(item InspectedInterface) bool { return item.Kind == "wireguard" }) {
		data, err := run(ctx, "wg", []string{"show", "all", "endpoints"}, "")
		if err != nil {
			return j, errors.New("inventory_unavailable")
		}
		for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
			if line == "" {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) != 3 {
				return j, errors.New("inventory_unavailable")
			}
			if fields[2] == "(none)" {
				continue
			}
			endpoint, err := netip.ParseAddrPort(fields[2])
			if err != nil {
				return j, errors.New("inventory_unavailable")
			}
			protectedTargets = append(protectedTargets, endpoint.Addr().String())
			if len(protectedTargets) > 256 {
				return j, errors.New("inventory_unavailable")
			}
		}
	}
	engine := Engine{Run: run, NodeID: e.NodeID, ManagementIPs: protectedTargets}
	protected, err := engine.protectedInterfaces(ctx, Plan{})
	if err != nil {
		return j, errors.New("management_route_unavailable")
	}
	for _, route := range snapshot.Routes {
		if route.Destination == "default" {
			protected[route.Device] = true
		}
	}
	if protected[c.InterfaceName] {
		return j, errors.New("management_interface_protected")
	}
	parent, found := findInspected(snapshot, c.InterfaceName)
	if !found || parent.Master != "" || (parent.Kind != "ether" && !(e.Authorization.AllowVirtualLab && parent.Kind == "veth")) || (parent.ParentIndex != 0 && !e.Authorization.AllowVirtualLab) {
		return j, errors.New("physical_parent_required")
	}
	ownedParent := slices.ContainsFunc(previous.Originals, func(s InterfaceOriginal) bool { return s.Name == c.InterfaceName })
	fullAddresses, addressErr := engine.addresses(ctx)
	if addressErr != nil {
		return j, errors.New("inventory_unavailable")
	}
	for _, link := range fullAddresses {
		if link.Name == c.InterfaceName {
			for _, address := range link.Addresses {
				if address.Family == "inet6" {
					ip, err := netip.ParseAddr(address.Local)
					if err != nil || !ip.IsLinkLocalUnicast() {
						return j, errors.New("foreign_interface_address")
					}
				}
			}
		}
	}
	if !ownedParent && len(parent.Addresses) > 0 {
		return j, errors.New("foreign_interface_address")
	}
	links, err := engine.links(ctx)
	if err != nil {
		return j, errors.New("inventory_unavailable")
	}
	j.Next = InterfaceBundle{Configurations: append([]InterfaceConfiguration{}, previous.Configurations...), Originals: append([]InterfaceOriginal{}, previous.Originals...)}
	j.Next.Configurations = slices.DeleteFunc(j.Next.Configurations, func(prior InterfaceConfiguration) bool {
		return prior.InterfaceName == c.InterfaceName && prior.Kind == c.Kind
	})
	if len(c.Interfaces) > 0 {
		j.Next.Configurations = append(j.Next.Configurations, c)
	}
	if !ownedParent {
		j.Next.Originals = append(j.Next.Originals, originalInterface(parent))
	}
	names := map[string]bool{c.InterfaceName: true}
	oldSettings := interfaceSettings(previous)
	nextSettings := interfaceSettings(j.Next)
	if len(nextSettings) > 16 {
		return j, errors.New("validation_failed")
	}
	for index, setting := range nextSettings {
		if setting.Address == nil {
			return j, errors.New("validation_failed")
		}
		prefix, _ := netip.ParsePrefix(*setting.Address)
		for _, other := range nextSettings[:index] {
			if other.Address != nil {
				p, _ := netip.ParsePrefix(*other.Address)
				if prefix.Overlaps(p) {
					return j, errors.New("interface_subnet_overlap")
				}
			}
		}
		if setting.VLANID != nil && setting.InterfaceName == c.InterfaceName {
			mtu := parent.MTU
			if physical, exists := settingNamed(nextSettings, c.InterfaceName); exists {
				mtu = physical.MTU
				if !physical.Enabled && setting.Enabled {
					return j, errors.New("validation_failed")
				}
			}
			if setting.MTU > mtu {
				return j, errors.New("validation_failed")
			}
		}
	}
	for _, setting := range append(append([]InterfaceSetting{}, oldSettings...), nextSettings...) {
		if setting.InterfaceName == c.InterfaceName {
			names[interfaceNameFor(setting)] = true
		}
	}
	for name := range names {
		item, exists := findInspected(snapshot, name)
		if exists {
			if name != c.InterfaceName && !slices.ContainsFunc(links, func(l link) bool { return l.Name == name && l.Info.Kind == "vlan" && l.Group == e.group() }) {
				return j, errors.New("foreign_vlan_interface")
			}
			expected := []string{}
			for _, setting := range oldSettings {
				if interfaceNameFor(setting) == name && setting.Address != nil && setting.Enabled {
					expected = append(expected, *setting.Address)
				}
			}
			if ownedParent || name != c.InterfaceName {
				for _, address := range item.Addresses {
					if !slices.Contains(expected, address) {
						return j, errors.New("foreign_interface_address")
					}
				}
			}
			j.Before = append(j.Before, originalInterface(item))
		} else if name != c.InterfaceName {
			j.Created = append(j.Created, name)
		}
	}
	for _, setting := range c.Interfaces {
		prefix, _ := netip.ParsePrefix(*setting.Address)
		for _, target := range protectedTargets {
			ip, err := netip.ParseAddr(target)
			if err != nil || prefix.Contains(ip) {
				return j, errors.New("interface_route_overlap")
			}
		}
		for _, other := range snapshot.Interfaces {
			if names[other.Name] {
				continue
			}
			for _, address := range other.Addresses {
				p, err := netip.ParsePrefix(address)
				if err == nil && prefix.Overlaps(p) {
					return j, errors.New("interface_subnet_overlap")
				}
			}
		}
		for _, route := range snapshot.Routes {
			if route.Destination == "default" || names[route.Device] {
				continue
			}
			p, err := netip.ParsePrefix(route.Destination)
			if err != nil {
				if a, parseErr := netip.ParseAddr(route.Destination); parseErr == nil {
					p = netip.PrefixFrom(a, 32)
				} else {
					continue
				}
			}
			if prefix.Overlaps(p) {
				return j, errors.New("interface_route_overlap")
			}
		}
	}
	j.Next.Originals = slices.DeleteFunc(j.Next.Originals, func(original InterfaceOriginal) bool {
		return !slices.ContainsFunc(j.Next.Configurations, func(configuration InterfaceConfiguration) bool { return configuration.InterfaceName == original.Name })
	})
	return j, nil
}
func findInspected(snapshot Inspection, name string) (InspectedInterface, bool) {
	for _, s := range snapshot.Interfaces {
		if s.Name == name {
			return s, true
		}
	}
	return InspectedInterface{}, false
}
func originalInterface(s InspectedInterface) InterfaceOriginal {
	return InterfaceOriginal{Name: s.Name, Up: s.Up, MTU: s.MTU, Addresses: append([]string{}, s.Addresses...)}
}

func (e InterfaceEngine) Apply(ctx context.Context, j InterfaceJournal) error {
	base := e.runner()
	e.Run = func(ctx context.Context, name string, args []string, input string) ([]byte, error) {
		data, err := base(ctx, name, args, input)
		if err != nil {
			return nil, &InterfaceOperationError{Step: interfaceOperationStep(name, args)}
		}
		return data, nil
	}
	run := e.runner()
	c, _ := j.Request.Configuration()
	if err := e.isolate(ctx, append(interfaceSettings(j.Previous), interfaceSettings(j.Next)...)); err != nil {
		return err
	}
	snapshot, err := Inspect(ctx, run)
	if err != nil {
		return err
	}
	for _, s := range interfaceSettings(j.Next) {
		if s.InterfaceName != c.InterfaceName {
			continue
		}
		name := interfaceNameFor(s)
		if s.VLANID != nil {
			if _, found := findInspected(snapshot, name); !found {
				if _, err = run(ctx, "ip", []string{"link", "add", "link", s.InterfaceName, "name", name, "group", e.group(), "type", "vlan", "id", strconv.Itoa(*s.VLANID)}, ""); err != nil {
					return err
				}
			}
		}
		if _, err = run(ctx, "ip", []string{"link", "set", "dev", name, "mtu", strconv.Itoa(s.MTU)}, ""); err != nil {
			return err
		}
		if s.Enabled {
			if s.VLANID != nil {
				if _, err = run(ctx, "ip", []string{"link", "set", "dev", s.InterfaceName, "up"}, ""); err != nil {
					return err
				}
			}
			if _, err = run(ctx, "ip", []string{"address", "replace", *s.Address, "dev", name}, ""); err != nil {
				return err
			}
			if _, err = run(ctx, "ip", []string{"link", "set", "dev", name, "up"}, ""); err != nil {
				return err
			}
		} else {
			if _, err = run(ctx, "ip", []string{"link", "set", "dev", name, "down"}, ""); err != nil {
				return err
			}
		}
	}
	// Remove only exact old owned addresses and VLAN interfaces absent from the
	// candidate. Unrelated host routes/firewall rules are never flushed.
	next := interfaceSettings(j.Next)
	for _, old := range interfaceSettings(j.Previous) {
		if old.InterfaceName != c.InterfaceName {
			continue
		}
		name := interfaceNameFor(old)
		replacement, exists := settingNamed(next, name)
		if old.Address != nil && old.Enabled && (!exists || !replacement.Enabled || replacement.Address == nil || *replacement.Address != *old.Address) {
			if _, err = run(ctx, "ip", []string{"address", "del", *old.Address, "dev", name}, ""); err != nil {
				return err
			}
		}
		if !exists && old.VLANID != nil {
			if err = e.removeVLAN(ctx, name); err != nil {
				return err
			}
		}
	}
	// With no remaining scope, restore the parent's original state as well.
	if !slices.ContainsFunc(j.Next.Configurations, func(c2 InterfaceConfiguration) bool { return c2.InterfaceName == c.InterfaceName }) {
		for _, original := range j.Previous.Originals {
			if original.Name == c.InterfaceName {
				if err = e.restoreLink(ctx, original); err != nil {
					return err
				}
			}
		}
	}
	management := Engine{Run: run, ManagementIPs: e.Authorization.ControllerIPs}
	protected, err := management.protectedInterfaces(ctx, Plan{})
	if err != nil || protected[c.InterfaceName] {
		return &InterfaceOperationError{Step: "verify_management_route"}
	}
	return e.isolate(ctx, interfaceSettings(j.Next))
}
func settingNamed(settings []InterfaceSetting, name string) (InterfaceSetting, bool) {
	for _, s := range settings {
		if interfaceNameFor(s) == name {
			return s, true
		}
	}
	return InterfaceSetting{}, false
}
func (e InterfaceEngine) removeVLAN(ctx context.Context, name string) error {
	links, err := (Engine{Run: e.runner()}).links(ctx)
	if err != nil {
		return err
	}
	for _, l := range links {
		if l.Name == name {
			if l.Info.Kind != "vlan" || l.Group != e.group() {
				return errors.New("VLAN ownership changed")
			}
			_, err = e.runner()(ctx, "ip", []string{"link", "delete", "dev", name}, "")
			return err
		}
	}
	return nil
}
func (e InterfaceEngine) restoreLink(ctx context.Context, s InterfaceOriginal) error {
	run := e.runner()
	if _, err := run(ctx, "ip", []string{"link", "set", "dev", s.Name, "mtu", strconv.Itoa(s.MTU)}, ""); err != nil {
		return err
	}
	for _, a := range s.Addresses {
		if _, err := run(ctx, "ip", []string{"address", "replace", a, "dev", s.Name}, ""); err != nil {
			return err
		}
	}
	state := "down"
	if s.Up {
		state = "up"
	}
	_, err := run(ctx, "ip", []string{"link", "set", "dev", s.Name, state}, "")
	return err
}
func (e InterfaceEngine) Rollback(ctx context.Context, j InterfaceJournal) error {
	c, configErr := j.Request.Configuration()
	if configErr != nil {
		return configErr
	}
	if err := e.isolate(ctx, append(interfaceSettings(j.Previous), interfaceSettings(j.Next)...)); err != nil {
		return err
	}
	snapshot, err := Inspect(ctx, e.runner())
	if err != nil {
		return err
	}
	for _, s := range interfaceSettings(j.Next) {
		if s.InterfaceName != c.InterfaceName {
			continue
		}
		name := interfaceNameFor(s)
		item, exists := findInspected(snapshot, name)
		if !exists {
			continue
		}
		before, hadBefore := InterfaceOriginal{}, false
		for _, b := range j.Before {
			if b.Name == name {
				before = b
				hadBefore = true
				break
			}
		}
		if s.VLANID != nil && !hadBefore {
			if err = e.removeVLAN(ctx, name); err != nil {
				return err
			}
			continue
		}
		if s.Address != nil && slices.Contains(item.Addresses, *s.Address) && !slices.Contains(before.Addresses, *s.Address) {
			if _, err = e.runner()(ctx, "ip", []string{"address", "del", *s.Address, "dev", name}, ""); err != nil {
				return err
			}
		}
	}
	// An old owned VLAN can have been removed in the failed candidate.
	for _, s := range interfaceSettings(j.Previous) {
		if s.InterfaceName != c.InterfaceName {
			continue
		}
		name := interfaceNameFor(s)
		if s.VLANID != nil {
			if _, exists := findInspected(snapshot, name); !exists {
				if _, err = e.runner()(ctx, "ip", []string{"link", "add", "link", s.InterfaceName, "name", name, "group", e.group(), "type", "vlan", "id", strconv.Itoa(*s.VLANID)}, ""); err != nil {
					return err
				}
			}
		}
	}
	for _, s := range j.Before {
		if err = e.restoreLink(ctx, s); err != nil {
			return fmt.Errorf("interface restoration failed")
		}
	}
	return e.isolate(ctx, interfaceSettings(j.Previous))
}

func (e InterfaceEngine) isolate(ctx context.Context, settings []InterfaceSetting) error {
	names := []string{}
	for _, s := range settings {
		if !slices.Contains(names, interfaceNameFor(s)) {
			names = append(names, interfaceNameFor(s))
		}
	}
	slices.Sort(names)
	rules := ""
	if len(names) > 0 {
		quoted := []string{}
		for _, name := range names {
			quoted = append(quoted, strconv.Quote(name))
		}
		set := "{ " + strings.Join(quoted, ", ") + " }"
		rules = " iifname " + set + " drop;\n oifname " + set + " drop;\n"
	}
	group := (Engine{NodeID: e.NodeID}).group()
	return reconcileOwnedIsolation(ctx, e.runner(), "pmif"+group, "PacketMotion interfaces "+group, rules, len(names) == 0)
}
