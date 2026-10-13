import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

test('limiter removes rows older than the prior minute before counting', async () => {
  const source = ts.transpileModule(readFileSync('src/lib/login-rate-limit.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const queries = [];
  const database = { query: async (...args) => {
    queries.push(args);
    if (queries.length === 1) return { rows: [] };
    return { rows: [{ allowed: true }] };
  } };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    exports: module.exports,
    require: (name) => name === './db' ? { getDatabase: () => database } : {},
  });

  assert.equal(await module.exports.consumeLoginAttempt('normalized-email-hash'), true);
  assert.match(queries[0][0], /DELETE FROM login_attempts/);
  assert.match(queries[0][0], /interval '1 minute'/);
  assert.match(queries[1][0], /RETURNING attempts <= \$2 AS allowed/);
  assert.equal(queries[1][1][0], 'normalized-email-hash');
  assert.equal(queries[1][1][1], 10);
});
