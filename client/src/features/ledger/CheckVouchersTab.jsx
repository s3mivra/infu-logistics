import { Download, Check, Receipt } from 'lucide-react';
import Attachments from '../../shared/Attachments';
import RangePresets from '../../shared/RangePresets';
import ManualVoucherForm from './ManualVoucherForm';

// Check vouchers.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function CheckVouchersTab({
  ledgerSubTab, peso, cvTotal, cvFilter, setCvFilter, fetchCheckVouchers, exportCvPDF, exportCvExcel,
  can, cvNewOpen, setCvNewOpen, coaAccounts, fetchCoa, apiFetch, cashAndBankAccounts, fetchERPData,
  checkVouchers, setCvDocs, printCheckVoucher, setCvVoidModal, cvDocs, activeAdmin, isSuperAdmin, cvVoidModal,
  submitVoidVoucher,
}) {
  return (
    <>
    {ledgerSubTab === 'checkvouchers' && (
      <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
        <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-black text-fg">Check Vouchers</h3>
            <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">
              The disbursement paper trail
            </p>
            <p className="text-[11px] text-fg/70 mt-1">
              Issued automatically on every bill payment, credit refund and cash advance. One can also be written by hand for a payment nothing else covers.
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-fg/70 font-bold uppercase tracking-widest">Total Issued</p>
            <p className="text-2xl text-brand-text font-black tabular-nums">{peso(cvTotal || 0)}</p>
            <p className="text-[10px] text-fg/70 mt-0.5">Voided excluded</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">Payee</label>
            <select value={cvFilter.payeeType} onChange={e => setCvFilter(f => ({ ...f, payeeType: e.target.value }))}
              className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs">
              <option value="">All</option>
              <option value="supplier">Supplier</option>
              <option value="client">Client</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">Status</label>
            <select value={cvFilter.status} onChange={e => setCvFilter(f => ({ ...f, status: e.target.value }))}
              className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs">
              <option value="">All</option>
              <option value="Issued">Issued</option>
              <option value="Voided">Voided</option>
            </select>
          </div>
          <RangePresets value={cvFilter} onChange={r => setCvFilter(p => ({ ...p, ...r }))} onRun={fetchCheckVouchers} />
          <div>
            <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">From</label>
            <input type="date" value={cvFilter.start} onChange={e => setCvFilter(f => ({ ...f, start: e.target.value }))}
              className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">To</label>
            <input type="date" value={cvFilter.end} onChange={e => setCvFilter(f => ({ ...f, end: e.target.value }))}
              className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs" />
          </div>
          <button onClick={fetchCheckVouchers}
            className="bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition min-h-[38px]">
            Apply
          </button>
          <button onClick={exportCvPDF} className="flex items-center gap-1.5 bg-white/5 text-fg/80 hover:text-fg hover:bg-white/10 px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider transition min-h-[38px]"><Download size={12} /> PDF</button>
          <button onClick={exportCvExcel} className="flex items-center gap-1.5 bg-white/5 text-fg/80 hover:text-fg hover:bg-white/10 px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider transition min-h-[38px]"><Download size={12} /> Excel</button>
          {can('accounting.manage') && !cvNewOpen && (
            <button onClick={() => { setCvNewOpen(true); if (!(coaAccounts || []).length) fetchCoa?.(); }}
              className="ml-auto bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition min-h-[38px]">
              + New voucher
            </button>
          )}
        </div>
        {cvNewOpen && (
          <ManualVoucherForm apiFetch={apiFetch} cashAccounts={cashAndBankAccounts || []} accounts={coaAccounts || []}
            onCancel={() => setCvNewOpen(false)}
            onSaved={() => { setCvNewOpen(false); fetchCheckVouchers(); fetchERPData?.(); }} />
        )}

        {!checkVouchers ? (
          <div className="py-16 text-center text-fg/70 font-bold uppercase tracking-widest text-sm">Loading…</div>
        ) : checkVouchers.length === 0 ? (
          <div className="py-16 text-center">
            <Receipt size={28} className="mx-auto text-fg/65 mb-3" />
            <p className="text-fg/75 font-bold uppercase tracking-widest text-sm">No vouchers found</p>
            <p className="text-fg/65 text-xs mt-1">Pay a bill, refund a credit or issue an advance and it lands here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg/75 text-[10px] uppercase tracking-widest border-b border-white/10">
                  <th className="text-left py-2.5">Voucher #</th>
                  <th className="text-left py-2.5">Date</th>
                  <th className="text-left py-2.5">Payee</th>
                  <th className="text-left py-2.5">Purpose</th>
                  <th className="text-left py-2.5">Paid From</th>
                  <th className="text-left py-2.5">Reference</th>
                  <th className="text-right py-2.5">Amount</th>
                  <th className="text-right py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {checkVouchers.map(v => (
                  <tr key={v._id} className={`border-b border-white/5 hover:bg-white/5 transition ${v.status === 'Voided' ? 'opacity-50' : ''}`}>
                    <td className="py-2.5 text-fg font-bold text-xs">
                      {v.voucherNumber || '-'}
                      {/* Voucher numbers restart per branch, so the number
                          alone is ambiguous once a business runs more than
                          one inventory. */}
                      {v.branchCode && <span className="block text-[9px] text-fg/65 font-normal font-mono">{v.branchCode}</span>}
                    </td>
                    <td className="py-2.5 text-fg/75 text-xs">{new Date(v.date).toLocaleDateString()}</td>
                    <td className="py-2.5 text-xs">
                      <span className="text-fg/70">{v.payeeName}</span>
                      <span className="ml-1.5 text-[9px] font-black uppercase text-fg/65">{v.payeeType}</span>
                    </td>
                    <td className="py-2.5 text-fg/75 text-xs">{v.purpose}</td>
                    <td className="py-2.5 text-fg/75 text-xs">{v.sourceAccountName || v.sourceAccount || '-'}</td>
                    <td className="py-2.5 text-fg/75 text-xs">{v.referenceNumber || '-'}</td>
                    <td className={`py-2.5 text-right tabular-nums font-black ${v.status === 'Voided' ? 'text-fg/70 line-through' : 'text-fg'}`}>
                      {peso(v.amount)}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setCvDocs(v)} title="Supporting documents for this voucher"
                          className="border border-white/15 text-fg/70 px-2.5 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-white/10 hover:text-fg transition">
                          Docs
                        </button>
                        <button onClick={() => printCheckVoucher(v)} title="Print this voucher for signing"
                          className="border border-white/15 text-fg/70 px-2.5 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-white/10 hover:text-fg transition">
                          Print
                        </button>
                        {v.status === 'Issued' ? (
                          <button onClick={() => setCvVoidModal({ voucher: v, reason: '', busy: false })}
                            className="border border-red-500/40 text-danger px-2.5 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-red-500/10 transition">
                            Void
                          </button>
                        ) : (
                          <span className="text-[10px] font-black uppercase bg-red-500/15 text-danger px-2 py-1 rounded" title={v.voidReason || ''}>
                            Voided
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cvDocs && (
          <div className="fixed inset-0 z-50 flex justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => setCvDocs(null)}>
            <div role="dialog" aria-label="Voucher documents" className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 my-auto" onClick={e => e.stopPropagation()}>
              <h2 className="font-black text-fg mb-1">Voucher {cvDocs.voucherNumber}</h2>
              <p className="text-fg/75 text-sm">{cvDocs.payeeName} · {peso(cvDocs.amount)} · {cvDocs.purpose}</p>
              <p className="text-[11px] text-fg/65">Journal {cvDocs.journalEntryRef || '-'} · {cvDocs.status}</p>
              <Attachments entity="CheckVoucher" entityId={cvDocs._id} apiFetch={apiFetch} canAttach={can('accounting.manage')}
                currentUserId={activeAdmin?._id} isSuperAdmin={isSuperAdmin} title="Receipts, invoices, signed copy" />
              <div className="flex justify-end mt-4">
                <button onClick={() => setCvDocs(null)} className="px-4 py-2 rounded-xl bg-white/5 text-fg/80 text-sm font-bold">Close</button>
              </div>
            </div>
          </div>
        )}

        {/* Void modal - the server requires a reason, so this cannot be a
            plain confirm. Lives inside this sub-tab because that is the
            only place a void can be started from. */}
        {cvVoidModal && (
          <div className="fixed inset-0 z-50 flex justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => setCvVoidModal(null)}>
            <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6 my-auto" onClick={e => e.stopPropagation()}>
              <h2 className="font-black text-fg mb-1">Void voucher {cvVoidModal.voucher.voucherNumber}</h2>
              <p className="text-xs text-fg/75 mb-3">
                {peso(cvVoidModal.voucher.amount)} to {cvVoidModal.voucher.payeeName}
              </p>
              <div className="text-[11px] text-warning bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 mb-3">
                This marks the voucher only. The journal entry stays posted and the bill stays paid -
                correcting those is a separate, deliberate entry.
              </div>
              <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">Reason (required)</label>
              <textarea
                value={cvVoidModal.reason} rows={3}
                onChange={e => setCvVoidModal(m => ({ ...m, reason: e.target.value }))}
                placeholder="e.g. printed with the wrong payee"
                className="w-full bg-page-bg border border-white/10 rounded-lg p-2.5 text-fg text-sm outline-none focus:border-brand" />
              <div className="flex gap-2 mt-4">
                <button onClick={() => setCvVoidModal(null)} disabled={cvVoidModal.busy}
                  className="flex-1 border border-white/15 text-fg/70 px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-white/5 transition">
                  Cancel
                </button>
                <button onClick={submitVoidVoucher} disabled={cvVoidModal.busy || !cvVoidModal.reason.trim()}
                  className="flex-1 bg-red-700 text-white px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-red-500/90 transition disabled:opacity-40">
                  {cvVoidModal.busy ? 'Voiding…' : 'Void Voucher'}
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
