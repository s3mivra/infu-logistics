import { describe, it, expect, afterEach } from 'vitest';
import { seal, open } from './secretBox.js';

const K = 'k'.repeat(40);

describe('secret box', () => {
  it('round-trips, and the sealed text does not contain the secret', () => {
    const box = seal('abcd efgh ijkl mnop', K);
    expect(box).not.toContain('abcd');
    expect(open(box, K)).toBe('abcd efgh ijkl mnop');
  });

  it('seals the same value differently each time', () => {
    expect(seal('same', K)).not.toBe(seal('same', K));
  });

  it('cannot be opened with another key, or once tampered with', () => {
    const box = seal('secret', K);
    expect(open(box, 'x'.repeat(40))).toBeNull();
    const parts = box.split('.');
    parts[3] = Buffer.from('forged').toString('base64url');
    expect(open(parts.join('.'), K)).toBeNull();
    expect(open('garbage', K)).toBeNull();
  });

  it('an empty value is an empty box', () => {
    expect(seal('', K)).toBe('');
    expect(open('', K)).toBe('');
  });
});

// 2026-11 audit, M79: with FIELD_ENCRYPTION_KEY set, rotating JWT_SECRET no
// longer destroys what was sealed - and boxes sealed before the key was set
// still open.
describe('FIELD_ENCRYPTION_KEY', () => {
  const saved = { j: process.env.JWT_SECRET, f: process.env.FIELD_ENCRYPTION_KEY };
  afterEach(() => { process.env.JWT_SECRET = saved.j; if (saved.f === undefined) delete process.env.FIELD_ENCRYPTION_KEY; else process.env.FIELD_ENCRYPTION_KEY = saved.f; });

  it('a box sealed under JWT_SECRET alone still opens once the key is set', () => {
    process.env.JWT_SECRET = 'jwt-one'; delete process.env.FIELD_ENCRYPTION_KEY;
    const old = seal('smtp-pass');
    process.env.FIELD_ENCRYPTION_KEY = 'field-key';
    expect(open(old)).toBe('smtp-pass');
  });

  it('a box sealed with the key survives a JWT_SECRET rotation', () => {
    process.env.JWT_SECRET = 'jwt-one'; process.env.FIELD_ENCRYPTION_KEY = 'field-key';
    const box = seal('smtp-pass');
    process.env.JWT_SECRET = 'jwt-two';
    expect(open(box)).toBe('smtp-pass');
  });
});
