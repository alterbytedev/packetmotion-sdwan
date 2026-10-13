'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { connectionStatusLabels } from '@/components/fabric/connection-status';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { AgentConfiguration } from './agent-configuration';
import { AgentTelemetry } from './agent-telemetry';
import { EnrollmentInstructions, type EnrollmentDetails } from './enrollment-details';
import type { NodeRecord, OperatorRole } from '@/lib/fabric/types';

export function DeviceDetails({ node, role }: { node: NodeRecord; role: OperatorRole }) {
  const [enrollment, setEnrollment] = useState<EnrollmentDetails | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const inventory = { sites: [], nodes: [node] };
  async function token() {
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
      <Button asChild variant="outline">
        <Link href="/dashboard/devices">Back to devices</Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>{node.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Device type</dt>
              <dd>{node.kind === 'hub' ? 'Hub' : 'Edge'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Controller status</dt>
              <dd>{connectionStatusLabels[node.connectionStatus]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Device ID</dt>
              <dd className="break-all">{node.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last check-in</dt>
              <dd>
                {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'Not received yet'}
              </dd>
            </div>
          </dl>
          {role === 'admin' && node.connectionStatus === 'not-enrolled' && (
            <Button disabled={pending} onClick={token}>
              New token
            </Button>
          )}
          {error && <Feedback tone="error">{error}</Feedback>}
          {enrollment && (
            <EnrollmentInstructions enrollment={enrollment} onClose={() => setEnrollment(null)} />
          )}
        </CardContent>
      </Card>
      <AgentConfiguration key={`config-${node.id}`} inventory={inventory} role={role} />
      <AgentTelemetry key={`telemetry-${node.id}`} inventory={inventory} />
    </div>
  );
}
