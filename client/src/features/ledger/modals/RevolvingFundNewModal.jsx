import { X } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard. Reads shared dashboard state via
// useDashboard() rather than props - see DashboardContext.
export default function RevolvingFundNewModal() {
  const { cashAndBankAccounts, rfNewForm, rfNewModal, rfNewSubmitting, setRfNewForm, setRfNewModal, submitRfNew, isSuperAdmin } = useDashboard();

  if (!(rfNewModal)) return null;

  return (
      <div className="fixed inset-0 z-[9998] bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setRfNewModal(false); }}>
        <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-elev-3 flex flex-col max-h-[92vh] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
            <div>
              <h2 className="text-fg font-black text-lg">New Revolving Fund</h2>
              <p className="text-fg/30 text-xs font-bold uppercase tracking-widest mt-0.5">
                {isSuperAdmin ? 'Set up a petty cash pool' : 'Files a request - a superadmin approves it before the fund exists'}
              </p>
            </div>
            <button onClick={() => setRfNewModal(false)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition"><X size={16}/></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Fund Name *</label>
              <input type="text" placeholder="e.g. test business Petty Cash" value={rfNewForm.name}
                onChange={e => setRfNewForm({...rfNewForm, name: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-brand/60 placeholder-white/20"/>
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Initial Amount (₱) *</label>
              <input type="number" min="0" step="1" placeholder="e.g. 5000" value={rfNewForm.initialAmount}
                onChange={e => setRfNewForm({...rfNewForm, initialAmount: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg text-xl font-black tabular-nums outline-none focus:border-brand/60"/>
              <p className="text-fg/30 text-[10px] mt-1">This is the fixed float amount. The source account below will be reduced by this amount in the journal.</p>
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Paid From *</label>
              <select value={rfNewForm.sourceAccount} onChange={e => setRfNewForm({...rfNewForm, sourceAccount: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-brand/60">
                {(cashAndBankAccounts || []).map(a => (
                  <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                ))}
              </select>
              <p className="text-fg/30 text-[10px] mt-1">Where the float comes from - this account is credited (reduced) in the opening journal entry.</p>
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Purpose / Notes</label>
              <textarea rows={2} placeholder="What is this fund used for?" value={rfNewForm.description}
                onChange={e => setRfNewForm({...rfNewForm, description: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-brand/60 resize-none placeholder-white/20"/>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-white/10 shrink-0 flex gap-3">
            <button onClick={() => setRfNewModal(false)} className="flex-1 bg-white/5 text-fg/60 rounded-xl py-3 font-bold text-sm hover:bg-white/10 transition">Cancel</button>
            <button onClick={submitRfNew} disabled={rfNewSubmitting}
              className="flex-1 bg-brand text-white rounded-xl py-3 font-bold text-sm hover:bg-brand/90 transition disabled:opacity-50">
              {isSuperAdmin
                ? (rfNewSubmitting ? 'Creating…' : 'Create Fund')
                : (rfNewSubmitting ? 'Filing…' : 'Request Fund')}
            </button>
          </div>
        </div>
      </div>
  );
}
