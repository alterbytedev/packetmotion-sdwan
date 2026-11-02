// Package network owns PacketMotion tunnel interfaces and locally authorized LAN
// addresses and BGP configuration. It preserves unrelated routes and configuration.
// An owned nftables guard blocks tunnel transit until explicit policy is supported.
package network

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"packetmotion/fabric-agent/internal/identity"
)

type Tunnel struct {
	AllowedPrefixes []string `json:"allowedPrefixes,omitempty"`
	Name            string   `json:"name"`
	Address         string   `json:"address"`
	PeerAddress     string   `json:"peerAddress"`
	PublicKey       string   `json:"publicKey"`
	Endpoint        *string  `json:"endpoint"`
	ListenPort      int      `json:"listenPort"`
	Keepalive       int      `json:"keepalive"`
}
type Plan struct {
	Tunnels []Tunnel `json:"tunnels"`
	Routing *Routing `json:"routing,omitempty"`
}
type Handshake struct {
	Name          string `json:"name"`
	LastHandshake int64  `json:"lastHandshake"`
}
type Runner func(context.Context, string, []string, string) ([]byte, error)
type Engine struct {
	Directory     string
	NodeID        string
	Run           Runner
	AllowRouting  bool
	AllowTransit  bool
	LANInterface  string
	ManagementIPs []string
}
type link struct {
	Name  string   `json:"ifname"`
	Alias string   `json:"ifalias"`
	Group string   `json:"group"`
	Flags []string `json:"flags"`
	Info  struct {
		Kind string `json:"info_kind"`
	} `json:"linkinfo"`
}

var ErrReconcileBusy = errors.New("network reconciliation already running")

var interfaceName = regexp.MustCompile(`^pm[0-9a-f]{12}$`)

// Bound command output while reading, not after allocating a potentially large buffer.
type boundedOutput struct{ bytes.Buffer }

func (b *boundedOutput) Write(data []byte) (int, error) {
	if b.Len()+len(data) > 1024*1024 {
		return 0, errors.New("network response too large")
	}
	return b.Buffer.Write(data)
}

// Command never returns command output on failure: wg inputs contain private keys.
func Command(ctx context.Context, name string, args []string, input string) ([]byte, error) {
	binary := map[string]string{"ip": "/usr/sbin/ip", "wg": "/usr/bin/wg", "nft": "/usr/sbin/nft", "vtysh": "/usr/bin/vtysh"}[name]
	if binary == "" {
		return nil, errors.New("unsupported network operation")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Stdin = strings.NewReader(input)
	var output boundedOutput
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%s operation failed", name)
	}
	if output.Len() > 1024*1024 {
		return nil, errors.New("network response too large")
	}
	return output.Bytes(), nil
}

func Key(directory string) (string, string, error) {
	path := filepath.Join(directory, "wireguard.key")
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		key, createErr := ecdh.X25519().GenerateKey(rand.Reader)
		if createErr != nil {
			return "", "", createErr
		}
		// WireGuard stores the clamped scalar, while crypto/ecdh clamps at use time.
		raw := key.Bytes()
		raw[0] &= 248
		raw[31] = (raw[31] & 127) | 64
		data = []byte(base64.StdEncoding.EncodeToString(raw))
		if err = identity.WritePrivate(directory, "wireguard.key", data); err != nil {
			return "", "", err
		}
	} else if err != nil {
		return "", "", errors.New("WireGuard key unavailable")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		return "", "", errors.New("WireGuard key must be a private regular file")
	}
	raw, err := base64.StdEncoding.DecodeString(string(data))
	if err != nil || len(raw) != 32 {
		return "", "", errors.New("invalid stored WireGuard key")
	}
	key, err := ecdh.X25519().NewPrivateKey(raw)
	if err != nil {
		return "", "", errors.New("invalid stored WireGuard key")
	}
	return string(data), base64.StdEncoding.EncodeToString(key.PublicKey().Bytes()), nil
}

