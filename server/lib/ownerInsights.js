// Pure helpers behind the owner insights (server/features/owner-insights.js):
// the plain-language "what changed" lines, the product profitability ranking,
// and the 30/60/90-day cash outlook. No DB - the routes feed them rows.
import { roundMoney } from './money.js';
import { bucketFor } from './credit.js';

const DAY = 86400000;
const pct1 = (n) => Math.round(n * 10) / 10;

/** Percent change from `prev` to `cur`; null when there is nothing to compare against. */
export function pctChange(cur, prev) {
  const c = Number(cur) || 0, p = Number(prev) || 0;
  if (Math.abs(p) < 0.005) return null;
  return pct1(((c - p) / Math.abs(p)) * 100);
}

export const fmtMoney = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dir = (n) => (n > 0 ? 'up' : 'down');

/**
 * Sales, margin and cost lines for two periods -> sentences an owner can read.
 * `cur`/`prev` are { revenue, cogs, orders }; `costMovers` are
 * { itemName, changePct } sorted by size of change; `productMovers` are
 * { name, revenue, prevRevenue, change } sorted by size of change.
 * Each insight is { kind, tone: 'good'|'bad'|'neutral', text }.
 */
export function explainChanges({ cur, prev, costMovers = [], productMovers = [] }) {
  const out = [];
  const salesPct = pctChange(cur.revenue, prev.revenue);
  if (salesPct === null) {
    if (cur.revenue > 0) out.push({ kind: 'sales', tone: 'neutral', text: `Sales were ${fmtMoney(cur.revenue)}, with nothing in the previous period to compare against.` });
  } else if (Math.abs(salesPct) >= 1) {
    out.push({ kind: 'sales', tone: salesPct > 0 ? 'good' : 'bad', text: `Sales ${dir(salesPct)} ${Math.abs(salesPct)}% (${fmtMoney(cur.revenue)} vs ${fmtMoney(prev.revenue)}).` });
  } else {
    out.push({ kind: 'sales', tone: 'neutral', text: `Sales were flat at ${fmtMoney(cur.revenue)}.` });
  }

  const m = marginOf(cur), pm = marginOf(prev);
  const risers = costMovers.filter(c => c.changePct > 0);
  const fallers = costMovers.filter(c => c.changePct < 0);
  if (m !== null && pm !== null) {
    const pts = pct1(m - pm);
    if (Math.abs(pts) >= 0.5) {
      // Name the cost move most likely behind it: a rise when margin fell, a drop when it rose.
      const cause = pts < 0 ? risers[0] : fallers[0];
      const why = cause ? ` — ${cause.itemName} cost ${dir(cause.changePct)} ${Math.abs(cause.changePct)}%` : '';
      out.push({ kind: 'margin', tone: pts > 0 ? 'good' : 'bad', text: `Gross margin ${dir(pts)} ${Math.abs(pts)} pts to ${m}%${why}.` });
    } else {
      out.push({ kind: 'margin', tone: 'neutral', text: `Gross margin held at ${m}%.` });
    }
  }

  const named = new Set();
  for (const c of risers.slice(0, 3)) {
    if (Math.abs(c.changePct) < 5) continue;
    named.add(c.itemName);
    out.push({ kind: 'cost', tone: 'bad', text: `${c.itemName} now costs ${Math.abs(c.changePct)}% more to buy.` });
  }
  for (const c of fallers.slice(0, 2)) {
    if (Math.abs(c.changePct) < 5 || named.has(c.itemName)) continue;
    out.push({ kind: 'cost', tone: 'good', text: `${c.itemName} now costs ${Math.abs(c.changePct)}% less to buy.` });
  }

  const ticket = (p) => (p.orders > 0 ? p.revenue / p.orders : 0);
  const ordersPct = pctChange(cur.orders, prev.orders);
  const ticketPct = pctChange(ticket(cur), ticket(prev));
  if (ordersPct !== null && Math.abs(ordersPct) >= 5) {
    out.push({ kind: 'orders', tone: ordersPct > 0 ? 'good' : 'bad', text: `${cur.orders} orders, ${dir(ordersPct)} ${Math.abs(ordersPct)}% on the previous period.` });
  }
  if (ticketPct !== null && Math.abs(ticketPct) >= 5) {
    out.push({ kind: 'ticket', tone: ticketPct > 0 ? 'good' : 'bad', text: `The average sale is ${dir(ticketPct)} ${Math.abs(ticketPct)}% to ${fmtMoney(ticket(cur))}.` });
  }

  const gain = productMovers.find(p => p.change > 0);
  const loss = productMovers.find(p => p.change < 0);
  if (gain) out.push({ kind: 'product', tone: 'good', text: `${gain.name} sold ${fmtMoney(gain.change)} more than the previous period.` });
  if (loss) out.push({ kind: 'product', tone: 'bad', text: `${loss.name} sold ${fmtMoney(-loss.change)} less than the previous period.` });
  return out;
}

