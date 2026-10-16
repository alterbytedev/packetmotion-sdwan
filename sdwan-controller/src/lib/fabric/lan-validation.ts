import { isIP } from 'node:net';
import { FabricError } from './authorization';
import { ipv4Prefix } from './validation';
import { tunnelObject, tunnelVersion } from './wireguard-validation';

export function lanInput(value: unknown) {
  const input = tunnelObject(value, ['interfaceName', 'address', 'advertisedPrefix', 'expectedVersion']);
  if (typeof input.interfaceName !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,14}$/.test(input.interfaceName) ||
      input.interfaceName === 'lo' || input.interfaceName.startsWith('pm'))
    throw new FabricError(400, 'Choose a valid physical LAN interface, not loopback or a managed tunnel.');
  if (typeof input.address !== 'string') throw new FabricError(400, 'Supply the appliance IPv4 address and prefix length.');
  const [host, bits, extra] = input.address.split('/');
  if (extra || isIP(host) !== 4 || !/^(?:[89]|[12][0-9]|30)$/.test(bits))
    throw new FabricError(400, 'LAN address must be IPv4 with prefix length 8–30.');
  const first = Number(host.split('.')[0]);
  const second = Number(host.split('.')[1]);
  if (!(first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)))
    throw new FabricError(400, 'Use a private IPv4 LAN address.');
  const number = host.split('.').map(Number).reduce((sum, octet) => sum * 256 + octet, 0);
  const size = 2 ** (32 - Number(bits));
  const network = Math.floor(number / size) * size;
  if (number === network || number === network + size - 1)
    throw new FabricError(400, 'LAN address cannot be its network or broadcast address.');
  const base = [24, 16, 8, 0].map((shift) => (network >>> shift) & 255).join('.');
  const prefix = ipv4Prefix(input.advertisedPrefix);
  if (prefix !== `${base}/${bits}`)
    throw new FabricError(400, 'Advertised prefix must exactly match the configured LAN subnet.');
  return { interfaceName: input.interfaceName, address: input.address, advertisedPrefix: prefix,
    expectedVersion: tunnelVersion(input.expectedVersion) };
}

export function protectedNetworksInput(value: unknown) {
  const input = tunnelObject(value, ['protectedPrefixes', 'expectedVersion']);
  if (!Array.isArray(input.protectedPrefixes) || input.protectedPrefixes.length < 1 || input.protectedPrefixes.length > 32)
    throw new FabricError(400, 'Supply 1–32 protected management or underlay IPv4 networks.');
  const prefixes = input.protectedPrefixes.map((value) => {
    const prefix = ipv4Prefix(value);
    if (!prefix) throw new FabricError(400, 'Protected network must be canonical IPv4 CIDR.');
    return prefix;
  });
  if (new Set(prefixes).size !== prefixes.length) throw new FabricError(400, 'Protected networks must be distinct.');
  return { protectedPrefixes: prefixes.sort(), expectedVersion: tunnelVersion(input.expectedVersion) };
}
