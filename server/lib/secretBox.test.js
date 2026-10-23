import { describe, it, expect } from 'vitest';
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