/** Gross margin percent, or null with no sales. */
export function marginOf({ revenue, cogs }) {
  return revenue > 0.005 ? pct1(((revenue - cogs) / revenue) * 100) : null;
}

/**
 * Average purchase cost per item in each period -> the biggest movers.
 * `rows` are { key, itemName, period: 'cur'|'prev', qty, cost } where cost is
 * qty x unit cost; an item with no buy in the previous period falls back to
 * `lastBefore[key]` (its last unit cost before the current period began).
 */
export function costMovers(rows = [], lastBefore = {}, limit = 10) {
  const by = new Map();
  for (const r of rows) {
    const it = by.get(r.key) || { key: r.key, itemName: r.itemName, cur: { qty: 0, cost: 0 }, prev: { qty: 0, cost: 0 } };
    it[r.period].qty += Number(r.qty) || 0;
    it[r.period].cost += Number(r.cost) || 0;
    by.set(r.key, it);
  }
  const list = [];
  for (const it of by.values()) {
    if (it.cur.qty <= 0) continue;
    const now = it.cur.cost / it.cur.qty;
    const before = it.prev.qty > 0 ? it.prev.cost / it.prev.qty : Number(lastBefore[it.key]) || 0;
    const changePct = pctChange(now, before);
    if (changePct === null || changePct === 0) continue;
    list.push({ key: it.key, itemName: it.itemName, unitCost: roundMoney(now), prevUnitCost: roundMoney(before), changePct, spend: roundMoney(it.cur.cost) });
  }
  // Rank by what the move costs the business, not the raw percent: a 40% jump
  // on a garnish matters less than 10% on the flour every product uses.
  return list.sort((a, b) => Math.abs(b.changePct) * b.spend - Math.abs(a.changePct) * a.spend).slice(0, limit);
}

/** Per-product revenue / COGS / margin with best and worst lists. */
export function rankProfitability(rows = [], limit = 5) {
  const items = rows.map(r => {
    const revenue = roundMoney(r.revenue), cogs = roundMoney(r.cogs), profit = roundMoney(r.revenue - r.cogs);
    return { name: r.name, qty: r.qty, revenue, cogs, profit, margin: revenue > 0 ? pct1((profit / revenue) * 100) : 0 };
  }).sort((a, b) => b.profit - a.profit);
  const sold = items.filter(i => i.revenue > 0);
  const totals = {
    revenue: roundMoney(items.reduce((s, i) => s + i.revenue, 0)),
    cogs: roundMoney(items.reduce((s, i) => s + i.cogs, 0)),
  };
  totals.profit = roundMoney(totals.revenue - totals.cogs);
  totals.margin = totals.revenue > 0 ? pct1((totals.profit / totals.revenue) * 100) : 0;
  return {
    items, totals,
    best: sold.slice(0, limit),
    // Worst by margin: what earns the least on each peso sold.
    worst: [...sold].sort((a, b) => a.margin - b.margin || a.profit - b.profit).slice(0, limit),
    lossMakers: sold.filter(i => i.profit < 0),
    // Products whose recipe has no cost behind it - their margin reads 100%
    // only because nothing tells us what goes into them.
    uncosted: sold.filter(i => i.cogs <= 0).map(i => i.name),
  };
}

// The share of an open invoice we expect to collect in the next 30 days, by
// how old it is. Older debt is less likely to arrive - and is never assumed
// to arrive later instead, which would only flatter the far horizons.
export const COLLECTION_RATES = { current: 1, d31_60: 0.85, d61_90: 0.6, d90_plus: 0.3 };

