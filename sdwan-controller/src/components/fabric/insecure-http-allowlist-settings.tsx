'use client';

import { LoaderCircle, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Feedback } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/textarea';

export function InsecureHttpAllowlistSettings() {
  const [hosts, setHosts] = useState('');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/operator/controller-settings/insecure-http-hosts', {
          cache: 'no-store',
          signal: abort.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the address list.');
        setHosts(result.hosts.join('\n'));
      } catch (error) {
        if (!abort.signal.aborted) {
          setMessage(error instanceof Error ? error.message : 'Could not load the address list.');
          setIsError(true);
        }
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    })();
    return () => abort.abort();
  }, []);

  async function save() {
    setSaving(true);
    setMessage('');
    setIsError(false);
    try {
      const response = await fetch('/api/operator/controller-settings/insecure-http-hosts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hosts: hosts.split(/[\r\n,]+/).map((host) => host.trim()).filter(Boolean) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the address list.');
      setHosts(result.hosts.join('\n'));
      setMessage('Allowed controller addresses saved. New enrollment instructions use the updated list.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the address list.');
      setIsError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Insecure HTTP lab controllers</CardTitle>
        <CardDescription>Choose which private controller IPs may appear in HTTP enrollment commands.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label htmlFor="insecure-http-hosts" className="text-sm font-medium">Allowed private IP addresses</label>
        <Textarea
          id="insecure-http-hosts"
          aria-label="Allowed private IP addresses"
          value={hosts}
          onChange={(event) => setHosts(event.target.value)}
          placeholder={'192.168.160.200\n10.0.0.10'}
          disabled={busy || saving}
          rows={5}
          spellCheck={false}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          Enter one private IPv4 or IPv6 address per line. Only superadmins can change this list.
          HTTP exposes enrollment tokens, certificates, and management traffic to the lab network;
          use an isolated trusted lab. Public IPs and hostnames are rejected.
        </p>
        {message && <Feedback tone={isError ? 'error' : 'success'} presentation="panel">{message}</Feedback>}
        <div className="flex justify-end border-t pt-4">
          <Button size="md" type="button" disabled={busy || saving} onClick={() => void save()}>
            {saving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save allowlist'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
