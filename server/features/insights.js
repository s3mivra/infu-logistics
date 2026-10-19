// Three small reports an owner asks for that the records could already answer:
//
//   Waste log        what was thrown away, how much it cost, and why
//   Sales by hour    when the business is busy - by hour, by weekday, and (a
//                    cafe) by table
//   Backup status    when the data was last safely copied
//
// None of them posts or changes anything. They read what the spoilage, sales
// and backup jobs already wrote.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { businessDateStr, businessTimeZone } from '../lib/businessTime.js';
import { RECEIVABLE_STATUSES, arBalance } from '../lib/credit.js';
import { AR_PAYMENT_METHOD_FILTER } from '../lib/ledger.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// What the backup job writes into each business's settings after a verified run.
export const LAST_BACKUP_KEY = 'lastBackupAt';
// { [seller's name]: monthly sales target }
const SALES_TARGETS_KEY = 'salesTargets';

export default function registerInsights(ctx) {
  const {
    app, IS_PROD, BUSINESS_TYPE, tenantScope, Order, Inventory, StockCard, Settings,
    Bill, PurchaseOrder, JournalEntry, User, logAudit,
    verifyToken, requireStaff, requirePermission,
  } = ctx;
  const canView = [requireStaff, requirePermission('reports.view')];
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));

  // A report's window: the dates given, or this month so far.
  const windowOf = (q) => {
    const today = businessDateStr(new Date());
    const startKey = /^\d{4}-\d{2}-\d{2}$/.test(String(q.start || '')) ? String(q.start) : `${today.slice(0, 8)}01`;
    const endKey = /^\d{4}-\d{2}-\d{2}$/.test(String(q.end || '')) ? String(q.end) : today;
    return { startKey, endKey, from: dayStart(startKey), to: dayEnd(endKey) };
  };

  // ── WASTE LOG ──────────────────────────────────────────────────────────────
  // Every spoilage recorded on Inventory (Record spoilage) or from a refund
  // whose goods could not go back on the shelf. Each one already posted its
  // cost to Spoilage, Variance & Waste; this is the list behind that figure -
  // which items, how often, and the reason someone gave.
  app.get('/api/reports/waste', verifyToken, ...canView, requirePermission('screen.reports.waste'), async (req, res) => {
    try {
      const { startKey, endKey, from, to } = windowOf(req.query);
      const cards = await StockCard.find({ type: 'Spoilage', date: { $gte: from, $lte: to } })
        .sort({ date: -1 }).limit(5000).lean();
      const ids = [...new Set(cards.map(c => String(c.inventoryId || '')).filter(Boolean))];
      const items = await Inventory.find({ _id: { $in: ids } }, { itemName: 1, unit: 1, itemCode: 1, stockCategory: 1 }).lean().catch(() => []);
      const byId = new Map(items.map(i => [String(i._id), i]));

      const rows = cards.map((c) => {
        const item = byId.get(String(c.inventoryId)) || {};
        const qty = Math.abs(Number(c.qtyChange) || 0);
        // "Expired: found at the back of the chiller" -> reason "Expired", note the rest.
        const text = String(c.remarks || '').trim();
        const cut = text.indexOf(':');
        const reason = (cut > 0 ? text.slice(0, cut) : text).trim() || 'No reason given';
        return {
          date: c.date, reference: c.reference || '',
          itemName: c.itemName || item.itemName || '', itemCode: item.itemCode || '', category: item.stockCategory || '',
          qty, unit: item.unit || '', unitCost: r2(c.unitCost), value: r2(qty * (Number(c.unitCost) || 0)),
          reason, note: cut > 0 ? text.slice(cut + 1).trim() : '',
        };
      });

      const group = (keyOf, extra = () => ({})) => {
        const m = new Map();
        for (const r of rows) {
          const k = keyOf(r);
          const g = m.get(k) || { key: k, count: 0, qty: 0, value: 0, ...extra(r) };
          g.count += 1; g.qty += r.qty; g.value += r.value;
          m.set(k, g);
        }
        return [...m.values()].map(g => ({ ...g, qty: +g.qty.toFixed(4), value: r2(g.value) })).sort((a, b) => b.value - a.value);
      };
      res.json({
        success: true, start: startKey, end: endKey,
        total: r2(rows.reduce((s, r) => s + r.value, 0)), count: rows.length,
        byItem: group(r => r.itemName, r => ({ unit: r.unit, itemCode: r.itemCode })),
        byReason: group(r => r.reason),
        rows: rows.slice(0, 1000), truncated: rows.length > 1000,
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── SALES BY HOUR ──────────────────────────────────────────────────────────
  // Completed, paid sales in the window, placed on the business's own clock:
  // which hours and which weekdays carry the day. A cafe also sees it by
  // table; a logistics business sees it by how the order went out.
  app.get('/api/reports/sales-by-hour', verifyToken, ...canView, requirePermission('screen.reports.saleshours'), async (req, res) => {
    try {
      const { startKey, endKey, from, to } = windowOf(req.query);
      const timezone = businessTimeZone();
      const match = {
        businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Completed', isComplimentary: { $ne: true },
        createdAt: { $gte: from, $lte: to },
      };
      const [hours, weekdays, places, days, itemHours] = await Promise.all([
        Order.aggregate([{ $match: match }, { $group: { _id: { $hour: { date: '$createdAt', timezone } }, total: { $sum: '$total' }, orders: { $sum: 1 } } }]),
        Order.aggregate([{ $match: match }, { $group: { _id: { $dayOfWeek: { date: '$createdAt', timezone } }, total: { $sum: '$total' }, orders: { $sum: 1 } } }]),
        Order.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ['$table', ''] }, total: { $sum: '$total' }, orders: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 200 }]),
        Order.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone } } } }]),
        // What sold in each hour, for the best sellers by time of day.
        Order.aggregate([{ $match: match }, { $unwind: '$items' }, { $group: { _id: { hour: { $hour: { date: '$createdAt', timezone } }, name: '$items.name' }, qty: { $sum: '$items.quantity' } } }]),
      ]);
      const grand = r2(hours.reduce((s, h) => s + h.total, 0));
      const orders = hours.reduce((s, h) => s + h.orders, 0);
      const share = (n) => (grand > 0 ? Math.round((n / grand) * 1000) / 10 : 0);
      const line = (label, x) => ({
        label, total: r2(x?.total), orders: x?.orders || 0,
        average: x?.orders ? r2(x.total / x.orders) : 0, share: share(x?.total || 0),
      });
      const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
      const byHourMap = new Map(hours.map(h => [h._id, h]));
      // Every hour from the first sale to the last, so a dead hour shows as one.
      const used = hours.map(h => h._id).sort((x, y) => x - y);
      const byHour = used.length
        ? Array.from({ length: used[used.length - 1] - used[0] + 1 }, (_, i) => used[0] + i).map(h => ({ hour: h, ...line(hourLabel(h), byHourMap.get(h)) }))
        : [];
      const byWeekdayMap = new Map(weekdays.map(w => [w._id, w]));
      const byWeekday = WEEKDAYS.map((name, i) => line(name, byWeekdayMap.get(i + 1)));
      const busiest = (list) => list.reduce((best, x) => (x.total > (best?.total || 0) ? x : best), null);
      // The day in four parts, and the five things that sell most in each.
      const PARTS = [['Morning', 0, 11, 'before 11 AM'], ['Midday', 11, 14, '11 AM - 2 PM'], ['Afternoon', 14, 17, '2 - 5 PM'], ['Evening', 17, 24, 'from 5 PM']];
      const byDaypart = PARTS.map(([label, from, to, span]) => {
        const sold = new Map();
        for (const r of itemHours) if (r._id.name && r._id.hour >= from && r._id.hour < to) sold.set(r._id.name, (sold.get(r._id.name) || 0) + r.qty);
        const inPart = hours.filter(h => h._id >= from && h._id < to);
        return {
          ...line(label, { total: inPart.reduce((t, h) => t + h.total, 0), orders: inPart.reduce((t, h) => t + h.orders, 0) }), span,
          top: [...sold.entries()].map(([name, qty]) => ({ name, qty })).sort((x, y) => y.qty - x.qty).slice(0, 5),
        };
      });
      res.json({
        success: true, start: startKey, end: endKey, timezone,
        total: grand, orders, tradingDays: days.length,
        byHour, byWeekday, byDaypart,
        // What `table` holds differs by business: a cafe's tables and Takeout;
        // a logistics business's Pickup, Lalamove and delivery.
        placeLabel: BUSINESS_TYPE === 'log' ? 'How it went out' : 'Table',
        byPlace: places.map(p => line(p._id || '(none)', p)),
        busiestHour: busiest(byHour)?.label || '', busiestDay: busiest(byWeekday)?.label || '',
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── BACKUP STATUS ──────────────────────────────────────────────────────────
  // The platform's backup job copies every business's data once a day and
  // checks the copy reads back (platform/backup-loop.sh). After a good run it
  // writes the time here, so the owner can see it without the server console.
  // null = this deployment has never been stamped (a backup taken by hand, or
  // an older platform): the screen says "not known", not "never".
  app.get('/api/system/backup-status', verifyToken, requireStaff, requirePermission('owner.view'), async (req, res) => {
    try {
      const [row, drillRow] = await Promise.all([Settings.findOne({ key: LAST_BACKUP_KEY }).lean(), Settings.findOne({ key: 'lastRestoreDrillAt' }).lean()]);
      // A backup is only proven by restoring it. The platform's restore drill
      // (make restore-drill) writes when it last passed.
      const drill = drillRow?.value && !Number.isNaN(new Date(drillRow.value).getTime()) ? new Date(drillRow.value) : null;
      const at = row?.value ? new Date(row.value) : null;
      const valid = at && !Number.isNaN(at.getTime());
      const hours = valid ? Math.floor((Date.now() - at.getTime()) / 3600000) : null;
      res.json({
        success: true, lastBackupAt: valid ? at : null, hoursAgo: hours,
        lastRestoreTestAt: drill, restoreTestDaysAgo: drill ? Math.floor((Date.now() - drill.getTime()) / 86400000) : null,
        // Daily job: a day and a half without one means a run was missed.
        state: !valid ? 'unknown' : hours > 36 ? 'late' : 'ok',
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── CASH FLOW FORECAST ─────────────────────────────────────────────────────
  // The next few weeks, from what is already on the books: the cash there is
  // now, what customers owe and when it falls due, and the supplier bills to
  // be paid and when. Not a prediction of sales - only money already promised
  // either way. Overdue amounts are counted in the first week, as the money
  // most likely to move next; anything with no due date is shown apart and
  // left out of the weeks, because nothing says when it will move.
  app.get('/api/reports/cash-forecast', verifyToken, ...canView, requirePermission('screen.reports.cashforecast'), async (req, res) => {
    try {
      const days = Math.min(91, Math.max(7, Math.round(Number(req.query.days) || 28)));
      const weeks = Math.ceil(days / 7);
      const today = dayStart(businessDateStr(new Date()));
      const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };

      const [cashRows, owedRows, billRows] = await Promise.all([
        JournalEntry.aggregate([
          { $unwind: '$lines' },
          { $match: { 'lines.accountCode': { $regex: '^11' } } },
          { $group: { _id: '$lines.accountCode', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
        ]),
        Order.find({ ...scope, status: { $in: RECEIVABLE_STATUSES }, paymentMethod: AR_PAYMENT_METHOD_FILTER, isComplimentary: { $ne: true }, arSettled: { $ne: true } },
          { orderNumber: 1, customerName: 1, total: 1, arPaidAmount: 1, refundedAmount: 1, arDueDate: 1, createdAt: 1 }).limit(5000).lean(),
        Bill.find({ ...scope, status: { $in: ['Pending', 'Approved', 'Partially Paid'] } },
          { billNumber: 1, supplierName: 1, amount: 1, paidAmount: 1, dueDate: 1, status: 1, description: 1 }).limit(5000).lean(),
      ]);
      // Money that can be spent: cash, bank, e-wallets, petty cash and checks
      // in hand - not the unassigned holding account, nor the heading itself.
      const cashNow = r2(cashRows.filter(r => !['110000', '118000'].includes(String(r._id))).reduce((t, r) => t + (r.debit || 0) - (r.credit || 0), 0));

      const weekOf = (due) => {
        if (!due) return null;
        const d = new Date(due).getTime();
        if (d < today.getTime()) return 0;                                   // overdue: first week
        const w = Math.floor((d - today.getTime()) / (7 * 86400000));
        return w < weeks ? w : -1;                                           // -1 = beyond the window
      };
      const grid = Array.from({ length: weeks }, (_, w) => {
        const from = new Date(today.getTime() + w * 7 * 86400000);
        const to = new Date(from.getTime() + 6 * 86400000);
        return { week: w + 1, from: businessDateStr(from), to: businessDateStr(to), in: 0, out: 0 };
      });
      const side = { overdue: 0, later: 0, undated: 0, total: 0 };
      const inSide = { ...side }, outSide = { ...side };
      const place = (amount, due, key, totals) => {
        totals.total += amount;
        const w = weekOf(due);
        if (w === null) { totals.undated += amount; return; }
        if (w === -1) { totals.later += amount; return; }
        if (new Date(due).getTime() < today.getTime()) totals.overdue += amount;
        grid[w][key] += amount;
      };

      const receivables = owedRows.map(o => ({ ref: o.orderNumber, name: o.customerName || '', due: o.arDueDate || null, amount: r2(arBalance(o)) })).filter(x => x.amount > 0);
      for (const x of receivables) place(x.amount, x.due, 'in', inSide);
      const payables = billRows.map(b => ({
        ref: b.billNumber, name: b.supplierName || '', due: b.dueDate || null, awaitingApproval: b.status === 'Pending',
        amount: r2((Number(b.amount) || 0) - (Number(b.paidAmount) || 0)),
      })).filter(x => x.amount > 0);
      for (const x of payables) place(x.amount, x.due, 'out', outSide);

      let balance = cashNow, lowest = { balance: cashNow, week: 0 };
      const rows = grid.map((g) => {
        balance = r2(balance + g.in - g.out);
        if (balance < lowest.balance) lowest = { balance, week: g.week };
        return { ...g, in: r2(g.in), out: r2(g.out), net: r2(g.in - g.out), balance };
      });
      const tidy = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r2(v)]));
      const byDue = (x, y) => (x.due ? new Date(x.due).getTime() : Infinity) - (y.due ? new Date(y.due).getTime() : Infinity);
      res.json({
        success: true, asOf: businessDateStr(today), days, cashNow,
        weeks: rows, endingBalance: rows.length ? rows[rows.length - 1].balance : cashNow,
        // The tightest point in the window: below zero means bills fall due
        // before the money to pay them is expected.
        lowest, shortfall: lowest.balance < 0,
        expectedIn: tidy(inSide), expectedOut: tidy(outSide),
        awaitingApproval: r2(payables.filter(x => x.awaitingApproval).reduce((t, x) => t + x.amount, 0)),
        receivables: receivables.sort(byDue).slice(0, 100), payables: payables.sort(byDue).slice(0, 100),
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── CASHIER PERFORMANCE ────────────────────────────────────────────────────
  // Per person at the till, for the window: what they sold, and the things an
  // owner looks at twice - voids, refunds, discounts and complimentary orders.
  // A high share is a question to ask, not a finding: the busiest cashier also
  // voids the most. Rates are shown beside the counts for that reason.
  app.get('/api/reports/cashier-performance', verifyToken, ...canView, requirePermission('screen.reports.cashierperf'), async (req, res) => {
    try {
      const { startKey, endKey, from, to } = windowOf(req.query);
      const rows = await Order.aggregate([
        { $match: { businessType: BUSINESS_TYPE, ...tenantScope(req), createdAt: { $gte: from, $lte: to }, status: { $in: ['Completed', 'Voided'] } } },
        { $group: {
          _id: { $ifNull: ['$cashier', ''] },
          sales: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Completed'] }, { $ne: ['$isComplimentary', true] }] }, '$total', 0] } },
          orders: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Completed'] }, { $ne: ['$isComplimentary', true] }] }, 1, 0] } },
          voids: { $sum: { $cond: [{ $eq: ['$status', 'Voided'] }, 1, 0] } },
          voidValue: { $sum: { $cond: [{ $eq: ['$status', 'Voided'] }, '$total', 0] } },
          refunds: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$refundedAmount', 0] }, 0] }, 1, 0] } },
          refundValue: { $sum: { $ifNull: ['$refundedAmount', 0] } },
          discounted: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Completed'] }, { $gt: [{ $ifNull: ['$discount', 0] }, 0] }] }, 1, 0] } },
          discountValue: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, { $ifNull: ['$discount', 0] }, 0] } },
          complimentary: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Completed'] }, { $eq: ['$isComplimentary', true] }] }, 1, 0] } },
        } },
      ]);
      const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
      const cashiers = rows.map(r => ({
        name: r._id || '(not recorded)',
        sales: r2(r.sales), orders: r.orders, average: r.orders ? r2(r.sales / r.orders) : 0,
        voids: r.voids, voidValue: r2(r.voidValue), voidRate: pct(r.voids, r.orders + r.voids),
        refunds: r.refunds, refundValue: r2(r.refundValue),
        discounted: r.discounted, discountValue: r2(r.discountValue), discountRate: pct(r.discounted, r.orders),
        complimentary: r.complimentary,
      })).sort((a, b) => b.sales - a.sales);
      const sum = (k) => cashiers.reduce((t, c) => t + c[k], 0);
      res.json({
        success: true, start: startKey, end: endKey, cashiers,
        totals: {
          sales: r2(sum('sales')), orders: sum('orders'), voids: sum('voids'), voidValue: r2(sum('voidValue')),
          refunds: sum('refunds'), refundValue: r2(sum('refundValue')), discountValue: r2(sum('discountValue')), complimentary: sum('complimentary'),
          voidRate: pct(sum('voids'), sum('orders') + sum('voids')),
        },
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── SUPPLIER PRICES ────────────────────────────────────────────────────────
  // For each item bought, what each supplier last charged, from the purchase
  // orders already here: who is cheapest now, and how far apart they are.
  // An item is matched across suppliers by its code, or its name where it has
  // none. Cancelled orders are left out.
  app.get('/api/reports/supplier-prices', verifyToken, ...canView, requirePermission('screen.reports.supplierprices'), async (req, res) => {
    try {
      const rows = await PurchaseOrder.aggregate([
        { $match: { ...tenantScope(req), status: { $ne: 'Cancelled' } } },
        { $sort: { createdAt: 1 } },
        { $unwind: '$lines' },
        { $match: { 'lines.unitCost': { $gt: 0 } } },
        { $group: {
          _id: { supplier: '$supplier', code: { $toLower: { $ifNull: ['$lines.itemCode', ''] } }, name: { $toLower: { $ifNull: ['$lines.itemName', ''] } } },
          itemName: { $last: '$lines.itemName' }, itemCode: { $last: '$lines.itemCode' }, unit: { $last: '$lines.unit' },
          lastCost: { $last: '$lines.unitCost' }, lastAt: { $last: '$createdAt' },
          lowest: { $min: '$lines.unitCost' }, highest: { $max: '$lines.unitCost' },
          orders: { $sum: 1 }, qty: { $sum: '$lines.orderedQty' },
        } },
      ]);
      const items = new Map();
      for (const r of rows) {
        const key = r._id.code || `name:${r._id.name}`;
        const it = items.get(key) || { itemName: r.itemName, itemCode: r.itemCode || '', unit: r.unit || '', suppliers: [] };
        it.suppliers.push({ supplier: r._id.supplier || '(no supplier)', lastCost: r2(r.lastCost), lastAt: r.lastAt, lowest: r2(r.lowest), highest: r2(r.highest), orders: r.orders, qty: r.qty });
        items.set(key, it);
      }
      const list = [...items.values()].map((it) => {
        const suppliers = it.suppliers.sort((a, b) => a.lastCost - b.lastCost);
        const cheapest = suppliers[0], dearest = suppliers[suppliers.length - 1];
        return {
          ...it, suppliers, supplierCount: suppliers.length, cheapest: cheapest.supplier,
          // How much more the dearest last charged than the cheapest, in percent.
          spread: suppliers.length > 1 && cheapest.lastCost > 0 ? Math.round(((dearest.lastCost - cheapest.lastCost) / cheapest.lastCost) * 1000) / 10 : 0,
        };
      }).sort((a, b) => b.spread - a.spread || a.itemName.localeCompare(b.itemName));
      res.json({ success: true, items: list.slice(0, 500), count: list.length, compared: list.filter(i => i.supplierCount > 1).length });
    } catch (err) { fail(req, res, err); }
  });

  // ── SALES TARGETS ──────────────────────────────────────────────────────────
  // A monthly figure for each person who sells, and where they stand against
  // it. A sale counts for its salesperson, or for whoever rang it up when it
  // names none - the same rule Commissions uses, so the two always agree.
  // "On pace" compares sales so far with the share of the month gone by.
  const sellerOf = { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$salesperson', ''] } }, 0] }, '$salesperson', '$cashier'] };
  const readTargets = async () => {
    const v = (await Settings.findOne({ key: SALES_TARGETS_KEY }).lean())?.value;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  };

  app.get('/api/reports/sales-targets', verifyToken, ...canView, requirePermission('screen.reports.salestargets'), async (req, res) => {
    try {
      const today = businessDateStr(new Date());
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today.slice(0, 7);
      const [y, m] = month.split('-').map(Number);
      if (!(m >= 1 && m <= 12)) return res.status(400).json({ success: false, error: 'Give the month as YYYY-MM.' });
      const daysInMonth = new Date(y, m, 0).getDate();
      const startKey = `${month}-01`, endKey = `${month}-${String(daysInMonth).padStart(2, '0')}`;
      const isCurrent = month === today.slice(0, 7);
      const elapsed = isCurrent ? Number(today.slice(8, 10)) : (month < today.slice(0, 7) ? daysInMonth : 0);

      const [agg, targets, users] = await Promise.all([
        Order.aggregate([
          { $match: { businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Completed', isComplimentary: { $ne: true }, createdAt: { $gte: dayStart(startKey), $lte: dayEnd(endKey) } } },
          { $group: { _id: sellerOf, sales: { $sum: '$total' }, orders: { $sum: 1 } } },
        ]),
        readTargets(),
        User.find({ isActive: { $ne: false } }, { name: 1, role: 1 }).lean(),
      ]);
      const sold = new Map(agg.filter(r => r._id && r._id !== 'System').map(r => [r._id, r]));
      // Everyone with a target or a sale this month; staff with neither are
      // offered below so a target can be given to them.
      const names = [...new Set([...Object.keys(targets).filter(n => Number(targets[n]) > 0), ...sold.keys()])];
      const share = daysInMonth ? elapsed / daysInMonth : 0;
      const sellers = names.map((name) => {
        const sales = r2(sold.get(name)?.sales), target = r2(targets[name]);
        return {
          name, sales, orders: sold.get(name)?.orders || 0, target,
          percent: target > 0 ? Math.round((sales / target) * 1000) / 10 : null,
          remaining: target > 0 ? r2(Math.max(0, target - sales)) : null,
          // What they need to sell each remaining day to reach it.
          perDayNeeded: target > 0 && isCurrent && daysInMonth > elapsed ? r2(Math.max(0, target - sales) / (daysInMonth - elapsed)) : null,
          onPace: target > 0 ? sales >= r2(target * share) : null,
        };
      }).sort((a, b) => b.sales - a.sales);
      res.json({
        success: true, month, daysInMonth, daysElapsed: elapsed, isCurrent, sellers,
        totals: { sales: r2(sellers.reduce((t, x) => t + x.sales, 0)), target: r2(sellers.reduce((t, x) => t + x.target, 0)) },
        // Staff who could be given a target and have none yet.
        others: users.map(u => u.name).filter(n => n && !names.includes(n)).sort(),
      });
    } catch (err) { fail(req, res, err); }
  });

  // Set (or, with 0 or blank, remove) one person's monthly target.
  app.put('/api/reports/sales-targets', verifyToken, requireStaff, requirePermission('users.manage'), async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim().slice(0, 80);
      const target = r2(req.body?.target);
      if (!name) return res.status(400).json({ success: false, error: 'Whose target is it?' });
      if (!(target >= 0) || target > 999_999_999) return res.status(400).json({ success: false, error: 'The target must be zero or more.' });
      const targets = await readTargets();
      const before = Number(targets[name]) || 0;
      if (target > 0) targets[name] = target; else delete targets[name];
      await Settings.findOneAndUpdate({ key: SALES_TARGETS_KEY }, { key: SALES_TARGETS_KEY, value: targets }, { upsert: true });
      try { await logAudit?.(req, { action: 'update', entity: 'SalesTarget', entityId: name, before: { target: before }, after: { target } }); } catch { /* non-fatal */ }
      res.json({ success: true, name, target });
    } catch (err) { fail(req, res, err); }
  });

  // ── DELIVERY SHEET ─────────────────────────────────────────────────────────
  // The day's deliveries on one page for whoever is taking them out: where
  // each one goes, what is in it, and what to collect at the door. Sorted by
  // address so stops in the same area sit together. A delivery is an order
  // sent out (not picked up) that has not been cancelled; the sheet covers the
  // ones placed that day, plus any earlier ones still not delivered.
  app.get('/api/reports/delivery-sheet', (req, res, next) => (BUSINESS_TYPE === 'log' ? next() : res.status(404).json({ success: false, error: 'This is part of the logistics app only.' })), verifyToken, ...canView, requirePermission('screen.reports.deliverysheet'), async (req, res) => {
    try {
      const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : businessDateStr(new Date());
      const from = dayStart(dateKey), to = dayEnd(dateKey);
      const OUT = ['Manual Delivery', 'Lalamove', 'Grab Delivery', 'Foodpanda'];
      const DONE = ['Delivered', 'Picked Up'];
      const rows = await Order.find({
        businessType: BUSINESS_TYPE, ...tenantScope(req), table: { $in: OUT },
        status: { $nin: ['Cancelled', 'Voided'] },
        $or: [
          { createdAt: { $gte: from, $lte: to } },
          // Still to go out from an earlier day.
          { createdAt: { $lt: from }, status: { $ne: 'Completed' }, dispatchStatus: { $nin: DONE } },
        ],
      }, { orderNumber: 1, customerName: 1, deliveryAddress: 1, table: 1, total: 1, status: 1, dispatchStatus: 1, paymentMethod: 1, items: 1, orderNotes: 1, arSettled: 1, arPaidAmount: 1, createdAt: 1 })
        .sort({ createdAt: 1 }).limit(1000).lean();

      const stops = rows.map((o) => {
        const done = DONE.includes(o.dispatchStatus);
        // Cash on delivery is collected at the door; anything else is settled
        // through the office, so the driver collects nothing.
        const cod = ['Cash', 'Manual Delivery', 'Lalamove'].includes(o.paymentMethod);
        return {
          orderNumber: o.orderNumber, customer: o.customerName || '', address: String(o.deliveryAddress || '').trim(),
          via: o.table, status: o.dispatchStatus || o.status, done,
          items: (o.items || []).map(it => `${it.quantity} x ${it.name}`).slice(0, 30),
          pieces: (o.items || []).reduce((t, it) => t + (Number(it.quantity) || 0), 0),
          total: r2(o.total), collect: cod && !done ? r2(o.total) : 0,
          note: String(o.orderNotes || '').trim(), carriedOver: new Date(o.createdAt) < from,
        };
      })
        // Still to go first; within those, by address, and the ones with no address last.
        .sort((a, b) => Number(a.done) - Number(b.done) || Number(!a.address) - Number(!b.address) || a.address.localeCompare(b.address) || a.orderNumber.localeCompare(b.orderNumber));
      const open = stops.filter(x => !x.done);
      res.json({
        success: true, date: dateKey, stops,
        totals: {
          stops: stops.length, toDeliver: open.length, delivered: stops.length - open.length,
          toCollect: r2(open.reduce((t, x) => t + x.collect, 0)), pieces: open.reduce((t, x) => t + x.pieces, 0),
          noAddress: open.filter(x => !x.address).length,
        },
      });
    } catch (err) { fail(req, res, err); }
  });
}
