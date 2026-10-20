'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Feedback } from '@/components/ui/feedback';
import { Select } from '@/components/ui/select';
import { formatDateTime } from '@/lib/date-format';
import { useControllerTimeZone } from '@/lib/time-zone-context';

type Entry = {
  id: number;
  operationId: string;
  operationType: 'desired_config' | 'wireguard' | 'frr' | 'nftables';
  revision: number;
  event: string;
  attempt: number;
  actorEmail: string | null;
  summary: string;
  errorSummary: string | null;
  createdAt: string;
  durationMs: number | string;
};
type History = { entries: Entry[]; total: number; page: number; pageSize: number };
const operationLabels = {
  desired_config: 'Desired configuration',
  wireguard: 'WireGuard',
  frr: 'FRR',
  nftables: 'nftables',
} as const;

export function DeviceCommandHistory({ nodeId }: { nodeId: string }) {
  const { timeZone } = useControllerTimeZone();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rawConfigs, setRawConfigs] = useState<Record<string, string>>({});
  const [openConfig, setOpenConfig] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState('');

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (status) query.set('status', status);
    if (type) query.set('type', type);
    fetch(`/api/operator/nodes/${nodeId}/command-history?${query}`, {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load command history.');
        setHistory(result);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message || 'Unable to load command history.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [nodeId, page, status, type]);

  function changeFilter(update: () => void) {
    update();
    setPage(1);
  }

  async function toggleConfig(operationId: string) {
    setConfigNotice('');
    if (openConfig === operationId) {
      setOpenConfig(null);
      return;
    }
    if (rawConfigs[operationId] !== undefined) {
      setOpenConfig(operationId);
      return;
    }
    setConfigLoading(operationId);
    try {
      const response = await fetch(
        `/api/operator/nodes/${nodeId}/command-history/config?operationId=${encodeURIComponent(operationId)}`,
        { cache: 'no-store' },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load configuration snapshot.');
      setRawConfigs((current) => ({ ...current, [operationId]: result.rawConfig }));
      setOpenConfig(operationId);
    } catch (cause) {
      setConfigNotice(cause instanceof Error ? cause.message : 'Unable to load configuration snapshot.');
    } finally {
      setConfigLoading(null);
    }
  }

  async function copyConfig(operationId: string) {
    try {
      await navigator.clipboard.writeText(rawConfigs[operationId]);
      setConfigNotice('Raw configuration copied.');
    } catch {
      setConfigNotice('Could not copy configuration. Select and copy the text manually.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Command history</CardTitle>
        <CardDescription>
          Controller-published configuration and device-reported outcomes. Received means staged;
          only an explicit applied event means the device reported applying it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4" aria-busy={loading}>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-40 flex-1 space-y-1">
            <label htmlFor="command-history-status" className="text-xs">Event</label>
            <Select id="command-history-status" value={status} onChange={(event) => changeFilter(() => setStatus(event.target.value))}>
              <option value="">All events</option>
              {['published', 'delivered', 'received', 'rejected', 'applied', 'failed', 'disabled'].map((value) =>
                <option key={value} value={value}>{value}</option>,
              )}
            </Select>
          </div>
          <div className="min-w-40 flex-1 space-y-1">
            <label htmlFor="command-history-type" className="text-xs">Operation</label>
            <Select id="command-history-type" value={type} onChange={(event) => changeFilter(() => setType(event.target.value))}>
              <option value="">All operations</option>
              <option value="desired_config">Desired configuration</option>
              <option value="wireguard">WireGuard topology</option>
              <option value="frr">FRR</option>
              <option value="nftables">nftables</option>
            </Select>
          </div>
        </div>
        {error ? (
          <Feedback tone="error">{error}</Feedback>
        ) : loading && !history ? (
          <Feedback>Loading command history…</Feedback>
        ) : !history?.entries.length ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No command history is available for this filter. Historical publication and current
            WireGuard observations are included when available; delivery and receipt details may
            be unknown for older revisions.
          </p>
        ) : (
          <>
            <ol className="space-y-2">
              {history.entries.map((entry) => (
                <li key={entry.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <span className="text-sm font-medium capitalize">{entry.event} · {operationLabels[entry.operationType]} r{entry.revision}</span>
                    <time className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt, timeZone)}</time>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{entry.summary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Event {entry.attempt} · Operation {entry.operationId.slice(0, 8)}
                    {` · ${((Number(entry.durationMs) || 0) / 1000).toFixed(1)}s since publish`}
                    {entry.actorEmail && <> · Published by {entry.actorEmail}</>}
                  </p>
                  {entry.errorSummary && <p className="mt-2 text-sm text-destructive">{entry.errorSummary}</p>}
                  {entry.event === 'published' && (
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={configLoading === entry.operationId}
                        onClick={() => void toggleConfig(entry.operationId)}
                      >
                        {configLoading === entry.operationId
                          ? 'Loading config…'
                          : openConfig === entry.operationId
                            ? 'Hide raw config'
                            : 'View raw config'}
                      </Button>
                      {openConfig === entry.operationId && rawConfigs[entry.operationId] !== undefined && (
                        <div className="mt-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">Exact controller configuration snapshot; secret material is excluded.</p>
                            <Button type="button" variant="ghost" size="sm" onClick={() => void copyConfig(entry.operationId)}>
                              Copy config
                            </Button>
                          </div>
                          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{rawConfigs[entry.operationId]}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
              <span>{history.total} events · Page {history.page} of {Math.max(1, Math.ceil(history.total / history.pageSize))}</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button>
                <Button type="button" variant="outline" size="sm" disabled={!history || page >= Math.ceil(history.total / history.pageSize) || loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
        {configNotice && <p className="text-xs text-muted-foreground" aria-live="polite">{configNotice}</p>}
      </CardContent>
    </Card>
  );
}
