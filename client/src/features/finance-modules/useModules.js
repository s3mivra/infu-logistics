import { useCallback, useEffect, useState } from 'react';

// Which optional accounting modules this business has switched on.
//
// One source of truth, read once and shared: the sidebar decides whether to
// show a tab, and the tab itself needs the same answer. Asking the server
// twice invites the two disagreeing for a moment, which shows up as a nav item
// that opens a screen saying the feature is off.
// `enabled` gates the REQUEST, never the hooks. The hooks below run on every
// render regardless - a hook that appears only sometimes is what React error
// #310 is complaining about. The flag exists because this is called from the
// dashboard shell, which also renders the login screen: without it, every
// visit to a logged-out login page fired an authenticated request that could
// only ever come back 401.
export function useModules(apiFetch, { enabled = true } = {}) {
  const [modules, setModules] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const d = await (await apiFetch('/api/settings/modules')).json();
      if (d.success) setModules(d.modules || []);
    } catch { /* nothing renders rather than a half-state */ }
    finally { setLoaded(true); }
  }, [apiFetch, enabled]);

  useEffect(() => { load(); }, [load]);

  // Until the answer arrives, treat everything as off. Showing a tab and then
  // taking it away reads as a glitch; showing it a moment late does not.
  const isOn = useCallback(
    (name) => modules.some(m => m.name === name && m.enabled),
    [modules],
  );

  return { modules, isOn, loaded, reload: load };
}
