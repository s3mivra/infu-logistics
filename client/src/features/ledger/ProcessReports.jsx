import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Download, CheckCircle, Circle, AlertTriangle, Lock, Save } from 'lucide-react';
import * as ui from '../../shared/ui';

// The month-end and management pages from the process flow: the cash flow
// statement, sales by channel, budgets against actual, the exception report
// and the month-end closing checklist. Each one loads its own data.

const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const monthStart = () => { const d = new Date(); d.setDate(1); return ymd(d); };
// "Cash flows from operating activities" -> "Net cash from operating activities".
const netLabel = (title) => `Net cash from ${String(title).replace(/^cash flows? from /i, '').toLowerCase()}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const btn = 'flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition';
const btnBrand = `${btn} bg-brand text-on-brand hover:bg-brand/90 disabled:opacity-50`;
const btnGhost = `${btn} bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg`;
const input = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg';
const th = 'px-4 py-3';
const td = 'px-4 py-2.5';
const Card = ({ children, className = '' }) => <div className={`bg-surface border border-white/10 rounded-xl ${className}`}>{children}</div>;
const Empty = ({ children }) => <p className="text-fg/65 text-sm text-center p-6 font-bold">{children}</p>;

function useLoader(apiFetch, url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      const d = await (await apiFetch(url)).json();
      if (!d.success) { ui.alert(d.error || 'Could not load the report.'); setData(null); } else setData(d);
    } catch { ui.alert('Network error.'); }
    finally { setLoading(false); }
  }, [apiFetch, url]);
  return { data, setData, loading, load };
}

function RangeBar({ start, end, setStart, setEnd, onLoad, loading, extra }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-[10px] font-black uppercase tracking-wider text-fg/65">From<input type="date" value={start} onChange={e => setStart(e.target.value)} className={`${input} block mt-1`} /></label>
      <label className="text-[10px] font-black uppercase tracking-wider text-fg/65">To<input type="date" value={end} onChange={e => setEnd(e.target.value)} className={`${input} block mt-1`} /></label>
      <button type="button" onClick={onLoad} disabled={loading} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Run</button>
      {extra}
    </div>
  );
}

const exportSheet = async (name, rows) => {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  XLSX.writeFile(wb, `${name.replace(/\s+/g, '-')}.xlsx`);
};

// ── CASH FLOW STATEMENT (direct method) ─────────────────────────────────────
export function CashFlowReport({ apiFetch }) {
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(ymd(new Date()));
  const { data, loading, load } = useLoader(apiFetch, `/api/reports/cash-flow?start=${start}&end=${end}`);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const exportIt = () => exportSheet(`Cash Flow ${start} to ${end}`, [
    { Line: 'Cash at the start', Inflow: '', Outflow: '', Net: data.openingCash },
    ...data.sections.flatMap(s => [
      ...s.lines.map(l => ({ Line: `${s.title} - ${l.label}`, Inflow: l.inflow, Outflow: l.outflow, Net: l.net })),
      { Line: netLabel(s.title), Inflow: '', Outflow: '', Net: s.net },
    ]),
    { Line: 'Net change in cash', Inflow: '', Outflow: '', Net: data.netChange },
    { Line: 'Cash at the end', Inflow: '', Outflow: '', Net: data.closingCash },
  ]);
  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-xs text-fg/65">Where the cash came from and where it went, straight from the entries that touched cash and bank accounts, grouped into operating, investing and financing.</p>
      <RangeBar {...{ start, end, setStart, setEnd, loading }} onLoad={load} extra={data && <button type="button" onClick={exportIt} className={btnGhost}><Download size={14} /> Excel</button>} />
      {!data ? <Empty>{loading ? 'Loading…' : 'Run the report.'}</Empty> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[520px]">
            <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
              <tr><th className={th}>Activity</th><th className={`${th} text-right`}>In</th><th className={`${th} text-right`}>Out</th><th className={`${th} text-right`}>Net</th></tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/5"><td className={`${td} font-bold text-fg`}>Cash at the start</td><td /><td /><td className={`${td} text-right font-mono font-bold`}>{peso(data.openingCash)}</td></tr>
              {data.sections.map(s => (
                <React.Fragment key={s.key}>
                  <tr className="bg-white/[0.03]"><td colSpan={4} className={`${td} font-black text-fg uppercase text-[10px] tracking-wider`}>{s.title}</td></tr>
                  {s.lines.length === 0 && <tr><td colSpan={4} className={`${td} text-fg/60 italic`}>None in this period.</td></tr>}
                  {s.lines.map(l => (
                    <tr key={l.label} className="border-b border-white/5">
                      <td className={`${td} pl-8 text-fg/80`}>{l.label}</td>
                      <td className={`${td} text-right font-mono text-success`}>{l.inflow ? peso(l.inflow) : ''}</td>
                      <td className={`${td} text-right font-mono text-danger`}>{l.outflow ? peso(l.outflow) : ''}</td>
                      <td className={`${td} text-right font-mono`}>{peso(l.net)}</td>
                    </tr>
                  ))}
                  <tr className="border-b border-white/10"><td colSpan={3} className={`${td} text-right text-fg/70 font-bold`}>{netLabel(s.title)}</td><td className={`${td} text-right font-mono font-black`}>{peso(s.net)}</td></tr>
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3} className={`${td} text-right font-bold text-fg/75`}>Net change in cash</td><td className={`${td} text-right font-mono font-black`}>{peso(data.netChange)}</td></tr>
              <tr className="border-t border-white/10"><td colSpan={3} className={`${td} text-right font-black text-fg`}>Cash at the end</td><td className={`${td} text-right font-mono font-black text-fg`}>{peso(data.closingCash)}</td></tr>
            </tfoot>
          </table>
          <p className={`text-[11px] p-3 text-center font-bold ${data.ties ? 'text-success' : 'text-danger'}`}>
            {data.ties ? `Ties to the ledger: cash and bank accounts show ${peso(data.ledgerClosingCash)} at the end of the period.` : `Does not tie: the ledger shows ${peso(data.ledgerClosingCash)} in cash and bank. Check Books Health.`}
          </p>
        </Card>
      )}
    </div>
  );
}

// ── SALES BY CHANNEL ────────────────────────────────────────────────────────
export function SalesByChannelReport({ apiFetch }) {
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(ymd(new Date()));
  const { data, loading, load } = useLoader(apiFetch, `/api/reports/sales-by-channel?start=${start}&end=${end}`);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const exportIt = () => exportSheet(`Sales by Channel ${start} to ${end}`, data.channels.flatMap(c => [
    { Channel: c.channel, Product: '(all)', Orders: c.orders, Units: c.units, Gross: c.gross, Discount: c.discount, Net: c.net, 'Share %': c.share },
    ...c.topProducts.map(p => ({ Channel: c.channel, Product: p.name, Orders: '', Units: p.qty, Gross: p.sales, Discount: '', Net: '', 'Share %': '' })),
  ]));
  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-xs text-fg/65">Completed sales split into wholesale and retail. A sale is wholesale when the buyer's account is in a wholesale segment, or when the cashier marked it so.</p>
      <RangeBar {...{ start, end, setStart, setEnd, loading }} onLoad={load} extra={data && <button type="button" onClick={exportIt} className={btnGhost}><Download size={14} /> Excel</button>} />
      {!data ? <Empty>{loading ? 'Loading…' : 'Run the report.'}</Empty> : (
        <div className="grid md:grid-cols-2 gap-4">
          {data.channels.map(c => (
            <Card key={c.channel} className="p-4">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-sm font-black text-fg">{c.channel}</h3>
                <span className="text-xs text-fg/70 font-bold">{c.share}% of net sales</span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs mb-3">
                <dt className="text-fg/65">Orders</dt><dd className="text-right font-bold tabular-nums">{c.orders}</dd>
                <dt className="text-fg/65">Units</dt><dd className="text-right font-bold tabular-nums">{c.units}</dd>
                <dt className="text-fg/65">Gross</dt><dd className="text-right font-mono">{peso(c.gross)}</dd>
                <dt className="text-fg/65">Discounts</dt><dd className="text-right font-mono text-danger">{peso(c.discount)}</dd>
                <dt className="text-fg font-bold">Net</dt><dd className="text-right font-mono font-black">{peso(c.net)}</dd>
              </dl>
              {c.topProducts.length > 0 && (
                <>
                  <p className="text-[10px] font-black uppercase tracking-wider text-fg/65 mb-1">Top products</p>
                  <ul className="text-xs space-y-1">
                    {c.topProducts.map(p => <li key={p.name} className="flex justify-between gap-2"><span className="truncate text-fg/80">{p.name} × {p.qty}</span><span className="font-mono">{peso(p.sales)}</span></li>)}
                  </ul>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SALES BY CUSTOMER ───────────────────────────────────────────────────────
export function SalesByCustomerReport({ apiFetch }) {
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(ymd(new Date()));
  const { data, loading, load } = useLoader(apiFetch, `/api/reports/sales-by-customer?start=${start}&end=${end}`);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const exportIt = () => exportSheet(`Sales by Customer ${start} to ${end}`, data.customers.map(c => ({
    'Customer No.': c.customerNumber, Customer: c.customer, Orders: c.orders, Units: c.units,
    Gross: c.gross, Discount: c.discount, Net: c.net, 'Share %': c.share, 'Last sale': c.lastSale ? ymd(c.lastSale) : '',
  })));
  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-xs text-fg/65">Completed sales totalled per customer, largest first. Sales without a client account are grouped by the name on the order.</p>
      <RangeBar {...{ start, end, setStart, setEnd, loading }} onLoad={load} extra={data?.customers?.length > 0 && <button type="button" onClick={exportIt} className={btnGhost}><Download size={14} /> Excel</button>} />
      {!data ? <Empty>{loading ? 'Loading…' : 'Run the report.'}</Empty> : data.customers.length === 0 ? <Empty>No completed sales in these dates.</Empty> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[640px]">
            <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
              <tr><th className={th}>Customer</th><th className={`${th} text-right`}>Orders</th><th className={`${th} text-right`}>Units</th><th className={`${th} text-right`}>Gross</th><th className={`${th} text-right`}>Discount</th><th className={`${th} text-right`}>Net</th><th className={`${th} text-right`}>Share</th><th className={th}>Last sale</th></tr>
            </thead>
            <tbody>
              {data.customers.map(c => (
                <tr key={c.customerId || c.customer} className="border-b border-white/5">
                  <td className={td}>{c.customerNumber && <span className="font-mono text-fg/70 mr-1">{c.customerNumber}</span>}<span className="font-bold text-fg">{c.customer}</span></td>
                  <td className={`${td} text-right tabular-nums`}>{c.orders}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.units}</td>
                  <td className={`${td} text-right font-mono`}>{peso(c.gross)}</td>
                  <td className={`${td} text-right font-mono text-danger`}>{peso(c.discount)}</td>
                  <td className={`${td} text-right font-mono font-black`}>{peso(c.net)}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.share}%</td>
                  <td className={`${td} text-fg/70`}>{c.lastSale ? ymd(c.lastSale) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="font-black"><td className={td}>Total</td><td className={`${td} text-right tabular-nums`}>{data.orders}</td><td className={td} colSpan={3} /><td className={`${td} text-right font-mono`}>{peso(data.totalNet)}</td><td className={td} colSpan={2} /></tr></tfoot>
          </table>
        </Card>
      )}
    </div>
  );
}

// ── BUDGET vs ACTUAL, and setting the budget ────────────────────────────────
export function BudgetReport({ apiFetch, can }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth, setToMonth] = useState(now.getMonth() + 1);
  const { data, loading, load } = useLoader(apiFetch, `/api/reports/budget-vs-actual?year=${year}&fromMonth=${fromMonth}&toMonth=${toMonth}`);
  const [editing, setEditing] = useState(false);
  const canSet = can('accounting.manage');
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-xs text-fg/65">Each account's budget beside what the ledger shows. Spending over its budget is red; a requisition that would go over is held for an approver.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[10px] font-black uppercase tracking-wider text-fg/65">Year<input type="number" value={year} onChange={e => setYear(Number(e.target.value) || now.getFullYear())} className={`${input} block mt-1 w-24`} /></label>
        <label className="text-[10px] font-black uppercase tracking-wider text-fg/65">From
          <select value={fromMonth} onChange={e => setFromMonth(Number(e.target.value))} className={`${input} block mt-1`}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </label>
        <label className="text-[10px] font-black uppercase tracking-wider text-fg/65">To
          <select value={toMonth} onChange={e => setToMonth(Number(e.target.value))} className={`${input} block mt-1`}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </label>
        <button type="button" onClick={load} disabled={loading} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Run</button>
        {canSet && <button type="button" onClick={() => setEditing(e => !e)} className={btnGhost}>{editing ? 'Close budget entry' : 'Set budget'}</button>}
        {data?.rows?.length > 0 && <button type="button" className={btnGhost} onClick={() => exportSheet(`Budget vs Actual ${year}`, data.rows.map(r => ({ Account: r.accountCode, Name: r.accountName, Type: r.type, Budget: r.budget, Actual: r.actual, Variance: r.variance, 'Used %': r.usedPct ?? '' })))}><Download size={14} /> Excel</button>}
      </div>
      {editing && <BudgetEntry apiFetch={apiFetch} year={year} onSaved={load} />}
      {!data ? <Empty>{loading ? 'Loading…' : 'Run the report.'}</Empty> : data.rows.length === 0 ? <Empty>No budget set for {year}{canSet ? ' - use Set budget.' : '.'}</Empty> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[640px]">
            <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
              <tr><th className={th}>Account</th><th className={`${th} text-right`}>Budget</th><th className={`${th} text-right`}>Actual</th><th className={`${th} text-right`}>Variance</th><th className={`${th} text-right`}>Used</th></tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.accountCode} className="border-b border-white/5">
                  <td className={td}><span className="font-mono text-fg/70">{r.accountCode}</span> <span className="font-bold text-fg">{r.accountName}</span> <span className="text-[10px] text-fg/60">{r.type}</span></td>
                  <td className={`${td} text-right font-mono`}>{peso(r.budget)}</td>
                  <td className={`${td} text-right font-mono`}>{peso(r.actual)}</td>
                  <td className={`${td} text-right font-mono font-bold ${r.favourable ? 'text-success' : 'text-danger'}`}>{r.variance >= 0 ? '+' : ''}{peso(r.variance)}</td>
                  <td className={`${td} text-right tabular-nums ${r.over ? 'text-danger font-black' : 'text-fg/75'}`}>{r.usedPct == null ? '-' : `${r.usedPct}%`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-white/10 text-fg/80">
              <tr><td className={`${td} font-bold`}>Revenue</td><td className={`${td} text-right font-mono`}>{peso(data.totals.revenueBudget)}</td><td className={`${td} text-right font-mono`}>{peso(data.totals.revenueActual)}</td><td colSpan={2} /></tr>
              <tr><td className={`${td} font-bold`}>Expenses</td><td className={`${td} text-right font-mono`}>{peso(data.totals.expenseBudget)}</td><td className={`${td} text-right font-mono`}>{peso(data.totals.expenseActual)}</td><td colSpan={2} className={`${td} text-right text-danger font-bold`}>{data.totals.overBudget ? `${data.totals.overBudget} over budget` : ''}</td></tr>
            </tfoot>
          </table>
        </Card>
      )}
    </div>
  );
}

// A grid of accounts × months. Blank cells clear a month's figure.
function BudgetEntry({ apiFetch, year, onSaved }) {
  const [accounts, setAccounts] = useState([]);
  const [grid, setGrid] = useState({});      // { [code]: { [month]: '123' } }
  const [dirty, setDirty] = useState({});    // `${code}|${month}` -> true
  const [picked, setPicked] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [coa, b] = await Promise.all([
          apiFetch('/api/coa').then(r => r.json()),
          apiFetch(`/api/budgets?year=${year}`).then(r => r.json()),
        ]);
        setAccounts((coa.accounts || []).filter(a => !a.isParent && ['revenue', 'expense', 'cogs'].includes(a.type) && a.isActive !== false));
        const g = {};
        for (const r of b.rows || []) (g[r.accountCode] ||= {})[r.month] = String(r.amount);
        setGrid(g); setDirty({});
      } catch { ui.alert('Could not load the budget.'); }
    })();
  }, [apiFetch, year]);

  const shown = useMemo(() => accounts.filter(a => grid[a.code]), [accounts, grid]);
  const set = (code, month, v) => {
    setGrid(g => ({ ...g, [code]: { ...(g[code] || {}), [month]: v } }));
    setDirty(d => ({ ...d, [`${code}|${month}`]: true }));
  };
  const fillRow = (code) => {
    const v = prompt('Amount for every month of this account:');
    if (v == null) return;
    for (let m = 1; m <= 12; m++) set(code, m, v.trim());
  };
  const save = async () => {
    const rows = Object.keys(dirty).map(k => { const [accountCode, m] = k.split('|'); const v = grid[accountCode]?.[m]; return { accountCode, month: Number(m), amount: v === '' || v == null ? null : Number(v) }; });
    if (!rows.length) return ui.toast('Nothing changed.');
    setSaving(true);
    try {
      const d = await (await apiFetch('/api/budgets', { method: 'PUT', body: JSON.stringify({ year, rows }) })).json();
      if (!d.success) return ui.alert([d.error, ...(d.problems || [])].join('\n'));
      ui.toast(`Budget saved (${d.saved} figure(s)).`, { tone: 'success' });
      setDirty({}); onSaved?.();
    } catch { ui.alert('Network error.'); }
    finally { setSaving(false); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[10px] font-black uppercase tracking-wider text-fg/65 flex-1 min-w-[220px]">Add an account
          <select value={picked} onChange={e => setPicked(e.target.value)} className={`${input} block mt-1 w-full`}>
            <option value="">Choose…</option>
            {accounts.filter(a => !grid[a.code]).map(a => <option key={a.code} value={a.code}>{a.code} {a.name} ({a.type})</option>)}
          </select>
        </label>
        <button type="button" disabled={!picked} onClick={() => { setGrid(g => ({ ...g, [picked]: {} })); setPicked(''); }} className={btnGhost}>Add</button>
        <button type="button" disabled={saving} onClick={save} className={btnBrand}><Save size={14} /> Save {year} budget</button>
      </div>
      {shown.length === 0 ? <p className="text-xs text-fg/65">No accounts budgeted for {year} yet. Add one above.</p> : (
        <div className="overflow-x-auto">
          <table className="text-xs min-w-[900px] w-full">
            <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider"><tr><th className="text-left px-2 py-2">Account</th>{MONTHS.map(m => <th key={m} className="px-1 py-2">{m}</th>)}<th /></tr></thead>
            <tbody>
              {shown.map(a => (
                <tr key={a.code} className="border-t border-white/5">
                  <td className="px-2 py-1.5 whitespace-nowrap"><span className="font-mono text-fg/70">{a.code}</span> <span className="font-bold text-fg">{a.name}</span></td>
                  {MONTHS.map((m, i) => (
                    <td key={m} className="px-1 py-1"><input aria-label={`${a.name} ${m}`} inputMode="decimal" value={grid[a.code]?.[i + 1] ?? ''} onChange={e => set(a.code, i + 1, e.target.value)} className="w-20 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-right font-mono text-fg" /></td>
                  ))}
                  <td className="px-1"><button type="button" onClick={() => fillRow(a.code)} className="text-[10px] font-bold text-brand whitespace-nowrap">Fill all</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── EXCEPTION REPORT ────────────────────────────────────────────────────────
const COLS = {
  overdueAr: [['orderNumber', 'Order'], ['customerName', 'Customer'], ['daysOverdue', 'Days late'], ['balance', 'Balance', 'money']],
  overdueAp: [['billNumber', 'Bill'], ['supplierName', 'Supplier'], ['daysOverdue', 'Days late'], ['balance', 'Balance', 'money']],
  overLimit: [['clientCode', 'Client'], ['name', 'Name'], ['limit', 'Limit', 'money'], ['owed', 'Owed', 'money'], ['over', 'Over by', 'money']],
  creditOverrides: [['orderNumber', 'Order'], ['customerName', 'Customer'], ['total', 'Amount', 'money'], ['approvedBy', 'Released by']],
  stockVariance: [['date', 'Date', 'date'], ['itemName', 'Item'], ['system', 'System'], ['counted', 'Counted'], ['variance', 'Variance']],
  cashVariance: [['date', 'Date', 'date'], ['cashierName', 'Cashier'], ['expected', 'Expected', 'money'], ['counted', 'Counted', 'money'], ['variance', 'Variance', 'money']],
  billsUnmatched: [['billNumber', 'Bill'], ['supplierName', 'Supplier'], ['amount', 'Amount', 'money'], ['status', 'Match'], ['issues', 'Why']],
  journalsWaiting: [['draftNumber', 'Draft'], ['description', 'Description'], ['amount', 'Amount', 'money'], ['preparedBy', 'Prepared by']],
  unassigned: [['account', 'Account'], ['balance', 'Balance', 'money']],
};
const cell = (v, kind) => (kind === 'money' ? peso(v) : kind === 'date' ? (v ? new Date(v).toLocaleDateString('en-PH') : '') : String(v ?? ''));

export function ExceptionsReport({ apiFetch }) {
  const { data, loading, load } = useLoader(apiFetch, '/api/reports/exceptions');
  const [open, setOpen] = useState({});
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <p className="text-xs text-fg/65">Everything that needs a person, on one page: overdue accounts, credit-limit breaches, stock and cash variances, and documents still waiting on a match or an approval.</p>
        <button type="button" onClick={load} disabled={loading} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>
      {!data ? <Empty>{loading ? 'Loading…' : 'Refresh to load.'}</Empty> : (
        <>
          <p className={`text-sm font-black ${data.attention ? 'text-amber-400' : 'text-success'}`}>{data.attention ? `${data.attention} item(s) need attention.` : 'Nothing needs attention.'}</p>
          <div className="space-y-3">
            {data.sections.map(s => (
              <Card key={s.key}>
                <button type="button" onClick={() => setOpen(o => ({ ...o, [s.key]: !o[s.key] }))} disabled={!s.count} className="w-full flex items-center justify-between gap-3 p-4 text-left">
                  <span className="flex items-center gap-2 min-w-0">
                    {s.count ? <AlertTriangle size={14} className="text-amber-400 shrink-0" /> : <CheckCircle size={14} className="text-success shrink-0" />}
                    <span className="font-bold text-sm text-fg">{s.title}</span>
                  </span>
                  <span className="text-xs text-fg/70 shrink-0 tabular-nums">{s.count}{s.total != null && s.count ? ` · ${peso(s.total)}` : ''}</span>
                </button>
                {open[s.key] && s.count > 0 && (
                  <div className="border-t border-white/5 overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[520px]">
                      <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider"><tr>{(COLS[s.key] || []).map(([k, l, kind]) => <th key={k} className={`${th} ${kind === 'money' ? 'text-right' : ''}`}>{l}</th>)}</tr></thead>
                      <tbody>
                        {s.rows.map((r, i) => (
                          <tr key={i} className="border-t border-white/5">
                            {(COLS[s.key] || []).map(([k, , kind]) => <td key={k} className={`${td} ${kind === 'money' ? 'text-right font-mono' : 'text-fg/80'}`}>{cell(r[k], kind)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[10px] text-fg/65 p-3">{s.count > s.rows.length ? `First ${s.rows.length} of ${s.count}. ` : ''}Fix in: {s.where}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── MONTH-END CLOSE ─────────────────────────────────────────────────────────
export function ClosingChecklist({ apiFetch, can }) {
  const prev = new Date(); prev.setDate(0); // the month that just ended
  const [year, setYear] = useState(prev.getFullYear());
  const [month, setMonth] = useState(prev.getMonth() + 1);
  const { data, setData, loading, load } = useLoader(apiFetch, `/api/periods/checklist?year=${year}&month=${month}`);
  const [busy, setBusy] = useState(false);
  const canPost = can('accounting.manage');
  useEffect(() => { load(); }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const tick = async (item) => {
    setBusy(true);
    try {
      const d = await (await apiFetch('/api/periods/checklist/tick', { method: 'POST', body: JSON.stringify({ year, month, key: item.key, done: item.status !== 'done' }) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not save.');
      setData(d);
    } catch { ui.alert('Network error.'); }
    finally { setBusy(false); }
  };
  const close = async () => {
    const open = data.items.filter(i => i.status !== 'done' && !i.blocking).length;
    if (!(await ui.confirm(`Close ${MONTHS[month - 1]} ${year}? Nothing can be posted into it afterwards unless an approver reopens it.${open ? `\n\n${open} step(s) are still open - they do not stop the close, but check them first.` : ''}`))) return;
    setBusy(true);
    try {
      const d = await (await apiFetch('/api/periods/close', { method: 'POST', body: JSON.stringify({ year, month }) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not close the month.');
      ui.toast(`${MONTHS[month - 1]} ${year} is closed.`, { tone: 'success' });
      load();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(false); }
  };

  const done = data ? data.items.filter(i => i.status === 'done').length : 0;
  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-xs text-fg/65">The steps before a month is closed. Most are checked against the records; the review steps are ticked by a person and keep their name. Unapproved journal entries and an unbalanced trial balance stop the close.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[10px] font-black uppercase tracking-wider text-fg/65">Month
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={`${input} block mt-1`}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </label>
        <label className="text-[10px] font-black uppercase tracking-wider text-fg/65">Year<input type="number" value={year} onChange={e => setYear(Number(e.target.value) || prev.getFullYear())} className={`${input} block mt-1 w-24`} /></label>
        <button type="button" onClick={load} disabled={loading} className={btnGhost}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Recheck</button>
      </div>
      {!data ? <Empty>{loading ? 'Checking…' : 'Choose a month.'}</Empty> : (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-black text-fg">{MONTHS[month - 1]} {year} · {done} of {data.items.length} done</p>
            {data.closed
              ? <span className="flex items-center gap-1.5 text-xs font-bold text-success"><Lock size={13} /> Closed{data.closedBy ? ` by ${data.closedBy}` : ''}</span>
              : canPost && <button type="button" disabled={busy || data.blocking.length > 0} onClick={close} className={btnBrand} title={data.blocking.length ? `First: ${data.blocking.join('; ')}` : ''}><Lock size={14} /> Close the month</button>}
          </div>
          {!data.closed && data.blocking.length > 0 && <p className="text-xs text-danger font-bold">Cannot close yet - first: {data.blocking.join('; ')}.</p>}
          <ul className="divide-y divide-white/5">
            {data.items.map(i => (
              <li key={i.key} className="flex items-start gap-3 py-2.5">
                {i.manual && canPost && !data.closed ? (
                  <button type="button" disabled={busy} onClick={() => tick(i)} aria-label={`${i.status === 'done' ? 'Untick' : 'Tick'} ${i.label}`} className="mt-0.5 shrink-0">
                    {i.status === 'done' ? <CheckCircle size={16} className="text-success" /> : <Circle size={16} className="text-fg/50" />}
                  </button>
                ) : i.status === 'done' ? <CheckCircle size={16} className="text-success mt-0.5 shrink-0" /> : <AlertTriangle size={16} className={`${i.blocking ? 'text-danger' : 'text-amber-400'} mt-0.5 shrink-0`} />}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-fg">{i.label}{i.blocking && i.status !== 'done' ? <span className="ml-2 text-[10px] text-danger uppercase">blocks close</span> : null}{i.manual ? <span className="ml-2 text-[10px] text-fg/60 uppercase">tick when done</span> : null}</p>
                  <p className="text-xs text-fg/70">{i.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
