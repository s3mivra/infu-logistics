import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Plus, Trash2, Save, Package, Coins, Percent, Search, Tag, FilePlus2 } from 'lucide-react';
import * as ui from '../../shared/ui';
import SearchSelect from '../../shared/ui/SearchSelect';
import { IS_LOG } from '../../shared/businessType.js';
import { unitChoices, sheetTotals, priceFrom, marginAt, linesFromProduct, currentPrice } from '../../shared/costing.js';

// Costing: what one unit of something costs to make or buy, and the selling
// price that cost calls for - for any product, in either kind of business.
// Lines come from stock at live cost (a recipe, or the item a logistics product
// sells), plus fixed amounts and percentages. The price it arrives at can be
// sent to the product, through the same price-change route (and approval) as
// any other price edit. Arithmetic: shared/costing.js.

const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ROUNDING = [[0, 'To the centavo'], [0.25, 'Up to ₱0.25'], [1, 'Up to ₱1'], [5, 'Up to ₱5'], [10, 'Up to ₱10']];
const input = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-brand/60';
const label = 'text-[10px] font-black uppercase tracking-wider text-fg/70 mb-1 block';

const blankSheet = (vatRate) => ({ _id: null, name: '', productId: null, sizeIndex: -1, lines: [], method: 'markup', rate: 50, vatRate, rounding: 1, notes: '' });

