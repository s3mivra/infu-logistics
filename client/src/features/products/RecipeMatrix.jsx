// Sizes, prices and recipes on one grid - see shared/recipeMatrix.js for how
// the grid maps onto the product's baseRecipe and per-size recipes.
import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import SearchSelect from '../../shared/ui/SearchSelect';
import { matrixRows, setCell, removeRow, addSizeColumn, removeSizeColumn, columnsOf, marginOf, rowKeyOf } from '../../shared/recipeMatrix';

const TARGET_MARGIN = 0.3;          // the same 30% the old "Set 30% margin" button used
const NON_STOCK_UNITS = ['ml', 'L', 'g', 'kg', 'lb', 'pcs'];
const money = (n) => `₱${(Number(n) || 0).toFixed(2)}`;

export default function RecipeMatrix({ form, setForm, inventory = [], calcRecipeCost, packInfo, businessType }) {
  const isLog = businessType === 'log';
  const [pending, setPending] = useState([]);
  const [pick, setPick] = useState('');
  const [nsName, setNsName] = useState('');
  const [nsUnit, setNsUnit] = useState('ml');

  const cols = columnsOf(form);
  const rows = useMemo(() => matrixRows(form, pending), [form, pending]);
  const used = new Set(rows.map((r) => r.key));

  const cellId = (ri, ci) => `rm-${ri}-${ci}`;
  const focusCell = (ri, ci) => setTimeout(() => document.getElementById(cellId(ri, ci))?.focus(), 30);

  const setName = (ci, v) => (ci === 0
    ? setForm({ ...form, baseSize: v })
    : setForm({ ...form, sizes: form.sizes.map((s, j) => (j === ci - 1 ? { ...s, name: v } : s)) }));
  const setPrice = (ci, v) => {
    const p = v === '' ? '' : (parseFloat(v) || 0);
    if (ci === 0) setForm({ ...form, basePrice: p });
    else setForm({ ...form, sizes: form.sizes.map((s, j) => (j === ci - 1 ? { ...s, price: p === '' ? 0 : p } : s)) });
  };

  // An ingredient from stock, in the unit it is counted in: grams, millilitres
  // or pieces for a café; packs for logistics.
  const addStock = () => {
    const inv = inventory.find((i) => String(i._id) === String(pick));
    if (!inv) return;
    const pack = isLog && packInfo ? packInfo(inv) : null;
    const row = {
      key: `inv:${inv._id}`, invId: String(inv._id), name: inv.itemName, cost: Number(inv.unitCost) || 0,
      unit: isLog ? 'pcs' : (inv.unit || 'pcs'), packBase: isLog ? (pack?.packBase || 1) : 1,
    };
    setPending((p) => [...p, row]);
    setPick('');
    focusCell(rows.length, 0);
  };
  const addNonStock = () => {
    const name = nsName.trim();
    if (!name) return;
    const key = rowKeyOf({ name });
    if (used.has(key)) { setNsName(''); return; }
    setPending((p) => [...p, { key, invId: null, name, unit: nsUnit, packBase: 1, nonStock: true, cost: 0 }]);
    setNsName('');
    focusCell(rows.length, 0);
  };

  const onCell = (row, ci, v) => {
    setForm(setCell(form, row, ci, v));
    // Once it has an amount somewhere it lives in the recipe itself.
    if (v !== '' && Number(v) > 0) setPending((p) => p.filter((r) => r.key !== row.key));
  };
  const dropRow = (row) => {
    setForm(removeRow(form, row.key));
    setPending((p) => p.filter((r) => r.key !== row.key));
  };

  const costs = cols.map((c) => (calcRecipeCost ? calcRecipeCost(c.recipe) : 0));
  const input = 'bg-page-bg border border-white/10 rounded-md px-2 py-1.5 text-sm text-fg outline-none focus:border-brand';

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-surface-2">
              <th scope="col" className="text-left px-3 py-2 text-[11px] font-black uppercase tracking-wider text-fg/75 min-w-[180px]">Size</th>
              {cols.map((c, ci) => (
                <th key={ci} scope="col" className="px-2 py-2 min-w-[120px] align-top">
                  <div className="flex items-center gap-1">
                    <input value={c.name} onChange={(e) => setName(ci, e.target.value)} aria-label={`Size ${ci + 1} name`}
                      placeholder={ci === 0 ? 'e.g. 8oz Hot' : 'e.g. 12oz Iced'} className={`${input} w-full font-bold`} />
                    {ci > 0 && (
                      <button type="button" onClick={() => setForm(removeSizeColumn(form, ci))} title="Remove this size"
                        aria-label={`Remove size ${c.name || ci + 1}`} className="p-1 text-fg/65 hover:text-danger shrink-0"><X size={14} /></button>
                    )}
                  </div>
                </th>
              ))}
              <th scope="col" className="px-2 py-2 w-[1%]">
                <button type="button" onClick={() => setForm(addSizeColumn(form))} title="Add a size - it starts as a copy of the first size's recipe"
                  className="flex items-center gap-1 whitespace-nowrap text-xs font-bold text-brand-text hover:underline"><Plus size={13} /> Size</button>
              </th>
            </tr>
            <tr className="bg-surface-2 border-b border-white/10">
              <th scope="row" className="text-left px-3 pb-2 text-[11px] font-black uppercase tracking-wider text-fg/75">Price</th>
              {cols.map((c, ci) => (
                <td key={ci} className="px-2 pb-2">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-fg/70 text-xs">₱</span>
                    <input type="number" min="0" step="0.01" value={c.price ?? ''} onChange={(e) => setPrice(ci, e.target.value)}
                      aria-label={`Price of ${c.name || `size ${ci + 1}`}`} className={`${input} w-full pl-5 text-right tabular-nums font-bold`} />
                  </div>
                </td>
              ))}
              <td />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 2} className="px-3 py-4 text-fg/70 text-sm">
                No ingredients yet. Add them below - each one gets an amount per size.
              </td></tr>
            )}
            {rows.map((r, ri) => (
              <tr key={r.key} className="border-b border-white/5">
                <th scope="row" className="text-left px-3 py-1.5 font-semibold text-fg">
                  <span className="block truncate max-w-[220px]">{r.name}</span>
                  <span className="text-[11px] font-normal text-fg/70">
                    {isLog && r.packBase > 1 ? `packs of ${r.packBase}` : r.unit}{r.nonStock ? ' · not stock' : ''}
                  </span>
                </th>
                {cols.map((_, ci) => (
                  <td key={ci} className="px-2 py-1.5">
                    <input id={cellId(ri, ci)} type="number" min="0" step="any" inputMode="decimal"
                      value={r.cells[ci] ?? ''} placeholder="-" onChange={(e) => onCell(r, ci, e.target.value)}
                      aria-label={`${r.name} in ${cols[ci].name || `size ${ci + 1}`}`}
                      className={`${input} w-full text-right tabular-nums`} />
                  </td>
                ))}
                <td className="px-2">
                  <button type="button" onClick={() => dropRow(r)} aria-label={`Remove ${r.name}`} className="p-1 text-fg/65 hover:text-danger"><X size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-2">
            <tr>
              <th scope="row" className="text-left px-3 py-2 text-[11px] font-black uppercase tracking-wider text-fg/75">Cost to make</th>
              {costs.map((c, ci) => <td key={ci} className="px-2 py-2 text-right tabular-nums text-fg font-semibold">{money(c)}</td>)}
              <td />
            </tr>
            <tr>
              <th scope="row" className="text-left px-3 pb-2 text-[11px] font-black uppercase tracking-wider text-fg/75">Margin</th>
              {cols.map((c, ci) => {
                const m = marginOf(c.price, costs[ci]);
                const tone = m === null ? 'text-fg/70' : m < 0 ? 'text-danger' : m < TARGET_MARGIN ? 'text-warning' : 'text-success';
                const suggest = costs[ci] > 0 ? +(costs[ci] / (1 - TARGET_MARGIN)).toFixed(2) : 0;
                return (
                  <td key={ci} className="px-2 pb-2 text-right">
                    <span className={`tabular-nums font-black ${tone}`}>{m === null ? '-' : `${Math.round(m * 100)}%`}</span>
                    {suggest > 0 && (m === null || m < TARGET_MARGIN) && (
                      <button type="button" onClick={() => setPrice(ci, suggest)} className="block ml-auto text-[11px] text-fg/75 hover:text-brand-text underline-offset-2 hover:underline">
                        Set {money(suggest)} for 30%
                      </button>
                    )}
                  </td>
                );
              })}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[240px]">
          <SearchSelect value={pick} onChange={(e) => setPick(e.target.value)} className={`${input} w-full`}
            placeholder="Add an ingredient from stock - type its name"
            options={inventory.filter((i) => !used.has(`inv:${i._id}`)).map((i) => ({ value: String(i._id), label: i.itemName, hint: i.unit || '' }))} />
        </div>
        <button type="button" onClick={addStock} disabled={!pick}
          className="bg-brand text-on-brand text-xs font-black uppercase tracking-wider px-3 py-2 rounded-lg disabled:opacity-50">Add</button>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input value={nsName} onChange={(e) => setNsName(e.target.value)} placeholder="Not from stock, e.g. Filtered Water"
          aria-label="Ingredient not from stock" className={`${input} flex-1 min-w-[200px]`}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNonStock(); } }} />
        <select value={nsUnit} onChange={(e) => setNsUnit(e.target.value)} aria-label="Unit" className={`${input} w-20`}>
          {NON_STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <button type="button" onClick={addNonStock} disabled={!nsName.trim()}
          className="border border-white/15 text-fg/80 hover:text-fg text-xs font-black uppercase tracking-wider px-3 py-2 rounded-lg disabled:opacity-50">Add</button>
      </div>
      <p className="text-[11px] text-fg/70">
        Amounts are per serving, in the unit the item is counted in. A blank cell means that size does not use it.
        Not-from-stock lines are recorded but never deducted or costed.
      </p>
    </div>
  );
}
