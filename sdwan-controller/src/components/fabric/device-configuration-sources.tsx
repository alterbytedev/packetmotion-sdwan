'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Feedback } from '@/components/ui/feedback';
import { formatDateTime } from '@/lib/date-format';
import { useControllerTimeZone } from '@/lib/time-zone-context';

type Report = {
  stateDirectory: string;
  revision: number;
  wireguardEnabled: boolean;
  files: { name: string; path: string; present: boolean }[];
  appliedPlan: { tunnels: {
    name: string; address: string; peerAddress: string; publicKey: string; endpoint: string | null;
    listenPort: number; keepalive: number; allowedPrefixes: string[];
  }[] } | null;
  interfaces: { name: string; present: boolean; up: boolean; addresses: string[]; lastHandshake: number | null }[];
  unplannedOwnedInterfaces: string[];
};
type DeviceState = {
  requestId: string | null;
  status: 'none' | 'pending' | 'completed' | 'unsupported' | 'unavailable';
  reason: 'timeout' | 'collection_failed' | null;
  requestedAt: string | null;
  completedAt: string | null;
  report: Report | null;
};

export function DeviceConfigurationSources({ nodeId, deviceOnline }: { nodeId: string; deviceOnline: boolean }) {
  const { timeZone } = useControllerTimeZone();
  const [state, setState] = useState<DeviceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [copyNotice, setCopyNotice] = useState('');

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/operator/nodes/${nodeId}/device-state`, { cache: 'no-store', signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to read device state.');
    setState(result);
  }, [nodeId]);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError('');
    refresh(abort.signal)
      .catch((cause) => { if (!abort.signal.aborted) setError(cause.message || 'Unable to read device state.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [refresh]);

  useEffect(() => {
    if (state?.status !== 'pending') return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const poll = async () => {
      try {
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to refresh device state.');
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh, state?.status]);

  async function collect() {
    setRequesting(true);
    setError('');
    setCopyNotice('');
    try {
      const response = await fetch(`/api/operator/nodes/${nodeId}/device-state`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to request device state.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to request device state.');
    } finally {
      setRequesting(false);
    }
  }

  async function copyReport() {
    if (!state?.report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(state.report, null, 2));
      setCopyNotice('Device report copied.');
    } catch {
      setCopyNotice('Could not copy the report. Select and copy the text manually.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration sources</CardTitle>
        <CardDescription>
          Controller-published configuration and device-reported state are different views. Collect known agent state on demand; WireGuard observations are included only when local collection is enabled. Reports are retained for 24 hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5" aria-busy={loading || requesting}>
        {error && <Feedback tone="error">{error}</Feedback>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={requesting || state?.status === 'pending'} onClick={() => void collect()}>
            {requesting ? 'Requesting…' : state?.status === 'pending' ? 'Collecting…' : 'Collect current state'}
          </Button>
          <p className="text-sm text-muted-foreground">The agent responds on its next controller check-in; the request expires after two minutes.</p>
        </div>
        {state?.status === 'pending' && <Feedback>Waiting for the device agent…</Feedback>}
        {state?.status === 'unavailable' && (
          <Feedback tone="error">
            {state.reason === 'timeout'
              ? deviceOnline
                ? 'The request expired without a report. The device is connected now; confirm its agent supports current-state reports, then retry.'
                : 'The request expired without a report while the device was offline. Confirm it is online and supports current-state reports, then retry.'
              : state.reason === 'collection_failed'
                ? 'The connected agent could not collect its current state. Check its service logs and retry.'
                : 'The report is unavailable and its cause is unknown. Refresh the status or request a new report.'}
          </Feedback>
        )}
        {state?.status === 'unsupported' && <Feedback>This agent does not support current-state reports.</Feedback>}
        {state?.status === 'completed' && state.report && (
          <section className="space-y-3" aria-label="Device-reported current state">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Device-reported current state</h3>
                <p className="text-xs text-muted-foreground">
                  Collected {state.completedAt ? formatDateTime(state.completedAt, timeZone) : 'time unavailable'} · Agent revision {state.report.revision}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyReport()}>Copy report</Button>
            </div>
            <p className="text-xs text-muted-foreground">The report includes known agent files and, when locally enabled, the applied plan and owned interface observations. It does not audit unrelated host configuration.</p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{JSON.stringify(state.report, null, 2)}</pre>
          </section>
        )}
        {state?.requestId && state.status !== 'none' && (
          <p className="text-xs text-muted-foreground">Request ID: <span className="font-mono">{state.requestId}</span></p>
        )}
        {state?.status === 'none' && !loading && <p className="text-sm text-muted-foreground">No device report has been collected yet.</p>}

        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Where to check</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="font-medium">Controller desired snapshot</dt><dd className="text-muted-foreground">Command history → View raw config</dd></div>
            <div><dt className="font-medium">Agent staged revision</dt><dd className="break-all text-muted-foreground">{state?.report?.stateDirectory ?? '/var/lib/packetmotion'}/desired.json</dd></div>
            <div><dt className="font-medium">Locally applied WireGuard plan</dt><dd className="break-all text-muted-foreground">{state?.report?.stateDirectory ?? '/var/lib/packetmotion'}/network-applied.json</dd></div>
            <div><dt className="font-medium">WireGuard private key</dt><dd className="break-all text-muted-foreground">{state?.report?.stateDirectory ?? '/var/lib/packetmotion'}/wireguard.key (path only; never collected)</dd></div>
            <div><dt className="font-medium">WireGuard active state</dt><dd className="text-muted-foreground">Kernel interfaces; no `/etc/wireguard/*.conf` is written by this agent.</dd></div>
            <div><dt className="font-medium">FRR reference</dt><dd className="text-muted-foreground">`/etc/frr/frr.conf` is host reference only; not collected or managed by this feature.</dd></div>
            <div><dt className="font-medium">nftables reference</dt><dd className="text-muted-foreground">The owned WireGuard guard is a runtime `inet pmwg…` table, not a config file. General nftables state is not collected.</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">Paths use the default `--state-dir`; a custom setting is shown in the device report. Secret key contents are never included.</p>
        </section>
        {copyNotice && <p className="text-xs text-muted-foreground" aria-live="polite">{copyNotice}</p>}
      </CardContent>
    </Card>
  );
}
