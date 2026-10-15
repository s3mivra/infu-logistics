import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Download, SlidersHorizontal, Search } from 'lucide-react';
import * as ui from '../../shared/ui';
import { todayStr } from '../../shared/businessDay.js';
import { IS_LOG } from '../../shared/businessType.js';

// Which items are fast-moving, slow-moving or dead stock, from what actually
// sold - and how much of each to buy. A logistics business counts and buys
// whole units (one bottle, one box); a cafe counts what its recipes used and
// may buy part of a unit. The thresholds are this business's own, and can be
// changed. (Server: features/stock-movement.js)
const CLASSES = {
  fast: { label: 'Fast-moving', tone: 'text-success', chip: 'bg-green-500/15 text-success border-green-500/30', hint: 'Sells steadily and a lot, by this business’s own standard.' },
  slow: { label: 'Slow-moving', tone: 'text-warning', chip: 'bg-amber-500/15 text-warning border-amber-500/30', hint: 'Sells, but little or only now and then.' },
  dead: { label: 'Dead stock', tone: 'text-danger', chip: 'bg-red-500/15 text-danger border-red-500/30', hint: 'In stock, with history to judge by, and no sale for the dead-stock period.' },
  unavailable: { label: 'Out of stock', tone: 'text-fg/80', chip: 'bg-white/5 text-fg/80 border-white/15', hint: 'No sales, but it was out of stock for most of the period - so that says nothing about demand.' },
  new: { label: 'Too new to tell', tone: 'text-fg/70', chip: 'bg-white/5 text-fg/70 border-white/15', hint: 'No sales yet, and not enough history (item or business) to call it dead.' },
};
const PERIODS = [[7, 'Last 7 days'], [30, 'Last 30 days'], [60, 'Last 60 days'], [90, 'Last 90 days']];
const SETTING_FIELDS = [
  ['fastPercentile', 'Fast-moving = at or above the', 'th percentile of sellers (75 = top 25%)'],
  ['fastMinSoldDays', 'and sold on at least', 'days in the period'],
  ['deadDays', 'Dead stock = no sale for', 'days'],
  ['coverDays', 'Buy enough for', 'days of sales'],
  ['leadTimeDays', 'Delivery takes', 'days'],
  ['safetyDays', 'Plus spare', 'days'],
];
const input = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg';
const th = 'px-3 py-2 text-[10px] font-black uppercase tracking-wider text-fg/65 whitespace-nowrap';
const td = 'px-3 py-2 text-xs whitespace-nowrap';
const dayStr = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

