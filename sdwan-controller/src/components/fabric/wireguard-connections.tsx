'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatDateTimeUtc } from '@/lib/date-format';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Feedback } from '@/components/ui/feedback';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { NodeRecord, OperatorRole } from '@/lib/fabric/types';

type Connections = {
  observed: { revision: number; status: 'disabled' | 'applied' | 'failed'; receivedAt: string; handshakes: { name: string; lastHandshake: number }[] } | null;
  desiredRevision: number | null;
  version: number; publicKey: string | null; endpoint: string | null; basePort: number | null; revoked: boolean;
  hubs: { id: string; name: string; ready: boolean; endpoint: string | null }[];
  links: { hubId: string; peerName: string; network: string; hubAddress: string; edgeAddress: string; hubPort: number }[];
};
export function WireguardConnections({ node, role }: { node: NodeRecord; role: OperatorRole }) {
  const [data, setData] = useState<Connections | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [endpoint, setEndpoint] = useState('');
  const [basePort, setBasePort] = useState('20000');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const url = `/api/operator/nodes/${node.id}/wireguard`;
  const readOnly = role === 'viewer' || data?.revoked;
  const populate = useCallback((result: Connections) => {
    setData(result); setSelected(result.links.map((link) => link.hubId));
    setEndpoint(result.endpoint || ''); setBasePort(String(result.basePort ?? 20000));
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    fetch(url, { signal: abort.signal, cache: 'no-store' }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load hub connections.');
      if (!abort.signal.aborted) populate(result);
    }).catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, [url, populate]);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setInterval(() => {
      void fetch(url, { signal: abort.signal, cache: 'no-store' }).then(async (response) => {
        if (!response.ok) return;
        const current: Connections = await response.json();
        if (!abort.signal.aborted) setData((previous) => previous ? { ...previous, observed: current.observed, desiredRevision: current.desiredRevision } : previous);
      }).catch(() => { /* Retain the timestamped observation when refresh is unavailable. */ });
    }, 15_000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [url]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!data) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: data.version, ...(node.kind === 'hub' ? { endpoint, basePort: Number(basePort) } : { hubIds: selected }) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save hub connections.');
      const refreshed = await fetch(url, { cache: 'no-store' });
      const current = await refreshed.json();
      if (!refreshed.ok) throw new Error(current.error || 'Saved; reload to see the latest connections.');
      populate(current); setNotice('Connections saved and desired revisions published. This does not confirm a tunnel handshake.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save hub connections.'); }
    finally { setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle>{node.kind === 'hub' ? 'WireGuard hub' : 'Hub connections'}</CardTitle><CardDescription>{node.kind === 'hub' ? 'Advertise the underlay IPv4 address that Edges can reach.' : 'Select up to eight hubs. Each connection receives its own tunnel and automatic address pair.'}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {data && <div className="rounded-lg border p-3 text-sm" aria-live="polite">
        <p>Network apply: {data.observed ? `${data.observed.status}${data.observed.revision !== data.desiredRevision ? ' (previous revision)' : ''}` : 'Not reported'}</p>
        {data.observed && <><p className="mt-1 text-xs text-muted-foreground">Revision {data.observed.revision} · Reported {formatDateTimeUtc(data.observed.receivedAt)}</p>
          {data.observed.handshakes.map((item) => <p key={item.name} className="mt-1 break-words text-xs text-muted-foreground">{item.name}: {item.lastHandshake > 0 ? `last handshake ${formatDateTimeUtc(new Date(item.lastHandshake * 1000).toISOString())}` : 'no handshake observed'}</p>)}
        </>}
      </div>}
      {!data && !error && <Feedback>Loading connections…</Feedback>}
      {data && <form onSubmit={save} className="space-y-4">
        <p className="text-xs text-muted-foreground">WireGuard key: {data.publicKey ? 'Registered by agent' : 'Not registered — upgrade and start the agent'}</p>
        <fieldset disabled={readOnly || busy} className="space-y-4">
          {node.kind === 'hub' ? <>
            <label htmlFor="hub-endpoint" className="block text-sm font-medium">Hub endpoint IPv4</label>
            <Input id="hub-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="192.168.160.10" required />
            <label htmlFor="hub-base-port" className="block text-sm font-medium">Hub base UDP port</label>
            <Input id="hub-base-port" type="number" min={1024} max={65408} value={basePort} onChange={(event) => setBasePort(event.target.value)} required />
            <p className="text-xs leading-5 text-muted-foreground">Reserve 128 UDP ports beginning at this port. Each Edge gets one port. Configure upstream firewall or NAT access separately.</p>
          </> : <>
            <legend className="mb-3 text-sm font-medium">Selected hubs</legend>
            {data.hubs.length === 0 && <p className="text-sm text-muted-foreground">Add a Hub device and configure its endpoint first.</p>}
            {data.hubs.map((hub) => <label htmlFor={`hub-${hub.id}`} key={hub.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
              <Checkbox id={`hub-${hub.id}`} checked={selected.includes(hub.id)} disabled={(!hub.ready || !hub.endpoint) && !selected.includes(hub.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, hub.id] : current.filter((id) => id !== hub.id))} />
              <span>{hub.name}<span className="block text-xs text-muted-foreground">{hub.ready && hub.endpoint ? hub.endpoint : 'Waiting for endpoint and agent key'}</span></span>
            </label>)}
          </>}
          {!readOnly && <Button type="submit">{busy ? 'Saving…' : node.kind === 'hub' ? 'Save hub endpoint' : 'Save hub connections'}</Button>}
        </fieldset>
        {data.links.length > 0 && <fieldset className="space-y-2"><legend className="text-sm font-medium">Allocated tunnel addresses</legend>
          {data.links.map((link) => <div key={`${link.hubId}-${link.edgeAddress}`} className="rounded-lg border p-3 text-sm"><p className="font-medium">{link.peerName}</p><p className="break-words text-xs text-muted-foreground">Hub {link.hubAddress} · Edge {link.edgeAddress} · /31 · UDP {link.hubPort}</p></div>)}
        </fieldset>}
        <p className="text-xs leading-5 text-muted-foreground">These are saved tunnel settings. Agent network apply must be enabled locally. Tunnel connectivity and LAN routing are not implied by receipt of configuration.</p>
      </form>}
      {error && <Feedback tone="error">{error}</Feedback>}{notice && <Feedback tone="success">{notice}</Feedback>}
    </CardContent>
  </Card>;
}
