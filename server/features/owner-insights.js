// Three answers an owner asks for at a glance, read straight from what is
// already on the books:
//
//   What changed       this period against the one before - sales, margin,
//                      the purchase costs that moved - in plain sentences
//   Product profit     revenue, cost and margin per product, best and worst
//   Cash outlook       30/60/90 days of cash from open bills, expected
//                      collections and the payroll that keeps coming round
//
// Read-only: none of them posts to the ledger or changes a record.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { businessDateStr } from '../lib/businessTime.js';
import { RECEIVABLE_STATUSES, arBalance } from '../lib/credit.js';
import { AR_PAYMENT_METHOD_FILTER } from '../lib/ledger.js';
import { roundMoney } from '../lib/money.js';
import {
  pctChange, marginOf, explainChanges, costMovers, rankProfitability,
  projectPayroll, buildOutlook, expectedCollection, COLLECTION_RATES,
} from '../lib/ownerInsights.js';

const DAY = 86400000;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const shiftKey = (key, days) => businessDateStr(new Date(dayStart(key).getTime() + days * DAY + 12 * 3600000));

export default function registerOwnerInsights(ctx) {
  const {
    app, IS_PROD, BUSINESS_TYPE, tenantScope, Order, Product, Inventory, AddOn, StockCard,
    Bill, JournalEntry, PayrollRun, acctMeta, reportLinesForItem,
    verifyToken, requireStaff, requirePermission,
  } = ctx;
  const canView = [verifyToken, requireStaff, requirePermission('reports.view')];
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));

  // The window asked for (start/end), or the last `days` days ending today;
  // the previous period is the same number of days just before it.
  const periodsOf = (q) => {
    const today = businessDateStr(new Date());
    let endKey = isDate(q.end) ? String(q.end) : today;
    let startKey;
    if (isDate(q.start)) startKey = String(q.start);
    else startKey = shiftKey(endKey, -(Math.min(366, Math.max(1, Math.round(Number(q.days) || 30))) - 1));
    if (startKey > endKey) [startKey, endKey] = [endKey, startKey];
    const len = Math.round((dayStart(endKey).getTime() - dayStart(startKey).getTime()) / DAY) + 1;
    const prevEnd = shiftKey(startKey, -1), prevStart = shiftKey(prevEnd, -(len - 1));
    return {
      days: len,
      cur: { start: startKey, end: endKey, from: dayStart(startKey), to: dayEnd(endKey) },
      prev: { start: prevStart, end: prevEnd, from: dayStart(prevStart), to: dayEnd(prevEnd) },
    };
  };

  // Revenue and cost of sales from the ledger for one window - the same
  // accounts the P&L reads, so these figures agree with it.
  const ledgerTotals = async ({ from, to }) => {
    const agg = await JournalEntry.aggregate([
      { $match: { date: { $gte: from, $lte: to } } },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.accountCode', debit: { $sum: { $ifNull: ['$lines.debit', 0] } }, credit: { $sum: { $ifNull: ['$lines.credit', 0] } } } },
    ]);
    let revenue = 0, cogs = 0, opex = 0;
    for (const r of agg) {
      const meta = acctMeta(r._id);
      if (!meta) continue;
      if (meta.type === 'revenue') revenue += r.credit - r.debit;
      else if (meta.type === 'contra-revenue') revenue -= r.debit - r.credit;
      else if (meta.type === 'expense' && meta.cogs) cogs += r.debit - r.credit;
      else if (meta.type === 'expense' && !String(r._id).startsWith('9')) opex += r.debit - r.credit;
    }
    return { revenue: roundMoney(revenue), cogs: roundMoney(cogs), opex: roundMoney(opex) };
  };

  // Per-product revenue and recipe cost of the completed sales in a window,
  // costed the way the menu engineering report costs them.
  const productLines = async (req, { from, to }) => {
    const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    const [orders, prods, inv, addOns] = await Promise.all([
      Order.find({ ...scope, status: 'Completed', isComplimentary: { $ne: true }, createdAt: { $gte: from, $lte: to } }, { items: 1 }).lean(),
      Product.find(scope, { _id: 1, name: 1, category: 1, basePrice: 1, baseRecipe: 1, sizes: 1, addOns: 1, modifierGroups: 1 }).populate('modifierGroups').lean(),
      Inventory.find(scope, { _id: 1, itemCode: 1, itemName: 1, unitCost: 1, unitMultiplier: 1 }).lean(),
      AddOn.find({}, { name: 1, recipe: 1 }).lean(),
    ]);
    const addOnMap = Object.fromEntries(addOns.map(a => [a.name, a.recipe || []]));
    const prodMap = Object.fromEntries(prods.map(p => [String(p._id), p]));
    const invMap = {};
    inv.forEach(i => { invMap[String(i._id)] = i; if (i.itemCode) invMap[i.itemCode] = i; if (i.itemName) invMap[i.itemName] = i; });
    const stat = new Map();
    for (const o of orders) {
      for (const it of (o.items || [])) {
        for (const line of reportLinesForItem(it, prods, prodMap, invMap, addOnMap)) {
          const s = stat.get(line.name) || { name: line.name, qty: 0, revenue: 0, cogs: 0 };
          s.qty += line.qty; s.revenue += line.revenue; s.cogs += line.cogs;
          stat.set(line.name, s);
        }
      }
    }
    return { rows: [...stat.values()], orders: orders.length };
  };

  // ── WHAT CHANGED ───────────────────────────────────────────────────────────
  app.get('/api/insights/what-changed', ...canView, async (req, res) => {
    try {
      const p = periodsOf(req.query);
      const [curL, prevL, curP, prevP, buys, before] = await Promise.all([
        ledgerTotals(p.cur), ledgerTotals(p.prev),
        productLines(req, p.cur), productLines(req, p.prev),
        // What each item cost to buy in each window: restocks carry the unit cost paid.
        StockCard.find({ type: 'Restock', unitCost: { $gt: 0 }, qtyChange: { $gt: 0 }, date: { $gte: p.prev.from, $lte: p.cur.to } },
          { inventoryId: 1, itemName: 1, qtyChange: 1, unitCost: 1, date: 1 }).limit(20000).lean(),
        // The last price paid before the previous window, for items bought only now.
        StockCard.aggregate([
          { $match: { type: 'Restock', unitCost: { $gt: 0 }, date: { $lt: p.prev.from } } },
          { $sort: { date: -1 } },
          { $group: { _id: '$inventoryId', unitCost: { $first: '$unitCost' } } },
        ]),
      ]);
      const movers = costMovers(
        buys.map(b => ({
          key: String(b.inventoryId), itemName: b.itemName || 'Item',
          period: new Date(b.date) >= p.cur.from ? 'cur' : 'prev',
          qty: b.qtyChange, cost: b.qtyChange * b.unitCost,
        })),
        Object.fromEntries(before.map(b => [String(b._id), b.unitCost])),
      );
      const prevBy = new Map(prevP.rows.map(r => [r.name, r.revenue]));
      const names = new Set([...curP.rows.map(r => r.name), ...prevP.rows.map(r => r.name)]);
      const curBy = new Map(curP.rows.map(r => [r.name, r.revenue]));
      const productMovers = [...names].map(name => {
        const revenue = roundMoney(curBy.get(name) || 0), prevRevenue = roundMoney(prevBy.get(name) || 0);
        return { name, revenue, prevRevenue, change: roundMoney(revenue - prevRevenue), changePct: pctChange(revenue, prevRevenue) };
      }).filter(x => Math.abs(x.change) >= 0.01).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

      const cur = { ...curL, orders: curP.orders, margin: marginOf(curL) };
      const prev = { ...prevL, orders: prevP.orders, margin: marginOf(prevL) };
      res.json({
        success: true, days: p.days,
        current: { start: p.cur.start, end: p.cur.end, ...cur },
        previous: { start: p.prev.start, end: p.prev.end, ...prev },
        change: {
          revenuePct: pctChange(cur.revenue, prev.revenue),
          cogsPct: pctChange(cur.cogs, prev.cogs),
          ordersPct: pctChange(cur.orders, prev.orders),
          marginPts: cur.margin !== null && prev.margin !== null ? Math.round((cur.margin - prev.margin) * 10) / 10 : null,
        },
        insights: explainChanges({ cur, prev, costMovers: movers, productMovers }),
        costMovers: movers,
        productMovers: productMovers.slice(0, 10),
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── PRODUCT PROFITABILITY ──────────────────────────────────────────────────
  // Recipe cost at today's ingredient prices, so a product whose costs have
  // crept up shows the margin it earns now, not the one it used to.
  app.get('/api/insights/product-profitability', ...canView, async (req, res) => {
    try {
      const { cur } = periodsOf(req.query);
      const limit = Math.min(20, Math.max(1, Math.round(Number(req.query.limit) || 5)));
      const { rows, orders } = await productLines(req, cur);
      res.json({ success: true, start: cur.start, end: cur.end, orders, ...rankProfitability(rows, limit) });
    } catch (err) { fail(req, res, err); }
  });

  // ── CASH OUTLOOK ───────────────────────────────────────────────────────────
  // Cash on hand now, plus collections we can expect (due dates where set,
  // otherwise this month at a rate that falls with the invoice's age), less
  // approved bills by due date (overdue and undated ones now) and payroll at
  // the usual cycle. Bills still awaiting approval are shown, not counted.
  app.get('/api/insights/cash-outlook', ...canView, async (req, res) => {
    try {
      const today = dayStart(businessDateStr(new Date()));
      const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      const [cashRows, owed, bills, runs] = await Promise.all([
        JournalEntry.aggregate([
          { $unwind: '$lines' },
          { $match: { 'lines.accountCode': { $regex: '^11[1-5]' } } },
          { $group: { _id: null, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
        ]),
        Order.find({ ...scope, status: { $in: RECEIVABLE_STATUSES }, paymentMethod: AR_PAYMENT_METHOD_FILTER, isComplimentary: { $ne: true }, arSettled: { $ne: true } },
          { orderNumber: 1, customerName: 1, total: 1, arPaidAmount: 1, refundedAmount: 1, arDueDate: 1, createdAt: 1 }).limit(5000).lean(),
        Bill.find({ ...scope, status: { $in: ['Pending', 'Approved', 'Partially Paid'] } },
          { billNumber: 1, supplierName: 1, amount: 1, paidAmount: 1, dueDate: 1, status: 1 }).limit(5000).lean(),
        PayrollRun.find({ ...scope, status: { $in: ['Approved', 'Paid'] } }, { payDate: 1, status: 1, 'totals.net': 1 })
          .sort({ payDate: -1 }).limit(6).lean(),
      ]);
      const cashNow = roundMoney(cashRows.reduce((t, r) => t + (r.debit || 0) - (r.credit || 0), 0));

      const events = [];
      let receivableTotal = 0, doubtful = 0;
      for (const o of owed) {
        const balance = arBalance(o);
        const exp = expectedCollection({ balance, due: o.arDueDate, createdAt: o.createdAt }, today);
        if (!exp) continue;
        receivableTotal += balance;
        doubtful += balance - exp.amount;
        if (exp.amount > 0) events.push({ date: exp.date, amount: exp.amount, direction: 'in', kind: 'collection', ref: o.orderNumber, name: o.customerName || '' });
      }
      let awaitingApproval = 0;
      for (const b of bills) {
        const left = roundMoney((Number(b.amount) || 0) - (Number(b.paidAmount) || 0));
        if (left <= 0) continue;
        if (b.status === 'Pending') { awaitingApproval += left; continue; }
        const due = b.dueDate && new Date(b.dueDate) > today ? new Date(b.dueDate) : today;
        events.push({ date: due, amount: left, direction: 'out', kind: 'bill', ref: b.billNumber, name: b.supplierName || '' });
      }
      const payroll = projectPayroll(runs.map(r => ({ payDate: r.payDate, net: r.totals?.net, status: r.status })), today, 90);
      for (const e of payroll.events) events.push({ ...e, direction: 'out' });

      const outlook = buildOutlook({ cashNow, events, today });
      const upcoming = events.filter(e => e.date.getTime() < today.getTime() + 90 * DAY)
        .sort((a, b) => a.date - b.date).slice(0, 50)
        .map(e => ({ ...e, date: businessDateStr(e.date) }));
      res.json({
        success: true, asOf: businessDateStr(today), cashNow, ...outlook,
        lowest: { ...outlook.lowest, date: businessDateStr(new Date(today.getTime() + outlook.lowest.day * DAY)) },
        receivables: { total: roundMoney(receivableTotal), notExpected: roundMoney(doubtful), rates: COLLECTION_RATES },
        awaitingApproval: roundMoney(awaitingApproval),
        payroll: { cadenceDays: payroll.cadenceDays, averageNet: payroll.averageNet },
        upcoming,
      });
    } catch (err) { fail(req, res, err); }
  });
}
