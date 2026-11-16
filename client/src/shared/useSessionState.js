import { useEffect, useState } from 'react';

// useState that survives leaving the screen and coming back (until the tab
// or browser is closed): a list's search, filter or sort stays where you left
// it. Kept in sessionStorage under `place.<key>`; falls back to plain state.
export function useSessionState(key, initial) {
  const k = `place.${key}`;
  const [v, setV] = useState(() => {
    try { const s = sessionStorage.getItem(k); return s === null ? (typeof initial === 'function' ? initial() : initial) : JSON.parse(s); }
    catch { return typeof initial === 'function' ? initial() : initial; }
  });
  useEffect(() => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* this visit only */ } }, [k, v]);
  return [v, setV];
}

// Forget every saved value under a prefix (signing out clears the till's cart).
export function clearSessionState(prefix) {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(`place.${prefix}`)) sessionStorage.removeItem(k);
    }
  } catch { /* nothing saved */ }
}
