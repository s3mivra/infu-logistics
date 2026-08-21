import { useState, useEffect, useCallback } from 'react';

// Raw-material -> finished-good conversion (e.g. green coffee beans roasted
// into coffee beans). Log-business only - see InventoryTab's invSubTab gate.
// Consumes one or more Inventory items and produces a different Inventory
// item, rolling the consumed cost into the output's unit cost.
// Which "kind" of unit a base unit belongs to - mass/volume/count never mix.
// Raw material dimension drives what the output is allowed to be: consuming
// something counted in pcs makes another pcs good (e.g. crates of eggs), while
// consuming g/ml makes a g/ml good (e.g. green beans -> roasted beans), because
// a conversion can't change what's physically being measured.
const unitKind = (u) => (u === 'g' ? 'mass' : u === 'ml' ? 'volume' : 'count');
const UNIT_OPTIONS = { mass: [{ v: 'g', l: 'g' }], volume: [{ v: 'ml', l: 'ml' }], count: [{ v: 'pcs', l: 'pcs' }] };

export default function ProductionTab({ apiFetch, inventory = [], peso }) {
  const [rows, setRows] = useState([{ invId: '', qty: '' }]);
  const [outputMode, setOutputMode] = useState('existing'); // 'existing' | 'new'
  const [outputInvId, setOutputInvId] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newUnit, setNewUnit] = useState('pcs');
  const [outputQty, setOutputQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Dimension of the raw materials currently selected - null if the rows mix
  // mass/volume/count (that combination has no sensible single output unit,
  // so we don't try to guess one).
  const rawUnits = [...new Set(rows.map(r => inventory.find(i => i._id === r.invId)?.unit).filter(Boolean))];
  const rawKinds = [...new Set(rawUnits.map(unitKind))];
  const rawKind = rawKinds.length === 1 ? rawKinds[0] : null;

  // Keep the new-item unit picker following the raw materials' dimension -
  // pcs in -> pcs out, g/ml in -> g/ml out. Re-syncs whenever the inputs change
  // dimension, but leaves the user free to still pick between e.g. mass units
  // once more than one is offered.
  useEffect(() => {
    if (rawKind && !UNIT_OPTIONS[rawKind].some(o => o.v === newUnit)) {
      setNewUnit(UNIT_OPTIONS[rawKind][0].v);
    }
  }, [rawKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const outputItem = inventory.find(i => i._id === outputInvId);
  const outputMismatch = outputMode === 'existing' && outputItem && rawKind && unitKind(outputItem.unit) !== rawKind;

  // Reconciliation: only meaningful when every raw row shares one base unit
  // (e.g. all in g) so the numbers are directly comparable - mixing e.g. water
  // (ml) and beans (g) into one figure would be meaningless. Once that holds,
  // and the output is in that same unit, yield% shows how much survived the
  // conversion (e.g. green beans losing ~15% weight when roasted).
  const singleRawUnit = rawUnits.length === 1 ? rawUnits[0] : null;
  const totalRawQty = singleRawUnit ? rows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0) : null;
  const outputUnitForYield = outputMode === 'new' ? newUnit : outputItem?.unit;
  const yieldPct = (singleRawUnit && totalRawQty > 0 && outputUnitForYield === singleRawUnit && parseFloat(outputQty) > 0)
    ? (parseFloat(outputQty) / totalRawQty) * 100
    : null;

  const [orders, setOrders] = useState([]);
  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/production');
      const d = await r.json();
      if (d.success) setOrders(d.orders || []);
    } catch { /* non-fatal */ }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);

  const card = 'bg-surface border border-white/10 rounded-xl p-4';
  const input = 'w-full bg-page-bg border border-white/10 rounded-lg p-2.5 text-fg text-sm outline-none focus:border-accent';

  const addRow = () => setRows(r => [...r, { invId: '', qty: '' }]);
  const removeRow = (i) => setRows(r => r.filter((_, idx) => idx !== i));
  const setRow = (i, patch) => setRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));

  const totalRawCost = rows.reduce((sum, r) => {
    const inv = inventory.find(i => i._id === r.invId);
    const qty = parseFloat(r.qty) || 0;
    return sum + qty * (inv?.unitCost || 0);
  }, 0);
  const projectedUnitCost = (parseFloat(outputQty) > 0) ? totalRawCost / parseFloat(outputQty) : 0;

  const submit = async () => {
    setErr('');
    const cleanRows = rows.filter(r => r.invId && parseFloat(r.qty) > 0);
    if (cleanRows.length === 0) return setErr('Add at least one raw material with a qty.');
    if (!(parseFloat(outputQty) > 0)) return setErr('Output qty must be greater than 0.');
    if (outputMode === 'existing' && !outputInvId) return setErr('Choose the output item.');
    if (outputMode === 'new' && !newItemName.trim()) return setErr('Name the new output item.');
    if (outputMismatch) return setErr(`${outputItem.itemName} is tracked in ${outputItem.unit}, which doesn't match the raw materials' unit (${rawUnits.join('/')}).`);

    setBusy(true);
    try {
      const body = {
        inputs: cleanRows.map(r => ({ invId: r.invId, qty: parseFloat(r.qty) })),
        outputQty: parseFloat(outputQty),
        note: note.trim(),
        ...(outputMode === 'existing'
          ? { outputInvId }
          : { outputNew: { itemName: newItemName.trim(), unit: newUnit } }),
      };
      const r = await apiFetch('/api/production', { method: 'POST', body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.success) { setErr(d.error || 'Failed to record production.'); return; }
      setRows([{ invId: '', qty: '' }]);
      setOutputInvId(''); setNewItemName(''); setOutputQty(''); setNote('');
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-1">New Production</h3>
        <p className="text-fg/50 text-[11px] mb-3">Convert raw material stock into a different finished item - e.g. green coffee beans into roasted beans. Cost rolls up from the inputs into the output automatically.</p>

        <label className="text-[10px] text-fg/40 uppercase font-bold block mb-1">Raw Materials Consumed</label>
        <div className="space-y-2 mb-3">
          {rows.map((row, i) => {
            const inv = inventory.find(x => x._id === row.invId);
            return (
              <div key={i} className="flex gap-2 items-center">
                <select value={row.invId} onChange={e => setRow(i, { invId: e.target.value })} className={input}>
                  <option value="">- Select item -</option>
                  {inventory.map(x => <option key={x._id} value={x._id}>{x.itemName} · {x.stockQty} {x.unit}</option>)}
                </select>
                <input
                  type="number" min="0" step="any" value={row.qty}
                  onChange={e => setRow(i, { qty: e.target.value })}
                  placeholder={inv?.unit || 'qty'}
                  className={`${input} max-w-[140px] text-right`}
                />
                {rows.length > 1 && (
                  <button onClick={() => removeRow(i)} className="text-red-400/60 hover:text-red-400 text-[10px] font-bold uppercase px-2">Remove</button>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={addRow} className="text-[10px] font-bold uppercase text-accent hover:opacity-80 mb-4">+ Add Material</button>

        <label className="text-[10px] text-fg/40 uppercase font-bold block mb-1">Output</label>
        <div className="flex gap-2 mb-2">
          <button onClick={() => setOutputMode('existing')} className={`text-[10px] font-bold uppercase px-3 py-1.5 rounded ${outputMode === 'existing' ? 'bg-accent text-white' : 'bg-white/5 text-fg/50'}`}>Existing Item</button>
          <button onClick={() => setOutputMode('new')} className={`text-[10px] font-bold uppercase px-3 py-1.5 rounded ${outputMode === 'new' ? 'bg-accent text-white' : 'bg-white/5 text-fg/50'}`}>New Item</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          {outputMode === 'existing' ? (
            <select value={outputInvId} onChange={e => setOutputInvId(e.target.value)} className={input}>
              <option value="">- Select item -</option>
              {inventory.map(x => <option key={x._id} value={x._id}>{x.itemName} · {x.stockQty} {x.unit}</option>)}
            </select>
          ) : (
            <div className="flex gap-2">
              <input value={newItemName} onChange={e => setNewItemName(e.target.value)} placeholder="New item name (e.g. Roasted Coffee Beans)" className={input} />
              <select value={newUnit} onChange={e => setNewUnit(e.target.value)} className={`${input} max-w-[100px]`}>
                {(rawKind ? UNIT_OPTIONS[rawKind] : [{ v: 'pcs', l: 'pcs' }, { v: 'g', l: 'g' }, { v: 'ml', l: 'ml' }]).map(o => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
            </div>
          )}
          <input
            type="number" min="0" step="any" value={outputQty}
            onChange={e => setOutputQty(e.target.value)}
            placeholder={`Output qty produced${rawKind ? ` (${UNIT_OPTIONS[rawKind][0].l})` : ''}`}
            className={input}
          />
        </div>
        {outputMismatch && (
          <p className="text-yellow-400 text-xs mb-2">
            {outputItem.itemName} is tracked in {outputItem.unit}, but the raw materials selected are in {rawUnits.join('/')} - a conversion can't change what's being measured (weight vs volume vs count). Pick a matching item or use "New Item".
          </p>
        )}
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={`${input} mb-3`} />

        {(totalRawCost > 0 || totalRawQty != null) && (
          <div className="text-xs mb-3 space-y-1">
            {totalRawQty != null && (
              <p className="text-fg/50">
                Raw consumed: <span className="text-fg font-bold">{totalRawQty} {singleRawUnit}</span>
                {parseFloat(outputQty) > 0 && outputUnitForYield === singleRawUnit && (
                  <> → produced: <span className="text-fg font-bold">{parseFloat(outputQty)} {singleRawUnit}</span></>
                )}
                {yieldPct != null && (
                  <span className={yieldPct > 100 ? 'text-yellow-400' : 'text-fg/70'}> ({yieldPct.toFixed(1)}% yield{yieldPct > 100 ? ' - more output than raw in, double-check the qty' : ''})</span>
                )}
              </p>
            )}
            {totalRawCost > 0 && (
              <p className="text-fg/50">
                Raw cost consumed: <span className="text-fg font-bold">{peso(totalRawCost)}</span>
                {parseFloat(outputQty) > 0 && <> → output unit cost: <span className="text-fg font-bold">{peso(projectedUnitCost)}</span></>}
              </p>
            )}
          </div>
        )}

        {err && <p className="text-red-400 text-xs mb-3">{err}</p>}
        <button onClick={submit} disabled={busy} className="bg-accent text-white px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-40 min-h-[44px]">
          {busy ? 'Recording…' : 'Record Production'}
        </button>
      </div>

      <div className={card}>
        <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-3">Production History</h3>
        {orders.length === 0 ? (
          <p className="text-fg/40 text-xs py-6 text-center uppercase tracking-widest">No production recorded yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg/40 text-[10px] uppercase tracking-widest border-b border-white/10">
                  <th className="text-left py-2">Ref</th>
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Inputs</th>
                  <th className="text-left py-2">Output</th>
                  <th className="text-right py-2">Unit Cost</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o._id} className="border-b border-white/5">
                    <td className="py-2 text-fg/50 text-xs font-mono">{o.reference}</td>
                    <td className="py-2 text-fg/60 text-xs">{new Date(o.createdAt).toLocaleString()}</td>
                    <td className="py-2 text-fg/70 text-xs">{(o.inputs || []).map(l => `${l.qtyBase} ${l.itemName}`).join(', ')}</td>
                    <td className="py-2 text-fg font-bold text-xs">{o.outputQtyBase} {o.outputItemName}</td>
                    <td className="py-2 text-right text-fg font-mono text-xs tabular-nums">{peso(o.outputUnitCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
