import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function loadTypeScriptModule(path, mocks) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    exports: module.exports,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    process,
    Buffer,
    Date,
    Map,
  });
  return module.exports;
}

test('temporary operator can log in, access a session, and log out', async (t) => {
  assert.equal(process.env.FABRIC_TEST_ISOLATED, '1', 'Use npm run test:integration');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for the auth integration test');
  assert.ok(process.env.CONTROLLER_SESSION_SECRET?.length >= 32, 'CONTROLLER_SESSION_SECRET must be configured');

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  const email = `auth-test-${randomBytes(8).toString('hex')}@localhost`;
  const password = randomBytes(18).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  const cookieJar = new Map();
  let operatorInserted = false;

  const headersMock = {
    cookies: async () => ({
      get: (key) => cookieJar.has(key) ? { value: cookieJar.get(key) } : undefined,
      set: (key, value) => cookieJar.set(key, value),
      delete: (key) => cookieJar.delete(key),
    }),
  };
  const navigationMock = {
    redirect: (path) => { throw new Error(`redirect:${path}`); },
  };
  const databaseMock = { getDatabase: () => pool };
  const operatorMock = loadTypeScriptModule('src/lib/operators.ts', { 'server-only': {}, './db': databaseMock });
  const rateLimitMock = loadTypeScriptModule('src/lib/login-rate-limit.ts', { 'server-only': {}, './db': databaseMock });
  const sessionModule = require('../support/session.cjs');
  const authMock = loadTypeScriptModule('src/lib/auth.ts', {
    'server-only': {},
    'next/headers': headersMock,
    'next/navigation': navigationMock,
    './operators': operatorMock,
    './session': sessionModule,
  });
  const actions = loadTypeScriptModule('src/app/login/actions.ts', {
    'next/headers': headersMock,
    'next/navigation': navigationMock,
    '@/lib/auth': { SESSION_COOKIE: authMock.SESSION_COOKIE, sessionSecret: authMock.sessionSecret },
    '@/lib/operators': operatorMock,
    '@/lib/login-rate-limit': rateLimitMock,
    '@/lib/session': sessionModule,
  });

  t.after(async () => {
    try {
      if (operatorInserted) await pool.query('DELETE FROM operators WHERE email = $1', [email]);
      await pool.query('DELETE FROM login_attempts WHERE attempt_key = $1', [
        (await import('node:crypto')).createHash('sha256').update(email).digest('hex'),
      ]);
    } finally {
      await pool.end();
    }
  });

  try {
    await pool.query('DELETE FROM operators WHERE email = $1', [email]);
    await pool.query('INSERT INTO operators (email, password_hash) VALUES ($1, $2)', [email, passwordHash]);
    operatorInserted = true;

    const form = new FormData();
    form.set('email', email);
    form.set('password', password);
    await assert.rejects(actions.login({ error: '' }, form), /redirect:\/dashboard/);
    assert.equal(cookieJar.has(authMock.SESSION_COOKIE), true);
    assert.equal(await authMock.getUser(), email);

    await assert.rejects(actions.logout(), /redirect:\/login/);
    assert.equal(cookieJar.has(authMock.SESSION_COOKIE), false);
    assert.equal(await authMock.getUser(), null);
  } finally {
    if (operatorInserted) {
      await pool.query('DELETE FROM operators WHERE email = $1', [email]);
      operatorInserted = false;
    }
  }
});
