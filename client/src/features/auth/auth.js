import { startTask, endTask } from '../../shared/progress';
// ── CLIENT AUTH (in-memory access token + silent refresh) ────────────────────
//
// The access token is held ONLY in module memory - never localStorage - so an XSS
// payload can't exfiltrate a long-lived credential. It's short-lived (15m). The
// long-lived refresh token lives in an httpOnly cookie the JS can't read; on page
// load (memory is empty) we call /api/auth/refresh to silently mint a new access
// token from that cookie. On a 401 mid-session we transparently refresh once and
// retry the original request.
//
// All requests use `credentials: 'include'` so the refresh cookie is sent.

let accessToken = null;

// One-time cleanup of legacy localStorage tokens from the pre-migration build.
// The access token now lives only in memory; these keys are never written anymore.
try {
  localStorage.removeItem('semivra_token');
  localStorage.removeItem('kasa_token');
} catch { /* SSR / private mode - ignore */ }

export const getToken = () => accessToken;
export const setToken = (t) => { accessToken = t || null; };
export const clearToken = () => { accessToken = null; };

// Lightweight offline identity (NO token) - lets the installed app know who is
// signed in when reloaded offline, so the POS and clock can run in a degraded,
// queue-everything mode until the connection returns. Cleared on logout.
const USER_KEY = 'semivra_user';
export const getUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } };
export const setUser = (u) => { try { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); } catch { /* ignore */ } };

// A JWT's payload is base64URL (- and _ where base64 has + and /, no padding),
// and UTF-8. atob() takes neither: a name with an accented letter, or a "?" or
// "~" in the wrong place, produced a payload it threw on - and a token that
// cannot be read has no permissions, so the screen showed nothing.
export const decodeToken = (t = accessToken) => {
  if (!t) return null;
  try {
    const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch { return null; }
};

// ── Granular RBAC (client-side UI gating) ────────────────────────────────────
// Server enforcement is the real gate; this just hides UI a user can't use.
// Reads the token's `perms` claim; superadmin is treated as all-permissions.
export const getPermissions = (t = accessToken) => {
  const d = decodeToken(t);
  if (!d) return [];
  if (String(d.role || '').toLowerCase() === 'superadmin') return ['*'];
  return Array.isArray(d.perms) ? d.perms : [];
};
// The tab each family of page permissions narrows. Mirrors SCREENS in
// server/lib/authz.js; test/permissions-screens.unit.test.js keeps them equal.
export const SCREEN_PARENT = {
  inventory: 'inventory.view', hub: 'inventory.view', procurement: 'procurement.view',
  ledger: 'accounting.view', reports: 'reports.view',
};

// can('accounting.view') → boolean. '*' (superadmin) satisfies everything.
// A page key - screen.<tab>.<page> - follows the server's two rules: never
// without its tab's permission, and every page of a tab when none of that
// tab's pages is named (a token from before pages existed, or a role that was
// never narrowed).
export const can = (perm, t = accessToken) => {
  const perms = getPermissions(t);
  if (perms.includes('*')) return true;
  const m = /^screen\.([a-z]+)\.[a-z]+$/.exec(perm);
  if (m) {
    const parent = SCREEN_PARENT[m[1]];
    if (!parent || !perms.includes(parent)) return false;
    return perms.includes(perm) || !perms.some((k) => k.startsWith(`screen.${m[1]}.`));
  }
  return perms.includes(perm);
};

// De-duplicate concurrent refreshes: many in-flight requests share one refresh call.
let refreshing = null;

// Returns the { token, user } payload on success, or null. Updates in-memory token.
export function refreshSession(API_URL) {
  if (!refreshing) {
    // Only a definite refusal (401/403) ends the session. A refresh that hit a
    // rate limit, a server fault or a dropped connection used to null the token
    // too, signing the till out over a blip (2026-11 audit, M116).
    refreshing = fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (r) => {
        if (r.ok) return r.json();
        if (r.status === 401 || r.status === 403) accessToken = null;
        return null;
      })
      .then((d) => { if (d?.token) { accessToken = d.token; if (d.user) setUser(d.user); return d; } return null; })
      .catch(() => null)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function logout(API_URL) {
  // The access token goes too, so the server ends it now rather than letting
  // it run for the rest of its fifteen minutes.
  try { await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} }); }
  catch { /* best-effort */ }
  finally { accessToken = null; setUser(null); }
}

