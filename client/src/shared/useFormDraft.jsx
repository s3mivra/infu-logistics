import { useEffect, useRef, useState } from 'react';
import { loadDraft, saveDraft, clearDraft } from './draft';

// Keeps an unsaved form as a draft on this device, so a refresh, a mis-tap or
// switching screens does not lose the work. Restored only into an empty form;
// a form put back to empty (saved, or cleared by hand) drops its draft.
// Returns { restored, saved, discard } for a quiet "Draft saved" note.
export function useFormDraft(key, value, setValue, { maxAgeMs = 3 * 24 * 60 * 60 * 1000 } = {}) {
  const blank = useRef(JSON.stringify(value));
  const [restored, setRestored] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const d = loadDraft(key, maxAgeMs);
    if (d && JSON.stringify(value) === blank.current && JSON.stringify(d) !== blank.current) { setValue(d); setRestored(true); }
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    const isBlank = JSON.stringify(value) === blank.current;
    const t = setTimeout(() => {
      if (isBlank) { clearDraft(key); setSaved(false); setRestored(false); }
      else { saveDraft(key, value); setSaved(true); }
    }, 400);
    return () => clearTimeout(t);
  }, [key, value]);
  const discard = () => { clearDraft(key); setValue(JSON.parse(blank.current)); setRestored(false); setSaved(false); };
  return { restored, saved, discard };
}

/** The quiet line under a form: "Draft saved" / "Draft restored · Discard". */
export function DraftNote({ draft }) {
  if (!draft.saved && !draft.restored) return null;
  return (
    <p className="text-[10px] text-fg/60" aria-live="polite">
      {draft.restored ? 'Draft restored from last time' : 'Draft saved'}
      {' · '}<button type="button" onClick={draft.discard} className="underline hover:text-fg">Discard</button>
    </p>
  );
}
