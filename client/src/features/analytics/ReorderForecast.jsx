import { useMemo, useState } from 'react';
import { Download, TrendingUp } from 'lucide-react';
import { usePagination } from '../../shared/usePagination';
import Pager from '../../shared/Pager';

// What to buy, and when: every stock item that sells, with how long it lasts at
// the pace it is selling, what is already on its way on open purchase orders,
// and how much more to order to be covered for the next two weeks or month.
// Logistics sells whole pieces: "sold per day", in whole numbers. A café uses
// grams and millilitres out of recipes, so there it stays "used per day".
const IS_LOG = String(import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase() === 'log';
const RATE_LABEL = IS_LOG ? 'Sold per day' : 'Used per day';

const STATUS = {
  out: ['Out of stock', 'bg-danger/15 text-danger'],
  now: ['Order now', 'bg-danger/15 text-danger'],
  soon: ['Order soon', 'bg-warning/15 text-warning'],
  ok: ['Enough', 'bg-green-900/30 text-success'],
};

export default function ReorderForecast({ rows = [], settings = {}, analyticsDisplay }) {
  const [onlyNeeded, setOnlyNeeded] = useState(true);
  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => (!onlyNeeded || r.status !== 'ok') && (!q || String(r.itemName || '').toLowerCase().includes(q) || String(r.itemCode || '').toLowerCase().includes(q)));
  }, [rows, onlyNeeded, search]);
  const page = usePagination(shown, 10);
  const needCount = rows.filter(r => r.status !== 'ok').length;

  // Quantities arrive in the stock's base unit; show them the way the rest of
  // the app shows that item (packs, kilos...).
  const q = (item, n) => { const d = analyticsDisplay(item); return `${(Number(n || 0) / d.mult).toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${d.unit}`; };
  // What to buy is a whole number of units - nobody orders 4.92 pieces. (Used
  // per day stays a fraction: an item that sells one every three days uses 0.33.)
  const buy = (item, n) => { const d = analyticsDisplay(item); const whole = Math.ceil(Number(n || 0) / d.mult - 1e-9); return whole > 0 ? `${whole.toLocaleString('en-PH')} ${d.unit}` : '-'; };
  // A piece-seller's pace as a whole number: 7 a day, or - for something that
  // moves less than one a day - one every so many days.
  const pace = (item) => {
    if (!IS_LOG) return q(item, item.dailyUse);
    const d = analyticsDisplay(item);
    const perDay = Number(item.dailyUse || 0) / d.mult;
    if (perDay >= 1) return `${Math.round(perDay).toLocaleString('en-PH')} ${d.unit}`;
    const every = Math.max(2, Math.round(1 / perDay));
    return `1 ${d.unit} every ${every} days`;
  };
  const onHand = (item) => {
    if (!IS_LOG) return q(item, item.stockQty);
    const d = analyticsDisplay(item);
    return `${Math.floor(Number(item.stockQty || 0) / d.mult + 1e-9).toLocaleString('en-PH')} ${d.unit}`;
  };
  const lasts = (r) => (r.daysLeft == null ? '-' : r.daysLeft <= 0 ? 'Out' : `${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`);

  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const head = ['Item', 'Code', 'Unit', 'On hand', RATE_LABEL, 'Lasts (days)', 'Runs out on', 'On order', 'Buy for 2 weeks', 'Buy for 1 month', 'Status'];
    const body = shown.map(r => { const d = analyticsDisplay(r); const n = (v) => +(Number(v || 0) / d.mult).toFixed(2); return [r.itemName, r.itemCode || '', d.unit, n(r.stockQty), n(r.dailyUse), r.daysLeft ?? '', r.runsOutOn || '', n(r.onOrder), Math.ceil(n(r.buy14) - 1e-9), Math.ceil(n(r.buy30) - 1e-9), STATUS[r.status]?.[0] || '']; });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body]), 'Reorder forecast');
    XLSX.writeFile(wb, `Reorder-forecast_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="bg-surface border border-accent/30 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3 border-b border-accent/20 pb-3">
        <div>
          <h3 className="text-brand-text text-sm font-bold uppercase tracking-wider flex items-center gap-2"><TrendingUp size={14} /> Reorder Forecast</h3>
          <p className="text-fg/70 text-xs mt-1">
            {rows.length === 0 ? 'Nothing to forecast yet.' : `${needCount} of ${rows.length} item(s) need ordering.`} Based on the last {settings.historyDays || 30} day(s) of sales, with the last week counting most. Allows {settings.leadTimeDays} days for delivery plus {settings.safetyDays} spare.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item" aria-label="Search item"
            className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-brand/60 w-36" />
          <label className="flex items-center gap-1.5 text-xs font-bold text-fg/80">
            <input type="checkbox" checked={onlyNeeded} onChange={e => setOnlyNeeded(e.target.checked)} /> Only what needs ordering
          </label>
          {shown.length > 0 && <button onClick={exportXlsx} className="flex items-center gap-1.5 bg-white/5 text-fg/80 hover:text-fg hover:bg-white/10 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> Excel</button>}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-fg/65 text-xs">No sales yet - the forecast appears once stock items start selling.</p>
      ) : shown.length === 0 ? (
        <p className="text-fg/65 text-xs">{onlyNeeded && !search ? 'Nothing needs ordering right now.' : 'No item matches.'}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[760px]">
              <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/10">
                <tr>
                  <th className="py-2 pr-2">Item</th><th className="py-2 px-2 text-right">On hand</th><th className="py-2 px-2 text-right">{RATE_LABEL}</th>
                  <th className="py-2 px-2">Lasts</th><th className="py-2 px-2 text-right">On order</th>
                  <th className="py-2 px-2 text-right">Buy for 2 weeks</th><th className="py-2 px-2 text-right">Buy for 1 month</th><th className="py-2 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {page.pageItems.map(r => (
                  <tr key={r._id} className="border-b border-white/5">
                    <td className="py-2 pr-2 font-bold text-fg max-w-[220px] truncate" title={r.itemName}>{r.itemName}
                      {r.trendPct != null && r.trendPct <= -99.5 && <span className="block text-[10px] font-normal text-fg/65">none sold in the last 7 days</span>}
                      {r.trendPct != null && r.trendPct > -99.5 && Math.abs(r.trendPct) >= 10 && <span className="block text-[10px] font-normal text-fg/65">selling {Math.abs(r.trendPct).toFixed(0)}% {r.trendPct > 0 ? 'faster' : 'slower'} this week</span>}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-fg/80">{onHand(r)}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-fg/80 whitespace-nowrap">{pace(r)}</td>
                    <td className="py-2 px-2 text-fg/80 whitespace-nowrap">{lasts(r)}{r.runsOutOn && r.daysLeft > 0 && <span className="block text-[10px] text-fg/65">until {r.runsOutOn}</span>}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-fg/80">{r.onOrder > 0 ? q(r, r.onOrder) : '-'}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-black text-fg">{buy(r, r.buy14)}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-black text-fg">{buy(r, r.buy30)}</td>
                    <td className="py-2 pl-2"><span className={`px-2 py-0.5 rounded text-[10px] font-black whitespace-nowrap ${STATUS[r.status]?.[1] || ''}`}>{STATUS[r.status]?.[0] || ''}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager {...page} label="items" />
        </>
      )}
    </div>
  );
}