func Validate(plan Plan) error {
	if plan.Routing != nil {
		if err := validateRouting(*plan.Routing); err != nil {
			return err
		}
		lan, _ := netip.ParsePrefix(plan.Routing.LAN.AdvertisedPrefix)
		for _, tunnel := range plan.Tunnels {
			prefix, err := netip.ParsePrefix(tunnel.Address)
			if err == nil && prefix.Overlaps(lan) {
				return errors.New("LAN overlaps tunnel")
			}
		}
	}
	if err := validateBGP(plan); err != nil {
		return err
	}
	if plan.Routing != nil {
		if err := validateTransit(*plan.Routing); err != nil {
			return err
		}
	}
	for _, tunnel := range plan.Tunnels {
		if len(tunnel.AllowedPrefixes) > 0 && (plan.Routing == nil || plan.Routing.BGP == nil) {
			return errors.New("LAN WireGuard prefixes require an approved BGP plan")
		}
	}
	if len(plan.Tunnels) > 128 {
		return errors.New("too many tunnels")
	}
	names := map[string]bool{}
	networks := map[netip.Prefix]bool{}
	ports := map[int]bool{}
	for _, t := range plan.Tunnels {
		prefix, err := netip.ParsePrefix(t.Address)
		peer, peerErr := netip.ParseAddr(t.PeerAddress)
		key, keyErr := base64.StdEncoding.DecodeString(t.PublicKey)
		if !interfaceName.MatchString(t.Name) || names[t.Name] || err != nil || !prefix.Addr().Is4() || !prefix.Addr().IsPrivate() || prefix.Bits() != 31 || networks[prefix.Masked()] || peerErr != nil || !peer.Is4() || !prefix.Contains(peer) || peer == prefix.Addr() || keyErr != nil || len(key) != 32 || bytes.Equal(key, make([]byte, 32)) || base64.StdEncoding.EncodeToString(key) != t.PublicKey {
			return errors.New("invalid WireGuard adjacency")
		}
		names[t.Name] = true
		networks[prefix.Masked()] = true
		if t.Endpoint != nil {
			endpoint, err := netip.ParseAddrPort(*t.Endpoint)
			if err != nil || !endpoint.Addr().Is4() || endpoint.Addr().IsLoopback() || endpoint.Addr().IsUnspecified() || endpoint.Addr().IsMulticast() || endpoint.Port() < 1024 || t.ListenPort != 0 || t.Keepalive != 25 {
				return errors.New("invalid Edge endpoint")
			}
		} else if t.ListenPort < 1024 || t.ListenPort > 65535 || t.Keepalive != 0 || ports[t.ListenPort] {
			return errors.New("invalid Hub listen port")
		}
		if t.ListenPort > 0 {
			ports[t.ListenPort] = true
		}
	}
	for _, t := range plan.Tunnels {
		if t.Endpoint != nil {
			ep, _ := netip.ParseAddrPort(*t.Endpoint)
			for prefix := range networks {
				if prefix.Contains(ep.Addr()) {
					return errors.New("endpoint overlaps overlay")
				}
			}
		}
	}
	return nil
}

func (e Engine) links(ctx context.Context) ([]link, error) {
	data, err := e.Run(ctx, "ip", []string{"-j", "-details", "link", "show"}, "")
	if err != nil {
		return nil, err
	}
	var result []link
	if json.Unmarshal(data, &result) != nil {
		return nil, errors.New("invalid interface inventory")
	}
	return result, nil
}
func (e Engine) owner() string { return "packetmotion:" + e.NodeID }

// iproute2 preserves group at link creation, whereas this version does not
// preserve alias there. The group marks ownership before any later operation.
func (e Engine) group() string {
	sum := sha256.Sum256([]byte(e.NodeID))
	return strconv.FormatUint(uint64(binary.BigEndian.Uint32(sum[:4])&0x3fffffff|0x40000000), 10)
}
func (e Engine) owns(l link) bool {
	return l.Group == e.group() && interfaceName.MatchString(l.Name) && l.Info.Kind == "wireguard"
}

// CheckActivation performs existing read-only validation before a local service opt-in.
func (e Engine) CheckActivation(ctx context.Context, plan Plan) error {
	if e.Run == nil {
		e.Run = Command
	}
	return e.preflight(ctx, plan)
}

// Preflight rejects collisions with host routes and foreign interfaces. Only routes
// created by our own interfaces are excluded from overlap checks.
func (e Engine) preflight(ctx context.Context, plan Plan) error {
	if err := Validate(plan); err != nil {
		return err
	}
	links, err := e.links(ctx)
	if err != nil {
		return err
	}
	if err := e.validateManagement(ctx, plan, links); err != nil {
		return err
	}
	owned := map[string]bool{}
	for _, l := range links {
		if e.owns(l) {
			owned[l.Name] = true
		}
		for _, t := range plan.Tunnels {
			if l.Name == t.Name && !owned[l.Name] {
				return errors.New("interface name is already owned")
			}
		}
	}
	data, err := e.Run(ctx, "ip", []string{"-j", "route", "show", "table", "all"}, "")
	if err != nil {
		return err
	}
	var routes []struct {
		Destination string `json:"dst"`
		Device      string `json:"dev"`
	}
	if json.Unmarshal(data, &routes) != nil {
		return errors.New("invalid route inventory")
	}
	for _, r := range routes {
		if owned[r.Device] || r.Destination == "default" || r.Destination == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(r.Destination)
		if err != nil {
			if addr, parseErr := netip.ParseAddr(r.Destination); parseErr == nil {
				prefix = netip.PrefixFrom(addr, addr.BitLen())
			} else {
				continue
			}
		}
		if prefix.Bits() == 0 {
			continue
		}
		for _, t := range plan.Tunnels {
			target, _ := netip.ParsePrefix(t.Address)
			if prefix.Overlaps(target) {
				return errors.New("tunnel overlaps an existing host route")
			}
		}
	}
	if err := e.preflightLAN(ctx, plan); err != nil {
		return err
	}
	return e.preflightBGP(ctx, plan)
}

