package network

import (
	"bytes"
	"net/netip"
	"slices"
	"sort"
	"text/template"
)

// bgpFRRCommands is the readable source for the PacketMotion-owned FRR
// configuration. Go prepares values from validated typed intent, then executes
// this template to create the private vtysh candidate.
const bgpFRRCommands = `ip prefix-list {{.OwnerFilter}} seq 5 deny 0.0.0.0/0 le 32
{{range .Peers}}ip prefix-list {{.FilterName}}_IN seq 5 permit {{.ImportPrefix}}
ip prefix-list {{.FilterName}}_IN seq 10 deny 0.0.0.0/0 le 32
ip prefix-list {{.FilterName}}_OUT seq 5 permit {{.ExportPrefix}}
ip prefix-list {{.FilterName}}_OUT seq 10 deny 0.0.0.0/0 le 32
route-map {{.FilterName}}_IN permit 10
 match ip address prefix-list {{.FilterName}}_IN
 set local-preference {{.LocalPreference}}
exit
route-map {{.FilterName}}_IN deny 100
exit
{{end}}router bgp {{.LocalASN}}
 bgp router-id {{.RouterID}}
 no bgp default ipv4-unicast
 bgp ebgp-requires-policy
 bgp network import-check
{{range .Peers}} neighbor {{.Address}} remote-as {{.RemoteASN}}
 neighbor {{.Address}} update-source {{.UpdateSource}}
 neighbor {{.Address}} timers 3 9
{{end}} address-family ipv4 unicast
  network {{.AdvertisedPrefix}}
  maximum-paths 1
{{range .Peers}}  neighbor {{.Address}} activate
  neighbor {{.Address}} route-map {{.FilterName}}_IN in
  neighbor {{.Address}} prefix-list {{.FilterName}}_OUT out
  neighbor {{.Address}} maximum-prefix 1
{{end}} exit-address-family
exit
`

var bgpFRRTemplate = template.Must(template.New("packetmotion-bgp").Parse(bgpFRRCommands))

// bgpFRRRemovalCommands keeps cleanup operations reviewable alongside the
// generated configuration. The converter supplies only names found in the
// running config and accepted by the ownership checks in bgp.go.
const bgpFRRRemovalCommands = `{{if .RouterASN}}no router bgp {{.RouterASN}}
{{end}}{{range .Objects}}{{if .PrefixList}}no ip prefix-list {{.PrefixList}}{{else}}no route-map {{.RouteMap}}{{end}}
{{end}}`

var bgpFRRRemovalTemplate = template.Must(template.New("packetmotion-bgp-removal").Parse(bgpFRRRemovalCommands))

type bgpFRRRemovalData struct {
	RouterASN int
	Objects   []bgpFRRRemovalObject
}

type bgpFRRRemovalObject struct {
	PrefixList string
	RouteMap   string
}

func renderBGPRemoval(data bgpFRRRemovalData) string {
	var output bytes.Buffer
	if err := bgpFRRRemovalTemplate.Execute(&output, data); err != nil {
		panic("render static BGP FRR removal template: " + err.Error())
	}
	return output.String()
}

type bgpFRRTemplateData struct {
	OwnerFilter      string
	LocalASN         int
	RouterID         string
	AdvertisedPrefix string
	Peers            []bgpFRRTemplatePeer
}

type bgpFRRTemplatePeer struct {
	FilterName      string
	Address         string
	RemoteASN       int
	UpdateSource    netip.Addr
	ImportPrefix    string
	ExportPrefix    string
	LocalPreference int
}

// renderBGP converts validated typed intent into the FRR command template
// above. It sorts a copy so output is stable without changing serialized intent.
func (e Engine) renderBGP(plan Plan) string {
	bgp := plan.Routing.BGP
	peers := slices.Clone(bgp.Peers)
	sort.Slice(peers, func(i, j int) bool {
		if peers[i].InterfaceName != peers[j].InterfaceName {
			return peers[i].InterfaceName < peers[j].InterfaceName
		}
		return peers[i].Address < peers[j].Address
	})

	data := bgpFRRTemplateData{
		OwnerFilter:      e.bgpPrefix() + "OWNER",
		LocalASN:         bgp.LocalASN,
		RouterID:         bgp.RouterID,
		AdvertisedPrefix: plan.Routing.LAN.AdvertisedPrefix,
		Peers:            make([]bgpFRRTemplatePeer, 0, len(peers)),
	}
	for _, peer := range peers {
		tunnelIndex := slices.IndexFunc(plan.Tunnels, func(t Tunnel) bool { return t.Name == peer.InterfaceName })
		address, _ := netip.ParsePrefix(plan.Tunnels[tunnelIndex].Address)
		data.Peers = append(data.Peers, bgpFRRTemplatePeer{
			FilterName:      e.bgpPrefix() + peer.InterfaceName,
			Address:         peer.Address,
			RemoteASN:       peer.RemoteASN,
			UpdateSource:    address.Addr(),
			ImportPrefix:    peer.ImportPrefixes[0],
			ExportPrefix:    peer.ExportPrefixes[0],
			LocalPreference: peer.LocalPreference,
		})
	}

	var output bytes.Buffer
	if err := bgpFRRTemplate.Execute(&output, data); err != nil {
		// The template is static and parsed at startup; execution cannot fail for
		// this data-only template unless the template itself is changed incorrectly.
		panic("render static BGP FRR template: " + err.Error())
	}
	return output.String()
}
