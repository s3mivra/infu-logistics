import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';


// Extracted from AdminDashboard; reads shared state via useDashboard().
export default function StockHistoryModal() {
  const { HIST_PAGE_SIZE, historyItem, historyItemName, historyModalOpen, historyPage, itemDisplay, packInfo, setHistoryModalOpen, setHistoryPage, stockHistory } = useDashboard();

  if (!(historyModalOpen)) return null;
const totalHistPages = Math.ceil(stockHistory.length / HIST_PAGE_SIZE);
      const pagedHistory = stockHistory.slice((historyPage - 1) * HIST_PAGE_SIZE, historyPage * HIST_PAGE_SIZE);
      // Movements are stored in base units; the card reports them in the same
      // units as the Inventory Hub table - packs when the item has a pack size,
      // otherwise its display unit (packInfo falls back to exactly that).
      const hPack = historyItem ? packInfo(historyItem) : null;
      const hBase = hPack?.packBase || 1;
      const hUnit = historyItem
        ? (itemDisplay(historyItem).isPacked ? 'pcs' : itemDisplay(historyItem).unit)
        : 'units';
      const fmtQty = (n) => +(n / hBase).toFixed(4);
      const fmtCost = (c) => (c || 0) * hBase;
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface p-6 rounded-xl border border-gray-700 shadow-2xl flex flex-col max-w-5xl w-full max-h-[85vh]">
            <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-3 flex-shrink-0">
              <div>
                <h2 className="text-xl font-bold text-fg">Stock Card: <span className="text-accent">{historyItemName}</span></h2>
                {stockHistory.length > 0 && <p className="text-[10px] text-gray-500 mt-0.5">{stockHistory.length} entries total{hUnit ? ` · qty in ${hUnit}` : ''}</p>}
              </div>
              <button onClick={() => setHistoryModalOpen(false)} className="text-gray-400 hover:text-fg font-bold text-xl">✕</button>
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
                    <tr><td colSpan="6" className="py-4 text-center text-gray-500">No movement history recorded yet.</td></tr>
                  ) : pagedHistory.map((log, idx) => {
                    const dispChange = fmtQty(log.qtyChange);
                    const dispBalance = fmtQty(log.balanceAfter);
                    const dispCost = fmtCost(log.unitCost);
                    return (
                    <tr key={idx} className="border-b border-gray-800/50 hover:bg-page-bg/30">
                      <td className="py-2 text-fg/80 text-xs">{new Date(log.date).toLocaleString()}</td>
                      <td className="py-2 font-bold text-fg/80">{log.type}</td>
                      <td className={`py-2 text-right font-mono font-bold ${dispChange < 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {dispChange > 0 ? `+${dispChange}` : dispChange}
                      </td>
                      <td className="py-2 text-right text-fg/80 font-mono text-xs">₱{dispCost.toFixed(2)}</td>
                      <td className="py-2 text-right text-accent font-bold font-mono">{dispBalance}</td>
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
                  className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${historyPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface-2 border border-gray-700 text-fg hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                </button>
                <span className="text-gray-400 text-xs font-bold tracking-widest">
                  PAGE <span className="text-accent text-sm">{historyPage}</span> OF {totalHistPages}
                </span>
                <button
                  onClick={() => setHistoryPage(p => Math.min(p + 1, totalHistPages))}
                  disabled={historyPage === totalHistPages}
                  className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${historyPage === totalHistPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface-2 border border-gray-700 text-fg hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                </button>
              </div>
            )}
          </div>
        </div>
      );
}