export default function StockMovement({ apiFetch, can }) {
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState(null);           // { start, end } when a range is typed
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);          // settings being changed
  const canSet = !!can?.('inventory.setup');

  const range = useMemo(() => custom || { start: dayStr(new Date(Date.now() - (days - 1) * 86400000)), end: todayStr() }, [custom, days]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await (await apiFetch(`/api/analytics/stock-movement?start=${range.start}&end=${range.end}`)).json();
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load stock movement.');
    } catch { ui.alert('Network error.'); } finally { setLoading(false); }
  }, [apiFetch, range.start, range.end]);
  useEffect(() => { load(); }, [load]);

  const qty = (n) => (Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: data?.wholeUnits ? 2 : 3 });
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.rows || []).filter(r => (filter === 'all' || r.class === filter)
      && (!term || r.itemName.toLowerCase().includes(term) || r.itemCode.toLowerCase().includes(term)));
  }, [data, filter, q]);

  const saveSettings = async (e) => {
    e.preventDefault();
    try {
      const d = await (await apiFetch('/api/analytics/movement-settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, Number(v)]))) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not save.');
      setEditing(null); load();
    } catch { ui.alert('Network error.'); }
  };

  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [`Stock movement ${data.start} to ${data.end}`], [],
      ['Item', 'Code', 'Class', 'In stock', 'Unit', 'On order', 'Sold', 'Orders', 'Days sold', 'Per day', 'Days of stock', 'Last sold', 'Days out of stock', 'Buy'],
      ...rows.map(r => [r.itemName, r.itemCode, CLASSES[r.class].label, r.stock, r.unit, r.onOrder, r.soldQty, r.transactions, r.soldDays, r.adu, r.daysOfStock ?? '', r.lastSold ? dayStr(r.lastSold) : 'never', r.outDays, r.recommend || '']),
    ]), 'Stock movement');
    XLSX.writeFile(wb, `stock-movement-${data.start}-to-${data.end}.xlsx`);
  };

  return (
    <div className="bg-surface border border-white/10 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-brand-text text-sm font-bold uppercase tracking-wider">Stock movement</h3>
          <p className="text-xs text-fg/70 mt-1 max-w-2xl">
            Fast-moving, slow-moving and dead stock from what actually sold - completed sales only, voided and cancelled ones left out.
            {IS_LOG
              ? ' Counted in whole units (one bottle, one box), and bought in whole units: a 2-litre bottle is ordered as 1, 2 or 3 bottles, never half of one.'
              : ' Counted from what the recipes took from stock, so grams and litres count as they were used.'}
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <select value={custom ? 'custom' : days} onChange={e => { if (e.target.value === 'custom') setCustom(range); else { setCustom(null); setDays(Number(e.target.value)); } }} aria-label="Period" className={input}>
            {PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
            <option value="custom">Choose dates…</option>
          </select>
          {custom && <>
            <input type="date" value={custom.start} max={custom.end} onChange={e => setCustom(c => ({ ...c, start: e.target.value }))} aria-label="From" className={input} />
            <input type="date" value={custom.end} min={custom.start} max={todayStr()} onChange={e => setCustom(c => ({ ...c, end: e.target.value }))} aria-label="To" className={input} />
          </>}
          <button type="button" onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand text-on-brand font-bold text-xs disabled:opacity-50"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          {data && <button type="button" onClick={() => setEditing(editing ? null : { ...data.settings })} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-fg/80 font-bold text-xs"><SlidersHorizontal size={13} /> Thresholds</button>}
          {data?.rows?.length > 0 && <button type="button" onClick={exportXlsx} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-fg/80 font-bold text-xs"><Download size={13} /> Excel</button>}
        </div>
      </div>

      {editing && (
        <form onSubmit={saveSettings} className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
          <p className="text-xs text-fg/70">How items are judged. Fast-moving is relative to this business’s own sellers, so it adjusts as sales grow. {!canSet && 'Only someone who sets up stock can change these.'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {SETTING_FIELDS.map(([k, label, unit]) => (
              <label key={k} className="text-xs text-fg/80 font-bold flex items-center gap-2 flex-wrap">{label}
                <input type="number" value={editing[k]} disabled={!canSet} onChange={e => setEditing(s => ({ ...s, [k]: e.target.value }))} className={`${input} w-20`} />
                <span className="font-normal text-fg/70">{unit}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            {canSet && <button type="submit" className="px-4 py-2 rounded-lg bg-brand text-on-brand font-bold text-xs">Save</button>}
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg bg-white/5 text-fg/80 font-bold text-xs">Close</button>
          </div>
        </form>
      )}

      {!data ? <p className="text-fg/65 text-sm text-center p-6 font-bold">{loading ? 'Loading…' : 'Refresh to load.'}</p> : (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            {[['all', `All (${data.rows.length})`], ...Object.entries(CLASSES).map(([k, c]) => [k, `${c.label} (${data.counts[k] || 0})`])].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} title={CLASSES[k]?.hint}
                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold ${filter === k ? 'bg-brand text-on-brand border-brand' : (CLASSES[k]?.chip || 'bg-white/5 text-fg/80 border-white/15')}`}>{label}</button>
            ))}
            <span className="relative ml-auto">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/65" />
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Item or code" aria-label="Search items" className={`${input} pl-8 w-48`} />
            </span>
          </div>
          <p className="text-[11px] text-fg/70">
            {data.start} to {data.end} · {Math.round(data.effectiveDays)} day(s) of sales to go by
            {data.counts.fast + data.counts.slow > 0 && ` · fast-moving means ${qty(data.fastThreshold)} ${data.wholeUnits ? 'unit(s)' : ''} a day or more, on ${data.settings.fastMinSoldDays}+ days`}
            {' · '}buying covers {data.settings.coverDays} days + {data.settings.leadTimeDays} delivery + {data.settings.safetyDays} spare, less what is in stock and on order.
            {data.historyDays < data.settings.deadDays && ' Sales history is still shorter than the dead-stock period, so nothing is called dead yet.'}
          </p>
          <div className="overflow-x-auto border border-white/5 rounded-lg">
            <table className="w-full text-left min-w-[980px]">
              <thead><tr>
                <th className={th}>Item</th><th className={th}>Class</th><th className={`${th} text-right`}>In stock</th><th className={`${th} text-right`}>Sold</th>
                <th className={`${th} text-right`}>Orders</th><th className={`${th} text-right`}>Per day</th><th className={`${th} text-right`}>Lasts</th>
                <th className={th}>Last sold</th><th className={`${th} text-right`}>Buy</th>
              </tr></thead>
              <tbody>
                {rows.slice(0, 400).map(r => (
                  <tr key={r._id} className="border-t border-white/5">
                    <td className={`${td} text-fg font-bold whitespace-normal`}>{r.itemName}{r.itemCode && <span className="block text-[10px] text-fg/65 font-normal font-mono">{r.itemCode}</span>}</td>
                    <td className={td} title={CLASSES[r.class].hint}><span className={`px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-wider ${CLASSES[r.class].chip}`}>{CLASSES[r.class].label}</span>
                      {r.outDays >= 1 && r.class !== 'unavailable' && <span className="block text-[10px] text-fg/65 mt-0.5">out of stock {Math.round(r.outDays)} day(s)</span>}</td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{qty(r.stock)} {r.unit}{r.onOrder > 0 && <span className="block text-[10px] text-fg/65">+{qty(r.onOrder)} on order</span>}</td>
                    <td className={`${td} text-right tabular-nums text-fg`}>{qty(r.soldQty)}</td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{r.transactions}<span className="block text-[10px] text-fg/65">{r.soldDays} day(s)</span></td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{r.adu > 0 ? qty(r.adu) : '-'}</td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{r.daysOfStock != null ? `${Math.floor(r.daysOfStock)} d` : '-'}</td>
                    <td className={`${td} text-fg/80`}>{r.lastSold ? new Date(r.lastSold).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'never'}</td>
                    <td className={`${td} text-right tabular-nums font-black ${r.recommend > 0 ? 'text-brand-text' : 'text-fg/65'}`}>{r.recommend > 0 ? `${qty(r.recommend)} ${r.unit}` : '-'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-fg/65 text-sm font-bold">No items here.</td></tr>}
              </tbody>
            </table>
          </div>
          {rows.length > 400 && <p className="text-[10px] text-fg/65">First 400 of {rows.length}. Search, filter, or take the Excel file for all of them.</p>}
        </>
      )}
    </div>
  );
}
