import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import loader from './support/load-ts.cjs';

test('agent releases are sorted by semantic version and limited to five complete signed bundles', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fabric-releases-'));
  const previous = process.cwd();
  t.after(async () => { process.chdir(previous); await rm(root, { recursive: true, force: true }); });
  const releaseRoot = join(root, 'public/fabric/releases');
  for (const version of ['0.9.9', '0.10.0', '1.0.0', '0.8.0', '0.7.0', '0.6.0', 'broken']) {
    const directory = join(releaseRoot, version);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version }));
    if (version !== '0.7.0') await writeFile(join(directory, 'manifest.sig'), 'signature');
  }
  const { availableAgentReleases } = loader({})('src/lib/fabric/agent-releases.ts');
  process.chdir(root);
  const releases = await availableAgentReleases();
  assert.deepEqual(JSON.parse(JSON.stringify(releases)), [
    { version: '1.0.0', published: true },
    { version: '0.10.0', published: true },
    { version: '0.9.9', published: true },
    { version: '0.8.0', published: true },
    { version: '0.6.0', published: true },
  ]);
});
