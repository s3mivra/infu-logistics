import { useState, useEffect, useCallback, useMemo } from 'react';
import { Factory, Plus, Trash2, Check, X, Package, Clock, ClipboardCheck } from 'lucide-react';
import * as ui from '../../shared/ui';
import { reconcileUnitOptions as reconcileUnitsFor, plannedUnitChoice as plannedUnitFor, toBaseQty, inUnit, restateQty } from '../../shared/productionUnits';

// Approval decision - Pending -> Approved/Rejected.
const STATUS_CLS = {
  Pending:  'bg-yellow-500/15 text-warning',
  Approved: 'bg-green-500/15 text-success',
  Rejected: 'bg-red-500/15 text-danger',
};
// Fulfillment - only meaningful once Approved. Processing (materials spent,
// actual yield not yet confirmed) -> Complete/Partial once reconciled,
// mirroring how a Purchase Order's Ordered/Processing/Complete/Incomplete
// tracks what actually arrived vs what was ordered.
const FULFILLMENT_CLS = {
  Processing: 'bg-blue-500/15 text-info',
  Partial:    'bg-orange-500/15 text-warning',
  Complete:   'bg-green-500/15 text-success',
};

// Production Orders (logistics deployments): materials taken from Inventory,
// held for approval, then - once approved - actually consumed to create or
// top up a finished item, batch-stamped. Mirrors the Requisitions/Approvals
// shape already used for petty-cash and procurement, just for stock instead
// of money. See server/features/production.js for the approval-time logic.
export default function ProductionTab({ ctx }) {
  const { apiFetch, inventory = [], products = [], stockCategories = [], stockLocations = [], can, fetchERPData, itemDisplay, exportProductionOrdersPDF } = ctx;
  const canApprove = can('production.approve');

  // Quantities throughout this tab are entered in PIECES, same convention as
  // Stock Transfers: for a packed item ("CONDENSED MILK 377G") one piece is
  // packBase base units (377), not the raw g/ml number. An item with no real
  // pack size just falls back to its plain display unit (perPiece = 1), so
  // nothing changes for unpacked items. See itemDisplay()/packInfo() in
  // AdminDashboard.jsx.
  // What a production run may be counted in, per item. Forcing everything into
  // "pieces" is wrong the moment a batch uses 1.7 L of milk: the person making
  // it thinks in litres, and a packed 1L carton counted as "1.7 pcs" is a
  // quantity nobody would write down that way. Each option carries how many
  // BASE units (g/ml/pcs) one of it is worth, which is what the server stores.
  const unitOptions = (item) => {
    if (!item) return [{ label: 'units', factor: 1 }];
    const d = itemDisplay ? itemDisplay(item) : null;
    const baseUnit = item.unit || 'units';
    const displayUnit = item.displayUnit || baseUnit;
    const perDisplay = Number(item.unitMultiplier) || 1;   // e.g. 1000 ml per L
    const out = [];
    // A packed item keeps pieces as its first option - that is how a carton or
    // a sack is counted - but no longer as its only one.
    if (d?.isPacked && Number(d.packBase) > 0) out.push({ label: 'pcs', factor: Number(d.packBase) });
    if (perDisplay > 1) out.push({ label: displayUnit, factor: perDisplay });
    out.push({ label: baseUnit, factor: 1 });
    // Dedupe by label, keeping the first (most natural) reading.
    return out.filter((o, i) => out.findIndex(x => x.label === o.label) === i);
  };
  // How much is on hand, expressed in a chosen unit.
  const onHandIn = (item, factor) => +(((item?.stockQty || 0) / (factor || 1)).toFixed(4));

  const pieceInfo = (item) => {
    const d = item && itemDisplay ? itemDisplay(item) : null;
    const perPiece = Number(d?.isPacked ? d.packBase : 1) || 1;
    const label = d?.isPacked ? 'pcs' : (d?.unit || item?.unit || 'units');
    const onHandPieces = item ? +(((item.stockQty || 0) / perPiece).toFixed(4)) : 0;
    return { perPiece, label, onHandPieces };
  };

  // What the RECONCILE step may count the yield in, and which of those the
  // batch was planned in. The arithmetic lives in shared/productionUnits.js
  // with its own tests - this file only supplies the item's own unit list.
  const itemUnitsFor = (order) => {
    if (order?.outputType !== 'existing') return null;
    const item = inventory.find(i => i._id === order.outputInvId);
    return item ? unitOptions(item) : null;
  };
  const reconcileUnitOptions = (order) => reconcileUnitsFor(order, itemUnitsFor(order));
  const plannedUnitChoice = (order) => plannedUnitFor(order, itemUnitsFor(order));

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [rejecting, setRejecting] = useState(null);   // order being rejected
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [reconciling, setReconciling] = useState(null); // order being reconciled
  const [actualQty, setActualQty] = useState('');
  // Which unit the actual yield is being typed in. Defaults to the unit the
  // batch was planned in; changing it is the operator's own decision.
  const [reconcileUnit, setReconcileUnit] = useState('');

  // ── Filing form ────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [materials, setMaterials] = useState([]); // [{invId, name, pieceLabel, pieces, baseQty}]
  const [matPick, setMatPick] = useState('');
  const [matQty, setMatQty] = useState('');
  // Which unit that quantity is in - blank means the item's most natural one
  // (pieces for a packed carton, litres for milk, kilos for beans).
  const [matUnit, setMatUnit] = useState('');
  // Same idea for the output quantity; blank means that item's natural unit.
  const [outputQtyUnit, setOutputQtyUnit] = useState('');
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

  // ── BUILD FROM RECIPE ──────────────────────────────────────────────────────
  // A cafe makes Spanish Milk, Breve Milk and cold brew from bought-in stock,
  // and the recipe for each is already on file - it is what the POS deducts
  // when one is sold. Filing the batch that PRODUCES them, though, meant
  // re-picking every ingredient and re-typing every quantity, every time. The
  // two drift apart the moment a recipe is edited, and nothing warns you.
  //
  // So: pick the thing you are making, say how many, and the materials are the
  // recipe scaled by that number. Still fully editable afterwards - a real
  // batch is not always exactly the book quantity.
  const [recipeProductId, setRecipeProductId] = useState('');
  const [recipeBatchQty, setRecipeBatchQty] = useState('');

  // Only products whose recipe actually points at stock are offerable: a
  // recipe line with no invId names an ingredient the system cannot deduct,
  // so it could not drive a production order.
  const recipeProducts = useMemo(
    () => (products || [])
      .filter(p => (p.baseRecipe || []).some(r => r.invId && Number(r.qty) > 0))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [products],
  );

  const applyRecipe = () => {
    const product = recipeProducts.find(p => p._id === recipeProductId);
    const batch = parseFloat(recipeBatchQty);
    if (!product) return ui.alert('Choose what you are making.');
    if (!batch || batch <= 0) return ui.alert('Enter how many you are making.');

    const lines = [];
    const missing = [];
    const short = [];
    for (const r of product.baseRecipe || []) {
      if (!r.invId || !(Number(r.qty) > 0)) continue;
      const item = inventory.find(i => String(i._id) === String(r.invId));
      // A recipe can outlive the stock item it names - say so rather than
      // silently filing a batch that is missing an ingredient.
      if (!item) { missing.push(r.name || 'an unnamed ingredient'); continue; }
      // Recipe qty is base units per ONE unit of the product, so the batch
      // multiplies it directly. It is then shown in whichever unit reads most
      // naturally for that ingredient - litres of milk, not 1700 ml.
      const baseQty = +(Number(r.qty) * batch).toFixed(6);
      const [natural] = unitOptions(item);
      const shown = +(baseQty / natural.factor).toFixed(4);
      const available = onHandIn(item, natural.factor);
      if (shown > available + 1e-6) short.push(`${item.itemName} (need ${shown} ${natural.label}, have ${available})`);
      lines.push({ invId: item._id, name: item.itemName, pieceLabel: natural.label, pieces: shown, baseQty });
    }

    if (lines.length === 0) return ui.alert(`No usable recipe lines on ${product.name}. Check that its ingredients are linked to stock items.`);

    setMaterials(lines);

    // Point the output at the matching stock item where one exists, so the
    // batch adds to it rather than creating a duplicate under the same name.
    const outItem = inventory.find(i => String(i.itemName || '').trim().toUpperCase() === String(product.name || '').trim().toUpperCase());
    if (outItem) {
      setOutputType('existing');
      setOutputInvId(outItem._id);
    } else {
      setOutputType('new');
      setOutputName(product.name || '');
    }
    setOutputQty(String(batch));

    // Shortages warn but do not block. Filing is a REQUEST - approval is what
    // actually consumes stock, and the server re-checks availability then. A
    // batch is often planned before the delivery it depends on lands.
    const notes = [];
    if (missing.length) notes.push(`Skipped ${missing.length} ingredient(s) no longer in stock records: ${missing.join(', ')}.`);
    if (short.length) notes.push(`Not enough on hand for: ${short.join('; ')}. You can still file this - stock is checked again at approval.`);
    if (notes.length) ui.alert(notes.join(String.fromCharCode(10, 10)));
  };



  const outputItem = outputType === 'existing' ? inventory.find(i => i._id === outputInvId) : null;
  const outputPieceInfo = pieceInfo(outputItem);
  // The same choice the materials get: a batch that yields 12 L of cold brew is
  // entered as 12 L, whatever pack size the item happens to carry.
  const outputUnitOptions = unitOptions(outputItem);
  const outputUnitChoice = outputUnitOptions.find(o => o.label === outputQtyUnit) || outputUnitOptions[0];

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
    setMaterials([]); setMatPick(''); setMatQty(''); setMatUnit(''); setOutputQtyUnit('');
    setOutputType('existing'); setOutputInvId(''); setOutputName(''); setOutputUnit('pcs'); setOutputPackSize(''); setOutputQty('');
    setOutputStockCategory(''); setOutputStockLocation(''); setOutputExpiryDate('');
    setProductionDate(new Date().toISOString().slice(0, 10)); setNotes('');
    setRecipeProductId(''); setRecipeBatchQty('');
  };

  const addMaterial = () => {
    const item = inventory.find(i => i._id === matPick);
    const entered = parseFloat(matQty);
    if (!item) return ui.alert('Pick a material.');
    if (!entered || entered <= 0) return ui.alert('Enter a positive quantity.');
    if (materials.some(m => m.invId === item._id)) return ui.alert(`${item.itemName} is already in this order - remove it first to change the quantity.`);
    // Whatever unit was chosen, the server is sent base units.
    const opts = unitOptions(item);
    const chosen = opts.find(o => o.label === matUnit) || opts[0];
    const available = onHandIn(item, chosen.factor);
    if (entered > available + 1e-6) return ui.alert(`Only ${available} ${chosen.label} of ${item.itemName} on hand.`);
    setMaterials(m => [...m, {
      invId: item._id, name: item.itemName,
      pieceLabel: chosen.label, pieces: entered,
      baseQty: +(entered * chosen.factor).toFixed(6),
    }]);
    setMatPick(''); setMatQty(''); setMatUnit('');
  };
  const removeMaterial = (invId) => setMaterials(m => m.filter(x => x.invId !== invId));

  const submitOrder = async () => {
    if (materials.length === 0) return ui.alert('Add at least one material.');
    if (outputType === 'existing' && !outputInvId) return ui.alert('Choose the item this production adds to.');
    if (outputType === 'new' && !outputName.trim()) return ui.alert('Name the new product.');
    const qtyEntered = parseFloat(outputQty);
    if (!qtyEntered || qtyEntered <= 0) return ui.alert('Enter a positive output quantity.');
    // 'existing' output is counted in whichever of that item's units was
    // chosen; 'new' output has no item yet to derive units from, so it is
    // entered directly in the unit typed beside its name.
    const outputBaseQty = outputType === 'existing'
      ? +(qtyEntered * (outputUnitChoice?.factor || 1)).toFixed(6)
      : qtyEntered;

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
          // The unit the figure above was typed in, so reconciling can ask for
          // the yield the same way round.
          outputEnteredUnit: outputType === 'existing' ? (outputUnitChoice?.label || '') : (outputUnit || ''),
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
    const enteredQty = parseFloat(actualQty);
    if (!enteredQty || enteredQty <= 0) return ui.alert('Enter the actual quantity produced.');
    // Converted from whichever unit is showing beside the box - never from a
    // unit the operator was not looking at.
    const opts = reconcileUnitOptions(reconciling);
    const chosen = opts.find(o => o.label === reconcileUnit) || opts[0];
    const qty = toBaseQty(enteredQty, chosen);
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
          <Factory size={20} className="text-brand-text" /> Production
        </h2>
        <div className="flex items-center gap-2">
          {/* Reconciled batches: planned vs actual, and the moisture/variance
              between them - the report doesn't exist until at least one
              batch has been reconciled. */}
          <button onClick={exportProductionOrdersPDF}
            className="flex items-center gap-1.5 bg-accent/10 hover:bg-accent/20 text-brand-text px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition">
            <ClipboardCheck size={14} /> Production Report
          </button>
          <button onClick={() => setFormOpen(o => !o)}
            className="flex items-center gap-1.5 bg-accent text-on-brand px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-accent/90 transition">
            <Plus size={14} /> {formOpen ? 'Close' : 'New Production Order'}
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="bg-surface border border-white/10 rounded-xl p-5 mb-6 space-y-5">
          {/* Materials */}
          {/* Build from a recipe - the fast path. The recipe is already on
              file (it is what the POS deducts on a sale); this fills the
              materials from it instead of re-typing them each batch. */}
          {recipeProducts.length > 0 && (
            <div className="bg-page-bg border border-white/10 rounded-lg p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-fg/70 mb-2">Build from a recipe</p>
              <div className="flex flex-wrap gap-2">
                <select value={recipeProductId} onChange={e => setRecipeProductId(e.target.value)}
                  className="flex-1 min-w-[200px] bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent">
                  <option value="">What are you making?</option>
                  {recipeProducts.map(p => (
                    <option key={p._id} value={p._id}>
                      {p.name} ({(p.baseRecipe || []).filter(r => r.invId).length} ingredients)
                    </option>
                  ))}
                </select>
                <input type="number" min="0" step="0.01" placeholder="How many"
                  value={recipeBatchQty} onChange={e => setRecipeBatchQty(e.target.value)}
                  className="w-28 bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
                <button onClick={applyRecipe}
                  className="bg-accent text-on-brand px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-accent/90 transition">
                  Fill materials
                </button>
              </div>
              <p className="text-[10px] text-fg/70 mt-2">
                Replaces the material list below with the recipe multiplied by the batch size, and points the output at the matching stock item. Edit anything afterwards - a real batch is not always the book quantity.
              </p>
            </div>
          )}

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-fg/70 mb-2">Materials consumed</p>
            <div className="flex flex-wrap gap-2 mb-2">
              <select value={matPick} onChange={e => { setMatPick(e.target.value); setMatUnit(''); }}
                className="flex-1 min-w-[200px] bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent">
                <option value="">Choose an item…</option>
                {inventory.map(i => {
                  const [natural] = unitOptions(i);
                  return <option key={i._id} value={i._id}>{i.itemName} ({onHandIn(i, natural.factor)} {natural.label} on hand)</option>;
                })}
              </select>
              <input type="number" min="0" step="any" placeholder="Qty" aria-label="Quantity"
                value={matQty} onChange={e => setMatQty(e.target.value)}
                className="w-24 bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
              {/* The unit this quantity is in. A batch that uses 1.7 L of milk
                  is entered as 1.7 L, not as a fraction of a carton. */}
              {(() => {
                const item = inventory.find(i => i._id === matPick);
                const opts = unitOptions(item);
                return (
                  <select value={matUnit || opts[0].label} onChange={e => setMatUnit(e.target.value)}
                    aria-label="Unit" disabled={!matPick}
                    className="w-24 bg-page-bg border border-white/10 rounded-lg px-2 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-50">
                    {opts.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
                  </select>
                );
              })()}
              <button onClick={addMaterial} className="bg-accent/15 text-brand-text px-3 py-2 rounded-lg font-bold text-xs uppercase hover:bg-accent/25 transition">Add</button>
            </div>
            {/* Each line carries the unit it was entered in; the server is sent
                base units either way, so a line reads the way the person making
                the batch would say it out loud. */}
            {materials.length > 0 && (
              <ul className="space-y-1.5">
                {materials.map(m => (
                  <li key={m.invId} className="flex items-center justify-between bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm">
                    <span className="text-fg/80">{m.name} <span className="text-fg/70 font-mono">× {m.pieces} {m.pieceLabel}</span></span>
                    <button onClick={() => removeMaterial(m.invId)} className="text-red-400/70 hover:text-danger"><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Output */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-fg/70 mb-2">Produces</p>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setOutputType('existing')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${outputType === 'existing' ? 'bg-accent text-on-brand' : 'bg-page-bg text-fg/75 border border-white/10'}`}>
                Add to existing item
              </button>
              <button onClick={() => setOutputType('new')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${outputType === 'new' ? 'bg-accent text-on-brand' : 'bg-page-bg text-fg/75 border border-white/10'}`}>
                Create a new product
              </button>
            </div>

            {outputType === 'existing' ? (
              <select value={outputInvId} onChange={e => { setOutputInvId(e.target.value); setOutputQtyUnit(''); }}
                className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent mb-2">
                <option value="">Choose the item to add to…</option>
                {inventory.map(i => {
                  const [natural] = unitOptions(i);
                  return <option key={i._id} value={i._id}>{i.itemName} ({onHandIn(i, natural.factor)} {natural.label} on hand)</option>;
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
              {/* Counted in whichever unit the output is naturally measured
                  in - litres of cold brew, kilos of ground coffee, pieces of a
                  packed item. */}
              <div className="flex gap-2">
                <input type="number" min="0" step="any" aria-label="Output quantity"
                  placeholder="Output quantity"
                  value={outputQty} onChange={e => setOutputQty(e.target.value)}
                  className="flex-1 min-w-0 bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
                {outputType === 'existing' ? (
                  <select value={outputQtyUnit || outputUnitOptions[0].label} onChange={e => setOutputQtyUnit(e.target.value)}
                    aria-label="Output unit" disabled={!outputInvId}
                    className="w-24 bg-page-bg border border-white/10 rounded-lg px-2 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-50">
                    {outputUnitOptions.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
                  </select>
                ) : (
                  <span className="w-24 flex items-center justify-center text-xs text-fg/60 border border-white/10 rounded-lg">{outputUnit || 'units'}</span>
                )}
              </div>
              <div>
                <label className="text-[9px] text-fg/70 uppercase tracking-wider block mb-1">Production date</label>
                <input type="date" value={productionDate} onChange={e => setProductionDate(e.target.value)}
                  className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
              </div>
              <div>
                <label className="text-[9px] text-fg/70 uppercase tracking-wider block mb-1">Expiry date (optional)</label>
                <input type="date" value={outputExpiryDate} onChange={e => setOutputExpiryDate(e.target.value)}
                  className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
              </div>
            </div>
          </div>

          <textarea placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-none" />

          <button onClick={submitOrder} disabled={submitting}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-on-brand font-bold text-sm py-2.5 rounded-lg transition">
            {submitting ? 'Filing…' : 'File Production Order'}
          </button>
        </div>
      )}

      {/* Queue */}
      <div className="flex gap-2 mb-4">
        {['Pending', 'Approved', 'Rejected', ''].map(s => (
          <button key={s || 'all'} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition ${statusFilter === s ? 'bg-accent text-on-brand' : 'bg-white/5 text-fg/75 hover:text-fg'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-fg/70 text-sm text-center py-10">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Package size={36} className="text-fg/10 mb-3" />
          <p className="text-fg/70 text-sm font-bold">No production orders {statusFilter ? `in ${statusFilter}` : 'yet'}.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.map(o => (
            <li key={o._id} className="bg-surface border border-white/10 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                <div>
                  <p className="font-bold text-fg text-sm">
                    {o.outputName} <span className="text-fg/70 font-normal">
                      × {(() => { const u = plannedUnitChoice(o); return `${inUnit(o.outputQty, u)} ${u.label}`; })()}
                    </span>
                  </p>
                  <p className="text-[10px] text-fg/70 mt-0.5">
                    {o.outputType === 'new' ? 'New product' : 'Adds to existing item'} · filed by {o.requestedBy || '-'}
                    {o.batchNumber && <span className="font-mono text-brand-text"> · {o.batchNumber}</span>}
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
                  <p key={m.invId}>{m.itemName} <span className="text-fg/65 font-mono">× {m.qty}{m.unit}</span></p>
                ))}
              </div>

              {/* Once reconciled, show planned vs actual - the whole point of
                  this step is that yield isn't guaranteed, so the gap (if
                  any) should be visible, not just the final number. */}
              {o.actualOutputQty != null && (() => {
                const choice = plannedUnitChoice(o);
                return (
                <p className="text-xs mb-1 flex items-center gap-2 flex-wrap">
                  <span>
                    <span className="text-fg/70">Planned {inUnit(o.outputQty, choice)} {choice.label} → Actual</span>{' '}
                    <span className={o.fulfillmentStatus === 'Partial' ? 'text-warning font-bold' : 'text-success font-bold'}>
                      {inUnit(o.actualOutputQty, choice)} {choice.label}
                    </span>
                  </span>
                  {/* Moisture/variance - the gap between planned and actual,
                      named for the usual real-world cause (moisture loss
                      during roasting/drying). A negative value means the
                      batch came in OVER plan - shown as a gain, not hidden. */}
                  {o.moistureLossPercent != null && o.moistureLossPercent !== 0 && (
                    <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full ${o.moistureLossPercent > 0 ? 'bg-orange-500/15 text-warning' : 'bg-blue-500/15 text-info'}`}>
                      {o.moistureLossPercent > 0
                        ? `Moisture loss ${o.moistureLossPercent}%`
                        : `Over plan +${Math.abs(o.moistureLossPercent)}%`}
                    </span>
                  )}
                </p>
                );
              })()}

              <p className="text-[10px] text-fg/65 flex items-center gap-1.5">
                <Clock size={11} /> {new Date(o.createdAt).toLocaleString()}
              </p>
              {o.notes && <p className="text-fg/75 text-xs mt-1 italic">"{o.notes}"</p>}
              {o.status === 'Rejected' && o.rejectionReason && (
                <p className="text-danger text-xs mt-1">Reason: {o.rejectionReason}</p>
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
                    className="ml-auto text-fg/65 hover:text-fg text-[11px] font-bold uppercase tracking-wider transition">
                    Cancel
                  </button>
                </div>
              )}

              {o.status === 'Approved' && o.fulfillmentStatus === 'Processing' && canApprove && (
                <div className="flex items-center mt-3 pt-3 border-t border-white/5">
                  <button onClick={() => { setReconciling(o); const u = plannedUnitChoice(o); setReconcileUnit(u.label); setActualQty(String(inUnit(o.outputQty, u))); }} disabled={busy}
                    className="flex items-center gap-1.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-on-brand font-bold text-xs px-3 py-1.5 rounded-lg transition">
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
            <p className="text-fg/75 text-xs mb-3">{rejecting.outputName} × {rejecting.outputQty}{rejecting.outputUnit}</p>
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
      {reconciling && (() => {
        const opts = reconcileUnitOptions(reconciling);
        const chosen = opts.find(o => o.label === reconcileUnit) || opts[0];
        const label = chosen?.label || '';
        const plannedPieces = inUnit(reconciling.outputQty, chosen);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setReconciling(null)}>
          <div className="bg-surface border border-white/10 rounded-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-fg mb-1 flex items-center gap-1.5"><ClipboardCheck size={16} className="text-brand-text" /> Confirm actual output</h3>
            <p className="text-fg/75 text-xs mb-3">{reconciling.outputName} - planned {plannedPieces} {label}</p>
            <label className="text-[9px] text-fg/70 uppercase tracking-wider block mb-1">Actual quantity produced</label>
            <div className="flex gap-2 mb-1">
              <input type="number" min="0" step="0.01" autoFocus value={actualQty} onChange={e => setActualQty(e.target.value)}
                className="flex-1 bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
              {/* Switching unit re-states the number that is already there, so
                  the figure on screen always means what the label says. */}
              <select value={label} onChange={e => {
                  const next = opts.find(o => o.label === e.target.value) || opts[0];
                  setActualQty(restateQty(actualQty, chosen, next));
                  setReconcileUnit(next.label);
                }}
                className="w-24 bg-page-bg border border-white/10 rounded-lg px-2 py-2 text-sm text-fg outline-none focus:border-accent">
                {opts.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
              </select>
            </div>
            <p className="text-[10px] text-fg/65 mb-3">
              Meets or beats {plannedPieces} {label} → marked <span className="text-success font-bold">Complete</span>.
              Falls short → marked <span className="text-warning font-bold">Partial</span>. This is what actually gets added to stock.
            </p>
            <div className="flex gap-2">
              <button onClick={() => { setReconciling(null); setActualQty(''); }} className="flex-1 border border-white/10 text-fg/60 hover:text-fg py-2 rounded-lg text-xs font-bold uppercase transition">Cancel</button>
              <button onClick={submitReconcile} disabled={busy} className="flex-1 bg-accent hover:bg-accent/90 disabled:opacity-50 text-on-brand py-2 rounded-lg text-xs font-bold uppercase transition">Confirm</button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
