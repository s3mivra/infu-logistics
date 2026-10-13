import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Download } from 'lucide-react';
import * as ui from '../../shared/ui';
import { monthStartStr, todayStr } from '../../shared/businessDay.js';

// Two reports that only read what is already recorded:
//   Waste Log      - every spoilage, what it cost and the reason given
//   Sales by Hour  - when the business is busy: by hour, weekday and place
const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (n) => (Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const btn = 'flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition';
const btnBrand = `${btn} bg-brand text-on-brand hover:bg-brand/90 disabled:opacity-50`;
const btnGhost = `${btn} bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg`;
const input = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg';
const th = 'px-3 py-2 text-[10px] font-black uppercase tracking-wider text-fg/65';
const td = 'px-3 py-2 text-xs';

function useReport(apiFetch, path) {
  const [range, setRange] = useState({ start: monthStartStr(), end: todayStr() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await (await apiFetch(`${path}?start=${range.start}&end=${range.end}`)).json();
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load the report.');
    } catch { ui.alert('Network error.'); }
    finally { setLoading(false); }
  }, [apiFetch, path, range.start, range.end]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { range, setRange, data, loading, load };
}

function RangeBar({ range, setRange, loading, load, onExport, children }) {
  return (
    <div className="flex justify-between items-end gap-3 flex-wrap">
      <p className="text-xs text-fg/65 max-w-xl">{children}</p>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">From
          <input type="date" value={range.start} max={range.end} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} className={`${input} block mt-1`} /></label>
        <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">To
          <input type="date" value={range.end} min={range.start} max={todayStr()} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} className={`${input} block mt-1`} /></label>
        <button type="button" onClick={load} disabled={loading} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        {onExport && <button type="button" onClick={onExport} className={btnGhost}><Download size={14} /> Excel</button>}
      </div>
    </div>
  );
}

const Card = ({ children, className = '' }) => <div className={`bg-surface border border-white/10 rounded-xl ${className}`}>{children}</div>;
const Empty = ({ children }) => <p className="text-fg/65 text-sm text-center p-8 font-bold">{children}</p>;
const Tile = ({ label, value, hint }) => (
  <Card className="px-4 py-3">
    <p className="text-[10px] font-black uppercase tracking-wider text-fg/65">{label}</p>
    <p className="text-xl font-black tabular-nums text-fg mt-0.5">{value}</p>
    {hint && <p className="text-[10px] text-fg/65 mt-0.5">{hint}</p>}
  </Card>
);
// A bar the width of this row's share of the biggest row.
const Bar = ({ value, max }) => (
  <div className="h-2 rounded-full bg-white/5 overflow-hidden min-w-[60px]" aria-hidden="true">
    <div className="h-full bg-brand" style={{ width: `${max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0}%` }} />
  </div>
);

async function saveSheets(name, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const [title, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), title);
  XLSX.writeFile(wb, name);
}

