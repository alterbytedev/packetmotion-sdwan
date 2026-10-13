import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';

const storedRows = [];
const pool = {
  query: async (sql, params) => {
    storedRows.push({ sql, params });
    return { rowCount: 1 };
  },
};
const diagnostics = loader({ '@/lib/db': { getDatabase: () => pool } })('src/lib/diagnostics.ts');

test('request IDs are generated UUIDs', () => {
  assert.match(diagnostics.createRequestId(), /^[0-9a-f-]{36}$/);
});

test('error details persist with redaction and safe metadata logs', async () => {
  const records = [];
  const originalError = console.error;
  console.error = (record) => records.push(record);
  try {
    const error = new Error('password=must-not-log');
    error.name = 'password=must-not-log';
    error.code = 'ECONNREFUSED';
    await diagnostics.reportServerError('operator.api', 'request-123', error, {
      routePath: '/api/operator/nodes',
      method: 'POST',
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(records.length, 1);
  const record = JSON.parse(records[0]);
  assert.equal(record.event, 'controller.request_failed');
  assert.equal(record.errorName, 'UnknownError');
  assert.equal(record.errorCode, 'ECONNREFUSED');
  assert.equal(records[0].includes('must-not-log'), false);
  const insert = storedRows.find((row) => /INSERT INTO runtime_errors/.test(row.sql));
  assert.ok(insert);
  assert.match(insert.params[6], /password=\[REDACTED\]/);
  assert.equal(insert.params[0], 'request-123');
});