func readPlan(directory, name string) (Plan, error) {
	var plan Plan
	data, err := os.ReadFile(filepath.Join(directory, name))
	if errors.Is(err, fs.ErrNotExist) {
		return Plan{Tunnels: []Tunnel{}}, nil
	}
	if err != nil {
		return plan, err
	}
	if json.Unmarshal(data, &plan) != nil {
		return plan, errors.New("invalid local network journal")
	}
	return plan, Validate(plan)
}
func writePlan(directory, name string, plan Plan) error {
	data, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	return identity.WritePrivate(directory, name, data)
}
func (e Engine) replace(ctx context.Context, plan Plan, key string) error {
	if len(plan.Tunnels) > 0 || plan.Routing != nil {
		if err := e.ensureIsolation(ctx, plan); err != nil {
			return err
		}
	}
	if err := e.withdrawBGP(ctx); err != nil {
		return err
	}
	if plan.Routing != nil || e.hasLANRecords() {
		if err := e.reconcileLAN(ctx, plan.Routing); err != nil {
			return err
		}
	}
	links, err := e.links(ctx)
	if err != nil {
		return err
	}
	// Every mutation is restricted by both our interface name and ownership group.
	for _, l := range links {
		if l.Group == e.group() && interfaceName.MatchString(l.Name) {
			if l.Info.Kind != "wireguard" {
				return errors.New("owned interface has unexpected type")
			}
			if _, err = e.Run(ctx, "ip", []string{"link", "delete", "dev", l.Name}, ""); err != nil {
				return err
			}
		}
	}
	for _, t := range plan.Tunnels {
		if _, err = e.Run(ctx, "ip", []string{"link", "add", "name", t.Name, "group", e.group(), "type", "wireguard"}, ""); err != nil {
			return err
		}
		if _, err = e.Run(ctx, "ip", []string{"link", "set", "dev", t.Name, "alias", e.owner()}, ""); err != nil {
			return err
		}
		allowed := append([]string{t.PeerAddress + "/32"}, t.AllowedPrefixes...)
		config := fmt.Sprintf("[Interface]\nPrivateKey = %s\nListenPort = %d\n[Peer]\nPublicKey = %s\nAllowedIPs = %s\nPersistentKeepalive = %d\n", key, t.ListenPort, t.PublicKey, strings.Join(allowed, ","), t.Keepalive)
		if t.Endpoint != nil {
			config += "Endpoint = " + *t.Endpoint + "\n"
		}
		if _, err = e.Run(ctx, "wg", []string{"syncconf", t.Name, "/dev/stdin"}, config); err != nil {
			return err
		}
		if _, err = e.Run(ctx, "ip", []string{"address", "add", t.Address, "dev", t.Name}, ""); err != nil {
			return err
		}
		if _, err = e.Run(ctx, "ip", []string{"link", "set", "dev", t.Name, "mtu", "1380", "up"}, ""); err != nil {
			return err
		}
	}
	if err := e.applyBGP(ctx, plan); err != nil {
		return err
	}
	present, err := e.bgpPresent(ctx, plan)
	if err != nil {
		return err
	}
	if !present {
		return errors.New("BGP configuration verification failed")
	}
	return nil
}

