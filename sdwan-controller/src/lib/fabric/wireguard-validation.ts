import { isIP } from 'node:net';
import { FabricError } from './authorization';
import { ipv4Prefix } from './validation';

export function tunnelObject(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !fields.includes(key)))
    throw new FabricError(400, 'Invalid WireGuard settings.');
  return value as Record<string, unknown>;
}

export function tunnelPool(value: unknown): string {
  const prefix = ipv4Prefix(value);
  if (!prefix) throw new FabricError(400, 'A private IPv4 tunnel pool is required.');
  const [address, length] = prefix.split('/');
  const [first, second] = address.split('.').map(Number);
  const privateAddress = first === 10 || (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
  if (!privateAddress || Number(length) < 16 || Number(length) > 30)
    throw new FabricError(400, 'Use a private IPv4 pool with prefix length 16–30.');
  return prefix;
}

export function tunnelVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new FabricError(400, 'Supply the current settings version.');
  return Number(value);
}

export function hubEndpoint(value: unknown): string {
  if (typeof value !== 'string' || isIP(value) !== 4)
    throw new FabricError(400, 'Hub endpoint must be a reachable IPv4 address.');
  const first = Number(value.split('.')[0]);
  if (first === 0 || first === 127 || first >= 224 || value.startsWith('169.254.'))
    throw new FabricError(400, 'Hub endpoint must be a unicast underlay address.');
  return value;
}

export function wireguardPublicKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value) ||
      Buffer.from(value, 'base64').length !== 32 ||
      Buffer.from(value, 'base64').toString('base64') !== value ||
      Buffer.from(value, 'base64').every((byte) => byte === 0))
    throw new FabricError(400, 'Invalid WireGuard public key.');
  return value;
}
