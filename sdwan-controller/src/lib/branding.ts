import 'server-only';
import { getDatabase } from './db';
import { authorizeSuperadmin, currentActor, FabricError } from './fabric/authorization';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function validLogoBytes(mimeType: string, data: Uint8Array) {
  if (!allowedMimeTypes.has(mimeType) || data.length === 0 || data.length > MAX_LOGO_BYTES)
    return false;
  if (mimeType === 'image/png')
    return data.length >= 8 && Buffer.from(data.subarray(0, 8)).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mimeType === 'image/jpeg') return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff && data.at(-1) === 0xd9;
  return data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString() === 'RIFF' && Buffer.from(data.subarray(8, 12)).toString() === 'WEBP';
}

export async function saveLogo(actorId: string, mimeType: string, data: Uint8Array) {
  const actor = await currentActor();
  authorizeSuperadmin(actor);
  if (actor.id !== actorId) throw new FabricError(403, 'Superadmin access required.');
  if (!validLogoBytes(mimeType, data))
    throw new FabricError(400, 'Choose a valid PNG, JPEG, or WebP image up to 2 MiB.');
  await getDatabase().query(
    `INSERT INTO controller_branding (id, logo_mime, logo_data, updated_by)
     VALUES (TRUE, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET logo_mime = EXCLUDED.logo_mime,
       logo_data = EXCLUDED.logo_data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [mimeType, Buffer.from(data), actor.id],
  );
}

export async function removeLogo() {
  const actor = await currentActor();
  authorizeSuperadmin(actor);
  await getDatabase().query('DELETE FROM controller_branding WHERE id = TRUE');
}

export async function getLogo() {
  const result = await getDatabase().query<{ logo_mime: string; logo_data: Buffer }>(
    'SELECT logo_mime, logo_data FROM controller_branding WHERE id = TRUE',
  );
  return result.rows[0] ?? null;
}
