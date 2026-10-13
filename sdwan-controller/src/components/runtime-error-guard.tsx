'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { RuntimeErrorFallback } from './runtime-error-fallback';

type RuntimeFailure = { referenceId: string };
type RuntimeErrorWindow = Window & { __controllerRuntimeError?: RuntimeFailure };

export function RuntimeErrorGuard({ children }: { children: ReactNode }) {
  const [failure, setFailure] = useState<RuntimeFailure | null>(null);

  useEffect(() => {
    const target = window as RuntimeErrorWindow;
    const showError = (event: Event) => {
      const detail = (event as CustomEvent<RuntimeFailure>).detail;
      if (detail?.referenceId) setFailure(detail);
    };
    window.addEventListener('controller:runtime-error', showError);
    if (target.__controllerRuntimeError) setFailure(target.__controllerRuntimeError);
    return () => window.removeEventListener('controller:runtime-error', showError);
  }, []);

  if (failure) {
    return (
      <RuntimeErrorFallback
        referenceId={failure.referenceId}
        onRetry={() => window.location.reload()}
      />
    );
  }
  return children;
}
