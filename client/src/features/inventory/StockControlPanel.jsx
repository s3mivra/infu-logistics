import { useSessionState } from '../../shared/useSessionState';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPeso } from '../../shared/money.js';
import { RefreshCw, Download, Search, AlertTriangle, ClipboardCheck } from 'lucide-react';
import * as ui from '../../shared/ui';
import { todayStr } from '../../shared/businessDay.js';
import { PACK_UNIT } from '../../shared/packUnit.js';

import PagedRows from '../../shared/PagedRows';
// Stock control: keeping the stock figures true, so Analytics, the Suggested
// PO and Costing read real numbers. (Server: features/stock-control.js)
//
//   Today's count   a few items a day, chosen by how fast they move and how
//                   long since each was counted. Saved through the same count
//                   as the end-of-day audit (POST /api/inventory/count), only
//                   without closing the day.
//   Variance        every count: expected vs counted, units and pesos
//   Below zero      items sold with no stock on the books, and their trail
//   Settings        selling below zero (warn / block) and how often to count
const SECTIONS = [['count', "Today's count"], ['variance', 'Variance report'], ['negative', 'Below zero'], ['settings', 'Settings']];
const CLASS_LABEL = { fast: 'Fast-moving', slow: 'Slow-moving', dead: 'Dead stock', unavailable: 'Out of stock', new: 'Too new to tell' };
const CYCLE_FIELDS = [
  ['fastDays', 'Count fast-moving items every', 'days'],
  ['slowDays', 'Slow-moving items every', 'days'],
  ['deadDays', 'Dead stock every', 'days'],
  ['otherDays', 'New or out-of-stock items every', 'days'],
  ['maxPerDay', 'At most', 'items a day (below-zero items always added)'],
];
const input = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg';
const th = 'px-3 py-2 text-[10px] font-black uppercase tracking-wider text-fg/65 whitespace-nowrap';
const td = 'px-3 py-2 text-xs whitespace-nowrap';
const btn = 'flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-xs disabled:opacity-50';
const dayStr = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const money = formatPeso;
const signed = (n, f = (x) => x) => `${Number(n) > 0 ? '+' : ''}${f(n)}`;

