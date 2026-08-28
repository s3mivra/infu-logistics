import { X, AlertTriangle } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Marking a check bounced is the one destructive action in the register: it
// REVERSES the collection, so the client owes the money again and the invoice
// comes back onto the ageing report. That deserves a real dialog rather than a
// bare confirm - the reason it bounced is what an owner needs later when
// deciding whether to keep accepting that client's checks at all.
const REASONS = [
  'DAIF - drawn against insufficient funds',
  'Account closed',
  'Stale / expired check',
  'Signature mismatch',
  'Stop payment order',
  'Post-dated - presented early',
];

export default function BounceCheckModal() {
  const { bounceTarget, setBounceTarget, bounceForm, setBounceForm, bounceSubmitting, submitBounceCheck } = useDashboard();

  if (!bounceTarget) return null;

  const c = bounceTarget;
  const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 z-[9998] bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget) setBounceTarget(null); }} role="dialog" aria-modal="true" aria-label="Mark check bounced">
      <div className="bg-surface border border-red-500/25 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-elev-3 flex flex-col animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center shrink-0"><AlertTriangle size={17}/></div>
            <div>
              <h2 className="text-fg font-black text-lg">Bounce Check</h2>
              <p className="text-fg/40 text-xs mt-0.5">#{c.checkNumber}{c.checkBank ? ` · ${c.checkBank}` : ''}</p>
            </div>
          </div>
          <button onClick={() => setBounceTarget(null)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition" aria-label="Close"><X size={16}/></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Say plainly what this does to the books - it is not just a status
              change, it puts a debt back on a client. */}
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
            <p className="text-[11px] text-fg/70 leading-relaxed">
              This reverses the collection. <span className="text-fg font-bold">{c.client}</span> will owe{' '}
              <span className="text-red-400 font-black tabular-nums">{peso(c.amount)}</span> again on{' '}
              <span className="text-fg font-bold">{c.orderNumber}</span>, and the invoice returns to the ageing report.
            </p>
          </div>

          <div>
            <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Reason *</label>
            <select value={bounceForm.reason} onChange={e => setBounceForm({ ...bounceForm, reason: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-red-500/60">
              <option value="">Select a reason…</option>
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              <option value="__other">Other…</option>
            </select>
          </div>

          {bounceForm.reason === '__other' && (
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Describe</label>
              <input type="text" autoFocus value={bounceForm.otherReason || ''} onChange={e => setBounceForm({ ...bounceForm, otherReason: e.target.value })}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold placeholder-white/25 outline-none focus:border-red-500/60"
                placeholder="What did the bank say?" />
            </div>
          )}

          <div>
            <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Date Returned</label>
            <input type="date" value={bounceForm.bouncedDate || ''} onChange={e => setBounceForm({ ...bounceForm, bouncedDate: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold outline-none focus:border-red-500/60" />
            <p className="text-[9px] text-fg/25 mt-1">The reversing journal entry is booked on this date.</p>
          </div>
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-white/10 flex gap-2">
          <button onClick={() => setBounceTarget(null)}
            className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 text-fg/70 font-black rounded-xl uppercase tracking-widest text-xs transition min-h-[52px]">
            Cancel
          </button>
          <button onClick={submitBounceCheck}
            disabled={bounceSubmitting || !bounceForm.reason || (bounceForm.reason === '__other' && !String(bounceForm.otherReason || '').trim())}
            className="flex-1 py-3.5 bg-red-500 text-white font-black rounded-xl uppercase tracking-widest text-xs hover:bg-red-500/90 active-press transition shadow-elev-2 disabled:opacity-40 min-h-[52px]">
            {bounceSubmitting ? 'Reversing…' : 'Bounce & Reverse'}
          </button>
        </div>
      </div>
    </div>
  );
}
