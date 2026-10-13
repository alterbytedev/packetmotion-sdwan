import 'server-only';
import { FabricError } from './authorization';
import { authenticateDevice, verifyProxy } from './device-auth';
import { createRequestId, reportServerError } from '../diagnostics';

export async function readAgentJson(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
    throw new FabricError(415, 'JSON required.');
  const reader = request.body?.getReader();
  if (!reader) throw new FabricError(400, 'JSON body required.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 32768) {
        await reader.cancel();
        throw new FabricError(413, 'Request too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new FabricError(400, 'Invalid JSON.');
  }
}

export async function agentRequest(
  request: Request,
  enrollment: boolean,
  handler: (
    device: { id: string; kind: 'branch' | 'hub'; serial: string } | null,
  ) => Promise<unknown>,
) {
  const requestId = createRequestId();
  const headers = { 'Cache-Control': 'no-store', 'X-Request-ID': requestId };
  try {
    if (enrollment) verifyProxy(request);
    const device = enrollment ? null : await authenticateDevice(request);
    return Response.json(await handler(device), { headers });
  } catch (error) {
    const status = error instanceof FabricError ? error.status : 503;
    if (!(error instanceof FabricError))
      await reportServerError('agent.api', requestId, error, {
        routePath: new URL(request.url).pathname,
        method: request.method,
      });
    return Response.json(
      {
        error: error instanceof FabricError ? error.message : 'Agent service unavailable.',
        ...(status === 503 ? { requestId } : {}),
      },
      { status, headers },
    );
  }
}
