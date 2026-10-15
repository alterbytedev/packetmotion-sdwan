import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';

const load = loader({
  '../db': { getDatabase: () => { throw new Error('Database should not be used by validators.'); } },
  './authorization': {
    FabricError: class FabricError extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    },
  },
});
const { normalizeInsecureHttpHost } = load('src/lib/fabric/insecure-http-allowlist.ts');

test('insecure HTTP allowlist accepts only private and loopback IP addresses', () => {
  for (const host of ['10.1.2.3', '172.16.0.2', '172.31.255.254', '192.168.160.200', '127.0.0.1', 'fd00::1', '::1'])
    assert.equal(normalizeInsecureHttpHost(host), host.toLowerCase());
  assert.equal(normalizeInsecureHttpHost('[fd00::1]'), 'fd00::1');
  for (const host of ['198.51.100.2', '8.8.8.8', '172.32.0.1', '192.168.1.1.example', 'controller.example', ''])
    assert.throws(() => normalizeInsecureHttpHost(host), /private IPv4/);
});

test('enrollment instructions use only configured HTTP controller hosts', async (t) => {
  const original = process.env.CONTROLLER_ENROLLMENT_URL;
  delete process.env.CONTROLLER_ENROLLMENT_URL;
  t.after(() => {
    if (original === undefined) delete process.env.CONTROLLER_ENROLLMENT_URL;
    else process.env.CONTROLLER_ENROLLMENT_URL = original;
  });
  const instructionsLoader = loader({
    './insecure-http-allowlist': {
      isInsecureHttpHostAllowed: async (host) => host === '192.168.160.200',
    },
  });
  const { enrollmentTransport } = instructionsLoader('src/lib/fabric/enrollment-instructions.ts');
  const allowed = await enrollmentTransport(
    new Request('http://next-internal:3000/api/operator/nodes', {
      headers: { origin: 'http://192.168.160.200:3000' },
    }),
  );
  assert.equal(allowed.controllerUrl, 'http://192.168.160.200:3000');
  assert.equal(allowed.allowInsecureHttp, true);

  const blocked = await enrollmentTransport(
    new Request('http://next-internal:3000/api/operator/nodes', {
      headers: { origin: 'http://192.168.160.201:3000' },
    }),
  );
  assert.equal(blocked.controllerUrl, null);
  assert.equal(blocked.insecureHttpBlocked, true);
});
