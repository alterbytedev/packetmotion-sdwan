import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import loader from '../support/load-ts.cjs';

assert.equal(process.env.FABRIC_TEST_ISOLATED, '1', 'Use npm run test:integration');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const service = loader({
  '../db': { getDatabase: () => pool },
  './authorization': { FabricError: class FabricError extends Error { constructor(status, message) { super(message); this.status = status; } } },
})('src/lib/fabric/operator-management.ts');
const root = { id: '1', email: 'root@localhost', role: 'superadmin' };
const admin = { id: '2', email: 'admin@localhost', role: 'admin' };
const viewer = { id: '3', email: 'viewer@localhost', role: 'viewer' };
const createdEmails = [];

test.after(async () => {
  try {
    if (createdEmails.length) await pool.query('DELETE FROM operators WHERE email = ANY($1::text[])', [createdEmails]);
  } finally { await pool.end(); }
});

test('superadmin creates admins and viewers while admin can create viewers only', async () => {
  const firstEmail = `managed-admin-${Date.now()}@localhost`;
  createdEmails.push(firstEmail);
  const first = await service.createOperator(root, { email: firstEmail, role: 'admin' });
  assert.equal(first.operator.role, 'admin');
  assert.ok(first.password.length >= 20);
  const stored = await pool.query('SELECT password_hash FROM operators WHERE email = $1', [firstEmail]);
  assert.notEqual(stored.rows[0].password_hash, first.password);
  assert.match(stored.rows[0].password_hash, /^[a-f0-9]+:[a-f0-9]+$/);

  const viewerEmail = `managed-viewer-${Date.now()}@localhost`;
  createdEmails.push(viewerEmail);
  const createdViewer = await service.createOperator(admin, { email: viewerEmail, role: 'viewer' });
  assert.equal(createdViewer.operator.role, 'viewer');
  await assert.rejects(service.createOperator(admin, { email: `denied-${Date.now()}@localhost`, role: 'admin' }), /Admins can create viewer/);
  await assert.rejects(service.createOperator(viewer, { email: `denied-${Date.now()}@localhost`, role: 'viewer' }), /Operator administration access required/);
});

test('operator creation rejects invalid roles, emails and duplicate addresses', async () => {
  await assert.rejects(service.createOperator(root, { email: 'bad-email', role: 'viewer' }), /valid email/);
  await assert.rejects(service.createOperator(root, { email: `denied-${Date.now()}@localhost`, role: 'superadmin' }), /Choose admin or viewer/);
  const email = `duplicate-${Date.now()}@localhost`;
  createdEmails.push(email);
  await service.createOperator(root, { email, role: 'viewer' });
  await assert.rejects(service.createOperator(root, { email, role: 'viewer' }), /already exists/);
});
