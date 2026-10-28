import { Download } from 'lucide-react';
import Pager from '../../shared/Pager';
import { dateStr } from '../../shared/businessDay.js';
import CollectFromClient from './CollectFromClient';

import PagedRows from '../../shared/PagedRows';
// Accounts receivable: what clients owe, and settling it.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function ReceivablesTab({
  ledgerSubTab, arOutstanding, exportArPDF, agingBuckets, arAgeing, can, apiFetch, fetchArOutstanding,
  fetchArAgeing, fetchERPData, arPage, openArHistory, setSettleModal, setSettleForm, todayLocal, openClientCredit,
  clientCreditModal, setClientCreditModal, peso, submitClientCredit,
}) {
  return (
    <>
    {(ledgerSubTab === 'ar' || ledgerSubTab === 'araap') && (
      <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
        <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-black text-fg">Accounts Receivable</h3>
            <p className="text-fg/65 text-xs font-bold uppercase tracking-widest mt-1">Non-Cash sales awaiting settlement (E-Wallet · Bank · Delivery)</p>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="text-right">
              <p className="text-fg/65 text-[10px] font-bold uppercase whitespace-nowrap">Total Outstanding</p>
              <p className="text-2xl sm:text-3xl text-brand-text font-black tabular-nums whitespace-nowrap">₱{arOutstanding.totalOutstanding.toFixed(2)}</p>
              {/* Related businesses apart from outside customers, when there are any. */}
              {arOutstanding.affiliateOutstanding > 0 && (
                <p className="text-[10px] text-fg/70 font-bold whitespace-nowrap mt-0.5">
                  Customers ₱{Number(arOutstanding.tradeOutstanding || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} · Affiliates ₱{Number(arOutstanding.affiliateOutstanding).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </p>
              )}
            </div>
            {arOutstanding.orders.length > 0 && <button onClick={exportArPDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition shrink-0"><Download size={12} /> PDF</button>}
          </div>
        </div>

        {/* AR Aging Summary */}
        {arOutstanding.orders.length > 0 && (() => {
          // Age on the unpaid remainder - a partly collected invoice
          // must not keep sitting in a bucket at its original value.
          const ab = agingBuckets(arOutstanding.orders, o => o.createdAt, o => (o.balance ?? o.total));
          const buckets = [
            { label: 'Current', sub: '0-30 days', amt: ab.c,    color: 'text-success',  bg: 'bg-green-500/10 border-green-500/20' },
            { label: '31-60',   sub: 'days',       amt: ab.d60,  color: 'text-warning', bg: 'bg-yellow-500/10 border-yellow-500/20' },
            { label: '61-90',   sub: 'days',       amt: ab.d90,  color: 'text-warning', bg: 'bg-orange-500/10 border-orange-500/20' },
            { label: '91+',     sub: 'days',       amt: ab.over, color: 'text-danger',    bg: 'bg-red-500/10 border-red-500/20' },
          ];
          return (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
              {buckets.map(b => (
                <div key={b.label} className={`rounded-xl border px-4 py-3 ${b.bg}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/65">{b.label} <span className="normal-case font-normal">{b.sub}</span></p>
                  <p className={`text-lg sm:text-xl font-black tabular-nums mt-1 whitespace-nowrap ${b.amt > 0 ? b.color : 'text-fg/65'}`}>₱{b.amt.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Per-client ageing - answers "who owes me, how old is it, and are
            they over their limit?" without leaving the tab. Server-computed
            so these buckets and the order-time credit gate share one rule set. */}
        {arAgeing?.clients?.length > 0 && (
          <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <p className="text-[11px] font-black uppercase tracking-widest text-fg/65">Ageing by Client</p>
              {arAgeing.mode !== 'off' && (
                <span className="text-[9px] font-black uppercase tracking-widest bg-brand/15 border border-brand/30 text-brand-text px-2 py-1 rounded-full">
                  Limits: {arAgeing.mode.replace('_', ' ')}
                </span>
              )}
            </div>
            <table className="w-full text-sm block">

              <tbody className="block">
                <PagedRows items={arAgeing.clients} label="clients" render={row => {
                  const p2 = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
                  // Only the ages that hold something, newest first.
                  const ages = [['Current', row.current, 'text-fg/70'], ['31-60 days', row.d31_60, 'text-warning'], ['61-90 days', row.d61_90, 'text-caution'], ['91+ days', row.d90_plus, 'text-red-500/80']].filter(([, v]) => v);
                  return (
                  <tr key={row.client} className={`flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 border-b border-white/5 ${row.overLimit ? 'bg-red-500/5' : ''}`}>
                    <td className="block flex-1 basis-[9rem] min-w-0 font-bold text-fg break-words">
                      {row.client}
                      {row.overLimit && <span className="ml-2 text-[8px] font-black bg-red-700 text-white px-1.5 py-0.5 rounded uppercase">Over</span>}
                    </td>
                    <td className="block ml-auto text-right tabular-nums text-xs">
                      {ages.length === 0 ? <span className="text-fg/65">-</span> : ages.map(([label, v, tone]) => (
                        <span key={label} className={`block whitespace-nowrap ${tone}`}><span className="text-fg/65">{label}</span> {p2(v)}</span>
                      ))}
                    </td>
                    <td className="block ml-auto text-right whitespace-nowrap tabular-nums font-black text-fg"><span className="block text-[9px] font-black uppercase tracking-widest text-fg/65">Total</span>{p2(row.total)}</td>
                    <td className="block ml-auto text-right tabular-nums text-xs">
                      <span className="block text-[9px] font-black uppercase tracking-widest text-fg/65" title="Everything on account including orders still in flight - what the credit limit spends">Committed</span>
                      <span className="block whitespace-nowrap text-brand-text">{row.exposure ? p2(row.exposure) : '-'}</span>
                      {row.creditLimit === null || row.creditLimit === undefined ? (
                        <span className="block text-fg/65">No limit</span>
                      ) : (
                        <span className={`block whitespace-nowrap ${row.overLimit ? 'text-danger font-bold' : 'text-fg/65'}`}>
                          limit ₱{row.creditLimit.toLocaleString('en-PH')} · ₱{(row.available ?? 0).toLocaleString('en-PH')} left
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                }} />
              </tbody>
            </table>
          </div>
        )}

        {can('ar.collect') && (
          <CollectFromClient apiFetch={apiFetch} orders={arOutstanding.orders}
            onDone={() => { fetchArOutstanding?.(); fetchArAgeing?.(); fetchERPData?.(); }} />
        )}
        {arOutstanding.orders.length === 0 ? (
          <div className="py-16 text-center text-fg/65 font-bold uppercase tracking-widest text-sm">No outstanding A/R </div>
        ) : (
          <div>
            <table className="w-full text-sm block">

              <tbody className="block">
                {arPage.pageItems.map(o => {
                  const days = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 86400000);
                  const ageBadge = days <= 30
                    ? 'bg-green-400/15 text-success'
                    : days <= 60 ? 'bg-yellow-500/15 text-warning'
                    : days <= 90 ? 'bg-orange-500/15 text-warning'
                    : 'bg-red-500/15 text-danger';
                  return (
                    <tr key={o._id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3 border-b border-white/5 hover:bg-white/5 transition">
                      <td className="block flex-1 basis-[9rem] min-w-0">
                        <span className="block text-fg font-bold whitespace-nowrap">{o.orderNumber}</span>
                        <span className="flex items-center gap-1.5 mt-1 text-xs text-fg/75 whitespace-nowrap">
                          {new Date(o.createdAt).toLocaleDateString()}
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${ageBadge}`}>{days}d</span>
                        </span>
                      </td>
                      <td className="block flex-1 basis-[9rem] min-w-0">
                        <span className="block text-fg/80 break-words">{o.customerName}{o.affiliate && <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider text-fg/70 bg-white/5 border border-white/10 rounded px-1 py-0.5 align-middle">Affiliate</span>}</span>
                        <span className="inline-block mt-1 text-[10px] font-black uppercase tracking-wider bg-brand/20 text-brand-text px-2 py-0.5 rounded whitespace-nowrap">{o.paymentMethod}</span>
                        {o.arDueDate && (
                          o.overdue
                            ? <span className="block mt-1 text-[10px] font-black text-danger whitespace-nowrap">OVERDUE · due {new Date(o.arDueDate).toLocaleDateString()}</span>
                            : <span className="block mt-1 text-[10px] text-fg/65 whitespace-nowrap">due {new Date(o.arDueDate).toLocaleDateString()}</span>
                        )}
                      </td>
                      {/* Balance is what is still owed; invoiced is the
                          face value and never moves. Both are shown: a
                          client asking "what do I owe on invoice X" needs
                          the first, reconciling against the sale needs
                          the second. */}
                      <td className="block ml-auto text-right tabular-nums">
                        <span className="block text-fg font-black whitespace-nowrap" title="Still owed">₱{(o.balance ?? o.total).toFixed(2)}</span>
                        <span className="block text-[11px] text-fg/70 whitespace-nowrap">of ₱{o.total.toFixed(2)} invoiced</span>
                        {o.paid > 0 && (
                          <button onClick={() => openArHistory(o)} className="block ml-auto text-[11px] text-success font-bold hover:underline whitespace-nowrap" title="View payment history">
                            ₱{o.paid.toFixed(2)} collected{o.paymentCount > 1 ? ` (${o.paymentCount})` : ''}
                          </button>
                        )}
                      </td>
                      <td className="block ml-auto text-right">
                        {/* Recording a collection, or spending a client's credit on it,
                            is the owner's (the server allows only the superadmin), so
                            nobody else is shown buttons that can only be refused. */}
                        {can('ar.collect') ? (<>
                        <button onClick={() => {
                          let defaultMethod = 'Cash on Hand';
                          if (o.paymentMethod === 'Bank Transfer') defaultMethod = 'Bank Transfer';
                          else if (o.paymentMethod === 'Check') defaultMethod = 'Check';
                          else if (['GCash','Maya','Maribank','E-Wallet','Other E-Wallet','QR'].includes(o.paymentMethod)) defaultMethod = o.paymentMethod === 'Other E-Wallet' ? 'GCash' : o.paymentMethod;
                          else if (['Grab Delivery','Foodpanda','Manual Delivery'].includes(o.paymentMethod)) defaultMethod = 'Bank Transfer';
                          setSettleModal({ order: o });
                          // Default to collecting the REMAINDER, not the
                          // invoice face value - on a partly paid invoice
                          // the face value would be rejected as an overpayment.
                          // A sale tendered by check already captured the
                          // check number and date - carry them into the
                          // register rather than making someone read them
                          // off the paper a second time (and risk a typo
                          // that breaks the match).
                          const wasCheck = o.paymentMethod === 'Check';
                          setSettleForm({
                            amount: (o.balance ?? o.total).toFixed(2), paymentMethod: defaultMethod,
                            note: '', referenceNumber: '', collectedBy: '',
                            collectionDate: todayLocal(), depositDate: todayLocal(),
                            checkNumber: wasCheck ? (o.paymentReference || '') : '',
                            checkDate: wasCheck && o.paymentCheckDate ? dateStr(o.paymentCheckDate) : '',
                            checkBank: '', checkDrawer: '',
                          });
                        }}
                          className="bg-brand text-on-brand px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
                          {o.paid > 0 ? 'Collect' : 'Settle'}
                        </button>
                        {/* Stored credit from a past overpayment draws the
                            invoice down with no cash collected, so it is a
                            separate action from Settle/Collect. Only shown
                            when this client actually has credit sitting on
                            their account. */}
                        {o.clientCredit > 0 && (
                          <button
                            onClick={() => openClientCredit(o, Math.min(o.clientCredit, o.balance ?? o.total))}
                            title={`₱${o.clientCredit.toFixed(2)} credit available`}
                            className="block w-full mt-1 border border-emerald-500/40 text-success px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-emerald-500/10 transition">
                            Use ₱{Math.min(o.clientCredit, o.balance ?? o.total).toFixed(2)} Credit
                          </button>
                        )}
                        </>) : (
                          <span className="text-fg/65 text-[10px]" title="The owner records payments received">Owner records</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager {...arPage} label="orders" />

            {/* Applying stored credit posts to the ledger just like a cash
                collection does, so it collects the same reference and
                remarks rather than firing on a bare confirm. */}
            {clientCreditModal && (
              <div className="fixed inset-0 z-50 flex justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => setClientCreditModal(null)}>
                <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6 my-auto" onClick={e => e.stopPropagation()}>
                  <h2 className="font-black text-fg text-lg mb-1">Apply client credit</h2>
                  <p className="text-xs text-fg/75 mb-4">
                    {clientCreditModal.order.orderNumber} · {clientCreditModal.order.customerName}
                  </p>
                  <div className="text-[11px] text-success bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-2.5 mb-4">
                    {peso(clientCreditModal.order.clientCredit)} credit available ·
                    {' '}{peso(clientCreditModal.order.balance ?? clientCreditModal.order.total)} still due.
                    No cash is collected.
                  </div>

                  <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Amount</label>
                  <input type="number" step="0.01" min="0" value={clientCreditModal.amount}
                    onChange={e => setClientCreditModal(m => ({ ...m, amount: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

                  <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Reference No.</label>
                  <input type="text" value={clientCreditModal.referenceNumber}
                    onChange={e => setClientCreditModal(m => ({ ...m, referenceNumber: e.target.value }))}
                    placeholder="Credit memo no., OR no..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

                  <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Remarks</label>
                  <textarea value={clientCreditModal.note} rows={2}
                    onChange={e => setClientCreditModal(m => ({ ...m, note: e.target.value }))}
                    placeholder="Why this credit is being applied here"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-5 outline-none focus:border-brand" />

                  <div className="flex gap-3">
                    <button onClick={() => setClientCreditModal(null)} disabled={clientCreditModal.busy}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-fg/75 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">
                      Cancel
                    </button>
                    <button onClick={submitClientCredit} disabled={clientCreditModal.busy}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50">
                      {clientCreditModal.busy ? 'Applying…' : 'Apply Credit'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )}
    </>
  );
}
