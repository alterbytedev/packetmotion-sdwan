'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { NodeRecord } from '@/lib/fabric/types';
import { formatDateTime } from '@/lib/date-format';
import { useControllerTimeZone } from '@/lib/time-zone-context';
type Snapshot = {
  receivedAt: string;
  snapshot: {
    agentVersion: string;
    os: string;
    arch: string;
    uptimeSeconds: number;
    interfaces: { name: string; up: boolean; mtu: number }[];
  };
};
export function AgentTelemetry({ node }: { node: NodeRecord }) {
  const { timeZone } = useControllerTimeZone();
  const [sample, setSample] = useState<Snapshot | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError('');
    setSample(null);
    fetch(`/api/operator/nodes/${node.id}/telemetry?refresh=${refresh}`, {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setSample(result.telemetry);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message || 'Unable to load telemetry.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [node.id, refresh]);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Agent telemetry</CardTitle>
            <CardDescription className="mt-1">Latest reported software and host interface details for {node.name}.</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5" aria-busy={loading}>
        {error ? (
          <Feedback tone="error">{error}</Feedback>
        ) : loading ? (
          <Feedback>Loading telemetry…</Feedback>
        ) : sample ? (
          <>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Agent version</dt>
                <dd className="mt-1 font-medium">{sample.snapshot.agentVersion}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Platform</dt>
                <dd className="mt-1">{sample.snapshot.os} / {sample.snapshot.arch}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Agent uptime</dt>
                <dd className="mt-1">{sample.snapshot.uptimeSeconds} seconds</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last received</dt>
                <dd className="mt-1">{formatDateTime(sample.receivedAt, timeZone)}</dd>
              </div>
            </dl>
            <div>
              <h4 className="mb-2 text-xs font-medium text-muted-foreground">Host interfaces</h4>
              <ul className="grid gap-2 sm:grid-cols-2">
                {sample.snapshot.interfaces.map((item) => (
                  <li key={item.name} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-xs">
                    <span className="font-medium">{item.name}</span>
                    <span>{item.up ? 'Up' : 'Down'} · MTU {item.mtu}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No check-in received yet. Enroll the device and start its agent.</p>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          Agent version and interface details come from its latest management heartbeat. They do
          not prove WireGuard, BGP, or application reachability.
        </p>
      </CardContent>
    </Card>
  );
}
