import assert from 'node:assert/strict';
import test from 'node:test';
import { isOperatorEmail, OPERATOR_ROLES } from '../scripts/lib/operator-role.mjs';

test('operator role CLI accepts the default localhost email and normal email domains', () => {
  assert.equal(isOperatorEmail('admin@localhost'), true);
  assert.equal(isOperatorEmail('operator@example.com'), true);
  assert.equal(isOperatorEmail('admin@local host'), false);
  assert.equal(isOperatorEmail('missing-domain'), false);
  assert.equal(isOperatorEmail(''), false);
});

test('operator role CLI supports only the defined operator roles', () => {
  assert.deepEqual(OPERATOR_ROLES, ['superadmin', 'admin', 'viewer']);
});
