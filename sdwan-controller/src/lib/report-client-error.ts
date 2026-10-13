'use client';

export function reportClientError(referenceId: string, error: Error) {
  const report = {
    referenceId,
    name: error.name,
    message: error.message,
    stack: error.stack,
    routePath: window.location.pathname,
  };
  void fetch('/api/runtime-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => undefined);
}
