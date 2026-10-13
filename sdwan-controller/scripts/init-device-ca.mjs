import { mkdir, open, writeFile } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const directory = resolve(process.argv[2] || '.pki');
await mkdir(directory, { recursive: true, mode: 0o700 });
const privatePath = join(directory, 'device-ca.key');
const certPath = join(directory, 'device-ca.crt');
// Exclusive creation prevents replacing a live CA.
const handle = await open(privatePath, 'wx', 0o600);
try {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
  await handle.writeFile(privateKey);
} finally { await handle.close(); }
const certificate = execFileSync('openssl', ['req', '-new', '-x509', '-key', privatePath, '-days', '3650',
  '-subj', '/CN=PacketMotion Device CA', '-addext', 'basicConstraints=critical,CA:TRUE',
  '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: ['ignore', 'pipe', 'pipe'] });
await writeFile(certPath, certificate, { flag: 'wx', mode: 0o600 });
console.log('Device CA created. Configure CONTROLLER_DEVICE_CA_CERT and CONTROLLER_DEVICE_CA_KEY with these file paths. No private key was printed.');