// The access token lives fifteen minutes. A request sent with one that has
// already run out comes back 401, is retried after a refresh, and works - but
// every one of them prints a red "Failed to load resource: 401" first, which
// after a tablet wakes from sleep is a dozen at once. Asking for a new token
// just before the old one runs out, and waiting for a refresh already under
// way instead of racing it, means those requests are simply sent right.
const EXPIRY_MARGIN_MS = 20 * 1000;
export const tokenExpiresSoon = (t = accessToken) => {
  const d = decodeToken(t);
  return !d || !d.exp || d.exp * 1000 - Date.now() < EXPIRY_MARGIN_MS;
};
export async function freshToken(API_URL) {
  if (refreshing) await refreshing;
  else if (accessToken && tokenExpiresSoon(accessToken)) await refreshSession(API_URL);
  return accessToken;
}

// A 401 that rejects the token itself, as opposed to one a route answers for a
// wrong password or code. Only those are worth a refresh and a retry: a
// business 401 used to be retried and then treated as a lost session, signing
// the person out instead of showing 'your password is incorrect' (M116).
const TOKEN_REJECTED = /unauthorized|invalid or expired token|signed out|no token|sign in again/i;
export const isTokenRejection = async (response) => {
  try {
    const d = await response.clone().json();
    return TOKEN_REJECTED.test(String(d?.message || d?.error || ''));
  } catch { return true; }   // no JSON body: an auth layer, not a route
};

// Staff-auth errors come back under `message`, but most screens read
// `data.error` and showed an empty alert (2026-11 audit, M114). Error bodies are
// small, so the field is copied across here once for every screen.
const withErrorField = async (response) => {
  if (response.ok) return response;
  try {
    const d = await response.clone().json();
    if (d && typeof d === 'object' && !d.error && typeof d.message === 'string') {
      return new Response(JSON.stringify({ ...d, error: d.message }), {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    }
  } catch { /* not JSON: leave it */ }
  return response;
};

// Drop-in replacement for the old per-page apiFetch. Attaches the in-memory token,
// auto-injects JSON content-type, and silently refreshes + retries once on 401.
// On a persistent 401 it returns the response so callers can run their logout flow.
// (apiFetchInner below; apiFetch adds the progress panel's slow-request watch.)

// What a slow request is, in words, for the progress panel.
export function requestLabel(endpoint, method = 'GET') {
  const p = String(endpoint || '').split('?')[0];
  const q = String(endpoint || '').split('?')[1] || '';
  if (/import/.test(p)) return 'Importing…';
  if (/\/pull$/.test(p)) return 'Pulling the Google Sheet…';
  if (/export|backup|snapshot|download/.test(p) || /(^|&)(export|format)=/.test(q)) return 'Preparing the export…';
  if (String(method).toUpperCase() !== 'GET') return 'Saving…';
  return 'Waiting for the server…';
}
// Background checks that run on their own: not worth a line in the panel.
const QUIET = /\/api\/(notifications|clock\/heartbeat|auth\/refresh|health)/;
// A request still unanswered after this long is shown in the progress panel,
// so a slow server or connection is visible rather than a frozen screen.
export const SLOW_REQUEST_MS = 1500;

export async function apiFetch(API_URL, endpoint, options = {}) {
  if (QUIET.test(String(endpoint))) return apiFetchInner(API_URL, endpoint, options);
  let taskId = null;
  const timer = setTimeout(() => { taskId = startTask(requestLabel(endpoint, options.method), { kind: 'request' }); }, SLOW_REQUEST_MS);
  try {
    const res = await apiFetchInner(API_URL, endpoint, options);
    clearTimeout(timer);
    if (taskId) endTask(taskId, { ok: res.ok, message: res.ok ? '' : `The server answered ${res.status}.` });
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (taskId) endTask(taskId, { ok: false, message: 'The connection was lost.' });
    throw err;
  }
}

async function apiFetchInner(API_URL, endpoint, options = {}) {
  const build = () => {
    const headers = { ...(options.headers || {}) };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const clean = endpoint.replace(API_URL, '');
    return fetch(`${API_URL}${clean}`, { ...options, headers, credentials: 'include' });
  };

  // The auth routes themselves must not wait on a refresh - one of them IS it.
  if (!/\/api\/(auth|users\/login)/.test(endpoint)) await freshToken(API_URL);
  let response = await build();
  if (response.status === 401 && await isTokenRejection(response)) {
    // The token was refused before the route ran, so sending it again - a POST
    // included - cannot do the work twice.
    const refreshed = await refreshSession(API_URL);
    if (refreshed) response = await build(); // retry once with the fresh token
  }
  return withErrorField(response);
}
