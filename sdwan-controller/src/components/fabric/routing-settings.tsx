'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Feedback } from '@/components/ui/feedback';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export function RoutingSettings() {
  const [prefixes, setPrefixes] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/operator/controller-settings/routing', { signal: abort.signal, cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load protected networks.');
      if (!abort.signal.aborted) { setPrefixes(data.protectedPrefixes.join('\n')); setVersion(data.version); }
    }).catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/operator/controller-settings/routing', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: version, protectedPrefixes: prefixes.split(/\s+/).filter(Boolean) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save protected networks.');
      setVersion(result.version); setPrefixes(result.protectedPrefixes.join('\n')); setNotice('Protected networks saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save protected networks.'); }
    finally { setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle>Protected networks</CardTitle><CardDescription>Reserve management and underlay networks from LAN and tunnel allocation.</CardDescription></CardHeader>
    <CardContent><form onSubmit={save} className="space-y-4">
      <label htmlFor="protected-prefixes" className="text-sm font-medium">Protected IPv4 networks</label>
      <Textarea id="protected-prefixes" value={prefixes} onChange={(event) => setPrefixes(event.target.value)} placeholder="192.168.160.0/24" required disabled={version === null || busy} rows={3} />
      <p className="text-xs leading-5 text-muted-foreground">One canonical IPv4 network per line. Include all management and underlay networks. This reservation prevents new overlaps; it does not change host routes or firewall rules.</p>
      {error && <Feedback tone="error">{error}</Feedback>}{notice && <Feedback tone="success">{notice}</Feedback>}
      <Button type="submit" disabled={version === null || busy}>{busy ? 'Saving…' : 'Save protected networks'}</Button>
    </form></CardContent>
  </Card>;
}
