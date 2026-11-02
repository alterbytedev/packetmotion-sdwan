'use client';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';

export type EnrollmentDetails = {
  token: string;
  nodeId?: string;
  expiresAt: string;
  controllerUrl?: string | null;
  allowInsecureHttp?: boolean;
  insecureHttpBlocked?: boolean;
  serverCaSha256?: string | null;
};
export function EnrollmentInstructions({
  enrollment,
  onClose,
}: {
  enrollment: EnrollmentDetails;
  onClose: () => void;
}) {
  const [copiedToken, setCopiedToken] = useState('');
  const [copyError, setCopyError] = useState('');
  const copied = copiedToken === enrollment.token;
  const origin = (enrollment.controllerUrl || '').replace(/\/$/, '');
  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin);
  const allowHttp = local || enrollment.allowInsecureHttp;
  const serverCaSha256 = enrollment.serverCaSha256 && /^[A-F0-9]{64}$/.test(enrollment.serverCaSha256)
    ? enrollment.serverCaSha256
    : null;
  const needsServerCaPin = allowHttp && !local;
  const installCommand = origin
    ? `curl -fsSL ${origin}/fabric/edge.sh | sudo bash -s -- --controller ${origin}${allowHttp ? ' --allow-insecure-local' : ''}${serverCaSha256 ? ` --server-ca-sha256 ${serverCaSha256}` : ''}${enrollment.nodeId ? ` --expected-node-id ${enrollment.nodeId}` : ''}`
    : '';
  return (
    <section
      aria-label="Device enrollment"
      className="mb-5 space-y-4 rounded-lg border bg-accent/40 p-4"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="text-sm font-semibold">Connect your device</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Hide token
        </Button>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        Use this token once to enroll the Go agent. It expires in 15 minutes. Save it now; it will
        not be shown again.
      </p>
      <code
        className="block break-all rounded-lg border bg-background p-3 text-xs"
        data-testid="enrollment-token"
      >
        {enrollment.token}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          setCopyError('');
          try {
            await navigator.clipboard.writeText(enrollment.token);
            setCopiedToken(enrollment.token);
          } catch {
            setCopiedToken('');
            setCopyError('Unable to copy token. Select and copy it manually.');
          }
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy token'}
      </Button>
      {copied && (
        <Feedback tone="success" className="sr-only">
          Token copied.
        </Feedback>
      )}
      {copyError && <Feedback tone="error">{copyError}</Feedback>}
      <p className="text-xs leading-6 text-muted-foreground">
        Reusing a Debian appliance? Archiving its dashboard entry revokes access but leaves the local
        identity on disk. If it belongs to another device, the installer offers a confirmed reset with
        a private backup and cleanup of old agent-owned networking. Press Enter to cancel.
        Replacement starts in management-only mode; review local networking permissions afterward.
      </p>
      <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">{`sudo systemctl show fabric-agent -p ActiveState -p SubState -p Result -p ExecMainStatus;
sudo journalctl -u fabric-agent -n 50 --no-pager`}</pre>
      {origin ? (
        <>
          <p className="text-xs text-muted-foreground">
            Copy and run this once on the Debian device. The installer then asks you to paste the
            one-time token (hidden), so the token never appears in shell history or process arguments.
          </p>
          {allowHttp && <p className="text-xs font-medium text-amber-800 dark:text-amber-300">HTTP is unencrypted. Use this only on an isolated, trusted lab network.</p>}
          {needsServerCaPin && !serverCaSha256 ? (
            <Feedback tone="error">A server CA fingerprint is not configured for this lab controller. Ask the controller administrator to finish the trusted enrollment setup before installing devices.</Feedback>
          ) : (
            <code className="block break-all rounded-lg bg-muted p-3 text-xs">
              {installCommand}
            </code>
          )}
          <p className="text-xs text-muted-foreground">
            The installer verifies the signed agent release, pins and installs the controller CA
            when configured, enrolls with the one-time token, starts the systemd service and enables local WireGuard apply so deployed tunnels come up without a second step. The agent connects outbound; no
            inbound port is needed.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {enrollment.insecureHttpBlocked
            ? 'This HTTP controller address is not in the superadmin-configured lab allowlist. Add its private IP under Settings → Insecure HTTP lab controllers or configure HTTPS.'
            : 'The controller connection address needs to be configured before enrollment. Ask your controller administrator to complete connection setup.'}
        </p>
      )}
    </section>
  );
}
