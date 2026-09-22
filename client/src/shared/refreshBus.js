// "Bring what is on screen up to date" - one signal every tab can listen for.
//
// Live updates keep a tab current while the connection is up. What arrives
// while it is down - the tablet asleep, the app in the background, the Wi-Fi
// gone - is never replayed, so the tab showed whatever it last heard until
// someone switched away and back. The dashboard now sends this signal when it
// wakes up or reconnects, and a tab that loads its own data re-runs that load
// on it. It re-fetches lists; it never resets a form someone is filling in.
import { useEffect, useState } from 'react';

const EVENT = 'semivra:refresh';

export function broadcastRefresh() {
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window (tests) */ }
}

// A number that goes up on every signal: add it to a load effect's deps.
export function useRefreshTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return tick;
}
