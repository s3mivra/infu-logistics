import { History } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Pricing Control's answer to Inventory's Stock Card - "as of [date]: price"
// for every base-price and recipe-cost change on one product, newest first.
// Reads the existing PRODUCT_PRICE_CHANGED / PRODUCT_RECIPE_COST_CHANGED
// audit trail (see PUT /api/products/:id in products.js) rather than a
// separate ledger, so it's exact - nothing new to keep in sync.
export default function PriceHistoryModal() {
  const { priceHistory, priceHistoryOpen, setPriceHistoryOpen, priceHistoryProduct, priceHistoryLoading, peso, pricePending } = useDashboard();

  if (!priceHistoryOpen) return null;

  const money = peso || ((n) => `₱${Number(n || 0).toFixed(2)}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setPriceHistoryOpen(false)}>
      <div className="bg-surface p-6 rounded-xl border border-gray-700 shadow-2xl flex flex-col max-w-2xl w-full max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-3 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-fg flex items-center gap-2"><History size={18} className="text-accent"/> Price History: <span className="text-accent">{priceHistoryProduct?.name}</span></h2>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Current: <span className="text-fg font-bold">{money(priceHistoryProduct?.basePrice)}</span>
              {priceHistory.length > 0 && ` · ${priceHistory.length} change${priceHistory.length === 1 ? '' : 's'} recorded`}
            </p>
          </div>
          <button onClick={() => setPriceHistoryOpen(false)} className="text-gray-400 hover:text-fg font-bold text-xl">✕</button>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1">
          {/* Awaiting approval - shown above the applied history because "I
              changed this and it's still the old price" is the question this
              screen most often gets opened to answer. */}
          {pricePending?.length > 0 && (
            <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-yellow-400 mb-2">
                Awaiting Approval — not applied yet
              </p>
              <ul className="space-y-2">
                {pricePending.map(r => (
                  <li key={r._id} className="text-xs">
                    {r.changes.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 font-mono">
                        <span className="text-fg/50">{c.label}</span>
                        <span className="text-fg/40 line-through">{money(c.oldValue)}</span>
                        <span className="text-fg/30">→</span>
                        <span className="text-yellow-400 font-black">{money(c.newValue)}</span>
                      </div>
                    ))}
                    <p className="text-[10px] text-fg/40 mt-0.5">
                      requested by {r.requestedBy || 'someone'} · {new Date(r.date).toLocaleDateString()}
                      {r.reason && <span className="italic"> · "{r.reason}"</span>}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {priceHistoryLoading ? (
            <p className="text-gray-500 text-sm text-center py-8">Loading…</p>
          ) : priceHistory.length === 0 ? (
            pricePending?.length > 0
              ? <p className="text-gray-500 text-sm text-center py-8">No changes applied yet — the request above is still waiting.</p>
              : <p className="text-gray-500 text-sm text-center py-8">No price or cost changes recorded yet - still at its original price.</p>
          ) : (
            <ul className="space-y-2">
              {priceHistory.map((h, i) => (
                <li key={i} className="bg-page-bg border border-white/10 rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                      As of {new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      <span className="text-gray-600 font-normal normal-case ml-1.5">{new Date(h.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                    </span>
                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${h.type === 'price' ? 'bg-accent/20 text-accent' : 'bg-orange-500/20 text-orange-400'}`}>
                      {h.type === 'price' ? 'Price' : 'Recipe Cost'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 font-mono">
                    <span className="text-fg/40 text-sm line-through">{money(h.oldValue)}</span>
                    <span className="text-fg/30">→</span>
                    <span className={`text-lg font-black ${Number(h.newValue) > Number(h.oldValue) ? 'text-red-400' : 'text-green-400'}`}>{money(h.newValue)}</span>
                  </div>
                  {h.reason && <p className="text-fg/60 text-xs mt-1.5 italic">"{h.reason}"</p>}
                  {/* A change made through the queue names both people: who
                      asked for it and who allowed it. One made directly by an
                      approver just names them. */}
                  {h.viaApproval
                    ? <p className="text-[10px] text-gray-600 mt-1">
                        requested by {h.requestedBy || '—'} · approved by {h.approvedBy || '—'}
                        <span className="ml-1.5 text-[9px] font-black uppercase bg-green-500/15 text-green-500 px-1.5 py-0.5 rounded">reviewed</span>
                      </p>
                    : h.changedBy && <p className="text-[10px] text-gray-600 mt-1">by {h.changedBy}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