// Apply uses a process lock and a durable previous-plan journal. A failed apply
// restores that plan; an interrupted apply is recovered before accepting a new one.
// confirm verifies management access before committing a new local plan.
func (e Engine) Apply(ctx context.Context, plan Plan, confirm func(context.Context) error) error {
	return e.withLock(func(engine Engine) error { return engine.applyLocked(ctx, plan, confirm) })
}
func (e Engine) withLock(operation func(Engine) error) error {
	if e.Run == nil {
		e.Run = Command
	}
	lock, err := os.OpenFile(filepath.Join(e.Directory, "network.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return ErrReconcileBusy
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	return operation(e)
}
func (e Engine) applyLocked(ctx context.Context, plan Plan, confirm func(context.Context) error) error {
	key, publicKey, err := Key(e.Directory)
	if err != nil {
		return err
	}
	if _, err = os.Stat(filepath.Join(e.Directory, "network-pending.json")); err == nil {
		previous, readErr := readPlan(e.Directory, "network-pending.json")
		if readErr != nil {
			return readErr
		}
		if err = e.preflight(ctx, previous); err != nil {
			return err
		}
		if err = e.replace(ctx, previous, key); err != nil {
			return errors.New("interrupted network apply recovery failed")
		}
		if err = writePlan(e.Directory, "network-applied.json", previous); err != nil {
			return err
		}
		if err = e.clearPending(); err != nil {
			return err
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	for _, tunnel := range plan.Tunnels {
		if tunnel.PublicKey == publicKey {
			return errors.New("peer key equals local key")
		}
	}
	if err = e.preflight(ctx, plan); err != nil {
		return err
	}
	previous, err := readPlan(e.Directory, "network-applied.json")
	if err != nil {
		return err
	}
	before, _ := json.Marshal(previous)
	after, _ := json.Marshal(plan)
	links, err := e.links(ctx)
	if err != nil {
		return err
	}
	ownedCount := 0
	for _, l := range links {
		if l.Group == e.group() && interfaceName.MatchString(l.Name) {
			ownedCount++
		}
	}
	present := ownedCount == len(plan.Tunnels)
	for _, t := range plan.Tunnels {
		if !slices.ContainsFunc(links, func(l link) bool { return l.Name == t.Name && e.owns(l) }) {
			present = false
		}
	}
	lanPresent, err := e.lanPresent(ctx, plan.Routing)
	if err != nil {
		return err
	}
	bgpPresent, err := e.bgpPresent(ctx, plan)
	if err != nil {
		return err
	}
	if bytes.Equal(before, after) && present && lanPresent && bgpPresent {
		if len(plan.Tunnels) > 0 || plan.Routing != nil {
			return e.ensureIsolation(ctx, plan)
		}
		return nil
	}
	if err = writePlan(e.Directory, "network-pending.json", previous); err != nil {
		return err
	}
	applyCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	err = e.replace(applyCtx, plan, key)
	if err == nil {
		err = e.validateManagement(applyCtx, plan, nil)
	}
	if err == nil && confirm != nil {
		err = confirm(applyCtx)
	}
	if err == nil {
		err = writePlan(e.Directory, "network-applied.json", plan)
	}
	if err != nil {
		recoveryCtx, stop := context.WithTimeout(context.Background(), 90*time.Second)
		defer stop()
		if restoreErr := e.replace(recoveryCtx, previous, key); restoreErr != nil {
			return errors.New("network apply and rollback failed; local recovery required")
		}
		if restoreErr := writePlan(e.Directory, "network-applied.json", previous); restoreErr != nil {
			return errors.New("rollback persistence failed")
		}
		if removeErr := e.clearPending(); removeErr != nil {
			return removeErr
		}
		return errors.New("network apply failed; previous plan restored")
	}
	return e.clearPending()
}

func (e Engine) Handshakes(ctx context.Context, plan Plan) ([]Handshake, error) {
	if e.Run == nil {
		e.Run = Command
	}
	result := make([]Handshake, 0, len(plan.Tunnels))
	for _, t := range plan.Tunnels {
		data, err := e.Run(ctx, "wg", []string{"show", t.Name, "latest-handshakes"}, "")
		if err != nil {
			return nil, err
		}
		fields := strings.Fields(string(data))
		if len(fields) != 2 || fields[0] != t.PublicKey {
			return nil, errors.New("unexpected WireGuard peer")
		}
		stamp, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil || stamp < 0 {
			return nil, errors.New("invalid WireGuard handshake")
		}
		result = append(result, Handshake{Name: t.Name, LastHandshake: stamp})
	}
	return result, nil
}

// Restore recovers local forwarding before any controller request on startup.
func (e Engine) Restore(ctx context.Context) error {
	return e.withLock(func(engine Engine) error {
		name := "network-applied.json"
		if _, err := os.Stat(filepath.Join(e.Directory, "network-pending.json")); err == nil {
			name = "network-pending.json"
		} else if !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		plan, err := readPlan(e.Directory, name)
		if err != nil {
			return err
		}
		return engine.applyLocked(ctx, plan, nil)
	})
}

func (e Engine) clearPending() error {
	if err := os.Remove(filepath.Join(e.Directory, "network-pending.json")); err != nil {
		return err
	}
	directory, err := os.Open(e.Directory)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
