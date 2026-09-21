import { describe, it, expect } from 'vitest';
import { decodeToken, tokenExpiresSoon, can } from './auth.js';

// A JWT the way the server signs one: base64URL, UTF-8, no padding.
const b64url = (obj) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

describe('reading a token', () => {
  it('reads a payload that base64URL spells with - and _', () => {
    // "?>" and "~" land on the two characters base64URL swaps in; atob() threw
    // on them, and an unreadable token meant no permissions at all.
    const payload = { role: 'staff', name: 'Who?>~~', perms: ['pos.use', 'orders.view'] };
    const t = token(payload);
    expect(t.split('.')[1]).toMatch(/[-_]/);
    expect(decodeToken(t)).toEqual(payload);
    expect(can('pos.use', t)).toBe(true);
  });

  it('keeps an accented name intact', () => {
    expect(decodeToken(token({ name: 'María Niño' })).name).toBe('María Niño');
  });

  it('returns nothing for garbage rather than throwing', () => {
    expect(decodeToken('not-a-token')).toBeNull();
    expect(decodeToken('')).toBeNull();
  });
});

describe('knowing when to refresh', () => {
  const now = Math.floor(Date.now() / 1000);
  it('asks for a new token shortly before the old one runs out', () => {
    expect(tokenExpiresSoon(token({ exp: now + 5 }))).toBe(true);
    expect(tokenExpiresSoon(token({ exp: now - 60 }))).toBe(true);
  });
  it('leaves a token with minutes to go alone', () => {
    expect(tokenExpiresSoon(token({ exp: now + 600 }))).toBe(false);
  });
});
