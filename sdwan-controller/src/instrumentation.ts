import type { Instrumentation } from 'next';

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const digest =
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof error.digest === 'string'
      ? error.digest
      : undefined;
  const { createRequestId, reportServerError } = await import('@/lib/diagnostics');
  const referenceId = digest && /^[A-Za-z0-9._-]{1,128}$/.test(digest) ? digest : createRequestId();
  let routePath: string | undefined;
  try {
    routePath = new URL(request.path, 'http://controller.invalid').pathname;
  } catch {
    routePath = undefined;
  }
  await reportServerError(`next.${context.routeType}`, referenceId, error, {
    routePath: context.routePath || routePath,
    method: request.method,
  });
};
