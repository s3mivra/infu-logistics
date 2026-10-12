import { Download } from 'lucide-react';
import RangePresets from '../../shared/RangePresets';

// Profit and loss.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function ProfitAndLossTab({
  ledgerSubTab, pnlRange, setPnlRange, fetchPnl, exportPnlPDF, pnlData,
}) {
  return (
    <>
    {ledgerSubTab === 'pnl' && (
      <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:justify-between border-b border-white/10 pb-4">
          <div>
            <h3 className="text-2xl font-black text-fg">Profit &amp; Loss Statement</h3>
            <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">Non-VAT Registered</p>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <RangePresets value={pnlRange} onChange={r => setPnlRange(p => ({ ...p, ...r }))} onRun={fetchPnl} />
            <div>
              <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Start</label>
              <input type="date" value={pnlRange.start} onChange={e => setPnlRange({...pnlRange, start: e.target.value})} className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm font-bold outline-none focus:border-brand/60" />
            </div>
            <div>
              <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">End</label>
              <input type="date" value={pnlRange.end} onChange={e => setPnlRange({...pnlRange, end: e.target.value})} className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm font-bold outline-none focus:border-brand/60" />
            </div>
            <button onClick={fetchPnl} className="bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[44px]">Run</button>
            <button onClick={exportPnlPDF} className="bg-white/5 text-fg/70 hover:text-fg hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition min-h-[44px] flex items-center gap-1.5"><Download size={13}/> PDF</button>
          </div>
        </div>

        {!pnlData ? (
          <div className="py-16 text-center text-fg/65 font-bold uppercase tracking-widest text-sm">Click "Run" to generate report</div>
        ) : (() => {
          // Renders one bucket (Revenue, OpEx, ...) as a stack of NAMED
          // sections with their own subtotal - e.g. "Salaries & Wages",
          // "Repairs & Maintenance" - each a bolded header + its line
          // items + a subtotal row, instead of one flat undifferentiated
          // list. Falls back to the flat list when the server sent no
          // section breakdown (older cached response) or there's
          // nothing to show for this bucket.
          const Sections = ({ sections, flat, emptyLabel }) => {
            if (!flat || flat.length === 0) return <p className="text-fg/65 text-sm">{emptyLabel}</p>;
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
                          <td className="py-2 text-right text-fg tabular-nums font-bold">{r.amount >= 0 ? '' : '('}₱{Math.abs(r.amount).toFixed(2)}{r.amount < 0 ? ')' : ''}</td>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue */}
            <div className="space-y-3">
              <h4 className="text-brand-text font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2">Revenue</h4>
              <Sections sections={pnlData.sections?.revenue} flat={pnlData.revenue} emptyLabel="No revenue entries." />
              {pnlData.revenue.length > 0 && (
                <table className="w-full text-sm"><tbody>
                  <tr><td className="pt-2 font-black text-fg uppercase text-xs">Net Revenue</td><td className="pt-2 text-right text-brand-text tabular-nums font-black text-lg">₱{pnlData.totals.netRevenue.toFixed(2)}</td></tr>
                </tbody></table>
              )}

              <h4 className="text-warning font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mt-6">Cost of Goods Sold</h4>
              <Sections sections={pnlData.sections?.cogs} flat={pnlData.cogs} emptyLabel="No COGS entries." />
              {pnlData.cogs.length > 0 && (
                <table className="w-full text-sm"><tbody>
                  <tr><td className="pt-2 font-black text-fg uppercase text-xs">Total COGS</td><td className="pt-2 text-right text-warning tabular-nums font-black">₱{pnlData.totals.cogs.toFixed(2)}</td></tr>
                </tbody></table>
              )}
              <table className="w-full text-sm"><tbody>
                <tr className="border-t border-white/10"><td className="pt-3 font-black text-fg uppercase text-sm">Gross Profit</td><td className="pt-3 text-right text-success tabular-nums font-black text-lg">₱{pnlData.totals.grossProfit.toFixed(2)}</td></tr>
                <tr><td className="font-bold text-fg/75 uppercase text-xs">Gross Margin</td><td className="text-right text-fg/70 tabular-nums font-black text-sm">{pnlData.totals.grossMargin.toFixed(2)}%</td></tr>
              </tbody></table>

              {/* Other Income - kept separate from Revenue (interest
                  earned, gains, etc. aren't sales) so the top line
                  isn't inflated by non-operating income. */}
              {pnlData.otherIncome?.length > 0 && (<>
                <h4 className="text-info font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mt-6">Other Income</h4>
                <Sections sections={pnlData.sections?.otherIncome} flat={pnlData.otherIncome} emptyLabel="" />
                <table className="w-full text-sm"><tbody>
                  <tr><td className="pt-2 font-black text-fg uppercase text-xs">Total Other Income</td><td className="pt-2 text-right text-info tabular-nums font-black">₱{pnlData.totals.otherIncome.toFixed(2)}</td></tr>
                </tbody></table>
              </>)}
            </div>

            {/* Operating Expenses */}
            <div className="space-y-3">
              <h4 className="text-danger font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2">Operating Expenses</h4>
              <Sections sections={pnlData.sections?.opex} flat={pnlData.opex} emptyLabel="No expense entries in this period." />
              {pnlData.opex.length > 0 && (
                <table className="w-full text-sm"><tbody>
                  <tr><td className="pt-2 font-black text-fg uppercase text-xs">Total OpEx</td><td className="pt-2 text-right text-danger tabular-nums font-black">₱{pnlData.totals.opex.toFixed(2)}</td></tr>
                </tbody></table>
              )}

              {/* Other (Non-Operating) Expenses - the same distinction
                  as Other Income above; interest paid, disposal losses,
                  etc. sit below regular OpEx, not mixed into it. */}
              {pnlData.otherExpense?.length > 0 && (<>
                <h4 className="text-fg/75 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mt-6">Other Expenses</h4>
                <Sections sections={pnlData.sections?.otherExpense} flat={pnlData.otherExpense} emptyLabel="" />
                <table className="w-full text-sm"><tbody>
                  <tr><td className="pt-2 font-black text-fg uppercase text-xs">Total Other Expenses</td><td className="pt-2 text-right text-fg/70 tabular-nums font-black">₱{pnlData.totals.otherExpense.toFixed(2)}</td></tr>
                </tbody></table>
              </>)}

              {/* Net Income Summary */}
              <div className={`mt-6 rounded-xl p-5 border ${pnlData.totals.netIncome >= 0 ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                <p className="text-fg/80 text-xs font-black uppercase tracking-widest mb-2">Net Income</p>
                <p className={`text-4xl font-black tabular-nums ${pnlData.totals.netIncome >= 0 ? 'text-success' : 'text-danger'}`}>
                  {pnlData.totals.netIncome < 0 ? '−' : ''}₱{Math.abs(pnlData.totals.netIncome).toFixed(2)}
                </p>
                <p className="text-fg/80 text-xs font-bold mt-2">Net Margin: <span className="tabular-nums">{pnlData.totals.netMargin.toFixed(2)}%</span></p>
                <p className="text-fg/65 text-[10px] font-bold uppercase tracking-widest mt-3 border-t border-white/10 pt-2">
                  Period: {new Date(pnlData.period.start).toLocaleDateString()} → {new Date(pnlData.period.end).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
          );
        })()}
      </div>
    )}
    </>
  );
}
