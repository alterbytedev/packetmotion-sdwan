'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Feedback } from '@/components/ui/feedback';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export function TunnelSettings() {
  const [pool, setPool] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/operator/controller-settings/tunnels', { signal: abort.signal, cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load tunnel settings.');
        setPool(result.pool); setVersion(result.version);
      }).catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/operator/controller-settings/tunnels', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool, expectedVersion: version }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save tunnel settings.');
      setVersion(result.version); setPool(result.pool); setMessage('Tunnel address pool saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save tunnel settings.'); }
    finally { setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle>Tunnel addressing</CardTitle><CardDescription>Automatically reserve a unique pair of addresses for each Edge–Hub tunnel.</CardDescription></CardHeader>
    <CardContent><form onSubmit={save} className="space-y-4">
      <label htmlFor="tunnel-pool" className="text-sm font-medium">Tunnel IPv4 pool</label>
      <Input controlSize="md" id="tunnel-pool" value={pool} onChange={(event) => setPool(event.target.value)} placeholder="10.250.0.0/24" required disabled={version === null || busy} />
      <p className="text-xs leading-5 text-muted-foreground">Use an unused private IPv4 network with prefix length 16–30. Each tunnel reserves a /31 pair. Existing reservations prevent pool changes, including after a hub is deselected. Branch LAN addresses are unchanged.</p>
      {error && <Feedback tone="error">{error}</Feedback>}{message && <Feedback tone="success">{message}</Feedback>}
      <Button size="md" type="submit" disabled={version === null || busy}>{busy ? 'Saving…' : 'Save tunnel pool'}</Button>
    </form></CardContent>
  </Card>;
}
