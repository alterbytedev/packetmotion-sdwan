import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';

test('desired route supports bounded waits and rejects malformed query values', async () => {
  const calls = [];
  class FabricError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  const load = loader({
    '@/lib/fabric/authorization': { FabricError },
    '@/lib/fabric/agent-http': {
      agentRequest: async (_request, enrollment, handler) => {
        assert.equal(enrollment, false);
        return Response.json(await handler({ id: 'node-a' }));
      },
    },
    '@/lib/fabric/channel': {
      desiredConfig: async (...args) => ({ kind: 'immediate', args }),
      waitForDesiredConfig: async (...args) => {
        calls.push(args);
        return { kind: 'waited' };
      },
    },
  });
  const { GET } = load('src/app/api/agent/v1/desired/route.ts');
  const abort = new AbortController();
  const request = new Request('https://controller.test/api/agent/v1/desired?revision=3&checksum=abc&wait=25', { signal: abort.signal });
  const response = await GET(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { kind: 'waited' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'node-a');
  assert.equal(calls[0][1], '3');
  assert.equal(calls[0][2], 'abc');
  assert.equal(calls[0][3], 25_000);
  assert.equal(calls[0][4], request.signal);

  await assert.rejects(GET(new Request('https://controller.test/api/agent/v1/desired?wait=26')), (error) => error.status === 400);
  await assert.rejects(GET(new Request('https://controller.test/api/agent/v1/desired?wait=1&unexpected=x')), (error) => error.status === 400);
});
