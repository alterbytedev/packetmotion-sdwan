'use client';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';

export type EnrollmentDetails = { token: string; expiresAt: string; controllerUrl?: string | null };
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
  const origin = enrollment.controllerUrl || '';
  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin);
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
      {origin ? (
        <>
          <p className="text-xs text-muted-foreground">
            On the device, set <code>FABRIC_ENROLLMENT_TOKEN</code> to this token, then run:
          </p>
          <code className="block break-all rounded-lg bg-muted p-3 text-xs">
            fabric-agent enroll --controller {origin}
            {local ? ' --allow-insecure-local' : ''}
          </code>
          <code className="block break-all rounded-lg bg-muted p-3 text-xs">fabric-agent run</code>
          <p className="text-xs text-muted-foreground">
            The agent initiates the connection. No inbound port is needed on the device.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          The controller connection address needs to be configured before enrollment. Ask your
          controller administrator to complete connection setup.
        </p>
      )}
    </section>
  );
}
