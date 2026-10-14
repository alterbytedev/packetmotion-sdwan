import { Activity, AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { currentActor } from '@/lib/fabric/authorization';
import { CopyLogButton } from './copy-log-button';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DiagnosticRecord = {
  reference_id: string;
  source: string;
  route_path: string | null;
  method: string | null;
  error_name: string;
  error_code: string | null;
  message: string;
  stack: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  occurrence_count: number;
};

function time(value: Date) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(value);
}

export default async function DiagnosticLogsPage() {
  await requireUser();
  const actor = await currentActor();
  if (actor?.role !== 'superadmin') redirect('/dashboard');

  const result = await getDatabase().query<DiagnosticRecord>(
    `SELECT reference_id,source,route_path,method,error_name,error_code,message,stack,
            first_seen_at,last_seen_at,occurrence_count
     FROM runtime_errors ORDER BY last_seen_at DESC LIMIT 100`,
  );
  const records = result.rows;
  return (
    <main className="min-h-screen bg-[#fbfcfc] px-4 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"><Activity size={14} /> Controller diagnostics</p>
            <h1 className="text-3xl font-semibold tracking-tight">Runtime error logs</h1>
            <p className="mt-2 text-sm text-muted-foreground">Showing the 100 most recently updated reports. Times are UTC.</p>
          </div>
          <Link href="/dashboard" className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft size={16} /> Back to dashboard
          </Link>
        </header>
        {records.length === 0 ? (
          <div className="rounded-xl border bg-white p-10 text-center">
            <AlertTriangle className="mx-auto mb-3 text-muted-foreground" size={24} />
            <h2 className="font-medium">No runtime errors recorded</h2>
            <p className="mt-1 text-sm text-muted-foreground">New server and authenticated browser reports will appear here.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>{['Last seen (UTC)', 'Reference ID', 'Source / route', 'Error', 'Count', 'Details'].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {records.map((record) => (
                    <tr key={record.reference_id} className="align-top hover:bg-muted/20">
                      <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">{time(record.last_seen_at)}</td>
                      <td className="px-4 py-4"><code className="break-all text-xs">{record.reference_id}</code></td>
                      <td className="px-4 py-4"><div className="font-medium">{record.source}</div><div className="mt-1 text-xs text-muted-foreground">{record.method || '—'} {record.route_path || '—'}</div></td>
                      <td className="px-4 py-4"><div>{record.error_name}{record.error_code ? ` · ${record.error_code}` : ''}</div><div className="mt-1 max-w-sm break-words text-xs text-muted-foreground">{record.message}</div></td>
                      <td className="px-4 py-4 tabular-nums">{record.occurrence_count}</td>
                      <td className="space-y-3 px-4 py-4">
                        <CopyLogButton
                          referenceId={record.reference_id}
                          report={[
                            'Runtime error report',
                            `Reference ID: ${record.reference_id}`,
                            `First seen (UTC): ${time(record.first_seen_at)}`,
                            `Last seen (UTC): ${time(record.last_seen_at)}`,
                            `Occurrences: ${record.occurrence_count}`,
                            `Source: ${record.source}`,
                            `Route: ${record.method || '—'} ${record.route_path || '—'}`,
                            `Error: ${record.error_name}${record.error_code ? ` (${record.error_code})` : ''}`,
                            `Message: ${record.message}`,
                            'Stack trace:',
                            record.stack || 'No stack trace recorded.',
                          ].join('\n')}
                        />
                        <details className="max-w-xl"><summary className="cursor-pointer font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Stack and timestamps</summary><div className="mt-3 space-y-2 text-xs"><p>First seen: {time(record.first_seen_at)}</p><p>Last seen: {time(record.last_seen_at)}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-mono">{record.stack || 'No stack trace recorded.'}</pre></div></details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="mt-5 text-xs text-muted-foreground">Diagnostic content may contain application context. Review it before sharing. Old reports are cleaned up on a best-effort basis after 30 days.</p>
      </div>
    </main>
  );
}