export default function StockControlPanel({ apiFetch, inventory = [], itemDisplay, can, onCounted }) {
  const [section, setSection] = useState('count');
  const byId = useMemo(() => new Map(inventory.map(i => [String(i._id), i])), [inventory]);
  // The unit an item is counted in - the same as the end-of-day count:
  // packages for logistics, kg / L / pcs for a cafe.
  const countUnit = useCallback((invId, baseUnit = '') => {
    const inv = byId.get(String(invId));
    if (!inv || !itemDisplay) return { base: 1, label: baseUnit || 'units' };
    const d = itemDisplay(inv);
    return { base: d.packBase || 1, label: d.isPacked ? PACK_UNIT : d.unit };
  }, [byId, itemDisplay]);
  const qty = (base, invId, unit) => +((Number(base) || 0) / countUnit(invId, unit).base).toFixed(3);

  return (
    <div className="space-y-3" data-testid="stock-control">
      <div className="flex gap-1 flex-wrap" role="tablist">
        {SECTIONS.filter(([k]) => k !== 'settings' || can?.('inventory.setup')).filter(([k]) => k !== 'count' || can?.('inventory.count')).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={section === k} onClick={() => setSection(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${section === k ? 'bg-brand text-on-brand' : 'bg-white/5 text-fg/80 hover:text-brand-text'}`}>{label}</button>
        ))}
      </div>
      {section === 'count' && <CountList apiFetch={apiFetch} countUnit={countUnit} qty={qty} onCounted={onCounted} />}
      {section === 'variance' && <VarianceReport apiFetch={apiFetch} countUnit={countUnit} qty={qty} />}
      {section === 'negative' && <BelowZero apiFetch={apiFetch} countUnit={countUnit} qty={qty} onCount={() => setSection('count')} />}
      {section === 'settings' && <ControlSettings apiFetch={apiFetch} />}
    </div>
  );
}

function CountList({ apiFetch, countUnit, qty, onCounted }) {
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState({});
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch('/api/stock-control/count-list')).json();
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load the count list.');
    } catch { ui.alert('Network error.'); }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);

  const entered = Object.entries(counts).filter(([, v]) => v !== '' && v !== undefined);
  const submit = async () => {
    if (!entered.length) return ui.alert('Enter at least one count.');
    if (entered.some(([, v]) => !(Number(v) >= 0))) return ui.alert('Counts must be numbers of zero or more.');
    // Counted units -> base units, as the end-of-day count sends them.
    const countsBase = Object.fromEntries(entered.map(([id, v]) => [id, +(Number(v) * countUnit(id).base).toFixed(6)]));
    setBusy(true);
    try {
      const d = await (await apiFetch('/api/inventory/count', { method: 'POST', body: JSON.stringify({ rolling: true, counts: countsBase, reasons }) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not save the count.');
      ui.alert(`Counted ${d.counted} item(s). Any difference was adjusted and booked, the same as the end-of-day count.`);
      setCounts({}); setReasons({});
      onCounted?.();
      load();
    } catch { ui.alert('Network error.'); } finally { setBusy(false); }
  };

  return (
    <div className="bg-surface border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-brand-text text-sm font-bold uppercase tracking-wider">Today&apos;s count</h3>
          <p className="text-[11px] text-fg/70 mt-0.5 max-w-3xl">
            A few items a day instead of everything at once. Fast-moving items come up every {data?.cycle?.fastDays ?? 7} days,
            slow-moving every {data?.cycle?.slowDays ?? 30}, dead stock every {data?.cycle?.deadDays ?? 90}; anything below zero is always on the list.
            Saving adjusts the stock and books any difference, like the end-of-day count, but does not close the day.
          </p>
        </div>
        <button type="button" onClick={load} className={`${btn} bg-white/5 text-fg/80`}><RefreshCw size={13} /> Refresh</button>
      </div>
      {!data ? <p className="text-xs text-fg/65">Loading…</p> : data.list.length === 0 ? (
        <p className="text-xs text-fg/70" data-testid="count-list-empty">Nothing is due for counting today.</p>
      ) : (
        <>
          <p className="text-[11px] text-fg/70">{data.list.length} item(s) today{data.dueTotal > data.list.length ? ` - ${data.dueTotal} are due; the rest come up on the next days` : ''}.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left" data-testid="count-list">
              <thead><tr className="border-b border-white/10">
                <th className={th}>Item</th><th className={th}>Why</th><th className={th}>Class</th><th className={`${th} text-right`}>On the books</th><th className={th}>Counted</th><th className={th}>Reason for a difference</th>
              </tr></thead>
              <tbody>
                {data.list.map(r => {
                  const u = countUnit(r._id, r.unit);
                  return (
                    <tr key={r._id} className="border-b border-white/5" data-testid={`count-row-${r.itemCode || r._id}`}>
                      <td className={td}><span className="font-bold text-fg">{r.itemName}</span>{r.itemCode && <span className="text-fg/60 ml-2">{r.itemCode}</span>}</td>
                      <td className={`${td} ${r.belowZero ? 'text-danger font-bold' : 'text-fg/80'}`}>{r.reason}</td>
                      <td className={`${td} text-fg/80`}>{CLASS_LABEL[r.class] || r.class}</td>
                      <td className={`${td} text-right tabular-nums ${r.belowZero ? 'text-danger' : 'text-fg'}`}>{qty(r.stockQty, r._id, r.unit)} {u.label}</td>
                      <td className={td}>
                        <input type="number" min="0" step="any" inputMode="decimal" aria-label={`Counted ${r.itemName}`} value={counts[r._id] ?? ''}
                          onChange={e => setCounts(c => ({ ...c, [r._id]: e.target.value }))} className={`${input} w-28`} />
                        <span className="text-fg/60 ml-1">{u.label}</span>
                      </td>
                      <td className={td}>
                        <input type="text" aria-label={`Reason ${r.itemName}`} value={reasons[r._id] ?? ''} placeholder="e.g. delivery not received"
                          onChange={e => setReasons(x => ({ ...x, [r._id]: e.target.value }))} className={`${input} w-56`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={submit} disabled={busy || !entered.length} className={`${btn} bg-brand text-on-brand`}><ClipboardCheck size={13} /> Save {entered.length || ''} count(s)</button>
          </div>
        </>
      )}
    </div>
  );
}

function VarianceReport({ apiFetch, countUnit, qty }) {
  const [range, setRange] = useState(() => ({ start: dayStr(new Date(Date.now() - 29 * 86400000)), end: todayStr() }));
  const [countedBy, setCountedBy] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useSessionState('stockcontrol.q', '');
  const [varianceOnly, setVarianceOnly] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ start: range.start, end: range.end });
    if (countedBy) p.set('countedBy', countedBy);
    if (kind) p.set('kind', kind);
    if (q.trim()) p.set('q', q.trim());
    if (varianceOnly) p.set('varianceOnly', '1');
    try {
      const d = await (await apiFetch(`/api/stock-control/variance?${p}`)).json();
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load the variance report.');
    } catch { ui.alert('Network error.'); } finally { setLoading(false); }
  }, [apiFetch, range.start, range.end, countedBy, kind, q, varianceOnly]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const kindLabel = (k) => (k === 'rolling' ? 'Rolling' : 'End of day');
  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [`Stock count variance ${data.start} to ${data.end}`], [],
      ['Date', 'Item', 'Code', 'Unit', 'Expected', 'Counted', 'Variance', 'Unit cost (per unit)', 'Variance value', 'Counted by', 'Count', 'Reason', 'Reference'],
      ...data.rows.map(r => {
        const u = countUnit(r.inventoryId, r.unit);
        return [r.dateString, r.itemName, r.itemCode, u.label, qty(r.expectedQty, r.inventoryId, r.unit), qty(r.countedQty, r.inventoryId, r.unit), qty(r.variance, r.inventoryId, r.unit),
          +((r.unitCost || 0) * u.base).toFixed(4), r.varianceValue, r.countedBy, kindLabel(r.kind), r.reason, r.reference];
      }),
      [], ['Items counted', data.totals.counted], ['With a difference', data.totals.withVariance],
      ['Short (value)', data.totals.shortValue], ['Over (value)', data.totals.overValue], ['Net (value)', data.totals.netValue],
    ]), 'Variance');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Counted by', 'Items counted', 'With a difference', 'Short', 'Over', 'Net'],
      ...data.byCounter.map(c => [c.countedBy, c.counted, c.withVariance, c.shortValue, c.overValue, c.netValue]),
    ]), 'By counter');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Date', 'Items counted', 'With a difference', 'Short', 'Over', 'Net'],
      ...data.byDay.map(c => [c.dateString, c.counted, c.withVariance, c.shortValue, c.overValue, c.netValue]),
    ]), 'By day');
    XLSX.writeFile(wb, `stock-variance-${data.start}-to-${data.end}.xlsx`);
  };

  return (
    <div className="bg-surface border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-brand-text text-sm font-bold uppercase tracking-wider">Count variance</h3>
          <p className="text-[11px] text-fg/70 mt-0.5 max-w-3xl">Every count - rolling and end of day - with what the books expected, what was found, and the difference in units and at cost. Short and over are kept apart so they do not cancel out.</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <input type="date" value={range.start} max={range.end} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} aria-label="From" className={input} />
          <input type="date" value={range.end} min={range.start} max={todayStr()} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} aria-label="To" className={input} />
          <button type="button" onClick={load} disabled={loading} className={`${btn} bg-white/5 text-fg/80`}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          {data?.rows?.length > 0 && <button type="button" onClick={exportXlsx} className={`${btn} bg-white/5 text-fg/80`}><Download size={13} /> Excel</button>}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/60" />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Item or code" aria-label="Search items" className={`${input} pl-8`} />
        </div>
        <select value={countedBy} onChange={e => setCountedBy(e.target.value)} aria-label="Counted by" className={input}>
          <option value="">Everyone</option>
          {(data?.counters || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind of count" className={input}>
          <option value="">All counts</option><option value="rolling">Rolling</option><option value="eod">End of day</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-fg/80"><input type="checkbox" checked={varianceOnly} onChange={e => setVarianceOnly(e.target.checked)} /> Only differences</label>
      </div>
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="variance-totals">
          {[['Counted', data.totals.counted], ['With a difference', data.totals.withVariance], ['Short', money(data.totals.shortValue)], ['Over', money(data.totals.overValue)], ['Net', money(data.totals.netValue)]].map(([l, v]) => (
            <div key={l} className="bg-white/5 rounded-lg px-3 py-2"><p className="text-[10px] uppercase tracking-wider text-fg/65 font-black">{l}</p><p className="text-sm font-bold text-fg tabular-nums">{v}</p></div>
          ))}
        </div>
      )}
      {data && data.byCounter.length > 1 && (
        <p className="text-[11px] text-fg/70">By counter: {data.byCounter.map(c => `${c.countedBy} ${c.counted} counted, net ${money(c.netValue)}`).join(' · ')}</p>
      )}
      {data && (data.rows.length === 0 ? <p className="text-xs text-fg/70">No counts in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left" data-testid="variance-table">
            <thead><tr className="border-b border-white/10">
              <th className={th}>Date</th><th className={th}>Item</th><th className={`${th} text-right`}>Expected</th><th className={`${th} text-right`}>Counted</th><th className={`${th} text-right`}>Variance</th><th className={`${th} text-right`}>Value</th><th className={th}>Counted by</th><th className={th}>Count</th><th className={th}>Reason</th>
            </tr></thead>
            <tbody>
              <PagedRows items={data.rows} label="counts" render={r => {
                const u = countUnit(r.inventoryId, r.unit);
                const tone = r.variance < 0 ? 'text-danger' : r.variance > 0 ? 'text-warning' : 'text-fg/70';
                return (
                  <tr key={r._id} className="border-b border-white/5">
                    <td className={`${td} text-fg/80`}>{r.dateString}</td>
                    <td className={td}><span className="font-bold text-fg">{r.itemName}</span>{r.itemCode && <span className="text-fg/60 ml-2">{r.itemCode}</span>}</td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{qty(r.expectedQty, r.inventoryId, r.unit)} {u.label}</td>
                    <td className={`${td} text-right tabular-nums text-fg`}>{qty(r.countedQty, r.inventoryId, r.unit)} {u.label}</td>
                    <td className={`${td} text-right tabular-nums font-bold ${tone}`}>{signed(qty(r.variance, r.inventoryId, r.unit))}</td>
                    <td className={`${td} text-right tabular-nums font-bold ${tone}`}>{signed(r.varianceValue, money)}</td>
                    <td className={`${td} text-fg/80`}>{r.countedBy}</td>
                    <td className={`${td} text-fg/70`}>{kindLabel(r.kind)}</td>
                    <td className={`${td} text-fg/70`}>{r.reason}</td>
                  </tr>
                );
              }} />
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function BelowZero({ apiFetch, countUnit, qty, onCount }) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch('/api/stock-control/below-zero')).json();
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load.');
    } catch { ui.alert('Network error.'); }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="bg-surface border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-brand-text text-sm font-bold uppercase tracking-wider">Below zero</h3>
          <p className="text-[11px] text-fg/70 mt-0.5 max-w-3xl">Items sold with no stock on the books - a delivery not yet received, or a count that was off. The last movements show where it went wrong; a count puts it right. Each one is on today&apos;s count list.</p>
        </div>
        <button type="button" onClick={load} className={`${btn} bg-white/5 text-fg/80`}><RefreshCw size={13} /> Refresh</button>
      </div>
      {!data ? <p className="text-xs text-fg/65">Loading…</p> : data.items.length === 0 ? <p className="text-xs text-fg/70" data-testid="below-zero-empty">Nothing is below zero.</p> : (
        <div className="space-y-3" data-testid="below-zero-list">
          {data.items.map(i => {
            const u = countUnit(i._id, i.unit);
            return (
              <div key={i._id} className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-bold text-fg flex items-center gap-2"><AlertTriangle size={14} className="text-danger" /> {i.itemName} {i.itemCode && <span className="text-fg/60 font-normal text-xs">{i.itemCode}</span>}</p>
                  <div className="flex items-center gap-3">
                    <span className="text-danger font-bold text-sm tabular-nums">{qty(i.stockQty, i._id, i.unit)} {u.label} · {money(i.value)}</span>
                    <button type="button" onClick={onCount} className={`${btn} bg-brand text-on-brand`}><ClipboardCheck size={13} /> Count it</button>
                  </div>
                </div>
                <table className="w-full text-left mt-2">
                  <thead><tr><th className={th}>Date</th><th className={th}>Type</th><th className={th}>Reference</th><th className={`${th} text-right`}>Change</th><th className={`${th} text-right`}>Balance</th><th className={th}>Remarks</th></tr></thead>
                  <tbody>
                    {i.lastLines.map((c, n) => (
                      <tr key={n} className="border-t border-white/5">
                        <td className={`${td} text-fg/80`}>{new Date(c.date).toLocaleString('en-PH')}</td>
                        <td className={`${td} text-fg/80`}>{c.type}</td>
                        <td className={`${td} text-fg/80`}>{c.reference}</td>
                        <td className={`${td} text-right tabular-nums`}>{signed(qty(c.qtyChange, i._id, i.unit))}</td>
                        <td className={`${td} text-right tabular-nums ${c.balanceAfter < 0 ? 'text-danger font-bold' : 'text-fg'}`}>{qty(c.balanceAfter, i._id, i.unit)}</td>
                        <td className={`${td} text-fg/70`}>{c.remarks}{c.belowZero ? ' · sold below zero' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ControlSettings({ apiFetch }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch('/api/stock-control/settings')).json();
      if (d.success) { setData(d); setForm({ negativeStockMode: d.negativeStockMode, ...d.countCycle }); } else ui.alert(d.error || 'Could not load.');
    } catch { ui.alert('Network error.'); }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);
  if (!form) return <p className="text-xs text-fg/65">Loading…</p>;
  const save = async (e) => {
    e.preventDefault();
    const wrong = CYCLE_FIELDS.filter(([k]) => { const [lo, hi] = data.limits[k], n = Number(form[k]); return !(form[k] !== '' && n >= lo && n <= hi); });
    if (wrong.length) return ui.alert(`Check: ${wrong.map(([k, l]) => `${l} (${data.limits[k][0]}-${data.limits[k][1]})`).join(', ')}.`);
    try {
      const d = await (await apiFetch('/api/stock-control/settings', { method: 'PUT', body: JSON.stringify({
        negativeStockMode: form.negativeStockMode,
        countCycle: Object.fromEntries(CYCLE_FIELDS.map(([k]) => [k, Number(form[k])])),
      }) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not save.');
      ui.toast(`Stock control saved: selling below zero is ${form.negativeStockMode === 'block' ? 'blocked' : form.negativeStockMode === 'warn' ? 'allowed with a warning' : form.negativeStockMode}.`, { tone: 'success' });
      load();
    } catch { ui.alert('Network error.'); }
  };
  return (
    <form onSubmit={save} className="bg-surface border border-white/10 rounded-xl p-4 space-y-4">
      <div>
        <h3 className="text-brand-text text-sm font-bold uppercase tracking-wider">Selling below zero</h3>
        <p className="text-[11px] text-fg/70 mt-0.5 max-w-3xl">When a sale needs more than the books say is on the shelf. Stock held for a client&apos;s order is never sold either way.</p>
        <div className="mt-2 space-y-1">
          {[['warn', 'Allow it and warn', 'The sale goes through; the item is flagged, managers are told, and it goes on the count list.'],
            ['block', 'Block it', 'The sale is refused until the stock is received or counted.']].map(([v, l, hint]) => (
            <label key={v} className="flex items-start gap-2 text-xs text-fg">
              <input type="radio" name="negativeStockMode" value={v} checked={form.negativeStockMode === v} onChange={() => setForm(f => ({ ...f, negativeStockMode: v }))} className="mt-0.5" />
              <span><span className="font-bold">{l}</span> <span className="text-fg/70">- {hint}</span></span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-brand-text text-sm font-bold uppercase tracking-wider">Rolling counts</h3>
        <div className="mt-2 space-y-2">
          {CYCLE_FIELDS.map(([k, before, after]) => (
            <label key={k} className="flex items-center gap-2 text-xs text-fg/80 flex-wrap">
              {before}
              <input type="number" min={data.limits[k][0]} max={data.limits[k][1]} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} aria-label={before} className={`${input} w-20`} />
              {after}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end"><button type="submit" className={`${btn} bg-brand text-on-brand`}>Save</button></div>
    </form>
  );
}
