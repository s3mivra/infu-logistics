// Two-step sign-in codes (TOTP, RFC 6238): the six digits an authenticator app
// shows, which change every 30 seconds. Standard settings - SHA-1, six digits,
// 30-second steps - because those are the ones every authenticator app
// (Google Authenticator, Microsoft Authenticator, Authy, 1Password) supports.
// No library: it is thirty lines of HMAC, and a sign-in gate is worth being
// able to read in full.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// 20 random bytes, as the 32 letters an app's "enter the key by hand" takes.
export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function codeAt(secret, timeMs = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 1000 / STEP_SECONDS)));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const at = mac[mac.length - 1] & 15;
  const n = ((mac[at] & 127) << 24) | (mac[at + 1] << 16) | (mac[at + 2] << 8) | mac[at + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

// The code now, or the one just before or after: a phone's clock is rarely
// exact, and a code typed at second 29 arrives at second 31.
export function verifyCode(secret, code, timeMs = Date.now()) {
  const typed = String(code || '').replace(/\s/g, '');
  if (!secret || !/^\d{6}$/.test(typed)) return false;
  for (const drift of [0, -1, 1]) {
    const expected = codeAt(secret, timeMs + drift * STEP_SECONDS * 1000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(typed))) return true;
  }
  return false;
}

// What the QR code holds; scanning it adds the account to the app.
export function otpauthUrl({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// Backup codes: for the day the phone is lost. Shown once, kept only as
// hashes, each good for one sign-in.
export const newBackupCodes = (n = 8) => Array.from({ length: n }, () => {
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase();     // 10 characters
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
});
export const hashBackupCode = (code) => crypto.createHash('sha256').update(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
