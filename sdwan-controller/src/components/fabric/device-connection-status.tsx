'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { formatDateTime } from '@/lib/date-format';
import { useControllerTimeZone } from '@/lib/time-zone-context';
import type { ConnectionDiagnostics } from '@/lib/fabric/connection-diagnostics';

export function DeviceConnectionStatus({ nodeId }: { nodeId: string }) {
  const { timeZone } = useControllerTimeZone();
  const [status, setStatus] = useState<ConnectionDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/operator/nodes/${nodeId}/connection-status`, {
          cache: 'no-store',
          signal,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            `${result.error || 'Unable to check connection status.'}${result.requestId ? ` Reference: ${result.requestId}` : ''}`,
          );
        if (!signal?.aborted) setStatus(result);
      } catch (cause) {
        if (!signal?.aborted)
          setError(cause instanceof Error ? cause.message : 'Unable to check connection status.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [nodeId],
  );
  useEffect(() => {
    const abort = new AbortController();
    setStatus(null);
    void refresh(abort.signal);
    return () => abort.abort();
  }, [refresh]);
  const date = (value: string | null) => (value ? formatDateTime(value, timeZone) : 'Not recorded');
  return (
    <section
      aria-label="Connection check"
      className="space-y-3 rounded-lg border bg-background p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Connection check</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? 'Checking…' : 'Refresh connection status'}
        </Button>
      </div>
      {loading && <Feedback tone="loading">Reading controller observations…</Feedback>}
      {error && <Feedback tone="error">{error}</Feedback>}
      {status && (
        <>
          <p className="text-sm" role="status">
            {status.summary}
          </p>
          <p className="text-xs leading-6 text-muted-foreground">{status.nextStep}</p>
          <dl className="grid gap-3 text-xs sm:grid-cols-2">
            {[
              ['Checked', date(status.checkedAt)],
              ['Enrollment token', status.tokenStatus],
              ['Token expires', date(status.tokenExpiresAt)],
              ['Enrollment accepted', date(status.enrolledAt)],
              ['Last heartbeat', date(status.lastSeenAt)],
              [
                'Configuration receipt',
                `${status.configStatus ?? 'not-configured'} · revision ${status.configRevision ?? '—'}`,
              ],
              ['Acknowledgement recorded', date(status.acknowledgedAt)],
              ['Certificate expires', date(status.certificateExpiresAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Recent connection events</summary>
            {status.events.length ? (
              <ol className="mt-2 space-y-2">
                {status.events.map((event) => (
                  <li key={event.id}>
                    {date(event.at)} — {event.message}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-muted-foreground">No lifecycle events recorded.</p>
            )}
          </details>
          <p className="text-xs text-muted-foreground">
            These are controller observations, not a live probe. Local failures cannot arrive while
            the agent is disconnected.
          </p>
        </>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer font-medium">Check the Debian agent</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3">{`sudo systemctl show fabric-agent -p ActiveState -p SubState -p Result -p ExecMainStatus;\nsudo journalctl -u fabric-agent -n 50 --no-pager`}</pre>
        <p className="mt-2 text-muted-foreground">
          With a status-enabled agent, compare the local identity and check controller
          authentication:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3">{`sudo -u packetmotion fabric-agent status --state-dir /var/lib/packetmotion --expected-node-id ${nodeId} --check`}</pre>
      </details>
    </section>
  );
}
