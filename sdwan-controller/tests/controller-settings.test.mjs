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
  const originalFingerprint = process.env.CONTROLLER_AGENT_CA_SHA256;
  delete process.env.CONTROLLER_ENROLLMENT_URL;
  process.env.CONTROLLER_AGENT_CA_SHA256 = 'AA:'.repeat(31) + 'AA';
  t.after(() => {
    if (original === undefined) delete process.env.CONTROLLER_ENROLLMENT_URL;
    else process.env.CONTROLLER_ENROLLMENT_URL = original;
    if (originalFingerprint === undefined) delete process.env.CONTROLLER_AGENT_CA_SHA256;
    else process.env.CONTROLLER_AGENT_CA_SHA256 = originalFingerprint;
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
  assert.equal(allowed.serverCaSha256, 'A'.repeat(64));

  const blocked = await enrollmentTransport(
    new Request('http://next-internal:3000/api/operator/nodes', {
      headers: { origin: 'http://192.168.160.201:3000' },
    }),
  );
  assert.equal(blocked.controllerUrl, null);
  assert.equal(blocked.insecureHttpBlocked, true);
});

test('allowlisted HTTPS controller gets HTTP enrollment instructions, while other hosts stay blocked', async (t) => {
  const original = process.env.CONTROLLER_ENROLLMENT_URL;
  const originalFingerprint = process.env.CONTROLLER_AGENT_CA_SHA256;
  process.env.CONTROLLER_ENROLLMENT_URL = 'https://192.168.160.200';
  process.env.CONTROLLER_AGENT_CA_SHA256 = 'B'.repeat(64);
  t.after(() => {
    if (original === undefined) delete process.env.CONTROLLER_ENROLLMENT_URL;
    else process.env.CONTROLLER_ENROLLMENT_URL = original;
    if (originalFingerprint === undefined) delete process.env.CONTROLLER_AGENT_CA_SHA256;
    else process.env.CONTROLLER_AGENT_CA_SHA256 = originalFingerprint;
  });
  const instructionsLoader = loader({
    './insecure-http-allowlist': {
      isInsecureHttpHostAllowed: async (host) => host === '192.168.160.200',
    },
  });
  const { enrollmentTransport } = instructionsLoader('src/lib/fabric/enrollment-instructions.ts');
  const lab = await enrollmentTransport(new Request('http://next-internal:3000/api/operator/nodes', {
    headers: { origin: 'http://192.168.160.200' },
  }));
  assert.equal(lab.controllerUrl, 'http://192.168.160.200');
  assert.equal(lab.allowInsecureHttp, true);
  assert.equal(lab.serverCaSha256, 'B'.repeat(64));

  const allowlistedHttpsRequest = await enrollmentTransport(new Request('https://next-internal:3000/api/operator/nodes', {
    headers: { origin: 'https://192.168.160.200' },
  }));
  assert.equal(allowlistedHttpsRequest.controllerUrl, 'http://192.168.160.200');
  assert.equal(allowlistedHttpsRequest.allowInsecureHttp, true);
  assert.equal(allowlistedHttpsRequest.serverCaSha256, 'B'.repeat(64));

  const otherHost = await enrollmentTransport(new Request('http://next-internal:3000/api/operator/nodes', {
    headers: { origin: 'http://192.168.160.201' },
  }));
  assert.equal(otherHost.controllerUrl, null);
  assert.equal(otherHost.insecureHttpBlocked, true);
});

test('invalid server CA fingerprint is not emitted in enrollment instructions', async (t) => {
  const originalEnrollment = process.env.CONTROLLER_ENROLLMENT_URL;
  const originalFingerprint = process.env.CONTROLLER_AGENT_CA_SHA256;
  process.env.CONTROLLER_ENROLLMENT_URL = 'https://192.168.160.200';
  process.env.CONTROLLER_AGENT_CA_SHA256 = 'not-a-fingerprint';
  t.after(() => {
    if (originalEnrollment === undefined) delete process.env.CONTROLLER_ENROLLMENT_URL;
    else process.env.CONTROLLER_ENROLLMENT_URL = originalEnrollment;
    if (originalFingerprint === undefined) delete process.env.CONTROLLER_AGENT_CA_SHA256;
    else process.env.CONTROLLER_AGENT_CA_SHA256 = originalFingerprint;
  });
  const instructionsLoader = loader({
    './insecure-http-allowlist': {
      isInsecureHttpHostAllowed: async (host) => host === '192.168.160.200',
    },
  });
  const { enrollmentTransport } = instructionsLoader('src/lib/fabric/enrollment-instructions.ts');
  const lab = await enrollmentTransport(new Request('https://192.168.160.200/api/operator/nodes', {
    headers: { origin: 'https://192.168.160.200' },
  }));
  assert.equal(lab.controllerUrl, 'http://192.168.160.200');
  assert.equal(lab.serverCaSha256, null);
});
