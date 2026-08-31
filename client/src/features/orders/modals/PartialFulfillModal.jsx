import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard; reads shared state via useDashboard().
export default function PartialFulfillModal() {
  const { partialBusy, partialModal, partialMode, partialPayment, partialQtys, setPartialModal, setPartialMode, setPartialPayment, setPartialQtys, submitPartialFulfill } = useDashboard();

  if (!(partialModal)) return null;
const items = partialModal.items || [];
      const rem = (it) => (it.quantity || 0) - (it.fulfilledQty || 0);
      const fNow = (it, i) => Math.max(0, Math.min(rem(it), Number(partialQtys[i] ?? rem(it))));
      const netUnit = (it) => (it.price || 0) * (1 - (it.productDiscountPercent || 0) / 100);
      const fTotal = items.reduce((s, it, i) => s + netUnit(it) * fNow(it, i), 0);
      const rTotal = items.reduce((s, it, i) => s + netUnit(it) * (rem(it) - fNow(it, i)), 0);
      return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
        <div className="bg-surface border border-gray-700 rounded-2xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-black text-fg">Partial Fulfillment</h2>
              <p className="text-xs text-gray-400 mt-0.5">{partialModal.orderNumber} · set fulfilled quantities</p>
            </div>
            <button onClick={() => setPartialModal(null)} className="text-gray-500 hover:text-fg text-xl font-bold">✕</button>
          </div>

          <div className="space-y-2">
            {items.map((it, i) => {
              const remaining = rem(it);
              const fq = fNow(it, i);
              const short = remaining - fq;
              if (remaining <= 0) return (
                <div key={i} className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 opacity-50">
                  <p className="text-sm font-bold text-fg truncate">{it.name} <span className="text-emerald-400 text-[10px]">· fully fulfilled</span></p>
                </div>
              );
              return (
                <div key={i} className="bg-page-bg border border-white/10 rounded-xl px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-fg truncate">{it.name}</p>
                      <p className="text-[10px] text-fg/40">Remaining: {remaining} of {it.quantity} · ₱{netUnit(it).toFixed(2)} ea{(it.productDiscountPercent||0) > 0 ? ` (${it.productDiscountPercent}% off)` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => setPartialQtys(p => ({ ...p, [i]: Math.max(0, fq - 1) }))} className="w-7 h-7 rounded-lg bg-white/5 text-fg hover:bg-white/10 font-black">−</button>
                      <input type="number" min="0" max={remaining} value={fq}
                        onChange={e => setPartialQtys(p => ({ ...p, [i]: e.target.value }))}
                        className="w-12 text-center bg-surface border border-white/10 rounded-lg py-1 text-fg text-sm font-bold outline-none" />
                      <button onClick={() => setPartialQtys(p => ({ ...p, [i]: Math.min(remaining, fq + 1) }))} className="w-7 h-7 rounded-lg bg-white/5 text-fg hover:bg-white/10 font-black">+</button>
                    </div>
                  </div>
                  {short > 0 && <p className="text-[10px] text-amber-400 mt-1 font-bold">{short} stays on this order (fulfill later)</p>}
                </div>
              );
            })}
          </div>

          <div className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-xs space-y-1">
            <div className="flex justify-between text-fg/70"><span>Fulfilled now</span><span className="font-mono font-bold text-fg">₱{fTotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-fg/70"><span>Remaining on order</span><span className="font-mono font-bold text-amber-400">₱{rTotal.toFixed(2)}</span></div>
          </div>

          <div>
            <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1.5">Payment Method</label>
            <select value={partialPayment} onChange={e => setPartialPayment(e.target.value)}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm font-bold outline-none focus:border-brand/60">
              <optgroup label="In-Store Payments">
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Check">Check</option>
              </optgroup>
              <optgroup label="E-Wallets">
                <option value="GCash">GCash</option>
                <option value="Maya">Maya</option>
                <option value="Maribank">Maribank / Seabank</option>
                <option value="Other E-Wallet">Other E-Wallet</option>
                <option value="QR">QR / Scan to Pay</option>
              </optgroup>
              <optgroup label="Delivery Partners">
                <option value="Grab Delivery">Grab Delivery</option>
                <option value="Lalamove">Lalamove</option>
                <option value="Manual Delivery">Manual / Direct</option>
              </optgroup>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1.5">Payment</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPartialMode('partial')}
                className={`py-2.5 rounded-xl border text-xs font-bold transition ${partialMode === 'partial' ? 'bg-brand/20 border-brand/60 text-fg' : 'bg-page-bg border-white/10 text-fg/50'}`}>
                Pay partial only<br/><span className="text-[9px] font-normal opacity-70">₱{fTotal.toFixed(2)} now · rest billed later</span>
              </button>
              <button type="button" onClick={() => setPartialMode('full')}
                className={`py-2.5 rounded-xl border text-xs font-bold transition ${partialMode === 'full' ? 'bg-brand/20 border-brand/60 text-fg' : 'bg-page-bg border-white/10 text-fg/50'}`}>
                Pay full now<br/><span className="text-[9px] font-normal opacity-70">remaining prepaid (deposit)</span>
              </button>
            </div>
          </div>

          <button onClick={submitPartialFulfill} disabled={partialBusy}
            className="w-full py-3 bg-brand text-white font-black rounded-xl uppercase tracking-widest text-sm hover:bg-brand-dark transition disabled:opacity-50">
            {partialBusy ? 'Processing…' : 'Fulfill & Set Aside Remaining'}
          </button>
        </div>
      </div>
      );
}