export default function CostingTab({ ctx }) {
  const { apiFetch, can, products = [], inventory = [], systemSettings = {}, fetchData } = ctx;
  const canEdit = !!can?.('products.manage');
  const defaultVat = systemSettings.vatEnabled === true ? Number(systemSettings.vatRate ?? 12) : 0;

  const [sheets, setSheets] = useState([]);
  const [sheet, setSheet] = useState(() => blankSheet(defaultVat));
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  const invById = useMemo(() => new Map(inventory.map(i => [String(i._id), i])), [inventory]);
  const product = useMemo(() => products.find(p => String(p._id) === String(sheet.productId)) || null, [products, sheet.productId]);
  const totals = useMemo(() => sheetTotals(sheet.lines, invById), [sheet.lines, invById]);
  const price = useMemo(() => priceFrom({ cost: totals.cost, method: sheet.method, rate: sheet.rate, vatRate: sheet.vatRate, rounding: sheet.rounding }), [totals.cost, sheet.method, sheet.rate, sheet.vatRate, sheet.rounding]);
  const nowPrice = currentPrice(product, sheet.sizeIndex);
  const nowMargin = nowPrice != null ? marginAt(nowPrice, totals.cost, sheet.vatRate) : null;

  const load = useCallback(async () => {
    try { const d = await (await apiFetch('/api/costing/sheets')).json(); if (d.success) setSheets(d.sheets || []); } catch { /* list stays as it was */ }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);

  const set = (patch) => setSheet(s => ({ ...s, ...patch }));
  const setLine = (i, patch) => setSheet(s => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const addLine = (kind) => setSheet(s => ({ ...s, lines: [...s.lines, kind === 'stock' ? { kind, invId: '', name: '', qty: 1, unit: '' } : kind === 'percent' ? { kind, name: 'Overhead', percent: 10 } : { kind, name: '', amount: 0 }] }));
  const removeLine = (i) => setSheet(s => ({ ...s, lines: s.lines.filter((_, j) => j !== i) }));

  const pickProduct = (id) => {
    const p = products.find(x => String(x._id) === String(id));
    set({ productId: id || null, sizeIndex: -1, name: sheet.name || p?.name || '' });
  };
  const fillFromProduct = () => {
    if (!product) return;
    const lines = linesFromProduct(product, { sizeIndex: sheet.sizeIndex, inventory });
    if (!lines.length) return ui.alert(IS_LOG ? 'No stock item is linked to this product (by code or name).' : 'This product has no recipe to cost.');
    set({ lines: [...lines, ...sheet.lines.filter(l => l.kind !== 'stock')] });
  };

  const save = async (extra = {}) => {
    if (!sheet.name.trim()) { ui.alert('Give the costing a name.'); return null; }
    setSaving(true);
    try {
      const body = { ...sheet, ...extra, lastCost: totals.cost, lastSrp: price.srp || 0 };
      const d = await (await apiFetch(sheet._id ? `/api/costing/sheets/${sheet._id}` : '/api/costing/sheets', { method: sheet._id ? 'PUT' : 'POST', body: JSON.stringify(body) })).json();
      if (!d.success) { ui.alert(d.error || 'Could not save.'); return null; }
      setSheet(s => ({ ...s, _id: d.sheet._id }));
      load();
      return d.sheet;
    } catch { ui.alert('Network error - nothing was saved.'); return null; }
    finally { setSaving(false); }
  };

  const apply = async () => {
    if (!product || !(price.srp > 0)) return;
    const sizeName = sheet.sizeIndex >= 0 ? product.sizes?.[sheet.sizeIndex]?.name : null;
    const ok = await ui.confirm({
      title: 'Apply this price?',
      message: `${product.name}${sizeName ? ` (${sizeName})` : ''}: ${nowPrice != null ? `${peso(nowPrice)} → ` : ''}${peso(price.srp)}. If your role cannot change prices directly, it is sent for approval.`,
      confirmLabel: 'Apply price',
    });
    if (!ok) return;
    const reason = `Costing: ${sheet.name || product.name} (cost ${peso(totals.cost)}, ${sheet.method} ${sheet.rate}%)`;
    const body = sheet.sizeIndex >= 0
      ? { sizes: (product.sizes || []).map((s, i) => (i === sheet.sizeIndex ? { ...s, price: price.srp } : s)) }
      : { basePrice: price.srp };
    try {
      const d = await (await apiFetch(`/api/products/${product._id}`, {
        method: 'PUT', body: JSON.stringify(body), headers: { 'X-Change-Reason': encodeURIComponent(reason) },
      })).json();
      if (d.success === false) return ui.alert(d.error || 'The price was not changed.');
      if (d.pendingApproval?.length) ui.toast('Sent for approval - the price changes once it is signed off (Ledger → Price Changes).', { tone: 'success' });
      else ui.toast(`Price set to ${peso(price.srp)}.`, { tone: 'success' });
      await save({ appliedPrice: price.srp });
      fetchData?.();
    } catch { ui.alert('Network error - the price was not changed.'); }
  };

  const remove = async (s) => {
    if (!(await ui.confirm({ title: 'Delete this costing?', message: s.name, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      const d = await (await apiFetch(`/api/costing/sheets/${s._id}`, { method: 'DELETE' })).json();
      if (!d.success) return ui.alert(d.error || 'Could not delete.');
      if (sheet._id === s._id) setSheet(blankSheet(defaultVat));
      load();
    } catch { ui.alert('Network error.'); }
  };

  const shown = sheets.filter(s => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const productOptions = products.map(p => ({ value: p._id, label: p.name, hint: p.productCode || p.category || '' }));
  const stockOptions = inventory.map(i => ({ value: i._id, label: i.itemName, hint: i.itemCode || '' }));

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-fg flex items-center gap-2"><Calculator size={20} className="text-brand-text" /> Costing</h2>
          <p className="text-xs text-fg/70 mt-1 max-w-2xl">What one unit costs to make or buy - from stock at today's cost, plus fixed amounts and percentages - and the price that gives the margin you want. Send the price to the product when it's right.</p>
        </div>
        <button type="button" onClick={() => setSheet(blankSheet(defaultVat))} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand text-on-brand font-bold text-xs"><FilePlus2 size={14} /> New costing</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
        {/* Saved costings */}
        <aside className="bg-surface border border-white/10 rounded-xl p-3 flex flex-col gap-2 min-w-0 lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto custom-scrollbar">
          <p className="text-[10px] font-black uppercase tracking-wider text-fg/70 px-1">Saved costings</p>
          <span className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/65" />
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a costing" aria-label="Find a costing" className={`${input} w-full pl-8 py-1.5`} />
          </span>
          {shown.length === 0 && <p className="text-xs text-fg/65 px-1 py-3">{sheets.length ? 'No match.' : 'None yet. Build one on the right and save it.'}</p>}
          {shown.map(s => (
            <div key={s._id} className={`group rounded-lg border px-3 py-2 cursor-pointer ${sheet._id === s._id ? 'border-brand/60 bg-brand/10' : 'border-white/10 hover:bg-white/5'}`}
              onClick={() => setSheet({ ...blankSheet(defaultVat), ...s })} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setSheet({ ...blankSheet(defaultVat), ...s }); }}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-fg truncate">{s.name}</p>
                {canEdit && <button type="button" aria-label={`Delete ${s.name}`} onClick={e => { e.stopPropagation(); remove(s); }} className="text-fg/65 hover:text-danger opacity-0 group-hover:opacity-100 focus:opacity-100"><Trash2 size={13} /></button>}
              </div>
              <p className="text-[11px] text-fg/70 tabular-nums">Cost {peso(s.lastCost)} · SRP {peso(s.lastSrp)}</p>
              {s.appliedAt && <p className="text-[10px] text-success">Applied {peso(s.appliedPrice)} · {new Date(s.appliedAt).toLocaleDateString('en-PH')}</p>}
            </div>
          ))}
        </aside>

        {/* The sheet */}
        <section className="flex flex-col gap-4 min-w-0">
          <div className="bg-surface border border-white/10 rounded-xl p-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
            <div className="min-w-0">
              <label htmlFor="cost-name" className={label}>Name</label>
              <input id="cost-name" value={sheet.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Iced Latte 16oz" className={`${input} w-full`} />
            </div>
            <div className="min-w-0">
              <label className={label}>For product (optional)</label>
              <div className="flex gap-2">
                <SearchSelect value={sheet.productId || ''} onChange={e => pickProduct(e.target.value)} options={productOptions}
                  placeholder="Pick a product to price" className={`${input} flex-1 min-w-0`} />
                {product?.sizes?.length > 0 && (
                  <select value={sheet.sizeIndex} onChange={e => set({ sizeIndex: Number(e.target.value) })} aria-label="Size" className={input}>
                    <option value={-1}>Base</option>
                    {product.sizes.map((s, i) => <option key={s._id || i} value={i}>{s.name}</option>)}
                  </select>
                )}
              </div>
            </div>
            <button type="button" onClick={fillFromProduct} disabled={!product}
              title={IS_LOG ? 'Add the stock item this product sells' : "Add the product's recipe at today's stock costs"}
              className="px-3 py-2 rounded-lg bg-white/5 text-fg/80 font-bold text-xs disabled:opacity-40 whitespace-nowrap">Fill from product</button>
          </div>

          {/* Cost lines */}
          <div className="bg-surface border border-white/10 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-black uppercase tracking-wider text-fg">Cost of one unit</h3>
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => addLine('stock')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 text-fg/80 text-xs font-bold"><Package size={13} /> Stock item</button>
                <button type="button" onClick={() => addLine('amount')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 text-fg/80 text-xs font-bold"><Coins size={13} /> Fixed amount</button>
                <button type="button" onClick={() => addLine('percent')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 text-fg/80 text-xs font-bold"><Percent size={13} /> Percentage</button>
              </div>
            </div>
            {sheet.lines.length === 0 ? (
              <p className="text-xs text-fg/65 py-4 text-center">Pick a product and press <b>Fill from product</b>, or add lines: stock items at today's cost, fixed amounts (labour, freight, a label), and percentages (overhead, wastage).</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[620px]">
                  <thead><tr className="text-[10px] font-black uppercase tracking-wider text-fg/65 text-left">
                    <th className="py-1.5 pr-2">Line</th><th className="py-1.5 pr-2">Quantity</th><th className="py-1.5 pr-2 text-right">Cost</th><th className="w-8" />
                  </tr></thead>
                  <tbody>
                    {sheet.lines.map((l, i) => {
                      const item = l.kind === 'stock' ? invById.get(String(l.invId)) : null;
                      const units = item ? unitChoices(item) : [];
                      return (
                        <tr key={i} className="border-t border-white/5 align-top">
                          <td className="py-2 pr-2 min-w-[220px]">
                            {l.kind === 'stock' ? (
                              <>
                                <SearchSelect value={l.invId || ''} options={stockOptions} placeholder="Find a stock item" className={`${input} w-full`}
                                  onChange={e => { const it = invById.get(String(e.target.value)); setLine(i, { invId: e.target.value, name: it?.itemName || '', unit: it ? unitChoices(it)[0].label : '' }); }} />
                                {item && <p className="text-[10px] text-fg/65 mt-1 tabular-nums">{peso((Number(item.unitCost) || 0) * (units.find(u => u.label === (l.unit || units[0]?.label))?.factor || 1))} per {l.unit || units[0]?.label}</p>}
                                {!item && l.invId && <p className="text-[10px] text-danger mt-1">This stock item no longer exists.</p>}
                              </>
                            ) : (
                              <input value={l.name} onChange={e => setLine(i, { name: e.target.value })} aria-label="Line name"
                                placeholder={l.kind === 'percent' ? 'e.g. Overhead, Wastage' : 'e.g. Labour, Freight, Label'} className={`${input} w-full`} />
                            )}
                          </td>
                          <td className="py-2 pr-2">
                            {l.kind === 'stock' && (
                              <div className="flex gap-1.5">
                                <input type="number" min="0" step="any" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} aria-label="Quantity" className={`${input} w-24`} />
                                <select value={l.unit || units[0]?.label || ''} onChange={e => setLine(i, { unit: e.target.value })} aria-label="Unit" disabled={!item} className={`${input} w-20`}>
                                  {units.map(u => <option key={u.label} value={u.label}>{u.label}</option>)}
                                </select>
                              </div>
                            )}
                            {l.kind === 'amount' && (
                              <div className="flex items-center gap-1.5"><span className="text-fg/65">₱</span>
                                <input type="number" min="0" step="any" value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} aria-label="Amount" className={`${input} w-28`} /></div>
                            )}
                            {l.kind === 'percent' && (
                              <div className="flex items-center gap-1.5">
                                <input type="number" min="0" step="any" value={l.percent} onChange={e => setLine(i, { percent: e.target.value })} aria-label="Percent" className={`${input} w-20`} />
                                <span className="text-[11px] text-fg/65">% of the lines above</span></div>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums font-bold text-fg whitespace-nowrap">{peso(totals.lines[i])}</td>
                          <td className="py-2 text-right"><button type="button" onClick={() => removeLine(i)} aria-label="Remove line" className="p-1.5 rounded text-fg/65 hover:text-danger hover:bg-red-500/10"><Trash2 size={14} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr className="border-t border-white/10">
                    <td colSpan={2} className="pt-3 text-xs font-black uppercase tracking-wider text-fg/80">Total cost per unit</td>
                    <td className="pt-3 text-right tabular-nums text-lg font-black text-fg">{peso(totals.cost)}</td><td />
                  </tr></tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Price */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-surface border border-white/10 rounded-xl p-4 flex flex-col gap-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-fg">Price it</h3>
              <div className="inline-flex bg-white/5 border border-white/10 rounded-lg p-0.5 self-start" role="group" aria-label="Pricing method">
                {[['markup', 'Markup on cost'], ['margin', 'Target margin']].map(([k, t]) => (
                  <button key={k} type="button" onClick={() => set({ method: k })} aria-pressed={sheet.method === k}
                    className={`px-3 py-1.5 rounded text-xs font-bold ${sheet.method === k ? 'bg-brand text-on-brand' : 'text-fg/75'}`}>{t}</button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="cost-rate" className={label}>{sheet.method === 'margin' ? 'Margin %' : 'Markup %'}</label>
                  <input id="cost-rate" type="number" min="0" max={sheet.method === 'margin' ? 99 : undefined} step="any" value={sheet.rate} onChange={e => set({ rate: e.target.value })} className={`${input} w-full`} />
                </div>
                <div>
                  <label htmlFor="cost-vat" className={label}>VAT %</label>
                  <input id="cost-vat" type="number" min="0" max="100" step="any" value={sheet.vatRate} onChange={e => set({ vatRate: e.target.value })} className={`${input} w-full`} />
                </div>
                <div>
                  <label htmlFor="cost-round" className={label}>Round</label>
                  <select id="cost-round" value={sheet.rounding} onChange={e => set({ rounding: Number(e.target.value) })} className={`${input} w-full`}>
                    {ROUNDING.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-fg/65 leading-snug">
                {sheet.method === 'margin'
                  ? 'Margin is the share of the price you keep: 40% margin on ₱60 cost is ₱100.'
                  : 'Markup is added on top of cost: 40% markup on ₱60 cost is ₱84.'}
                {' '}VAT is added on top{defaultVat ? '' : ' (0 for a non-VAT business)'}, and rounding only ever goes up.
              </p>
              <textarea value={sheet.notes} onChange={e => set({ notes: e.target.value })} rows={2} placeholder="Notes (optional)" aria-label="Notes" className={`${input} w-full resize-none`} />
            </div>

            <div className="bg-surface border border-brand/30 rounded-xl p-4 flex flex-col gap-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-fg flex items-center gap-2"><Tag size={14} className="text-brand-text" /> Suggested SRP</h3>
              {price.error ? <p className="text-danger text-sm font-bold">{price.error}</p> : (
                <>
                  <p className="text-4xl font-black text-brand-text tabular-nums">{peso(price.srp)}</p>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-fg/65">Profit / unit</dt><dd className="font-bold text-fg tabular-nums">{peso(price.profit)}</dd></div>
                    <div><dt className="text-fg/65">Margin</dt><dd className="font-bold text-fg tabular-nums">{price.margin}%</dd></div>
                    <div><dt className="text-fg/65">Markup</dt><dd className="font-bold text-fg tabular-nums">{price.markup == null ? '-' : `${price.markup}%`}</dd></div>
                  </dl>
                  {Number(sheet.vatRate) > 0 && <p className="text-[11px] text-fg/65">Includes {sheet.vatRate}% VAT; {peso(price.exVat)} before VAT.</p>}
                  {product && (
                    <div className="border-t border-white/10 pt-3 text-xs flex flex-col gap-1">
                      <p className="text-fg/80">Now selling at <b className="tabular-nums">{nowPrice != null ? peso(nowPrice) : 'no price'}</b>
                        {nowMargin != null && <> · margin <b className={nowMargin < Number(price.margin) ? 'text-warning' : 'text-success'}>{nowMargin}%</b></>}</p>
                      {nowPrice != null && price.srp !== nowPrice && <p className="text-fg/65 tabular-nums">{price.srp > nowPrice ? 'Up' : 'Down'} {peso(Math.abs(price.srp - nowPrice))} from today's price.</p>}
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-2 mt-auto pt-1 flex-wrap">
                {canEdit && <button type="button" onClick={() => save()} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 text-fg/80 font-bold text-xs disabled:opacity-50"><Save size={13} /> {sheet._id ? 'Save changes' : 'Save costing'}</button>}
                {canEdit && (
                  <button type="button" onClick={apply} disabled={!product || !!price.error || !(price.srp > 0) || saving}
                    title={product ? '' : 'Pick a product first'}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-on-brand font-bold text-xs disabled:opacity-40"><Plus size={13} /> Apply to {product ? (sheet.sizeIndex >= 0 ? `${product.sizes?.[sheet.sizeIndex]?.name} price` : 'SRP') : 'a product'}</button>
                )}
              </div>
              {!canEdit && <p className="text-[11px] text-fg/65">You can work out costings here; saving and changing prices needs product management access.</p>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
