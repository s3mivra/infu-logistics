import { useState, useEffect } from 'react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard. Reads shared dashboard state via
// useDashboard() rather than props - see DashboardContext.
//
// Three modes:
//  - "Whole order" - the original flow, a single ₱ amount (full or partial-by-
//    dollar), calls /refund. A partial-by-dollar refund here still doesn't
//    touch inventory - it's a cash/revenue-only adjustment, same as before.
//  - "Select items" - pick specific line items and specific quantities within
//    them (not everything has to come back), calls /partial-refund. This one
//    DOES reverse inventory/COGS for exactly what's selected, and can be used
//    more than once on the same order as returns trickle in.
//  - "Exchange" - return some line(s)/qty AND add a replacement item, all on
//    the SAME order/receipt, net-settled in one cash movement (customer pays
//    the difference, or gets it back). Calls /exchange.
export default function RefundModal() {
  const { handleRefund, handlePartialRefund, handleExchange, refundForm, refundModal, refundSubmitting, setRefundForm, setRefundModal, products = [] } = useDashboard();
  const [mode, setMode] = useState('full'); // 'full' | 'items' | 'exchange'
  const [selectedQty, setSelectedQty] = useState({}); // itemIndex -> qty string
  const [replacements, setReplacements] = useState([{ productId: '', qty: '1' }]);

  // This modal doesn't unmount between orders, so its local selection state
  // would otherwise leak from one order's refund into the next one's item list.
  useEffect(() => { setMode('full'); setSelectedQty({}); setReplacements([{ productId: '', qty: '1' }]); }, [refundModal?._id]);

  if (!(refundModal)) return null;

  const items = refundModal.items || [];
  const remainingOf = (item) => Math.max(0, (Number(item.quantity) || 0) - (Number(item.refundedQty) || 0));
  const selectedItemsPayload = Object.entries(selectedQty)
    .map(([itemIndex, qty]) => ({ itemIndex: Number(itemIndex), qty: Number(qty) }))
    .filter(r => r.qty > 0);
  const returnValuePreview = selectedItemsPayload.reduce((s, r) => {
    const item = items[r.itemIndex];
    if (!item) return s;
    const addOnTotal = (item.selectedAddOns || []).reduce((a, o) => a + Number(o.price || 0), 0);
    return s + (Number(item.price || 0) + addOnTotal) * r.qty;
  }, 0);

  // Only real, sellable products (same "raw material has no SRP" rule the shop
  // uses elsewhere) can be picked as a replacement.
  const sellableProducts = products.filter(p => (p.basePrice || 0) > 0 && p.isAvailable !== false);
  const replacementsPayload = replacements
    .map(r => ({ productId: r.productId, quantity: Number(r.qty) }))
    .filter(r => r.productId && r.quantity > 0);
  const newChargePreview = replacementsPayload.reduce((s, r) => {
    const p = sellableProducts.find(x => x._id === r.productId);
    return s + (p ? Number(p.basePrice || 0) * r.quantity : 0);
  }, 0);
  const netDeltaPreview = newChargePreview - returnValuePreview;

  const close = () => { setRefundModal(null); setMode('full'); setSelectedQty({}); setReplacements([{ productId: '', qty: '1' }]); };

  const ItemPicker = () => (
    <div>
      <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1">{mode === 'exchange' ? 'Items to Return (optional)' : 'Items to Refund'}</label>
      <div className="space-y-1.5">
        {items.map((item, idx) => {
          const remaining = remainingOf(item);
          if (remaining <= 0) return (
            <div key={idx} className="flex items-center justify-between gap-2 bg-page-bg/50 border border-gray-800 rounded-lg px-3 py-2 opacity-40">
              <span className="text-xs font-bold text-fg/50 truncate">{item.name}</span>
              <span className="text-[10px] text-fg/40 font-bold uppercase shrink-0">Fully refunded</span>
            </div>
          );
          return (
            <div key={idx} className="flex items-center justify-between gap-2 bg-page-bg border border-gray-700 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-fg truncate">{item.name}</p>
                <p className="text-[10px] text-fg/40">
                  {remaining} of {item.quantity} refundable{Number(item.refundedQty) > 0 ? ` (${item.refundedQty} already refunded)` : ''} · ₱{Number(item.price || 0).toFixed(2)} ea
                </p>
              </div>
              <input type="number" min="0" max={remaining} step="1" placeholder="0"
                value={selectedQty[idx] ?? ''}
                onChange={e => {
                  const v = Math.max(0, Math.min(remaining, Number(e.target.value) || 0));
                  setSelectedQty(q => ({ ...q, [idx]: v === 0 ? '' : String(v) }));
                }}
                className="w-16 bg-surface border border-gray-700 rounded-lg px-2 py-1.5 text-fg text-sm text-right font-bold tabular-nums outline-none focus:border-brand/60 shrink-0" />
            </div>
          );
        })}
      </div>
    </div>
  );

  const InventoryActionPicker = ({ disabled, hint }) => (
    <div>
      <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1">Inventory & COGS</label>
      <div className="grid grid-cols-3 gap-2">
        {[
          { v: 'Restock', label: 'Restock', hint: 'Goods returned' },
          { v: 'Spoilage', label: 'Spoilage', hint: 'Goods wasted' },
          { v: 'None', label: 'No change', hint: 'Cash only' },
        ].map(opt => (
          <button key={opt.v} type="button" disabled={disabled}
            onClick={() => setRefundForm(p => ({ ...p, inventoryAction: opt.v }))}
            className={`flex flex-col items-center py-2 rounded-xl border text-[11px] font-bold transition disabled:opacity-40
              ${refundForm.inventoryAction === opt.v ? 'bg-brand/20 border-brand/60 text-fg' : 'bg-page-bg border-gray-700 text-gray-400 hover:border-brand/40'}`}>
            {opt.label}
            <span className="text-[9px] font-normal text-fg/30">{opt.hint}</span>
          </button>
        ))}
      </div>
      {hint && <p className="text-[10px] text-fg/30 mt-1">{hint}</p>}
    </div>
  );

  return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
        <div className="bg-surface border border-gray-700 rounded-2xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-black text-fg">Issue Refund</h2>
              <p className="text-xs text-gray-400 mt-0.5">{refundModal.orderNumber} · ₱{(refundModal.total||0).toFixed(2)}</p>
            </div>
            <button onClick={close} className="text-gray-500 hover:text-fg text-xl font-bold">✕</button>
          </div>

          {items.length > 0 && (
            <div className="flex bg-page-bg border border-gray-700 rounded-xl p-1">
              {[{ v: 'full', label: 'Whole Order' }, { v: 'items', label: 'Select Items' }, { v: 'exchange', label: 'Exchange' }].map(t => (
                <button key={t.v} type="button" onClick={() => setMode(t.v)}
                  className={`flex-1 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition ${mode === t.v ? 'bg-brand text-white' : 'text-gray-400 hover:text-fg'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {mode === 'full' && (
            <div>
              <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1">Refund Amount (₱)</label>
              <input type="number" min="0.01" max={refundModal.total} step="0.01"
                value={refundForm.refundAmount || refundModal.total}
                onChange={e => setRefundForm(p=>({...p,refundAmount:e.target.value}))}
                className="w-full bg-page-bg border border-gray-700 rounded-xl px-3 py-2.5 text-fg font-black tabular-nums outline-none focus:border-brand/60" />
              <p className="text-[10px] text-fg/30 mt-1">Max: ₱{(refundModal.total||0).toFixed(2)}</p>
            </div>
          )}

          {mode === 'items' && (
            <div>
              <ItemPicker />
              {selectedItemsPayload.length > 0 && (
                <p className="text-[11px] text-fg/50 mt-2">Estimated refund: <span className="text-fg font-bold">₱{returnValuePreview.toFixed(2)}</span> <span className="text-fg/30">(server computes the exact, discount/VAT-adjusted amount)</span></p>
              )}
            </div>
          )}

          {mode === 'exchange' && (
            <div className="space-y-3">
              <ItemPicker />
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-gray-400 font-bold uppercase">Replacement Item(s) *</label>
                  <button type="button" onClick={() => setReplacements(r => [...r, { productId: '', qty: '1' }])}
                    className="text-[10px] font-bold text-brand hover:text-brand/80">+ Add another</button>
                </div>
                <div className="space-y-1.5">
                  {replacements.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <select value={r.productId} onChange={e => setReplacements(rs => rs.map((x, xi) => xi === i ? { ...x, productId: e.target.value } : x))}
                        className="flex-1 min-w-0 bg-page-bg border border-gray-700 rounded-lg px-2 py-1.5 text-fg text-xs outline-none focus:border-brand/60">
                        <option value="">- Pick item -</option>
                        {sellableProducts.map(p => <option key={p._id} value={p._id}>{p.name} (₱{Number(p.basePrice||0).toFixed(2)})</option>)}
                      </select>
                      <input type="number" min="1" step="1" value={r.qty}
                        onChange={e => setReplacements(rs => rs.map((x, xi) => xi === i ? { ...x, qty: e.target.value } : x))}
                        className="w-14 bg-surface border border-gray-700 rounded-lg px-2 py-1.5 text-fg text-sm text-right font-bold tabular-nums outline-none focus:border-brand/60 shrink-0" />
                      {replacements.length > 1 && (
                        <button type="button" onClick={() => setReplacements(rs => rs.filter((_, xi) => xi !== i))} className="text-gray-500 hover:text-red-400 text-sm shrink-0">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {(selectedItemsPayload.length > 0 || replacementsPayload.length > 0) && (
                <div className="bg-page-bg border border-gray-700 rounded-lg px-3 py-2 text-[11px] space-y-0.5">
                  <p className="text-fg/50">Returned value: <span className="text-fg font-bold">₱{returnValuePreview.toFixed(2)}</span></p>
                  <p className="text-fg/50">Replacement charge: <span className="text-fg font-bold">₱{newChargePreview.toFixed(2)}</span></p>
                  <p className="text-fg/50 pt-1 border-t border-gray-800 mt-1">
                    {Math.abs(netDeltaPreview) < 0.01 ? 'Even swap - no cash movement.' : netDeltaPreview > 0
                      ? <>Customer pays <span className="text-fg font-bold">₱{netDeltaPreview.toFixed(2)}</span> more</>
                      : <>Customer gets <span className="text-fg font-bold">₱{Math.abs(netDeltaPreview).toFixed(2)}</span> back</>}
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1">Reason *</label>
            <textarea rows={2} value={refundForm.reason} onChange={e => setRefundForm(p=>({...p,reason:e.target.value}))}
              placeholder="e.g. Wrong order, product defect, customer complaint"
              className="w-full bg-page-bg border border-gray-700 rounded-xl px-3 py-2.5 text-fg text-sm outline-none focus:border-brand/60 resize-none placeholder-white/20" />
          </div>

          {mode === 'full' && (() => {
            const amt = parseFloat(refundForm.refundAmount) || refundModal.total;
            const isFull = Math.abs(amt - (refundModal.total || 0)) <= 0.01;
            return <InventoryActionPicker disabled={!isFull} hint={!isFull ? 'Partial refunds adjust cash & revenue only - inventory/COGS unchanged. Use "Select Items" for a return that also puts stock back.' : ''} />;
          })()}
          {mode === 'items' && <InventoryActionPicker hint='Applies only to the selected items/qty above - the rest of the order is untouched.' />}
          {mode === 'exchange' && <InventoryActionPicker hint="Applies to the returned item(s) above, if any. The replacement is always deducted from stock like a normal sale." />}

          <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-2 text-xs text-red-300">
            {mode === 'full' && <>⚠ Returns ₱{(parseFloat(refundForm.refundAmount)||refundModal.total).toFixed(2)} to customer. Creates reversal journal entry. Cannot be undone.</>}
            {mode === 'items' && <>⚠ Refunds the selected item(s)/qty only. Creates a reversal journal entry. Cannot be undone, but the rest of the order can still be refunded later.</>}
            {mode === 'exchange' && <>⚠ Processes the return and the replacement together as one entry on this order. Cannot be undone.</>}
          </div>

          <button
            onClick={() => {
              if (mode === 'full') handleRefund();
              else if (mode === 'items') handlePartialRefund(selectedItemsPayload);
              else handleExchange(selectedItemsPayload, replacementsPayload);
            }}
            disabled={refundSubmitting || (mode === 'items' && selectedItemsPayload.length === 0) || (mode === 'exchange' && replacementsPayload.length === 0)}
            className="w-full py-3 bg-red-600 text-white font-black rounded-xl uppercase tracking-widest text-sm hover:bg-red-500 transition disabled:opacity-50">
            {refundSubmitting ? 'Processing…' : mode === 'exchange' ? 'Confirm Exchange' : 'Confirm Refund'}
          </button>
        </div>
      </div>
  );
}
