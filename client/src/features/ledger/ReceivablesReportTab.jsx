
import PagedRows from '../../shared/PagedRows';
import RecordLink from '../../shared/RecordLink';


// The receivables ageing report.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function ReceivablesReportTab({
  ledgerSubTab, arReportAsOf, setArReportAsOf, fetchArReport, arReport,
}) {
  return (
    <>
    {ledgerSubTab === 'arreport' && (
      <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
        <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-2xl font-black text-fg">A/R Report</h3>
            <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">Aged receivables schedule · invoice level</p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">As Of</label>
              <input type="date" value={arReportAsOf} onChange={e => setArReportAsOf(e.target.value)}
                className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
            </div>
            <button onClick={fetchArReport}
              className="bg-brand text-on-brand px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
              Run
            </button>
          </div>
        </div>

        {!arReport ? (
          <div className="py-16 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">Pick a date and run the report</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Current', sub: '0-30d', amt: arReport.totals.current, cls: 'text-success bg-green-500/10 border-green-500/20' },
                { label: '31-60',   sub: 'days',  amt: arReport.totals.d31_60,  cls: 'text-warning bg-yellow-500/10 border-yellow-500/20' },
                { label: '61-90',   sub: 'days',  amt: arReport.totals.d61_90,  cls: 'text-warning bg-orange-500/10 border-orange-500/20' },
                { label: '91+',     sub: 'days',  amt: arReport.totals.d90_plus,cls: 'text-danger bg-red-500/10 border-red-500/20' },
                { label: 'Total',   sub: `${arReport.totals.count} invoice(s)`, amt: arReport.totals.total, cls: 'text-brand-text bg-brand/10 border-brand/25' },
              ].map(b => (
                <div key={b.label} className={`rounded-xl border px-4 py-3 ${b.cls.split(' ').slice(1).join(' ')}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">{b.label} <span className="normal-case font-normal">{b.sub}</span></p>
                  <p className={`text-xl font-black tabular-nums mt-1 ${b.amt > 0 ? b.cls.split(' ')[0] : 'text-fg/65'}`}>₱{b.amt.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
              ))}
            </div>

            {arReport.overdueTotal > 0 && (
              <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-danger">Past Their Agreed Due Date</p>
                <p className="text-xl font-black tabular-nums text-danger">₱{arReport.overdueTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
              </div>
            )}

            {/* Per-client roll-up first - the question is almost always
                "who owes me" before "which invoice". */}
            <div className="bg-page-bg/40 border border-white/10 rounded-xl overflow-x-auto">
              <p className="text-[11px] font-black uppercase tracking-widest text-fg/65 px-4 py-3 border-b border-white/10">By Client</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-fg/75 text-[10px] uppercase tracking-widest border-b border-white/10">
                    <th className="text-left py-2.5 px-4">Client</th>
                    <th className="text-right py-2.5">Current</th>
                    <th className="text-right py-2.5">31-60</th>
                    <th className="text-right py-2.5">61-90</th>
                    <th className="text-right py-2.5">91+</th>
                    <th className="text-right py-2.5 px-4">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <PagedRows items={arReport.byClient} label="clients" render={c => (
                    <tr key={c.client} className="border-b border-white/5">
                      <td className="py-2.5 px-4 font-bold text-fg"><RecordLink kind="client" value={c.client} />{c.clientCode && <span className="ml-2 text-[9px] text-fg/65">{c.clientCode}</span>}</td>
                      <td className="py-2.5 text-right tabular-nums text-fg/70">{c.current ? `₱${c.current.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className="py-2.5 text-right tabular-nums text-warning">{c.d31_60 ? `₱${c.d31_60.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className="py-2.5 text-right tabular-nums text-caution">{c.d61_90 ? `₱${c.d61_90.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className="py-2.5 text-right tabular-nums text-red-500/80">{c.d90_plus ? `₱${c.d90_plus.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-black text-fg">₱{c.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  )} />
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <p className="text-[11px] font-black uppercase tracking-widest text-fg/65 mb-2">Open Invoices</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-fg/75 text-[10px] uppercase tracking-widest border-b border-white/10">
                    <th className="text-left py-2.5">Invoice</th>
                    <th className="text-left py-2.5">Client</th>
                    <th className="text-left py-2.5">Date</th>
                    <th className="text-left py-2.5">Due</th>
                    <th className="text-left py-2.5">Age</th>
                    <th className="text-right py-2.5">Invoiced</th>
                    <th className="text-right py-2.5">Collected</th>
                    <th className="text-right py-2.5">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <PagedRows items={arReport.invoices} label="invoices" render={i => (
                    <tr key={i._id} className={`border-b border-white/5 ${i.overdue ? 'bg-red-500/5' : ''}`}>
                      <td className="py-2.5 font-bold text-fg"><RecordLink kind="order" value={i.orderNumber} /></td>
                      <td className="py-2.5 text-fg/70"><RecordLink kind="client" value={i.client} /></td>
                      <td className="py-2.5 text-fg/75 text-xs">{new Date(i.invoiceDate).toLocaleDateString()}</td>
                      <td className="py-2.5 text-xs">{i.dueDate ? <span className={i.overdue ? 'text-danger font-bold' : 'text-fg/65'}>{new Date(i.dueDate).toLocaleDateString()}</span> : <span className="text-fg/65">-</span>}</td>
                      <td className="py-2.5"><span className={`text-[10px] font-black px-2 py-1 rounded ${i.bucket === 'current' ? 'bg-green-400/15 text-success' : i.bucket === 'd31_60' ? 'bg-yellow-500/15 text-warning' : i.bucket === 'd61_90' ? 'bg-orange-500/15 text-warning' : 'bg-red-500/15 text-danger'}`}>{i.ageDays}d</span></td>
                      <td className="py-2.5 text-right tabular-nums text-fg/75">₱{i.faceTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                      <td className="py-2.5 text-right tabular-nums text-success">{i.paid ? `₱${i.paid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : <span className="text-fg/65">-</span>}</td>
                      <td className="py-2.5 text-right tabular-nums font-black text-fg">₱{i.balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  )} />
                </tbody>
              </table>
              {!arReport.invoices.length && <div className="py-16 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">Nothing outstanding as of this date</div>}
            </div>
          </>
        )}
      </div>
    )}
    </>
  );
}
