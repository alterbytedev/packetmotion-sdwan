'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bug,
  Check,
  ChevronRight,
  CircleHelp,
  CirclePlus,
  FileSliders,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  Server,
  Settings2,
  ShieldCheck,
  Wifi,
  X,
} from 'lucide-react';
import { logout } from '@/app/login/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { connectionStatusLabels } from '@/components/fabric/connection-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DeviceDetails } from '@/components/fabric/device-details';
import { DeviceInventory } from '@/components/fabric/device-inventory';
import { ControllerHealthCard } from '@/components/fabric/controller-health-card';
import { ControllerSettings } from '@/components/fabric/controller-settings';
import { BrandLogo } from '@/components/brand-logo';
import type { Inventory, NodeRecord, OperatorRole } from '@/lib/fabric/types';
import { cn } from '@/lib/utils';

export const views = ['overview', 'devices', 'telemetry', 'settings'] as const;
export type DashboardView = (typeof views)[number];
const navigation = [
  { view: 'overview', href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { view: 'devices', href: '/dashboard/devices', label: 'Devices', icon: RouterIcon },
  { view: 'telemetry', href: '/dashboard/telemetry', label: 'Telemetry', icon: Activity },
] as const;
function RouterIcon({ size = 18 }: { size?: number }) {
  return <Radio size={size} />;
}

export function ControllerDashboard({
  email,
  view,
  inventory,
  role,
  inventoryError,
  selectedDevice,
}: {
  email: string;
  view: DashboardView;
  inventory: Inventory;
  role: OperatorRole;
  inventoryError?: string;
  selectedDevice?: NodeRecord;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => {
      setDesktop(media.matches);
      if (media.matches) setMobileOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileOpen || desktop) return;
    const panel = navigationRef.current;
    if (!panel) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        panel.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]'),
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      if (!window.matchMedia('(min-width: 1024px)').matches) triggerRef.current?.focus();
    };
  }, [mobileOpen, desktop]);
  const [health, setHealth] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [checkedAt, setCheckedAt] = useState('');
  const title =
    view === 'settings'
      ? 'Settings'
      : navigation.find((item) => item.view === view)?.label || 'Overview';
  const initials = email.slice(0, 2).toUpperCase();
  const roleLabel = inventoryError
    ? 'Role unavailable'
    : role === 'superadmin'
      ? 'Superadmin'
      : role === 'admin'
      ? 'Administrator'
      : 'Viewer';

  async function checkHealth() {
    setHealth('checking');
    try {
      const response = await fetch('/api/health', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json();
      setHealth(response.ok && result.status === 'ok' ? 'ok' : 'error');
    } catch {
      setHealth('error');
    }
    setCheckedAt(new Date().toLocaleTimeString());
  }

  const status =
    health === 'ok'
      ? 'Responding'
      : health === 'error'
        ? 'Unreachable'
        : health === 'checking'
          ? 'Checking…'
          : 'Not checked';
  return (
    <div className="min-h-screen bg-[#f7f9fa]">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="dashboard-navigation"
        ref={navigationRef}
        inert={!desktop && !mobileOpen}
        {...(mobileOpen && !desktop ? { role: 'dialog', 'aria-modal': true } : {})}
        aria-label="Controller navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r bg-white transition-transform lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Link href="/dashboard" aria-label="SD-WAN CONTROLLER" className="flex h-[84px] items-center gap-3 px-6">
          <div className="flex h-12 min-w-0 flex-1 items-center justify-center rounded-md bg-white px-1">
            <BrandLogo compact />
          </div>
        </Link>
        <div className="mx-4 mb-7 flex items-center gap-3 rounded-lg border bg-[#fafbfc] px-3 py-3">
          <div className="flex size-8 items-center justify-center rounded-md border bg-white">
            <Globe2 size={16} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs font-semibold">Controller workspace</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Operator access</p>
          </div>
          <ShieldCheck size={14} className="ml-auto text-primary" />
        </div>
        <p className="mb-3 px-6 text-[10px] font-semibold tracking-[.14em] text-muted-foreground">
          NETWORK MANAGEMENT
        </p>
        <nav aria-label="Main navigation" className="space-y-1 px-3">
          {navigation.map((item) => (
            <Link
              key={item.view}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              aria-current={view === item.view ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors',
                view === item.view
                  ? 'bg-accent font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <item.icon size={18} />
              {item.label}
              {item.view === 'devices' && (
                <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px]">
                  {inventoryError ? '—' : (inventory.total ?? inventory.nodes.length)}
                </span>
              )}
            </Link>
          ))}
          {role === 'superadmin' && (
            <Link
              href="/diagnosticlogs"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Bug size={18} /> Diagnostics
            </Link>
          )}
        </nav>
        <div className="mt-auto px-3 pb-3">
          <div className="mx-1 mb-5 rounded-lg border bg-[#fafbfc] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <CircleHelp size={15} /> Getting started
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Add an edge device or hub to get started.
            </p>
            <Link
              href="/dashboard/devices"
              onClick={() => setMobileOpen(false)}
              className="mt-3 flex items-center gap-1 text-xs font-medium text-primary"
            >
              Manage devices <ArrowUpRight size={13} />
            </Link>
          </div>
          <Link
            href="/dashboard/settings"
            onClick={() => setMobileOpen(false)}
            aria-current={view === 'settings' ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground hover:bg-muted',
              view === 'settings' && 'bg-accent text-primary',
            )}
          >
            <Settings2 size={18} /> Settings
          </Link>
          <form action={logout}>
            <Button variant="ghost" className="w-full justify-start px-3 text-muted-foreground">
              <LogOut /> Sign out
            </Button>
          </form>
        </div>
        <div className="flex items-center gap-3 border-t px-5 py-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-primary">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{email}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{roleLabel}</p>
          </div>
        </div>
        {mobileOpen && (
          <Button
            ref={closeRef}
            className="fixed left-[202px] top-5 z-50 lg:hidden"
            variant="ghost"
            size="icon"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          >
            <X />
          </Button>
        )}
      </aside>
      <div className="lg:ml-[248px]" inert={mobileOpen && !desktop}>
        <header className="flex h-[72px] items-center justify-between border-b bg-white px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              ref={triggerRef}
              aria-controls="dashboard-navigation"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
              className="lg:hidden"
            >
              <Menu />
            </Button>
            <span className="hidden text-xs text-muted-foreground sm:inline">Workspace</span>
            <ChevronRight size={13} className="hidden text-muted-foreground sm:block" />
            <span className="text-xs font-medium">{title}</span>
          </div>
          <div className="flex items-center gap-4">
            <Badge className="hidden border-emerald-200 bg-emerald-50 text-emerald-700 sm:inline-flex">
              <ShieldCheck size={12} /> Authenticated
            </Badge>
            <div className="flex size-8 items-center justify-center rounded-full border bg-muted text-[11px] font-semibold">
              {initials}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] p-5 sm:p-8 xl:p-10">
          <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="mb-2 text-[10px] font-semibold tracking-[.15em] text-primary">
                YOUR NETWORK AT A GLANCE
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
                {view === 'overview' ? 'Network overview' : title}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {view === 'overview'
                  ? 'A clear view of your devices and network health.'
                  : descriptions[view]}
              </p>
            </div>
            {view === 'overview' && (
              <Button asChild>
                <Link href="/dashboard/devices">
                  <CirclePlus /> Add a device
                </Link>
              </Button>
            )}
          </div>
          {view === 'overview' && (
            <>
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#dce9e3] bg-[#eff7f3] p-4">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-primary">
                  <Wifi size={17} />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    Your workspace is ready. Let’s connect your network.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#668477]">
                    Operator access is configured. Device enrollment and network data are the next
                    step.
                  </p>
                </div>
                <Link
                  href="/dashboard/devices"
                  aria-label="View devices"
                  className="ml-auto mt-2 text-primary"
                >
                  <ArrowRight size={18} />
                </Link>
              </div>
              <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    title: 'Total devices',
                    icon: Server,
                    value: inventoryError ? '—' : String(inventory.total ?? inventory.nodes.length),
                    note: inventoryError ? 'Inventory unavailable' : 'Registered inventory',
                  },
                  {
                    title: 'Management connected',
                    icon: Globe2,
                    value: inventoryError
                      ? '—'
                      : String(
                          inventory.connected ??
                            inventory.nodes.filter((node) => node.connectionStatus === 'management-connected')
                              .length,
                        ),
                    note: 'Fresh heartbeat and latest revision received',
                  },
                  {
                    title: 'Active configurations',
                    icon: FileSliders,
                    value: '—',
                    note: 'Network configuration pending',
                  },
                  {
                    title: 'Network availability',
                    icon: Activity,
                    value: '—',
                    note: 'Awaiting device telemetry',
                  },
                ].map((stat) => (
                  <Card key={stat.title}>
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">{stat.title}</p>
                        <stat.icon size={17} className="text-muted-foreground" />
                      </div>
                      <p className="mt-4 text-3xl font-semibold tracking-tight">{stat.value}</p>
                      <p className="mt-3 text-[11px] text-muted-foreground">{stat.note}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <div>
                      <CardTitle>Devices</CardTitle>
                      <CardDescription className="mt-1">
                        Your managed network, in one place.
                      </CardDescription>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href="/dashboard/devices">
                        View all <ArrowUpRight />
                      </Link>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 border-y bg-muted/60 px-4 py-3 text-[10px] font-medium tracking-wide text-muted-foreground">
                      <span>DEVICE</span>
                      <span>STATUS</span>
                      <span>LAST SEEN</span>
                    </div>
                    {(inventory.total ?? inventory.nodes.length) > 0 ? (
                      <div>
                        {inventory.nodes.slice(0, 5).map((node) => (
                          <div
                            key={node.id}
                            className="grid grid-cols-3 gap-2 border-b px-4 py-4 text-xs"
                          >
                            <span className="break-words font-medium">{node.name}</span>
                            <span>{connectionStatusLabels[node.connectionStatus]}</span>
                            <span className="break-words text-muted-foreground">
                              {node.lastSeenAt || 'No check-in'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex min-h-60 flex-col items-center justify-center py-8 text-center">
                        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border bg-muted/50">
                          <Radio size={25} className="text-muted-foreground" />
                        </div>
                        <h3 className="text-sm font-semibold">No devices connected</h3>
                        <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
                          Device management status will appear here after its agent connects.
                        </p>
                        <Button asChild variant="outline" size="sm" className="mt-5">
                          <Link href="/dashboard/devices">
                            Add a device <ArrowRight />
                          </Link>
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Setup checklist</CardTitle>
                    <CardDescription>Build the foundation for your network.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-5 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Workspace progress</span>
                      <span className="font-medium">
                        {(inventory.total ?? inventory.nodes.length) > 0 ? 2 : 1} of 4 steps
                      </span>
                    </div>
                    <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full rounded-full bg-primary',
                          (inventory.total ?? inventory.nodes.length) > 0 ? 'w-1/2' : 'w-1/4',
                        )}
                      />
                    </div>
                    <div className="space-y-5">
                      {[
                        {
                          title: 'Configure operator access',
                          note: 'Your account is ready',
                          done: true,
                        },
                        {
                          title: 'Add a device',
                          note:
                            (inventory.total ?? inventory.nodes.length) > 0
                              ? 'Device added'
                              : 'Register an edge device or hub',
                          done: (inventory.total ?? inventory.nodes.length) > 0,
                        },
                        {
                          title: 'Connect a device',
                          note: 'Connection unavailable',
                          done: false,
                        },
                        {
                          title: 'Publish a configuration',
                          note: 'Set your desired network state',
                          done: false,
                        },
                      ].map((item, index) => (
                        <div key={item.title} className="flex gap-3">
                          <div
                            className={cn(
                              'flex size-6 shrink-0 items-center justify-center rounded-full text-[10px]',
                              item.done ? 'bg-accent text-primary' : 'border text-muted-foreground',
                            )}
                          >
                            {item.done ? <Check size={13} /> : index + 1}
                          </div>
                          <div>
                            <p className="text-xs font-medium">{item.title}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">{item.note}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <ControllerHealthCard
                  status={status}
                  checking={health === 'checking'}
                  checkedAt={checkedAt}
                  onRefresh={checkHealth}
                  error={health === 'error'}
                />
                <Card>
                  <CardHeader>
                    <CardTitle>Network activity</CardTitle>
                    <CardDescription>Enrollment, configuration, and device events.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-start gap-3 rounded-lg border border-dashed p-4">
                      <Activity size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
                      <p className="text-xs leading-5 text-muted-foreground">
                        No network events yet. Activity will appear when devices connect and event
                        storage is enabled.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
          {view === 'devices' &&
            (inventoryError ? (
              <Card>
                <CardHeader>
                  <CardTitle>Device inventory</CardTitle>
                </CardHeader>
                <CardContent>
                  <Feedback tone="error" className="text-muted-foreground">
                    {inventoryError}
                  </Feedback>
                </CardContent>
              </Card>
            ) : selectedDevice ? (
              <DeviceDetails node={selectedDevice} role={role} />
            ) : (
              <DeviceInventory inventory={inventory} role={role} />
            ))}
          {view === 'telemetry' && (
            <div className="grid gap-6 xl:grid-cols-2">
              <DeviceSelection />
              <ControllerHealthCard
                status={status}
                checking={health === 'checking'}
                checkedAt={checkedAt}
                onRefresh={checkHealth}
                error={health === 'error'}
              />
            </div>
          )}
          {view === 'settings' && <ControllerSettings email={email} roleLabel={roleLabel} role={role} isSuperadmin={role === 'superadmin'} />}
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t pt-5 text-[10px] text-muted-foreground">
            <span>SD-WAN Controller · Operator workspace</span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={12} /> Server-authenticated session
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}

const descriptions: Record<Exclude<DashboardView, 'overview'>, string> = {
  devices: 'Manage your edge devices and hubs.',
  telemetry: 'Understand device connectivity and controller availability.',
  settings: 'Manage your operator session and controller setup.',
};

function DeviceSelection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Device telemetry</CardTitle>
        <CardDescription>
          Open a device to review its latest check-in and interfaces.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/dashboard/devices">
            Browse devices <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
