import { X, Check, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Preview before a bulk price-tier import actually writes anything. Each
// group here is one COLUMN from the imported sheet - a tier name, and every
// product row that got a price in it. A column matching an existing tier
// updates it (merged onto whatever it already has); an unrecognized column
// name creates a brand-new tier.
export default function PriceTierImportModal() {
  const { priceTierImportPreview, setPriceTierImportPreview, submitPriceTierImport, priceTierImporting } = useDashboard();

  if (!priceTierImportPreview) return null;
  const { tiers, unmatchedCodes } = priceTierImportPreview;
  const totalPrices = tiers.reduce((s, t) => s + t.rows.length, 0);

  return (
    <div className="fixed inset-0 z-[9998] bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget) setPriceTierImportPreview(null); }} role="dialog" aria-modal="true" aria-label="Import price tiers">
      <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-2xl shadow-elev-3 flex flex-col max-h-[90vh] animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0"><FileSpreadsheet size={17}/></div>
            <div>
              <h2 className="text-fg font-black text-lg">Import Price Tiers</h2>
              <p className="text-fg/40 text-xs mt-0.5">{tiers.length} tier column{tiers.length === 1 ? '' : 's'} · {totalPrices} price{totalPrices === 1 ? '' : 's'} to set</p>
            </div>
          </div>
          <button onClick={() => setPriceTierImportPreview(null)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition" aria-label="Close"><X size={16}/></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {unmatchedCodes.length > 0 && (
            <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/10 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-yellow-400 flex items-center gap-1.5">
                <AlertTriangle size={12}/> {unmatchedCodes.length} Row{unmatchedCodes.length === 1 ? '' : 's'} Skipped - No Matching Product
              </p>
              <p className="text-[11px] text-fg/50 mt-1 truncate">{unmatchedCodes.slice(0, 8).join(', ')}{unmatchedCodes.length > 8 ? `, +${unmatchedCodes.length - 8} more` : ''}</p>
            </div>
          )}

          {tiers.map(t => (
            <div key={t.name} className="bg-page-bg/50 border border-white/10 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-fg font-black text-sm">{t.name}</span>
                  {!t.tierId && (
                    <span className="text-[9px] font-black uppercase tracking-wider bg-brand/15 text-brand px-1.5 py-0.5 rounded">New Tier</span>
                  )}
                  {t.tierId && t.wasPercent && (
                    <span className="text-[9px] font-black uppercase tracking-wider bg-yellow-500/15 text-yellow-400 px-1.5 py-0.5 rounded" title="This tier currently uses a flat % rate - importing prices switches it to a per-product price list.">
                      Switches to Price List
                    </span>
                  )}
                </div>
                <span className="text-fg/40 text-xs font-bold">{t.rows.length} price{t.rows.length === 1 ? '' : 's'}</span>
              </div>
              <div className="mt-2 max-h-24 overflow-y-auto space-y-0.5">
                {t.rows.slice(0, 6).map(r => (
                  <div key={r.productId} className="flex justify-between text-[11px] text-fg/50">
                    <span className="truncate pr-2">{r.name}</span>
                    <span className="font-mono text-fg/70 shrink-0">₱{r.price.toFixed(2)}</span>
                  </div>
                ))}
                {t.rows.length > 6 && <p className="text-[10px] text-fg/30 italic">+{t.rows.length - 6} more</p>}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-white/10 flex gap-2">
          <button onClick={() => setPriceTierImportPreview(null)}
            className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 text-fg/70 font-black rounded-xl uppercase tracking-widest text-xs transition min-h-[52px]">
            Cancel
          </button>
          <button onClick={submitPriceTierImport} disabled={priceTierImporting}
            className="flex-1 py-3.5 bg-brand text-white font-black rounded-xl uppercase tracking-widest text-xs hover:bg-brand/90 active-press transition shadow-elev-2 disabled:opacity-50 min-h-[52px] flex items-center justify-center gap-2">
            <Check size={16}/> {priceTierImporting ? 'Importing…' : `Import ${totalPrices} Price${totalPrices === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
