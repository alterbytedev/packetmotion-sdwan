import { isIP } from 'node:net';
import { FabricError } from './authorization';

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FabricError(400, 'A JSON object is required.');
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new FabricError(400, 'Unknown inventory field.');
  return value as Record<string, unknown>;
}

function name(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 100 ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new FabricError(400, 'Name must contain 1–100 printable characters.');
  return value.trim();
}

export function nodeNameInput(value: unknown): string {
  const data = object(value, ['name']);
  return name(data.name);
}

export function nodeIdInput(value: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    throw new FabricError(404, 'Device not found.');
  return value;
}

export function ipv4Prefix(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new FabricError(400, 'LAN prefix must be IPv4 CIDR.');
  const [address, prefix, extra] = value.split('/');
  if (extra || isIP(address) !== 4 || !/^(?:[1-9]|[12][0-9]|3[0-2])$/.test(prefix))
    throw new FabricError(400, 'LAN prefix must be IPv4 CIDR with prefix length 1–32.');
  const octets = address.split('.').map(Number);
  const bits = Number(prefix);
  const integer = octets.reduce((sum, octet) => sum * 256 + octet, 0) >>> 0;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  if ((integer & mask) >>> 0 !== integer)
    throw new FabricError(400, 'LAN prefix must use its network address.');
  const end = integer + 2 ** (32 - bits) - 1;
  const forbidden = [
    [0, 0x00ffffff],
    [0x7f000000, 0x7fffffff],
    [0xa9fe0000, 0xa9feffff],
    [0xe0000000, 0xffffffff],
  ];
  if (forbidden.some(([start, last]) => integer <= last && end >= start))
    throw new FabricError(400, 'LAN prefix must contain routable unicast addresses.');
  return value;
}

export function siteInput(value: unknown) {
  const data = object(value, ['name', 'mode', 'lanPrefix']);
  if (data.mode !== 'gateway' && data.mode !== 'subnet-router')
    throw new FabricError(400, 'Choose gateway or subnet-router mode.');
  return { name: name(data.name), mode: data.mode, lanPrefix: ipv4Prefix(data.lanPrefix) };
}

export function nodeInput(value: unknown) {
  const data = object(value, ['name', 'siteId', 'kind', 'mode', 'lanPrefix']);
  if (data.kind !== 'hub' && data.kind !== 'branch')
    throw new FabricError(400, 'Choose edge or hub device type.');
  if (data.siteId !== undefined) {
    if (
      typeof data.siteId !== 'string' ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.siteId)
    )
      throw new FabricError(400, 'Choose a valid site.');
    if (data.mode !== undefined || data.lanPrefix !== undefined)
      throw new FabricError(400, 'Existing site and new network settings cannot be combined.');
    return { name: name(data.name), kind: data.kind, siteId: data.siteId, network: null };
  }
  return {
    name: name(data.name),
    kind: data.kind,
    siteId: null,
    network: siteInput({ name: data.name, mode: data.mode, lanPrefix: data.lanPrefix }),
  };
}
