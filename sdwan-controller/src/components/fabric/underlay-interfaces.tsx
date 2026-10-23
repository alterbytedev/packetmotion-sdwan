'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import type { NodeRecord, OperatorRole } from '@/lib/fabric/types';
import { AgentTelemetry, type ReportedInterface, type useAgentTelemetry } from './agent-telemetry';
import { NetworkDraftEditor } from './network-draft-editor';

export function UnderlayInterfaces({
  node,
  role,
  telemetry,
}: {
  node: NodeRecord;
  role: OperatorRole;
  telemetry: ReturnType<typeof useAgentTelemetry>;
}) {
  const [selection, setSelection] = useState<{
    item: ReportedInterface;
    kind: 'physical' | 'vlan';
  } | null>(null);
  return (
    <>
      <AgentTelemetry
        node={node}
        telemetry={telemetry}
        view="underlay"
        onConfigure={(item) => setSelection({ item, kind: 'physical' })}
        onConfigureVlans={(item) => setSelection({ item, kind: 'vlan' })}
        readOnly={role === 'viewer' || node.connectionStatus === 'revoked'}
      />
      <Modal
        open={selection !== null}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
        title={
          selection
            ? `${selection.kind === 'physical' ? 'Configure' : 'VLANs on'} ${selection.item.name}`
            : 'Interface settings'
        }
        description="Edit the reported interface, save a draft, or apply through its locally authorized Fabric agent with safe rollback."
        size="xl"
        closeOnBackdrop={false}
      >
        {selection && (
          <NetworkDraftEditor
            key={`${node.id}-${selection.item.name}-${selection.kind}`}
            node={node}
            role={role}
            reportedInterface={selection.item}
            kind={selection.kind}
          />
        )}
      </Modal>
    </>
  );
}
