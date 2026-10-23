'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatDateTime } from '@/lib/date-format';
import type {
  InterfaceCommitView,
  InterfaceIntent,
  NetworkDraft,
} from '@/lib/fabric/network-types';
import type { NodeRecord, OperatorRole } from '@/lib/fabric/types';
import { useControllerTimeZone } from '@/lib/time-zone-context';
import type { ReportedInterface } from './agent-telemetry';

type Row = InterfaceIntent & { key: string };
export function NetworkDraftEditor({
  node,
  role,
  reportedInterface,
  kind,
}: {
  node: NodeRecord;
  role: OperatorRole;
  reportedInterface: ReportedInterface;
  kind: 'physical' | 'vlan';
}) {
  const { timeZone } = useControllerTimeZone();
  const [draft, setDraft] = useState<NetworkDraft | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [capability, setCapability] = useState<{ interfaces: string[] } | null>(null);
  const [commits, setCommits] = useState<InterfaceCommitView[]>([]);
  const [stale, setStale] = useState(false);
  const [reload, setReload] = useState(0);
  const readOnly = role === 'viewer' || node.connectionStatus === 'revoked';
  const matchesSelection = (entry: InterfaceIntent) =>
    entry.interfaceName === reportedInterface.name &&
    (kind === 'physical' ? entry.vlanId === null : entry.vlanId !== null);
  const visibleRows = rows.filter(matchesSelection);
  const pending = commits.some((commit) =>
    ['queued', 'applying', 'awaiting_confirmation', 'rollback_failed'].includes(commit.status),
  );
  const canApply =
    Boolean(capability?.interfaces.includes(reportedInterface.name)) &&
    !pending &&
    visibleRows.every(
      (entry) =>
        entry.role === 'lan' &&
        entry.mode === 'static' &&
        entry.gateway === null &&
        entry.advertisedPrefix === null,
    );
  const url = `/api/operator/nodes/${node.id}/network-draft`;
  useEffect(() => {
    const abort = new AbortController();
    setDraft(null);
    setError('');
    setNotice('');
    void fetch(`${url}?refresh=${reload}`, { signal: abort.signal, cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load interface draft.');
        if (abort.signal.aborted) return;
        setDraft({
          ...result.draft,
          baseRevision: result.currentRevision,
          baseLanVersion: result.currentLanVersion,
        });
        const loaded: Row[] = result.draft.interfaces.map((entry: InterfaceIntent) => ({
          ...entry,
          key: crypto.randomUUID(),
        }));
        if (
          !readOnly &&
          loaded.length < 16 &&
          !loaded.some(
            (entry) =>
              entry.interfaceName === reportedInterface.name &&
              (kind === 'physical' ? entry.vlanId === null : entry.vlanId !== null),
          )
        ) {
          loaded.push({
            key: crypto.randomUUID(),
            interfaceName: reportedInterface.name,
            vlanId: kind === 'vlan' ? 1 : null,
            role: 'lan',
            mode: 'static',
            address:
              kind === 'physical'
                ? (reportedInterface.addresses?.find((address) => !address.includes(':')) ?? null)
                : null,
            gateway: null,
            advertisedPrefix: null,
            enabled: kind === 'vlan' || reportedInterface.up,
            mtu: reportedInterface.mtu,
          });
        }
        setRows(loaded);
        setStale(
          result.draft.baseRevision !== result.currentRevision ||
            result.draft.baseLanVersion !== result.currentLanVersion,
        );
        setReason(result.deploymentReason);
        setCapability(result.capability ?? null);
        setCommits(result.commits ?? []);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      });
    return () => abort.abort();
  }, [
    url,
    reload,
    reportedInterface.name,
    reportedInterface.mtu,
    reportedInterface.up,
    reportedInterface.addresses,
    kind,
    readOnly,
  ]);

  const polling = commits.some((commit) =>
    ['queued', 'applying', 'awaiting_confirmation'].includes(commit.status),
  );
  useEffect(() => {
    if (!polling) return;
    const abort = new AbortController();
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (abort.signal.aborted || ++attempts > 40) return;
      try {
        const response = await fetch(url, { signal: abort.signal, cache: 'no-store' });
        if (response.ok) {
          const result = await response.json();
          if (!abort.signal.aborted) {
            setCommits(result.commits ?? []);
            setCapability(result.capability ?? null);
          }
        }
      } catch {
        /* Keep the last observed outcome during a transient outage. */
      }
      if (!abort.signal.aborted) timer = setTimeout(tick, 2000);
    }
    timer = setTimeout(tick, 2000);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [polling, url]);

  function update(key: string, change: Partial<InterfaceIntent>) {
    setNotice('');
    setRows((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)),
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    setNotice('');
    const apply =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-apply') === 'true';
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: draft.version,
          baseRevision: draft.baseRevision,
          baseLanVersion: draft.baseLanVersion,
          safeCommitSeconds: 60,
          interfaces: rows.map(({ key: _key, ...entry }) => entry),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save interface draft.');
      setDraft((current) => (current ? { ...current, version: result.version } : null));
      setStale(false);
      setNotice('Interface draft saved. Appliance configuration has not changed.');
      if (apply) {
        const requestId = crypto.randomUUID();
        const provisional: InterfaceCommitView = {
          id: requestId,
          interfaceName: reportedInterface.name,
          kind,
          status: 'queued',
          reason: '',
          createdAt: new Date().toISOString(),
        };
        const applied = await fetch(`${url}/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            expectedVersion: result.version,
            interfaceName: reportedInterface.name,
            kind,
          }),
        });
        const outcome = await applied.json();
        if (!applied.ok) {
          setCommits((current) => current.filter((commit) => commit.id !== requestId));
          throw new Error(outcome.error || 'Unable to queue interface apply.');
        }
        setCommits((current) => [provisional, ...current].slice(0, 10));
        setNotice(
          'Apply queued for the Fabric agent. The previous configuration will be restored if confirmation fails within 60 seconds.',
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save interface draft.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Reported state: {reportedInterface.up ? 'Up' : 'Down'} · MTU {reportedInterface.mtu}.
        Current IP:{' '}
        {reportedInterface.addresses === undefined
          ? 'not reported by this agent'
          : reportedInterface.addresses.join(', ') || 'none assigned'}
        .
      </p>
      <Feedback>{reason || 'Loading interface draft…'}</Feedback>
      {stale && (
        <Feedback>
          Published settings changed since this draft was saved. Review every entry before saving
          against the current configuration.
        </Feedback>
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
      {!draft && !error && <p className="text-sm text-muted-foreground">Loading settings…</p>}
      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={readOnly || busy || !draft || pending} className="space-y-4">
          {draft && visibleRows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No saved {kind === 'physical' ? 'interface' : 'VLAN'} settings for{' '}
              {reportedInterface.name}.
            </p>
          )}
          {visibleRows.map((entry) => (
            <fieldset key={entry.key} className="space-y-4 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">
                {entry.vlanId === null
                  ? entry.interfaceName
                  : `${entry.interfaceName} · VLAN ${entry.vlanId}`}
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor={`parent-${entry.key}`} className="text-sm font-medium">
                    Physical interface / parent
                  </label>
                  <Input
                    id={`parent-${entry.key}`}
                    controlSize="md"
                    value={entry.interfaceName}
                    placeholder="ens36"
                    maxLength={15}
                    required
                    readOnly
                  />
                </div>
                {kind === 'vlan' && (
                  <div className="space-y-2">
                    <label htmlFor={`tag-${entry.key}`} className="text-sm font-medium">
                      VLAN tag
                    </label>
                    <Input
                      id={`tag-${entry.key}`}
                      controlSize="md"
                      type="number"
                      min={1}
                      max={4094}
                      required
                      value={entry.vlanId ?? ''}
                      onChange={(event) =>
                        update(entry.key, {
                          vlanId: event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <label htmlFor={`role-${entry.key}`} className="text-sm font-medium">
                    Role
                  </label>
                  <Select
                    id={`role-${entry.key}`}
                    controlSize="md"
                    value={entry.role}
                    onChange={(event) =>
                      update(entry.key, {
                        role: event.target.value as 'wan' | 'lan',
                        mode: 'static',
                        gateway: null,
                        advertisedPrefix: null,
                      })
                    }
                  >
                    <option value="lan">LAN</option>
                    <option value="wan">WAN transport</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label htmlFor={`mode-${entry.key}`} className="text-sm font-medium">
                    Addressing
                  </label>
                  <Select
                    id={`mode-${entry.key}`}
                    controlSize="md"
                    value={entry.mode}
                    onChange={(event) =>
                      update(entry.key, {
                        mode: event.target.value as 'static' | 'dhcp',
                        address: null,
                        gateway: null,
                        advertisedPrefix: null,
                      })
                    }
                  >
                    <option value="static">Static IPv4</option>
                    {entry.role === 'wan' && <option value="dhcp">DHCP client</option>}
                  </Select>
                </div>
                {entry.mode === 'static' && (
                  <>
                    <div className="space-y-2">
                      <label htmlFor={`address-${entry.key}`} className="text-sm font-medium">
                        IPv4 address / prefix
                      </label>
                      <Input
                        id={`address-${entry.key}`}
                        controlSize="md"
                        value={entry.address ?? ''}
                        placeholder="10.61.100.1/24"
                        required
                        onChange={(event) => update(entry.key, { address: event.target.value })}
                      />
                    </div>
                    {entry.role === 'wan' ? (
                      <div className="space-y-2">
                        <label htmlFor={`gateway-${entry.key}`} className="text-sm font-medium">
                          Upstream gateway
                        </label>
                        <Input
                          id={`gateway-${entry.key}`}
                          controlSize="md"
                          value={entry.gateway ?? ''}
                          required
                          onChange={(event) => update(entry.key, { gateway: event.target.value })}
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label
                          htmlFor={`advertisement-${entry.key}`}
                          className="text-sm font-medium"
                        >
                          Advertised subnet (optional)
                        </label>
                        <Input
                          id={`advertisement-${entry.key}`}
                          controlSize="md"
                          value={entry.advertisedPrefix ?? ''}
                          placeholder="10.61.100.0/24"
                          onChange={(event) =>
                            update(entry.key, { advertisedPrefix: event.target.value || null })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave blank to exclude this subnet from fabric advertisement.
                        </p>
                      </div>
                    )}
                  </>
                )}
                <div className="space-y-2">
                  <label htmlFor={`mtu-${entry.key}`} className="text-sm font-medium">
                    MTU
                  </label>
                  <Input
                    id={`mtu-${entry.key}`}
                    controlSize="md"
                    type="number"
                    min={576}
                    max={9000}
                    required
                    value={entry.mtu}
                    onChange={(event) => update(entry.key, { mtu: Number(event.target.value) })}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(event) => update(entry.key, { enabled: event.target.checked })}
                  />
                  Enabled in candidate configuration
                </label>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setRows((current) => current.filter((row) => row.key !== entry.key))
                    }
                  >
                    {entry.vlanId === null
                      ? 'Remove interface settings from draft'
                      : `Remove VLAN ${entry.vlanId} from draft`}
                  </Button>
                )}
              </div>
            </fieldset>
          ))}
          {!readOnly && (
            <div className="flex flex-wrap gap-3">
              {kind === 'vlan' && (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  disabled={rows.length >= 16}
                  onClick={() =>
                    setRows((current) => [
                      ...current,
                      {
                        key: crypto.randomUUID(),
                        interfaceName: reportedInterface.name,
                        vlanId:
                          Array.from({ length: 4094 }, (_, index) => index + 1).find(
                            (tag) =>
                              !rows.some(
                                (row) =>
                                  row.interfaceName === reportedInterface.name &&
                                  row.vlanId === tag,
                              ),
                          ) ?? 1,
                        role: 'lan',
                        mode: 'static',
                        address: null,
                        gateway: null,
                        advertisedPrefix: null,
                        enabled: true,
                        mtu: reportedInterface.mtu,
                      },
                    ])
                  }
                >
                  Add VLAN on {reportedInterface.name}
                </Button>
              )}
              <Button type="submit" size="md">
                {busy ? 'Saving…' : 'Save interface draft'}
              </Button>
              <Button type="submit" size="md" data-apply="true" disabled={!canApply}>
                Save and apply
              </Button>
            </div>
          )}
        </fieldset>
        <p className="text-sm">
          Safe commit: <strong>60 seconds</strong>. The appliance restores the previous confirmed
          configuration if controller confirmation fails.
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          A LAN advertisement uses its IPv4 subnet. This apply adapter does not enable route
          advertisement or forwarding. VLANs require a configured external trunk. Saving a draft
          does not change the appliance.
        </p>
      </form>
      {notice && <Feedback tone="success">{notice}</Feedback>}
      {!canApply && (
        <p className="text-sm text-muted-foreground">
          {pending
            ? 'A commit is pending or requires recovery. Review its status below.'
            : !capability?.interfaces.includes(reportedInterface.name)
              ? 'Apply requires local authorization for this dedicated interface on the appliance.'
              : 'This apply release supports dedicated static LAN interfaces and VLANs without advertisement. WAN/DHCP and route advertisement are not available through this apply adapter.'}
        </p>
      )}
      {commits.filter(
        (commit) => commit.interfaceName === reportedInterface.name && commit.kind === kind,
      ).length > 0 && (
        <section aria-label="Interface commit history" className="space-y-3">
          <h3 className="text-sm font-semibold">Commit history</h3>
          <ul className="space-y-3">
            {commits
              .filter(
                (commit) => commit.interfaceName === reportedInterface.name && commit.kind === kind,
              )
              .map((commit) => (
                <li key={commit.id} className="space-y-2 rounded-lg border p-3 text-sm">
                  <p className="font-medium">{commitLabels[commit.status]}</p>
                  <p className="break-all text-xs text-muted-foreground">
                    {formatDateTime(commit.createdAt, timeZone)}
                    {commit.actorEmail ? ` · ${commit.actorEmail}` : ''}
                  </p>
                  {commit.reason && <p>{commit.reason.replaceAll('_', ' ')}</p>}
                  {commit.operation && <p>Failed step: {commit.operation.replaceAll('_', ' ')}</p>}
                  {commit.deadline && commit.status === 'awaiting_confirmation' && (
                    <p className="text-xs">
                      Confirmation deadline: {formatDateTime(commit.deadline, timeZone)}
                    </p>
                  )}
                  {!readOnly &&
                    commit.payload &&
                    ['rolled_back', 'rejected', 'rollback_failed'].includes(commit.status) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRows((current) => [
                            ...current.filter((entry) => !matchesSelection(entry)),
                            ...(commit.payload?.interfaces ?? []).map((entry) => ({
                              ...entry,
                              key: crypto.randomUUID(),
                            })),
                          ]);
                          setNotice(
                            'Failed settings loaded. Correct them, then save and apply as a new commit.',
                          );
                        }}
                      >
                        Edit and retry
                      </Button>
                    )}
                </li>
              ))}
          </ul>
        </section>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => setReload((current) => current + 1)}
      >
        Reload saved interface draft
      </Button>
    </div>
  );
}

const commitLabels: Record<InterfaceCommitView['status'], string> = {
  queued: 'Queued for agent',
  applying: 'Applying',
  awaiting_confirmation: 'Awaiting controller confirmation',
  applied: 'Applied',
  rolled_back: 'Rolled back',
  rejected: 'Rejected',
  rollback_failed: 'Recovery required',
};
