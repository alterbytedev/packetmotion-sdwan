'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { Inventory } from '@/lib/fabric/types';
import { formatDateTimeUtc } from '@/lib/date-format';
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
export function AgentTelemetry({ inventory }: { inventory: Inventory }) {
  const [node, setNode] = useState(inventory.nodes[0]?.id || '');
  const [sample, setSample] = useState<Snapshot | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!node) return;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    setSample(null);
    fetch(`/api/operator/nodes/${node}/telemetry?refresh=${refresh}`, {
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
  }, [node, refresh]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent telemetry</CardTitle>
        <CardDescription>Actual check-ins from edge devices and hubs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5" aria-busy={loading}>
        {inventory.nodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add a device to view its telemetry.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 space-y-2">
                <label htmlFor="telemetry-device" className="text-sm">
                  Device
                </label>
                <Select
                  id="telemetry-device"
                  value={node}
                  onChange={(event) => setNode(event.target.value)}
                >
                  {inventory.nodes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => setRefresh((value) => value + 1)}
              >
                Refresh
              </Button>
            </div>
            {error ? (
              <Feedback tone="error">{error}</Feedback>
            ) : loading ? (
              <Feedback>Loading telemetry…</Feedback>
            ) : sample ? (
              <>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Last received</dt>
                    <dd className="mt-1">{formatDateTimeUtc(sample.receivedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Agent version</dt>
                    <dd className="mt-1">{sample.snapshot.agentVersion}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Platform</dt>
                    <dd className="mt-1">
                      {sample.snapshot.os} / {sample.snapshot.arch}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Agent uptime</dt>
                    <dd className="mt-1">{sample.snapshot.uptimeSeconds} seconds</dd>
                  </div>
                </dl>
                <ul className="space-y-2">
                  {sample.snapshot.interfaces.map((item) => (
                    <li
                      key={item.name}
                      className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-xs"
                    >
                      <span>{item.name}</span>
                      <span>
                        {item.up ? 'Interface up' : 'Interface down'} · MTU {item.mtu}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No check-in received yet. Enroll the device and start its agent.
              </p>
            )}
          </>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          These are management-agent observations. Device details show separate WireGuard apply
          and handshake reports. BGP and application reachability checks remain unavailable.
        </p>
      </CardContent>
    </Card>
  );
}
