// One-click date ranges for a report: Today, Last 7 days, This month...
//
// Sits beside a report's own From/To pickers, which stay for anything unusual.
// Picking one fills the range and, when the report has a Run/Load button, runs
// it - the whole point is not having to set two dates and then press Run.
//
// The report's fetch reads its range from state, so it cannot be called in the
// same click that sets the range: it would still see the old dates. Instead the
// run is armed, and fires on the next render that carries the picked range -
// by then the parent has re-rendered and `onRun` reads the new dates.
import React, { useEffect, useState } from 'react';
import { RANGE_PRESETS, presetRange, matchPreset } from './businessDay.js';

export default function RangePresets({ value, onChange, onRun, className = '' }) {
  const [armed, setArmed] = useState(null);
  const active = matchPreset(value);

  useEffect(() => {
    if (!armed || value?.start !== armed.start || value?.end !== armed.end) return;
    setArmed(null);
    onRun?.();
  }, [armed, value?.start, value?.end, onRun]);

  const pick = (key) => {
    const r = presetRange(key);
    onChange(r);
    if (onRun) setArmed(r);
  };

  return (
    <div role="group" aria-label="Quick date range" className={`flex flex-wrap gap-1 basis-full ${className}`}>
      {RANGE_PRESETS.map(p => (
        <button key={p.key} type="button" onClick={() => pick(p.key)} aria-pressed={active === p.key}
          className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${active === p.key
            ? 'bg-brand text-on-brand border-brand'
            : 'bg-white/5 text-fg/75 border-white/10 hover:text-fg hover:bg-white/10'}`}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
