import 'server-only';
import type { PoolClient } from 'pg';
import { FabricError } from './authorization';
import { getDatabase } from '../db';

const channel = 'fabric_desired_revision';
const maxWaiters = 2_000;
type WaiterRegistry = {
  listener: PoolClient | null;
  connecting: Promise<void> | null;
  waiters: Map<string, Set<() => void>>;
};
const globals = globalThis as typeof globalThis & { fabricRevisionWaiters?: WaiterRegistry };
if (!globals.fabricRevisionWaiters) {
  globals.fabricRevisionWaiters = { listener: null, connecting: null, waiters: new Map() };
}
const registry = globals.fabricRevisionWaiters;

async function ensureListener() {
  if (registry.listener || registry.connecting) return registry.connecting;
  registry.connecting = (async () => {
    const client = await getDatabase().connect();
    try {
      await client.query(`LISTEN ${channel}`);
    } catch (error) {
      client.release(true);
      throw error;
    }
    registry.listener = client;
    const detach = () => {
      if (registry.listener !== client) return;
      registry.listener = null;
      client.release(true);
    };
    client.on('notification', (message) => {
      if (message.channel !== channel || !message.payload) return;
      try {
        const event = JSON.parse(message.payload) as { nodeId?: unknown };
        if (typeof event.nodeId !== 'string') return;
        for (const wake of registry.waiters.get(event.nodeId) ?? []) wake();
      } catch {
        // Notifications are hints; malformed or lost hints cannot change durable state.
      }
    });
    client.once('error', detach);
    client.once('end', detach);
  })()
    .catch(() => {
      // A bounded waiter still re-reads PostgreSQL at timeout if LISTEN is unavailable.
    })
    .finally(() => {
      registry.connecting = null;
    });
  return registry.connecting;
}

type Snapshot<T> = { value: T; changed: boolean };

export async function waitForRevision<T>(
  nodeId: string,
  timeoutMs: number,
  signal: AbortSignal,
  read: () => Promise<Snapshot<T>>,
): Promise<T> {
  await ensureListener();
  const existing = registry.waiters.get(nodeId);
  if (existing?.size) throw new FabricError(429, 'A desired-state wait is already active for this device.');
  if (registry.waiters.size >= maxWaiters) throw new FabricError(503, 'Controller wait capacity is full.');

  let onAbort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<void>((resolve) => {
    onAbort = () => resolve();
    const nodeWaiters = new Set<() => void>();
    nodeWaiters.add(resolve);
    registry.waiters.set(nodeId, nodeWaiters);
    timer = setTimeout(resolve, timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    registry.waiters.delete(nodeId);
    if (registry.waiters.size === 0 && registry.listener) {
      const client = registry.listener;
      registry.listener = null;
      client.release(true);
    }
  };

  try {
    const beforeWait = await read();
    if (beforeWait.changed || signal.aborted) return beforeWait.value;
    await wait;
    return (await read()).value;
  } finally {
    cleanup();
  }
}
