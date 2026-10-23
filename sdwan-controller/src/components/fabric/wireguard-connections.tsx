'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatDateTime } from '@/lib/date-format';
import { useControllerTimeZone } from '@/lib/time-zone-context';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Feedback } from '@/components/ui/feedback';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  deploymentStatus,
  type WireguardDeployment,
  type WireguardSettings,
} from '@/lib/fabric/wireguard-deployment-status';
import { WireguardDeploymentStatus } from './wireguard-deployment';
import type { NodeRecord, OperatorRole } from '@/lib/fabric/types';

type Connections = {
  observed: {
    revision: number;
    status: 'disabled' | 'applied' | 'failed';
    receivedAt: string;
    handshakes: { name: string; lastHandshake: number }[];
    bgpPeers: { address: string; state: string; receivedPrefixes: number }[];
  } | null;
  desiredRevision: number | null;
  version: number;
  publicKey: string | null;
  endpoint: string | null;
  basePort: number | null;
  revoked: boolean;
  hubs: { id: string; name: string; ready: boolean; endpoint: string | null }[];
  links: {
    hubId: string;
    peerName: string;
    network: string;
    hubAddress: string;
    edgeAddress: string;
    hubPort: number;
  }[];
};
export function WireguardConnections({ node, role }: { node: NodeRecord; role: OperatorRole }) {
  const { timeZone } = useControllerTimeZone();
  const [data, setData] = useState<Connections | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [endpoint, setEndpoint] = useState('');
  const [basePort, setBasePort] = useState('20000');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [deployment, setDeployment] = useState<WireguardDeployment | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [baseline, setBaseline] = useState('');
  const settings: WireguardSettings =
    node.kind === 'hub'
      ? { endpoint: endpoint.trim(), basePort: Number(basePort) }
      : { hubIds: [...selected].sort() };
  const dirty = JSON.stringify(settings) !== baseline;
  const changedElsewhere = deployment !== null && deployment.draft.version !== draftVersion;
  const hasDraft = deployment?.draft.payload !== null && deployment !== null;
  const applied = deployment?.devices.every((device) => deploymentStatus(device).applied);
  const localDevice = deployment?.devices.find((device) => device.id === node.id);
  const localStatus = localDevice ? deploymentStatus(localDevice) : null;

  const url = `/api/operator/nodes/${node.id}/wireguard`;
  const readOnly = role === 'viewer' || data?.revoked;
  const populate = useCallback(
    (result: Connections, state: WireguardDeployment) => {
      const raw: WireguardSettings =
        state.draft.payload ??
        (node.kind === 'hub'
          ? { endpoint: result.endpoint || '', basePort: result.basePort ?? 20000 }
          : { hubIds: result.links.map((link) => link.hubId).sort() });
      // JSONB key order is not form field order. Canonicalize before dirty checks.
      const saved: WireguardSettings =
        node.kind === 'hub'
          ? { endpoint: raw.endpoint ?? '', basePort: raw.basePort ?? 20000 }
          : { hubIds: [...(raw.hubIds ?? [])].sort() };
      setData(result);
      setDeployment(state);
      setDraftVersion(state.draft.version);
      setSelected(saved.hubIds ?? []);
      setEndpoint(saved.endpoint ?? '');
      setBasePort(String(saved.basePort ?? 20000));
      setBaseline(JSON.stringify(saved));
    },
    [node.kind],
  );
  const read = useCallback(
    async (signal?: AbortSignal) => {
      const responses = await Promise.all([
        fetch(url, { cache: 'no-store', signal }),
        fetch(`${url}/draft`, { cache: 'no-store', signal }),
      ]);
      const results = await Promise.all(responses.map((response) => response.json()));
      for (let index = 0; index < responses.length; index++) {
        if (!responses[index].ok)
          throw new Error(
            `${results[index].error || 'Unable to load deployment.'}${results[index].requestId ? ` Reference: ${results[index].requestId}` : ''}`,
          );
      }
      return {
        connections: results[0] as Connections,
        deployment: results[1] as WireguardDeployment,
      };
    },
    [url],
  );
  useEffect(() => {
    const abort = new AbortController();
    read(abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) populate(result.connections, result.deployment);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      });
    return () => abort.abort();
  }, [read, populate]);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setInterval(() => {
      void read(abort.signal)
        .then((current) => {
          if (!abort.signal.aborted) {
            setDeployment(current.deployment);
            setData((previous) =>
              previous
                ? {
                    ...previous,
                    observed: current.connections.observed,
                    desiredRevision: current.connections.desiredRevision,
                  }
                : previous,
            );
          }
        })
        .catch(() => {
          /* Retain timestamped observations; age remains visible. */
        });
    }, 15_000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [read]);
  async function reload() {
    setBusy(true);
    setError('');
    try {
      const result = await read();
      populate(result.connections, result.deployment);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to refresh. Retry Reload configuration.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    setBusy(true);
    setError('');
    setNotice('');
    let saved = false;
    try {
      const response = await fetch(`${url}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: data.version,
          expectedDraftVersion: draftVersion,
          ...settings,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          `${result.error || 'Unable to save draft.'}${result.requestId ? ` Reference: ${result.requestId}` : ''}`,
        );
      saved = true;
      const current = await read();
      populate(current.connections, current.deployment);
      setNotice(
        result.hasChanges
          ? 'Draft saved on the controller. Review it, then Deploy changes to publish configuration to the affected devices. Nothing was deployed by Save draft.'
          : 'Draft matches the published configuration. Nothing to deploy.',
      );
    } catch (cause) {
      setError(
        `${saved ? 'Draft saved, but refresh failed. Reload configuration before deploying. ' : ''}${cause instanceof Error ? cause.message : 'Unable to save draft. Reload and retry.'}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function deploy() {
    if (!data || !deployment) return;
    setBusy(true);
    setError('');
    setNotice('');
    let published = false;
    try {
      const response = await fetch(`${url}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: data.version, expectedDraftVersion: draftVersion }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          `${result.error || 'Unable to deploy.'}${result.requestId ? ` Reference: ${result.requestId}` : ''}`,
        );
      published = result.deployed;
      const current = await read();
      populate(current.connections, current.deployment);
      setNotice(
        published
          ? 'Configuration published to the affected devices. Follow receipt, local apply, and handshake status below; publication does not prove a working tunnel.'
          : 'No unpublished changes. Check deployment status below.',
      );
    } catch (cause) {
      setError(
        `${published ? 'Configuration was published, but refresh failed. Reload to check its status. ' : ''}${cause instanceof Error ? cause.message : 'Unable to deploy. Review the configuration and retry.'}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{node.kind === 'hub' ? 'WireGuard hub' : 'Hub connections'}</CardTitle>
        <CardDescription>
          {node.kind === 'hub'
            ? 'Advertise the underlay IPv4 address that Edges can reach.'
            : 'Select up to eight hubs. Each connection receives its own tunnel and automatic address pair.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data && (
          <div className="rounded-lg border p-3 text-sm" aria-live="polite">
            <p>
              Network apply:{' '}
              {data.observed
                ? `${data.observed.status}${data.observed.revision !== data.desiredRevision ? ' (previous revision)' : ''}`
                : 'Not reported'}
            </p>
            {localStatus && !localStatus.applied && (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Next step: {localStatus.next}
              </p>
            )}
            {data.observed && (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  Revision {data.observed.revision} · Reported{' '}
                  {formatDateTime(data.observed.receivedAt, timeZone)}
                </p>
                {data.observed.handshakes.map((item) => (
                  <p key={item.name} className="mt-1 break-words text-xs text-muted-foreground">
                    {item.name}:{' '}
                    {item.lastHandshake > 0
                      ? `last handshake ${formatDateTime(new Date(item.lastHandshake * 1000).toISOString(), timeZone)}`
                      : 'no handshake observed'}
                  </p>
                ))}
                {data.observed.bgpPeers.map((peer) => (
                  <p key={peer.address} className="mt-1 break-words text-xs text-muted-foreground">
                    BGP {peer.address}: {peer.state} · {peer.receivedPrefixes} approved prefixes
                    received
                  </p>
                ))}
              </>
            )}
          </div>
        )}
        {deployment && (
          <p className="text-sm">
            {hasDraft
              ? 'Unpublished draft — not sent to agents'
              : applied
                ? 'Published configuration is up to date'
                : 'No unpublished changes — check device status below'}
          </p>
        )}
        {changedElsewhere && (
          <Feedback tone="error">
            The draft changed in another session. Reload configuration to review it before saving or
            deploying. Reload discards local edits.
          </Feedback>
        )}
        {!data && !error && <Feedback>Loading connections…</Feedback>}
        {data && (
          <form onSubmit={save} className="space-y-4">
            <p className="text-xs text-muted-foreground">
              WireGuard key:{' '}
              {data.publicKey
                ? 'Registered by agent'
                : 'Not registered — upgrade and start the agent'}
            </p>
            <fieldset
              disabled={readOnly || busy || !deployment || changedElsewhere}
              className="space-y-4"
            >
              {node.kind === 'hub' ? (
                <>
                  <label htmlFor="hub-endpoint" className="block text-sm font-medium">
                    Hub endpoint IPv4
                  </label>
                  <Input
                    controlSize="md"
                    id="hub-endpoint"
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    placeholder="192.168.160.10"
                    required
                  />
                  <label htmlFor="hub-base-port" className="block text-sm font-medium">
                    Hub base UDP port
                  </label>
                  <Input
                    controlSize="md"
                    id="hub-base-port"
                    type="number"
                    min={1024}
                    max={65408}
                    value={basePort}
                    onChange={(event) => setBasePort(event.target.value)}
                    required
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Reserve 128 UDP ports beginning at this port. Each Edge gets one port. Configure
                    upstream firewall or NAT access separately.
                  </p>
                </>
              ) : (
                <>
                  <legend className="mb-3 text-sm font-medium">Selected hubs</legend>
                  {data.hubs.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Add a Hub device and configure its endpoint first.
                    </p>
                  )}
                  {data.hubs.map((hub) => (
                    <label
                      htmlFor={`hub-${hub.id}`}
                      key={hub.id}
                      className="flex items-center gap-3 rounded-lg border p-3 text-sm"
                    >
                      <Checkbox
                        id={`hub-${hub.id}`}
                        checked={selected.includes(hub.id)}
                        disabled={(!hub.ready || !hub.endpoint) && !selected.includes(hub.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, hub.id]
                              : current.filter((id) => id !== hub.id),
                          )
                        }
                      />
                      <span>
                        {hub.name}
                        <span className="block text-xs text-muted-foreground">
                          {hub.ready && hub.endpoint
                            ? hub.endpoint
                            : 'Waiting for endpoint and agent key'}
                        </span>
                      </span>
                    </label>
                  ))}
                </>
              )}
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  <Button size="md" type="submit" disabled={!dirty}>
                    Save draft
                  </Button>
                  <Button
                    size="md"
                    type="button"
                    variant="outline"
                    disabled={!hasDraft || dirty}
                    onClick={() => void deploy()}
                  >
                    Deploy changes
                  </Button>
                </div>
              )}
              {dirty && (
                <p className="text-xs text-muted-foreground">
                  Unsaved edits. Save draft before deploying.
                </p>
              )}
              {!dirty && hasDraft && (
                <p className="text-xs text-muted-foreground">
                  Deploy publishes changes to this device and affected counterparts, including
                  removed Hub connections. Each device applies the plan only when its local opt-in
                  permits it.
                </p>
              )}
            </fieldset>
            {data.links.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Allocated tunnel addresses</legend>
                {data.links.map((link) => (
                  <div
                    key={`${link.hubId}-${link.edgeAddress}`}
                    className="rounded-lg border p-3 text-sm"
                  >
                    <p className="font-medium">{link.peerName}</p>
                    <p className="break-words text-xs text-muted-foreground">
                      Hub {link.hubAddress} · Edge {link.edgeAddress} · /31 · UDP {link.hubPort}
                    </p>
                  </div>
                ))}
              </fieldset>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              These are saved tunnel settings. Agent network apply must be enabled locally. Tunnel
              connectivity and LAN routing are not implied by receipt of configuration.
            </p>
          </form>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void reload()}
        >
          Reload configuration
        </Button>
        <p className="text-xs text-muted-foreground">
          Reload discards unsaved local edits. Deploy is disabled when there are no unpublished
          changes; this does not mean the tunnel is healthy.
        </p>
        {deployment && <WireguardDeploymentStatus deployment={deployment} />}
        {error && <Feedback tone="error">{error}</Feedback>}
        {notice && <Feedback tone="success">{notice}</Feedback>}
      </CardContent>
    </Card>
  );
}
