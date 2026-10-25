import { Package, Download, RefreshCw } from 'lucide-react';

// The balance sheet.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function BalanceSheetTab({
  ledgerSubTab, bsData, reconcileInventory, exportBalanceSheetPDF, fetchBalanceSheet, arOutstanding,
}) {
  return (
    <>
    {ledgerSubTab === 'balance' && (
      <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
        <div className="flex justify-between items-end border-b border-white/10 pb-4">
          <div>
            <h3 className="text-2xl font-black text-fg">Balance Sheet</h3>
            <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">Snapshot as of {bsData ? new Date(bsData.asOf).toLocaleDateString() : 'today'}</p>
            {/* Accounts Receivable is one account in the ledger; what related
                businesses owe is told apart by the client record, so it is
                shown here as a note on that line rather than a line of its own. */}
            {arOutstanding?.affiliateOutstanding > 0 && (
              <p className="text-fg/70 text-[11px] mt-1 normal-case">
                Of Accounts Receivable today: customers ₱{Number(arOutstanding.tradeOutstanding || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} · due from affiliates ₱{Number(arOutstanding.affiliateOutstanding).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={reconcileInventory} title="Set book Inventory = actual on-hand value (fixes negative/opening inventory)" className="bg-amber-500 text-white border border-amber-500 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-amber-500/60 transition min-h-[44px] flex items-center gap-1.5"><Package size={13}/> Reconcile Inventory</button>
            {bsData && <button onClick={exportBalanceSheetPDF} className="bg-white/5 text-fg/70 hover:text-fg hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition min-h-[44px] flex items-center gap-1.5"><Download size={13}/> PDF</button>}
            <button onClick={fetchBalanceSheet} className="bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[44px] flex items-center gap-1.5"><RefreshCw size={13}/> Refresh</button>
          </div>
        </div>

        {!bsData ? (
          <div className="py-16 text-center text-fg/65 font-bold uppercase tracking-widest text-sm">Click "Refresh" to load</div>
        ) : (() => {
          // Same named-section-with-subtotal pattern as the P&L above -
          // "Current Assets", "Accounts Payable", etc. as their own
          // bolded header + subtotal, instead of one flat list per side.
          const BsSections = ({ sections, flat, emptyLabel }) => {
            if (!flat || flat.length === 0) return <p className="text-fg/65 text-xs italic py-2">{emptyLabel}</p>;
            if (!sections || sections.length === 0) sections = [{ code: '_flat', name: '', items: flat, total: flat.reduce((s, r) => s + r.amount, 0) }];
            return (
              <div className="space-y-3">
                {sections.map(sec => (
                  <table key={sec.code} className="w-full text-sm">
                    <tbody>
                      {sec.name && sec.items.length > 1 && (
                        <tr><td colSpan={2} className="pb-1 text-[10px] font-black uppercase tracking-widest text-fg/70">{sec.name}</td></tr>
                      )}
                      {sec.items.map(r => (
                        <tr key={r.code} className="border-b border-white/5">
                          <td className="py-2 text-fg/80 text-xs"><span className="text-fg/65 mr-2">{r.code}</span>{r.name}</td>
                          <td className="py-2 text-right text-fg tabular-nums font-bold">{r.amount < 0 ? '−' : ''}₱{Math.abs(r.amount).toFixed(2)}</td>
                        </tr>
                      ))}
                      {sec.items.length > 1 && (
                        <tr><td className="pt-1 text-fg/75 text-[11px] font-bold uppercase">{sec.name || 'Subtotal'}</td><td className="pt-1 text-right text-fg/70 tabular-nums font-bold text-xs">₱{sec.total.toFixed(2)}</td></tr>
                      )}
                    </tbody>
                  </table>
                ))}
              </div>
            );
          };
          return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Assets */}
            <div>
              <h4 className="text-brand-text font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Assets</h4>
              <BsSections sections={bsData.sections?.assets} flat={bsData.assets} emptyLabel="No assets recorded" />
              <table className="w-full text-sm"><tbody>
                <tr><td className="pt-3 font-black text-fg uppercase text-xs">Total Assets</td><td className="pt-3 text-right text-brand-text tabular-nums font-black text-lg">₱{bsData.totals.assets.toFixed(2)}</td></tr>
              </tbody></table>
            </div>
            {/* Liabilities */}
            <div>
              <h4 className="text-danger font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Liabilities</h4>
              <BsSections sections={bsData.sections?.liabilities} flat={bsData.liabilities} emptyLabel="No liabilities recorded" />
              <table className="w-full text-sm"><tbody>
                <tr><td className="pt-3 font-black text-fg uppercase text-xs">Total Liabilities</td><td className="pt-3 text-right text-danger tabular-nums font-black">₱{bsData.totals.liabilities.toFixed(2)}</td></tr>
              </tbody></table>
            </div>
            {/* Equity */}
            <div>
              <h4 className="text-success font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Equity</h4>
              <table className="w-full text-sm">
                <tbody>
                  {bsData.equity.map(r => (
                    <tr key={r.code} className="border-b border-white/5">
                      <td className="py-2 text-fg/80 text-xs"><span className="text-fg/65 mr-2">{r.code}</span>{r.name}</td>
                      <td className="py-2 text-right text-fg tabular-nums font-bold">{r.amount < 0 ? '−' : ''}₱{Math.abs(r.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr><td className="pt-3 font-black text-fg uppercase text-xs">Total Equity</td><td className="pt-3 text-right text-success tabular-nums font-black">₱{bsData.totals.equity.toFixed(2)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}

        {bsData && (
          <div className={`mt-4 rounded-xl p-4 flex justify-between items-center border ${bsData.totals.balanced ? 'bg-accent border-accent' : 'bg-red-500 border-red-500'}`}>
            <div>
              <p className="text-white text-xs font-black uppercase tracking-widest">Accounting Equation Check</p>
              <p className="text-white text-xs mt-1">Assets = Liabilities + Equity</p>
            </div>
            <div className="text-right">
              <p className="text-white tabular-nums font-black text-lg">₱{bsData.totals.assets.toFixed(2)} = ₱{bsData.totals.liabilitiesAndEquity.toFixed(2)}</p>
              <p className={`text-xs font-black uppercase mt-1 ${bsData.totals.balanced ? 'text-white' : 'text-white'}`}>{bsData.totals.balanced ? '✓ Balanced' : '✗ Out of Balance'}</p>
            </div>
          </div>
        )}
      </div>
    )}
    </>
  );
}
