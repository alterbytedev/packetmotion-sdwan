import { isIP } from 'node:net';
import { FabricError } from './authorization';
import { lanInput } from './lan-validation';
import type { InterfaceIntent } from './network-types';
import { ipv4Prefix } from './validation';
import { tunnelObject, tunnelVersion } from './wireguard-validation';

function ipv4Number(address: string) {
  return address
    .split('.')
    .map(Number)
    .reduce((sum, octet) => sum * 256 + octet, 0);
}

export function interfaceSubnet(address: string) {
  const [host, bits, extra] = address.split('/');
  if (extra || isIP(host) !== 4 || !/^(?:[1-9]|[12][0-9]|30)$/.test(bits))
    throw new FabricError(400, 'Interface address must be IPv4 with prefix length 1–30.');
  const size = 2 ** (32 - Number(bits));
  const integer = ipv4Number(host);
  const network = Math.floor(integer / size) * size;
  if (integer === network || integer === network + size - 1)
    throw new FabricError(400, 'Interface address cannot be its network or broadcast address.');
  const base = [24, 16, 8, 0].map((shift) => (network >>> shift) & 255).join('.');
  return ipv4Prefix(`${base}/${bits}`) as string;
}

export function networkDraftInput(value: unknown) {
  const input = tunnelObject(value, [
    'expectedVersion',
    'baseRevision',
    'baseLanVersion',
    'interfaces',
    'safeCommitSeconds',
  ]);
  const expectedVersion = tunnelVersion(input.expectedVersion);
  const baseRevision = tunnelVersion(input.baseRevision);
  const baseLanVersion = tunnelVersion(input.baseLanVersion);
  if (input.safeCommitSeconds !== 60)
    throw new FabricError(
      400,
      'Network changes require safe commit with a 60-second confirmation window.',
    );
  if (!Array.isArray(input.interfaces) || input.interfaces.length > 16)
    throw new FabricError(400, 'Supply at most 16 interface settings.');
  const keys = new Set<string>();
  let wanCount = 0;
  const interfaces: InterfaceIntent[] = input.interfaces.map((value) => {
    const entry = tunnelObject(value, [
      'interfaceName',
      'vlanId',
      'role',
      'mode',
      'address',
      'gateway',
      'advertisedPrefix',
      'enabled',
      'mtu',
    ]);
    if (
      typeof entry.interfaceName !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,14}$/.test(entry.interfaceName) ||
      entry.interfaceName === 'lo' ||
      entry.interfaceName.startsWith('pm')
    )
      throw new FabricError(
        400,
        'Choose a physical Ethernet parent, not a tunnel, loopback or VLAN interface name.',
      );
    if (
      entry.vlanId !== null &&
      (!Number.isInteger(entry.vlanId) || Number(entry.vlanId) < 1 || Number(entry.vlanId) > 4094)
    )
      throw new FabricError(400, 'VLAN tag must be 1–4094, or null for a physical interface.');
    const key = `${entry.interfaceName}:${entry.vlanId}`;
    if (keys.has(key))
      throw new FabricError(400, 'Duplicate physical interface or parent/VLAN tag.');
    keys.add(key);
    if (
      (entry.role !== 'wan' && entry.role !== 'lan') ||
      (entry.mode !== 'static' && entry.mode !== 'dhcp') ||
      typeof entry.enabled !== 'boolean' ||
      !Number.isInteger(entry.mtu) ||
      Number(entry.mtu) < 576 ||
      Number(entry.mtu) > 9000
    )
      throw new FabricError(
        400,
        'Choose a valid role, addressing mode, enabled state and MTU (576–9000).',
      );
    if (entry.role === 'wan' && entry.enabled && ++wanCount > 1)
      throw new FabricError(400, 'Only one enabled WAN is supported in this draft.');
    if (entry.mode === 'dhcp') {
      if (
        entry.role !== 'wan' ||
        entry.address !== null ||
        entry.gateway !== null ||
        entry.advertisedPrefix !== null
      )
        throw new FabricError(
          400,
          'DHCP client is WAN-only and cannot contain static addressing or an advertisement.',
        );
    } else {
      if (typeof entry.address !== 'string')
        throw new FabricError(400, 'Supply a static IPv4 interface address.');
      const prefix = interfaceSubnet(entry.address);
      if (entry.role === 'lan') {
        lanInput({
          interfaceName: entry.interfaceName,
          address: entry.address,
          advertisedPrefix: prefix,
          expectedVersion: 0,
        });
        if (
          entry.gateway !== null ||
          (entry.advertisedPrefix !== null && entry.advertisedPrefix !== prefix)
        )
          throw new FabricError(
            400,
            'A LAN has no upstream gateway; its advertisement must exactly match its subnet.',
          );
      } else {
        if (
          entry.advertisedPrefix !== null ||
          typeof entry.gateway !== 'string' ||
          isIP(entry.gateway) !== 4
        )
          throw new FabricError(
            400,
            'Static WAN requires an IPv4 gateway and cannot advertise its transport subnet.',
          );
        const [base, bits] = prefix.split('/');
        const start = ipv4Number(base);
        const gateway = ipv4Number(entry.gateway);
        if (
          gateway <= start ||
          gateway >= start + 2 ** (32 - Number(bits)) - 1 ||
          entry.gateway === entry.address.split('/')[0]
        )
          throw new FabricError(
            400,
            'WAN gateway must be a different usable address in the interface subnet.',
          );
      }
    }
    return entry as InterfaceIntent;
  });
  for (let index = 0; index < interfaces.length; index++) {
    const current = interfaces[index];
    if (current.address) {
      const [base, bits] = interfaceSubnet(current.address).split('/');
      const start = ipv4Number(base);
      const end = start + 2 ** (32 - Number(bits)) - 1;
      for (const other of interfaces.slice(0, index)) {
        if (!other.address) continue;
        const [otherBase, otherBits] = interfaceSubnet(other.address).split('/');
        const otherStart = ipv4Number(otherBase);
        if (start <= otherStart + 2 ** (32 - Number(otherBits)) - 1 && end >= otherStart)
          throw new FabricError(400, 'Interface subnets must not overlap.');
      }
    }
    const parent = interfaces.find(
      (entry) => entry.interfaceName === current.interfaceName && entry.vlanId === null,
    );
    if (
      current.vlanId !== null &&
      parent &&
      ((!parent.enabled && current.enabled) || current.mtu > parent.mtu)
    )
      throw new FabricError(
        400,
        'Enabled VLANs require an enabled parent and cannot exceed its MTU.',
      );
  }
  interfaces.sort(
    (a, b) => a.interfaceName.localeCompare(b.interfaceName) || (a.vlanId ?? 0) - (b.vlanId ?? 0),
  );
  return {
    expectedVersion,
    baseRevision,
    baseLanVersion,
    interfaces,
    safeCommitSeconds: 60 as const,
  };
}
