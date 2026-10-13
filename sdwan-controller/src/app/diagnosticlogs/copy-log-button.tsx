'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';

export function CopyLogButton({ referenceId, report }: { referenceId: string; report: string }) {
  const [status, setStatus] = useState<'copied' | 'error' | null>(null);

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Copy diagnostic log ${referenceId}`}
        onClick={copyReport}
      >
        {status === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {status === 'copied' ? 'Copied' : 'Copy report'}
      </Button>
      {status === 'copied' && <Feedback tone="success" className="text-xs">Report copied to clipboard.</Feedback>}
      {status === 'error' && <Feedback tone="error" className="text-xs">Could not copy automatically. Select the log details to copy them manually.</Feedback>}
    </div>
  );
}
