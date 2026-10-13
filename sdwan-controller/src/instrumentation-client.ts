type RuntimeErrorWindow = Window & {
  __controllerRuntimeError?: { referenceId: string };
};

function notifyRuntimeError(error: unknown) {
  const normalized =
    error instanceof Error ? error : new Error('An unexpected browser error occurred.');
  const referenceId = crypto.randomUUID();
  const report = {
    referenceId,
    name: normalized.name,
    message: normalized.message,
    stack: normalized.stack,
    routePath: window.location.pathname,
  };
  (window as RuntimeErrorWindow).__controllerRuntimeError = { referenceId };
  window.dispatchEvent(new CustomEvent('controller:runtime-error', { detail: { referenceId } }));
  void fetch('/api/runtime-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => undefined);
}

window.addEventListener('error', (event) => {
  if (event instanceof ErrorEvent && event.error instanceof Error) notifyRuntimeError(event.error);
});
window.addEventListener('unhandledrejection', (event) => notifyRuntimeError(event.reason));
