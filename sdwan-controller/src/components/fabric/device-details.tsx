'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Activity, ArrowLeft, Clock3, Copy, Fingerprint, Radio, Router, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { connectionStatusLabels } from '@/components/fabric/connection-status';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { AgentConfiguration } from './agent-configuration';
import { AgentTelemetry } from './agent-telemetry';
import { EnrollmentInstructions, type EnrollmentDetails } from './enrollment-details';
import { NetworkConfigurationPreview } from './network-configuration-preview';
import type { NodeRecord, OperatorRole } from '@/lib/fabric/types';

export function DeviceDetails({ node, role }: { node: NodeRecord; role: OperatorRole }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<EnrollmentDetails | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const statusTone = node.connectionStatus === 'management-connected'
    ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300'
    : node.connectionStatus === 'revoked'
      ? 'border-rose-600/30 bg-rose-600/10 text-rose-800 dark:text-rose-300'
      : 'border-muted-foreground/20 bg-muted/60 text-muted-foreground';
  const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : null;
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(timer);
  }, [router]);
  async function copyDeviceId() {
    try {
      await navigator.clipboard.writeText(node.id);
    } catch {
      setError('Could not copy the device ID. Select and copy it manually.');
    }
  }
  const inventory = { sites: [], nodes: [node] };
  async function token() {
    if (
      node.connectionStatus === 'enrolling' &&
      !window.confirm('Reset this enrollment? The current certificate will be revoked and the device will need a new token.')
    ) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/operator/nodes/${node.id}/enrollment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to create token.');
      setEnrollment(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create token.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link href="/dashboard/devices"><ArrowLeft aria-hidden="true" /> Back to devices</Link>
      </Button>
      <Card className="overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-primary via-primary/50 to-transparent" />
        <CardHeader className="gap-5 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-muted/50 text-primary">
              {node.kind === 'hub' ? <Router aria-hidden="true" /> : <Radio aria-hidden="true" />}
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="break-words text-2xl">{node.name}</CardTitle>
                <Badge className="capitalize">{node.kind === 'hub' ? 'Hub' : 'Edge'}</Badge>
              </div>
              <CardDescription>{node.siteName} · Device details</CardDescription>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><Fingerprint size={14} aria-hidden="true" />{node.id.slice(0, 8)}…{node.id.slice(-6)}</span>
                <span className="inline-flex items-center gap-1.5"><Clock3 size={14} aria-hidden="true" />Added {new Date(node.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
          {role !== 'viewer' && ['pending', 'enrolling'].includes(node.connectionStatus) && (
            <Button disabled={pending} onClick={token} className="w-full shrink-0 sm:w-auto">
              {pending ? 'Creating token…' : node.connectionStatus === 'enrolling' ? 'Reset enrollment' : 'Enroll device'}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Activity size={15} aria-hidden="true" />Controller connection</div>
              <div className="mt-3"><Badge className={statusTone}><span className={`size-1.5 rounded-full ${node.connectionStatus === 'management-connected' ? 'bg-emerald-600' : node.connectionStatus === 'revoked' ? 'bg-rose-600' : 'bg-current'}`} />{connectionStatusLabels[node.connectionStatus]}</Badge></div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">Configuration revision {node.configRevision ?? '—'}: {node.configStatus === 'received' ? 'received (staged only)' : node.configStatus ?? 'not-configured'}. Data-plane health is unavailable.</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 size={15} aria-hidden="true" />Last check-in</div>
              <p className="mt-3 text-sm font-medium">{lastSeen || 'No check-in received'}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{lastSeen ? 'Most recent management heartbeat received by the controller.' : 'Enroll the device and start its agent to receive heartbeats.'}</p>
            </div>
          </div>
          <details className="group rounded-lg border bg-muted/20">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><ShieldCheck size={16} className="text-muted-foreground" aria-hidden="true" />Device identity</span>
              <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show ID</span>
              <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">Hide ID</span>
            </summary>
            <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <code className="break-all text-xs text-muted-foreground">{node.id}</code>
              <Button type="button" variant="outline" size="sm" onClick={copyDeviceId}><Copy aria-hidden="true" />Copy ID</Button>
            </div>
          </details>
          {error && <Feedback tone="error">{error}</Feedback>}
          {enrollment && <EnrollmentInstructions enrollment={enrollment} onClose={() => setEnrollment(null)} />}
        </CardContent>
      </Card>
      <NetworkConfigurationPreview key={`network-${node.id}`} node={node} role={role} />
      <AgentConfiguration key={`config-${node.id}`} inventory={inventory} role={role} />
      <AgentTelemetry key={`telemetry-${node.id}`} inventory={inventory} />
    </div>
  );
}
