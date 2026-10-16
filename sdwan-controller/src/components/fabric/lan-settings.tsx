'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Feedback } from '@/components/ui/feedback';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { NodeRecord, OperatorRole } from '@/lib/fabric/types';

export function LanSettings({ node, role }: { node: NodeRecord; role: OperatorRole }) {
  const [interfaceName, setInterfaceName] = useState('');
  const [address, setAddress] = useState('');
  const [prefix, setPrefix] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [protectedPrefixes, setProtectedPrefixes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const readOnly = role === 'viewer' || node.connectionStatus === 'revoked';
  const url = `/api/operator/nodes/${node.id}/lan`;
  useEffect(() => {
    const abort = new AbortController();
    void fetch(url, { signal: abort.signal, cache: 'no-store' }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load LAN profile.');
      if (!abort.signal.aborted) {
        setInterfaceName(result.interfaceName || ''); setAddress(result.address || '');
        setPrefix(result.advertisedPrefix || result.sitePrefix || '');
        setVersion(result.version); setProtectedPrefixes(result.protectedPrefixes);
      }
    }).catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, [url]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interfaceName, address, advertisedPrefix: prefix, expectedVersion: version }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save LAN profile.');
      setVersion(result.version); setNotice('LAN profile saved. No interface address or forwarding rule has been applied.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save LAN profile.'); }
    finally { setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle>LAN network</CardTitle><CardDescription>Save the appliance LAN address and the exact subnet to advertise.</CardDescription></CardHeader>
    <CardContent><form onSubmit={save} className="space-y-4">
      <fieldset disabled={readOnly || busy || version === null} className="space-y-4">
        <div className="space-y-2"><label htmlFor="lan-interface" className="text-sm font-medium">LAN interface</label><Input id="lan-interface" value={interfaceName} onChange={(event) => setInterfaceName(event.target.value)} placeholder="ens34" maxLength={15} required /></div>
        <div className="space-y-2"><label htmlFor="lan-address" className="text-sm font-medium">Appliance LAN address / prefix</label><Input id="lan-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="10.61.0.1/24" required /></div>
        <div className="space-y-2"><label htmlFor="lan-prefix" className="text-sm font-medium">Advertised LAN subnet</label><Input id="lan-prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="10.61.0.0/24" required /></div>
        {!readOnly && <Button type="submit" disabled={protectedPrefixes.length === 0}>{busy ? 'Saving…' : 'Save LAN profile'}</Button>}
      </fieldset>
      <p className="text-xs leading-5 text-muted-foreground">Protected networks: {protectedPrefixes.join(', ') || 'not configured — a superadmin must configure Settings first'}. The advertised subnet must match the LAN address network. Management-interface ownership must also pass on-device preflight before any future apply.</p>
      <p className="text-xs leading-5 text-muted-foreground">This saves configuration intent. Current tunnel-transit isolation remains active until routing and explicit permissions are validated.</p>
      {error && <Feedback tone="error">{error}</Feedback>}{notice && <Feedback tone="success">{notice}</Feedback>}
    </form></CardContent>
  </Card>;
}
