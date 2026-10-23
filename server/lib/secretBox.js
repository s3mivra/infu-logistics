// Small secrets kept in the database (the mail account's password), encrypted
// at rest with AES-256-GCM. The key is derived from this server's JWT_SECRET,
// so a database copy on its own does not reveal them.
//
// If JWT_SECRET is rotated, what was sealed under the old one can no longer be
// opened: open() returns null and the caller asks for the secret again. Never
// throws, never logs the value.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const keyOf = (secret = process.env.JWT_SECRET || '') => createHash('sha256').update(`semivra:secret-box:${secret}`).digest();

/** -> "v1.<iv>.<tag>.<data>" (base64url), or '' for an empty value. */
export function seal(plain, secret) {
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
  try {
    const [v, iv, tag, data] = String(box).split('.');
    if (v !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
