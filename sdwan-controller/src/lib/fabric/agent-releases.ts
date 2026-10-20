import 'server-only';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AgentRelease = { version: string; published: boolean };
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
}

export async function availableAgentReleases(): Promise<AgentRelease[]> {
  const releaseRoot = join(process.cwd(), 'public', 'fabric', 'releases');
  let directories: string[];
  try {
    directories = await readdir(releaseRoot);
  } catch {
    return [];
  }
  const verified: AgentRelease[] = [];
  for (const version of directories.filter((name) => versionPattern.test(name)).sort(compareVersions)) {
    try {
      const manifest = JSON.parse(await readFile(join(releaseRoot, version, 'manifest.json'), 'utf8')) as {
        version?: unknown;
      };
      await readFile(join(releaseRoot, version, 'manifest.sig'));
      if (manifest.version === version) verified.push({ version, published: true });
    } catch {
      // Ignore incomplete or malformed release directories.
    }
  }
  return verified.slice(0, 5);
}
