import { Download, RefreshCw } from 'lucide-react';
import RangePresets from '../../shared/RangePresets';

// Sales, by order and by day.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function SalesByOrderTab({
  ledgerSubTab, salesView, salesViewTabs, sssRange, setSssRange, fetchSalesSummary, salesSourceSelect, salesSummary,
  exportSalesSummaryPDF, exportSssExcel, sssRows, money2,
}) {
  return (
    <>
    {ledgerSubTab === 'salessummary' && (salesView === 'order' || salesView === 'day') && (
      <div className="bg-surface border border-white/10 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-black text-fg">Sales</h3>
            <p className="text-fg/65 text-xs">{salesView === 'day' ? 'Completed sales per day, by payment channel.' : 'Completed sales per order, by payment channel.'}</p>
            {salesViewTabs()}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <RangePresets value={sssRange} onChange={r => setSssRange(p => ({ ...p, ...r }))} onRun={fetchSalesSummary} />
            <input type="date" value={sssRange.start} max={sssRange.end || undefined}
              onChange={e => setSssRange(r => ({ ...r, start: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-2 text-fg text-xs font-bold outline-none focus:border-brand" />
            <span className="text-fg/70 text-xs font-bold">to</span>
            <input type="date" value={sssRange.end} min={sssRange.start || undefined}
              onChange={e => setSssRange(r => ({ ...r, end: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-2 text-fg text-xs font-bold outline-none focus:border-brand" />
            {salesSourceSelect(fetchSalesSummary)}
            <button onClick={fetchSalesSummary} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/80 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><RefreshCw size={12} /> Refresh</button>
            {salesSummary && <button onClick={exportSalesSummaryPDF} className="flex items-center gap-1.5 bg-white/5 text-fg/70 hover:text-fg hover:bg-white/10 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> PDF</button>}
            {salesSummary && <button onClick={exportSssExcel} className="flex items-center gap-1.5 bg-white/5 text-fg/80 hover:text-fg hover:bg-white/10 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> Excel</button>}
          </div>
        </div>
        {!sssRows || sssRows.length === 0 ? (
          <p className="text-fg/80 text-sm">No completed sales in range. Press Refresh.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg/80 text-[10px] font-black uppercase tracking-wider text-left border-b border-white/10">
                  <th className="py-2">Date</th>
                  <th className="py-2">Customer ID</th><th className="py-2">Customer Name</th>
                  <th className="py-2">{salesView === 'day' ? 'Orders' : 'Order'}</th>
                  <th className="py-2 text-right">Cash</th><th className="py-2 text-right">E-Wallet</th>
                  <th className="py-2 text-right">Bank</th><th className="py-2 text-right">Delivery</th><th className="py-2 text-right" title="Before discount and delivery fee">Gross Sales</th><th className="py-2 text-right" title="What was charged: after discount, with any delivery fee">Sales After Discount</th>
                </tr>
              </thead>
              <tbody className="text-fg/75">
                {sssRows.map((row, i) => {
                  const isDayRow = row.orderNumber == null;
                  return (
                  <tr key={i} className="border-b border-white/5">
                    <td className="py-1.5 text-fg/70 text-xs">{row.date ? new Date(row.date).toLocaleDateString() : ''}</td>
                    <td className="py-1.5 font-mono text-xs text-fg/70">{isDayRow ? '-' : (row.customerId || '-')}</td>
                    <td className="py-1.5 text-xs text-fg/70">{isDayRow ? '-' : (row.customerName || 'Guest')}</td>
                    <td className="py-1.5 font-mono text-xs text-fg/70">{isDayRow ? row.count : row.orderNumber}</td>
                    <td className="py-1.5 text-right font-mono">{row.cash ? money2(row.cash) : ''}</td>
                    <td className="py-1.5 text-right font-mono">{row.ewallet ? money2(row.ewallet) : ''}</td>
                    <td className="py-1.5 text-right font-mono">{row.bank ? money2(row.bank) : ''}</td>
                    <td className="py-1.5 text-right font-mono">{row.delivery ? money2(row.delivery) : ''}</td>
                    <td className="py-1.5 text-right font-mono text-fg/70">{money2(row.subtotal || 0)}</td>
                    <td className="py-1.5 text-right font-mono font-bold text-fg/90">{money2(row.total)}</td>
                  </tr>
                  );
                })}
              </tbody>
              {salesSummary?.totals && (
                <tfoot>
                  <tr className="font-black text-fg border-t-2 border-white/20">
                    <td className="py-2" colSpan={4}>Totals</td>
                    <td className="py-2 text-right font-mono">{money2(salesSummary.totals.cash)}</td>
                    <td className="py-2 text-right font-mono">{money2(salesSummary.totals.ewallet)}</td>
                    <td className="py-2 text-right font-mono">{money2(salesSummary.totals.bank)}</td>
                    <td className="py-2 text-right font-mono">{money2(salesSummary.totals.delivery)}</td>
                    <td className="py-2 text-right font-mono">{money2(salesSummary.totals.subtotal || 0)}</td>
                    <td className="py-2 text-right font-mono text-brand-text">{money2(salesSummary.totals.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    )}
    </>
  );
}
