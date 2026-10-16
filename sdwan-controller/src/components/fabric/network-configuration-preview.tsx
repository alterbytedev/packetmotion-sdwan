'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Plus, Settings2, Shield, SlidersHorizontal, Trash2, Waypoints } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal, ModalFooter } from '@/components/ui/modal';
import type { NodeRecord, OperatorRole } from '@/lib/fabric/types';

type Policy = { id: string; name: string; match: string; path: string; priority: string };
type FirewallRule = { id: string; name: string; source: string; destination: string; service: string; action: 'Allow' | 'Deny' };
type Section = 'topology' | 'policy' | 'firewall' | 'essentials';

const sectionTitles: Record<Section, string> = {
  topology: 'Routing preview',
  policy: 'Business policy',
  firewall: 'Firewall rule',
  essentials: 'Essential settings',
};

export function NetworkConfigurationPreview({ node, role }: { node: NodeRecord; role: OperatorRole }) {
  const [modal, setModal] = useState<Section | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const [mode, setMode] = useState(node.kind === 'hub' ? 'hub' : 'gateway');
  const [policies, setPolicies] = useState<Policy[]>([
    { id: 'voice', name: 'Voice and video', match: 'VoIP · video conferencing', path: 'Preferred uplink', priority: 'High' },
    { id: 'business', name: 'Business applications', match: 'ERP · Microsoft 365 · CRM', path: 'Best quality', priority: 'Normal' },
    { id: 'standard', name: 'Standard internet', match: 'All other traffic', path: 'Automatic', priority: 'Normal' },
  ]);
  const [rules, setRules] = useState<FirewallRule[]>([
    { id: 'branch-hub', name: 'Branch to hub services', source: 'LAN subnets', destination: 'Hub resources', service: 'TCP/UDP · selected ports', action: 'Allow' },
    { id: 'inbound', name: 'Block unsolicited inbound', source: 'Any', destination: 'WAN interface', service: 'Any', action: 'Deny' },
  ]);
  const [dns, setDns] = useState('1.1.1.1, 8.8.8.8');
  const [nat, setNat] = useState('Outbound NAT · automatic');
  const [management, setManagement] = useState('Restricted to management network');
  const isAdmin = role !== 'viewer';

  function saveForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) || '').trim();
    if (modal === 'topology') {
      setMode(value('mode'));
    } else if (modal === 'policy') {
      const item = { id: crypto.randomUUID(), name: value('name'), match: value('match'), path: value('path'), priority: value('priority') };
      setPolicies((current) => [...current, item]);
    } else if (modal === 'firewall') {
      const item: FirewallRule = { id: crypto.randomUUID(), name: value('name'), source: value('source'), destination: value('destination'), service: value('service'), action: value('action') as FirewallRule['action'] };
      setRules((current) => [...current, item]);
    } else if (modal === 'essentials') {
      setDns(value('dns'));
      setNat(value('nat'));
      setManagement(value('management'));
    }
    setPreviewed(false);
    setModal(null);
  }

  return (
    <Card id="network-configuration">
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2"><CardTitle>Network configuration</CardTitle><Badge className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">Preview only</Badge></div>
          <CardDescription>Plan routing, interfaces, business traffic, and firewall rules for this device.</CardDescription>
        </div>
        {isAdmin && <Button type="button" variant="outline" onClick={() => setModal('topology')}><Settings2 /> Configure</Button>}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          Changes stay in this browser preview. They are not saved, published, or applied to the device.
        </div>

        <SummarySection icon={<Waypoints aria-hidden="true" />} title="Routing preview" action={isAdmin ? <Button type="button" variant="ghost" size="sm" onClick={() => setModal('topology')}>Edit</Button> : undefined}>
          <SummaryRow label="Operating mode" value={modeLabel(mode)} />
          <SummaryRow label="Hub connections" value="Managed in the saved connections above" />
          <SummaryRow label="Advertised LAN" value="Managed in the saved LAN profile above" />
          <SummaryRow label="Routing protocol" value="BGP IPv4 unicast" />
        </SummarySection>

        <SummarySection icon={<Settings2 aria-hidden="true" />} title="Interfaces and IP addressing">
          <p className="text-xs leading-5 text-muted-foreground">Use the saved LAN network settings above. WAN and management addressing remain outside this preview.</p>
        </SummarySection>

        <SummarySection icon={<SlidersHorizontal aria-hidden="true" />} title="Business policy" action={isAdmin ? <Button type="button" variant="outline" size="sm" onClick={() => setModal('policy')}><Plus /> Add policy</Button> : undefined}>
          <div className="divide-y rounded-lg border">
            {policies.map((policy) => <div key={policy.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"><div className="min-w-44 flex-1"><p className="text-sm font-medium">{policy.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{policy.match}</p></div><span className="text-sm text-muted-foreground">{policy.path}</span><Badge>{policy.priority}</Badge>{policy.id !== 'voice' && policy.id !== 'business' && policy.id !== 'standard' && isAdmin && <button type="button" aria-label={`Remove ${policy.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setPolicies((current) => current.filter((entry) => entry.id !== policy.id))}><Trash2 size={15} /></button>}</div>)}
          </div>
        </SummarySection>

        <SummarySection icon={<Shield aria-hidden="true" />} title="Basic firewall" action={isAdmin ? <Button type="button" variant="outline" size="sm" onClick={() => setModal('firewall')}><Plus /> Add rule</Button> : undefined}>
          <div className="divide-y rounded-lg border">
            {rules.map((rule) => <div key={rule.id} className="grid gap-2 px-3 py-2.5 text-sm sm:grid-cols-[1.2fr_1fr_1fr_1fr_auto_auto] sm:items-center"><span className="font-medium">{rule.name}</span><span className="text-muted-foreground">{rule.source}</span><span className="text-muted-foreground">{rule.destination}</span><span className="text-muted-foreground">{rule.service}</span><Badge className={rule.action === 'Allow' ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300' : 'border-rose-600/30 bg-rose-600/10 text-rose-800 dark:text-rose-300'}>{rule.action}</Badge>{rule.id !== 'branch-hub' && rule.id !== 'inbound' && isAdmin && <button type="button" aria-label={`Remove ${rule.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setRules((current) => current.filter((entry) => entry.id !== rule.id))}><Trash2 size={15} /></button>}</div>)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Default-deny is the intended baseline. Rules shown here are examples only.</p>
        </SummarySection>

        <SummarySection icon={<Settings2 aria-hidden="true" />} title="Other essentials" action={isAdmin ? <Button type="button" variant="ghost" size="sm" onClick={() => setModal('essentials')}>Edit</Button> : undefined}>
          <SummaryRow label="DNS resolvers" value={dns || 'Not set'} />
          <SummaryRow label="NAT behavior" value={nat} />
          <SummaryRow label="Management access" value={management} />
        </SummarySection>

        <div className="flex flex-wrap items-center gap-3 border-t pt-5">
          {isAdmin && <Button type="button" onClick={() => setPreviewed(true)}>Preview configuration <ArrowRight /></Button>}
          <span className="text-xs text-muted-foreground">Preview checks this mockup only; it does not save or publish a device revision.</span>
        </div>
        {previewed && <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Preview ready. No configuration was saved or sent to {node.name}.</p>}
        {!isAdmin && <p className="text-xs text-muted-foreground">Viewer access is read-only.</p>}
      </CardContent>

      <Modal open={modal !== null} onOpenChange={(open) => !open && setModal(null)} title={modal ? sectionTitles[modal] : 'Network settings'} description="Preview values only. Nothing is saved or sent to the device." size="lg">
        {modal && <form key={modal} onSubmit={saveForm} className="space-y-4">
          {modal === 'topology' && <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Operating mode" htmlFor="modal-mode"><Select id="modal-mode" name="mode" defaultValue={mode}><option value="gateway">Gateway — WAN and LAN routing</option><option value="subnet-router">Subnet router — advertise a LAN</option><option value="hub">Hub — connect branch sites</option></Select></Field>
            <Field label="Routing protocol" htmlFor="modal-routing"><Select id="modal-routing" defaultValue="BGP IPv4 unicast" disabled><option>BGP IPv4 unicast</option></Select></Field>
          </div>}
          {modal === 'policy' && <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Policy name" htmlFor="policy-name"><Input id="policy-name" name="name" placeholder="Critical business apps" required /></Field>
            <Field label="Application / traffic" htmlFor="policy-match"><Input id="policy-match" name="match" placeholder="ERP, VoIP, TCP/443" required /></Field>
            <Field label="Preferred path" htmlFor="policy-path"><Select id="policy-path" name="path"><option>Best quality</option><option>Preferred uplink</option><option>Primary uplink</option><option>Backup uplink</option><option>Automatic</option></Select></Field>
            <Field label="Priority" htmlFor="policy-priority"><Select id="policy-priority" name="priority"><option>Normal</option><option>High</option><option>Low</option></Select></Field>
          </div>}
          {modal === 'firewall' && <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rule name" htmlFor="rule-name"><Input id="rule-name" name="name" placeholder="Allow branch app access" required /></Field>
            <Field label="Action" htmlFor="rule-action"><Select id="rule-action" name="action" defaultValue="Allow"><option>Allow</option><option>Deny</option></Select></Field>
            <Field label="Source network" htmlFor="rule-source"><Input id="rule-source" name="source" placeholder="10.61.0.0/24" required /></Field>
            <Field label="Destination network" htmlFor="rule-destination"><Input id="rule-destination" name="destination" placeholder="10.62.0.0/24" required /></Field>
            <Field label="Protocol and port" htmlFor="rule-service"><Input id="rule-service" name="service" placeholder="TCP 443" required /></Field>
          </div>}
          {modal === 'essentials' && <div className="grid gap-4 sm:grid-cols-2">
            <Field label="DNS resolvers" htmlFor="essential-dns"><Input id="essential-dns" name="dns" defaultValue={dns} placeholder="1.1.1.1, 8.8.8.8" /></Field>
            <Field label="NAT behavior" htmlFor="essential-nat"><Select id="essential-nat" name="nat" defaultValue={nat}><option>Outbound NAT · automatic</option><option>Disabled · routed LAN</option></Select></Field>
            <Field label="Management access" htmlFor="essential-management"><Select id="essential-management" name="management" defaultValue={management}><option>Restricted to management network</option><option>Disabled on WAN</option></Select></Field>
          </div>}
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit">Add to preview</Button>
          </ModalFooter>
        </form>}
      </Modal>
    </Card>
  );
}

function modeLabel(value: string) {
  if (value === 'subnet-router') return 'Subnet router';
  if (value === 'hub') return 'Hub';
  return 'Gateway';
}

function SummarySection({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><span className="text-muted-foreground">{icon}</span>{title}</h3>{action}</div><div className="space-y-1">{children}</div></section>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-3 py-2.5 text-sm"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return <div className="space-y-2"><label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>{children}</div>;
}
