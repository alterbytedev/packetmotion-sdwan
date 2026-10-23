'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import {
  deploymentStatus,
  type WireguardDeployment,
} from '@/lib/fabric/wireguard-deployment-status';
import { formatDateTime } from '@/lib/date-format';
import { useControllerTimeZone } from '@/lib/time-zone-context';

export function WireguardDeploymentStatus({ deployment }: { deployment: WireguardDeployment }) {
  const { timeZone } = useControllerTimeZone();
  const [notice, setNotice] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            reportType: 'controller-observed-wireguard-deployment',
            generatedAt: new Date().toISOString(),
            note: 'Controller observations only; no live probe, device logs, credentials or private keys.',
            devices: deployment.devices.map((device) => ({
              ...device,
              assessment: deploymentStatus(device),
            })),
          },
          null,
          2,
        ),
      );
      setNotice('Deployment report copied.');
    } catch {
      setNotice(
        'Clipboard unavailable. Select and copy the displayed status, or retry with browser clipboard permission.',
      );
    }
  }
  return (
    <section aria-label="Deployment status" className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Deployment status</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          Copy deployment report
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Current published configuration on each device. Receipt, network apply, and tunnel health
        are separate. Timestamps may include later changes from other deployments.
      </p>
      {deployment.devices.map((device) => {
        const status = deploymentStatus(device);
        return (
          <div key={device.id} className="space-y-2 rounded-lg border p-3 text-sm">
            <Link
              className="font-medium text-primary hover:underline"
              href={`/dashboard/devices/${device.id}`}
            >
              {device.name}
            </Link>
            <p>{status.label}</p>
            <p className="text-xs leading-5 text-muted-foreground">{status.next}</p>
            <p className="text-xs text-muted-foreground">
              Published revision {device.revision ?? '—'} · Receipt {device.receipt ?? 'pending'} ·
              Network apply {device.applyStatus ?? 'not reported'}
              {device.observedRevision !== null ? ` (revision ${device.observedRevision})` : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              Last heartbeat:{' '}
              {device.lastSeenAt ? formatDateTime(device.lastSeenAt, timeZone) : 'Not recorded'} ·
              Apply reported:{' '}
              {device.observedAt ? formatDateTime(device.observedAt, timeZone) : 'Not recorded'}
            </p>
          </div>
        );
      })}
      {deployment.devices.some((device) => deploymentStatus(device).label === 'Local activation required') && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">Enable WireGuard locally</summary>
          <div className="mt-3 space-y-3 leading-5 text-muted-foreground">
            <p>
              On each device showing Local activation required, use its VM console and run:
            </p>
            <pre className="overflow-x-auto whitespace-pre rounded-lg bg-muted p-3">
              {'sudo fabric-agent network enable\nsudo fabric-agent network status'}
            </pre>
            <p>
              Requires agent 0.3.6 or newer. If the command is unknown, use Upgrade agent on that
              device first; keep its enrolled identity. Activation checks controller access and local
              routes, preserves service arguments, and restarts the service. Use console access to
              retain recovery access. The controller cannot grant these local privileges.
            </p>
            <p>
              Refresh after the next check-in. Already active devices need no activation command.
              A recent handshake is separate from tunnel-IP reachability. Routing requires its own
              local authorization. Stopping the agent does not remove applied tunnels; deploy and
              verify an empty tunnel plan before removing the local opt-in.
            </p>
          </div>
        </details>
      )}
      {notice && <Feedback>{notice}</Feedback>}
    </section>
  );
}
