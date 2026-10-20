'use client';
import {
  Activity,
  Archive,
  ArrowLeft,
  Clock3,
  Copy,
  Fingerprint,
  Pencil,
  RefreshCw,
  Radio,
  Router,
  ShieldCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { connectionStatusLabels } from '@/components/fabric/connection-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Feedback } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { formatDateTime, formatDate } from '@/lib/date-format';
import { useControllerTimeZone } from '@/lib/time-zone-context';
import type { NodeRecord, OperatorRole } from '@/lib/fabric/types';
import { AgentConfiguration } from './agent-configuration';
import { AgentTelemetry } from './agent-telemetry';
import { DeviceConnectionStatus } from './device-connection-status';
import { type EnrollmentDetails, EnrollmentInstructions } from './enrollment-details';
import { LanSettings } from './lan-settings';
import { NetworkConfigurationPreview } from './network-configuration-preview';
import { WireguardConnections } from './wireguard-connections';
import { DeviceCommandHistory } from './device-command-history';
import { DeviceConfigurationSources } from './device-configuration-sources';
import { AgentUpgrade } from './agent-upgrade';
import type { AgentRelease } from '@/lib/fabric/agent-releases';

export function DeviceDetails({ node, role, agentReleases }: { node: NodeRecord; role: OperatorRole; agentReleases: AgentRelease[] }) {
  const { timeZone } = useControllerTimeZone();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [enrollment, setEnrollment] = useState<EnrollmentDetails | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(node.name);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const tabs = ['Overview', 'Connections', 'Configuration', ...(role === 'superadmin' ? ['Agent upgrade', 'Command history', 'Configuration sources'] : [])];
  const tabId = (index: number) => `device-${node.id}-tab-${index}`;
  const panelId = (index: number) => `device-${node.id}-panel-${index}`;
  const statusTone =
    node.connectionStatus === 'management-connected'
      ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300'
      : node.connectionStatus === 'revoked'
        ? 'border-rose-600/30 bg-rose-600/10 text-rose-800 dark:text-rose-300'
        : 'border-muted-foreground/20 bg-muted/60 text-muted-foreground';
  const lastSeen = node.lastSeenAt ? formatDateTime(node.lastSeenAt, timeZone) : null;
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
      !window.confirm(
        'Reset this enrollment? The current certificate will be revoked and the device will need a new token.',
      )
    )
      return;
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
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/operator/nodes/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to rename device.');
      setRenameOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to rename device.');
    } finally {
      setPending(false);
    }
  }
  async function archive() {
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/operator/nodes/${node.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to archive device.');
      router.push('/dashboard/devices');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to archive device.');
      setArchiveOpen(false);
    } finally {
      setPending(false);
    }
  }
  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (activeTab + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  }
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link href="/dashboard/devices">
          <ArrowLeft aria-hidden="true" /> Back to devices
        </Link>
      </Button>
      <div
        className="mb-4 border-b"
        role="tablist"
        aria-label="Device details"
        onKeyDown={handleTabKeyDown}
      >
        <div className="grid grid-cols-2 gap-1 sm:flex">
          {tabs.map((tab, index) => (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={tabId(index)}
              type="button"
              role="tab"
              aria-selected={activeTab === index}
              aria-controls={panelId(index)}
              tabIndex={activeTab === index ? 0 : -1}
              className={`w-full border-b-2 px-4 py-3 text-left text-sm font-medium transition-colors sm:w-auto ${activeTab === index ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveTab(index)}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <section id={panelId(0)} role="tabpanel" aria-labelledby={tabId(0)} hidden={activeTab !== 0}>
        <Card className="overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-primary via-primary/50 to-transparent" />
          <CardHeader className="gap-5 pb-5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-4">
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
                  <span className="inline-flex items-center gap-1.5">
                    <Fingerprint size={14} aria-hidden="true" />
                    {node.id.slice(0, 8)}…{node.id.slice(-6)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 size={14} aria-hidden="true" />
                    Added {formatDate(node.createdAt, timeZone)}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:w-auto sm:flex sm:flex-wrap sm:justify-end">
              <Button type="button" variant="outline" onClick={() => router.refresh()} className="w-full sm:w-auto">
                <RefreshCw aria-hidden="true" /> Refresh status
              </Button>
              {role !== 'viewer' && (
              <fieldset
                className="contents"
                aria-label="Device actions"
              >
                {['pending', 'enrolling'].includes(node.connectionStatus) && (
                  <Button
                    disabled={pending}
                    onClick={token}
                    className="col-span-2 w-full sm:col-span-1 sm:w-auto"
                  >
                    {pending
                      ? 'Creating token…'
                      : node.connectionStatus === 'enrolling'
                        ? 'Reset enrollment'
                        : 'Enroll device'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setName(node.name);
                    setRenameOpen(true);
                  }}
                  className="w-full sm:w-auto"
                >
                  <Pencil aria-hidden="true" />
                  Rename
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setArchiveOpen(true)}
                  className="w-full sm:w-auto"
                >
                  <Archive aria-hidden="true" />
                  Archive device
                </Button>
              </fieldset>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-background p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Activity size={15} aria-hidden="true" />
                  Controller connection
                </div>
                <div className="mt-3">
                  <Badge className={statusTone}>
                    <span
                      className={`size-1.5 rounded-full ${node.connectionStatus === 'management-connected' ? 'bg-emerald-600' : node.connectionStatus === 'revoked' ? 'bg-rose-600' : 'bg-current'}`}
                    />
                    {connectionStatusLabels[node.connectionStatus]}
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Configuration revision {node.configRevision ?? '—'}:{' '}
                  {node.configStatus === 'received'
                    ? 'received (staged only)'
                    : (node.configStatus ?? 'not-configured')}
                  . Data-plane health is unavailable.
                </p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 size={15} aria-hidden="true" />
                  Last check-in
                </div>
                <p className="mt-3 text-sm font-medium">{lastSeen || 'No check-in received'}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {lastSeen
                    ? 'Most recent management heartbeat received by the controller.'
                    : 'Enroll the device and start its agent to receive heartbeats.'}
                </p>
              </div>
            </div>
            <details className="group rounded-lg border bg-muted/20">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-muted-foreground" aria-hidden="true" />
                  Device identity
                </span>
                <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                  Show ID
                </span>
                <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">
                  Hide ID
                </span>
              </summary>
              <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <code className="break-all text-xs text-muted-foreground">{node.id}</code>
                <Button type="button" variant="outline" size="sm" onClick={copyDeviceId}>
                  <Copy aria-hidden="true" />
                  Copy ID
                </Button>
              </div>
            </details>
            <DeviceConnectionStatus nodeId={node.id} />
            {error && <Feedback tone="error">{error}</Feedback>}
            {enrollment && (
              <EnrollmentInstructions enrollment={enrollment} onClose={() => setEnrollment(null)} />
            )}
          </CardContent>
        </Card>
        <div className="mt-5">
          <AgentTelemetry key={`telemetry-${node.id}`} node={node} />
        </div>
        {renameOpen && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Rename device</CardTitle>
              <CardDescription>Device names must be unique within this site.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-wrap items-end gap-3" onSubmit={rename}>
                <div className="min-w-48 flex-1 space-y-2">
                  <label htmlFor="rename-device">Device name</label>
                  <Input
                    id="rename-device"
                    value={name}
                    maxLength={100}
                    required
                    disabled={pending}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <Button type="submit" disabled={pending || !name.trim()}>
                  {pending ? 'Saving…' : 'Save name'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setRenameOpen(false)}
                >
                  <X aria-hidden="true" />
                  Cancel
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </section>
      <section
        id={panelId(1)}
        role="tabpanel"
        aria-labelledby={tabId(1)}
        hidden={activeTab !== 1}
        className="space-y-6"
      >
        <WireguardConnections key={`wireguard-${node.id}`} node={node} role={role} />
        <LanSettings key={`lan-${node.id}`} node={node} role={role} />
      </section>
      <section
        id={panelId(2)}
        role="tabpanel"
        aria-labelledby={tabId(2)}
        hidden={activeTab !== 2}
        className="space-y-6"
      >
        <NetworkConfigurationPreview key={`network-${node.id}`} node={node} role={role} />
        <AgentConfiguration key={`config-${node.id}`} inventory={inventory} role={role} />
      </section>
      {role === 'superadmin' && (
        <section id={panelId(3)} role="tabpanel" aria-labelledby={tabId(3)} hidden={activeTab !== 3}>
          <AgentUpgrade releases={agentReleases} />
        </section>
      )}
      {role === 'superadmin' && (
        <section id={panelId(5)} role="tabpanel" aria-labelledby={tabId(5)} hidden={activeTab !== 5}>
          <DeviceConfigurationSources
            key={`device-state-${node.id}`}
            nodeId={node.id}
            deviceOnline={node.connectionStatus === 'management-connected'}
          />
        </section>
      )}
      {role === 'superadmin' && (
        <section id={panelId(4)} role="tabpanel" aria-labelledby={tabId(4)} hidden={activeTab !== 4}>
          <DeviceCommandHistory key={`command-history-${node.id}`} nodeId={node.id} />
        </section>
      )}
      <Modal
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive device"
        description={`Archive ${node.name}? This revokes its credentials, removes it from active inventory, and withdraws its active peer plans. Audit history and reserved WireGuard addresses and ports are retained. Tunnel state may remain on a disconnected device until local cleanup.`}
      >
        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setArchiveOpen(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={archive}>
            {pending ? 'Archiving…' : 'Archive device'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
