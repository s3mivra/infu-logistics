// Client-portal appearance, kept deliberately separate from the staff POS theme.
//
// The staff theme lives in localStorage['dash.theme'] and is per-device. A
// client's theme belongs to their ACCOUNT (server-side, so it follows them to a
// phone or a laptop) and must survive the shop changing its own POS theme.
//
// The localStorage copy exists only to avoid a flash of the wrong colours on
// load, before the profile fetch returns.

export const CLIENT_THEMES = [
  { value: 'default', label: 'Forest', hint: 'Dark charcoal + olive' },
  { value: 'light',   label: 'Light',  hint: 'Off-white, for bright rooms' },
  { value: 'yellow',  label: 'Amber',  hint: 'Dark + high-vis yellow' },
  { value: 'ocean',   label: 'Ocean',  hint: 'Dark + electric blue' },
];

const VALID = new Set(CLIENT_THEMES.map((t) => t.value));
const KEY = 'client.theme';

export const DEFAULT_CLIENT_THEME = import.meta.env.VITE_THEME || 'default';

/** Applies a theme to the document, falling back to the shipped default. */
export function applyClientTheme(theme) {
  const next = VALID.has(theme) ? theme : DEFAULT_CLIENT_THEME;
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  return next;
}

/** Last theme this device saw, for instant application before the fetch lands. */
export function cachedClientTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return VALID.has(v) ? v : DEFAULT_CLIENT_THEME;
  } catch {
    return DEFAULT_CLIENT_THEME;
  }
}

export function clearClientTheme() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
