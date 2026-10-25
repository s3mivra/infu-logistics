import { } from 'lucide-react';
import RangePresets from '../../shared/RangePresets';

// The collection report and the check register.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function CollectionsTab({
  ledgerSubTab, checkFilter, setCheckFilter, fetchChecks, checkRegister, actOnCheck, collRange, setCollRange,
  fetchCollectionReport, collectionReport,
}) {
  return (
    <>
    {ledgerSubTab === 'collections' && (
      <div className="space-y-4 animate-fade-in">
        {/* ── CHECK REGISTER ──────────────────────────────────────────
            A check is a promise of money, and the gap between taking one
            in and the bank honouring it is where receivables go wrong.
            Every check lives here through On Hand → Deposited → Cleared,
            or Bounced - which reverses the collection and reopens the
            invoice. */}
        <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
            <div>
              <h3 className="text-xl font-black text-fg">Check Register</h3>
              <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">Checks received against receivables</p>
            </div>
            <div className="flex items-end gap-2">
              <select value={checkFilter} onChange={e => { setCheckFilter(e.target.value); fetchChecks(e.target.value); }}
                className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60">
                <option value="">All statuses</option>
                <option value="On Hand">On Hand</option>
                <option value="Deposited">Deposited</option>
                <option value="Cleared">Cleared</option>
                <option value="Bounced">Bounced</option>
              </select>
              <button onClick={() => fetchChecks(checkFilter)}
                className="bg-white/5 hover:bg-white/10 text-fg/65 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition min-h-[40px]">
                Refresh
              </button>
            </div>
          </div>

          {!checkRegister ? (
            <div className="py-12 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">Loading check register…</div>
          ) : (
            <>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                {/* On-hand checks whose date has arrived: money sitting in
                    a drawer that could be in the bank today. */}
                <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Ready to Deposit</p>
                  <p className="text-xl font-black tabular-nums text-success">₱{checkRegister.summary.readyToDepositTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                  <p className="text-[9px] text-fg/70 mt-0.5">{checkRegister.summary.readyToDepositCount} check(s)</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Post-Dated</p>
                  <p className="text-xl font-black tabular-nums text-fg/70">₱{checkRegister.summary.postDatedTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                  <p className="text-[9px] text-fg/70 mt-0.5">Not bankable yet</p>
                </div>
                <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">In Clearing</p>
                  <p className="text-xl font-black tabular-nums text-warning">₱{checkRegister.summary.inClearingTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                  <p className="text-[9px] text-fg/70 mt-0.5">{checkRegister.summary.inClearingCount} with the bank</p>
                </div>
                <div className={`rounded-xl border px-4 py-3 ${checkRegister.summary.bouncedCount > 0 ? 'border-red-500/25 bg-red-500/10' : 'border-white/10 bg-white/5'}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Bounced</p>
                  <p className={`text-xl font-black tabular-nums ${checkRegister.summary.bouncedCount > 0 ? 'text-danger' : 'text-fg/65'}`}>₱{checkRegister.summary.bouncedTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                  <p className="text-[9px] text-fg/70 mt-0.5">{checkRegister.summary.bouncedCount} reversed</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-fg/75 text-[10px] uppercase tracking-widest border-b border-white/10">
                      <th className="text-left py-2.5">Check No.</th>
                      <th className="text-left py-2.5">Bank / Drawer</th>
                      <th className="text-left py-2.5">Client</th>
                      <th className="text-left py-2.5">Invoice</th>
                      <th className="text-left py-2.5">Check Date</th>
                      <th className="text-right py-2.5">Amount</th>
                      <th className="text-left py-2.5 pl-3">Status</th>
                      <th className="text-right py-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkRegister.checks.map(c => (
                      <tr key={c.paymentId} className={`border-b border-white/5 hover:bg-white/5 transition ${c.status === 'Bounced' ? 'bg-red-500/5' : ''}`}>
                        <td className="py-2.5 font-black text-fg tabular-nums">{c.checkNumber}</td>
                        <td className="py-2.5 text-fg/65 text-xs">
                          {c.checkBank || <span className="text-fg/65">-</span>}
                          {c.checkDrawer && <span className="block text-[9px] text-fg/70">{c.checkDrawer}</span>}
                        </td>
                        <td className="py-2.5 text-fg/70 text-xs">{c.client}</td>
                        <td className="py-2.5 text-fg/75 text-xs">{c.orderNumber}{c.groupSize > 1 && <span className="block text-[10px] text-fg/65" title="This check paid several sales. Depositing, clearing or bouncing it does so for all of them.">one check, {c.groupSize} sales</span>}</td>
                        <td className="py-2.5 text-xs">
                          {c.checkDate ? (
                            <span className={c.postDated ? 'text-warning font-bold' : 'text-fg/65'}>
                              {new Date(c.checkDate).toLocaleDateString()}
                            </span>
                          ) : <span className="text-fg/65">-</span>}
                          {c.postDated && <span className="block text-[9px] text-warning">post-dated</span>}
                          {/* A check sitting with the bank for a week+ is
                              worth chasing. */}
                          {c.daysInClearing > 6 && <span className="block text-[9px] text-warning">{c.daysInClearing}d in clearing</span>}
                        </td>
                        <td className="py-2.5 text-right tabular-nums font-black text-fg">₱{c.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                        <td className="py-2.5 pl-3">
                          <span className={`text-[10px] font-black px-2 py-1 rounded ${
                            c.status === 'Cleared' ? 'bg-green-500/15 text-success'
                            : c.status === 'Bounced' ? 'bg-red-500/15 text-danger'
                            : c.status === 'Deposited' ? 'bg-yellow-500/15 text-warning'
                            : 'bg-white/10 text-fg/65'}`}>{c.status}</span>
                          {c.status === 'Bounced' && c.bounceReason && (
                            <span className="block text-[9px] text-danger italic mt-0.5 max-w-[160px]">{c.bounceReason}</span>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="flex gap-1 justify-end">
                            {c.status === 'On Hand' && (
                              <button
                                onClick={() => actOnCheck(c, 'deposit')}
                                disabled={c.postDated}
                                title={c.postDated ? `Cannot be deposited before ${new Date(c.checkDate).toLocaleDateString()}` : 'Mark as handed to the bank'}
                                className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-white/8 text-fg/65 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed min-h-[28px]">
                                Deposit
                              </button>
                            )}
                            {['On Hand', 'Deposited'].includes(c.status) && (
                              <>
                                <button onClick={() => actOnCheck(c, 'clear')} title="The bank honoured it"
                                  className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-green-500/15 text-success hover:bg-green-500/25 min-h-[28px]">
                                  Clear
                                </button>
                                <button onClick={() => actOnCheck(c, 'bounce')} title="Reverses the collection - the invoice reopens"
                                  className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-red-500/10 text-danger hover:bg-red-500/20 min-h-[28px]">
                                  Bounce
                                </button>
                              </>
                            )}
                            {c.status === 'Cleared' && (
                              <button onClick={() => actOnCheck(c, 'bounce')} title="Bank reversed a cleared check"
                                className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-white/5 text-fg/70 hover:bg-red-500/15 hover:text-danger min-h-[28px]">
                                Reverse
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!checkRegister.checks.length && (
                  <div className="py-12 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">
                    {checkFilter ? `No ${checkFilter.toLowerCase()} checks` : 'No checks received yet'}
                  </div>
                )}
              </div>
            </>
          )}
        </div>


      <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-2xl font-black text-fg">Collection Report</h3>
            <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">Payments received against receivables</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <RangePresets value={collRange} onChange={r => setCollRange(p => ({ ...p, ...r }))} onRun={fetchCollectionReport} />
            <div>
              <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">From</label>
              <input type="date" value={collRange.start} onChange={e => setCollRange({ ...collRange, start: e.target.value })}
                className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
            </div>
            <div>
              <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">To</label>
              <input type="date" value={collRange.end} onChange={e => setCollRange({ ...collRange, end: e.target.value })}
                className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
            </div>
            {/* Which date the range is read on. Collection basis = what
                the collectors took in; deposit basis = what reached the
                bank, i.e. the figure that ties to a bank statement. */}
            <div>
              <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Date Basis</label>
              <select value={collRange.basis} onChange={e => setCollRange({ ...collRange, basis: e.target.value })}
                className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60">
                <option value="collection">Collection date</option>
                <option value="deposit">Deposit date</option>
              </select>
            </div>
            <button onClick={fetchCollectionReport}
              className="bg-brand text-on-brand px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
              Run
            </button>
          </div>
        </div>

        {!collectionReport ? (
          <div className="py-16 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">Pick a range and run the report</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Total Collected</p>
                <p className="text-2xl font-black tabular-nums text-success">₱{collectionReport.totalCollected.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Collections</p>
                <p className="text-2xl font-black tabular-nums text-fg">{collectionReport.count}</p>
              </div>
              {/* Money taken in but not yet banked. This gap is exactly
                  where cash goes missing, so it gets its own tile. */}
              <div className={`rounded-xl px-4 py-3 border ${collectionReport.undepositedTotal > 0 ? 'bg-yellow-500/10 border-yellow-500/25' : 'bg-white/5 border-white/10'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Not Yet Deposited</p>
                <p className={`text-2xl font-black tabular-nums ${collectionReport.undepositedTotal > 0 ? 'text-warning' : 'text-fg/65'}`}>₱{collectionReport.undepositedTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              {[
                ['By Client', collectionReport.byClient, 'client'],
                ['By Account', collectionReport.byMethod, 'method'],
                ['By Collector', collectionReport.byCollector, 'collector'],
              ].map(([label, list, key]) => (
                <div key={label} className="bg-page-bg/40 border border-white/10 rounded-xl overflow-hidden">
                  <p className="text-[11px] font-black uppercase tracking-widest text-fg/65 px-4 py-2.5 border-b border-white/10">{label}</p>
                  <table className="w-full text-sm">
                    <tbody>
                      {list.slice(0, 8).map(r => (
                        <tr key={r[key]} className="border-b border-white/5">
                          <td className="py-2 px-4 text-fg/70 truncate max-w-[140px]">{r[key]}</td>
                          <td className="py-2 px-4 text-right tabular-nums font-bold text-fg">₱{r.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                      {!list.length && <tr><td className="py-4 px-4 text-fg/65 text-xs">None</td></tr>}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-fg/75 text-[10px] uppercase tracking-widest border-b border-white/10">
                    <th className="text-left py-2.5">Collected</th>
                    <th className="text-left py-2.5">Deposited</th>
                    <th className="text-left py-2.5">Invoice</th>
                    <th className="text-left py-2.5">Client</th>
                    <th className="text-left py-2.5">To</th>
                    <th className="text-left py-2.5">Reference</th>
                    <th className="text-right py-2.5">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {collectionReport.collections.map((r, idx) => (
                    <tr key={`${r.orderId}-${idx}`} className="border-b border-white/5 hover:bg-white/5 transition">
                      <td className="py-2.5 text-fg/70 text-xs">
                        {new Date(r.collectionDate).toLocaleDateString()}
                        {r.collectedBy && <span className="block text-[9px] text-fg/70">by {r.collectedBy}</span>}
                      </td>
                      <td className="py-2.5 text-xs">
                        {r.depositDate
                          ? <span className="text-fg/70">{new Date(r.depositDate).toLocaleDateString()}</span>
                          : <span className="text-[10px] font-black px-2 py-1 rounded bg-yellow-500/15 text-warning">IN TRANSIT</span>}
                        {r.floatDays > 0 && <span className="block text-[9px] text-warning">+{r.floatDays}d float</span>}
                      </td>
                      <td className="py-2.5 text-fg font-bold">{r.orderNumber}</td>
                      <td className="py-2.5 text-fg/70">{r.client}</td>
                      <td className="py-2.5"><span className="text-[10px] font-black uppercase tracking-wider bg-brand/15 text-brand-text px-2 py-1 rounded">{r.depositedTo || '-'}</span></td>
                      <td className="py-2.5 text-fg/75 text-xs">
                        {r.referenceNumber || <span className="text-fg/65">-</span>}
                        {r.note && <span className="block text-[9px] text-fg/65 italic">{r.note}</span>}
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-black text-success">₱{r.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!collectionReport.collections.length && <div className="py-16 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">No collections in this range</div>}
            </div>
          </>
        )}
      </div>
      </div>
    )}
    </>
  );
}
