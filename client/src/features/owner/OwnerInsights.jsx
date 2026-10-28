import { useEffect, useState } from 'react';
import { formatPeso } from '../../shared/money.js';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// The owner insights under the overview: what changed against the period
// before (in sentences), which products earn and which do not, and where cash
// stands over the next 30/60/90 days. That last card is a summary of the one
// cash forecast (Reports -> Cash Forecast), never a second calculation.
const peso = formatPeso;
const TONE = { good: 'text-success', bad: 'text-danger', neutral: 'text-fg/80' };
const ICON = { good: TrendingUp, bad: TrendingDown, neutral: Minus };

function Card({ title, children }) {
  return (
    <div className="bg-surface border border-white/10 rounded-2xl p-5 flex flex-col">
      <h3 className="text-[11px] font-black uppercase tracking-widest text-fg/70 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function useInsight(apiFetch, path) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    setD(null);
    apiFetch(path).then(r => r.json())
      .then(r => { if (alive) setD(r.success ? r : { error: r.error || 'Could not load.' }); })
      .catch(() => { if (alive) setD({ error: 'Network error.' }); });
    return () => { alive = false; };
  }, [apiFetch, path]);
  return d;
}

const Status = ({ d }) => (!d ? <p className="text-fg/70 text-xs">Loading…</p> : <p className="text-danger text-xs font-bold">{d.error}</p>);

function ProductList({ title, rows }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-fg/60 mb-1">{title}</p>
      {rows.length === 0 ? <p className="text-fg/60 text-xs">None in this period.</p> : rows.map(r => (
        <div key={r.name} className="flex items-baseline justify-between gap-3 text-xs py-1 border-t border-white/5 first:border-0">
          <span className="text-fg/80 truncate">{r.name}</span>
          <span className="tabular-nums text-fg/70 whitespace-nowrap">
            {peso(r.profit)} · <span className={r.margin < 0 ? 'text-danger font-bold' : 'font-bold text-fg'}>{r.margin}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function OwnerInsights({ apiFetch, range }) {
  const q = `start=${range.start}&end=${range.end}`;
  const changed = useInsight(apiFetch, `/api/insights/what-changed?${q}`);
  const profit = useInsight(apiFetch, `/api/insights/product-profitability?${q}`);
  const cash = useInsight(apiFetch, '/api/reports/cash-forecast?days=91');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card title="What changed">
        {!changed || changed.error ? <Status d={changed} /> : (
          <>
            <p className="text-fg/65 text-[11px] mb-2">Against {changed.previous.start} to {changed.previous.end}.</p>
            {changed.insights.length === 0 ? <p className="text-fg/70 text-xs">Not enough sales in either period to compare.</p> : (
              <ul className="space-y-1.5">
                {changed.insights.map((i, n) => {
                  const Icon = ICON[i.tone];
                  return (
                    <li key={n} className="flex gap-2 text-xs">
                      <Icon size={14} className={`shrink-0 mt-0.5 ${TONE[i.tone]}`} aria-hidden />
                      <span className="text-fg/85">{i.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Card>

      <Card title="Product profitability">
        {!profit || profit.error ? <Status d={profit} /> : (
          <div className="space-y-3">
            <p className="text-fg/65 text-[11px]">
              {peso(profit.totals.profit)} gross profit on {peso(profit.totals.revenue)} sold ({profit.totals.margin}%), at today&apos;s ingredient costs.
            </p>
            <ProductList title="Best earners" rows={profit.best} />
            <ProductList title="Lowest margin" rows={profit.worst} />
            {profit.lossMakers.length > 0 && (
              <p className="text-[11px] text-danger font-bold">Sold below cost: {profit.lossMakers.map(i => i.name).join(', ')}.</p>
            )}
            {profit.uncosted.length > 0 && (
              <p className="text-[11px] text-warning">No recipe cost, so their margin is overstated: {profit.uncosted.slice(0, 8).join(', ')}{profit.uncosted.length > 8 ? '…' : ''}.</p>
            )}
          </div>
        )}
      </Card>

      <Card title="Cash outlook">
        {!cash || cash.error ? <Status d={cash} /> : (() => {
          // Weeks 4, 9 and 13 end nearest to 30, 60 and 90 days out.
          const at = (n) => cash.weeks[Math.min(n, cash.weeks.length) - 1];
          const rows = [[30, at(4)], [60, at(9)], [90, at(13)]].filter(([, w]) => w);
          return (
            <div className="space-y-2">
              <p className="text-fg/65 text-[11px]">From {peso(cash.cashNow)} today: what customers owe, bills and payroll as they fall due.</p>
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-fg/60 text-[10px] uppercase tracking-wider">
                    <th className="text-left font-bold py-1">By</th><th className="text-right font-bold">Cash after</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([d, w]) => (
                    <tr key={d} className="border-t border-white/5">
                      <td className="py-1 text-fg/80 font-bold">{d} days <span className="text-fg/50 font-normal">({w.to})</span></td>
                      <td className={`text-right font-bold ${w.balance < 0 ? 'text-danger' : 'text-fg'}`}>{peso(w.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cash.shortfall
                ? <p className="text-[11px] text-danger font-bold">Cash runs short in week {cash.lowest.week}, down to {peso(cash.lowest.balance)}.</p>
                : <p className="text-[11px] text-fg/65">Lowest point: {peso(cash.lowest.balance)}.</p>}
              {cash.payroll?.cadenceDays && <p className="text-[11px] text-fg/65">Includes payroll of about {peso(cash.payroll.averageNet)} every {cash.payroll.cadenceDays} days.</p>}
              {cash.awaitingApproval > 0 && <p className="text-[11px] text-warning">{peso(cash.awaitingApproval)} of it is bills still awaiting approval.</p>}
              <p className="text-[11px] text-fg/55">Week by week: Reports → Cash Forecast.</p>
            </div>
          );
        })()}
      </Card>
    </div>
  );
}
