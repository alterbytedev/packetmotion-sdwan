import 'server-only';
import { currentActor, authorize, FabricError } from './authorization';
import type { Actor } from './types';
import { createRequestId, reportServerError } from '../diagnostics';

const headers = { 'Cache-Control': 'no-store' };

function trustedProxyOrigin(request: Request): string | null {
  const secret = process.env.CONTROLLER_AGENT_PROXY_SECRET;
  if (!secret || request.headers.get('x-fabric-proxy-secret') !== secret) return null;
  const protocol = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host');
  if (protocol !== 'https' || !host || host.includes(',')) return null;
  try {
    const url = new URL(`${protocol}://${host}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function developmentProxyOrigin(request: Request): string | null {
  const protocol = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if ((protocol !== 'http' && protocol !== 'https') || !host || host.includes(',')) return null;
  try {
    const url = new URL(`${protocol}://${host}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function operatorRequest(
  request: Request,
  mutation: boolean,
  handler: (actor: Actor, input?: unknown) => Promise<unknown>,
) {
  const requestId = createRequestId();
  const responseHeaders = { ...headers, 'X-Request-ID': requestId };
  try {
    const actor = await currentActor();
    authorize(actor, mutation);
    let input: unknown;
    if (mutation) {
      const url = new URL(request.url);
      const developmentOrigin = new URL(
        `${url.protocol}//${request.headers.get('host') || url.host}`,
      ).origin;
      const expectedOrigin =
        process.env.CONTROLLER_PUBLIC_ORIGIN ||
        (process.env.NODE_ENV === 'production' ? null : developmentOrigin);
      const acceptedOrigins = new Set([
        expectedOrigin,
        process.env.NODE_ENV === 'production' ? null : developmentOrigin,
        process.env.NODE_ENV === 'production' ? null : developmentProxyOrigin(request),
        trustedProxyOrigin(request),
      ].filter(Boolean));
      if (
        !acceptedOrigins.has(request.headers.get('origin')) ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        throw new FabricError(403, 'Same-origin request required.');
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        throw new FabricError(415, 'Use application/json.');
      const reader = request.body?.getReader();
      if (!reader) throw new FabricError(400, 'A JSON body is required.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 8192) {
            await reader.cancel();
            throw new FabricError(413, 'Request body is too large.');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new FabricError(400, 'Invalid JSON body.');
      }
    }
    return Response.json(await handler(actor, input), {
      status: mutation ? 201 : 200,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof FabricError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: responseHeaders },
      );
    await reportServerError('operator.api', requestId, error, {
      routePath: new URL(request.url).pathname,
      method: request.method,
    });
    return Response.json(
      { error: 'Inventory is unavailable. Check controller setup and try again.', requestId },
      { status: 503, headers: responseHeaders },
    );
  }
}
