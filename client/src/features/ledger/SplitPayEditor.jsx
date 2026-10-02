import { Plus, X } from 'lucide-react';

// A sale paid in parts - ₱50,000 cash and ₱50,000 on account - the way the POS
// already allows. Each part is booked to its own account; only an On Account
// part stays owed by the client. The parts must add up to the sale, so what is
// left to assign is always on screen.
export const SPLIT_METHODS = ['Cash', 'Bank Transfer', 'GCash', 'Maya', 'On Account'];

const money = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const splitLeft = (total, parts = []) => r2(r2(total) - parts.reduce((s, p) => s + r2(p.amount), 0));
export const splitReady = (total, parts = []) =>
  parts.filter(p => r2(p.amount) > 0).length >= 2 && Math.abs(splitLeft(total, parts)) < 0.005;
// What to send: the parts with an amount.
export const splitPayload = (parts = []) => parts.filter(p => r2(p.amount) > 0).map(p => ({ method: p.method, amount: r2(p.amount) }));
// A fresh split: everything cash, nothing yet on account - edit from there.
export const newSplit = (total) => [{ method: 'Cash', amount: r2(total) }, { method: 'On Account', amount: 0 }];

export default function SplitPayEditor({ total, parts, onChange, compact = false }) {
  const left = splitLeft(total, parts);
  const set = (i, patch) => onChange(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const field = compact
    ? 'bg-page-bg border border-white/10 rounded-lg px-2 py-1 text-xs text-fg outline-none focus:border-brand/60'
    : 'bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg font-bold outline-none focus:border-brand/60';
  return (
    <div className="space-y-1.5">
      {parts.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <select value={p.method} onChange={e => set(i, { method: e.target.value })} aria-label={`Payment ${i + 1} method`} className={`${field} flex-1 min-w-0`}>
            {SPLIT_METHODS.map(m => <option key={m} value={m}>{m === 'On Account' ? 'On Account (A/R)' : m}</option>)}
          </select>
          <input type="number" min="0" step="0.01" value={p.amount} aria-label={`Payment ${i + 1} amount`}
            onChange={e => set(i, { amount: e.target.value })}
            onFocus={e => e.target.select()}
            className={`${field} w-28 text-right tabular-nums`} />
          {parts.length > 2 && (
            <button type="button" onClick={() => onChange(parts.filter((_, j) => j !== i))} aria-label={`Remove payment ${i + 1}`}
              className="text-fg/65 hover:text-danger"><X size={14} /></button>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
        <button type="button" onClick={() => onChange([...parts, { method: 'Bank Transfer', amount: left > 0 ? left : 0 }])}
          className="flex items-center gap-1 text-brand-text hover:underline"><Plus size={12} /> Add payment</button>
        {Math.abs(left) < 0.005
          ? <span className="text-success">Adds up to {money(total)}</span>
          : <span className="text-danger">{left > 0 ? `${money(left)} left to assign` : `${money(-left)} over the sale`}</span>}
      </div>
    </div>
  );
}
