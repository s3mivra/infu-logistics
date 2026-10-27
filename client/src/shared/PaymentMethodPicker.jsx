import { Banknote, Landmark, Smartphone, FileCheck, BookOpen, Split } from 'lucide-react';

// One way to pick how a sale was paid: tiles with a short hint each, in the
// words the paper (SOA) uses, then only the details that method needs. The
// methods this device uses most come first; Cash leads until there is a habit.
export const PAY_METHODS = {
  Cash:            { label: 'Cash',                Icon: Banknote,   hint: 'Paid in cash' },
  'Bank Transfer': { label: 'Bank Transfer',       Icon: Landmark,   hint: 'Deposit or online transfer · reference no.' },
  GCash:           { label: 'GCash',               Icon: Smartphone, hint: 'E-wallet · reference no.' },
  Maya:            { label: 'Maya',                Icon: Smartphone, hint: 'E-wallet · reference no.' },
  Check:           { label: 'Check / Dated Check', Icon: FileCheck,  hint: 'Includes dated / post-dated checks' },
  'On Account':    { label: 'On Account (A/R)',    Icon: BookOpen,   hint: 'Client pays later' },
  Split:           { label: 'Split payment',       Icon: Split,      hint: 'Part one way, part another' },
};
export const NEEDS_REFERENCE = ['Bank Transfer', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet', 'QR'];
export const methodLabel = (m) => PAY_METHODS[m]?.label || m;

const USE_KEY = 'payMethodUse';
const readUse = () => { try { return JSON.parse(localStorage.getItem(USE_KEY) || '{}') || {}; } catch { return {}; } };
/** Count a method as used on this device (call when a sale is saved). */
export function notePaymentMethodUsed(m) {
  try { const u = readUse(); u[m] = (u[m] || 0) + 1; localStorage.setItem(USE_KEY, JSON.stringify(u)); } catch { /* ordering only */ }
}
/** The methods, most used on this device first; ties keep the given order. */
export function orderByUse(methods) {
  const u = readUse();
  return methods.map((m, i) => [m, i]).sort((a, b) => (u[b[0]] || 0) - (u[a[0]] || 0) || a[1] - b[1]).map(([m]) => m);
}
/** The most used method, for pre-selecting. */
export const mostUsedMethod = (methods) => orderByUse(methods)[0];

/** What the server stores: the reference (check no. + bank) and the check date. */
export function paymentDetailsPayload(method, d = {}) {
  if (method === 'Check') {
    const ref = [String(d.checkNumber || '').trim(), String(d.checkBank || '').trim()].filter(Boolean).join(' · ');
    return { paymentReference: ref.slice(0, 60), paymentCheckDate: d.checkDate || null };
  }
  if (NEEDS_REFERENCE.includes(method)) return { paymentReference: String(d.reference || '').trim().slice(0, 60) };
  return {};
}
/** A message if a required detail is missing, else ''. */
export function missingPaymentDetail(method, d = {}) {
  if (method === 'Check' && !String(d.checkNumber || '').trim()) return 'Enter the check number.';
  return '';
}

export default function PaymentMethodPicker({
  value, onChange, details = {}, onDetails, saleDate, disabled = false, showDetails = true,
  methods = ['Cash', 'Bank Transfer', 'GCash', 'Maya', 'Check', 'On Account', 'Split'], more = null,
}) {
  const ordered = orderByUse(methods);
  const field = 'w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-brand/60 placeholder-fg/60';
  const postDated = value === 'Check' && details.checkDate && details.checkDate > (saleDate || new Date().toISOString().slice(0, 10));
  const inMore = more && !methods.includes(value);
  return (
    <div className={`space-y-3 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {ordered.map((m) => {
          const meta = PAY_METHODS[m] || { label: m, hint: '' };
          const on = value === m;
          const Icon = meta.Icon;
          return (
            <button key={m} type="button" role="radio" aria-checked={on} onClick={() => onChange(m)}
              className={`text-left rounded-xl border px-3 py-2 transition ${on ? 'border-brand bg-brand/10' : 'border-white/10 bg-page-bg hover:border-white/25'}`}>
              <span className={`flex items-center gap-1.5 text-sm font-bold ${on ? 'text-brand-text' : 'text-fg'}`}>
                {Icon && <Icon size={14} />}{meta.label}
              </span>
              <span className="block text-[10px] text-fg/65 leading-snug mt-0.5">{meta.hint}</span>
            </button>
          );
        })}
      </div>
      {more && (
        <select value={inMore ? value : ''} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Other payment methods"
          className={`${field} ${inMore ? 'border-brand' : ''}`}>
          <option value="">Other methods (delivery partners, other e-wallets)…</option>
          {more}
        </select>
      )}

      {showDetails && value === 'Check' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={details.checkNumber || ''} onChange={(e) => onDetails({ checkNumber: e.target.value })} maxLength={40}
            placeholder="Check number *" aria-label="Check number" className={field} />
          <input value={details.checkBank || ''} onChange={(e) => onDetails({ checkBank: e.target.value })} maxLength={20}
            placeholder="Bank (e.g. BDO)" aria-label="Bank" className={field} />
          <label className="block">
            <input type="date" value={details.checkDate || ''} onChange={(e) => onDetails({ checkDate: e.target.value })}
              aria-label="Check date" title="Check date" className={field} />
            {postDated && <span className="text-[10px] font-bold text-warning">Post-dated check</span>}
          </label>
        </div>
      )}
      {showDetails && NEEDS_REFERENCE.includes(value) && (
        <input value={details.reference || ''} onChange={(e) => onDetails({ reference: e.target.value })} maxLength={60}
          placeholder="Reference number" aria-label="Reference number" className={field} />
      )}
    </div>
  );
}
