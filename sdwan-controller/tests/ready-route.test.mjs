import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import loader from './support/load-ts.cjs';

const oldDatabaseUrl = process.env.DATABASE_URL;
before(() => { process.env.DATABASE_URL = 'postgresql://unit.test/controller'; });
after(() => {
  if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldDatabaseUrl;
});

function loadReadyRoute(query) {
  const reports = [];
  const moduleLoader = loader({
    '@/lib/db': { getDatabase: () => ({ query }) },
    '@/lib/diagnostics': {
      createRequestId: () => '123e4567-e89b-42d3-a456-426614174000',
      reportServerError: async (...args) => reports.push(args),
    },
  });
  return { route: moduleLoader('src/app/api/ready/route.ts'), reports };
}

test('readiness requires core management tables and columns while ignoring optional feature tables', async () => {
  let sql = '';
  const { route } = loadReadyRoute(async (statement) => {
    sql = statement;
    return { rows: [{ table_name: 'desired_configs', column_name: 'checksum' }], rowCount: 1 };
  });
  const response = await route.GET();
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.dependency, 'schema');
  assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.equal('table_name' in body, false);
  for (const table of ['nodes', 'device_certificates', 'desired_configs', 'config_acknowledgements', 'device_telemetry'])
    assert.ok(sql.includes(`'${table}'`), `missing required schema check for ${table}`);
  assert.equal(sql.includes('device_state_reports'), false);
  assert.equal(sql.includes('device_command_history'), false);
  assert.equal(sql.toLowerCase().includes('insert '), false);
  assert.equal(sql.toLowerCase().includes('alter '), false);
});

test('readiness succeeds when the required schema query finds no gaps', async () => {
  const { route } = loadReadyRoute(async () => ({ rows: [], rowCount: 0 }));
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ready');
});

test('database outage keeps a safe request reference and generic public response', async () => {
  const outage = Object.assign(new Error('password=DO_NOT_EXPOSE'), { code: '08006' });
  const { route, reports } = loadReadyRoute(async () => { throw outage; });
  const response = await route.GET();
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.dependency, 'database');
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.equal(JSON.stringify(body).includes('DO_NOT_EXPOSE'), false);
  assert.equal(reports.length, 1);
  assert.equal(reports[0][1], response.headers.get('x-request-id'));
});
