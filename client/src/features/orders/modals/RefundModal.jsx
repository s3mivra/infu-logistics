import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard. Reads shared dashboard state via
// useDashboard() rather than props — see DashboardContext.
export default function RefundModal() {
  const { handleRefund, inventory, refundForm, refundModal, refundSubmitting, setRefundForm, setRefundModal } = useDashboard();

  if (!(refundModal)) return null;

  return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
        <div className="bg-surface border border-gray-700 rounded-2xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-black text-fg">Issue Refund</h2>
              <p className="text-xs text-gray-400 mt-0.5">{refundModal.orderNumber} · ₱{(refundModal.total||0).toFixed(2)}</p>
            </div>
            <button onClick={() => setRefundModal(null)} className="text-gray-500 hover:text-fg text-xl font-bold">✕</button>
          </div>
          <div>
            <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1">Refund Amount (₱)</label>
            <input type="number" min="0.01" max={refundModal.total} step="0.01"
              value={refundForm.refundAmount || refundModal.total}
              onChange={e => setRefundForm(p=>({...p,refundAmount:e.target.value}))}
              className="w-full bg-page-bg border border-gray-700 rounded-xl px-3 py-2.5 text-fg font-black tabular-nums outline-none focus:border-brand/60" />
            <p className="text-[10px] text-fg/30 mt-1">Max: ₱{(refundModal.total||0).toFixed(2)}</p>
          </div>
          <div>
            <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1">Reason *</label>
            <textarea rows={2} value={refundForm.reason} onChange={e => setRefundForm(p=>({...p,reason:e.target.value}))}
              placeholder="e.g. Wrong order, product defect, customer complaint"
              className="w-full bg-page-bg border border-gray-700 rounded-xl px-3 py-2.5 text-fg text-sm outline-none focus:border-brand/60 resize-none placeholder-white/20" />
          </div>
          {(() => {
            const amt = parseFloat(refundForm.refundAmount) || refundModal.total;
            const isFull = Math.abs(amt - (refundModal.total || 0)) <= 0.01;
            return (
              <div>
                <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1">Inventory & COGS</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: 'Restock', label: 'Restock', hint: 'Goods returned' },
                    { v: 'Spoilage', label: 'Spoilage', hint: 'Goods wasted' },
                    { v: 'None', label: 'No change', hint: 'Cash only' },
                  ].map(opt => (
                    <button key={opt.v} type="button" disabled={!isFull}
                      onClick={() => setRefundForm(p => ({ ...p, inventoryAction: opt.v }))}
                      className={`flex flex-col items-center py-2 rounded-xl border text-[11px] font-bold transition disabled:opacity-40
                        ${refundForm.inventoryAction === opt.v ? 'bg-brand/20 border-brand/60 text-fg' : 'bg-page-bg border-gray-700 text-gray-400 hover:border-brand/40'}`}>
                      {opt.label}
                      <span className="text-[9px] font-normal text-fg/30">{opt.hint}</span>
                    </button>
                  ))}
                </div>
                {!isFull && <p className="text-[10px] text-amber-400/70 mt-1">Partial refunds adjust cash & revenue only - inventory/COGS unchanged.</p>}
              </div>
            );
          })()}
          <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-2 text-xs text-red-300">
            ⚠ Returns ₱{(parseFloat(refundForm.refundAmount)||refundModal.total).toFixed(2)} to customer. Creates reversal journal entry. Cannot be undone.
          </div>
          <button onClick={handleRefund} disabled={refundSubmitting}
            className="w-full py-3 bg-red-600 text-white font-black rounded-xl uppercase tracking-widest text-sm hover:bg-red-500 transition disabled:opacity-50">
            {refundSubmitting ? 'Processing…' : 'Confirm Refund'}
          </button>
        </div>
      </div>
  );
}
