'use client';

import { useEffect, useState } from 'react';
import { RuntimeErrorFallback } from '@/components/runtime-error-fallback';
import { reportClientError } from '@/lib/report-client-error';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [referenceId, setReferenceId] = useState(error.digest || '');

  useEffect(() => {
    const id = error.digest || crypto.randomUUID();
    setReferenceId(id);
    if (!error.digest) reportClientError(id, error);
  }, [error]);

  return (
    <RuntimeErrorFallback referenceId={referenceId || 'Creating reference…'} onRetry={reset} />
  );
}
