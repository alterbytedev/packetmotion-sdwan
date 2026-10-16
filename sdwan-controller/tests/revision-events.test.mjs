import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import loader from './support/load-ts.cjs';

function createWaitModule() {
  const listener = new EventEmitter();
  listener.query = async () => ({ rows: [] });
  listener.release = () => {};
  const load = loader({
    '../db': { getDatabase: () => ({ connect: async () => listener }) },
    './authorization': {
      FabricError: class FabricError extends Error {
        constructor(status, message) {
          super(message);
          this.status = status;
        }
      },
    },
  });
  return { listener, waitForRevision: load('src/lib/fabric/revision-events.ts').waitForRevision };
}

test('revision wait wakes only for the requested node and re-reads durable state', async () => {
  const { listener, waitForRevision } = createWaitModule();
  let reads = 0;
  const controller = new AbortController();
  const result = waitForRevision('node-a', 500, controller.signal, async () => {
    reads++;
    return { value: reads > 1 ? 'revision-2' : 'revision-1', changed: reads > 1 };
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  listener.emit('notification', { channel: 'fabric_desired_revision', payload: JSON.stringify({ nodeId: 'node-b', revision: 2 }) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(reads, 1, 'another node notification must not wake this waiter');
  listener.emit('notification', { channel: 'fabric_desired_revision', payload: JSON.stringify({ nodeId: 'node-a', revision: 2 }) });
  assert.equal(await result, 'revision-2');
  assert.equal(reads, 2);
});

test('revision wait re-reads after timeout when notification is lost', async () => {
  const { waitForRevision } = createWaitModule();
  let reads = 0;
  const result = await waitForRevision('node-a', 10, new AbortController().signal, async () => {
    reads++;
    return { value: 'latest-durable-state', changed: false };
  });
  assert.equal(result, 'latest-durable-state');
  assert.equal(reads, 2);
});

test('revision wait enforces one active waiter per node', async () => {
  const { waitForRevision } = createWaitModule();
  const first = waitForRevision('node-a', 100, new AbortController().signal, async () => ({ value: null, changed: false }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(
    waitForRevision('node-a', 100, new AbortController().signal, async () => ({ value: null, changed: false })),
    (error) => error.status === 429,
  );
  // Wake the first request by aborting through its signal in the separate test fixture.
  // Its bounded timeout also guarantees cleanup if this assertion fails.
  assert.equal(await first, null);
});
