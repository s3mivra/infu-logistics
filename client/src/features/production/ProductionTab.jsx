import { useState, useEffect, useCallback } from 'react';
import { Factory, Plus, Trash2, Check, X, Package, Clock, ClipboardCheck } from 'lucide-react';
import * as ui from '../../shared/ui';

// Approval decision - Pending -> Approved/Rejected.
const STATUS_CLS = {
  Pending:  'bg-yellow-500/15 text-yellow-400',
  Approved: 'bg-green-500/15 text-green-500',
  Rejected: 'bg-red-500/15 text-red-400',
};
// Fulfillment - only meaningful once Approved. Processing (materials spent,
// actual yield not yet confirmed) -> Complete/Partial once reconciled,
// mirroring how a Purchase Order's Ordered/Processing/Complete/Incomplete
// tracks what actually arrived vs what was ordered.
const FULFILLMENT_CLS = {
  Processing: 'bg-blue-500/15 text-blue-400',
  Partial:    'bg-orange-500/15 text-orange-400',
  Complete:   'bg-green-500/15 text-green-500',
};

// Production Orders (logistics deployments): materials taken from Inventory,
// held for approval, then - once approved - actually consumed to create or
// top up a finished item, batch-stamped. Mirrors the Requisitions/Approvals
// shape already used for petty-cash and procurement, just for stock instead
// of money. See server/features/production.js for the approval-time logic.
export default function ProductionTab({ ctx }) {
  const { apiFetch, inventory = [], stockCategories = [], stockLocations = [], can, fetchERPData, itemDisplay } = ctx;
  const canApprove = can('production.approve');

  // Quantities throughout this tab are entered in PIECES, same convention as
  // Stock Transfers: for a packed item ("CONDENSED MILK 377G") one piece is
  // packBase base units (377), not the raw g/ml number. An item with no real
  // pack size just falls back to its plain display unit (perPiece = 1), so
  // nothing changes for unpacked items. See itemDisplay()/packInfo() in
  // AdminDashboard.jsx.
  const pieceInfo = (item) => {
    const d = item && itemDisplay ? itemDisplay(item) : null;
    const perPiece = Number(d?.isPacked ? d.packBase : 1) || 1;
    const label = d?.isPacked ? 'pcs' : (d?.unit || item?.unit || 'units');
    const onHandPieces = item ? +(((item.stockQty || 0) / perPiece).toFixed(4)) : 0;
    return { perPiece, label, onHandPieces };
  };

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [rejecting, setRejecting] = useState(null);   // order being rejected
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [reconciling, setReconciling] = useState(null); // order being reconciled
  const [actualQty, setActualQty] = useState('');

  // ── Filing form ────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [materials, setMaterials] = useState([]); // [{invId, name, pieceLabel, pieces, baseQty}]
  const [matPick, setMatPick] = useState('');
  const [matQty, setMatQty] = useState(''); // pieces
  const [outputType, setOutputType] = useState('existing'); // 'existing' | 'new'
  const [outputInvId, setOutputInvId] = useState('');
  const [outputName, setOutputName] = useState('');
  const [outputUnit, setOutputUnit] = useState('pcs');
  const [outputPackSize, setOutputPackSize] = useState(''); // 'new' only - base units per piece
  const [outputQty, setOutputQty] = useState(''); // pieces when 'existing'; base units of outputUnit when 'new'
  const [outputStockCategory, setOutputStockCategory] = useState('');
  const [outputStockLocation, setOutputStockLocation] = useState('');
  const [outputExpiryDate, setOutputExpiryDate] = useState('');
  const [productionDate, setProductionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const outputItem = outputType === 'existing' ? inventory.find(i => i._id === outputInvId) : null;
  const outputPieceInfo = pieceInfo(outputItem);

  const fetchOrders = useCallback(async (status) => {
    setLoading(true);
    try {
      const qs = status ? `?status=${status}` : '';
      const res = await apiFetch(`/api/production-orders${qs}`);
      const data = await res.json();
      if (data.success) setOrders(data.orders);
    } catch { /* keep last-known list on a transient failure */ }
    finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { fetchOrders(statusFilter); }, [fetchOrders, statusFilter]);

  const resetForm = () => {
    setMaterials([]); setMatPick(''); setMatQty('');
    setOutputType('existing'); setOutputInvId(''); setOutputName(''); setOutputUnit('pcs'); setOutputPackSize(''); setOutputQty('');
    setOutputStockCategory(''); setOutputStockLocation(''); setOutputExpiryDate('');
    setProductionDate(new Date().toISOString().slice(0, 10)); setNotes('');
  };

  const addMaterial = () => {
    const item = inventory.find(i => i._id === matPick);
    const pieces = parseFloat(matQty);
    if (!item) return ui.alert('Pick a material.');
    if (!pieces || pieces <= 0) return ui.alert('Enter a positive quantity.');
    if (materials.some(m => m.invId === item._id)) return ui.alert(`${item.itemName} is already in this order - remove it first to change the quantity.`);
    const { perPiece, label, onHandPieces } = pieceInfo(item);
    if (pieces > onHandPieces + 1e-6) return ui.alert(`Only ${onHandPieces} ${label} of ${item.itemName} on hand.`);
    setMaterials(m => [...m, { invId: item._id, name: item.itemName, pieceLabel: label, pieces, baseQty: +(pieces * perPiece).toFixed(6) }]);
    setMatPick(''); setMatQty('');
  };
  const removeMaterial = (invId) => setMaterials(m => m.filter(x => x.invId !== invId));

  const submitOrder = async () => {
    if (materials.length === 0) return ui.alert('Add at least one material.');
    if (outputType === 'existing' && !outputInvId) return ui.alert('Choose the item this production adds to.');
    if (outputType === 'new' && !outputName.trim()) return ui.alert('Name the new product.');
    const qtyEntered = parseFloat(outputQty);
    if (!qtyEntered || qtyEntered <= 0) return ui.alert('Enter a positive output quantity.');
    // 'existing' output is also counted in pieces (of that item's own pack
    // size); 'new' output has no item yet to derive a pack size from, so it's
    // entered directly in outputUnit's base units.
    const outputBaseQty = outputType === 'existing' ? +(qtyEntered * outputPieceInfo.perPiece).toFixed(6) : qtyEntered;

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/production-orders', {
        method: 'POST',
        body: JSON.stringify({
          materials: materials.map(m => ({ invId: m.invId, qty: m.baseQty })),
          outputType,
          outputInvId: outputType === 'existing' ? outputInvId : undefined,
          outputName: outputType === 'new' ? outputName.trim() : undefined,
          outputUnit: outputType === 'new' ? outputUnit : undefined,
          outputPackSize: outputType === 'new' ? (outputPackSize || undefined) : undefined,
          outputQty: outputBaseQty,
          outputStockCategory: outputType === 'new' ? outputStockCategory : undefined,
          outputStockLocation: outputType === 'new' ? outputStockLocation : undefined,
          outputExpiryDate: outputExpiryDate || undefined,
          productionDate,
          notes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        ui.toast('Production order filed - awaiting approval.');
        resetForm();
        setFormOpen(false);
        fetchOrders(statusFilter);
      } else {
        ui.alert(data.error || 'Failed to file the production order.');
      }
    } catch { ui.alert('Failed to file the production order. Check your connection.'); }
    finally { setSubmitting(false); }
  };

  const approveOrder = async (order) => {
    // Approving only consumes the materials now - the output isn't credited
    // until someone confirms the actual yield (see reconcileOrder below), so
    // the confirmation here is honest about what actually happens.
    if (!(await ui.confirm(`Approve production batch for ${order.outputName}? This will decrease the materials now. The output stock is added once the actual quantity produced is confirmed (Reconcile).`))) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/production-orders/${order._id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      const data = await res.json();
      if (data.success) {
        fetchOrders(statusFilter);
        fetchERPData?.();
      } else {
        ui.alert(data.error || 'Failed to approve.');
      }
    } catch { ui.alert('Failed to approve. Check your connection.'); }
    finally { setBusy(false); }
  };

  // The manual "how much did we actually get" step - mirrors typing a
  // Purchase Order's receivedQty. Credits the output at THIS figure, not
  // the planned outputQty.
  const submitReconcile = async () => {
    const qty = parseFloat(actualQty);
    if (!qty || qty <= 0) return ui.alert('Enter the actual quantity produced.');
    setBusy(true);
    try {
      const res = await apiFetch(`/api/production-orders/${reconciling._id}/reconcile`, { method: 'POST', body: JSON.stringify({ actualOutputQty: qty }) });
      const data = await res.json();
      if (data.success) {
        setReconciling(null); setActualQty('');
        fetchOrders(statusFilter);
        fetchERPData?.();
      } else {
        ui.alert(data.error || 'Failed to reconcile.');
      }
    } catch { ui.alert('Failed to reconcile. Check your connection.'); }
    finally { setBusy(false); }
  };

  const submitReject = async () => {
    if (!rejectReason.trim()) return ui.alert('A reason is required.');
    setBusy(true);
    try {
      const res = await apiFetch(`/api/production-orders/${rejecting._id}/reject`, { method: 'POST', body: JSON.stringify({ reason: rejectReason }) });
      const data = await res.json();
      if (data.success) { setRejecting(null); setRejectReason(''); fetchOrders(statusFilter); }
      else ui.alert(data.error || 'Failed to reject.');
    } catch { ui.alert('Failed to reject. Check your connection.'); }
    finally { setBusy(false); }
  };

  const cancelOrder = async (order) => {
    if (!(await ui.confirm('Cancel this production order?'))) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/production-orders/${order._id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
      const data = await res.json();
      if (data.success) fetchOrders(statusFilter);
      else ui.alert(data.error || 'Failed to cancel.');
    } catch { ui.alert('Failed to cancel. Check your connection.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-5 flex-wrap gap-3">
        <h2 className="text-xl font-bold text-fg flex items-center gap-2">
          <Factory size={20} className="text-accent" /> Production
        </h2>
        <button onClick={() => setFormOpen(o => !o)}
          className="flex items-center gap-1.5 bg-accent text-white px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-accent/90 transition">
          <Plus size={14} /> {formOpen ? 'Close' : 'New Production Order'}
        </button>
      </div>

      {formOpen && (
        <div className="bg-surface border border-white/10 rounded-xl p-5 mb-6 space-y-5">
          {/* Materials */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-fg/40 mb-2">Materials consumed</p>
            <div className="flex flex-wrap gap-2 mb-2">
              <select value={matPick} onChange={e => setMatPick(e.target.value)}
                className="flex-1 min-w-[200px] bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent">
                <option value="">Choose an item…</option>
                {inventory.map(i => {
                  const { label, onHandPieces } = pieceInfo(i);
                  return <option key={i._id} value={i._id}>{i.itemName} ({onHandPieces} {label} on hand)</option>;
                })}
              </select>
              <input type="number" min="0" step="0.01" placeholder={matPick ? pieceInfo(inventory.find(i => i._id === matPick)).label : 'Qty'}
                value={matQty} onChange={e => setMatQty(e.target.value)}
                className="w-24 bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
              <button onClick={addMaterial} className="bg-accent/15 text-accent px-3 py-2 rounded-lg font-bold text-xs uppercase hover:bg-accent/25 transition">Add</button>
            </div>
            {/* Quantities are counted in pieces - for a packed item ("...377G")
                1 piece = 377g, not the raw gram figure. */}
            {materials.length > 0 && (
              <ul className="space-y-1.5">
                {materials.map(m => (
                  <li key={m.invId} className="flex items-center justify-between bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm">
                    <span className="text-fg/80">{m.name} <span className="text-fg/40 font-mono">× {m.pieces} {m.pieceLabel}</span></span>
                    <button onClick={() => removeMaterial(m.invId)} className="text-red-400/70 hover:text-red-400"><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Output */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-fg/40 mb-2">Produces</p>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setOutputType('existing')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${outputType === 'existing' ? 'bg-accent text-white' : 'bg-page-bg text-fg/50 border border-white/10'}`}>
                Add to existing item
              </button>
              <button onClick={() => setOutputType('new')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${outputType === 'new' ? 'bg-accent text-white' : 'bg-page-bg text-fg/50 border border-white/10'}`}>
                Create a new product
              </button>
            </div>

            {outputType === 'existing' ? (
              <select value={outputInvId} onChange={e => setOutputInvId(e.target.value)}
                className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent mb-2">
                <option value="">Choose the item to add to…</option>
                {inventory.map(i => {
                  const { label, onHandPieces } = pieceInfo(i);
                  return <option key={i._id} value={i._id}>{i.itemName} ({onHandPieces} {label} on hand)</option>;
                })}
              </select>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <input type="text" placeholder="New product name" value={outputName} onChange={e => setOutputName(e.target.value)}
                  className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
                <input type="text" placeholder="Unit (e.g. g, ml, pcs)" value={outputUnit} onChange={e => setOutputUnit(e.target.value)}
                  className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
                {/* Optional: how many of that unit make up ONE piece (e.g. 377
                    for "...377G"). Doesn't affect THIS batch's math - it just
                    tags the new item's own pack size so every later
                    production run against it can also be counted in pieces,
                    same as every other packed item in Inventory. */}
                <input type="number" min="0" step="0.01" placeholder={`Pack size (optional) - e.g. 377 ${outputUnit || 'g'} per pc`}
                  value={outputPackSize} onChange={e => setOutputPackSize(e.target.value)}
                  className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent sm:col-span-2" />
                <select value={outputStockCategory} onChange={e => setOutputStockCategory(e.target.value)}
                  className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent">
                  <option value="">Stock category (optional)</option>
                  {stockCategories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                </select>
                <select value={outputStockLocation} onChange={e => setOutputStockLocation(e.target.value)}
                  className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent">
                  <option value="">Stock location (optional)</option>
                  {stockLocations.map(l => <option key={l._id} value={l.name}>{l.name}</option>)}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input type="number" min="0" step="0.01"
                placeholder={outputType === 'existing' ? `Output quantity (${outputPieceInfo.label})` : `Output quantity (${outputUnit || 'units'})`}
                value={outputQty} onChange={e => setOutputQty(e.target.value)}
                className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
              <div>
                <label className="text-[9px] text-fg/40 uppercase tracking-wider block mb-1">Production date</label>
                <input type="date" value={productionDate} onChange={e => setProductionDate(e.target.value)}
                  className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
              </div>
              <div>
                <label className="text-[9px] text-fg/40 uppercase tracking-wider block mb-1">Expiry date (optional)</label>
                <input type="date" value={outputExpiryDate} onChange={e => setOutputExpiryDate(e.target.value)}
                  className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
              </div>
            </div>
          </div>

          <textarea placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-none" />

          <button onClick={submitOrder} disabled={submitting}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-bold text-sm py-2.5 rounded-lg transition">
            {submitting ? 'Filing…' : 'File Production Order'}
          </button>
        </div>
      )}

      {/* Queue */}
      <div className="flex gap-2 mb-4">
        {['Pending', 'Approved', 'Rejected', ''].map(s => (
          <button key={s || 'all'} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition ${statusFilter === s ? 'bg-accent text-white' : 'bg-white/5 text-fg/50 hover:text-fg'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-fg/40 text-sm text-center py-10">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Package size={36} className="text-fg/10 mb-3" />
          <p className="text-fg/40 text-sm font-bold">No production orders {statusFilter ? `in ${statusFilter}` : 'yet'}.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.map(o => (
            <li key={o._id} className="bg-surface border border-white/10 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                <div>
                  <p className="font-bold text-fg text-sm">
                    {o.outputName} <span className="text-fg/40 font-normal">× {o.outputQty}{o.outputUnit}</span>
                  </p>
                  <p className="text-[10px] text-fg/40 mt-0.5">
                    {o.outputType === 'new' ? 'New product' : 'Adds to existing item'} · filed by {o.requestedBy || '—'}
                    {o.batchNumber && <span className="font-mono text-accent"> · {o.batchNumber}</span>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full ${STATUS_CLS[o.status] || ''}`}>{o.status}</span>
                  {o.fulfillmentStatus && (
                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full ${FULFILLMENT_CLS[o.fulfillmentStatus] || ''}`}>{o.fulfillmentStatus}</span>
                  )}
                </div>
              </div>

              <div className="text-xs text-fg/60 space-y-0.5 mb-2">
                {(o.materials || []).map(m => (
                  <p key={m.invId}>{m.itemName} <span className="text-fg/30 font-mono">× {m.qty}{m.unit}</span></p>
                ))}
              </div>

              {/* Once reconciled, show planned vs actual - the whole point of
                  this step is that yield isn't guaranteed, so the gap (if
                  any) should be visible, not just the final number. */}
              {o.actualOutputQty != null && (
                <p className="text-xs mb-1">
                  <span className="text-fg/40">Planned {o.outputQty}{o.outputUnit} → Actual</span>{' '}
                  <span className={o.fulfillmentStatus === 'Partial' ? 'text-orange-400 font-bold' : 'text-green-400 font-bold'}>
                    {o.actualOutputQty}{o.outputUnit}
                  </span>
                </p>
              )}

              <p className="text-[10px] text-fg/30 flex items-center gap-1.5">
                <Clock size={11} /> {new Date(o.createdAt).toLocaleString()}
              </p>
              {o.notes && <p className="text-fg/50 text-xs mt-1 italic">"{o.notes}"</p>}
              {o.status === 'Rejected' && o.rejectionReason && (
                <p className="text-red-400 text-xs mt-1">Reason: {o.rejectionReason}</p>
              )}

              {o.status === 'Pending' && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                  {canApprove && (
                    <>
                      <button onClick={() => approveOrder(o)} disabled={busy}
                        className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition">
                        <Check size={13} /> Approve
                      </button>
                      <button onClick={() => setRejecting(o)} disabled={busy}
                        className="flex items-center gap-1.5 border border-red-500/30 text-red-300 hover:bg-red-500/10 font-bold text-xs px-3 py-1.5 rounded-lg transition">
                        <X size={13} /> Reject
                      </button>
                    </>
                  )}
                  <button onClick={() => cancelOrder(o)} disabled={busy}
                    className="ml-auto text-fg/30 hover:text-fg text-[11px] font-bold uppercase tracking-wider transition">
                    Cancel
                  </button>
                </div>
              )}

              {o.status === 'Approved' && o.fulfillmentStatus === 'Processing' && canApprove && (
                <div className="flex items-center mt-3 pt-3 border-t border-white/5">
                  <button onClick={() => { setReconciling(o); setActualQty(String(o.outputQty)); }} disabled={busy}
                    className="flex items-center gap-1.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition">
                    <ClipboardCheck size={13} /> Reconcile - confirm actual output
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Reject reason modal */}
      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setRejecting(null)}>
          <div className="bg-surface border border-white/10 rounded-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-fg mb-2">Reject production order</h3>
            <p className="text-fg/50 text-xs mb-3">{rejecting.outputName} × {rejecting.outputQty}{rejecting.outputUnit}</p>
            <textarea autoFocus value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
              placeholder="Reason for rejecting…"
              className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-none mb-3" />
            <div className="flex gap-2">
              <button onClick={() => setRejecting(null)} className="flex-1 border border-white/10 text-fg/60 hover:text-fg py-2 rounded-lg text-xs font-bold uppercase transition">Cancel</button>
              <button onClick={submitReject} disabled={busy} className="flex-1 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white py-2 rounded-lg text-xs font-bold uppercase transition">Reject</button>
            </div>
          </div>
        </div>
      )}
      {/* Reconcile modal - the manual "actual output qty" input, like typing
          a Purchase Order's received quantity. */}
      {reconciling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setReconciling(null)}>
          <div className="bg-surface border border-white/10 rounded-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-fg mb-1 flex items-center gap-1.5"><ClipboardCheck size={16} className="text-accent" /> Confirm actual output</h3>
            <p className="text-fg/50 text-xs mb-3">{reconciling.outputName} - planned {reconciling.outputQty}{reconciling.outputUnit}</p>
            <label className="text-[9px] text-fg/40 uppercase tracking-wider block mb-1">Actual quantity produced ({reconciling.outputUnit})</label>
            <input type="number" min="0" step="0.01" autoFocus value={actualQty} onChange={e => setActualQty(e.target.value)}
              className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent mb-1" />
            <p className="text-[10px] text-fg/30 mb-3">
              Meets or beats {reconciling.outputQty}{reconciling.outputUnit} → marked <span className="text-green-400 font-bold">Complete</span>.
              Falls short → marked <span className="text-orange-400 font-bold">Partial</span>. This is what actually gets added to stock.
            </p>
            <div className="flex gap-2">
              <button onClick={() => { setReconciling(null); setActualQty(''); }} className="flex-1 border border-white/10 text-fg/60 hover:text-fg py-2 rounded-lg text-xs font-bold uppercase transition">Cancel</button>
              <button onClick={submitReconcile} disabled={busy} className="flex-1 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white py-2 rounded-lg text-xs font-bold uppercase transition">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
