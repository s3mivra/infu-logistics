// Small secrets kept in the database (the mail account's password), encrypted
// at rest with AES-256-GCM. The key comes from FIELD_ENCRYPTION_KEY, or this
// server's JWT_SECRET when that is not set,
// so a database copy on its own does not reveal them.
//
// If JWT_SECRET is rotated, what was sealed under the old one can no longer be
// opened: open() returns null and the caller asks for the secret again. Never
// throws, never logs the value.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const keyOf = (secret) => createHash('sha256').update(`semivra:secret-box:${secret}`).digest();
// The key material: FIELD_ENCRYPTION_KEY when set, the same key that seals
// personal fields (lib/fieldCrypt.js), so rotating JWT_SECRET no longer
// destroys the mail password (2026-11 audit, M79). Otherwise JWT_SECRET, as
// before. Opening also tries the JWT_SECRET key, so a box sealed before
// FIELD_ENCRYPTION_KEY was set still opens (and is re-sealed on its next save).
const primarySecret = () => process.env.FIELD_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
const openWith = (box, secret) => {
  try {
    const [v, iv, tag, data] = String(box).split('.');
    if (v !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
};

/** -> "v1.<iv>.<tag>.<data>" (base64url), or '' for an empty value. */
export function seal(plain, secret = primarySecret()) {
  const text = String(plain ?? '');
  if (!text) return '';
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** The plain value, '' for an empty box, or null when it cannot be opened (wrong key, tampered). */
export function open(box, secret) {
  if (!box) return '';
  if (secret !== undefined) return openWith(box, secret);
  const first = openWith(box, primarySecret());
  if (first !== null || !process.env.FIELD_ENCRYPTION_KEY) return first;
  return openWith(box, process.env.JWT_SECRET || '');
}
