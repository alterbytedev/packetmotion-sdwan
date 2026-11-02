'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Feedback } from '@/components/ui/feedback';
import { formatDateTime } from '@/lib/date-format';
import type { NodeRecord } from '@/lib/fabric/types';
import { useControllerTimeZone } from '@/lib/time-zone-context';
export type ReportedInterface = {
  name: string;
  up: boolean;
  mtu: number;
  addresses?: string[];
  kind?: string;
  parentName?: string;
  vlanId?: number;
};
type Snapshot = {
  receivedAt: string;
  snapshot: {
    agentVersion: string;
    os: string;
    arch: string;
    uptimeSeconds: number;
    interfaces: ReportedInterface[];
  };
};
export function useAgentTelemetry(node: NodeRecord) {
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
  return { sample, loading, error, refresh: () => setRefresh((value) => value + 1) };
}

export function AgentTelemetry({
  node,
  telemetry,
  view = 'overview',
  onConfigure,
  onConfigureVlans,
  readOnly = false,
}: {
  node: NodeRecord;
  telemetry: ReturnType<typeof useAgentTelemetry>;
  view?: 'overview' | 'underlay';
  onConfigure?: (item: ReportedInterface) => void;
  onConfigureVlans?: (item: ReportedInterface) => void;
  readOnly?: boolean;
}) {
  const { timeZone } = useControllerTimeZone();
  const { sample, loading, error, refresh } = telemetry;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{view === 'underlay' ? 'Interfaces' : 'Agent telemetry'}</CardTitle>
            <CardDescription className="mt-1">
              {view === 'underlay'
                ? `Select an interface on ${node.name} to configure its addressing or VLANs.`
                : `Latest reported software and uptime for ${node.name}.`}
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={refresh}>
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
            {view === 'overview' && (
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Agent version</dt>
                  <dd className="mt-1 font-medium">{sample.snapshot.agentVersion}</dd>
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
                <div>
                  <dt className="text-muted-foreground">Last received</dt>
                  <dd className="mt-1">{formatDateTime(sample.receivedAt, timeZone)}</dd>
                </div>
              </dl>
            )}
            {view === 'underlay' && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Snapshot received {formatDateTime(sample.receivedAt, timeZone)}
                </p>
                <p className="mb-3 text-xs leading-5 text-muted-foreground">
                  Configure addressing, role and MTU from the interface row. Use VLANs to configure
                  tagged networks on that interface. Loopback and Fabric tunnels are managed
                  separately.
                </p>
                {sample.snapshot.interfaces.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No interfaces reported. Refresh after the next agent heartbeat.
                  </p>
                )}
                <ul className="grid gap-2 sm:grid-cols-2">
                  {sample.snapshot.interfaces.map((item) => (
                    <li
                      key={item.name}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                    >
                      <div>
                        <span className="font-medium">{item.name}</span>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.up ? 'Up' : 'Down'} · MTU {item.mtu}
                        </p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {item.addresses === undefined
                            ? 'IP addresses not reported by this agent'
                            : item.addresses.length
                              ? item.addresses.join(', ')
                              : 'No IP address assigned'}
                        </p>
                      </div>
                      {item.kind === 'vlan' ? (
                        <div className="space-y-2 text-xs text-muted-foreground">
                          <p>
                            VLAN {item.vlanId} on {item.parentName || 'unreported parent'}
                          </p>
                          {onConfigureVlans &&
                            sample.snapshot.interfaces.some(
                              (parent) => parent.name === item.parentName,
                            ) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`Configure VLAN ${item.vlanId} on ${item.parentName}`}
                                onClick={() => {
                                  const parent = sample.snapshot.interfaces.find(
                                    (parent) => parent.name === item.parentName,
                                  );
                                  if (parent) onConfigureVlans(parent);
                                }}
                              >
                                Configure VLANs
                              </Button>
                            )}
                        </div>
                      ) : item.name === 'lo' ||
                        item.kind === 'loopback' ||
                        item.kind === 'wireguard' ||
                        item.name.startsWith('pm') ? (
                        <span className="text-xs text-muted-foreground">
                          {item.name === 'lo' || item.kind === 'loopback'
                            ? 'Loopback'
                            : /^pm[0-9a-f]{12}$/.test(item.name)
                              ? 'Managed by SD-WAN'
                              : item.kind === 'wireguard'
                                ? 'WireGuard interface'
                                : 'Reserved Fabric interface'}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {onConfigure && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`${readOnly ? 'View settings for' : 'Configure'} ${item.name}`}
                              onClick={() => onConfigure(item)}
                            >
                              {readOnly ? 'View settings' : 'Configure'}
                            </Button>
                          )}
                          {onConfigureVlans && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`VLANs on ${item.name}`}
                              onClick={() => onConfigureVlans(item)}
                            >
                              VLANs
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No check-in received yet. Enroll the device and start its agent.
          </p>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          Agent version and interface details come from its latest management heartbeat. They do not
          prove WireGuard, BGP, or application reachability.
        </p>
      </CardContent>
    </Card>
  );
}
