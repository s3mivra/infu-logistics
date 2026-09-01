import { History } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Market Segment Pricing's answer to PriceHistoryModal - "as of [date]: price"
// for one tier x product cell (per_product tiers) or one tier's shared rate
// (percent tiers). Reads TIER_PRICE_CHANGED / TIER_PERCENT_CHANGED from the
// same AuditLog trail, via GET /api/price-tiers/:id/history.
export default function TierPriceHistoryModal() {
  const { tierPriceHistory, tierPriceHistoryOpen, setTierPriceHistoryOpen, tierPriceHistoryCtx, tierPriceHistoryLoading } = useDashboard();

  if (!tierPriceHistoryOpen) return null;

  const isPercent = tierPriceHistory.some(h => h.type === 'percent') || (tierPriceHistory.length === 0 && !tierPriceHistoryCtx?.productName);
  const fmt = (v) => v === null || v === undefined
    ? '—'
    : isPercent ? `${v}%` : `₱${Number(v).toFixed(2)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setTierPriceHistoryOpen(false)}>
      <div className="bg-surface p-6 rounded-xl border border-gray-700 shadow-2xl flex flex-col max-w-2xl w-full max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-3 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-fg flex items-center gap-2">
              <History size={18} className="text-accent" /> Price History:{' '}
              <span className="text-accent">{tierPriceHistoryCtx?.tierName}</span>
              {tierPriceHistoryCtx?.productName && <span className="text-fg/50"> · {tierPriceHistoryCtx.productName}</span>}
            </h2>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Current: <span className="text-fg font-bold">{fmt(tierPriceHistoryCtx?.current)}</span>
              {tierPriceHistory.length > 0 && ` · ${tierPriceHistory.length} change${tierPriceHistory.length === 1 ? '' : 's'} recorded`}
            </p>
          </div>
          <button onClick={() => setTierPriceHistoryOpen(false)} className="text-gray-400 hover:text-fg font-bold text-xl">✕</button>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1">
          {tierPriceHistoryLoading ? (
            <p className="text-gray-500 text-sm text-center py-8">Loading…</p>
          ) : tierPriceHistory.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">No changes recorded yet — still at its original {isPercent ? 'rate' : 'price'}.</p>
          ) : (
            <ul className="space-y-2">
              {tierPriceHistory.map((h, i) => (
                <li key={i} className="bg-page-bg border border-white/10 rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                      As of {new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      <span className="text-gray-600 font-normal normal-case ml-1.5">{new Date(h.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                    </span>
                    <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/20 text-accent">
                      {h.type === 'price' ? 'Price' : 'Rate'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 font-mono">
                    <span className="text-fg/40 text-sm line-through">{fmt(h.oldValue)}</span>
                    <span className="text-fg/30">→</span>
                    <span className={`text-lg font-black ${h.oldValue !== null && Number(h.newValue) > Number(h.oldValue) ? 'text-red-400' : 'text-green-400'}`}>{fmt(h.newValue)}</span>
                  </div>
                  {h.changedBy && <p className="text-[10px] text-gray-600 mt-1">by {h.changedBy}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
