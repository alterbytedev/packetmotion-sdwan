import { Activity, AlertTriangle, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { getDatabase } from '@/lib/db';
import { developerSession } from '@/lib/diagnostic-auth';
import { Feedback } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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

export default async function DiagnosticLogsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const authenticated = await developerSession();
  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fbfcfc] px-5 py-10">
        <section className="w-full max-w-md rounded-xl border bg-white p-7 shadow-sm sm:p-9">
          <div className="mb-6 flex size-12 items-center justify-center rounded-xl border bg-white shadow-sm">
            <ShieldCheck size={22} className="text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Diagnostic logs</h1>
          <p className="mb-7 mt-2 text-sm leading-6 text-muted-foreground">Sign in with developer access to review runtime error reports.</p>
          <form action="/diagnosticlogs/login" method="post" className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="diagnostic-username" className="text-sm font-medium">Username</label>
              <Input id="diagnostic-username" name="username" autoComplete="username" required maxLength={64} />
            </div>
            <div className="space-y-2">
              <label htmlFor="diagnostic-password" className="text-sm font-medium">Password</label>
              <Input id="diagnostic-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
            </div>
            {params.error === 'invalid' && <Feedback tone="error" presentation="panel">Invalid username or password, or developer access is not configured.</Feedback>}
            <Button className="w-full" size="lg"><LogIn /> Open diagnostic logs</Button>
          </form>
        </section>
      </main>
    );
  }

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
          <form action="/diagnosticlogs/logout" method="post">
            <button className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="submit">
              <LogOut size={16} /> Sign out
            </button>
          </form>
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
