import { Check, X } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard. Reads shared dashboard state via
// useDashboard() rather than props - see DashboardContext.
export default function SettleArModal() {
  const { setSettleForm, setSettleModal, settleForm, settleModal, settleSubmitting, submitArSettlement } = useDashboard();

  if (!(settleModal)) return null;

  return (
      <div className="fixed inset-0 z-[9998] bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-fade-in" onClick={e => { if (e.target === e.currentTarget) setSettleModal(null); }} role="dialog" aria-modal="true" aria-label="Settle A/R">
        <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-elev-3 flex flex-col animate-scale-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div>
              <h2 className="text-fg font-black text-lg">Settle A/R</h2>
              <p className="text-fg/40 text-xs mt-0.5">{settleModal.order.orderNumber} · {settleModal.order.paymentMethod}</p>
            </div>
            <button onClick={() => setSettleModal(null)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition" aria-label="Close"><X size={16}/></button>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
              <p className="text-fg/40 text-[10px] font-bold uppercase">Outstanding</p>
              <p className="text-3xl text-brand font-black tabular-nums">₱{settleModal.order.total.toFixed(2)}</p>
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Amount Received *</label>
              <input type="number" min="0" step="0.01" value={settleForm.amount} onChange={e => setSettleForm({...settleForm, amount: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg text-xl font-black tabular-nums outline-none focus:border-brand/60" />
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Deposited To *</label>
              <select value={settleForm.paymentMethod} onChange={e => setSettleForm({...settleForm, paymentMethod: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-brand/60">
                <option>Cash on Hand</option>
                <option>Bank Transfer</option>
                <option>GCash</option>
                <option>Maya</option>
                <option>Maribank</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Note (optional)</label>
              <input type="text" placeholder="Grab payout batch #..." value={settleForm.note} onChange={e => setSettleForm({...settleForm, note: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold placeholder-white/25 outline-none focus:border-brand/60" />
            </div>
          </div>
          <div className="px-5 pb-5 pt-3 border-t border-white/10">
            <button onClick={submitArSettlement} disabled={settleSubmitting}
              className="w-full py-4 bg-brand text-white font-black rounded-xl uppercase tracking-widest text-sm hover:bg-brand/90 active-press transition shadow-elev-2 disabled:opacity-50 min-h-[56px] flex items-center justify-center gap-2">
              <Check size={18}/> {settleSubmitting ? 'Settling…' : 'Confirm Settlement'}
            </button>
          </div>
        </div>
      </div>
  );
}
