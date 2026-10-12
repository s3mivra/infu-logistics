import RangePresets from '../../shared/RangePresets';

// Payments made to suppliers.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function SupplierPaymentsTab({
  ledgerSubTab, supPayRange, setSupPayRange, fetchSupplierPayments, supplierPayments,
}) {
  return (
    <>
    {ledgerSubTab === 'supplierpay' && (
      <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
        <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-2xl font-black text-fg">Supplier Payments</h3>
            <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">What we actually paid out, and from which account</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <RangePresets value={supPayRange} onChange={r => setSupPayRange(p => ({ ...p, ...r }))} onRun={fetchSupplierPayments} />
            <div>
              <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">From</label>
              <input type="date" value={supPayRange.start} onChange={e => setSupPayRange({ ...supPayRange, start: e.target.value })}
                className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
            </div>
            <div>
              <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">To</label>
              <input type="date" value={supPayRange.end} onChange={e => setSupPayRange({ ...supPayRange, end: e.target.value })}
                className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
            </div>
            <button onClick={fetchSupplierPayments}
              className="bg-brand text-on-brand px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
              Run
            </button>
          </div>
        </div>

        {!supplierPayments ? (
          <div className="py-16 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">Pick a range and run the report</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Total Paid Out</p>
                <p className="text-2xl font-black tabular-nums text-danger">₱{supplierPayments.totalPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">Payments</p>
                <p className="text-2xl font-black tabular-nums text-fg">{supplierPayments.count}</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              {[
                ['By Supplier', supplierPayments.bySupplier, 'supplier'],
                ['By Account Paid From', supplierPayments.byAccount, 'account'],
              ].map(([label, list, key]) => (
                <div key={label} className="bg-page-bg/40 border border-white/10 rounded-xl overflow-hidden">
                  <p className="text-[11px] font-black uppercase tracking-widest text-fg/65 px-4 py-2.5 border-b border-white/10">{label}</p>
                  <table className="w-full text-sm">
                    <tbody>
                      {list.slice(0, 10).map(r => (
                        <tr key={r[key]} className="border-b border-white/5">
                          <td className="py-2 px-4 text-fg/70 truncate max-w-[180px]">{r[key]}</td>
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
                    <th className="text-left py-2.5">Date</th>
                    <th className="text-left py-2.5">Supplier</th>
                    <th className="text-left py-2.5">Reference</th>
                    <th className="text-left py-2.5">Paid From</th>
                    <th className="text-right py-2.5">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierPayments.payments.map((p, i) => (
                    <tr key={`${p.reference}-${i}`} className="border-b border-white/5 hover:bg-white/5 transition">
                      <td className="py-2.5 text-fg/75 text-xs">{new Date(p.date).toLocaleDateString()}</td>
                      <td className="py-2.5 text-fg/70 text-xs">{p.supplier}</td>
                      <td className="py-2.5 text-fg/75 text-xs">
                        {p.reference || '-'}
                        {p.description && <span className="block text-[9px] text-fg/65 italic max-w-[240px] truncate" title={p.description}>{p.description}</span>}
                      </td>
                      <td className="py-2.5"><span className="text-[10px] font-black uppercase tracking-wider bg-brand/15 text-brand-text px-2 py-1 rounded">{p.paidFrom || '-'}</span></td>
                      <td className="py-2.5 text-right tabular-nums font-black text-danger">₱{p.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!supplierPayments.payments.length && <div className="py-16 text-center text-fg/75 font-bold uppercase tracking-widest text-sm">No supplier payments in this range</div>}
            </div>
          </>
        )}
      </div>
    )}
    </>
  );
}
