import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode, codeAt, verifyCode, newSecret, otpauthUrl, newBackupCodes, hashBackupCode } from './totp.js';

// The test vectors published with the standard (RFC 6238, appendix B): the
// secret is the ASCII text "12345678901234567890", and these are the six-digit
// ends of the codes it gives at those moments.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const VECTORS = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']];

describe('two-step sign-in codes', () => {
  it('match the standard’s own test vectors', () => {
    for (const [seconds, code] of VECTORS) expect(codeAt(RFC_SECRET, seconds * 1000), String(seconds)).toBe(code);
  });

  it('base32 goes there and back', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString()).toBe('12345678901234567890');
    expect(base32Decode('gezd gnbv-gy3t qojq').toString()).toBe('1234567890');   // spaces and case are forgiven
  });

  it('accept the code now and the one either side of it, and nothing further', () => {
    const secret = newSecret();
    const now = 1_700_000_000_000;
    expect(verifyCode(secret, codeAt(secret, now), now)).toBe(true);
    expect(verifyCode(secret, codeAt(secret, now - 30_000), now)).toBe(true);
    expect(verifyCode(secret, codeAt(secret, now + 30_000), now)).toBe(true);
    expect(verifyCode(secret, codeAt(secret, now - 90_000), now)).toBe(false);
    expect(verifyCode(secret, ` ${codeAt(secret, now).slice(0, 3)} ${codeAt(secret, now).slice(3)} `, now)).toBe(true);   // typed "123 456"
  });

  it('refuse anything that is not six digits, and never throw on it', () => {
    const secret = newSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 5x']) expect(verifyCode(secret, bad)).toBe(false);
    expect(verifyCode('', '123456')).toBe(false);
  });

  it('a new secret is 32 letters an authenticator app accepts', () => {
    const s = newSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(newSecret()).not.toBe(s);
  });

  it('the QR link names the business and the person', () => {
    const url = otpauthUrl({ secret: 'ABC234', account: 'Ana Reyes', issuer: 'Infusion Logistics' });
    expect(url).toBe('otpauth://totp/Infusion%20Logistics%3AAna%20Reyes?secret=ABC234&issuer=Infusion%20Logistics&algorithm=SHA1&digits=6&period=30');
  });

  it('backup codes are distinct, and match however they are typed', () => {
    const codes = newBackupCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes[0]).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    expect(hashBackupCode(codes[0].toLowerCase().replace('-', ' '))).toBe(hashBackupCode(codes[0]));
  });
});
