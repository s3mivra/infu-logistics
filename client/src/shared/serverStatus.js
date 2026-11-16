/* "Update in progress": riding out the server restart an app update causes.
 *
 * Updating the app replaces the server, and for the minute or so that takes
 * every request fails - the proxy answers 502/503/504, or the connection is
 * refused. Before this, a till or a client's phone showed errors, and a page
 * loaded in that minute dropped staff at the login screen though their sign-in
 * was still good.
 *
 * Now:
 *   - any page that sees the server go away shows a notice, "Update in
 *     progress", and checks /health every few seconds until it answers;
 *   - requests that are safe to send again (a read, or a write the server
 *     never received - the proxy refused it, or it carries an
 *     Idempotency-Key) wait for the server and are sent again, so the screen
 *     simply carries on;
 *   - the notice clears itself, with a short "Updated" note, once the server
 *     is back.
 * Nothing typed is lost: carts and open forms are kept in the browser (see
 * draft.js, useFormDraft, the till cart) and survive the page refreshing.
 */

const POLL_MS = 3000;
const SHOW_AFTER_MS = 1500;      // a blip shorter than this shows nothing
const GIVE_UP_MS = 5 * 60 * 1000;
const PROXY_DOWN = new Set([502, 503, 504]);

let down = false;
let downSince = 0;
let poller = null;
let showTimer = null;
let banner = null;
let apiBase = '';
let waiters = [];
let realFetch = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null;

export const isServerDown = () => down;

// A response or failure that means "the server is not there right now". The
// app itself answers some 502/503s (a partner hub unreachable), always as
// JSON; the proxy's "nothing behind me" page is not JSON.
export const meansServerAway = (resOrErr) => {
  if (!resOrErr) return false;
  if (resOrErr instanceof Error) return resOrErr.name === 'TypeError';   // refused / dropped
  if (!PROXY_DOWN.has(resOrErr.status)) return false;
  const type = String(resOrErr.headers?.get?.('content-type') || '');
  return !/json/i.test(type);
};

export function reportServerDown() {
  if (down) return;
  down = true;
  downSince = Date.now();
  clearTimeout(showTimer);
  showTimer = setTimeout(() => { if (down) showBanner(); }, SHOW_AFTER_MS);
  if (!poller) poller = setInterval(poll, POLL_MS);
}

export function reportServerUp() {
  if (!down) return;
  down = false;
  clearTimeout(showTimer);
  clearInterval(poller); poller = null;
  const wasShown = !!banner;
  hideBanner();
  if (wasShown) flash('Updated. You are back on line.');
  const w = waiters; waiters = [];
  w.forEach((resolve) => resolve(true));
}

async function poll() {
  if (!realFetch) return;
  if (Date.now() - downSince > GIVE_UP_MS) {
    // Not an update any more: stop waiting, let the screens show their errors.
    const w = waiters; waiters = []; w.forEach((resolve) => resolve(false));
    return;
  }
  try {
    const r = await realFetch(`${apiBase}/health?__fresh=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) reportServerUp();
  } catch { /* still restarting */ }
}

// Resolves true once the server answers again, false if it does not within a
// few minutes.
export function waitForServer() {
  if (!down) return Promise.resolve(true);
  return new Promise((resolve) => { waiters.push(resolve); });
}

// Watch every request to the API, whichever screen sends it (the till, the QR
// menu, the client portal), so any of them raises the notice.
export function watchServer(API_URL = '') {
  apiBase = String(API_URL || '').replace(/\/$/, '');
  if (typeof window === 'undefined' || !window.fetch || window.fetch.__serverWatch) return;
  realFetch = window.fetch.bind(window);
  const isApi = (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    return /\/(api\/|health|socket\.io\/)/.test(url) && (!apiBase || url.startsWith(apiBase) || url.startsWith('/'));
  };
  const watched = async (input, init) => {
    if (!isApi(input)) return realFetch(input, init);
    try {
      const res = await realFetch(input, init);
      if (meansServerAway(res)) reportServerDown();
      else reportServerUp();
      return res;
    } catch (err) {
      if (meansServerAway(err) && navigator.onLine !== false) reportServerDown();
      throw err;
    }
  };
  watched.__serverWatch = true;
  window.fetch = watched;
}

// ── The notice ─────────────────────────────────────────────────────────────
const BOX = [
  'position:fixed', 'left:50%', 'top:12px', 'transform:translateX(-50%)', 'z-index:2147483001',
  'display:flex', 'align-items:center', 'gap:10px', 'max-width:calc(100vw - 32px)',
  'padding:10px 16px', 'border-radius:14px', 'color:#f9fafb',
  'box-shadow:0 10px 30px rgba(0,0,0,.35)', 'font:600 13px/1.35 system-ui,sans-serif',
].join(';');

function showBanner() {
  if (banner || typeof document === 'undefined' || !document.body) return;
  banner = document.createElement('div');
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.dataset.testid = 'update-in-progress';
  banner.style.cssText = `${BOX};background:#1e3a8a`;
  const dot = document.createElement('span');
  dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#fbbf24;flex:none;animation:semivra-pulse 1s ease-in-out infinite alternate';
  const style = document.createElement('style');
  style.textContent = '@keyframes semivra-pulse{from{opacity:.35}to{opacity:1}}';
  const text = document.createElement('span');
  text.innerHTML = '<b>Update in progress.</b> The app is restarting with the new version, which takes about a minute. Your work and sign-in are kept, and it carries on by itself.';
  banner.append(style, dot, text);
  document.body.appendChild(banner);
}

function hideBanner() { banner?.remove(); banner = null; }

function flash(message) {
  if (typeof document === 'undefined' || !document.body) return;
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.style.cssText = `${BOX};background:#166534`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
