// Client-portal session storage.
//
// WHY localStorage and not sessionStorage: sessionStorage is scoped to a single
// tab and is dropped when the tab is closed or evicted — on mobile that happens
// routinely when the user switches apps, so clients kept getting bounced back to
// the login screen mid-order. localStorage survives a refresh, a new tab, and an
// app switch; the JWT's own `exp` is still what actually ends the session.
//
// Draft state (cart, payment method, notes, the last success screen) is stored
// per client id so two clients sharing a device never see each other's basket.

const TOKEN_KEY = 'client_token';
const INFO_KEY = 'client_info';
const DRAFT_PREFIX = 'client_draft:';

// Every access is wrapped: Safari private mode throws on any storage access.
const read = (store, key) => { try { return store.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const drop = (key) => {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
};

// Reads localStorage first, then falls back to sessionStorage so clients who
// were mid-session when this shipped aren't logged out by the upgrade.
const readEither = (key) => read(localStorage, key) ?? read(sessionStorage, key);

/** True when the JWT is absent, malformed, or past its `exp`. */
export function isExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return !!payload.exp && payload.exp * 1000 < Date.now();
  } catch {
    return true; // malformed — treat as no session
  }
}

/** Returns { token, info } for a live session, or null. Clears an expired one. */
export function loadSession() {
  const token = readEither(TOKEN_KEY);
  const rawInfo = readEither(INFO_KEY);
  if (!token || !rawInfo || isExpired(token)) {
    if (token || rawInfo) clearSession();
    return null;
  }
  try {
    return { token, info: JSON.parse(rawInfo) };
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(token, info) {
  write(TOKEN_KEY, token);
  write(INFO_KEY, JSON.stringify(info));
}

export function clearSession() {
  const id = clientIdOf(safeParse(readEither(INFO_KEY)));
  drop(TOKEN_KEY);
  drop(INFO_KEY);
  if (id) drop(DRAFT_PREFIX + id);
}

const safeParse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

export const clientIdOf = (info) => String(info?._id || info?.clientCode || info?.username || '') || null;

/** Per-client draft: the in-progress cart and checkout choices. */
export function loadDraft(info) {
  const id = clientIdOf(info);
  if (!id) return null;
  return safeParse(read(localStorage, DRAFT_PREFIX + id));
}

export function saveDraft(info, draft) {
  const id = clientIdOf(info);
  if (!id) return;
  write(DRAFT_PREFIX + id, JSON.stringify(draft));
}

export function clearDraft(info) {
  const id = clientIdOf(info);
  if (id) drop(DRAFT_PREFIX + id);
}
