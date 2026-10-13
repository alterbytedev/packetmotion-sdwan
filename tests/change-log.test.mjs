import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { appendChangeLog } from '../scripts/append-change-log.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'fabric-logs-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('concurrent writers preserve every entry and rotate at 500 KiB', async (t) => {
  const directory = await fixture(t);
  const original = '# Existing history\n' + 'x'.repeat(511950);
  await writeFile(join(directory, 'log_change_001.md'), original);
  const entries = Array.from({ length: 16 }, (_, i) => `\n## entry-${i}\n${'e'.repeat(120)}\n`);
  await Promise.all(entries.map((entry) => appendChangeLog(entry, directory)));
  assert.equal(await readFile(join(directory, 'log_change_001.md'), 'utf8'), original);
  const next = await readFile(join(directory, 'log_change_002.md'), 'utf8');
  for (const entry of entries) assert.equal(next.split(entry).length - 1, 1);
  assert.ok((await stat(join(directory, 'log_change_002.md'))).size <= 512000);
  assert.match(await readFile(join(directory, 'README.md'), 'utf8'), /log_change_002.md/);
});

test('killed lock holder releases lock; later append repairs a stale index', async (t) => {
  const directory = await fixture(t);
  const holder = spawn('python3', ['-c', "import fcntl,sys,time; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX); print('locked',flush=True); time.sleep(60)", join(directory, '.append.lock')]);
  await once(holder.stdout, 'data');
  const exited = once(holder, 'exit');
  holder.kill('SIGKILL');
  await exited;
  await writeFile(join(directory, 'log_change_002.md'), '# Existing rotated history\n');
  await writeFile(join(directory, 'README.md'), '- Active file: `log_change_001.md`\n');
  await appendChangeLog('\n## recovered\n', directory);
  assert.match(await readFile(join(directory, 'README.md'), 'utf8'), /log_change_002.md/);
  assert.match(await readFile(join(directory, 'log_change_002.md'), 'utf8'), /recovered/);
});

test('oversized entry is rejected without overwriting history', async (t) => {
  const directory = await fixture(t);
  await appendChangeLog('\noriginal\n', directory);
  await assert.rejects(appendChangeLog('x'.repeat(512000), directory), /single log file/);
  assert.match(await readFile(join(directory, 'log_change_001.md'), 'utf8'), /original/);
});
