import { useState, useEffect } from 'react';
import { useDashboard } from '../../dashboard/DashboardContext';

const METHODS = ['Cash', 'Bank Transfer', 'Check', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet', 'QR'];

// Extracted from AdminDashboard; reads shared state via useDashboard().
export default function PartialFulfillModal() {
  const {
    partialBusy, partialModal, partialMode, partialPayment, partialQtys,
    setPartialModal, setPartialMode, setPartialPayment, setPartialQtys, submitPartialFulfill,
    partialRef, setPartialRef, partialCheckDate, setPartialCheckDate,
    systemSettings, setPayQrOpen, partialTenders, setPartialTenders,
  } = useDashboard();
  // "Enter amount": rows of { method, amount, reference }. One row is a plain
  // amount; more rows are a split payment.
  const tenders = partialTenders || [];
  const setRow = (i, k, v) => setPartialTenders(tenders.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  useEffect(() => {
    if (partialModal && !tenders.length) setPartialTenders([{ method: partialPayment || 'Cash', amount: '', reference: '' }]);
  }, [partialModal]); // eslint-disable-line react-hooks/exhaustive-deps

  // A partial batch takes real money, so it needs the same evidence a full
  // sale does. Paying one by QR or by check with nowhere to put the
  // confirmation number left that cash with nothing to reconcile against.
  const needsRef = ['QR', 'Check'].includes(partialPayment);
  const isCheck = partialPayment === 'Check';
  const scannable = ['QR', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'].includes(partialPayment);

  if (!(partialModal)) return null;
const items = partialModal.items || [];
      const rem = (it) => (it.quantity || 0) - (it.fulfilledQty || 0);
      const fNow = (it, i) => Math.max(0, Math.min(rem(it), Number(partialQtys[i] ?? rem(it))));
      const netUnit = (it) => (it.price || 0) * (1 - (it.productDiscountPercent || 0) / 100);
      const fTotal = items.reduce((s, it, i) => s + netUnit(it) * fNow(it, i), 0);
      const rTotal = items.reduce((s, it, i) => s + netUnit(it) * (rem(it) - fNow(it, i)), 0);
      const paidNow = tenders.reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const isAmount = partialMode === 'amount';
      return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
        <div className="bg-surface border border-gray-700 rounded-2xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-black text-fg">Partial Fulfillment</h2>
              <p className="text-xs text-fg/70 mt-0.5">{partialModal.orderNumber} · set fulfilled quantities</p>
            </div>
            <button onClick={() => setPartialModal(null)} className="text-fg/70 hover:text-fg text-xl font-bold">✕</button>
          </div>

          <div className="space-y-2">
            {items.map((it, i) => {
              const remaining = rem(it);
              const fq = fNow(it, i);
              const short = remaining - fq;
              if (remaining <= 0) return (
                <div key={i} className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 opacity-50">
                  <p className="text-sm font-bold text-fg truncate">{it.name} <span className="text-success text-[10px]">· fully fulfilled</span></p>
                </div>
              );
              return (
                <div key={i} className="bg-page-bg border border-white/10 rounded-xl px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-fg truncate" title={String((it.name) ?? '')}>{it.name}</p>
                      <p className="text-[10px] text-fg/70">Remaining: {remaining} of {it.quantity} · ₱{netUnit(it).toFixed(2)} ea{(it.productDiscountPercent||0) > 0 ? ` (${it.productDiscountPercent}% off)` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => setPartialQtys(p => ({ ...p, [i]: Math.max(0, fq - 1) }))} className="w-7 h-7 rounded-lg bg-white/5 text-fg hover:bg-white/10 font-black">−</button>
                      <input type="number" min="0" max={remaining} value={fq}
                        onChange={e => setPartialQtys(p => ({ ...p, [i]: e.target.value }))}
                        className="w-12 text-center bg-surface border border-white/10 rounded-lg py-1 text-fg text-sm font-bold outline-none" />
                      <button onClick={() => setPartialQtys(p => ({ ...p, [i]: Math.min(remaining, fq + 1) }))} className="w-7 h-7 rounded-lg bg-white/5 text-fg hover:bg-white/10 font-black">+</button>
                    </div>
                  </div>
                  {short > 0 && <p className="text-[10px] text-warning mt-1 font-bold">{short} stays on this order (fulfill later)</p>}
                </div>
              );
            })}
          </div>

          <div className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-xs space-y-1">
            <div className="flex justify-between text-fg/70"><span>Fulfilled now</span><span className="font-mono font-bold text-fg">₱{fTotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-fg/70"><span>Remaining on order</span><span className="font-mono font-bold text-warning">₱{rTotal.toFixed(2)}</span></div>
          </div>

          {!isAmount && <div>
            <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1.5">Payment Method</label>
            <select value={partialPayment} onChange={e => setPartialPayment(e.target.value)}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm font-bold outline-none focus:border-brand/60">
              <optgroup label="In-Store Payments">
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Check">Check</option>
              </optgroup>
              <optgroup label="E-Wallets">
                <option value="GCash">GCash</option>
                <option value="Maya">Maya</option>
                <option value="Maribank">Maribank / Seabank</option>
                <option value="Other E-Wallet">Other E-Wallet</option>
                <option value="QR">QR / Scan to Pay</option>
              </optgroup>
              <optgroup label="Delivery Partners">
                <option value="Grab Delivery">Grab Delivery</option>
                <option value="Lalamove">Lalamove</option>
                <option value="Manual Delivery">Manual / Direct</option>
              </optgroup>
            </select>
          </div>}

          {/* Scan to pay, at the moment of paying. */}
          {scannable && systemSettings?.paymentQrImage && (
            <button type="button" onClick={() => setPayQrOpen?.(true)}
              className="flex items-center justify-center gap-1.5 w-full px-3 py-2.5 rounded-xl bg-brand/15 text-brand-text hover:bg-brand/25 font-bold text-xs uppercase tracking-wider transition">
              Show Pay QR
            </button>
          )}

          {!isAmount && needsRef && (
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1.5">
                  {isCheck ? 'Check No.' : 'Reference No.'}
                </label>
                <input
                  type="text"
                  value={partialRef || ''}
                  onChange={e => setPartialRef?.(e.target.value)}
                  placeholder={isCheck ? 'Required' : 'Confirmation no. from the payment app'}
                  className={`w-full bg-page-bg border rounded-xl px-3 py-2.5 text-fg text-sm font-mono outline-none ${
                    (partialRef || '').trim() ? 'border-white/10 focus:border-brand/60' : 'border-red-500/60'
                  }`}
                />
              </div>
              {isCheck && (
                <div>
                  <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1.5">Check Date</label>
                  <input
                    type="date"
                    value={partialCheckDate || ''}
                    onChange={e => setPartialCheckDate?.(e.target.value)}
                    className="w-full bg-page-bg border border-white/10 focus:border-brand/60 rounded-xl px-3 py-2.5 text-fg text-sm font-mono outline-none"
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1.5">Payment</label>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setPartialMode('partial')}
                className={`py-2.5 rounded-xl border text-xs font-bold transition ${partialMode === 'partial' ? 'bg-brand/20 border-brand/60 text-fg' : 'bg-page-bg border-white/10 text-fg/75'}`}>
                Pay partial only<br/><span className="text-[9px] font-normal opacity-70">₱{fTotal.toFixed(2)} now · rest billed later</span>
              </button>
              <button type="button" onClick={() => setPartialMode('full')}
                className={`py-2.5 rounded-xl border text-xs font-bold transition ${partialMode === 'full' ? 'bg-brand/20 border-brand/60 text-fg' : 'bg-page-bg border-white/10 text-fg/75'}`}>
                Pay full now<br/><span className="text-[9px] font-normal opacity-70">remaining prepaid (deposit)</span>
              </button>
              <button type="button" onClick={() => setPartialMode('amount')}
                className={`py-2.5 rounded-xl border text-xs font-bold transition ${isAmount ? 'bg-brand/20 border-brand/60 text-fg' : 'bg-page-bg border-white/10 text-fg/75'}`}>
                Enter amount<br/><span className="text-[9px] font-normal opacity-70">type it, or split it</span>
              </button>
            </div>
          </div>

          {isAmount && (
            <div className="space-y-2 bg-page-bg border border-white/10 rounded-xl p-3">
              {tenders.map((t, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex gap-2">
                    <select value={t.method} onChange={e => setRow(i, 'method', e.target.value)} aria-label={`Payment ${i + 1} method`}
                      className="flex-1 min-w-0 bg-surface border border-white/10 rounded-lg px-2 py-2 text-fg text-sm font-bold outline-none focus:border-brand/60">
                      {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={t.amount} placeholder="Amount"
                      onChange={e => setRow(i, 'amount', e.target.value)} aria-label={`Payment ${i + 1} amount`}
                      className="w-28 bg-surface border border-white/10 rounded-lg px-2 py-2 text-fg text-sm font-bold text-right outline-none focus:border-brand/60" />
                    {tenders.length > 1 && (
                      <button type="button" onClick={() => setPartialTenders(tenders.filter((_, j) => j !== i))} aria-label={`Remove payment ${i + 1}`}
                        className="px-2 rounded-lg text-fg/60 hover:text-danger hover:bg-red-500/10">✕</button>
                    )}
                  </div>
                  {['QR', 'Check'].includes(t.method) && (
                    <input type="text" value={t.reference} onChange={e => setRow(i, 'reference', e.target.value)}
                      placeholder={t.method === 'Check' ? 'Check No. (required)' : 'Reference No. (required)'} aria-label={`Payment ${i + 1} reference`}
                      className={`w-full bg-surface border rounded-lg px-2 py-1.5 text-fg text-xs font-mono outline-none ${(t.reference || '').trim() ? 'border-white/10' : 'border-red-500/60'}`} />
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 text-xs">
                <button type="button" onClick={() => setPartialTenders([...tenders, { method: 'GCash', amount: '', reference: '' }])}
                  className="font-bold text-brand-text hover:underline">+ Split payment</button>
                <button type="button" onClick={() => setRow(0, 'amount', Math.max(0, fTotal - tenders.slice(1).reduce((s, t) => s + (Number(t.amount) || 0), 0)).toFixed(2))}
                  className="font-bold text-fg/70 hover:text-fg">Fill this batch (₱{fTotal.toFixed(2)})</button>
              </div>
              <div className="flex justify-between text-xs border-t border-white/10 pt-2">
                <span className="text-fg/70">Paying now</span>
                <span className="font-mono font-bold text-fg">₱{paidNow.toFixed(2)}</span>
              </div>
              <p className={`text-[10px] font-bold ${paidNow - fTotal > 0.005 ? 'text-success' : paidNow < fTotal - 0.005 ? 'text-warning' : 'text-fg/60'}`}>
                {paidNow - fTotal > 0.005 ? `₱${(paidNow - fTotal).toFixed(2)} kept as a deposit for the rest of the order`
                  : paidNow < fTotal - 0.005 ? `₱${(fTotal - paidNow).toFixed(2)} of this batch stays owed (receivable)`
                  : 'Exactly this batch'}
              </p>
            </div>
          )}

          <button onClick={submitPartialFulfill} disabled={partialBusy}
            className="w-full py-3 bg-brand text-on-brand font-black rounded-xl uppercase tracking-widest text-sm hover:bg-brand-dark transition disabled:opacity-50">
            {partialBusy ? 'Processing…' : 'Fulfill & Set Aside Remaining'}
          </button>
        </div>
      </div>
      );
}
