// Small localStorage-backed draft store for in-progress, not-yet-submitted work.
//
// WHY: a customer half-way through building an order loses everything to an
// accidental refresh, a phone rotating, or the OS evicting the tab when they
// switch to a messaging app to ask someone what they want. On a QR menu that is
// the single most common way an order gets abandoned.
//
// Drafts are per-key so two surfaces (or two tables) never collide, and every
// access is wrapped because Safari private mode throws on any storage access.

const PREFIX = 'draft:';

export function loadDraft(key, maxAgeMs = 12 * 60 * 60 * 1000) {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { savedAt, data } = JSON.parse(raw);
    // A stale draft is worse than none — a table's abandoned basket must not
    // reappear for tomorrow's customer.
    if (!savedAt || Date.now() - savedAt > maxAgeMs) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return data ?? null;
  } catch {
    return null;
  }
}

export function saveDraft(key, data) {
  if (!key) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch { /* private mode, or quota — losing a draft must never break the page */ }
}

export function clearDraft(key) {
  if (!key) return;
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}
