'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Feedback } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { useControllerTimeZone } from '@/lib/time-zone-context';

export function TimeZoneSettings() {
  const { setTimeZone } = useControllerTimeZone();
  const [timeZone, setValue] = useState('UTC');
  const [version, setVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/operator/controller-settings/time-zone', { signal: abort.signal, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load controller time zone.');
        if (!abort.signal.aborted) { setValue(data.timeZone); setVersion(data.version); }
      })
      .catch((cause) => { if (!abort.signal.aborted) setError(cause.message || 'Unable to load controller time zone.'); });
    return () => abort.abort();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/operator/controller-settings/time-zone', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeZone, expectedVersion: version }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save controller time zone.');
      setVersion(result.version); setValue(result.timeZone); setTimeZone(result.timeZone);
      setNotice('Controller time zone saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save controller time zone.');
    } finally { setBusy(false); }
  }

  return <Card>
    <CardHeader>
      <CardTitle>Controller time zone</CardTitle>
      <CardDescription>Choose the time zone used to display dates and times throughout the controller.</CardDescription>
    </CardHeader>
    <CardContent>
      <form onSubmit={save} className="max-w-xl space-y-4">
        <div className="space-y-2">
          <label htmlFor="controller-time-zone" className="text-sm font-medium">IANA time zone</label>
          <Input controlSize="md" id="controller-time-zone" value={timeZone} onChange={(event) => setValue(event.target.value)} placeholder="America/Los_Angeles" required maxLength={64} disabled={version === null || busy} />
          <p className="text-xs leading-5 text-muted-foreground">Examples: UTC, America/Los_Angeles, Europe/London, Asia/Jakarta. Changes apply to all operators and do not change stored timestamps.</p>
        </div>
        {error && <Feedback tone="error">{error}</Feedback>}
        {notice && <Feedback tone="success">{notice}</Feedback>}
        <Button size="md" type="submit" disabled={version === null || busy || !timeZone.trim()}>{busy ? 'Saving…' : 'Save time zone'}</Button>
      </form>
    </CardContent>
  </Card>;
}
