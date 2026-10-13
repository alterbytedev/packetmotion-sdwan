import 'server-only';
import { createHash, randomBytes, X509Certificate, createPublicKey } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FabricError } from './authorization';

const execute = promisify(execFile);
export async function signDeviceCertificate(nodeId: string, pem: unknown) {
  if (
    typeof pem !== 'string' ||
    pem.length > 8192 ||
    !pem.startsWith('-----BEGIN CERTIFICATE REQUEST-----')
  )
    throw new FabricError(400, 'Invalid certificate request.');
  const certPath = process.env.CONTROLLER_DEVICE_CA_CERT;
  const keyPath = process.env.CONTROLLER_DEVICE_CA_KEY;
  if (!certPath || !keyPath) throw new FabricError(503, 'Device enrollment is not configured.');
  if ((await stat(keyPath)).mode & 0o077)
    throw new FabricError(503, 'Device signer permissions are unsafe.');
  const caPem = await readFile(certPath, 'utf8');
  const ca = new X509Certificate(caPem);
  if (
    !ca.ca ||
    Date.parse(ca.validFrom) > Date.now() ||
    Date.parse(ca.validTo) < Date.now() + 31 * 86400_000
  )
    throw new FabricError(503, 'Device signer needs renewal.');
  const directory = await mkdtemp(join(tmpdir(), 'fabric-csr-'));
  try {
    const csr = join(directory, 'request.pem');
    const certificatePath = join(directory, 'certificate.pem');
    await writeFile(csr, pem, { mode: 0o600 });
    let publicKey: string;
    try {
      await execute('openssl', ['req', '-in', csr, '-verify', '-noout'], { timeout: 5000 });
      publicKey = (
        await execute('openssl', ['req', '-in', csr, '-pubkey', '-noout'], { timeout: 5000 })
      ).stdout;
      const key = createPublicKey(publicKey);
      const validRSA =
        key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048 && (key.asymmetricKeyDetails?.modulusLength ?? 0) <= 4096;
      const validEC =
        key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
      if (!validRSA && !validEC) throw new Error('Unsupported key');
    } catch {
      throw new FabricError(400, 'Invalid certificate request.');
    }
    const serial = `01${randomBytes(16).toString('hex')}`;
    const extensions = join(directory, 'extensions');
    await writeFile(
      extensions,
      'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n',
      { mode: 0o600 },
    );
    await execute(
      'openssl',
      [
        'x509',
        '-req',
        '-in',
        csr,
        '-CA',
        certPath,
        '-CAkey',
        keyPath,
        '-set_serial',
        `0x${serial}`,
        '-days',
        '30',
        '-sha256',
        '-subj',
        `/CN=${nodeId}`,
        '-extfile',
        extensions,
        '-out',
        certificatePath,
      ],
      { timeout: 5000 },
    );
    const certificate = await readFile(certificatePath, 'utf8');
    const parsed = new X509Certificate(certificate);
    if (!parsed.verify(ca.publicKey) || parsed.subject !== `CN=${nodeId}`)
      throw new Error('Device certificate validation failed');
    return {
      serial: parsed.serialNumber.toLowerCase().replace(/^0+/, ''),
      certificate,
      expiresAt: new Date(parsed.validTo),
      publicKeyHash: createHash('sha256').update(publicKey).digest('hex'),
      ca: caPem,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
