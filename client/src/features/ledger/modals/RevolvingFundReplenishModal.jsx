import { X } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard. Reads shared dashboard state via
// useDashboard() rather than props - see DashboardContext.
export default function RevolvingFundReplenishModal() {
  const { cashAndBankAccounts, rfActiveFund, rfReplForm, rfReplModal, rfReplSubmitting, setRfReplForm, setRfReplModal, submitRfRepl } = useDashboard();

  if (!(rfReplModal && rfActiveFund)) return null;

  return (
      <div className="fixed inset-0 z-[9998] bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setRfReplModal(false); }}>
        <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-elev-3 flex flex-col max-h-[92vh] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
            <div>
              <h2 className="text-fg font-black text-lg">Replenish Fund</h2>
              <p className="text-fg/30 text-xs font-bold uppercase tracking-widest mt-0.5">
                {rfActiveFund.name} · Shortfall: <span className="text-brand">₱{(rfActiveFund.initialAmount - rfActiveFund.currentBalance).toFixed(2)}</span>
              </p>
            </div>
            <button onClick={() => setRfReplModal(false)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition"><X size={16}/></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Amount to Add (₱)</label>
              <input type="number" min="0" step="0.01" value={rfReplForm.amount}
                onChange={e => setRfReplForm({...rfReplForm, amount: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg text-xl font-black tabular-nums outline-none focus:border-brand/60"/>
              <p className="text-fg/30 text-[10px] mt-1">Leave blank to auto-fill the full shortfall (₱{(rfActiveFund.initialAmount - rfActiveFund.currentBalance).toFixed(2)}).</p>
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Get funds from *</label>
              <select value={rfReplForm.sourceAccount} onChange={e => setRfReplForm({...rfReplForm, sourceAccount: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-brand/60">
                {(cashAndBankAccounts || []).map(a => (
                  <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                ))}
              </select>
              <p className="text-fg/30 text-[10px] mt-1">This account is credited (reduced) when the petty cash float is funded.</p>
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Note</label>
              <input type="text" placeholder="e.g. Weekly replenishment from daily sales" value={rfReplForm.note}
                onChange={e => setRfReplForm({...rfReplForm, note: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-brand/60 placeholder-white/20"/>
            </div>
            <div className="bg-brand/10 border border-brand/20 rounded-xl p-3 text-xs text-brand/80">
              Journal entry that will be posted:<br/>
              <span className="font-bold">DR Petty Cash / Revolving Fund &nbsp;|&nbsp; CR {(cashAndBankAccounts || []).find(a => a.code === rfReplForm.sourceAccount)?.name || 'Cash on Hand'}</span>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-white/10 shrink-0 flex gap-3">
            <button onClick={() => setRfReplModal(false)} className="flex-1 bg-white/5 text-fg/60 rounded-xl py-3 font-bold text-sm hover:bg-white/10 transition">Cancel</button>
            <button onClick={submitRfRepl} disabled={rfReplSubmitting}
              className="flex-1 bg-brand text-white rounded-xl py-3 font-bold text-sm hover:bg-brand/90 transition disabled:opacity-50">
              {rfReplSubmitting ? 'Replenishing…' : 'Replenish Fund'}
            </button>
          </div>
        </div>
      </div>
  );
}