// ── WASTE LOG ───────────────────────────────────────────────────────────────
export function WasteReport({ apiFetch }) {
  const { range, setRange, data, loading, load } = useReport(apiFetch, '/api/reports/waste');
  const exportXlsx = () => data && saveSheets(`waste-log-${data.start}-to-${data.end}.xlsx`, [
    ['By item', [['Item', 'Code', 'Times', 'Quantity', 'Unit', 'Cost'], ...data.byItem.map(r => [r.key, r.itemCode, r.count, r.qty, r.unit, r.value])]],
    ['By reason', [['Reason', 'Times', 'Cost'], ...data.byReason.map(r => [r.key, r.count, r.value])]],
    ['Every entry', [['Date', 'Reference', 'Item', 'Code', 'Quantity', 'Unit', 'Unit cost', 'Cost', 'Reason', 'Note'],
      ...data.rows.map(r => [new Date(r.date).toLocaleString(), r.reference, r.itemName, r.itemCode, r.qty, r.unit, r.unitCost, r.value, r.reason, r.note])]],
  ]);
  const maxItem = data?.byItem?.[0]?.value || 0;
  return (
    <div className="space-y-4 animate-fade-in">
      <RangeBar range={range} setRange={setRange} loading={loading} load={load} onExport={data?.count ? exportXlsx : null}>
        Everything recorded as spoiled or wasted, what it cost, and the reason given. Each entry has already been posted to Spoilage, Variance &amp; Waste; this is the list behind that figure. Record one on Inventory → Record spoilage.
      </RangeBar>
      {!data ? <Empty>{loading ? 'Loading…' : 'Refresh to load.'}</Empty> : data.count === 0 ? (
        <Empty>Nothing was recorded as wasted from {data.start} to {data.end}.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Cost of waste" value={peso(data.total)} hint={`${data.start} to ${data.end}`} />
            <Tile label="Entries" value={data.count} />
            <Tile label="Costliest item" value={data.byItem[0]?.key || '-'} hint={data.byItem[0] ? peso(data.byItem[0].value) : ''} />
            <Tile label="Most common reason" value={[...data.byReason].sort((a, b) => b.count - a.count)[0]?.key || '-'} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="overflow-x-auto">
              <table className="w-full text-left">
                <thead><tr><th className={th}>Item</th><th className={`${th} text-right`}>Times</th><th className={`${th} text-right`}>Quantity</th><th className={`${th} text-right`}>Cost</th><th className={th}></th></tr></thead>
                <tbody>
                  {data.byItem.slice(0, 50).map(r => (
                    <tr key={r.key} className="border-t border-white/5">
                      <td className={`${td} text-fg font-bold`}>{r.key}{r.itemCode && <span className="block text-[10px] text-fg/65 font-normal">{r.itemCode}</span>}</td>
                      <td className={`${td} text-right tabular-nums text-fg/80`}>{r.count}</td>
                      <td className={`${td} text-right tabular-nums text-fg/80`}>{qtyText(r.qty)} {r.unit}</td>
                      <td className={`${td} text-right font-mono text-fg`}>{peso(r.value)}</td>
                      <td className={`${td} w-24`}><Bar value={r.value} max={maxItem} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card className="overflow-x-auto self-start">
              <table className="w-full text-left">
                <thead><tr><th className={th}>Reason</th><th className={`${th} text-right`}>Times</th><th className={`${th} text-right`}>Cost</th></tr></thead>
                <tbody>
                  {data.byReason.map(r => (
                    <tr key={r.key} className="border-t border-white/5">
                      <td className={`${td} text-fg font-bold`}>{r.key}</td>
                      <td className={`${td} text-right tabular-nums text-fg/80`}>{r.count}</td>
                      <td className={`${td} text-right font-mono text-fg`}>{peso(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-left min-w-[640px]">
              <thead><tr><th className={th}>When</th><th className={th}>Item</th><th className={`${th} text-right`}>Quantity</th><th className={`${th} text-right`}>Cost</th><th className={th}>Reason</th></tr></thead>
              <tbody>
                {data.rows.slice(0, 200).map((r, i) => (
                  <tr key={`${r.reference}-${i}`} className="border-t border-white/5">
                    <td className={`${td} text-fg/80 whitespace-nowrap`}>{new Date(r.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className={`${td} text-fg`}>{r.itemName}</td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{qtyText(r.qty)} {r.unit}</td>
                    <td className={`${td} text-right font-mono text-fg`}>{peso(r.value)}</td>
                    <td className={`${td} text-fg/80`}>{r.reason}{r.note && <span className="text-fg/65"> - {r.note}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(data.rows.length > 200 || data.truncated) && <p className="text-[10px] text-fg/65 p-3">Showing the latest 200 of {data.count}. The Excel file has them all{data.truncated ? ' (up to 1,000)' : ''}.</p>}
          </Card>
        </>
      )}
    </div>
  );
}

// ── SALES BY HOUR ───────────────────────────────────────────────────────────
function Breakdown({ title, rows, firstCol }) {
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  return (
    <Card className="overflow-x-auto">
      <p className="px-3 pt-3 text-xs font-black uppercase tracking-wider text-fg">{title}</p>
      <table className="w-full text-left">
        <thead><tr><th className={th}>{firstCol}</th><th className={`${th} text-right`}>Sales</th><th className={`${th} text-right`}>Orders</th><th className={`${th} text-right`}>Average</th><th className={`${th} text-right`}>Share</th><th className={th}></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className="border-t border-white/5">
              <td className={`${td} text-fg font-bold whitespace-nowrap`}>{r.label}</td>
              <td className={`${td} text-right font-mono text-fg`}>{peso(r.total)}</td>
              <td className={`${td} text-right tabular-nums text-fg/80`}>{r.orders}</td>
              <td className={`${td} text-right font-mono text-fg/80`}>{peso(r.average)}</td>
              <td className={`${td} text-right tabular-nums text-fg/80`}>{r.share}%</td>
              <td className={`${td} w-28`}><Bar value={r.total} max={max} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function SalesByHourReport({ apiFetch }) {
  const { range, setRange, data, loading, load } = useReport(apiFetch, '/api/reports/sales-by-hour');
  const sheet = (first, rows) => [[first, 'Sales', 'Orders', 'Average', 'Share %'], ...rows.map(r => [r.label, r.total, r.orders, r.average, r.share])];
  const exportXlsx = () => data && saveSheets(`sales-by-hour-${data.start}-to-${data.end}.xlsx`, [
    ['By hour', sheet('Hour', data.byHour)], ['By weekday', sheet('Day', data.byWeekday)], [`By ${data.placeLabel}`.slice(0, 31), sheet(data.placeLabel, data.byPlace)],
  ]);
  return (
    <div className="space-y-4 animate-fade-in">
      <RangeBar range={range} setRange={setRange} loading={loading} load={load} onExport={data?.orders ? exportXlsx : null}>
        When the business is busy: completed sales by the hour they were made, by weekday, and by {data?.placeLabel ? data.placeLabel.toLowerCase() : 'where they were served'}. Complimentary orders are left out.
      </RangeBar>
      {!data ? <Empty>{loading ? 'Loading…' : 'Refresh to load.'}</Empty> : data.orders === 0 ? (
        <Empty>No completed sales from {data.start} to {data.end}.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Sales" value={peso(data.total)} hint={`${data.orders} orders over ${data.tradingDays} day(s)`} />
            <Tile label="Average order" value={peso(data.orders ? data.total / data.orders : 0)} />
            <Tile label="Busiest hour" value={data.busiestHour || '-'} hint="by sales" />
            <Tile label="Busiest day" value={data.busiestDay || '-'} hint="by sales" />
          </div>
          {/* What sells when: the day in four parts, with its best sellers. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {(data.byDaypart || []).map(p => (
              <Card key={p.label} className="p-4">
                <p className="text-xs font-black uppercase tracking-wider text-fg">{p.label} <span className="text-fg/65 font-bold normal-case tracking-normal">· {p.span}</span></p>
                <p className="text-lg font-black tabular-nums text-fg mt-1">{peso(p.total)}</p>
                <p className="text-[10px] text-fg/65">{p.orders} order(s) · {p.share}% of sales</p>
                {p.top.length > 0 ? (
                  <ol className="mt-2 space-y-0.5">
                    {p.top.map(t => <li key={t.name} className="flex justify-between gap-2 text-[11px] text-fg/80"><span className="truncate">{t.name}</span><span className="tabular-nums shrink-0">{qtyText(t.qty)}</span></li>)}
                  </ol>
                ) : <p className="mt-2 text-[11px] text-fg/65">Nothing sold.</p>}
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Breakdown title="By hour" firstCol="Hour" rows={data.byHour} />
            <div className="space-y-4">
              <Breakdown title="By weekday" firstCol="Day" rows={data.byWeekday} />
              <Breakdown title={`By ${data.placeLabel.toLowerCase()}`} firstCol={data.placeLabel} rows={data.byPlace.slice(0, 40)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── CASH FORECAST ───────────────────────────────────────────────────────────
export function CashForecastReport({ apiFetch }) {
  const [days, setDays] = useState(28);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (n = days) => {
    setLoading(true);
    try {
      const d = await (await apiFetch(`/api/reports/cash-forecast?days=${n}`)).json();
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load the forecast.');
    } catch { ui.alert('Network error.'); }
    finally { setLoading(false); }
  }, [apiFetch, days]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const day = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : 'no due date');
  const exportXlsx = () => data && saveSheets(`cash-forecast-${data.asOf}.xlsx`, [
    ['Weeks', [['Week', 'From', 'To', 'Expected in', 'To pay', 'Net', 'Cash at end'], ...data.weeks.map(w => [w.week, w.from, w.to, w.in, w.out, w.net, w.balance])]],
    ['Owed to us', [['Reference', 'Customer', 'Due', 'Amount'], ...data.receivables.map(r => [r.ref, r.name, r.due ? String(r.due).slice(0, 10) : '', r.amount])]],
    ['Bills to pay', [['Bill', 'Supplier', 'Due', 'Amount', 'Approved?'], ...data.payables.map(r => [r.ref, r.name, r.due ? String(r.due).slice(0, 10) : '', r.amount, r.awaitingApproval ? 'Not yet' : 'Yes'])]],
  ]);
  const list = (title, rows, total) => (
    <Card className="overflow-x-auto">
      <p className="px-3 pt-3 text-xs font-black uppercase tracking-wider text-fg">{title} <span className="text-fg/65 font-bold normal-case tracking-normal">· {peso(total)}</span></p>
      <table className="w-full text-left">
        <thead><tr><th className={th}>Due</th><th className={th}>Who</th><th className={th}>Reference</th><th className={`${th} text-right`}>Amount</th></tr></thead>
        <tbody>
          {rows.slice(0, 25).map(r => {
            const late = r.due && new Date(r.due) < new Date(data.asOf);
            return (
              <tr key={r.ref} className="border-t border-white/5">
                <td className={`${td} whitespace-nowrap ${late ? 'text-danger font-bold' : 'text-fg/80'}`}>{day(r.due)}{late ? ' · overdue' : ''}</td>
                <td className={`${td} text-fg`}>{r.name}{r.awaitingApproval && <span className="block text-[10px] text-fg/65">not yet approved</span>}</td>
                <td className={`${td} text-fg/80`}>{r.ref}</td>
                <td className={`${td} text-right font-mono text-fg`}>{peso(r.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 25 && <p className="text-[10px] text-fg/65 p-3">The 25 due soonest. The Excel file lists up to 100.</p>}
    </Card>
  );
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <p className="text-xs text-fg/65 max-w-xl">The coming weeks from what is already on the books: the cash there is now, what customers owe and when it falls due, and the bills to pay. It does not guess future sales. Overdue amounts are counted in week 1.</p>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Look ahead
            <select value={days} onChange={e => { const n = Number(e.target.value); setDays(n); load(n); }} className={`${input} block mt-1`}>
              <option value={14}>2 weeks</option><option value={28}>4 weeks</option><option value={56}>8 weeks</option><option value={91}>13 weeks</option>
            </select></label>
          <button type="button" onClick={() => load()} disabled={loading} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          {data && <button type="button" onClick={exportXlsx} className={btnGhost}><Download size={14} /> Excel</button>}
        </div>
      </div>
      {!data ? <Empty>{loading ? 'Loading…' : 'Refresh to load.'}</Empty> : (
        <>
          {data.shortfall && (
            <p className="text-sm font-black text-danger">Cash runs short in week {data.lowest.week}: {peso(data.lowest.balance)}. Bills fall due before the money to pay them is expected.</p>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Cash now" value={peso(data.cashNow)} hint="cash, bank, e-wallets, checks in hand" />
            <Tile label="Expected in" value={peso(data.expectedIn.total)} hint={data.expectedIn.overdue > 0 ? `${peso(data.expectedIn.overdue)} already overdue` : 'nothing overdue'} />
            <Tile label="To pay" value={peso(data.expectedOut.total)} hint={data.awaitingApproval > 0 ? `${peso(data.awaitingApproval)} not yet approved` : (data.expectedOut.overdue > 0 ? `${peso(data.expectedOut.overdue)} overdue` : 'nothing overdue')} />
            <Tile label={`Cash in ${data.weeks.length} weeks`} value={peso(data.endingBalance)} hint={`lowest ${peso(data.lowest.balance)}`} />
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-left min-w-[560px]">
              <thead><tr><th className={th}>Week</th><th className={`${th} text-right`}>Expected in</th><th className={`${th} text-right`}>To pay</th><th className={`${th} text-right`}>Net</th><th className={`${th} text-right`}>Cash at end</th></tr></thead>
              <tbody>
                {data.weeks.map(w => (
                  <tr key={w.week} className="border-t border-white/5">
                    <td className={`${td} text-fg font-bold whitespace-nowrap`}>{day(w.from)} – {day(w.to)}</td>
                    <td className={`${td} text-right font-mono text-fg/80`}>{peso(w.in)}</td>
                    <td className={`${td} text-right font-mono text-fg/80`}>{peso(w.out)}</td>
                    <td className={`${td} text-right font-mono ${w.net < 0 ? 'text-danger' : 'text-fg'}`}>{peso(w.net)}</td>
                    <td className={`${td} text-right font-mono font-bold ${w.balance < 0 ? 'text-danger' : 'text-fg'}`}>{peso(w.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(data.expectedIn.undated > 0 || data.expectedOut.undated > 0 || data.expectedIn.later > 0 || data.expectedOut.later > 0) && (
              <p className="text-[10px] text-fg/65 p-3">
                Not in the weeks above: {peso(data.expectedIn.undated)} owed with no due date, {peso(data.expectedOut.undated)} of bills with no due date
                {(data.expectedIn.later > 0 || data.expectedOut.later > 0) ? `, and ${peso(data.expectedIn.later)} in / ${peso(data.expectedOut.later)} out due after this window` : ''}.
              </p>
            )}
          </Card>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {list('Owed to us', data.receivables, data.expectedIn.total)}
            {list('Bills to pay', data.payables, data.expectedOut.total)}
          </div>
        </>
      )}
    </div>
  );
}

// ── CASHIER PERFORMANCE ─────────────────────────────────────────────────────
export function CashierPerformanceReport({ apiFetch }) {
  const { range, setRange, data, loading, load } = useReport(apiFetch, '/api/reports/cashier-performance');
  const exportXlsx = () => data && saveSheets(`cashier-performance-${data.start}-to-${data.end}.xlsx`, [
    ['Cashiers', [['Cashier', 'Sales', 'Orders', 'Average', 'Voids', 'Void value', 'Void %', 'Refunds', 'Refund value', 'Discounted orders', 'Discount value', 'Complimentary'],
      ...data.cashiers.map(c => [c.name, c.sales, c.orders, c.average, c.voids, c.voidValue, c.voidRate, c.refunds, c.refundValue, c.discounted, c.discountValue, c.complimentary])]],
  ]);
  // Twice the shop's own void rate, and at least a handful: worth a question.
  const flag = (c) => data.totals.voidRate > 0 && c.voids >= 3 && c.voidRate >= data.totals.voidRate * 2;
  return (
    <div className="space-y-4 animate-fade-in">
      <RangeBar range={range} setRange={setRange} loading={loading} load={load} onExport={data?.cashiers?.length ? exportXlsx : null}>
        Each person at the till: what they sold, and their voids, refunds, discounts and complimentary orders. A high figure is a question to ask, not a finding - the busiest cashier also voids the most, which is why the rates are shown.
      </RangeBar>
      {!data ? <Empty>{loading ? 'Loading…' : 'Refresh to load.'}</Empty> : data.cashiers.length === 0 ? (
        <Empty>No sales or voids from {data.start} to {data.end}.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Sales" value={peso(data.totals.sales)} hint={`${data.totals.orders} orders`} />
            <Tile label="Voids" value={data.totals.voids} hint={`${peso(data.totals.voidValue)} · ${data.totals.voidRate}% of orders`} />
            <Tile label="Refunds" value={data.totals.refunds} hint={peso(data.totals.refundValue)} />
            <Tile label="Discounts given" value={peso(data.totals.discountValue)} hint={`${data.totals.complimentary} complimentary`} />
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-left min-w-[760px]">
              <thead><tr>
                <th className={th}>Cashier</th><th className={`${th} text-right`}>Sales</th><th className={`${th} text-right`}>Orders</th><th className={`${th} text-right`}>Average</th>
                <th className={`${th} text-right`}>Voids</th><th className={`${th} text-right`}>Refunds</th><th className={`${th} text-right`}>Discounts</th><th className={`${th} text-right`}>Comp.</th>
              </tr></thead>
              <tbody>
                {data.cashiers.map(c => (
                  <tr key={c.name} className="border-t border-white/5">
                    <td className={`${td} text-fg font-bold`}>{c.name}{flag(c) && <span className="block text-[10px] text-danger font-bold">voids well above the shop rate</span>}</td>
                    <td className={`${td} text-right font-mono text-fg`}>{peso(c.sales)}</td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{c.orders}</td>
                    <td className={`${td} text-right font-mono text-fg/80`}>{peso(c.average)}</td>
                    <td className={`${td} text-right tabular-nums ${flag(c) ? 'text-danger font-bold' : 'text-fg/80'}`}>{c.voids}<span className="block text-[10px] text-fg/65 font-normal">{peso(c.voidValue)} · {c.voidRate}%</span></td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{c.refunds}<span className="block text-[10px] text-fg/65">{peso(c.refundValue)}</span></td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{c.discounted}<span className="block text-[10px] text-fg/65">{peso(c.discountValue)} · {c.discountRate}%</span></td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{c.complimentary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

// ── SUPPLIER PRICES ─────────────────────────────────────────────────────────
export function SupplierPricesReport({ apiFetch }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [onlyCompared, setOnlyCompared] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await (await apiFetch('/api/reports/supplier-prices')).json();
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load supplier prices.');
    } catch { ui.alert('Network error.'); }
    finally { setLoading(false); }
  }, [apiFetch]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const term = q.trim().toLowerCase();
  const shown = (data?.items || []).filter(i => (!onlyCompared || i.supplierCount > 1)
    && (!term || i.itemName.toLowerCase().includes(term) || i.itemCode.toLowerCase().includes(term) || i.suppliers.some(s => s.supplier.toLowerCase().includes(term))));
  const exportXlsx = () => data && saveSheets('supplier-prices.xlsx', [
    ['Prices', [['Item', 'Code', 'Unit', 'Supplier', 'Last price', 'Last ordered', 'Lowest', 'Highest', 'Orders', 'Cheapest now?'],
      ...shown.flatMap(i => i.suppliers.map(s => [i.itemName, i.itemCode, i.unit, s.supplier, s.lastCost, s.lastAt ? String(s.lastAt).slice(0, 10) : '', s.lowest, s.highest, s.orders, s.supplier === i.cheapest ? 'Yes' : '']))]],
  ]);
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <p className="text-xs text-fg/65 max-w-xl">What each supplier last charged for each item, from the purchase orders already here: who is cheapest now, and how far apart they are. Items are matched by code, or by name where they have none.</p>
        <div className="flex items-end gap-2 flex-wrap">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Item, code or supplier" aria-label="Search supplier prices" className={input} />
          <label className="flex items-center gap-2 text-xs font-bold text-fg/80 pb-2"><input type="checkbox" checked={onlyCompared} onChange={e => setOnlyCompared(e.target.checked)} /> Only items with 2+ suppliers</label>
          <button type="button" onClick={load} disabled={loading} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          {shown.length > 0 && <button type="button" onClick={exportXlsx} className={btnGhost}><Download size={14} /> Excel</button>}
        </div>
      </div>
      {!data ? <Empty>{loading ? 'Loading…' : 'Refresh to load.'}</Empty> : shown.length === 0 ? (
        <Empty>{data.count === 0 ? 'No purchase orders with prices yet.' : onlyCompared && data.compared === 0 ? 'No item has been bought from more than one supplier yet. Untick the box to see every item.' : 'Nothing matches.'}</Empty>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left min-w-[620px]">
            <thead><tr><th className={th}>Item</th><th className={th}>Supplier</th><th className={`${th} text-right`}>Last price</th><th className={`${th} text-right`}>Range paid</th><th className={th}>Last ordered</th></tr></thead>
            <tbody>
              {shown.slice(0, 150).map(i => i.suppliers.map((s, n) => (
                <tr key={`${i.itemCode}-${i.itemName}-${s.supplier}`} className={n === 0 ? 'border-t border-white/10' : ''}>
                  {n === 0 && (
                    <td className={`${td} text-fg font-bold align-top`} rowSpan={i.suppliers.length}>
                      {i.itemName}{i.itemCode && <span className="block text-[10px] text-fg/65 font-normal">{i.itemCode}</span>}
                      {i.spread > 0 && <span className="block text-[10px] text-fg/70 font-bold mt-0.5">{i.spread}% between cheapest and dearest</span>}
                    </td>
                  )}
                  <td className={`${td} ${s.supplier === i.cheapest && i.supplierCount > 1 ? 'text-success font-bold' : 'text-fg/80'}`}>{s.supplier}{s.supplier === i.cheapest && i.supplierCount > 1 ? ' · cheapest' : ''}</td>
                  <td className={`${td} text-right font-mono text-fg`}>{peso(s.lastCost)}{i.unit && <span className="text-fg/65"> / {i.unit}</span>}</td>
                  <td className={`${td} text-right font-mono text-fg/80`}>{s.lowest === s.highest ? '-' : `${peso(s.lowest)} – ${peso(s.highest)}`}</td>
                  <td className={`${td} text-fg/80 whitespace-nowrap`}>{s.lastAt ? new Date(s.lastAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''} <span className="text-fg/65">({s.orders})</span></td>
                </tr>
              )))}
            </tbody>
          </table>
          {shown.length > 150 && <p className="text-[10px] text-fg/65 p-3">First 150 of {shown.length} items. Search to narrow it, or take the Excel file.</p>}
        </Card>
      )}
    </div>
  );
}

// ── SALES TARGETS ───────────────────────────────────────────────────────────
export function SalesTargetsReport({ apiFetch, can }) {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({ name: '', target: '' });
  const canSet = !!can?.('users.manage');
  const load = useCallback(async (m = month) => {
    setLoading(true);
    try {
      const d = await (await apiFetch(`/api/reports/sales-targets?month=${m}`)).json();
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load sales targets.');
    } catch { ui.alert('Network error.'); }
    finally { setLoading(false); }
  }, [apiFetch, month]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setTarget = async (name, target) => {
    try {
      const d = await (await apiFetch('/api/reports/sales-targets', { method: 'PUT', body: JSON.stringify({ name, target: Number(target) || 0 }) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not save the target.');
      ui.toast(d.target > 0 ? `Target for ${name} saved.` : `Target for ${name} removed.`, { tone: 'success' });
      setDraft({ name: '', target: '' });
      load();
    } catch { ui.alert('Network error.'); }
  };
  // Changing one puts it in the form below, where 0 removes it.
  const edit = (s) => setDraft({ name: s.name, target: String(s.target || '') });
  const hasTarget = (name) => (data?.sellers || []).some(s => s.name === name && s.target > 0);
  const draftOk = draft.name && draft.target !== '' && (Number(draft.target) > 0 || (Number(draft.target) === 0 && hasTarget(draft.name)));
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <p className="text-xs text-fg/65 max-w-xl">A monthly sales figure for each person who sells, and where they stand against it. A sale counts for its salesperson, or for whoever rang it up when it names none - the same rule as Commissions.</p>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Month
            <input type="month" value={month} max={todayStr().slice(0, 7)} onChange={e => { setMonth(e.target.value); if (e.target.value) load(e.target.value); }} className={`${input} block mt-1`} /></label>
          <button type="button" onClick={() => load()} disabled={loading} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        </div>
      </div>
      {!data ? <Empty>{loading ? 'Loading…' : 'Refresh to load.'}</Empty> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Sold" value={peso(data.totals.sales)} hint={data.month} />
            <Tile label="Targets" value={peso(data.totals.target)} hint={data.totals.target > 0 ? `${Math.round((data.totals.sales / data.totals.target) * 100)}% reached` : 'none set yet'} />
            <Tile label="Month gone" value={`${data.daysElapsed} of ${data.daysInMonth} days`} />
            <Tile label="On pace" value={`${data.sellers.filter(s => s.onPace).length} of ${data.sellers.filter(s => s.target > 0).length}`} hint="of those with a target" />
          </div>
          {data.sellers.length === 0 ? <Empty>No sales and no targets for {data.month}.</Empty> : (
            <Card className="overflow-x-auto">
              <table className="w-full text-left min-w-[640px]">
                <thead><tr><th className={th}>Seller</th><th className={`${th} text-right`}>Sold</th><th className={`${th} text-right`}>Target</th><th className={th}>Progress</th><th className={`${th} text-right`}>Still to sell</th><th className={th}></th></tr></thead>
                <tbody>
                  {data.sellers.map(s => (
                    <tr key={s.name} className="border-t border-white/5">
                      <td className={`${td} text-fg font-bold`}>{s.name}<span className="block text-[10px] text-fg/65 font-normal">{s.orders} order(s)</span></td>
                      <td className={`${td} text-right font-mono text-fg`}>{peso(s.sales)}</td>
                      <td className={`${td} text-right font-mono text-fg/80`}>{s.target > 0 ? peso(s.target) : '-'}</td>
                      <td className={`${td} w-48`}>
                        {s.target > 0 ? (<>
                          <Bar value={Math.min(s.sales, s.target)} max={s.target} />
                          <span className={`text-[10px] font-bold ${s.percent >= 100 ? 'text-success' : s.onPace ? 'text-fg/80' : 'text-danger'}`}>
                            {s.percent}%{s.percent >= 100 ? ' · reached' : s.onPace === false && data.daysElapsed > 0 ? ' · behind pace' : ''}
                          </span>
                        </>) : <span className="text-[10px] text-fg/65">no target</span>}
                      </td>
                      <td className={`${td} text-right font-mono text-fg/80`}>{s.remaining != null ? peso(s.remaining) : '-'}{s.perDayNeeded > 0 && <span className="block text-[10px] text-fg/65">{peso(s.perDayNeeded)} a day</span>}</td>
                      <td className={`${td} text-right`}>{canSet && <button type="button" onClick={() => edit(s)} className="text-[10px] font-bold uppercase tracking-wider text-brand-text hover:underline">{s.target > 0 ? 'Change' : 'Set target'}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {canSet && (
            <Card className="p-4">
              <p className="text-xs font-black uppercase tracking-wider text-fg mb-2">Set a monthly target <span className="text-fg/65 font-bold normal-case tracking-normal">· 0 removes one</span></p>
              <form onSubmit={e => { e.preventDefault(); if (draftOk) setTarget(draft.name, draft.target); }} className="flex items-end gap-2 flex-wrap">
                <select value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} aria-label="Seller" className={input}>
                  <option value="">Who?</option>
                  {[...data.sellers.map(s => s.name), ...data.others].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <input type="number" min="0" step="0.01" value={draft.target} onChange={e => setDraft(d => ({ ...d, target: e.target.value }))} placeholder="Monthly target" aria-label="Monthly target" className={input} />
                <button type="submit" disabled={!draftOk} className={btnBrand}>Save</button>
              </form>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── DELIVERY SHEET ──────────────────────────────────────────────────────────
export function DeliverySheetReport({ apiFetch }) {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (d = date) => {
    setLoading(true);
    try {
      const r = await (await apiFetch(`/api/reports/delivery-sheet?date=${d}`)).json();
      if (r.success) setData(r); else ui.alert(r.error || 'Could not load the delivery sheet.');
    } catch { ui.alert('Network error.'); }
    finally { setLoading(false); }
  }, [apiFetch, date]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // A plain page for the driver: one row a stop, a box to tick, room to sign.
  const print = () => {
    if (!data) return;
    const open = data.stops.filter(s => !s.done);
    const rows = open.map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.customer)}</b><br>${esc(s.address || 'NO ADDRESS - ask the office')}${s.note ? `<br><i>${esc(s.note)}</i>` : ''}</td><td>${esc(s.orderNumber)}<br>${esc(s.via)}</td><td>${s.items.map(esc).join('<br>')}</td><td class="r">${s.collect > 0 ? esc(peso(s.collect)) : '-'}</td><td class="box"></td></tr>`).join('');
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return ui.alert('Allow pop-ups for this site to print the sheet.');
    w.document.write(`<!doctype html><html><head><title>Delivery sheet ${esc(data.date)}</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#000}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:6px;vertical-align:top;text-align:left}th{background:#eee}
      .r{text-align:right;white-space:nowrap}.box{width:70px}.sign{margin-top:28px;display:flex;gap:40px}.sign div{flex:1;border-top:1px solid #000;padding-top:4px}
    </style></head><body><h1>Delivery sheet - ${esc(data.date)}</h1>
      <p>${open.length} stop(s) · ${data.totals.pieces} piece(s) · to collect ${esc(peso(data.totals.toCollect))}</p>
      <table><thead><tr><th>#</th><th>Deliver to</th><th>Order</th><th>Items</th><th>Collect</th><th>Received by</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="sign"><div>Driver</div><div>Released by</div><div>Cash turned over</div></div></body></html>`);
    w.document.close(); w.focus(); w.print();
  };
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <p className="text-xs text-fg/65 max-w-xl">The day's deliveries on one page for whoever takes them out: where each goes, what is in it, and what to collect at the door. Sorted by address so stops in the same area sit together. Earlier orders still not delivered are carried onto it.</p>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Day
            <input type="date" value={date} onChange={e => { setDate(e.target.value); if (e.target.value) load(e.target.value); }} className={`${input} block mt-1`} /></label>
          <button type="button" onClick={() => load()} disabled={loading} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          {data?.totals.toDeliver > 0 && <button type="button" onClick={print} className={btnGhost}><Download size={14} /> Print</button>}
        </div>
      </div>
      {!data ? <Empty>{loading ? 'Loading…' : 'Refresh to load.'}</Empty> : data.stops.length === 0 ? (
        <Empty>No deliveries for {data.date}.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="To deliver" value={data.totals.toDeliver} hint={`${data.totals.delivered} already delivered`} />
            <Tile label="Pieces" value={data.totals.pieces} />
            <Tile label="To collect at the door" value={peso(data.totals.toCollect)} hint="cash on delivery only" />
            <Tile label="No address" value={data.totals.noAddress} hint={data.totals.noAddress ? 'add it on the order before it goes out' : 'every stop has one'} />
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-left min-w-[720px]">
              <thead><tr><th className={th}>Deliver to</th><th className={th}>Order</th><th className={th}>Items</th><th className={`${th} text-right`}>Collect</th><th className={th}>Status</th></tr></thead>
              <tbody>
                {data.stops.map(s => (
                  <tr key={s.orderNumber} className={`border-t border-white/5 ${s.done ? 'opacity-60' : ''}`}>
                    <td className={`${td} text-fg`}><span className="font-bold">{s.customer || '(no name)'}</span>
                      <span className={`block ${s.address ? 'text-fg/80' : 'text-danger font-bold'}`}>{s.address || 'No address'}</span>
                      {s.note && <span className="block text-[10px] text-fg/65">{s.note}</span>}</td>
                    <td className={`${td} text-fg/80 whitespace-nowrap`}>{s.orderNumber}<span className="block text-[10px] text-fg/65">{s.via}{s.carriedOver ? ' · from an earlier day' : ''}</span></td>
                    <td className={`${td} text-fg/80`}>{s.items.slice(0, 6).map((it, i) => <span key={i} className="block">{it}</span>)}{s.items.length > 6 && <span className="block text-fg/65">+{s.items.length - 6} more</span>}</td>
                    <td className={`${td} text-right font-mono text-fg`}>{s.collect > 0 ? peso(s.collect) : '-'}</td>
                    <td className={`${td} text-fg/80 whitespace-nowrap`}>{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
