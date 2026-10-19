import { useEffect, useState } from 'react';

// A quantity you can type, between the − and + buttons. Whole units only.
// Kept as a draft while typing (so clearing the box to type "12" doesn't snap
// back to 1) and committed on Enter or when the box loses focus; anything that
// isn't a whole number of 1 or more puts the old quantity back.
export default function QtyInput({ value, onChange, max = 100000, className = '', label = 'Quantity' }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = Math.floor(Number(draft));
    if (Number.isFinite(n) && n >= 1) {
      const next = Math.min(n, max);
      if (next !== value) onChange(next);
      setDraft(String(next));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <input
      type="text" inputMode="numeric" pattern="[0-9]*" aria-label={label}
      value={draft}
      onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      onFocus={e => e.target.select()}
      className={`w-12 bg-page-bg border border-white/10 rounded-lg py-1 text-center font-black text-sm text-fg tabular-nums outline-none focus:border-brand/60 ${className}`}
    />
  );
}
