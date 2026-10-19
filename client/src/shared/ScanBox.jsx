import { useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';

// A box for a barcode scanner. A scanner is a keyboard: it types the code and
// presses Enter. So this is a text box that acts on Enter, clears itself, and
// keeps the cursor - ready for the next scan with nobody touching the screen.
// The code can be typed by hand just the same.
//
// onScan(code) returns what to say about it: { ok: true|false, text }.
export default function ScanBox({ onScan, placeholder = 'Scan or type an item code', inputRef, className = '' }) {
  const [value, setValue] = useState('');
  const [said, setSaid] = useState(null);
  const own = useRef(null);
  const ref = inputRef || own;
  const submit = async (e) => {
    e.preventDefault();
    const code = value.trim();
    if (!code) return;
    setValue('');
    const result = await onScan(code);
    setSaid(result || null);
  };
  return (
    <form onSubmit={submit} className={`flex items-center gap-2 flex-wrap ${className}`}>
      <span className="relative">
        <ScanLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/65 pointer-events-none" />
        <input ref={ref} value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          autoComplete="off" autoCapitalize="off" spellCheck={false}
          className="bg-white/5 border border-white/15 focus:border-brand rounded-lg pl-9 pr-3 py-2 text-sm text-fg outline-none w-64 max-w-full" />
      </span>
      {said && <span role="status" className={`text-xs font-bold ${said.ok ? 'text-success' : 'text-danger'}`}>{said.text}</span>}
    </form>
  );
}

// Which of these does a scanned code mean? By code first (whatever its case),
// then by exact name - never by "contains", which would pick the wrong item
// from a short code.
export function findByCode(list, code, { codeOf = (x) => x.itemCode, nameOf = (x) => x.itemName } = {}) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return null;
  return list.find(x => String(codeOf(x) || '').trim().toLowerCase() === c)
    || list.find(x => String(nameOf(x) || '').trim().toLowerCase() === c) || null;
}
