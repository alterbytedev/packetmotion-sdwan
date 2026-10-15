import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const edgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(edgeRoot, '..');
const publicRoot = join(repoRoot, 'sdwan-controller', 'public', 'fabric');
const source = await readFile(join(edgeRoot, 'internal', 'agent', 'agent.go'), 'utf8');
const version = source.match(/const Version = "([0-9]+\.[0-9]+\.[0-9]+)"/)?.[1];
if (!version) throw new Error('Could not determine agent version from source.');
const signingKey = resolve(process.env.FABRIC_RELEASE_SIGNING_KEY || join(repoRoot, '.pki', 'edge-release-private.pem'));
const publicKeyPath = join(edgeRoot, 'release', 'release-public.pem');
const publicKey = (await readFile(publicKeyPath, 'utf8')).trim();
const sourceInstaller = await readFile(join(edgeRoot, 'install', 'edge.sh'), 'utf8');
const service = await readFile(join(repoRoot, 'deploy', 'systemd', 'fabric-agent.service'));
if (sourceInstaller.includes('@@VERSION@@') === false || sourceInstaller.includes('@@PUBLIC_KEY@@') === false)
  throw new Error('Installer release placeholders are missing.');
const controllerRoot = join(repoRoot, 'sdwan-controller');
const tempRoot = join(publicRoot, `.staging-${version}-${process.pid}`);
const releaseRoot = join(publicRoot, 'releases', version);
await mkdir(join(publicRoot, 'releases'), { recursive: true });
try {
  await mkdir(tempRoot, { recursive: false });
  const files = {};
  for (const arch of ['amd64', 'arm64']) {
    const name = `fabric-agent-linux-${arch}`;
    const output = join(tempRoot, name);
    execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', output, './cmd/fabric-agent'], {
      cwd: edgeRoot,
      env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: arch },
      stdio: 'inherit',
    });
    files[name] = createHash('sha256').update(await readFile(output)).digest('hex');
  }
  files['fabric-agent.service'] = createHash('sha256').update(service).digest('hex');
  const manifest = Buffer.from(`${JSON.stringify({ version, files })}\n`);
  const manifestPath = join(tempRoot, 'manifest.json');
  const signaturePath = join(tempRoot, 'manifest.sig');
  await writeFile(manifestPath, manifest, { mode: 0o644 });
  execFileSync('openssl', ['pkeyutl', '-sign', '-inkey', signingKey, '-rawin', '-in', manifestPath, '-out', signaturePath]);
  execFileSync('openssl', ['pkeyutl', '-verify', '-pubin', '-inkey', publicKeyPath, '-sigfile', signaturePath, '-rawin', '-in', manifestPath], { stdio: 'ignore' });
  await copyFile(join(repoRoot, 'deploy', 'systemd', 'fabric-agent.service'), join(tempRoot, 'fabric-agent.service'));
  if (await exists(releaseRoot)) {
    const existingManifest = await readFile(join(releaseRoot, 'manifest.json'));
    if (!existingManifest.equals(manifest)) throw new Error(`Release ${version} already exists with different contents; increment the agent version.`);
    execFileSync('openssl', ['pkeyutl', '-verify', '-pubin', '-inkey', publicKeyPath, '-sigfile', join(releaseRoot, 'manifest.sig'), '-rawin', '-in', join(releaseRoot, 'manifest.json')], { stdio: 'ignore' });
    for (const [name, expected] of Object.entries(files)) {
      const existing = createHash('sha256').update(await readFile(join(releaseRoot, name))).digest('hex');
      if (existing !== expected) throw new Error(`Existing release file failed integrity check: ${name}`);
    }
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    await rename(tempRoot, releaseRoot);
  }
  const rendered = sourceInstaller
    .replace('@@VERSION@@', version)
    .replace('@@PUBLIC_KEY@@', publicKey);
  const installerTemp = join(publicRoot, `.edge.sh-${process.pid}`);
  await writeFile(installerTemp, rendered, { mode: 0o755 });
  await rename(installerTemp, join(publicRoot, 'edge.sh'));
  console.log(`Published verified Linux ${version} agent artifacts to ${resolve(controllerRoot, 'public/fabric')}.`);
} catch (error) {
  await rm(tempRoot, { recursive: true, force: true });
  throw error;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}
