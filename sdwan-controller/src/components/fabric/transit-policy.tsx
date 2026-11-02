'use client';
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Feedback } from '@/components/ui/feedback';
import { IconButton } from '@/components/ui/icon-button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

type Rule = { source: string; destination: string; protocol: string };
// Rows carry a client-only key so edits and removals keep the right controls.
type Row = Rule & { key: number };
let nextKey = 0;
const withKeys = (rules: Rule[]): Row[] => rules.map((rule) => ({ ...rule, key: nextKey++ }));
const stripKeys = (rows: Row[]): Rule[] => rows.map(({ source, destination, protocol }) => ({ source, destination, protocol }));
type Policy = { rules: Rule[]; draftRules: Rule[] | null; version: number; lanPrefixes: string[] };
const endpoint = '/api/operator/controller-settings/transit';

export function TransitPolicy() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load transit policy.');
    if (signal?.aborted) return;
    setPolicy(data); setDraft(withKeys(data.draftRules ?? data.rules));
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    load(abort.signal).catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, [load]);
  async function send(url: string, method: string, body: unknown, done: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to update transit policy.');
      await load(); setNotice(result.deployed === false ? result.message : done);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update transit policy.'); }
    finally { setBusy(false); }
  }
  const prefixes = policy?.lanPrefixes ?? [];
  const update = (index: number, field: keyof Rule, value: string) =>
    setDraft(draft.map((rule, position) => (position === index ? { ...rule, [field]: value } : rule)));
  // Preset: every ordered pair of saved LANs, any protocol.
  const allowAll = () => setDraft(withKeys(prefixes.flatMap((source) => prefixes.filter((destination) => destination !== source)
    .map((destination) => ({ source, destination, protocol: 'any' })))));
  const unsaved = policy !== null && JSON.stringify(stripKeys(draft)) !== JSON.stringify(policy.draftRules ?? policy.rules);
  const pending = policy?.draftRules != null;
  return <Card>
    <CardHeader><CardTitle>Transit policy</CardTitle><CardDescription>Allow forwarded traffic between device LANs across the WireGuard tunnels. Without a rule, tunnel transit stays blocked.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-xs leading-5 text-muted-foreground">Rules name saved device LAN prefixes only; management, underlay and tunnel networks are never forwarded. Each appliance must also run the agent with <code>--enable-transit</code>, and a node without it rejects the revision. Deployed: {policy ? `${policy.rules.length} rule(s)` : '…'}. Return traffic is allowed only for permitted flows.</p>
      {draft.map((rule, index) => <div key={rule.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-center">
        <Select aria-label={`Rule ${index + 1} source`} value={rule.source} onChange={(event) => update(index, 'source', event.target.value)} disabled={busy}>
          {[rule.source, ...prefixes.filter((prefix) => prefix !== rule.source)].map((prefix) => <option key={prefix} value={prefix}>{prefix}</option>)}
        </Select>
        <Select aria-label={`Rule ${index + 1} destination`} value={rule.destination} onChange={(event) => update(index, 'destination', event.target.value)} disabled={busy}>
          {[rule.destination, ...prefixes.filter((prefix) => prefix !== rule.destination)].map((prefix) => <option key={prefix} value={prefix}>{prefix}</option>)}
        </Select>
        <Select aria-label={`Rule ${index + 1} protocol`} value={rule.protocol} onChange={(event) => update(index, 'protocol', event.target.value)} disabled={busy}>
          {['any', 'tcp', 'udp', 'icmp'].map((protocol) => <option key={protocol} value={protocol}>{protocol}</option>)}
        </Select>
        <IconButton aria-label={`Remove rule ${index + 1}`} onClick={() => setDraft(draft.filter((_, position) => position !== index))} disabled={busy}><X /></IconButton>
      </div>)}
      {policy && !draft.length && <p className="text-sm text-muted-foreground">No rules. All tunnel transit is blocked.</p>}
      {policy && prefixes.length < 2 && <p className="text-xs text-muted-foreground">Save LAN profiles for at least two devices to create rules.</p>}
      {error && <Feedback tone="error">{error}</Feedback>}{notice && <Feedback tone="success">{notice}</Feedback>}
      {pending && !unsaved && <Feedback>Saved draft not deployed yet.</Feedback>}
      <div className="flex flex-wrap gap-2">
        <Button size="md" variant="outline" type="button" onClick={() => setDraft([...draft, ...withKeys([{ source: prefixes[0], destination: prefixes[1], protocol: 'any' }])])} disabled={!policy || prefixes.length < 2 || busy || draft.length >= 64}>Add rule</Button>
        <Button size="md" variant="outline" type="button" onClick={allowAll} disabled={!policy || prefixes.length < 2 || busy}>Allow any/any between all LANs</Button>
        <Button size="md" variant="outline" type="button" onClick={() => policy && send(endpoint, 'PUT', { expectedVersion: policy.version, rules: stripKeys(draft) }, 'Draft saved. Deploy to publish.')} disabled={!policy || busy || !unsaved}>{busy ? 'Working…' : 'Save draft'}</Button>
        <Button size="md" type="button" onClick={() => policy && send(`${endpoint}/deploy`, 'POST', { expectedVersion: policy.version }, 'Transit policy deployed.')} disabled={!policy || busy || unsaved || !pending}>Deploy policy</Button>
      </div>
    </CardContent>
  </Card>;
}