/**
 * When the next payrolls fall and how much each will be, from recent runs.
 * `runs` are { payDate, net, status } newest first. Runs already approved but
 * not yet paid are taken as they are; after the last known pay date the
 * average of the last three is repeated at the usual gap between them.
 */
export function projectPayroll(runs = [], today, horizonDays = 90) {
  const end = today.getTime() + horizonDays * DAY;
  const known = runs.filter(r => r.payDate && Number(r.net) > 0)
    .map(r => ({ date: new Date(r.payDate), net: Number(r.net), status: r.status }))
    .sort((a, b) => b.date - a.date);
  if (!known.length) return { events: [], cadenceDays: null, averageNet: 0 };
  const recent = known.slice(0, 3);
  const averageNet = roundMoney(recent.reduce((s, r) => s + r.net, 0) / recent.length);
  const gaps = [];
  for (let i = 0; i < Math.min(known.length, 4) - 1; i++) gaps.push(Math.round((known[i].date - known[i + 1].date) / DAY));
  gaps.sort((a, b) => a - b);
  // Median gap; one run on record reads as twice a month, the common cycle here.
  const cadenceDays = gaps.length ? Math.max(7, gaps[Math.floor(gaps.length / 2)]) : 15;

  const events = known.filter(r => r.status === 'Approved' && r.date.getTime() <= end)
    .map(r => ({ date: r.date.getTime() < today.getTime() ? today : r.date, amount: roundMoney(r.net), kind: 'payroll', label: 'Approved payroll', projected: false }));
  let next = known[0].date.getTime() + cadenceDays * DAY;
  while (next < today.getTime()) next += cadenceDays * DAY;
  for (; next <= end; next += cadenceDays * DAY) {
    events.push({ date: new Date(next), amount: averageNet, kind: 'payroll', label: 'Expected payroll', projected: true });
  }
  return { events, cadenceDays, averageNet };
}

/**
 * Walk dated money in and out from today's cash to 30/60/90-day totals, and
 * find the lowest point on the way. `events` are { date, amount, direction:
 * 'in'|'out', kind }.
 */
export function buildOutlook({ cashNow, events = [], today, horizons = [30, 60, 90] }) {
  const sorted = [...events].sort((a, b) => a.date - b.date);
  const dayOf = (d) => Math.max(0, Math.floor((new Date(d).getTime() - today.getTime()) / DAY));
  const rows = horizons.map(h => {
    const inside = sorted.filter(e => dayOf(e.date) < h);
    const sum = (pred) => roundMoney(inside.filter(pred).reduce((s, e) => s + e.amount, 0));
    const cin = sum(e => e.direction === 'in');
    const out = { bills: sum(e => e.direction === 'out' && e.kind === 'bill'), payroll: sum(e => e.direction === 'out' && e.kind === 'payroll') };
    const totalOut = roundMoney(out.bills + out.payroll);
    return { days: h, in: cin, out: { ...out, total: totalOut }, net: roundMoney(cin - totalOut), endingBalance: roundMoney(cashNow + cin - totalOut) };
  });
  let balance = cashNow, lowest = { balance: roundMoney(cashNow), day: 0 };
  const last = Math.max(...horizons);
  for (const e of sorted) {
    const d = dayOf(e.date);
    if (d >= last) break;
    balance += e.direction === 'in' ? e.amount : -e.amount;
    if (balance < lowest.balance - 0.005) lowest = { balance: roundMoney(balance), day: d };
  }
  return { horizons: rows, lowest, shortfall: lowest.balance < 0 };
}

/** Expected collection for one open invoice: { date, amount } or null. */
export function expectedCollection({ balance, due, createdAt }, today) {
  if (!(balance > 0)) return null;
  if (due && new Date(due).getTime() >= today.getTime()) return { date: new Date(due), amount: roundMoney(balance), rate: 1 };
  const age = Math.floor((today.getTime() - new Date(createdAt || today).getTime()) / DAY);
  const rate = COLLECTION_RATES[bucketFor(age)];
  return { date: today, amount: roundMoney(balance * rate), rate };
}
