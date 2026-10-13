'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function RuntimeErrorFallback({
  referenceId,
  onRetry,
}: {
  referenceId: string;
  onRetry: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f9fa] p-5 sm:p-8">
      <section className="w-full max-w-lg rounded-xl border bg-white p-7 shadow-sm sm:p-9">
        <div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-red-50 text-red-700">
          <AlertTriangle size={21} aria-hidden="true" />
        </div>
        <p className="mb-2 text-[10px] font-semibold tracking-[.15em] text-primary">
          SD-WAN CONTROLLER
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">We hit a problem</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This page ran into an unexpected problem. Your current operation may not have been saved.
          Check its status before repeating a change. If the problem continues, share the reference
          ID with your administrator.
        </p>
        <div className="mt-5 rounded-lg border bg-muted/50 p-3">
          <p className="text-[11px] text-muted-foreground">Reference ID</p>
          <code
            className="mt-1 block break-all font-mono text-sm font-medium"
            data-testid="runtime-error-reference"
          >
            {referenceId}
          </code>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={onRetry}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.assign('/dashboard')}>
            Return to dashboard
          </Button>
        </div>
      </section>
    </main>
  );
}
