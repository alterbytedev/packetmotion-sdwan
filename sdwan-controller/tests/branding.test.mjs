import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';

const load = loader({
  '@/lib/db': {},
  './fabric/authorization': {
    authorizeSuperadmin() {},
    currentActor: async () => ({ id: '1', email: 'root@example.test', role: 'superadmin' }),
    FabricError: class FabricError extends Error {},
  },
});
const { validLogoBytes, MAX_LOGO_BYTES } = load('src/lib/branding.ts');

test('logo validation accepts PNG, JPEG, and WebP signatures and rejects spoofed or oversized files', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const webp = Buffer.from('524946460000000057454250', 'hex');
  assert.equal(validLogoBytes('image/png', png), true);
  assert.equal(validLogoBytes('image/jpeg', jpeg), true);
  assert.equal(validLogoBytes('image/webp', webp), true);
  assert.equal(validLogoBytes('image/png', jpeg), false);
  assert.equal(validLogoBytes('image/svg+xml', Buffer.from('<svg/>')), false);
  assert.equal(validLogoBytes('image/png', Buffer.alloc(MAX_LOGO_BYTES + 1)), false);
});
