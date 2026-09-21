// A dropdown you can type into.
//
// A <select> of every inventory item means scrolling through two hundred rows
// to find "12oz ICED CUPS". This is the same control with a search box: type
// part of a name (or a code, or anything in the hint), and the list narrows as
// you type. Arrow keys move, Enter picks, Escape closes.
//
// It is a drop-in for <select>: the same `value`, the same `className`, and
// `onChange` receives `{ target: { value } }`, so an existing
// `onChange={e => setX(e.target.value)}` needs no change.
//
// options: [{ value, label, hint?, group? }] - `hint` is shown dimmed beside
// the label and searched too; `group` puts a heading above a run of options.
import { useEffect, useId, useMemo, useRef, useState } from 'react';

const norm = (s) => String(s ?? '').toLowerCase();

export default function SearchSelect({
  value, onChange, options = [], placeholder = 'Search…', className = '', id,
  disabled = false, emptyText = 'Nothing matches', ariaLabel,
}) {
  const autoId = useId();
  const listId = `${id || autoId}-list`;
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = options.find((o) => String(o.value) === String(value ?? ''));

  // Every word typed has to appear somewhere in the label or hint, in any
  // order: "iced 12" finds "12oz ICED CUPS".
  const shown = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    const list = options.filter((o) => o.value !== '' && o.value != null);
    if (!words.length) return list;
    return list.filter((o) => {
      const hay = `${norm(o.label)} ${norm(o.hint)}`;
      return words.every((w) => hay.includes(w));
    });
  }, [options, query]);

  useEffect(() => { setActive(0); }, [query, open]);

  // A click anywhere else closes the list, without picking anything.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (o) => {
    onChange?.({ target: { value: o ? o.value : '' } });
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      if (open && shown[active]) { e.preventDefault(); e.stopPropagation(); pick(shown[active]); }
    } else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  let lastGroup;
  return (
    <div ref={wrapRef} className={`relative ${className.includes('w-') ? '' : 'w-full'}`} style={{ minWidth: 0 }}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel || placeholder}
        autoComplete="off"
        disabled={disabled}
        className={`${className} pr-7`}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : (selected ? selected.label : '')}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {selected && !disabled ? (
        <button type="button" aria-label="Clear" tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); pick(null); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/65 hover:text-fg text-sm leading-none">×</button>
      ) : (
        <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg/65 text-[10px]">▼</span>
      )}
      {open && !disabled && (
        <ul ref={listRef} id={listId} role="listbox"
          className="absolute z-[60] left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-white/15 bg-sidebar-bg shadow-2xl py-1 text-sm">
          {shown.length === 0 && <li className="px-3 py-2 text-fg/70">{emptyText}</li>}
          {shown.map((o, i) => {
            const heading = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <li key={`${o.value}`} role="presentation">
                {heading && <div className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-fg/70">{heading}</div>}
                <div
                  role="option"
                  data-idx={i}
                  aria-selected={String(o.value) === String(value ?? '')}
                  onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                  onMouseEnter={() => setActive(i)}
                  className={`px-3 py-2 cursor-pointer flex items-baseline gap-2 ${i === active ? 'bg-brand text-on-brand' : 'text-fg'}`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className={`ml-auto shrink-0 text-xs ${i === active ? 'text-on-brand' : 'text-fg/70'}`}>{o.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
