// The last few screens and records opened on this device, newest first, for
// "Recent" in quick jump (Ctrl+K). Per device (localStorage), like the
// remembered tab; nothing here is needed for the app to work.
const KEY = 'jump.recent';
const MAX = 5;
const same = (a, b) => a.type === b.type && a.tab === b.tab && (a.sub || '') === (b.sub || '') && a.value === b.value;

export function readRecent() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** entry: { type: 'screen', tab, sub? } or { type: 'client' | 'order', value } */
export function noteRecent(entry) {
  try {
    const list = [entry, ...readRecent().filter((e) => !same(e, entry))].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* private mode: no recents */ }
}
