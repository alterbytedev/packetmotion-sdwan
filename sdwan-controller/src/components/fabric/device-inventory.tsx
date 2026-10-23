'use client';

import { CircleHelp, CirclePlus, Radio, RefreshCw, Router, Search, Server, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { connectionStatusLabels } from '@/components/fabric/connection-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Feedback } from '@/components/ui/feedback';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Pagination } from '@/components/ui/pagination';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableToolbar,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { Inventory, OperatorRole } from '@/lib/fabric/types';
import { type EnrollmentDetails, EnrollmentInstructions } from './enrollment-details';

export function DeviceInventory({ inventory, role }: { inventory: Inventory; role: OperatorRole }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<'node' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [enrollment, setEnrollment] = useState<EnrollmentDetails | null>(null);
  const [notice, setNotice] = useState('');
  const [routingHelpOpen, setRoutingHelpOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [refresh, setRefresh] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const viewKey = showArchived ? 'archived' : 'active';
  const [result, setResult] = useState({
    nodes: inventory.nodes,
    total: inventory.total ?? inventory.nodes.length,
    page: 1,
    pageSize: 25,
    viewKey: 'active',
  });
  const resultMatchesView = result.viewKey === viewKey;
  const isLoading = loading || (!resultMatchesView && !loadError);
  const filtered = resultMatchesView ? result.nodes : [];
  const hasRows = !isLoading && !loadError && filtered.length > 0;
  const allVisibleSelected = filtered.length > 0 && filtered.every((node) => selectedIds.includes(node.id));
  const connected =
    showArchived
      ? 0
      : inventory.connected ??
        inventory.nodes.filter((node) => node.connectionStatus === 'management-connected').length;
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setLoadError(false);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          search,
          page: String(page),
          pageSize: String(pageSize),
          refresh: String(refresh),
          archived: String(showArchived),
        });
        let loaded = false;
        for (let attempt = 0; attempt < 3 && !loaded; attempt += 1) {
          try {
            const response = await fetch(`/api/operator/nodes?${params}`, {
              cache: 'no-store',
              signal: abort.signal,
            });
            if (response.status >= 500 && attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
              continue;
            }
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to load devices.');
            if (!abort.signal.aborted) {
              setResult({ ...data, viewKey });
              setSelectedIds((current) => current.filter((id) => data.nodes.some((node: { id: string }) => node.id === id)));
            }
            loaded = true;
          } catch (cause) {
            if (abort.signal.aborted) return;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
            else throw cause;
          }
        }
        if (!abort.signal.aborted && !loaded) setLoadError(true);
      } catch {
        if (!abort.signal.aborted) setLoadError(true);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [search, page, pageSize, refresh, showArchived, viewKey]);
  useEffect(() => {
    const timer = setInterval(() => setRefresh((value) => value + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setNotice('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/operator/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save inventory.');
      setForm(null);
      setNotice('Device added.');
      setEnrollment(result.enrollment);
      setPage(1);
      setRefresh((value) => value + 1);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save inventory.');
    } finally {
      setPending(false);
    }
  }

  async function generateToken(id: string) {
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/operator/nodes/${id}/enrollment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to create enrollment token.');
      setEnrollment(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create enrollment token.');
    } finally {
      setPending(false);
    }
  }

  async function permanentlyDelete(ids: string[], names: string[]) {
    const confirmation = ids.length === 1
      ? `Permanently delete archived device “${names[0]}”? This cannot be undone.`
      : `Permanently delete ${ids.length} selected archived devices? This cannot be undone.`;
    if (!window.confirm(confirmation)) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/operator/nodes/permanent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to permanently delete device.');
      setNotice(ids.length === 1
        ? `Archived device “${names[0]}” permanently deleted.`
        : `${ids.length} archived devices permanently deleted.`);
      setResult((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => !ids.includes(node.id)),
        total: Math.max(0, current.total - ids.length),
      }));
      setSelectedIds([]);
      setLoading(true);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to permanently delete device.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-lg">Device inventory</CardTitle>
            <CardDescription>Manage edge devices and hubs across your network.</CardDescription>
          </div>
          {role !== 'viewer' && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                setForm(form === 'node' ? null : 'node');
                setError('');
              }}
            >
              <CirclePlus /> Add device
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy={isLoading}>
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">Total devices</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{isLoading ? '—' : result.total}</p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">Management connected</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{isLoading ? '—' : connected}</p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">On this page</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{isLoading ? '—' : filtered.length}</p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">Showing</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {isLoading ? '—' : filtered.length}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                of {isLoading ? '—' : result.total}
              </span>
            </p>
          </div>
        </div>
        <p className="mb-4 rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          Management connection and configuration receipt are shown here. Network and tunnel health
          are unavailable.
        </p>
        {enrollment && (
          <EnrollmentInstructions enrollment={enrollment} onClose={() => setEnrollment(null)} />
        )}
        {notice && (
          <Feedback tone="success" presentation="panel" className="mb-5">
            {notice}
          </Feedback>
        )}
        {error && (
          <Feedback tone="error" presentation="panel" className="mb-5">
            {error}
          </Feedback>
        )}
        {role !== 'viewer' && form === 'node' && (
          <form
            onSubmit={(event) => submit(event)}
            className="mb-6 space-y-4 rounded-lg border bg-muted/30 p-4"
          >
            <h3 className="text-sm font-semibold">Add device</h3>
            <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 text-sm">
                <label htmlFor="device-name">Device name</label>
                <Input id="device-name" name="name" required maxLength={100} />
              </div>
              <div className="space-y-2 text-sm">
                <label htmlFor="device-kind">Device type</label>
                <Select id="device-kind" name="kind">
                  <option value="branch">Edge — connects a local network</option>
                  <option value="hub">Hub — connects edge devices</option>
                </Select>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-1">
                  <label htmlFor="device-mode">Routing mode</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-8 p-0 text-muted-foreground hover:text-foreground"
                    aria-label="About routing modes"
                    aria-expanded={routingHelpOpen}
                    aria-controls="device-routing-help"
                    onClick={() => setRoutingHelpOpen((open) => !open)}
                  >
                    <CircleHelp aria-hidden="true" />
                  </Button>
                </div>
                <Select id="device-mode" name="mode">
                  <option value="gateway">Gateway</option>
                  <option value="subnet-router">Subnet router</option>
                </Select>
                <div
                  id="device-routing-help"
                  hidden={!routingHelpOpen}
                  className="rounded-md border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground"
                >
                  <p>
                    <strong className="text-foreground">Gateway:</strong> use this Edge as the
                    site’s gateway for fabric traffic.
                  </p>
                  <p className="mt-1">
                    <strong className="text-foreground">Subnet router:</strong> advertise the LAN so
                    other sites can reach it.
                  </p>
                  <p className="mt-2">This records intent; it does not activate routing.</p>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <label htmlFor="device-prefix">LAN subnet (optional)</label>
                <Input id="device-prefix" name="lanPrefix" placeholder="10.61.0.0/24" />
              </div>
            </fieldset>
            <p className="text-xs text-muted-foreground">
              Registration records inventory. It does not enroll or configure the device.
            </p>
            <div className="flex gap-2">
              <Button disabled={pending}>{pending ? 'Saving…' : 'Save device'}</Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setForm(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
        <div className="overflow-hidden rounded-lg border shadow-sm">
          <TableToolbar>
            <div className="flex flex-wrap items-center gap-2">
              {role !== 'viewer' && (
                <Button variant={showArchived ? 'default' : 'outline'} size="sm" onClick={() => {
                  setShowArchived((value) => !value);
                  setSelectedIds([]);
                  setPage(1);
                  setSearch('');
                }}>
                  {showArchived ? 'Show active devices' : 'View archived devices'}
                </Button>
              )}
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {showArchived ? 'Archived devices' : 'Active devices'}
              </span>
              {showArchived && selectedIds.length > 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pending || isLoading}
                  onClick={() => {
                    const chosen = filtered.filter((node) => selectedIds.includes(node.id));
                    permanentlyDelete(chosen.map((node) => node.id), chosen.map((node) => node.name));
                  }}
                >
                  Delete selected ({selectedIds.length})
                </Button>
              )}
            </div>
            <div className="relative min-w-0 flex-1 sm:max-w-md">
              <Search
                aria-hidden="true"
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                controlSize="sm"
                className="pl-9 pr-10"
                aria-label="Search devices"
                placeholder="Search devices…"
                maxLength={100}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSelectedIds([]);
                  setPage(1);
                }}
              />
              {search && (
                <IconButton
                  size="xs"
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => {
                    setSearch('');
                    setSelectedIds([]);
                    setPage(1);
                  }}
                >
                  <X aria-hidden="true" />
                </IconButton>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              loading={isLoading}
              disabled={isLoading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          </TableToolbar>
          {/* Keyboard focus lets users scroll the table horizontally on narrow screens. */}
          <section
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-busy={isLoading}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region needs keyboard access
            tabIndex={0}
            aria-label="Device inventory table"
          >
            {isLoading && (
              <span className="sr-only" role="status">
                Loading {showArchived ? 'archived ' : ''}devices
              </span>
            )}
            <Table density="compact" aria-label={showArchived ? 'Archived devices' : 'Registered devices'} className={hasRows ? 'min-w-[560px]' : undefined}>
              <TableHeader className={hasRows ? undefined : 'sr-only'}>
                <TableRow>
                  {showArchived && (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all archived devices on this page"
                        checked={allVisibleSelected}
                        disabled={isLoading || filtered.length === 0}
                        onChange={(event) => setSelectedIds((current) => event.target.checked
                          ? [...new Set([...current, ...filtered.map((node) => node.id)])]
                          : current.filter((id) => !filtered.some((node) => node.id === id)))}
                      />
                    </TableHead>
                  )}
                  {['Device', 'Type', 'Management status', 'Actions'].map((title) => (
                    <TableHead
                      key={title}
                      className={title === 'Actions' ? 'text-right' : undefined}
                    >
                      {title}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  ['device', 'device-type', 'management-state', 'device-actions'].map(
                    (row) => (
                      <TableRow key={`loading-${row}`} aria-hidden="true">
                        {[
                          ['device-name', 40],
                          ['device-type', 18],
                          ['management-state', 24],
                          ['device-actions', 16],
                        ].map(([column, width]) => (
                          <TableCell key={column}>
                            <span
                              className="block h-3 motion-safe:animate-pulse rounded bg-muted"
                              style={{ width: `${width}%` }}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ),
                  )
                ) : loadError ? (
                  <TableRow>
                    <TableCell colSpan={showArchived ? 5 : 4} className="p-6 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                        <p className="text-sm font-medium">We couldn’t refresh the device list.</p>
                        <p className="text-xs text-muted-foreground">
                          Please try again in a moment.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRefresh((value) => value + 1)}
                        >
                          <RefreshCw aria-hidden="true" /> Try again
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filtered.length ? (
                  filtered.map((node) => (
                    <TableRow key={node.id}>
                      {showArchived && (
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${node.name}`}
                            checked={selectedIds.includes(node.id)}
                            disabled={pending}
                            onChange={(event) => setSelectedIds((current) => event.target.checked
                              ? [...current, node.id]
                              : current.filter((id) => id !== node.id))}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex min-w-40 items-center gap-3">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-primary">
                            {node.kind === 'hub' ? (
                              <Router size={15} aria-hidden="true" />
                            ) : (
                              <Radio size={15} aria-hidden="true" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <Link
                              className="block max-w-64 truncate font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              href={`/dashboard/devices/${node.id}`}
                            >
                              {node.name}
                            </Link>
                            {node.siteName !== node.name && (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {node.siteName}
                              </span>
                            )}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge tone="neutral" size="sm">
                          {node.kind === 'hub' ? 'Hub' : 'Edge device'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          size="sm"
                          tone={
                            node.connectionStatus === 'management-connected'
                              ? 'success'
                              : node.connectionStatus === 'revoked'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          <span
                            aria-hidden="true"
                            className={`size-1.5 rounded-full ${node.connectionStatus === 'management-connected' ? 'bg-emerald-600' : node.connectionStatus === 'revoked' ? 'bg-rose-600' : 'bg-current'}`}
                          />
                          {connectionStatusLabels[node.connectionStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {showArchived ? (
                            <Button type="button" variant="destructive" size="xs" disabled={pending}
                              onClick={() => permanentlyDelete([node.id], [node.name])}>
                              Delete permanently
                            </Button>
                          ) : <>
                          <Button asChild variant="ghost" size="xs">
                            <Link href={`/dashboard/devices/${node.id}`}>
                              {role !== 'viewer' ? 'Configure' : 'View'}
                            </Link>
                          </Button>
                          {role !== 'viewer' && node.connectionStatus === 'pending' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              disabled={pending}
                              onClick={() => generateToken(node.id)}
                            >
                              New token
                            </Button>
                          )}
                          </>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={showArchived ? 5 : 4} className="text-center">
                      <EmptyState
                        icon={<Server />}
                        title={search ? `No devices match “${search}”` : 'No devices added'}
                        description={
                          role !== 'viewer'
                            ? search
                              ? 'Try a different name or device type, or clear your search.'
                              : 'Add your first edge device or hub to get started.'
                            : 'An administrator can add a device.'
                        }
                        action={
                          !search && role !== 'viewer' ? (
                            <Button size="sm" onClick={() => setForm('node')}>
                              <CirclePlus aria-hidden="true" /> Add device
                            </Button>
                          ) : undefined
                        }
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>
          <Pagination
            page={result.page}
            pageSize={pageSize}
            total={result.total}
            loading={isLoading}
            pageSizeId="rows-per-page"
            itemLabel="devices"
            onPageChange={(nextPage) => {
              setSelectedIds([]);
              setPage(nextPage);
            }}
            onPageSizeChange={(size) => {
              setSelectedIds([]);
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
