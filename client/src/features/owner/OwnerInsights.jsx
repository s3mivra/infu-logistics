import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// The owner insights under the overview: what changed against the period
// before (in sentences), which products earn and which do not, and the cash
// outlook for the next 30/60/90 days. Read-only, from /api/insights/*.
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const cash = useInsight(apiFetch, '/api/insights/cash-outlook');

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
        {!cash || cash.error ? <Status d={cash} /> : (
          <div className="space-y-2">
            <p className="text-fg/65 text-[11px]">From {peso(cash.cashNow)} today: expected collections, approved bills and payroll.</p>
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-fg/60 text-[10px] uppercase tracking-wider">
                  <th className="text-left font-bold py-1">Days</th><th className="text-right font-bold">In</th>
                  <th className="text-right font-bold">Out</th><th className="text-right font-bold">Cash after</th>
                </tr>
              </thead>
              <tbody>
                {cash.horizons.map(h => (
                  <tr key={h.days} className="border-t border-white/5">
                    <td className="py-1 text-fg/80 font-bold">{h.days}</td>
                    <td className="text-right text-success">{peso(h.in)}</td>
                    <td className="text-right text-fg/80" title={`Bills ${peso(h.out.bills)} · Payroll ${peso(h.out.payroll)}`}>{peso(h.out.total)}</td>
                    <td className={`text-right font-bold ${h.endingBalance < 0 ? 'text-danger' : 'text-fg'}`}>{peso(h.endingBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cash.shortfall
              ? <p className="text-[11px] text-danger font-bold">Cash runs short around {cash.lowest.date}, down to {peso(cash.lowest.balance)}.</p>
              : <p className="text-[11px] text-fg/65">Lowest point: {peso(cash.lowest.balance)} on {cash.lowest.date}.</p>}
            {cash.payroll.cadenceDays && <p className="text-[11px] text-fg/65">Payroll of about {peso(cash.payroll.averageNet)} every {cash.payroll.cadenceDays} days.</p>}
            {cash.receivables.notExpected > 0 && <p className="text-[11px] text-fg/65">{peso(cash.receivables.notExpected)} of old receivables is not counted on.</p>}
            {cash.awaitingApproval > 0 && <p className="text-[11px] text-warning">{peso(cash.awaitingApproval)} in bills awaiting approval is left out.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
