import React from 'react';
import { formatDate } from '../../shared/dates.js';
import { Download, RefreshCw } from 'lucide-react';
import RangePresets from '../../shared/RangePresets';

import PagedRows from '../../shared/PagedRows';
// Sales, by order and by day.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
// Sold on account: owed, not paid. An older server counted it under E-Wallet
// (it has no `credit` field), so take it back out of E-Wallet there.
const creditOf = (r) => ['On Account', 'Credit', 'Charge', 'A/R'].reduce((t, m) => t + (Number(r?.methods?.[m]) || 0), 0);
const ewalletOnly = (r) => (r?.credit === undefined ? Math.max(0, (Number(r?.ewallet) || 0) - creditOf(r)) : Number(r?.ewallet) || 0);

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
                  <th className="py-2 text-right">Bank</th><th className="py-2 text-right">Delivery</th><th className="py-2 text-right" title="Sold on account: owed, not yet paid">Credit</th><th className="py-2 text-right" title="Before discount and delivery fee">Gross Sales</th><th className="py-2 text-right" title="What was charged: after discount, with any delivery fee">Sales After Discount</th>
                </tr>
              </thead>
              <tbody className="text-fg/75">
                <PagedRows items={sssRows} label="orders" render={(row, i) => {
                  const isDayRow = row.orderNumber == null;
                  return (
                  <tr key={i} className="border-b border-white/5">
                    <td className="py-1.5 text-fg/70 text-xs">{row.date ? formatDate(row.date) : ''}</td>
                    <td className="py-1.5 font-mono text-xs text-fg/70">{isDayRow ? '-' : (row.customerId || '-')}</td>
                    <td className="py-1.5 text-xs text-fg/70">{isDayRow ? '-' : (row.customerName || 'Guest')}</td>
                    <td className="py-1.5 font-mono text-xs text-fg/70">{isDayRow ? row.count : row.orderNumber}</td>
                    <td className="py-1.5 text-right font-mono">{row.cash ? money2(row.cash) : ''}</td>
                    <td className="py-1.5 text-right font-mono">{(() => { const e = ewalletOnly(row); return e ? money2(e) : ''; })()}</td>
                    <td className="py-1.5 text-right font-mono">{row.bank ? money2(row.bank) : ''}</td>
                    <td className="py-1.5 text-right font-mono">{row.delivery ? money2(row.delivery) : ''}</td>
                    <td className="py-1.5 text-right font-mono text-warning">{(() => { const c = ['On Account', 'Credit', 'Charge', 'A/R'].reduce((s, m) => s + (Number(row?.methods?.[m]) || 0), 0); return c ? money2(c) : ''; })()}</td>
                    <td className="py-1.5 text-right font-mono text-fg/70">{money2(row.subtotal || 0)}</td>
                    <td className="py-1.5 text-right font-mono font-bold text-fg/90">{money2(row.total)}</td>
                  </tr>
                  );
                }} />
              </tbody>
              {salesSummary?.totals && (
                <tfoot>
                  <tr className="font-black text-fg border-t-2 border-white/20">
                    <td className="py-2" colSpan={4}>Totals</td>
                    <td className="py-2 text-right font-mono">{money2(salesSummary.totals.cash)}</td>
                    <td className="py-2 text-right font-mono">{money2(ewalletOnly(salesSummary.totals))}</td>
                    <td className="py-2 text-right font-mono">{money2(salesSummary.totals.bank)}</td>
                    <td className="py-2 text-right font-mono">{money2(salesSummary.totals.delivery)}</td>
                    <td className="py-2 text-right font-mono text-warning">{money2(['On Account', 'Credit', 'Charge', 'A/R'].reduce((s, m) => s + (Number(salesSummary.totals?.methods?.[m]) || 0), 0))}</td>
                    <td className="py-2 text-right font-mono">{money2(salesSummary.totals.subtotal || 0)}</td>
                    <td className="py-2 text-right font-mono text-brand-text">{money2(salesSummary.totals.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {/* A/R collected in the same range, whatever day the sale was made:
            a sale on account shows above on its own day, the money for it here
            on the day it came in. */}
        {salesSummary?.collections && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h4 className="text-sm font-black text-fg uppercase tracking-wider">Collected on account (A/R) in this range</h4>
              <span className="text-[11px] text-fg/60">{salesSummary.collections.length} payment(s)</span>
            </div>
            {salesSummary.collections.length === 0 ? (
              <p className="text-xs text-fg/60">No A/R payments were collected in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-fg/60 border-b border-white/10">
                      <th className="py-2">Collected</th><th className="py-2">Customer</th><th className="py-2">Order</th><th className="py-2">Sale date</th>
                      <th className="py-2 text-right">Took</th><th className="py-2 pl-3">Paid by</th><th className="py-2">Check / reference</th><th className="py-2">Status</th><th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesSummary.collections.map((c, i, all) => {
                      const sub = salesSummary.collectionTotals?.customers?.[c.customerName];
                      const lastOfCustomer = !all[i + 1] || all[i + 1].customerName !== c.customerName;
                      const ref = c.checkNumber
                        ? [`#${c.checkNumber}`, c.checkBank, c.checkDate ? `dated ${formatDate(c.checkDate)}` : ''].filter(Boolean).join(' · ')
                        : (c.reference || '-');
                      return (
                        <React.Fragment key={`${c.orderNumber}-${i}`}>
                          <tr className="border-b border-white/5">
                            <td className="py-1.5 whitespace-nowrap">{formatDate(c.date)}</td>
                            <td className="py-1.5 font-bold">{c.customerName}</td>
                            <td className="py-1.5 font-mono text-xs">{c.orderNumber}</td>
                            <td className="py-1.5 text-fg/70 whitespace-nowrap">{formatDate(c.saleDate)}</td>
                            <td className="py-1.5 text-right text-fg/70 tabular-nums">{c.daysToPay == null ? '-' : `${c.daysToPay} d`}</td>
                            <td className="py-1.5 pl-3">{c.method}</td>
                            <td className="py-1.5 text-fg/70">{ref}</td>
                            <td className="py-1.5">{c.status && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.undeposited ? 'bg-amber-500/15 text-warning' : 'bg-green-500/15 text-success'}`}>{c.status}</span>
                            )}</td>
                            <td className="py-1.5 text-right font-mono font-bold">{money2(c.amount)}</td>
                          </tr>
                          {lastOfCustomer && sub && sub.count > 1 && (
                            <tr className="border-b border-white/10 bg-white/[0.03]">
                              <td className="py-1.5 font-black text-fg/80" colSpan={8}>{c.customerName} - {sub.count} sales</td>
                              <td className="py-1.5 text-right font-mono font-black">{money2(sub.amount)}</td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="font-black text-fg border-t-2 border-white/20">
                      <td className="py-2" colSpan={8}>Total collected{Object.keys(salesSummary.collectionTotals?.methods || {}).length > 1
                        ? <span className="ml-2 font-normal text-[11px] text-fg/60">{Object.entries(salesSummary.collectionTotals.methods).map(([m, a]) => `${m} ${money2(a)}`).join(' · ')}</span> : null}</td>
                      <td className="py-2 text-right font-mono text-brand-text">{money2(salesSummary.collectionTotals?.total || 0)}</td>
                    </tr>
                    {(salesSummary.collectionTotals?.undeposited || 0) > 0 && (
                      <tr className="text-warning text-xs">
                        <td className="pb-2" colSpan={8}>Checks still on hand (not yet deposited)</td>
                        <td className="pb-2 text-right font-mono font-bold">{money2(salesSummary.collectionTotals.undeposited)}</td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    )}
    </>
  );
}
