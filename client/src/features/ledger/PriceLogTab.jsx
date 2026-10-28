import { ShieldCheck } from 'lucide-react';
import * as ui from '../../shared/ui';
import RangePresets from '../../shared/RangePresets';

import PagedRows from '../../shared/PagedRows';
// The price change log.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function PriceLogTab({
  ledgerSubTab, changeRequests, canApprovePricing, CR_ENTITY, crValue, MONEY_FIELDS, actOnChangeRequest, priceLogRange,
  setPriceLogRange, fetchPriceChangeLog, priceChangeLog,
}) {
  return (
    <>
    {ledgerSubTab === 'pricelog' && (
      <div className="space-y-4 animate-fade-in">

        {/* ── Awaiting approval ── */}
        {changeRequests?.length > 0 && (
          <div className="bg-surface border border-yellow-500/25 rounded-2xl p-6 space-y-3">
            <div>
              <h3 className="text-xl font-black text-fg flex items-center gap-2">
                <ShieldCheck size={18} className="text-warning" />
                {changeRequests.length} Change{changeRequests.length === 1 ? '' : 's'} Awaiting Approval
              </h3>
              <p className="text-fg/70 text-[11px] mt-0.5">
                {canApprovePricing
                  ? 'These are not in effect yet. Approving applies the new value immediately.'
                  : 'Your requests. Someone with approval rights has to sign these off.'}
              </p>
            </div>
            <div className="space-y-2">
              {changeRequests.map(r => (
                <div key={r._id} className="bg-page-bg/50 border border-white/10 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-fg font-bold text-sm"><span className="text-[10px] text-fg/65 uppercase tracking-wider mr-1.5">{CR_ENTITY[r.entity] || r.entity}</span>{r.entityName || r.entityId}</p>
                      {r.changes.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 font-mono text-xs mt-0.5 flex-wrap">
                          <span className="text-fg/75">{c.label}</span>
                          <span className="text-fg/70 line-through">{crValue(c.field, c.oldValue)}</span>
                          <span className="text-fg/65">→</span>
                          <span className={`font-black ${MONEY_FIELDS.has(c.field) ? (Number(c.newValue) > Number(c.oldValue) ? 'text-danger' : 'text-success') : 'text-fg'}`}>
                            {crValue(c.field, c.newValue)}
                          </span>
                        </div>
                      ))}
                      <p className="text-[10px] text-fg/70 mt-1">
                        by {r.requestedBy || 'someone'} · {new Date(r.createdAt).toLocaleDateString()}
                        {r.reason && <span className="italic"> · "{r.reason}"</span>}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {canApprovePricing ? (
                        <>
                          <button onClick={() => actOnChangeRequest(r._id, 'approve')}
                            className="bg-brand text-on-brand px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition min-h-[36px]">
                            Approve
                          </button>
                          <button onClick={async () => {
                            const reason = await ui.confirm({
                              title: 'Reject this change?',
                              message: `${r.entityName}: ${r.changes.map(c => `${c.label} → ${crValue(c.field, c.newValue)}`).join(', ')}. It stays as it is.`,
                              confirmLabel: 'Reject', tone: 'danger',
                            });
                            if (reason) actOnChangeRequest(r._id, 'reject', 'Rejected by approver');
                          }}
                            className="bg-red-500/10 text-danger px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-red-500/20 transition min-h-[36px]">
                            Reject
                          </button>
                        </>
                      ) : (
                        <button onClick={() => actOnChangeRequest(r._id, 'withdraw')}
                          className="bg-white/5 text-fg/75 px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-white/10 transition min-h-[36px]">
                          Withdraw
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Applied changes ── */}
        <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
            <div>
              <h3 className="text-2xl font-black text-fg">Price Change Log</h3>
              <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">Every price &amp; cost change, and who signed it off</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <RangePresets value={priceLogRange} onChange={r => setPriceLogRange(p => ({ ...p, ...r }))} onRun={fetchPriceChangeLog} />
              <div>
                <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">From</label>
                <input type="date" value={priceLogRange.start} onChange={e => setPriceLogRange({ ...priceLogRange, start: e.target.value })}
                  className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
              </div>
              <div>
                <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">To</label>
                <input type="date" value={priceLogRange.end} onChange={e => setPriceLogRange({ ...priceLogRange, end: e.target.value })}
                  className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
              </div>
              <button onClick={fetchPriceChangeLog}
                className="bg-brand text-on-brand px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
                Run
              </button>
            </div>
          </div>

          {!priceChangeLog ? (
            <div className="py-16 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">Pick a range and run the log</div>
          ) : (
            <>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Changes</p>
                  <p className="text-xl font-black tabular-nums text-fg">{priceChangeLog.summary.total}</p>
                  <p className="text-[9px] text-fg/70 mt-0.5">{priceChangeLog.summary.priceChanges} price · {priceChangeLog.summary.costChanges} cost</p>
                </div>
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Increases</p>
                  <p className="text-xl font-black tabular-nums text-danger">{priceChangeLog.summary.increases}</p>
                  {priceChangeLog.summary.largestIncrease && (
                    <p className="text-[9px] text-fg/70 mt-0.5 truncate">
                      max +{priceChangeLog.summary.largestIncrease.percent}% · {priceChangeLog.summary.largestIncrease.productName}
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Decreases</p>
                  <p className="text-xl font-black tabular-nums text-success">{priceChangeLog.summary.decreases}</p>
                  {priceChangeLog.summary.largestDecrease && (
                    <p className="text-[9px] text-fg/70 mt-0.5 truncate">
                      max {priceChangeLog.summary.largestDecrease.percent}% · {priceChangeLog.summary.largestDecrease.productName}
                    </p>
                  )}
                </div>
                {/* How many went through review rather than straight in -
                    the number that says whether the gate is doing anything. */}
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Reviewed</p>
                  <p className="text-xl font-black tabular-nums text-fg/70">{priceChangeLog.summary.viaApproval}</p>
                  <p className="text-[9px] text-fg/70 mt-0.5">{priceChangeLog.summary.pendingCount} still pending</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-fg/75 text-[10px] uppercase tracking-widest border-b border-white/10">
                      <th className="text-left py-2.5">When</th>
                      <th className="text-left py-2.5">Product</th>
                      <th className="text-left py-2.5">Type</th>
                      <th className="text-right py-2.5">From</th>
                      <th className="text-right py-2.5">To</th>
                      <th className="text-right py-2.5">Move</th>
                      <th className="text-left py-2.5 pl-3">Who</th>
                      <th className="text-left py-2.5">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    <PagedRows items={priceChangeLog.changes} label="changes" render={(c, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="py-2.5 text-fg/75 text-xs">{new Date(c.date).toLocaleDateString()}</td>
                        <td className="py-2.5 text-fg font-bold text-xs">
                          {c.productName}
                          {c.productCode && <span className="block text-[9px] text-fg/65">{c.productCode}</span>}
                        </td>
                        <td className="py-2.5">
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${c.type === 'price' ? 'bg-brand/20 text-brand-text' : 'bg-orange-500/20 text-warning'}`}>
                            {c.type === 'price' ? 'Price' : 'Cost'}
                          </span>
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-fg/70">₱{Number(c.oldValue || 0).toFixed(2)}</td>
                        <td className="py-2.5 text-right tabular-nums font-black text-fg">₱{Number(c.newValue || 0).toFixed(2)}</td>
                        <td className={`py-2.5 text-right tabular-nums font-bold ${c.delta > 0 ? 'text-danger' : c.delta < 0 ? 'text-success' : 'text-fg/65'}`}>
                          {c.percent === null ? '-' : `${c.percent > 0 ? '+' : ''}${c.percent}%`}
                        </td>
                        <td className="py-2.5 pl-3 text-xs">
                          {c.viaApproval ? (
                            <>
                              <span className="text-fg/70">{c.requestedBy || '-'}</span>
                              <span className="block text-[9px] text-success">approved by {c.approvedBy || '-'}</span>
                            </>
                          ) : (
                            <span className="text-fg/70">{c.changedBy || '-'}</span>
                          )}
                        </td>
                        <td className="py-2.5 text-fg/70 text-xs italic max-w-[200px] truncate" title={c.reason}>{c.reason || '-'}</td>
                      </tr>
                    )} />
                  </tbody>
                </table>
                {!priceChangeLog.changes.length && (
                  <div className="py-16 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">No price changes in this range</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}
