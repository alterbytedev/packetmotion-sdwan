import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';

class FabricError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const load = loader({
  './authorization': { FabricError },
  './device-auth': { authenticateDevice: async () => null, verifyProxy: () => {} },
  '../diagnostics': { createRequestId: () => '00000000-0000-4000-8000-000000000000', reportServerError: async () => {} },
});
const { readAgentJson } = load('src/lib/fabric/agent-http.ts');

function requestWithBody(body) {
  return new Request('https://controller.test/api/agent/v1/device-state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

test('agent JSON body limit includes UTF-8 bytes and accepts exactly 32 KiB', async () => {
  const ascii = JSON.stringify('a'.repeat(32_766));
  assert.equal(Buffer.byteLength(ascii), 32_768);
  assert.equal((await readAgentJson(requestWithBody(ascii))).length, 32_766);

  const multibyte = JSON.stringify('é'.repeat(16_383));
  assert.equal(Buffer.byteLength(multibyte), 32_768);
  assert.equal((await readAgentJson(requestWithBody(multibyte))).length, 16_383);

  await assert.rejects(readAgentJson(requestWithBody(JSON.stringify('é'.repeat(16_384)))),
    (error) => error.status === 413);
});

test('agent JSON parser rejects missing content type and malformed JSON', async () => {
  await assert.rejects(readAgentJson(new Request('https://controller.test/', { method: 'POST', body: '{}' })),
    (error) => error.status === 415);
  await assert.rejects(readAgentJson(requestWithBody('{')), (error) => error.status === 400);
});
