import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ChevronRight } from 'lucide-react';
import RangePresets from '../../shared/RangePresets';
import { presetRange, matchPreset, RANGE_PRESETS } from '../../shared/businessDay.js';

// What a business owner opens the app to find out, on one page: how sales are
// going, whether the month is making money, where the cash is, who owes the
// business and who it owes, what the stock is worth, and what is waiting for a
// decision. Read-only - every figure links to the screen that explains it.
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Card({ title, onOpen, children }) {
  return (
    <div className="bg-surface border border-white/10 rounded-2xl p-5 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-fg/70">{title}</h3>
        {onOpen && (
          <button onClick={onOpen} className="flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-text hover:underline">
            Open <ChevronRight size={12} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
const Big = ({ value, tone = 'text-fg' }) => <p className={`text-2xl font-black tabular-nums ${tone}`}>{value}</p>;
const Line = ({ label, value, tone = 'text-fg/80' }) => (
  <div className="flex items-baseline justify-between gap-3 text-xs py-1 border-t border-white/5 first:border-0">
    <span className="text-fg/70">{label}</span><span className={`font-bold tabular-nums ${tone}`}>{value}</span>
  </div>
);

export default function OwnerOverview({ apiFetch, go, can }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  // The period sales and profit cover. Cash, debts and stock are always now.
  const [range, setRange] = useState(() => presetRange('thisMonth'));
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await (await apiFetch(`/api/owner/overview?start=${range.start}&end=${range.end}`)).json();
      setD(r.success ? r : { error: r.error || 'Could not load the overview.' });
    } catch { setD({ error: 'Network error.' }); }
    finally { setLoading(false); }
  }, [apiFetch, range.start, range.end]);
  useEffect(() => { load(); }, [load]);
  const periodName = (() => { const k = matchPreset(range); return k ? RANGE_PRESETS.find(p => p.key === k).label.toLowerCase() : `${range.start} to ${range.end}`; })();

  // A link only where the person can open the screen it goes to.
  const open = (tab, perm) => (!perm || can(perm) ? () => go(tab) : undefined);

  if (!d) return <p className="text-fg/70 text-sm font-bold p-8 text-center">Loading…</p>;
  if (d.error) return <p className="text-danger text-sm font-bold p-8 text-center">{d.error}</p>;
  const { sales, month, cash, receivables, payables, stock, waiting } = d;
  const change = sales.lastMonthToDate > 0 ? ((sales.monthToDate - sales.lastMonthToDate) / sales.lastMonthToDate) * 100 : null;
  const waitingTotal = Object.values(waiting).reduce((s, n) => s + (Number(n) || 0), 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-fg">Owner Overview</h2>
          <p className="text-fg/70 text-xs mt-1">Sales and profit for {periodName}. Cash, what is owed and stock as of {new Date(d.asOf).toLocaleString()}.</p>
        </div>
        <button onClick={load} disabled={loading} aria-label="Refresh"
          className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/80 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <RangePresets value={range} onChange={r => setRange(r)} />
        <input type="date" value={range.start} max={range.end} aria-label="From"
          onChange={e => e.target.value && setRange(r => ({ ...r, start: e.target.value }))}
          className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-2 text-fg text-xs font-bold outline-none focus:border-brand" />
        <span className="text-fg/70 text-xs font-bold">to</span>
        <input type="date" value={range.end} min={range.start} aria-label="To"
          onChange={e => e.target.value && setRange(r => ({ ...r, end: e.target.value }))}
          className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-2 text-fg text-xs font-bold outline-none focus:border-brand" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card title="Sales" onOpen={open('reports', 'reports.view')}>
          <Big value={peso(sales.monthToDate)} tone="text-brand-text" />
          <p className="text-fg/70 text-xs mb-2">{periodName}, from {sales.monthCount} order(s)</p>
          <Line label={`Before that (${d.period.previousStart} to ${d.period.previousEnd})`} value={peso(sales.lastMonthToDate)} />
          <Line label="Today" value={`${peso(sales.today)} · ${sales.todayCount}`} />
          {change !== null && <Line label="Change" value={`${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%`} tone={change >= 0 ? 'text-success' : 'text-danger'} />}
        </Card>

        <Card title="Profit" onOpen={open('ledger', 'accounting.view')}>
          <Big value={peso(month.netIncome)} tone={month.netIncome >= 0 ? 'text-success' : 'text-danger'} />
          <p className="text-fg/70 text-xs mb-2">income less everything spent, {periodName}</p>
          <Line label="Income" value={peso(month.income)} />
          <Line label="Cost of goods sold" value={peso(month.costOfSales)} />
          <Line label="Expenses" value={peso(month.expenses)} />
        </Card>

        <Card title="Cash and bank" onOpen={open('ledger', 'accounting.view')}>
          <Big value={peso(cash.total)} />
          <p className="text-fg/70 text-xs mb-2">across every cash, bank and e-wallet account</p>
          <Line label="Cash on hand" value={peso(cash.onHand)} />
          <Line label="In the bank" value={peso(cash.bank)} />
          <Line label="E-wallets" value={peso(cash.eWallet)} />
          <Line label="Petty cash / revolving funds" value={peso(cash.petty)} />
        </Card>

        <Card title="Customers owe you" onOpen={open('ledger', 'accounting.view')}>
          <Big value={peso(receivables.total)} />
          <p className="text-fg/70 text-xs mb-2">on {receivables.count} unpaid sale(s)</p>
          <Line label="Overdue" value={`${peso(receivables.overdue)} · ${receivables.overdueCount}`} tone={receivables.overdue > 0 ? 'text-danger' : 'text-fg/80'} />
        </Card>

        <Card title="You owe suppliers" onOpen={open('ledger', 'accounting.view')}>
          <Big value={peso(payables.total)} />
          <p className="text-fg/70 text-xs mb-2">on {payables.count} unpaid bill(s)</p>
          <Line label="Overdue" value={peso(payables.overdue)} tone={payables.overdue > 0 ? 'text-danger' : 'text-fg/80'} />
          <Line label="Due in the next 7 days" value={peso(payables.dueSoon)} tone={payables.dueSoon > 0 ? 'text-warning' : 'text-fg/80'} />
        </Card>

        <Card title="Stock" onOpen={open('inventory', 'inventory.view')}>
          <Big value={peso(stock.value)} />
          <p className="text-fg/70 text-xs mb-2">what is on the shelf, at cost</p>
          <Line label="Out of stock" value={`${stock.out} item(s)`} tone={stock.out > 0 ? 'text-danger' : 'text-fg/80'} />
          <Line label="Running low" value={`${stock.low} item(s)`} tone={stock.low > 0 ? 'text-warning' : 'text-fg/80'} />
        </Card>
      </div>

      <Card title={`Waiting for a decision (${waitingTotal})`} onOpen={open('approvals')}>
        {waitingTotal === 0 ? <p className="text-fg/70 text-xs">Nothing is waiting.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
            <Line label="Requisition slips to approve" value={waiting.requisitions} />
            <Line label="Revolving fund spends to check" value={waiting.fundSpends} />
            <Line label="Bills to approve" value={waiting.bills} />
            <Line label="Price, cost or credit changes to approve" value={waiting.changes} />
            <Line label="Purchase orders still to be delivered" value={waiting.openOrders} />
          </div>
        )}
      </Card>
    </div>
  );
}
