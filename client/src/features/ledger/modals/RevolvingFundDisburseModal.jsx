import { X } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard. Reads shared dashboard state via
// useDashboard() rather than props - see DashboardContext.
export default function RevolvingFundDisburseModal() {
  const { rfActiveFund, rfDisbForm, rfDisbModal, rfDisbSubmitting, setRfDisbForm, setRfDisbModal, submitRfDisb } = useDashboard();

  if (!(rfDisbModal && rfActiveFund)) return null;

  return (
      <div className="fixed inset-0 z-[9998] bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setRfDisbModal(false); }}>
        <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-elev-3 flex flex-col max-h-[92vh] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
            <div>
              <h2 className="text-fg font-black text-lg">Request Disbursement</h2>
              <p className="text-fg/30 text-xs font-bold uppercase tracking-widest mt-0.5">
                {rfActiveFund.name} · Available: <span className="text-brand">₱{rfActiveFund.currentBalance.toFixed(2)}</span>
              </p>
            </div>
            <button onClick={() => setRfDisbModal(false)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition"><X size={16}/></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Amount (₱) *</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={rfDisbForm.amount}
                onChange={e => setRfDisbForm({...rfDisbForm, amount: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg text-xl font-black tabular-nums outline-none focus:border-danger/60"/>
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">What was it spent on? *</label>
              <input type="text" placeholder="e.g. Printer ink, cleaning supplies…" value={rfDisbForm.description}
                onChange={e => setRfDisbForm({...rfDisbForm, description: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-danger/60 placeholder-white/20"/>
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Expense Category</label>
              <select value={rfDisbForm.categoryCode} onChange={e => setRfDisbForm({...rfDisbForm, categoryCode: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-danger/60">
                <option value="630000">Rent</option>
                <option value="640000">Utilities (Electricity / Water / Internet)</option>
                <option value="610000">Salaries & Wages</option>
                <option value="650000">Supplies (Non-Inventory)</option>
                <option value="660000">Marketing & Advertising</option>
                <option value="680000">Repairs & Maintenance</option>
                <option value="720000">Bank Charges</option>
                <option value="760000">Other Operating Expense</option>
              </select>
            </div>
            <div className="bg-danger/10 border border-danger/20 rounded-xl p-3 text-xs text-danger/80">
              This files a Requisition Slip - nothing moves yet. Once someone approves it
              (Ledger → Approvals), it deducts from the fund and posts:<br/>
              <span className="font-bold">DR Expense / CR Petty Cash / Revolving Fund</span>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-white/10 shrink-0 flex gap-3">
            <button onClick={() => setRfDisbModal(false)} className="flex-1 bg-white/5 text-fg/60 rounded-xl py-3 font-bold text-sm hover:bg-white/10 transition">Cancel</button>
            <button onClick={submitRfDisb} disabled={rfDisbSubmitting}
              className="flex-1 bg-danger text-fg rounded-xl py-3 font-bold text-sm hover:bg-danger/90 transition disabled:opacity-50">
              {rfDisbSubmitting ? 'Filing…' : 'File Requisition Slip'}
            </button>
          </div>
        </div>
      </div>
  );
}
