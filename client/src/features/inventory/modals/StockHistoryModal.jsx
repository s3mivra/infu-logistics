import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';
import { PACK_UNIT } from '../../../shared/packUnit.js';

const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();

// Extracted from AdminDashboard; reads shared state via useDashboard().
export default function StockHistoryModal() {
  const { HIST_PAGE_SIZE, historyItem, historyItemName, historyModalOpen, historyPage, itemDisplay, packInfo, setHistoryModalOpen, setHistoryPage, stockHistory } = useDashboard();

  if (!(historyModalOpen)) return null;
const totalHistPages = Math.ceil(stockHistory.length / HIST_PAGE_SIZE);
      const pagedHistory = stockHistory.slice((historyPage - 1) * HIST_PAGE_SIZE, historyPage * HIST_PAGE_SIZE);
      // What the card counts in.
      //
      // A stock card is a record of what was deducted, so in a cafe it shows
      // exactly that: the quantity that left the shelf, in the unit the recipe
      // uses - one cup is "-1 pcs", a shot is "-20 g". Movements are stored in
      // those base units already, so nothing is converted.
      //
      // It used to divide every figure by the pack size, which put a single
      // cup down as "-0.02" (a fiftieth of a sleeve) under a PCS header and
      // read as though the till were deducting a fraction of a cup. Nothing
      // else is shown beside it: a pack equivalent under each line, even in
      // small print, still put a "0.02" next to a sale of one cup.
      //
      // Logistics keeps counting in packages: there a "piece" IS the package,
      // and a can leaving as "-377 g" would be the unreadable one.
      const hPack = historyItem ? packInfo(historyItem) : null;
      const packed = historyItem ? itemDisplay(historyItem).isPacked : false;
      const asDeducted = BUSINESS_TYPE !== 'log';
      const hBase = asDeducted ? 1 : (hPack?.packBase || 1);
      const hUnit = !historyItem ? 'units'
        : asDeducted ? (historyItem.unit || 'units')
        : (packed ? PACK_UNIT : itemDisplay(historyItem).unit);
      const fmtQty = (n) => +(Number(n || 0) / hBase).toFixed(4);
      // Cost is quoted per pack whichever way quantities are shown: a pack is
      // what is bought and what an invoice prices.
      const fmtCost = (c) => (c || 0) * (hPack?.packBase || 1);

      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface p-6 rounded-xl border border-gray-700 shadow-2xl flex flex-col max-w-5xl w-full max-h-[85vh]">
            <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-3 flex-shrink-0">
              <div>
                <h2 className="text-xl font-bold text-fg">Stock Card: <span className="text-brand-text">{historyItemName}</span></h2>
                {stockHistory.length > 0 && <p className="text-[10px] text-fg/70 mt-0.5">{stockHistory.length} entries total{hUnit ? ` · qty in ${hUnit}` : ''}</p>}
              </div>
              <button onClick={() => setHistoryModalOpen(false)} className="text-fg/70 hover:text-fg font-bold text-xl">✕</button>
            </div>

            <div className="overflow-y-auto custom-scrollbar flex-1">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-fg border-b border-gray-800 text-xs uppercase tracking-wider">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2 text-right">In/Out ({hUnit})</th>
                    <th className="pb-2 text-right">Cost/Pack</th>
                    <th className="pb-2 text-right">Balance ({hUnit})</th>
                    <th className="pb-2 pl-4">Remarks / Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {stockHistory.length === 0 ? (
                    <tr><td colSpan="6" className="py-4 text-center text-fg/70">No movement history recorded yet.</td></tr>
                  ) : pagedHistory.map((log, idx) => {
                    const dispChange = fmtQty(log.qtyChange);
                    const dispBalance = fmtQty(log.balanceAfter);
                    const dispCost = fmtCost(log.unitCost);
                    return (
                    <tr key={idx} className="border-b border-gray-800/50 hover:bg-page-bg/30">
                      <td className="py-2 text-fg/80 text-xs">{new Date(log.date).toLocaleString()}</td>
                      <td className="py-2 font-bold text-fg/80">{log.type}</td>
                      <td className={`py-2 text-right font-mono font-bold ${dispChange < 0 ? 'text-danger' : 'text-success'}`}>
                        {dispChange > 0 ? `+${dispChange}` : dispChange}
                      </td>
                      <td className="py-2 text-right text-fg/80 font-mono text-xs">₱{dispCost.toFixed(2)}</td>
                      <td className="py-2 text-right text-brand-text font-bold font-mono">{dispBalance}</td>
                      <td className="py-2 pl-4 text-fg/80 text-xs">{log.remarks || log.reference}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalHistPages > 1 && (
              <div className="flex justify-between items-center border-t border-gray-800 pt-3 mt-3 flex-shrink-0">
                <button
                  onClick={() => setHistoryPage(p => Math.max(p - 1, 1))}
                  disabled={historyPage === 1}
                  className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${historyPage === 1 ? 'bg-gray-800 text-fg/70 cursor-not-allowed' : 'bg-surface-2 border border-gray-700 text-fg hover:border-accent hover:text-brand-text'}`}
                >
                  <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                </button>
                <span className="text-fg/70 text-xs font-bold tracking-widest">
                  PAGE <span className="text-brand-text text-sm">{historyPage}</span> OF {totalHistPages}
                </span>
                <button
                  onClick={() => setHistoryPage(p => Math.min(p + 1, totalHistPages))}
                  disabled={historyPage === totalHistPages}
                  className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${historyPage === totalHistPages ? 'bg-gray-800 text-fg/70 cursor-not-allowed' : 'bg-surface-2 border border-gray-700 text-fg hover:border-accent hover:text-brand-text'}`}
                >
                  <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                </button>
              </div>
            )}
          </div>
        </div>
      );
}
