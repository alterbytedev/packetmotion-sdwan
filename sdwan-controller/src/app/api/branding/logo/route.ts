import { getLogo, MAX_LOGO_BYTES, removeLogo, saveLogo } from '@/lib/branding';
import { createRequestId, reportServerError } from '@/lib/diagnostics';
import { authorizeSuperadmin, currentActor, FabricError } from '@/lib/fabric/authorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sameOrigin(request: Request) {
  const url = new URL(request.url);
  const expected =
    process.env.CONTROLLER_PUBLIC_ORIGIN ||
    (process.env.NODE_ENV === 'production'
      ? null
      : `${url.protocol}//${request.headers.get('host') || url.host}`);
  return Boolean(
    expected &&
      request.headers.get('origin') === expected &&
      request.headers.get('sec-fetch-site') !== 'cross-site',
  );
}

async function readBounded(request: Request) {
  const lengthHeader = request.headers.get('content-length');
  const length = lengthHeader === null ? null : Number(lengthHeader);
  if (length !== null && (!Number.isFinite(length) || length <= 0 || length > MAX_LOGO_BYTES))
    throw new FabricError(413, 'Logo must be no larger than 2 MiB.');
  const reader = request.body?.getReader();
  if (!reader) throw new FabricError(400, 'Choose an image to upload.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_LOGO_BYTES) {
        await reader.cancel();
        throw new FabricError(413, 'Logo must be no larger than 2 MiB.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function GET() {
  const requestId = createRequestId();
  try {
    const logo = await getLogo();
    if (!logo) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const data = new Uint8Array(logo.logo_data.length);
    data.set(logo.logo_data);
    return new Response(data, {
      headers: {
        'Content-Type': logo.logo_mime,
        'Content-Length': String(logo.logo_data.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    await reportServerError('branding.api', requestId, error, {
      routePath: '/api/branding/logo',
      method: 'GET',
    });
    return Response.json(
      { error: 'Branding image is unavailable.', requestId },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}


export async function PUT(request: Request) {
  const requestId = createRequestId();
  try {
    if (!sameOrigin(request)) throw new FabricError(403, 'Same-origin request required.');
    const actor = await currentActor();
    authorizeSuperadmin(actor);
    const mimeType = request.headers.get('content-type')?.split(';')[0].trim() || '';
    const data = await readBounded(request);
    await saveLogo(actor.id, mimeType, data);
    return Response.json(
      { saved: true },
      { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } },
    );
  } catch (error) {
    if (error instanceof FabricError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    await reportServerError('branding.api', requestId, error, {
      routePath: '/api/branding/logo',
      method: 'PUT',
    });
    return Response.json(
      { error: 'Branding settings are unavailable.', requestId },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } },
    );
  }
}

export async function DELETE(request: Request) {
  const requestId = createRequestId();
  try {
    if (!sameOrigin(request)) throw new FabricError(403, 'Same-origin request required.');
    await removeLogo();
    return Response.json(
      { removed: true },
      { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } },
    );
  } catch (error) {
    if (error instanceof FabricError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    await reportServerError('branding.api', requestId, error, {
      routePath: '/api/branding/logo',
      method: 'DELETE',
    });
    return Response.json(
      { error: 'Branding settings are unavailable.', requestId },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } },
    );
  }
}
