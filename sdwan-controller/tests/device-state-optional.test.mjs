import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';

function loadWithError(error) {
  const moduleLoader = loader({
    '../db': { getDatabase: () => ({ query: async () => { throw error; } }) },
    './authorization': { authorizeSuperadmin: () => {}, FabricError: class FabricError extends Error {} },
  });
  return moduleLoader('src/lib/fabric/device-state.ts').readPendingDeviceStateRequest('node-a');
}

test('missing optional device-state table behaves as no pending request', async () => {
  assert.equal(await loadWithError(Object.assign(new Error('missing optional table'), { code: '42P01' })), null);
});

test('device-state database outages and other failures still propagate', async () => {
  const error = Object.assign(new Error('database unavailable'), { code: '08006' });
  await assert.rejects(loadWithError(error), (received) => received === error);
});
