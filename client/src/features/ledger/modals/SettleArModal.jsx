import { Check, X, History } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Record ONE collection against a receivable. Collections are partial by
// design: paying ₱1,500 against a ₱1,700 invoice leaves ₱200 outstanding and
// the invoice stays open, so the form works off the remaining balance rather
// than the invoice face value.
//
// Reads shared dashboard state via useDashboard() rather than props - see
// DashboardContext.
export default function SettleArModal() {
  const { setSettleForm, setSettleModal, settleForm, settleModal, settleSubmitting, submitArSettlement, openArHistory } = useDashboard();

  if (!(settleModal)) return null;

  const order = settleModal.order;
  const face = Number(order.total) || 0;
  const paid = Number(order.paid ?? order.arPaidAmount) || 0;
  // Older rows (and any caller that hasn't been updated) carry no `balance` -
  // fall back to the face value, which is correct when nothing is paid yet.
  const outstanding = Number(order.balance ?? face) || 0;
  const entered = parseFloat(settleForm.amount);
  const remainingAfter = Number.isFinite(entered) ? Math.max(0, +(outstanding - entered).toFixed(2)) : outstanding;
  const isPartial = Number.isFinite(entered) && entered > 0 && entered < outstanding - 0.01;
  const overpaying = Number.isFinite(entered) && entered > outstanding + 0.01;
  // Only a real, linked client account can hold a credit balance forward -
  // a walk-in/no-account order still has nowhere for the excess to live, so
  // it's still blocked there. See POST /api/orders/:id/settle-ar.
  const hasClientAccount = !!order.clientId;
  const overpayAmount = overpaying ? +(entered - outstanding).toFixed(2) : 0;
  const blockedOverpay = overpaying && !hasClientAccount;
  const isCheck = settleForm.paymentMethod === 'Check';
  // A check is not deposited at collection time, so the deposit-date rule
  // simply doesn't apply to one.
  const datesOutOfOrder = !isCheck && settleForm.collectionDate && settleForm.depositDate && settleForm.depositDate < settleForm.collectionDate;
  const missingCheckNo = isCheck && !String(settleForm.checkNumber || '').trim();
  // A collection needs SOMETHING tying it to a real transaction to ever be
  // reconciled - a check's own check number already serves that role for
  // Check, so only every other method needs the generic reference field.
  const missingReference = !isCheck && !String(settleForm.referenceNumber || '').trim();

  const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
      <div className="fixed inset-0 z-[9998] bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-fade-in" onClick={e => { if (e.target === e.currentTarget) setSettleModal(null); }} role="dialog" aria-modal="true" aria-label="Record A/R collection">
        <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-elev-3 flex flex-col max-h-[92vh] animate-scale-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div>
              <h2 className="text-fg font-black text-lg">Record Collection</h2>
              <p className="text-fg/40 text-xs mt-0.5">{order.orderNumber} · {order.paymentMethod}</p>
            </div>
            <div className="flex items-center gap-2">
              {paid > 0 && (
                <button onClick={() => { setSettleModal(null); openArHistory(order); }} title="Payment history"
                  className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition" aria-label="Payment history"><History size={16}/></button>
              )}
              <button onClick={() => setSettleModal(null)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition" aria-label="Close"><X size={16}/></button>
            </div>
          </div>
          <div className="px-5 py-4 space-y-3 overflow-y-auto">
            {/* Outstanding is what is STILL owed. When part of the invoice has
                already been collected, the face value is shown alongside so the
                figure reconciles against the original sale. */}
            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
              <p className="text-fg/40 text-[10px] font-bold uppercase">Still Outstanding</p>
              <p className="text-3xl text-brand font-black tabular-nums">{peso(outstanding)}</p>
              {paid > 0 && (
                <p className="text-[10px] text-fg/40 mt-1 tabular-nums">
                  {peso(paid)} already collected of {peso(face)} invoiced
                </p>
              )}
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Amount Received *</label>
              <input type="number" min="0" step="0.01" value={settleForm.amount} onChange={e => setSettleForm({...settleForm, amount: e.target.value})}
                className={`w-full bg-page-bg border rounded-xl px-3 py-3 text-fg text-xl font-black tabular-nums outline-none focus:border-brand/60 ${blockedOverpay ? 'border-red-500/60' : overpaying ? 'border-amber-500/60' : 'border-white/10'}`} />
              <div className="flex items-center justify-between mt-1.5 gap-2">
                {/* Partial payment is normal, not an error - say what will be
                    left rather than blocking the user. An overpayment is ALSO
                    fine, as long as there's a real client account to credit
                    the excess to - it settles the order in full and the rest
                    becomes that client's stored credit. */}
                {blockedOverpay ? (
                  <p className="text-[10px] text-red-400 font-bold">Exceeds the {peso(outstanding)} outstanding - this order has no client account to credit the excess to.</p>
                ) : overpaying ? (
                  <p className="text-[10px] text-amber-400 font-bold">Overpaying by {peso(overpayAmount)} - settles this order in full; the rest becomes client credit.</p>
                ) : isPartial ? (
                  <p className="text-[10px] text-yellow-400 font-bold tabular-nums">Partial · {peso(remainingAfter)} will remain outstanding.</p>
                ) : (
                  <p className="text-[10px] text-fg/25">Enter less than the full amount to record a partial collection.</p>
                )}
                <button type="button" onClick={() => setSettleForm({ ...settleForm, amount: outstanding.toFixed(2) })}
                  className="shrink-0 text-[10px] font-black uppercase tracking-wider bg-white/5 hover:bg-white/10 text-fg/60 px-2 py-1 rounded-lg transition">
                  Full
                </button>
              </div>
            </div>
            {/* The two dates answer different questions and are routinely
                days apart: cash collected on a Friday round is often only
                banked the following Monday. The journal entry is booked on
                the deposit date, because that is when the account moved. */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Collection Date *</label>
                <input type="date" value={settleForm.collectionDate || ''} onChange={e => setSettleForm({...settleForm, collectionDate: e.target.value})}
                  className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold outline-none focus:border-brand/60" />
                <p className="text-[9px] text-fg/25 mt-1">When the client paid.</p>
              </div>
              {isCheck ? (
                <div>
                  <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Check Date</label>
                  <input type="date" value={settleForm.checkDate || ''} onChange={e => setSettleForm({...settleForm, checkDate: e.target.value})}
                    className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold outline-none focus:border-brand/60" />
                  <p className="text-[9px] text-fg/25 mt-1">Post-dated? It can't be banked before this.</p>
                </div>
              ) : (
                <div>
                  <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Deposit Date *</label>
                  <input type="date" value={settleForm.depositDate || ''} min={settleForm.collectionDate || undefined} onChange={e => setSettleForm({...settleForm, depositDate: e.target.value})}
                    className={`w-full bg-page-bg border rounded-xl px-3 py-2.5 text-fg font-bold outline-none focus:border-brand/60 ${datesOutOfOrder ? 'border-red-500/60' : 'border-white/10'}`} />
                  <p className={`text-[9px] mt-1 ${datesOutOfOrder ? 'text-red-400 font-bold' : 'text-fg/25'}`}>
                    {datesOutOfOrder ? 'Cannot precede collection.' : 'When it hit the account.'}
                  </p>
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Deposited To *</label>
              <select value={settleForm.paymentMethod} onChange={e => setSettleForm({...settleForm, paymentMethod: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-brand/60">
                <option>Cash on Hand</option>
                <option>Bank Transfer</option>
                <option>Check</option>
                <option>QR</option>
                <option>GCash</option>
                <option>Maya</option>
                <option>Maribank</option>
              </select>
            </div>
            {/* A check is a promise of money, not money. It is booked to Checks
                on Hand and tracked through deposit → clearing in the Collections
                tab; if it bounces, that tab reverses this collection and the
                invoice reopens. */}
            {isCheck && (
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/[0.06] p-3 space-y-2.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-yellow-400">Check Details</p>
                <div>
                  <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Check Number *</label>
                  <input type="text" placeholder="e.g. 0012345" value={settleForm.checkNumber || ''} onChange={e => setSettleForm({...settleForm, checkNumber: e.target.value})}
                    className={`w-full bg-page-bg border rounded-xl px-3 py-2.5 text-fg font-bold tabular-nums placeholder-white/25 outline-none focus:border-brand/60 ${missingCheckNo ? 'border-red-500/60' : 'border-white/10'}`} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Bank</label>
                    <input type="text" placeholder="BPI, BDO..." value={settleForm.checkBank || ''} onChange={e => setSettleForm({...settleForm, checkBank: e.target.value})}
                      className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold placeholder-white/25 outline-none focus:border-brand/60" />
                  </div>
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Drawer</label>
                    <input type="text" placeholder="Whose account" value={settleForm.checkDrawer || ''} onChange={e => setSettleForm({...settleForm, checkDrawer: e.target.value})}
                      className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold placeholder-white/25 outline-none focus:border-brand/60" />
                  </div>
                </div>
                <p className="text-[9px] text-fg/40">
                  Held in Checks on Hand - not counted as bank cash until you clear it in Collections.
                </p>
              </div>
            )}
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Collected By (optional)</label>
              <input type="text" placeholder="Rider / collector name..." value={settleForm.collectedBy || ''} onChange={e => setSettleForm({...settleForm, collectedBy: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold placeholder-white/25 outline-none focus:border-brand/60" />
              <p className="text-[9px] text-fg/25 mt-1">Who physically took the money in - the collection report groups by this.</p>
            </div>
            {!isCheck && (
              <div>
                <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Reference No. *</label>
                <input type="text" placeholder="Bank txn ID, GCash ref, transaction no..." value={settleForm.referenceNumber || ''} onChange={e => setSettleForm({...settleForm, referenceNumber: e.target.value})}
                  className={`w-full bg-page-bg border rounded-xl px-3 py-2.5 text-fg font-bold placeholder-white/25 outline-none focus:border-brand/60 ${missingReference ? 'border-red-500/60' : 'border-white/10'}`} />
                <p className="text-[9px] text-fg/25 mt-1">Required - this is what ties the collection back to a real bank/wallet transaction for reconciliation.</p>
              </div>
            )}
            <div>
              <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Note (optional)</label>
              <input type="text" placeholder="Grab payout batch #..." value={settleForm.note} onChange={e => setSettleForm({...settleForm, note: e.target.value})}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold placeholder-white/25 outline-none focus:border-brand/60" />
            </div>
          </div>
          <div className="px-5 pb-5 pt-3 border-t border-white/10">
            <button onClick={submitArSettlement} disabled={settleSubmitting || blockedOverpay || datesOutOfOrder || missingCheckNo || missingReference}
              className="w-full py-4 bg-brand text-white font-black rounded-xl uppercase tracking-widest text-sm hover:bg-brand/90 active-press transition shadow-elev-2 disabled:opacity-50 min-h-[56px] flex items-center justify-center gap-2">
              <Check size={18}/> {settleSubmitting ? 'Recording…' : overpaying ? 'Record & Credit Overpayment' : isPartial ? 'Record Partial Payment' : 'Record Collection'}
            </button>
          </div>
        </div>
      </div>
  );
}
