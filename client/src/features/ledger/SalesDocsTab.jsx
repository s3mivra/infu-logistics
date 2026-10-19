import { Download, RefreshCw } from 'lucide-react';
import Pager from '../../shared/Pager';
import RangePresets from '../../shared/RangePresets';

// Sales, by document and in detail.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function SalesDocsTab({
  ledgerSubTab, salesView, sliView, salesViewTabs, sliRange, setSliRange, loadSli, salesSourceSelect,
  setSliSummary, salesLineItems, exportSalesLineItemsPDF, sliSummary, exportSliSummaryPDF, exportSliExcel, fmtD, money2,
  sliPage,
}) {
  return (
    <>
    {ledgerSubTab === 'salessummary' && (salesView === 'docs' || salesView === 'detail') && (
      <div className="bg-surface border border-white/10 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-black text-fg">Sales</h3>
            <p className="text-fg/65 text-xs">{sliView === 'summary' ? 'One row per order - its gross sales, discount and sales after discount.' : 'One row per item sold - with its billing, delivery and invoice numbers.'}</p>
            {salesViewTabs()}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <RangePresets value={sliRange} onChange={r => setSliRange(p => ({ ...p, ...r }))} onRun={loadSli} />
            <input type="date" value={sliRange.start} onChange={e => setSliRange(p => ({ ...p, start: e.target.value }))}
              className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
            <span className="text-fg/65 font-bold text-sm">→</span>
            <input type="date" value={sliRange.end} onChange={e => setSliRange(p => ({ ...p, end: e.target.value }))}
              className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
            {salesSourceSelect((v) => { setSliSummary(null); loadSli(v); })}
            <button onClick={loadSli} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/80 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><RefreshCw size={12} /> Load</button>
            {sliView === 'detail' && salesLineItems && <button onClick={exportSalesLineItemsPDF} className="flex items-center gap-1.5 bg-white/5 text-fg/80 hover:text-fg hover:bg-white/10 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> PDF</button>}
            {sliView === 'summary' && sliSummary && <button onClick={exportSliSummaryPDF} className="flex items-center gap-1.5 bg-white/5 text-fg/80 hover:text-fg hover:bg-white/10 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> PDF</button>}
            {((sliView === 'detail' && salesLineItems) || (sliView === 'summary' && sliSummary)) && <button onClick={exportSliExcel} className="flex items-center gap-1.5 bg-white/5 text-fg/80 hover:text-fg hover:bg-white/10 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> Excel</button>}
          </div>
        </div>
        {sliView === 'summary' ? (
          !sliSummary ? <p className="text-fg/65 text-sm">Pick a range and press Load.</p>
          : sliSummary.rows.length === 0 ? <p className="text-fg/65 text-sm">No completed sales posted in range.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr className="text-fg/80 text-[10px] font-black uppercase tracking-wider text-left border-b border-white/10">
                    <th className="py-2">Posting</th><th className="py-2">Document</th><th className="py-2">Cust. No.</th><th className="py-2">Customer</th>
                    <th className="py-2">Billing Doc</th><th className="py-2">DR No.</th><th className="py-2">SI / OR No.</th>
                    <th className="py-2 text-right">Gross Sales</th><th className="py-2 text-right">Discount</th><th className="py-2 text-right">Sales After Discount</th>
                  </tr>
                </thead>
                <tbody className="text-fg/75">
                  {sliSummary.rows.map((r, i) => (
                    <tr key={i} className="border-b border-white/5 text-xs">
                      <td className="py-1.5">{fmtD(r.postingDate)}</td><td className="py-1.5">{fmtD(r.documentDate)}</td>
                      <td className="py-1.5 font-mono">{r.customerNumber}</td><td className="py-1.5">{r.customerName}</td>
                      <td className="py-1.5 font-mono">{r.billingNumber || '-'}</td><td className="py-1.5 font-mono">{r.drNumbers || '-'}</td><td className="py-1.5 font-mono">{r.orNumber || '-'}</td>
                      <td className="py-1.5 text-right font-mono">{money2(r.gross)}</td><td className="py-1.5 text-right font-mono">{money2(r.discount)}</td>
                      <td className="py-1.5 text-right font-mono font-bold text-fg/90">{money2(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-black text-fg border-t-2 border-white/20">
                    <td className="py-2" colSpan={9}>Total ({sliSummary.count} documents)</td>
                    <td className="py-2 text-right font-mono text-brand-text">{money2(sliSummary.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        ) : !salesLineItems ? (
          <p className="text-fg/65 text-sm">Pick a range and press Load.</p>
        ) : sliPage.pageItems.length === 0 ? (
          <p className="text-fg/65 text-sm">No completed sales in range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg/80 text-[10px] font-black uppercase tracking-wider text-left border-b border-white/10">
                  <th className="py-2">Posting</th><th className="py-2">Document</th>
                  <th className="py-2">Cust. No.</th><th className="py-2">Customer Name</th>
                  <th className="py-2">Billing / DR / SI</th>
                  <th className="py-2">Item Code</th><th className="py-2">Item</th>
                  <th className="py-2 text-right">SRP</th>
                  <th className="py-2 text-right">Unit Price</th>
                  <th className="py-2 text-right" title="What one unit sold for after its price tier and any discount">Price After Disc.</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Gross</th>
                  <th className="py-2 text-right">Discount</th>
                  <th className="py-2 text-right">Sales After Disc.</th>
                </tr>
              </thead>
              <tbody className="text-fg/75">
                {sliPage.pageItems.map((row, i) => (
                  <tr key={i} className={`border-b border-white/5 ${row.isComponent ? 'bg-white/[0.02]' : ''}`}>
                    <td className="py-1.5 text-fg/70 text-xs">{row.isComponent ? '' : fmtD(row.postingDate || row.date)}</td>
                    <td className="py-1.5 text-fg/70 text-xs">{row.isComponent ? '' : fmtD(row.documentDate || row.date)}</td>
                    <td className="py-1.5 font-mono text-xs text-fg/70">{row.isComponent ? '' : (row.customerId || '-')}</td>
                    <td className="py-1.5 text-xs text-fg/70">{row.isComponent ? '' : (row.customerName || 'Guest')}</td>
                    <td className="py-1.5 font-mono text-[10px] text-fg/70">{row.isComponent ? '' : [row.billingNumber, row.drNumbers, row.orNumber].filter(Boolean).join(' · ') || row.orderNumber}</td>
                    <td className="py-1.5 font-mono text-xs text-fg/70">{row.itemCode || (row.isComponent ? '' : '-')}</td>
                    <td className={`py-1.5 text-xs ${row.isComponent ? 'text-fg/70 pl-4' : 'text-fg/70'} ${row.isCombo ? 'font-bold' : ''}`}>
                      {row.isComponent ? `↳ ${row.itemName}` : row.itemName}{row.isCombo ? ' (promo)' : ''}
                    </td>
                    <td className="py-1.5 text-right font-mono">{row.isComponent ? '' : money2(row.srp ?? row.unitPrice ?? 0)}</td>
                    <td className="py-1.5 text-right font-mono">{row.isComponent ? '' : money2(row.unitPrice ?? 0)}</td>
                    {(() => {
                      const after = row.unitAfterDiscount ?? row.unitPrice ?? 0;
                      const srp = row.srp ?? row.unitPrice ?? 0;
                      const moved = !row.isComponent && Math.abs(after - srp) > 0.005;
                      return <td className={`py-1.5 text-right font-mono ${moved ? 'text-brand-text font-bold' : ''}`}
                        title={moved ? `${after < srp ? 'Below' : 'Above'} SRP by ${money2(Math.abs(srp - after))}` : undefined}>
                        {row.isComponent ? '' : money2(after)}
                      </td>;
                    })()}
                    <td className="py-1.5 text-right font-mono">{row.quantity}</td>
                    <td className="py-1.5 text-right font-mono">{row.isComponent ? <span className="text-fg/65 font-normal not-italic">included</span> : money2(row.grossSales ?? row.lineTotal)}</td>
                    <td className="py-1.5 text-right font-mono">{row.isComponent ? '' : money2(row.discount ?? 0)}</td>
                    <td className="py-1.5 text-right font-mono font-bold text-fg/90">{row.isComponent ? '' : money2(row.netSales ?? row.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-black text-fg border-t-2 border-white/20">
                  <td className="py-2" colSpan={11}>Total</td>
                  <td className="py-2 text-right font-mono">{money2(salesLineItems.totals?.gross ?? salesLineItems.grandTotal)}</td>
                  <td className="py-2 text-right font-mono">{money2(salesLineItems.totals?.discount ?? 0)}</td>
                  <td className="py-2 text-right font-mono text-brand-text">{money2(salesLineItems.totals?.net ?? salesLineItems.grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
            <div className="px-3 pt-2"><Pager {...sliPage} label="lines" /></div>
          </div>
        )}
      </div>
    )}
    </>
  );
}
