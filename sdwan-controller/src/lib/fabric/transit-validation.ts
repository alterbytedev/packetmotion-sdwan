import { FabricError } from './authorization';
import { ipv4Prefix } from './validation';
import { tunnelObject, tunnelVersion } from './wireguard-validation';

export const transitProtocols = ['any', 'tcp', 'udp', 'icmp'] as const;
export const maxTransitRules = 64;
export type TransitRule = { id: string; source: string; destination: string; protocol: (typeof transitProtocols)[number] };

// Rule IDs are assigned from list order so operators never supply identifiers.
export function transitRulesInput(value: unknown) {
  const input = tunnelObject(value, ['rules', 'expectedVersion']);
  if (!Array.isArray(input.rules) || input.rules.length > maxTransitRules)
    throw new FabricError(400, `Supply at most ${maxTransitRules} transit rules.`);
  const pairs = new Set<string>();
  const rules = input.rules.map((entry, index): TransitRule => {
    const rule = tunnelObject(entry, ['source', 'destination', 'protocol']);
    const source = ipv4Prefix(rule.source);
    const destination = ipv4Prefix(rule.destination);
    if (!source || !destination || source === destination)
      throw new FabricError(400, 'Each rule needs two different canonical IPv4 LAN prefixes.');
    if (!transitProtocols.includes(rule.protocol as (typeof transitProtocols)[number]))
      throw new FabricError(400, 'Protocol must be any, tcp, udp or icmp.');
    if (pairs.has(`${source}>${destination}`)) throw new FabricError(400, 'Duplicate transit rule.');
    pairs.add(`${source}>${destination}`);
    return { id: `rule-${index + 1}`, source, destination, protocol: rule.protocol as TransitRule['protocol'] };
  });
  return { rules, expectedVersion: tunnelVersion(input.expectedVersion) };
}
