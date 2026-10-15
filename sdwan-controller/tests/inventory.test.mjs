import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';

const load = loader({ 'next/headers': {}, 'next/navigation': {} });
const { siteInput, nodeInput } = load('src/lib/fabric/validation.ts');
const { authorize, authorizeSuperadmin } = load('src/lib/fabric/authorization.ts');
const admin = { id: '1', email: 'admin@example.test', role: 'admin' };

test('authorization rejects anonymous, viewer writes and unknown roles', () => {
  assert.throws(() => authorize(null), /Sign in/);
  authorize(admin, true);
  authorize({ ...admin, role: 'viewer' });
  assert.throws(() => authorize({ ...admin, role: 'viewer' }, true), /Administrator/);
  assert.throws(() => authorize({ ...admin, role: 'owner' }), /denied/);
});

test('branding authorization is restricted to superadmins while superadmins retain admin access', () => {
  const superadmin = { ...admin, role: 'superadmin' };
  authorize(superadmin, true);
  authorizeSuperadmin(superadmin);
  assert.throws(() => authorizeSuperadmin(admin), /Superadmin/);
  assert.throws(() => authorizeSuperadmin({ ...admin, role: 'viewer' }), /Superadmin/);
  assert.throws(() => authorizeSuperadmin(null), /Sign in/);
});

test('site validation rejects malformed, noncanonical and special-use IPv4 prefixes', () => {
  for (const lanPrefix of ['bad', '10.1.0.1/24', '10.1.0.0/33', '0.0.0.0/0', '127.0.0.0/8', '224.0.0.0/4', '::/64', '10.1.0.0/24/extra', '128.0.0.0/1']) {
    assert.throws(() => siteInput({ name: 'Branch', mode: 'gateway', lanPrefix }));
  }
  assert.equal(siteInput({ name: ' Branch ', mode: 'subnet-router', lanPrefix: '10.61.0.0/24' }).name, 'Branch');
  assert.throws(() => siteInput({ name: 'Branch', mode: 'gateway', role: 'admin' }), /Unknown/);
  assert.throws(() => siteInput({ name: '', mode: 'gateway' }), /Name/);
  assert.throws(() => siteInput({ name: 'Branch', mode: 'bridge' }), /mode/);
  assert.throws(() => nodeInput({ name: 'Node', siteId: 'bad', kind: 'branch' }), /site/);
});

test('request boundary denies CSRF, malformed JSON, large bodies and viewer writes before mutation', async (t) => {
  const originalOrigin = process.env.CONTROLLER_PUBLIC_ORIGIN;
  delete process.env.CONTROLLER_PUBLIC_ORIGIN;
  t.after(() => { if (originalOrigin === undefined) delete process.env.CONTROLLER_PUBLIC_ORIGIN; else process.env.CONTROLLER_PUBLIC_ORIGIN = originalOrigin; });
  let mutations = 0;
  let actor = admin;
  const modules = loader({ '@/unused': {}, './authorization': { currentActor: async () => actor, authorize,
    FabricError: load('src/lib/fabric/authorization.ts').FabricError } });
  const { operatorRequest } = modules('src/lib/fabric/http.ts');
  const run = (headers, body) => operatorRequest(new Request('https://controller.test/api/operator/sites', {
    method: 'POST', headers, body,
  }), true, async () => { mutations++; return {}; });
  const validHeaders = { origin: 'https://controller.test', 'content-type': 'application/json' };
  assert.equal((await run({ ...validHeaders, origin: 'https://attacker.test' }, '{}')).status, 403);
  assert.equal((await run({ 'content-type': 'application/json' }, '{}')).status, 403);
  assert.equal((await run({ ...validHeaders, 'sec-fetch-site': 'cross-site' }, '{}')).status, 403);
  assert.equal((await run(validHeaders, 'bad json')).status, 400);
  assert.equal((await run(validHeaders, ' '.repeat(8193))).status, 413);
  assert.equal((await run({ ...validHeaders, 'content-type': 'text/plain' }, '{}')).status, 415);
  actor = { ...admin, role: 'viewer' };
  assert.equal((await run(validHeaders, '{}')).status, 403);
  actor = null;
  assert.equal((await run(validHeaders, '{}')).status, 401);
  assert.equal(mutations, 0);
  actor = admin;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal((await run(validHeaders, '{}')).status, 403);
    assert.equal((await run({ 'content-type': 'application/json' }, '{}')).status, 403);
    process.env.CONTROLLER_PUBLIC_ORIGIN = 'https://controller.test';
    assert.equal((await run(validHeaders, '{}')).status, 201);
    assert.equal(mutations, 1);
  } finally { if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv; }

});

test('enrollment instructions use the request origin when no public enrollment URL is configured', async () => {
  const route = load('src/app/api/operator/nodes/route.ts');
  const inventory = {
    createNode: async () => ({
      id: '00000000-0000-0000-0000-000000000001',
      enrollment: { token: 'pm_enroll_test', expiresAt: '2030-01-01T00:00:00Z' },
    }),
  };
  const routeLoader = loader({
    '@/lib/fabric/http': {
      operatorRequest: async (_request, _mutation, handler) =>
        Response.json(await handler(admin, {})),
    },
    '@/lib/fabric/inventory': inventory,
  });
  const { POST } = routeLoader('src/app/api/operator/nodes/route.ts');
  const response = await POST(new Request('http://next-internal:3000/api/operator/nodes', {
    method: 'POST',
    headers: { origin: 'https://controller.example.test' },
  }));
  const result = await response.json();
  assert.equal(result.enrollment.controllerUrl, 'https://controller.example.test');
});
