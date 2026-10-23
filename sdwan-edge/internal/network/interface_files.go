package network

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"syscall"

	"packetmotion/fabric-agent/internal/identity"
)

func jsonNumber(value int) string { return strconv.Itoa(value) }
func decodeInterfaceJSON(data []byte, value any) error {
	data = bytes.TrimSpace(data)
	if len(data) < 2 || data[0] != '{' || data[len(data)-1] != '}' {
		return errors.New("invalid interface state object")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return errors.New("invalid interface state")
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("invalid trailing interface state")
	}
	return nil
}
func ReadInterfaceFile(directory, name string, value any) error {
	f, err := os.OpenFile(filepath.Join(directory, name), os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 32768 {
		return errors.New("invalid interface state file")
	}
	data, err := io.ReadAll(io.LimitReader(f, 32769))
	if err != nil || len(data) > 32768 {
		return errors.New("interface state unavailable")
	}
	return decodeInterfaceJSON(data, value)
}
func WriteInterfaceFile(directory, name string, value any) error {
	data, err := json.Marshal(value)
	if err != nil || len(data) > 32768 {
		return errors.New("interface state too large")
	}
	return identity.WritePrivate(directory, name, data)
}
func ReadInterfaceAuthorization(path string) (InterfaceAuthorization, error) {
	var p InterfaceAuthorization
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 || info.Sys().(*syscall.Stat_t).Uid != 0 {
		return p, errors.New("interface policy must be a root-owned regular file without group/world write permission")
	}
	if err = ReadInterfaceFile(filepath.Dir(path), filepath.Base(path), &p); err != nil {
		return p, err
	}
	if !uuidPattern.MatchString(p.NodeID) || len(p.Interfaces) < 1 || len(p.Interfaces) > 16 || len(p.ControllerIPs) < 1 || len(p.ControllerIPs) > 16 {
		return p, errors.New("invalid local interface authorization")
	}
	if p.AllowVirtualLab {
		for _, kind := range []string{"net", "mnt"} {
			own, ownErr := os.Readlink("/proc/self/ns/" + kind)
			host, hostErr := os.Readlink("/proc/1/ns/" + kind)
			if ownErr != nil || hostErr != nil || own == host {
				return p, errors.New("virtual interface authorization requires isolated namespaces")
			}
		}
	}
	for _, name := range p.Interfaces {
		if !physicalPattern.MatchString(name) || name == "lo" || len(name) >= 2 && name[:2] == "pm" {
			return p, errors.New("invalid authorized interface")
		}
	}
	for _, address := range p.ControllerIPs {
		if _, err := netip.ParseAddr(address); err != nil {
			return p, errors.New("invalid authorized controller address")
		}
	}
	return p, nil
}
