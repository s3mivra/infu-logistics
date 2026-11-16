// Riding out the server restart an app update causes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const html = (status) => new Response('<html>Bad Gateway</html>', { status, headers: { 'content-type': 'text/html' } });
const json = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// A stand-in for the page: just enough for the notice to be put up and taken down.
const shown = [];
const el = () => {
  const node = { style: {}, dataset: {}, children: [], textContent: '', innerHTML: '',
    setAttribute() {}, append(...c) { this.children.push(...c); }, remove() { const i = shown.indexOf(node); if (i >= 0) shown.splice(i, 1); } };
  return node;
};
const notice = () => shown.find((n) => n.dataset.testid === 'update-in-progress');

let serverUp;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  serverUp = false;
  shown.length = 0;
  vi.stubGlobal('document', { createElement: el, body: { appendChild: (n) => shown.push(n) } });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// A fetch standing in for the proxy: 502 (or a refused connection) until the
// server is back, then the real answers.
const stubFetch = ({ refuse = false } = {}) => {
  const calls = [];
  const f = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    if (!serverUp) { if (refuse) throw new TypeError('Failed to fetch'); return html(502); }
    if (String(url).includes('/health')) return json(200, { status: 'ok' });
    return json(200, { success: true, url: String(url) });
  });
  vi.stubGlobal('fetch', f);
  window.fetch = f;
  return calls;
};

describe('meansServerAway', () => {
  it('is the proxy answering for a server that is not there, or a refused connection', async () => {
    const { meansServerAway } = await import('./serverStatus.js');
    expect(meansServerAway(html(502))).toBe(true);
    expect(meansServerAway(html(504))).toBe(true);
    expect(meansServerAway(new TypeError('Failed to fetch'))).toBe(true);
    // The app's own 502 (a partner hub unreachable) is an answer, not an outage.
    expect(meansServerAway(json(502, { error: 'Could not reach hub' }))).toBe(false);
    expect(meansServerAway(json(500))).toBe(false);
  });
});

describe('during an update', () => {
  it('a read waits for the server and goes through; the notice shows, then clears', async () => {
    const calls = stubFetch();
    const { watchServer } = await import('./serverStatus.js');
    watchServer('');
    const auth = await import('../features/auth/auth.js');
    const pending = auth.apiFetch('', '/api/orders');
    await vi.advanceTimersByTimeAsync(2000);
    expect(notice()).toBeTruthy();
    serverUp = true;
    await vi.advanceTimersByTimeAsync(3500);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(notice()).toBeUndefined();
    expect(calls.filter((c) => c.url.includes('/api/orders')).length).toBe(2);
  });

  it('a write the proxy refused never reached the app, so it goes again', async () => {
    const calls = stubFetch();
    const { watchServer } = await import('./serverStatus.js');
    watchServer('');
    const auth = await import('../features/auth/auth.js');
    const pending = auth.apiFetch('', '/api/expenses', { method: 'POST', body: '{}' });
    await vi.advanceTimersByTimeAsync(2000);
    serverUp = true;
    await vi.advanceTimersByTimeAsync(3500);
    expect((await pending).status).toBe(200);
    expect(calls.filter((c) => c.url.includes('/api/expenses')).length).toBe(2);
  });

  it('a plain write whose connection dropped is not sent again (it may have been done)', async () => {
    const calls = stubFetch({ refuse: true });
    const { watchServer } = await import('./serverStatus.js');
    watchServer('');
    const auth = await import('../features/auth/auth.js');
    await expect(auth.apiFetch('', '/api/expenses', { method: 'POST', body: '{}' })).rejects.toThrow();
    expect(calls.filter((c) => c.url.includes('/api/expenses')).length).toBe(1);
  });

  it('an order with an Idempotency-Key is sent again once the server is back', async () => {
    const calls = stubFetch({ refuse: true });
    const { watchServer } = await import('./serverStatus.js');
    watchServer('');
    const auth = await import('../features/auth/auth.js');
    const pending = auth.apiFetch('', '/api/orders', { method: 'POST', headers: { 'Idempotency-Key': 'k1' }, body: '{}' });
    await vi.advanceTimersByTimeAsync(2000);
    serverUp = true;
    await vi.advanceTimersByTimeAsync(3500);
    expect((await pending).status).toBe(200);
    expect(calls.filter((c) => c.url.includes('/api/orders')).length).toBe(2);
  });

  it('a sign-in check that cannot reach the server is not a refusal', async () => {
    stubFetch({ refuse: true });
    const { watchServer } = await import('./serverStatus.js');
    watchServer('');
    const auth = await import('../features/auth/auth.js');
    expect(await auth.refreshSession('')).toBeNull();
    expect(auth.lastRefreshUnreachable()).toBe(true);
  });
});
