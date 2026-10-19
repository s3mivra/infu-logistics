// Stock control: keeping the stock figures true.
//
// Analytics -> Stock movement, the Suggested PO and Costing are only as good
// as the stock balances they read. This is the work that keeps those right:
//
//   settings     selling below zero (warn / block, lib/negativeStock.js) and
//                how often each class of item is counted (lib/stockCount.js)
//   count list   today's rolling count - a few items, chosen by movement
//                class and how long since each was counted. Counting them goes
//                through POST /api/inventory/count with `rolling: true`, the
//                same route (and the same adjustments and journal entries) as
//                the end-of-day count.
//   variance     every count: expected vs counted, in units and pesos, by day
//                and by who counted
//   below zero   items whose balance is negative now, with their last stock
//                card lines - the trail to read before counting them
//
// Nothing here moves stock or posts to the books; only the counting route does.
import { captureError } from '../lib/errorLog.js';
import { businessDateStr } from '../lib/businessTime.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { NEGATIVE_STOCK_KEY, NEGATIVE_STOCK_MODES, readNegativeStockMode } from '../lib/negativeStock.js';
import { COUNT_CYCLE_KEY, COUNT_CYCLE_DEFAULTS, COUNT_CYCLE_LIMITS, cleanCountCycle, selectCountList, varianceTotals, stockCountModel } from '../lib/stockCount.js';

