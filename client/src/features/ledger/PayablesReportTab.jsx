
import PagedRows from '../../shared/PagedRows';


// The payables ageing report.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function PayablesReportTab({
  ledgerSubTab, apReportAsOf, setApReportAsOf, fetchApReport, apReport,
}) {
  return (
    <>
    {ledgerSubTab === 'apreport' && (
      <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
        <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-2xl font-black text-fg">A/P Report</h3>
            <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">Aged payables · what we owe, and when it's due</p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">As Of</label>
              <input type="date" value={apReportAsOf} onChange={e => setApReportAsOf(e.target.value)}
                className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
            </div>
            <button onClick={fetchApReport}
              className="bg-brand text-on-brand px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
              Run
            </button>
          </div>
        </div>

        {!apReport ? (
          <div className="py-16 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">Pick a date and run the report</div>
        ) : (
          <>
            {/* Buckets are DAYS PAST DUE here, not invoice age. */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Not Yet Due', sub: '', amt: apReport.totals.current, color: 'text-success', bg: 'bg-green-500/10 border-green-500/20' },
                { label: '1-30', sub: 'days late', amt: apReport.totals.d31_60, color: 'text-warning', bg: 'bg-yellow-500/10 border-yellow-500/20' },
                { label: '31-60', sub: 'days late', amt: apReport.totals.d61_90, color: 'text-warning', bg: 'bg-orange-500/10 border-orange-500/20' },
                { label: '61+', sub: 'days late', amt: apReport.totals.d90_plus, color: 'text-danger', bg: 'bg-red-500/10 border-red-500/20' },
                { label: 'Total', sub: `${apReport.totals.count} bill(s)`, amt: apReport.totals.total, color: 'text-brand-text', bg: 'bg-brand/10 border-brand/25' },
              ].map(b => (
                <div key={b.label} className={`rounded-xl border px-4 py-3 ${b.bg}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">{b.label} <span className="normal-case font-normal">{b.sub}</span></p>
                  <p className={`text-lg sm:text-xl font-black tabular-nums mt-1 whitespace-nowrap ${b.amt > 0 ? b.color : 'text-fg/65'}`}>₱{b.amt.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className={`rounded-xl border px-4 py-3 ${apReport.overdueTotal > 0 ? 'border-red-500/25 bg-red-500/10' : 'border-white/10 bg-white/5'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Overdue</p>
                <p className={`text-xl font-black tabular-nums ${apReport.overdueTotal > 0 ? 'text-danger' : 'text-fg/65'}`}>₱{apReport.overdueTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                <p className="text-[9px] text-fg/70 mt-0.5">{apReport.overdueCount} bill(s) past their date</p>
              </div>
              {/* An aged bucket never answers "do we have the cash this
                  week" - this does. */}
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Due Within 7 Days</p>
                <p className="text-xl font-black tabular-nums text-fg">₱{apReport.dueSoonTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                <p className="text-[9px] text-fg/70 mt-0.5">{apReport.dueSoonCount} bill(s) coming up</p>
              </div>
              {/* Owed regardless, but can't be scheduled until someone
                  signs it off - an approval problem, not a cash one. */}
              <div className={`rounded-xl border px-4 py-3 ${apReport.awaitingApprovalTotal > 0 ? 'border-yellow-500/25 bg-yellow-500/10' : 'border-white/10 bg-white/5'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Awaiting Approval</p>
                <p className={`text-xl font-black tabular-nums ${apReport.awaitingApprovalTotal > 0 ? 'text-warning' : 'text-fg/65'}`}>₱{apReport.awaitingApprovalTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                <p className="text-[9px] text-fg/70 mt-0.5">{apReport.awaitingApprovalCount} bill(s) not yet authorised</p>
              </div>
            </div>

            {apReport.totals.undated > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">No Due Date Set</p>
                <p className="text-lg font-black tabular-nums text-fg/70">₱{apReport.totals.undated.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                <p className="text-[9px] text-fg/70 mt-0.5">Can't be aged - set terms on these bills so they stop hiding from the buckets.</p>
              </div>
            )}

            <div className="bg-page-bg/40 border border-white/10 rounded-xl overflow-x-auto">
              <p className="text-[11px] font-black uppercase tracking-widest text-fg/65 px-4 py-3 border-b border-white/10">By Supplier</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-fg/75 text-[10px] uppercase tracking-widest border-b border-white/10">
                    <th className="text-left py-2.5 px-4">Supplier</th>
                    <th className="text-right py-2.5">Not Due</th>
                    <th className="text-right py-2.5">1-30</th>
                    <th className="text-right py-2.5">31-60</th>
                    <th className="text-right py-2.5">61+</th>
                    <th className="text-right py-2.5 px-4">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <PagedRows items={apReport.bySupplier} label="suppliers" render={g => (
                    <tr key={g.supplier} className="border-b border-white/5">
                      <td className="py-2.5 px-4 font-bold text-fg">{g.supplier}</td>
                      <td className="py-2.5 text-right tabular-nums text-fg/70">{g.current ? `₱${g.current.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className="py-2.5 text-right tabular-nums text-warning">{g.d31_60 ? `₱${g.d31_60.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className="py-2.5 text-right tabular-nums text-caution">{g.d61_90 ? `₱${g.d61_90.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className="py-2.5 text-right tabular-nums text-red-500/80">{g.d90_plus ? `₱${g.d90_plus.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-black text-fg">₱{g.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  )} />
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <p className="text-[11px] font-black uppercase tracking-widest text-fg/65 mb-2">Open Bills</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-fg/75 text-[10px] uppercase tracking-widest border-b border-white/10">
                    <th className="text-left py-2.5">Bill</th>
                    <th className="text-left py-2.5">Supplier</th>
                    <th className="text-left py-2.5">Description</th>
                    <th className="text-left py-2.5">Due</th>
                    <th className="text-left py-2.5">Status</th>
                    <th className="text-right py-2.5">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <PagedRows items={apReport.bills} label="bills" render={b => (
                    <tr key={b._id} className={`border-b border-white/5 ${b.overdue ? 'bg-red-500/5' : ''}`}>
                      <td className="py-2.5 font-bold text-fg text-xs">
                        {b.billNumber}
                        {b.poNumber && <span className="block text-[9px] text-fg/65">{b.poNumber}</span>}
                      </td>
                      <td className="py-2.5 text-fg/70 text-xs">{b.supplier}</td>
                      <td className="py-2.5 text-fg/75 text-xs max-w-[220px] truncate" title={b.description}>{b.description || '-'}</td>
                      <td className="py-2.5 text-xs">
                        {b.dueDate ? (
                          b.overdue
                            ? <span className="text-[10px] font-black px-2 py-1 rounded bg-red-500/15 text-danger">{b.daysPastDue}d LATE</span>
                            : <span className="text-fg/65">{new Date(b.dueDate).toLocaleDateString()}</span>
                        ) : <span className="text-[10px] font-black px-2 py-1 rounded bg-white/10 text-fg/70">NO DATE</span>}
                      </td>
                      <td className="py-2.5">
                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded ${b.awaitingApproval ? 'bg-yellow-500/15 text-warning' : 'bg-white/10 text-fg/65'}`}>
                          {b.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-black text-fg">₱{b.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  )} />
                </tbody>
              </table>
              {!apReport.bills.length && <div className="py-16 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">Nothing owed as of this date</div>}
            </div>
          </>
        )}
      </div>
    )}
    </>
  );
}
