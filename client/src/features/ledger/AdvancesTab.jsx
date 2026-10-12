import { Plus, Check, Receipt, HandCoins } from 'lucide-react';
import SearchSelect from '../../shared/ui/SearchSelect';
import RangePresets from '../../shared/RangePresets';

// Advances to suppliers and from customers.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function AdvancesTab({
  ledgerSubTab, setAdvIssueModal, ADV_ISSUE_BLANK, peso, advTotals, advFilter, setAdvFilter, fetchAdvances,
  advances, openAdvLiquidate, setAdvCancelModal, advIssueModal, suppliers, fetchSuppliers, clientAccounts, cashAndBankAccounts,
  advBusy, submitIssueAdvance, advLiqModal, setAdvLiqModal, expenseAccounts, bills, arOutstanding, submitLiquidateAdvance,
  advCancelModal, submitCancelAdvance,
}) {
  return (
    <>
    {ledgerSubTab === 'advances' && (
      <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-5 animate-fade-in">
        <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-black text-fg">Advances</h3>
            <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">
              Money moved before the transaction it belongs to
            </p>
          </div>
          <button onClick={() => setAdvIssueModal({ ...ADV_ISSUE_BLANK })}
            className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-on-brand px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition min-h-[40px]">
            <Plus size={14} /> New Advance
          </button>
        </div>

        {/* Issued vs still-open, the two numbers that actually matter */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-page-bg border border-white/10 rounded-xl p-4">
            <p className="text-[10px] text-fg/70 font-bold uppercase tracking-widest mb-1">Total Issued</p>
            <p className="text-2xl font-black tabular-nums text-fg">{peso(advTotals.totalIssued)}</p>
            <p className="text-[10px] text-fg/70 mt-1">Excludes cancelled</p>
          </div>
          <div className="bg-page-bg border border-white/10 rounded-xl p-4">
            <p className="text-[10px] text-fg/70 font-bold uppercase tracking-widest mb-1">Still Outstanding</p>
            <p className={`text-2xl font-black tabular-nums ${advTotals.totalOutstanding > 0 ? 'text-warning' : 'text-success'}`}>
              {peso(advTotals.totalOutstanding)}
            </p>
            <p className="text-[10px] text-fg/70 mt-1">Not yet liquidated</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">Type</label>
            <select value={advFilter.type} onChange={e => setAdvFilter(f => ({ ...f, type: e.target.value }))}
              className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand">
              <option value="">All</option>
              <option value="employee">Employee</option>
              <option value="supplier">Supplier</option>
              <option value="customer">Customer deposit</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">Status</label>
            <select value={advFilter.status} onChange={e => setAdvFilter(f => ({ ...f, status: e.target.value }))}
              className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand">
              <option value="">All</option>
              <option value="Open">Open</option>
              <option value="Partially Liquidated">Partially Liquidated</option>
              <option value="Liquidated">Liquidated</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
          <RangePresets value={advFilter} onChange={r => setAdvFilter(p => ({ ...p, ...r }))} onRun={fetchAdvances} />
          <div>
            <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">From</label>
            <input type="date" value={advFilter.start} onChange={e => setAdvFilter(f => ({ ...f, start: e.target.value }))}
              className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
          </div>
          <div>
            <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">To</label>
            <input type="date" value={advFilter.end} onChange={e => setAdvFilter(f => ({ ...f, end: e.target.value }))}
              className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
          </div>
          <button onClick={fetchAdvances}
            className="border border-white/15 text-fg px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-white/5 transition min-h-[38px]">
            Apply
          </button>
        </div>

        {!advances ? (
          <div className="py-16 text-center text-fg/70 font-bold uppercase tracking-widest text-sm">Loading…</div>
        ) : advances.length === 0 ? (
          <div className="py-16 text-center">
            <HandCoins size={28} className="mx-auto text-fg/65 mb-3" />
            <p className="text-fg/75 font-bold uppercase tracking-widest text-sm">No advances yet</p>
            <p className="text-fg/65 text-xs mt-1">Cash floats, supplier prepayments and customer deposits show up here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg/75 text-[10px] uppercase tracking-widest border-b border-white/10">
                  <th className="text-left py-2.5">Number</th>
                  <th className="text-left py-2.5">Type</th>
                  <th className="text-left py-2.5">Payee</th>
                  <th className="text-left py-2.5">Purpose</th>
                  <th className="text-left py-2.5">Date</th>
                  <th className="text-right py-2.5">Amount</th>
                  <th className="text-right py-2.5">Outstanding</th>
                  <th className="text-left py-2.5 pl-3">Status</th>
                  <th className="text-right py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {advances.map(a => {
                  const typeCls = {
                    employee: 'bg-blue-500/15 text-info',
                    supplier: 'bg-purple-500/15 text-special',
                    customer: 'bg-teal-500/15 text-mint',
                  }[a.type];
                  const stCls = {
                    'Open': 'bg-amber-500/15 text-warning',
                    'Partially Liquidated': 'bg-orange-500/15 text-warning',
                    'Liquidated': 'bg-green-500/15 text-success',
                    'Cancelled': 'bg-white/10 text-fg/70',
                  }[a.status];
                  const done = a.status === 'Liquidated' || a.status === 'Cancelled';
                  return (
                    <tr key={a._id} className={`border-b border-white/5 hover:bg-white/5 transition ${a.status === 'Cancelled' ? 'opacity-50' : ''}`}>
                      <td className="py-2.5 font-bold text-fg text-xs">
                        {a.advanceNumber}
                        {a.branchCode && <span className="block text-[9px] text-fg/65 font-normal font-mono">{a.branchCode}</span>}
                        {a.checkVoucherRef && <span className="block text-[9px] text-fg/65 font-normal">CV {a.checkVoucherRef}</span>}
                      </td>
                      <td className="py-2.5">
                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded ${typeCls}`}>{a.type}</span>
                      </td>
                      <td className="py-2.5 text-fg/70 text-xs">{a.payeeName}{a.clientId && <span className="block text-[9px] text-fg/65">client account</span>}</td>
                      <td className="py-2.5 text-fg/70 text-xs max-w-[180px] truncate" title={a.purpose || ''}>{a.purpose || '-'}</td>
                      <td className="py-2.5 text-fg/75 text-xs">{new Date(a.date).toLocaleDateString()}</td>
                      <td className="py-2.5 text-right tabular-nums text-fg/70">{peso(a.amount)}</td>
                      <td className={`py-2.5 text-right tabular-nums font-black ${a.outstanding > 0 ? 'text-warning' : 'text-fg/65'}`}>
                        {a.outstanding > 0 ? peso(a.outstanding) : '-'}
                      </td>
                      <td className="py-2.5 pl-3">
                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded whitespace-nowrap ${stCls}`}
                          title={a.status === 'Cancelled' ? (a.cancelReason || '') : ''}>
                          {a.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        {!done && (
                          <div className="flex flex-col items-end gap-1">
                            <button onClick={() => openAdvLiquidate(a)}
                              className="bg-brand text-on-brand px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition whitespace-nowrap">
                              Liquidate
                            </button>
                            {/* Cancelling is only honest while nothing has
                                been cleared - after that the server sends
                                you to a cash return instead. */}
                            {a.status === 'Open' && (
                              <button onClick={() => setAdvCancelModal({ advance: a, reason: '' })}
                                className="border border-red-500/30 text-danger px-3 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-red-500/10 transition">
                                Cancel
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Issue modal ── */}
        {advIssueModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setAdvIssueModal(null)}>
            <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="font-black text-fg text-lg mb-1">New Advance</h2>
              <p className="text-xs text-fg/75 mb-4">
                {advIssueModal.type === 'customer'
                  ? 'A deposit received from a customer. Cash comes in and we owe them goods or services.'
                  : 'Cash goes out now against something that has not been billed yet. A Check Voucher is issued automatically.'}
              </p>

              <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Type</label>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[['employee', 'Employee'], ['supplier', 'Supplier'], ['customer', 'Customer']].map(([v, label]) => (
                  <button key={v} onClick={() => { setAdvIssueModal(f => ({ ...f, type: v, payeeId: '', ...(v !== 'customer' ? { clientId: '' } : {}) })); if (v === 'supplier' && !(suppliers || []).length) fetchSuppliers?.(); }}
                    className={`px-2 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition ${
                      advIssueModal.type === v ? 'bg-brand text-on-brand' : 'bg-white/5 text-fg/75 hover:text-fg'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {advIssueModal.type === 'customer' && (clientAccounts || []).length > 0 && (
                <>
                  <label htmlFor="adv-client" className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Client account</label>
                  <SearchSelect id="adv-client" value={advIssueModal.clientId || ''}
                    onChange={e => {
                      const c = clientAccounts.find(x => String(x._id) === e.target.value);
                      setAdvIssueModal(f => ({ ...f, clientId: e.target.value, payeeName: c ? (c.name || c.username) : f.payeeName }));
                    }}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-1 outline-none focus:border-brand"
                    placeholder="No account - type a name below"
                    options={clientAccounts.map(c => ({ value: c._id, label: c.name || c.username, hint: c.clientCode || '' }))} />
                  <p className="text-[10px] text-fg/65 mb-4">Linked deposits show on the client's row and in their portal, and can only be applied to their orders.</p>
                </>
              )}

              <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">
                {advIssueModal.type === 'customer' ? 'Customer' : advIssueModal.type === 'supplier' ? 'Supplier' : 'Employee'} name
              </label>
              <input type="text" value={advIssueModal.payeeName} autoFocus disabled={!!advIssueModal.clientId}
                onChange={e => setAdvIssueModal(f => ({ ...f, payeeName: e.target.value, payeeId: '' }))}
                onFocus={() => { if (advIssueModal.type === 'supplier' && !(suppliers || []).length) fetchSuppliers?.(); }}
                placeholder="Who is this for?"
                className={`w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg outline-none focus:border-brand ${advIssueModal.type === 'supplier' ? 'mb-1' : 'mb-4'}`} />
              {/* A supplier already on file: offered as the name is typed, so
                  the advance goes to that supplier rather than to a second,
                  slightly different spelling of them. */}
              {advIssueModal.type === 'supplier' && (() => {
                const typed = advIssueModal.payeeName.trim().toLowerCase();
                const exact = typed && (suppliers || []).find(s => String(s.name || '').trim().toLowerCase() === typed);
                const picked = advIssueModal.payeeId && (suppliers || []).find(s => String(s._id) === String(advIssueModal.payeeId));
                const near = typed && !picked ? (suppliers || []).filter(s => String(s.name || '').toLowerCase().includes(typed)).slice(0, 6) : [];
                return (
                  <div className="mb-4">
                    {picked || exact ? (
                      <p className="text-[11px] text-success font-bold">Existing supplier: {(picked || exact).name}</p>
                    ) : near.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] text-fg/70 font-bold uppercase tracking-widest self-center">Already on file:</span>
                        {near.map(s => (
                          <button type="button" key={s._id} onClick={() => setAdvIssueModal(f => ({ ...f, payeeName: s.name, payeeId: String(s._id) }))}
                            className="px-2 py-1 rounded-lg bg-brand/15 border border-brand/30 text-brand-text text-[11px] font-bold hover:bg-brand/25">{s.name}</button>
                        ))}
                      </div>
                    ) : typed ? (
                      <p className="text-[11px] text-fg/65">No supplier with this name on file - it will be recorded under the name as typed.</p>
                    ) : null}
                  </div>
                );
              })()}

              <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Amount</label>
              <input type="number" step="0.01" min="0" value={advIssueModal.amount}
                onChange={e => setAdvIssueModal(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

              <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">
                {advIssueModal.type === 'customer' ? 'Deposit into' : 'Pay from'}
              </label>
              <select value={advIssueModal.sourceAccount}
                onChange={e => setAdvIssueModal(f => ({ ...f, sourceAccount: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand">
                {(cashAndBankAccounts || []).map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
              </select>

              <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Date of Transaction</label>
              <input type="date" value={advIssueModal.date}
                onChange={e => setAdvIssueModal(f => ({ ...f, date: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-1 outline-none focus:border-brand" />
              <p className="text-[10px] text-fg/65 mb-4">When the money actually moved. Leave blank for today.</p>

              <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Reference No.</label>
              <input type="text" value={advIssueModal.referenceNumber}
                onChange={e => setAdvIssueModal(f => ({ ...f, referenceNumber: e.target.value }))}
                placeholder="OR no., check no., deposit slip..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

              <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Purpose / Remarks</label>
              <textarea value={advIssueModal.purpose} rows={2}
                onChange={e => setAdvIssueModal(f => ({ ...f, purpose: e.target.value }))}
                placeholder="e.g. fuel float for the week"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-5 outline-none focus:border-brand" />

              <div className="flex gap-3">
                <button onClick={() => setAdvIssueModal(null)} disabled={advBusy}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-fg/75 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">
                  Cancel
                </button>
                <button onClick={submitIssueAdvance} disabled={advBusy}
                  className="flex-1 bg-brand hover:bg-brand-dark text-on-brand font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50">
                  {advBusy ? 'Recording…' : 'Issue Advance'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Liquidate modal ── */}
        {advLiqModal && (() => {
          const a = advLiqModal.advance;
          const methods = a.type === 'customer'
            ? [['order', 'Apply to an order'], ['cash-return', 'Refund the cash']]
            : [['expense', 'Spent on an expense'], ['bill', 'Apply to a bill'], ['cash-return', 'Cash returned']];
          const entered = parseFloat(advLiqModal.amount) || 0;
          const over = entered > a.outstanding + 0.01;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setAdvLiqModal(null)}>
              <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <h2 className="font-black text-fg text-lg mb-1">Liquidate {a.advanceNumber}</h2>
                <p className="text-xs text-fg/75 mb-4">
                  {a.payeeName} · {peso(a.outstanding)} of {peso(a.amount)} still open
                </p>

                <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">How was it cleared?</label>
                <div className="space-y-1.5 mb-4">
                  {methods.map(([v, label]) => (
                    <button key={v} onClick={() => setAdvLiqModal(f => ({ ...f, method: v }))}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold transition border ${
                        advLiqModal.method === v
                          ? 'bg-brand/15 border-brand/50 text-fg'
                          : 'bg-white/5 border-white/10 text-fg/75 hover:text-fg'}`}>
                      {label}
                    </button>
                  ))}
                </div>

                <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Amount</label>
                <input type="number" step="0.01" min="0" value={advLiqModal.amount}
                  onChange={e => setAdvLiqModal(f => ({ ...f, amount: e.target.value }))}
                  className={`w-full bg-white/5 border rounded-lg px-3 py-2.5 text-sm text-fg mb-1 outline-none ${
                    over ? 'border-red-500/60' : 'border-white/10 focus:border-brand'}`} />
                {over
                  ? <p className="text-[11px] text-danger mb-3">Exceeds the {peso(a.outstanding)} still open on this advance.</p>
                  : <p className="text-[11px] text-fg/65 mb-3">Leave as-is to clear the full remaining balance.</p>}

                {advLiqModal.method === 'expense' && (
                  <>
                    <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Expense account</label>
                    <select value={advLiqModal.expenseAccount}
                      onChange={e => setAdvLiqModal(f => ({ ...f, expenseAccount: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand">
                      <option value="">Select what it was spent on…</option>
                      {(expenseAccounts || []).map(x => <option key={x.code} value={x.code}>{x.code} - {x.name}</option>)}
                    </select>
                  </>
                )}

                {advLiqModal.method === 'cash-return' && (
                  <>
                    <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Returned into</label>
                    <select value={advLiqModal.returnToAccount}
                      onChange={e => setAdvLiqModal(f => ({ ...f, returnToAccount: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand">
                      {(cashAndBankAccounts || []).map(x => <option key={x.code} value={x.code}>{x.code} - {x.name}</option>)}
                    </select>
                  </>
                )}

                {advLiqModal.method === 'bill' && (() => {
                  // Only a bill that can still take money is a valid
                  // target; anything Paid or Rejected would just error.
                  const payable = (bills || []).filter(b => ['Approved', 'Partially Paid'].includes(b.status));
                  return (
                    <>
                      <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Bill to settle</label>
                      {payable.length === 0 ? (
                        <p className="text-[11px] text-warning bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 mb-4">
                          No approved or partially paid bills to apply this against.
                        </p>
                      ) : (
                        <select value={advLiqModal.billId}
                          onChange={e => setAdvLiqModal(f => ({ ...f, billId: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand">
                          <option value="">Select a bill…</option>
                          {payable.map(b => (
                            <option key={b._id} value={b._id}>
                              {b.billNumber} · {b.supplierName} · {peso(b.amount - (b.paidAmount || 0))} left
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  );
                })()}

                {advLiqModal.method === 'order' && (() => {
                  // A deposit linked to a client can only be applied to that client's orders.
                  const open = (arOutstanding?.orders || []).filter(o =>
                    !advLiqModal.advance.clientId || String(o.clientId || o.clientAccountId || '') === advLiqModal.advance.clientId);
                  return (
                    <>
                      <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Order to apply to</label>
                      {open.length === 0 ? (
                        <p className="text-[11px] text-warning bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 mb-4">
                          No outstanding receivables to apply this deposit against.
                        </p>
                      ) : (
                        <select value={advLiqModal.orderId}
                          onChange={e => setAdvLiqModal(f => ({ ...f, orderId: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand">
                          <option value="">Select an order…</option>
                          {open.map(o => (
                            <option key={o._id} value={o._id}>
                              {o.orderNumber} · {o.customerName} · {peso(o.balance ?? o.total)} due
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  );
                })()}

                <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Date of Transaction</label>
                <input type="date" value={advLiqModal.date || ''}
                  onChange={e => setAdvLiqModal(f => ({ ...f, date: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

                <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Reference No.</label>
                <input type="text" value={advLiqModal.referenceNumber}
                  onChange={e => setAdvLiqModal(f => ({ ...f, referenceNumber: e.target.value }))}
                  placeholder="Receipt no., OR no., txn ref..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

                <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Remarks</label>
                <textarea value={advLiqModal.note} rows={2}
                  onChange={e => setAdvLiqModal(f => ({ ...f, note: e.target.value }))}
                  placeholder="What this covers"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-5 outline-none focus:border-brand" />

                <div className="flex gap-3">
                  <button onClick={() => setAdvLiqModal(null)} disabled={advBusy}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-fg/75 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">
                    Cancel
                  </button>
                  <button onClick={submitLiquidateAdvance} disabled={advBusy || over}
                    className="flex-1 bg-brand hover:bg-brand-dark text-on-brand font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50">
                    {advBusy ? 'Posting…' : 'Liquidate'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Cancel modal ── */}
        {advCancelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setAdvCancelModal(null)}>
            <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
              <h2 className="font-black text-fg mb-1">Cancel {advCancelModal.advance.advanceNumber}</h2>
              <p className="text-xs text-fg/75 mb-3">
                {peso(advCancelModal.advance.amount)} · {advCancelModal.advance.payeeName}
              </p>
              <div className="text-[11px] text-warning bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 mb-3">
                This posts a reversal of the original entry. Only possible because nothing has been
                liquidated yet.
              </div>
              <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">Reason (required)</label>
              <textarea value={advCancelModal.reason} rows={3}
                onChange={e => setAdvCancelModal(m => ({ ...m, reason: e.target.value }))}
                placeholder="e.g. issued twice by mistake"
                className="w-full bg-page-bg border border-white/10 rounded-lg p-2.5 text-fg text-sm outline-none focus:border-brand" />
              <div className="flex gap-2 mt-4">
                <button onClick={() => setAdvCancelModal(null)} disabled={advBusy}
                  className="flex-1 border border-white/15 text-fg/70 px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-white/5 transition">
                  Keep
                </button>
                <button onClick={submitCancelAdvance} disabled={advBusy || !advCancelModal.reason.trim()}
                  className="flex-1 bg-red-700 text-white px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-red-500/90 transition disabled:opacity-40">
                  {advBusy ? 'Cancelling…' : 'Cancel Advance'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )}
    </>
  );
}
