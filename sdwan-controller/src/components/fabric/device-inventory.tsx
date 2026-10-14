'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CirclePlus, Search, Server, Router, Radio, RefreshCw, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { connectionStatusLabels } from '@/components/fabric/connection-status';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EnrollmentInstructions, type EnrollmentDetails } from './enrollment-details';
import type { Inventory, OperatorRole } from '@/lib/fabric/types';

export function DeviceInventory({ inventory, role }: { inventory: Inventory; role: OperatorRole }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<'node' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [enrollment, setEnrollment] = useState<EnrollmentDetails | null>(null);
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState({
    nodes: inventory.nodes,
    total: inventory.total ?? inventory.nodes.length,
    page: 1,
    pageSize: 25,
  });
  const filtered = result.nodes;
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const connected =
    inventory.connected ??
    inventory.nodes.filter((node) => node.connectionStatus === 'connected').length;
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          search,
          page: String(page),
          pageSize: String(pageSize),
          refresh: String(refresh),
        });
        const response = await fetch(`/api/operator/nodes?${params}`, {
          cache: 'no-store',
          signal: abort.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load devices.');
        if (!abort.signal.aborted) setResult(data);
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Unable to load devices.');
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [search, page, pageSize, refresh]);

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
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">Total devices</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{result.total}</p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">Controller connected</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{connected}</p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">On this page</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{filtered.length}</p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">Showing</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {filtered.length}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                of {result.total}
              </span>
            </p>
          </div>
        </div>
        <p className="mb-4 rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          Connection reflects the controller management heartbeat. Tunnel and routing health are not
          shown here.
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
                <label htmlFor="device-mode">Routing mode</label>
                <Select id="device-mode" name="mode">
                  <option value="gateway">Gateway</option>
                  <option value="subnet-router">Subnet router</option>
                </Select>
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
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search
              aria-hidden="true"
              size={16}
              className="absolute left-3 top-3.5 text-muted-foreground"
            />
            <Input
              className="pl-9"
              aria-label="Search devices"
              placeholder="Search devices…"
              maxLength={100}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            {search && (
              <Button
                type="button"
                variant="unstyled"
                size="icon-sm"
                aria-label="Clear search"
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
        <div className="overflow-x-auto" aria-busy={loading}>
          <table aria-label="Registered devices" className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-y bg-muted/60 text-[10px] tracking-wide text-muted-foreground">
              <tr>
                {['DEVICE', 'TYPE', 'STATUS', 'ACTIONS'].map((title) => (
                  <th scope="col" key={title} className="px-4 py-3 font-medium">
                    {title || 'ACTIONS'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading || error ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted-foreground">
                    <span role={loading ? 'status' : undefined}>
                      {loading ? 'Loading devices…' : 'Devices could not be loaded.'}
                    </span>
                  </td>
                </tr>
              ) : filtered.length ? (
                filtered.map((node) => (
                  <tr key={node.id} className="border-b transition-colors hover:bg-muted/30">
                    <td className="px-4 py-4">
                      <div className="flex min-w-40 items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-primary">
                          {node.kind === 'hub' ? (
                            <Router size={17} aria-hidden="true" />
                          ) : (
                            <Radio size={17} aria-hidden="true" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <Link
                            className="block truncate font-medium text-foreground hover:text-primary"
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
                    </td>
                    <td className="px-4 py-4">
                      <Badge className="bg-muted/50 text-foreground">
                        {node.kind === 'hub' ? 'Hub' : 'Edge device'}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <Badge
                        className={
                          node.connectionStatus === 'connected'
                            ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300'
                            : node.connectionStatus === 'revoked'
                              ? 'border-rose-600/30 bg-rose-600/10 text-rose-800 dark:text-rose-300'
                              : ''
                        }
                      >
                        <span
                          aria-hidden="true"
                          className={`size-1.5 rounded-full ${node.connectionStatus === 'connected' ? 'bg-emerald-600' : node.connectionStatus === 'revoked' ? 'bg-rose-600' : 'bg-current'}`}
                        />
                        {connectionStatusLabels[node.connectionStatus]}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/dashboard/devices/${node.id}`}>
                            {role !== 'viewer' ? 'Configure' : 'View'}
                          </Link>
                        </Button>
                        {role !== 'viewer' && node.connectionStatus === 'not-enrolled' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => generateToken(node.id)}
                          >
                            New token
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="p-8 text-center">
                    <Server className="mx-auto mb-3 text-muted-foreground" />
                    <p className="font-medium">
                      {search ? `No devices match “${search}”` : 'No devices added'}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {role !== 'viewer'
                        ? search
                          ? 'Try a different name or device type, or clear your search.'
                          : 'Add your first edge device or hub to get started.'
                        : 'An administrator can add a device.'}
                    </p>
                    {!search && role !== 'viewer' && (
                      <Button size="sm" className="mt-4" onClick={() => setForm('node')}>
                        <CirclePlus aria-hidden="true" /> Add device
                      </Button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <label htmlFor="rows-per-page">Rows per page</label>
            <Select
              id="rows-per-page"
              aria-label="Rows per page"
              containerClassName="w-auto"
              className="h-10 min-w-20 w-auto pr-10 font-medium"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || result.page <= 1}
              onClick={() => setPage(result.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || result.page * result.pageSize >= result.total}
              onClick={() => setPage(result.page + 1)}
            >
              Next
            </Button>
          </div>
          <span className="w-full text-center sm:w-auto sm:text-right">
            Page {result.page} of {pageCount} · {result.total} devices
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
