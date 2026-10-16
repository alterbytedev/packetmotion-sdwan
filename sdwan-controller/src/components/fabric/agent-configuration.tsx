'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { Inventory, OperatorRole } from '@/lib/fabric/types';

export function AgentConfiguration({
  inventory,
  role,
}: {
  inventory: Inventory;
  role: OperatorRole;
}) {
  const [node, setNode] = useState(inventory.nodes[0]?.id || '');
  const [revision, setRevision] = useState(0);
  const [seconds, setSeconds] = useState(30);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!node) return;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    setNotice('');
    fetch(`/api/operator/nodes/${node}/config`, { cache: 'no-store', signal: abort.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setRevision(result.revision);
        setSeconds(result.payload?.pollIntervalSeconds || 30);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message || 'Unable to load configuration.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [node]);
  async function publish() {
    setPending(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/operator/nodes/${node}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: revision, pollIntervalSeconds: seconds }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to publish configuration.');
      setRevision(result.revision);
      setNotice(
        `Revision ${result.revision} published. The agent will receive it on its next check-in.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to publish configuration.');
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent configuration</CardTitle>
        <CardDescription>Set how often a device checks in with the controller.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5" aria-busy={loading || pending}>
        {inventory.nodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add a device to configure its agent.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="config-device" className="text-sm">
                  Device
                </label>
                <Select
                  id="config-device"
                  value={node}
                  disabled={pending}
                  onChange={(event) => setNode(event.target.value)}
                >
                  {inventory.nodes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <label htmlFor="config-interval" className="text-sm">
                  Check-in interval (seconds)
                </label>
                <Input
                  id="config-interval"
                  type="number"
                  min={10}
                  max={300}
                  value={seconds}
                  disabled={role === 'viewer' || pending || loading}
                  onChange={(event) => setSeconds(Number(event.target.value))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Current revision: {loading ? <span role="status">Loading…</span> : revision}. Agents
              securely retrieve configuration; no inbound connection to the device is needed.
            </p>
            {role !== 'viewer' && (
              <Button
                type="button"
                disabled={
                  pending ||
                  loading ||
                  !Number.isInteger(seconds) ||
                  seconds < 10 ||
                  seconds > 300 ||
                  !!error
                }
                onClick={publish}
              >
                {pending ? 'Publishing…' : 'Publish configuration'}
              </Button>
            )}
            {notice && <Feedback tone="success">{notice}</Feedback>}
            {error && <Feedback tone="error">{error}</Feedback>}
          </>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          This changes the check-in interval and preserves saved hub connections. WireGuard apply
          requires the local agent opt-in; LAN routing and firewall policy are not configured here.
        </p>
      </CardContent>
    </Card>
  );
}
