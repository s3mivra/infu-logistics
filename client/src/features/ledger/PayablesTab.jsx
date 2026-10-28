import { X, FileText, AlertTriangle, Download, CreditCard, Truck } from 'lucide-react';
import Pager from '../../shared/Pager';
import SearchSelect from '../../shared/ui/SearchSelect';

import PagedRows from '../../shared/PagedRows';
// Accounts payable: what is owed to suppliers.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function PayablesTab({
  ledgerSubTab, apData, exportApPDF, setApPayModal, apPayModal, apPayForm, setApPayForm, cashAndBankAccounts,
  suppliers, submitApPayment, apPaySubmitting, apCreditEntries, agingBuckets, apPage,
}) {
  return (
    <>
    {(ledgerSubTab === 'ap' || ledgerSubTab === 'araap') && (
      <div className="space-y-6 animate-fade-in">
        {/* Summary KPI bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-surface border border-white/10 rounded-xl p-5">
            <p className="text-[10px] text-fg/70 font-bold uppercase tracking-widest mb-1">Outstanding A/P Balance</p>
            <p className={`text-2xl font-black tabular-nums ${apData?.outstandingBalance > 0 ? 'text-danger' : 'text-success'}`}>
              ₱{(apData?.outstandingBalance || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-fg/65 mt-1">Total owed to suppliers</p>
          </div>
          <div className="bg-surface border border-white/10 rounded-xl p-5">
            <p className="text-[10px] text-fg/70 font-bold uppercase tracking-widest mb-1">Total Purchased on Credit</p>
            <p className="text-xl font-black text-fg/80 tabular-nums">₱{(apData?.totalCredit || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="bg-surface border border-white/10 rounded-xl p-5">
            <p className="text-[10px] text-fg/70 font-bold uppercase tracking-widest mb-1">Total Payments Made</p>
            <p className="text-xl font-black text-success tabular-nums">₱{(apData?.totalDebit || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>

        {/* Pay AP button */}
        <div className="flex justify-end gap-2">
          {apData && <button onClick={exportApPDF} className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
          {apData?.outstandingBalance > 0 && (
            <button onClick={() => setApPayModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition shadow-elev-1">
              <CreditCard size={15}/> Record Supplier Payment
            </button>
          )}
        </div>

        {/* Pay AP modal */}
        {apPayModal && (
          <div className="fixed inset-0 z-[9998] bg-black/85 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-sm shadow-elev-3 flex flex-col max-h-[90vh] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <h2 className="text-fg font-black text-lg">Record A/P Payment</h2>
                <button onClick={() => setApPayModal(false)} className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-fg/75 flex items-center justify-center transition"><X size={14}/></button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                <div className="bg-brand/10 border border-brand/20 rounded-xl px-4 py-3 text-xs text-brand-text font-bold">
                  Outstanding: ₱{(apData?.outstandingBalance || 0).toFixed(2)} · Journal: DR 2000 A/P / CR Cash
                </div>
                <div>
                  <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Amount (₱) *</label>
                  <input type="number" min="0" step="0.01" value={apPayForm.amount}
                    onChange={e => setApPayForm(p => ({...p, amount: e.target.value}))}
                    className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg text-xl font-black tabular-nums outline-none focus:border-brand/60" />
                </div>
                <div>
                  <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Pay From *</label>
                  <select value={apPayForm.payFromAccount} onChange={e => setApPayForm(p => ({...p, payFromAccount: e.target.value}))}
                    className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-brand/60">
                    {(cashAndBankAccounts || []).map(a => (
                      <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Supplier</label>
                  <SearchSelect value={apPayForm.supplierId || ''}
                    onChange={e => {
                      const id = e.target.value;
                      const owed = (apData?.bySupplier || []).find(s => s.supplierId === id);
                      // Prefill the amount with what this supplier is owed -
                      // paying a balance in full is the common case.
                      setApPayForm(p => ({
                        ...p, supplierId: id,
                        amount: owed ? String(owed.balance) : p.amount,
                      }));
                    }}
                    className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-brand/60"
                    placeholder="Other / one-off payee - or type to find a supplier"
                    options={(suppliers || []).map(s => {
                      const owed = (apData?.bySupplier || []).find(b => b.supplierId === String(s._id));
                      return { value: s._id, label: s.name, hint: owed ? `₱${owed.balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })} owed` : '' };
                    })} />
                </div>
                {!apPayForm.supplierId && (
                  <div>
                    <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Payee Name</label>
                    <input type="text" placeholder="e.g. one-off hauler" value={apPayForm.vendorName}
                      onChange={e => setApPayForm(p => ({...p, vendorName: e.target.value}))}
                      className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-brand/60 placeholder-fg/70" />
                    <p className="text-[10px] text60 mt-1">Payments without a supplier record group under “Unattributed”.</p>
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Description</label>
                  <input type="text" placeholder="e.g. Weekly supply payment" value={apPayForm.description}
                    onChange={e => setApPayForm(p => ({...p, description: e.target.value}))}
                    className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-brand/60 placeholder-fg/70" />
                </div>
                <div>
                  <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Reference No. (optional)</label>
                  <input type="text" placeholder="Bank txn ID, check no., GCash ref..." value={apPayForm.referenceNumber}
                    onChange={e => setApPayForm(p => ({...p, referenceNumber: e.target.value}))}
                    className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-brand/60 placeholder-fg/70" />
                </div>
              </div>
              <div className="px-5 py-4 border-t border-white/10 flex gap-3">
                <button onClick={() => setApPayModal(false)} className="flex-1 bg-white/5 text-fg/65 rounded-xl py-3 font-bold text-sm hover:bg-white/10 transition">Cancel</button>
                <button onClick={submitApPayment} disabled={apPaySubmitting}
                  className="flex-1 bg-brand text-on-brand rounded-xl py-3 font-bold text-sm hover:bg-brand/90 transition disabled:opacity-50">
                  {apPaySubmitting ? 'Recording…' : 'Record Payment'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AP Aging */}
        {apCreditEntries.length > 0 && (() => {
          const ab = agingBuckets(apCreditEntries, e => e.date, e => e.outstandingAmt);
          const buckets = [
            { label: 'Current', sub: '0-30 days', amt: ab.c,    color: 'text-success',  bg: 'bg-green-500/10 border-green-500/20' },
            { label: '31-60',   sub: 'days',       amt: ab.d60,  color: 'text-warning', bg: 'bg-yellow-500/10 border-yellow-500/20' },
            { label: '61-90',   sub: 'days',       amt: ab.d90,  color: 'text-warning', bg: 'bg-orange-500/10 border-orange-500/20' },
            { label: '91+',     sub: 'days',       amt: ab.over, color: 'text-danger',    bg: 'bg-red-500/10 border-red-500/20' },
          ];
          return (
            <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
                <AlertTriangle size={14} className="text-fg/75"/>
                <h3 className="text-sm font-black text-fg uppercase tracking-wider">A/P Aging</h3>
                <span className="ml-auto text-[10px] bg-white/10 text-fg/70 px-2 py-0.5 rounded-full font-bold">FIFO - oldest paid first</span>
              </div>
              <div className="p-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                {buckets.map(b => (
                  <div key={b.label} className={`rounded-xl border px-4 py-3 ${b.bg}`}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-fg/70">{b.label} <span className="normal-case font-normal">{b.sub}</span></p>
                    <p className={`text-lg sm:text-xl font-black tabular-nums mt-1 whitespace-nowrap ${b.amt > 0 ? b.color : 'text-fg/65'}`}>₱{b.amt.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto border-t border-white/10">
                <table className="w-full text-left text-xs min-w-[480px]">
                  <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                    <tr>
                      <th className="px-5 py-2.5">Date</th>
                      <th className="px-5 py-2.5">Reference</th>
                      <th className="px-5 py-2.5">Description</th>
                      <th className="px-5 py-2.5 text-center">Age</th>
                      <th className="px-5 py-2.5 text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    <PagedRows items={apCreditEntries} label="entries" render={(e, i) => {
                      const days = Math.floor((Date.now() - new Date(e.date).getTime()) / 86400000);
                      const ageBadge = days <= 30
                        ? 'bg-green-500/15 text-success'
                        : days <= 60 ? 'bg-yellow-500/15 text-warning'
                        : days <= 90 ? 'bg-orange-500/15 text-warning'
                        : 'bg-red-500/15 text-danger';
                      return (
                        <tr key={e._id || i} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                          <td className="px-5 py-2.5 text-fg/70 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                          <td className="px-5 py-2.5 font-mono text-fg/65 whitespace-nowrap">{e.reference}</td>
                          <td className="px-5 py-2.5 text-fg/70 truncate max-w-[200px]">{e.description}</td>
                          <td className="px-5 py-2.5 text-center"><span className={`text-[10px] font-black px-2 py-0.5 rounded ${ageBadge}`}>{days}d</span></td>
                          <td className="px-5 py-2.5 text-right text-danger font-mono tabular-nums font-bold">₱{e.outstandingAmt.toFixed(2)}</td>
                        </tr>
                      );
                    }} />
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Who we owe - per-supplier payable balances. Answers "how much do
            we owe Best Beans?" without reading journal descriptions. */}
        {(apData?.bySupplier || []).length > 0 && (
          <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
            <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
              <Truck size={14} className="text-fg/75"/>
              <h3 className="text-sm font-black text-fg uppercase tracking-wider">Payables by Supplier</h3>
              <span className="ml-auto text-[10px] bg-white/10 text-fg/70 px-2 py-0.5 rounded-full font-bold">{apData.bySupplier.length}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg/70 text-[10px] uppercase tracking-widest border-b border-white/10">
                  <th className="text-left py-2.5 px-4">Supplier</th>
                  <th className="text-right py-2.5">Purchased</th>
                  <th className="text-right py-2.5">Paid</th>
                  <th className="text-right py-2.5">Balance</th>
                  <th className="text-right py-2.5 px-4">Action</th>
                </tr>
              </thead>
              <tbody>
                <PagedRows items={apData.bySupplier} label="suppliers" render={s => (
                  <tr key={s.supplierId || 'unattributed'} className="border-b border-white/5">
                    <td className="py-2.5 px-4 font-bold text-fg">
                      {s.supplier}
                      {!s.supplierId && (
                        <span className="ml-2 text-[8px] font-black bg-white/10 text-fg/70 px-1.5 py-0.5 rounded uppercase" title="Entries recorded without a supplier record">No record</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-fg/65">₱{s.incurred.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                    <td className="py-2.5 text-right tabular-nums text-success">₱{s.paid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                    <td className={`py-2.5 text-right tabular-nums font-black ${s.balance > 0 ? 'text-danger' : 'text-success'}`}>
                      ₱{s.balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {s.supplierId && s.balance > 0 && (
                        <button
                          onClick={() => { setApPayForm(p => ({ ...p, supplierId: s.supplierId, amount: String(s.balance) })); setApPayModal(true); }}
                          className="text-[10px] font-black uppercase tracking-wider bg-brand/15 border border-brand/30 text-brand-text px-3 py-1.5 rounded-lg hover:bg-brand hover:text-on-brand transition">
                          Pay
                        </button>
                      )}
                    </td>
                  </tr>
                )} />
              </tbody>
            </table>
          </div>
        )}

        {/* Recent AP Journal Entries */}
        <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
            <FileText size={14} className="text-fg/75"/>
            <h3 className="text-sm font-black text-fg uppercase tracking-wider">A/P Journal History</h3>
            <span className="ml-auto text-[10px] bg-white/10 text-fg/70 px-2 py-0.5 rounded-full font-bold">{(apData?.recent || []).length} entries</span>
          </div>
          {!apData ? (
            <p className="text-fg/65 text-sm p-6 text-center font-bold">Loading…</p>
          ) : (apData.recent || []).length === 0 ? (
            <p className="text-fg/65 text-sm p-6 text-center font-bold">No A/P transactions yet. Procure inventory on credit to see entries here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[480px]">
                <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                  <tr>
                    <th className="px-5 py-2.5">Date</th>
                    <th className="px-5 py-2.5">Reference</th>
                    <th className="px-5 py-2.5">Supplier</th>
                    <th className="px-5 py-2.5">Description</th>
                    <th className="px-5 py-2.5 text-right">Incurred (CR)</th>
                    <th className="px-5 py-2.5 text-right">Paid (DR)</th>
                  </tr>
                </thead>
                <tbody>
                  {apPage.pageItems.map((e, i) => (
                    <tr key={e._id || i} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                      <td className="px-5 py-2.5 text-fg/70 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                      <td className="px-5 py-2.5 font-mono text-fg/65 whitespace-nowrap">{e.reference}</td>
                      <td className="px-5 py-2.5 text-fg/70 whitespace-nowrap">{e.supplierName || <span className="text-fg/65">-</span>}</td>
                      <td className="px-5 py-2.5 text-fg/70 truncate max-w-[200px]">{e.description}</td>
                      <td className="px-5 py-2.5 text-right text-danger font-mono tabular-nums font-bold">{e.credit > 0 ? `₱${e.credit.toFixed(2)}` : '-'}</td>
                      <td className="px-5 py-2.5 text-right text-success font-mono tabular-nums font-bold">{e.debit > 0 ? `₱${e.debit.toFixed(2)}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager {...apPage} label="entries" />
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}
