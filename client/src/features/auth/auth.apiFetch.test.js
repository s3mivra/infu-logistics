// 2026-11 audit, M114 and M116: what apiFetch retries, when it gives up a
// session, and the error field every screen reads.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as auth from './auth.js';

const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// A token good for an hour, so apiFetch does not refresh before sending.
const liveToken = () => `${b64url({ alg: 'HS256' })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const API = 'http://api.test';

let calls;
const stubFetch = (handler) => {
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => { calls.push({ url: String(url), method: opts.method || 'GET' }); return handler(String(url), opts, calls.length); });
};

beforeEach(() => { auth.setToken(liveToken()); });

describe('a 401 that is the route\'s answer, not the session\'s', () => {
  it('is not retried and does not cost the session', async () => {
    stubFetch((url) => (url.endsWith('/api/auth/refresh')
      ? json(200, { token: liveToken() })
      : json(401, { success: false, error: 'Your password is incorrect.' })));
    const res = await auth.apiFetch(API, '/api/users/me/password', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(calls.filter((c) => c.url.endsWith('/api/users/me/password'))).toHaveLength(1);
    expect(calls.some((c) => c.url.endsWith('/api/auth/refresh'))).toBe(false);
    expect(await auth.isTokenRejection(res)).toBe(false);
  });
});

describe('a 401 that refuses the token', () => {
  it('refreshes once and sends the request again', async () => {
    stubFetch((url, _o, n) => {
      if (url.endsWith('/api/auth/refresh')) return json(200, { token: liveToken() });
      return n === 1 ? json(401, { success: false, message: 'Unauthorized: Invalid or expired token' }) : json(200, { success: true });
    });
    const res = await auth.apiFetch(API, '/api/orders', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url.replace(API, ''))).toEqual(['/api/orders', '/api/auth/refresh', '/api/orders']);
  });
});

describe('a refresh that fails for a reason other than refusal', () => {
  it('keeps the token on a 503, and drops it on a 401', async () => {
    const before = liveToken();
    auth.setToken(before);
    stubFetch((url) => (url.endsWith('/api/auth/refresh') ? json(503, { error: 'starting' }) : json(200, {})));
    expect(await auth.refreshSession(API)).toBeNull();
    let sent;
    stubFetch((url, opts) => { sent = opts.headers?.Authorization; return json(200, {}); });
    await auth.apiFetch(API, '/api/products');
    expect(sent).toBe(`Bearer ${before}`);

    stubFetch((url) => (url.endsWith('/api/auth/refresh') ? json(401, { error: 'Session expired.' }) : json(200, {})));
    await auth.refreshSession(API);
    stubFetch((url, opts) => { sent = opts.headers?.Authorization; return json(200, {}); });
    await auth.apiFetch(API, '/api/auth/me');
    expect(sent).toBeUndefined();
  });
});

describe('error bodies', () => {
  it('carry `error` even when the server wrote `message`', async () => {
    stubFetch(() => json(403, { success: false, message: 'Forbidden: needs orders.manage' }));
    const res = await auth.apiFetch(API, '/api/orders/1', { method: 'PUT', body: '{}' });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe('Forbidden: needs orders.manage');
    expect(body.message).toBe('Forbidden: needs orders.manage');
  });
});
