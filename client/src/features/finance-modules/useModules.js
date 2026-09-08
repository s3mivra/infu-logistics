import { useCallback, useEffect, useState } from 'react';

// Which optional accounting modules this business has switched on.
//
// One source of truth, read once and shared: the sidebar decides whether to
// show a tab, and the tab itself needs the same answer. Asking the server
// twice invites the two disagreeing for a moment, which shows up as a nav item
// that opens a screen saying the feature is off.
export function useModules(apiFetch) {
  const [modules, setModules] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch('/api/settings/modules')).json();
      if (d.success) setModules(d.modules || []);
    } catch { /* nothing renders rather than a half-state */ }
    finally { setLoaded(true); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // Until the answer arrives, treat everything as off. Showing a tab and then
  // taking it away reads as a glitch; showing it a moment late does not.
  const isOn = useCallback(
    (name) => modules.some(m => m.name === name && m.enabled),
    [modules],
  );

  return { modules, isOn, loaded, reload: load };
}
