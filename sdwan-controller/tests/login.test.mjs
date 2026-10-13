import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import sessionModule from './support/session.cjs';
const { verifySession } = sessionModule;

const require = createRequire(import.meta.url);
const salt = '1'.repeat(32);
const config = {
  email: 'admin@example.com',
  hash: `${salt}:${scryptSync('correct-password', salt, 64).toString('hex')}`,
  secret: 's'.repeat(64),
};
function loadActions(configured = true, allowed = true) {
  const written = [];
  const deleted = [];
  const source = ts.transpileModule(readFileSync('src/app/login/actions.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    'next/headers': {
      cookies: async () => ({
        set: (...args) => written.push(args),
        delete: (key) => deleted.push(key),
      }),
    },
    'next/navigation': {
      redirect: (path) => {
        throw new Error(`redirect:${path}`);
      },
    },
    '@/lib/auth': {
      sessionSecret: () => (configured ? config.secret : null),
      SESSION_COOKIE: 'sdwan-session',
    },
    '@/lib/operators': { findOperator: async () => ({ email: config.email, passwordHash: config.hash }) },
    '@/lib/login-rate-limit': {
      consumeLoginAttempt: async () => allowed,
      clearLoginAttempts: async () => {},
    },
    '@/lib/session': sessionModule,
  };
  vm.runInNewContext(source, {
    exports: module.exports,
    require: (name) => mocks[name] ?? require(name),
    process,
    Buffer,
    Date,
    Map,
  });
  return { actions: module.exports, written, deleted };
}
function form(email, password) {
  const data = new FormData();
  data.set('email', email);
  data.set('password', password);
  return data;
}

test('wrong password does not issue a session', async () => {
  const { actions, written } = loadActions();
  const result = await actions.login({ error: '' }, form(config.email, 'wrong'));
  assert.equal(result.error, 'Invalid email or password.');
  assert.equal(written.length, 0);
});
test('valid login issues a signed HTTP-only cookie and redirects', async () => {
  const { actions, written } = loadActions();
  await assert.rejects(
    actions.login({ error: '' }, form(' ADMIN@EXAMPLE.COM ', 'correct-password')),
    /redirect:\/dashboard/,
  );
  const [name, token, options] = written[0];
  assert.equal(name, 'sdwan-session');
  assert.equal(
    verifySession(
      token,
      config.secret,
      config.email,
      Date.now(),
      (await import('node:crypto')).createHash('sha256').update(config.hash).digest('hex'),
    ),
    config.email,
  );
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.path, '/');
  assert.equal(options.maxAge, 8 * 60 * 60);
});
test('unconfigured controller rejects sign-in', async () => {
  const { actions, written } = loadActions(false);
  const result = await actions.login({ error: '' }, form(config.email, 'correct-password'));
  assert.match(result.error, /not configured/);
  assert.equal(written.length, 0);
});
test('rate limited login is rejected', async () => {
  const { actions, written } = loadActions(true, false);
  const result = await actions.login({ error: '' }, form(config.email, 'correct-password'));
  assert.match(result.error, /Too many attempts/);
  assert.equal(written.length, 0);
});
test('sign-out clears the session and returns to login', async () => {
  const { actions, deleted } = loadActions();
  await assert.rejects(actions.logout(), /redirect:\/login/);
  assert.deepEqual(deleted, ['sdwan-session']);
});