export default function registerStockControl(ctx) {
  const {
    app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope, Inventory, StockCard, Settings, logAudit,
    verifyToken, requireStaff, requirePermission,
  } = ctx;
  const StockCount = stockCountModel(mongoose);
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const readCycle = async () => cleanCountCycle((await Settings.findOne({ key: COUNT_CYCLE_KEY }).lean())?.value);
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  app.get('/api/stock-control/settings', verifyToken, requireStaff, requirePermission('inventory.view'), async (req, res) => {
    try {
      res.json({
        success: true, negativeStockMode: await readNegativeStockMode(Settings), modes: NEGATIVE_STOCK_MODES,
        countCycle: await readCycle(), defaults: COUNT_CYCLE_DEFAULTS, limits: COUNT_CYCLE_LIMITS,
      });
    } catch (err) { fail(req, res, err); }
  });

  app.put('/api/stock-control/settings', verifyToken, requireStaff, requirePermission('inventory.setup'), async (req, res) => {
    try {
      const body = req.body || {};
      const before = { negativeStockMode: await readNegativeStockMode(Settings), countCycle: await readCycle() };
      if (body.negativeStockMode !== undefined && !NEGATIVE_STOCK_MODES.includes(body.negativeStockMode)) {
        return res.status(400).json({ success: false, error: `Selling below zero must be one of: ${NEGATIVE_STOCK_MODES.join(', ')}.` });
      }
      const cycleIn = body.countCycle && typeof body.countCycle === 'object' ? body.countCycle : {};
      // Out of range is refused and named, as on the movement settings.
      const wrong = Object.entries(cycleIn).filter(([k]) => k in COUNT_CYCLE_LIMITS).filter(([k, v]) => {
        const n = Number(v), [lo, hi] = COUNT_CYCLE_LIMITS[k];
        return !(Number.isFinite(n) && Math.round(n) >= lo && Math.round(n) <= hi);
      });
      if (wrong.length) {
        return res.status(400).json({ success: false, error: `Out of range: ${wrong.map(([k]) => `${k} must be ${COUNT_CYCLE_LIMITS[k][0]}-${COUNT_CYCLE_LIMITS[k][1]}`).join('; ')}.`, limits: COUNT_CYCLE_LIMITS });
      }
      const after = {
        negativeStockMode: body.negativeStockMode ?? before.negativeStockMode,
        countCycle: cleanCountCycle({ ...before.countCycle, ...cycleIn }),
      };
      await Settings.findOneAndUpdate({ key: NEGATIVE_STOCK_KEY }, { key: NEGATIVE_STOCK_KEY, value: after.negativeStockMode }, { upsert: true });
      await Settings.findOneAndUpdate({ key: COUNT_CYCLE_KEY }, { key: COUNT_CYCLE_KEY, value: after.countCycle }, { upsert: true });
      try { await logAudit?.(req, { action: 'update', entity: 'StockControlSettings', entityId: 'stock-control', before, after }); } catch { /* non-fatal */ }
      res.json({ success: true, ...after });
    } catch (err) { fail(req, res, err); }
  });

  // Today's rolling count list.
  app.get('/api/stock-control/count-list', verifyToken, requireStaff, requirePermission('inventory.count'), async (req, res) => {
    try {
      const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      const cycle = await readCycle();
      const [movement, items, last] = await Promise.all([
        ctx.computeStockMovement(req, {}),
        Inventory.find(scope, { itemName: 1, itemCode: 1, stockQty: 1, unit: 1, unitCost: 1, stockCategory: 1 }).lean(),
        StockCount.aggregate([{ $group: { _id: '$inventoryId', at: { $max: '$date' } } }]),
      ]);
      const classOf = new Map((movement.rows || []).map(r => [String(r._id), r.class]));
      const lastCounted = new Map(last.map(r => [String(r._id), r.at]));
      const { list, dueTotal } = selectCountList({
        items: items.map(i => ({
          _id: String(i._id), itemName: i.itemName, itemCode: i.itemCode || '', category: i.stockCategory || '',
          stockQty: Number(i.stockQty) || 0, unit: i.unit || '', class: classOf.get(String(i._id)) || 'new',
        })),
        lastCounted, cycle,
      });
      res.json({ success: true, date: businessDateStr(), cycle, list, dueTotal });
    } catch (err) { fail(req, res, err); }
  });

  // Every count in a period: expected vs counted, in units and pesos.
  // Filters: start/end (business days), countedBy, kind (eod | rolling),
  // q (item name or code), varianceOnly=1.
  app.get('/api/stock-control/variance', verifyToken, requireStaff, requirePermission('inventory.view'), async (req, res) => {
    try {
      const q = req.query || {};
      const today = businessDateStr();
      const endKey = isDay(q.end) ? String(q.end) : today;
      const startKey = isDay(q.start) ? String(q.start) : businessDateStr(new Date(dayStart(endKey).getTime() - 29 * 86400000));
      const filter = { businessType: BUSINESS_TYPE, date: { $gte: dayStart(startKey), $lte: dayEnd(endKey) } };
      if (q.countedBy) filter.countedBy = String(q.countedBy);
      if (q.kind === 'eod' || q.kind === 'rolling') filter.kind = q.kind;
      if (q.q) { const re = new RegExp(escapeRe(String(q.q).trim().slice(0, 80)), 'i'); filter.$or = [{ itemName: re }, { itemCode: re }]; }
      if (q.varianceOnly === '1' || q.varianceOnly === 'true') filter.variance = { $ne: 0 };
      const rows = (await StockCount.find(filter).sort({ date: -1, itemName: 1 }).limit(5000).lean()).map(r => ({
        _id: String(r._id), date: r.date, dateString: r.dateString, inventoryId: r.inventoryId, itemName: r.itemName, itemCode: r.itemCode || '',
        unit: r.unit || '', expectedQty: r.expectedQty, countedQty: r.countedQty, variance: r.variance, unitCost: r.unitCost,
        varianceValue: r.varianceValue, countedBy: r.countedBy || '', reason: r.reason || '', kind: r.kind, reference: r.reference || '',
      }));
      const group = (key) => {
        const m = new Map();
        for (const r of rows) { const k = r[key] || '-'; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
        return [...m].map(([k, rs]) => ({ [key]: k, ...varianceTotals(rs) }));
      };
      const counters = await StockCount.distinct('countedBy', { businessType: BUSINESS_TYPE });
      res.json({
        success: true, start: startKey, end: endKey, rows, totals: varianceTotals(rows),
        byDay: group('dateString').sort((a, b) => b.dateString.localeCompare(a.dateString)),
        byCounter: group('countedBy').sort((a, b) => a.shortValue - b.shortValue),
        counters: counters.filter(Boolean).sort(), truncated: rows.length === 5000,
      });
    } catch (err) { fail(req, res, err); }
  });

  // Items below zero now, each with its last stock card lines.
  app.get('/api/stock-control/below-zero', verifyToken, requireStaff, requirePermission('inventory.view'), async (req, res) => {
    try {
      const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      const lines = Math.min(20, Math.max(1, parseInt(req.query.lines) || 5));
      const items = await Inventory.find({ ...scope, stockQty: { $lt: 0 } }, { itemName: 1, itemCode: 1, stockQty: 1, unit: 1, unitCost: 1 }).sort({ stockQty: 1 }).lean();
      const ids = items.map(i => String(i._id));
      const cards = ids.length ? await StockCard.aggregate([
        { $match: { inventoryId: { $in: ids } } }, { $sort: { date: -1, _id: -1 } },
        { $group: { _id: '$inventoryId', cards: { $push: { date: '$date', type: '$type', reference: '$reference', qtyChange: '$qtyChange', balanceAfter: '$balanceAfter', remarks: '$remarks', belowZero: '$belowZero' } } } },
        { $project: { cards: { $slice: ['$cards', lines] } } },
      ]) : [];
      const cardsOf = new Map(cards.map(c => [String(c._id), c.cards]));
      res.json({
        success: true,
        items: items.map(i => ({
          _id: String(i._id), itemName: i.itemName, itemCode: i.itemCode || '', unit: i.unit || '', stockQty: i.stockQty,
          // What the shortfall is worth at today's cost - stock the books are short.
          value: Math.round((Number(i.stockQty) || 0) * (Number(i.unitCost) || 0) * 100) / 100,
          lastLines: cardsOf.get(String(i._id)) || [],
        })),
      });
    } catch (err) { fail(req, res, err); }
  });
}
