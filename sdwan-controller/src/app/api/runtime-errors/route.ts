import { createRequestId, reportServerError } from '@/lib/diagnostics';
import { currentActor } from '@/lib/fabric/authorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = createRequestId();
  const url = new URL(request.url);
  const localOrigin = `${url.protocol}//${request.headers.get('host') || url.host}`;
  const expectedOrigin =
    process.env.CONTROLLER_PUBLIC_ORIGIN ||
    (process.env.NODE_ENV === 'production' ? null : localOrigin);
  if (
    !expectedOrigin ||
    request.headers.get('origin') !== expectedOrigin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    return Response.json(
      { error: 'Same-origin request required.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (!(await currentActor())) {
    return Response.json(
      { error: 'Sign in to submit a runtime error report.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return Response.json(
      { error: 'Use application/json.' },
      { status: 415, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: 'JSON body required.' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        return Response.json({ error: 'Request too large.' }, { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null)
    return Response.json({ error: 'Invalid error report.' }, { status: 400 });
  const report = body as Record<string, unknown>;
  if (
    typeof report.referenceId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      report.referenceId,
    )
  ) {
    return Response.json({ error: 'Invalid error reference.' }, { status: 400 });
  }
  if (typeof report.message !== 'string' || typeof report.name !== 'string')
    return Response.json({ error: 'Invalid error report.' }, { status: 400 });
  const clientError = new Error(report.message.slice(0, 2000));
  clientError.name = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(report.name) ? report.name : 'ClientError';
  if (typeof report.stack === 'string') clientError.stack = report.stack.slice(0, 12000);
  const routePath =
    typeof report.routePath === 'string' &&
    report.routePath.startsWith('/') &&
    !report.routePath.includes('?')
      ? report.routePath.slice(0, 300)
      : undefined;
  await reportServerError('browser.runtime', report.referenceId, clientError, {
    routePath,
    method: 'CLIENT',
  });
  return Response.json(
    { status: 'recorded' },
    { status: 202, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } },
  );
}
