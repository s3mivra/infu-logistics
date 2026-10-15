// Stock movement: which items are fast-moving, slow-moving or dead stock,
// from what actually sold - and how much of each to buy.
//
// The two kinds of business measure "sold" differently, on purpose:
//
//   Logistics   an item is a whole sellable unit - one bottle, one box, one
//               bag. Movement is the number of COMPLETE UNITS on completed
//               sales (backdated and imported ones too), and a purchase is
//               always a whole number of them: a 2-litre bottle is bought as
//               1, 2 or 3 bottles, never 0.5.
//   Cafe        an item is an ingredient used by recipes. Movement is exactly
//               what completed sales took from stock (each order keeps that
//               list - the same figures the stock deduction wrote), so 18 g of
//               beans or 0.5 L of syrup count as they were used, and a
//               purchase can be a fraction.
//
// Only completed sales count: cancelled and voided orders never do.
//
// The figures, per item, over the chosen period (business-local days):
//   Sold        units sold (logistics) / base units used (cafe) in the period
//   Per day     Sold / the days in the period the item existed AND had stock -
//               a stock-out is not read as low demand
//   Days left   free stock (on hand - held for client orders) / Per day;
//               null (N/A) when there is no rate to divide by
//   Since sale  whole calendar days from the last sale ever to today, in the
//               business's time zone (sold Sep 30, today Oct 15 = 15)
//   Buy         max(0, target - (free stock + on order)), where
//               target = Per day x (cover + delivery days) + safety stock,
//               safety stock = Per day x safety days. Whole units for
//               logistics and for anything counted in pcs.
//
// Nothing here writes anything except the thresholds (Settings), and nothing
// about the sale, the stock deduction or the books is touched.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { businessDateStr, businessTimeZone } from '../lib/businessTime.js';
import { basePerPack } from '../lib/units.js';

const SETTINGS_KEY = 'movementSettings';
export const MOVEMENT_DEFAULTS = {
  fastPercentile: 75,   // a seller at or above this share of sellers' daily rates is fast-moving...
  fastMinSoldDays: 3,   // ...and must have sold on at least this many days (consistency, not one big order)
  deadDays: 90,         // no sale in this many days, with that much history, is dead stock
  coverDays: 30,        // a purchase recommendation covers this many days of sales...
  leadTimeDays: 7,      // ...plus the wait for delivery...
  safetyDays: 3,        // ...plus a few spare days (the safety stock)
  categoryMinSellers: 5, // fast-moving is judged within the item's category once it has this many sellers
};
const LIMITS = { fastPercentile: [50, 95], fastMinSoldDays: [1, 30], deadDays: [7, 365], coverDays: [1, 180], leadTimeDays: [0, 90], safetyDays: [0, 60], categoryMinSellers: [2, 100] };
const DAY = 86400000;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

export function cleanMovementSettings(v = {}) {
  const out = {};
  for (const [k, def] of Object.entries(MOVEMENT_DEFAULTS)) {
    const n = Math.round(Number(v?.[k]));
    const [lo, hi] = LIMITS[k];
    out[k] = Number.isFinite(n) && n >= lo && n <= hi ? n : def;
  }
  return out;
}

// The value at the given percentile of a list (nearest rank).
export function percentile(values, p) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

// Days in [from, to) that the item had nothing on the shelf, from its stock
// card trail: `start` is the balance going into the window (null = unknown,
// treated as in stock), `cards` the balances after each movement inside it.
export function daysWithoutStock({ start, cards = [], from, to }) {
  let balance = start, at = from.getTime(), out = 0;
  for (const c of cards) {
    const t = Math.min(Math.max(new Date(c.date).getTime(), from.getTime()), to.getTime());
    if (balance !== null && balance <= 0) out += t - at;
    balance = Number(c.balanceAfter);
    at = t;
  }
  if (balance !== null && balance <= 0) out += to.getTime() - at;
  return out / DAY;
}

// One item's class. `soldQty` and `adu` are in the item's movement unit.
// `daysSinceSale` is from the item's last sale ever (Infinity = never sold).
// Whole calendar days between two instants, as the business's own dates
// (both read in its time zone), so there is no off-by-one at midnight UTC.
export function calendarDaysBetween(earlier, later = new Date()) {
  if (!earlier || Number.isNaN(new Date(earlier).getTime())) return null;
  const a = Date.parse(`${businessDateStr(new Date(earlier))}T00:00:00Z`);
  const b = Date.parse(`${businessDateStr(new Date(later))}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / DAY));
}

// What to buy: enough for cover + delivery days at the current rate, plus the
// safety stock, less what is free on the shelf and already on order. Whole
// units are rounded UP (one bottle short is still short).
export function recommendBuy({ adu, available, onOrder, settings, whole }) {
  if (!(adu > 0)) return 0;
  const target = adu * (settings.coverDays + settings.leadTimeDays) + adu * settings.safetyDays;
  const need = target - Math.max(0, available) - Math.max(0, onOrder);
  if (!(need > 1e-9)) return 0;
  return whole ? Math.ceil(need - 1e-9) : r3(need);
}

// How soon it runs out: 'out' (nothing free and it sells), 'urgent' (gone
// before a delivery ordered today could arrive), 'low' (inside the safety
// margin), else null.
export function runOut({ daysLeft, available, adu, settings }) {
  if (!(adu > 0)) return null;
  if (!(available > 0)) return 'out';
  if (daysLeft < settings.leadTimeDays) return 'urgent';
  if (daysLeft < settings.leadTimeDays + settings.safetyDays) return 'low';
  return null;
}

export function classify({ soldQty, adu, soldDays, fastThreshold, settings, historyDays, ageDays, outDays, effectiveDays, daysSinceSale = Infinity }) {
  if (soldQty > 0) return adu >= fastThreshold && soldDays >= settings.fastMinSoldDays ? 'fast' : 'slow';
  // No sale in the window. Dead stock needs time to judge: the business and
  // the item both older than the dead-stock period, and no sale in all of it.
  if (historyDays < settings.deadDays || ageDays < settings.deadDays) return 'new';
  // Out of stock for most of the window: it could not sell, so its silence
  // says nothing about demand.
  if (outDays >= effectiveDays * 0.5) return 'unavailable';
  if (daysSinceSale < settings.deadDays) return 'slow';     // sold recently, just not in this window
  return 'dead';
}

export default function registerStockMovement(ctx) {
  const {
    app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope, Order, Inventory, StockCard, Settings, logAudit, baseUnitsPerSale,
    verifyToken, requireStaff, requirePermission,
  } = ctx;
  const IS_LOG = BUSINESS_TYPE === 'log';
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  const readSettings = async () => cleanMovementSettings((await Settings.findOne({ key: SETTINGS_KEY }).lean())?.value);
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  app.get('/api/analytics/movement-settings', verifyToken, requireStaff, requirePermission('analytics.view'), async (req, res) => {
    try { res.json({ success: true, settings: await readSettings(), defaults: MOVEMENT_DEFAULTS }); } catch (err) { fail(req, res, err); }
  });

  app.put('/api/analytics/movement-settings', verifyToken, requireStaff, requirePermission('inventory.setup'), async (req, res) => {
    try {
      const before = await readSettings();
      const next = cleanMovementSettings({ ...before, ...(req.body || {}) });
      await Settings.findOneAndUpdate({ key: SETTINGS_KEY }, { key: SETTINGS_KEY, value: next }, { upsert: true });
      try { await logAudit?.(req, { action: 'update', entity: 'MovementSettings', entityId: 'movement', before, after: next }); } catch { /* non-fatal */ }
      res.json({ success: true, settings: next });
    } catch (err) { fail(req, res, err); }
  });

  // The whole report, for the route below and for the Suggested PO (reports.js),
  // so what Analytics says to buy is what the draft purchase order contains.
  // Returns { status, error } when the dates are wrong.
  async function computeMovement(req, query = {}) {
      const settings = cleanMovementSettings({ ...(await readSettings()), ...Object.fromEntries(Object.entries(query).filter(([k]) => k in MOVEMENT_DEFAULTS)) });
      const today = businessDateStr(new Date());
      const endKey = isDay(query.end) ? String(query.end) : today;
      const startKey = isDay(query.start) ? String(query.start) : businessDateStr(new Date(dayStart(endKey).getTime() - 29 * DAY));
      const from = dayStart(startKey);
      const to = new Date(Math.min(dayEnd(endKey).getTime(), Date.now()));
      if (!(to > from)) return { status: 400, error: 'The end date must be after the start date.' };
      const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      const windowDays = Math.max(1, (to - from) / DAY);

      // How long the business has been selling at all: a window longer than
      // that cannot show what an item "never" sold.
      const firstSale = await Order.findOne({ ...scope, status: 'Completed' }, { createdAt: 1 }).sort({ createdAt: 1 }).lean();
      const historyDays = firstSale ? (Date.now() - new Date(firstSale.createdAt).getTime()) / DAY : 0;
      const effectiveDays = Math.max(1, Math.min(windowDays, firstSale ? (to - Math.max(from.getTime(), new Date(firstSale.createdAt).getTime())) / DAY : windowDays));

      const items = await Inventory.find(scope, { itemName: 1, itemCode: 1, stockQty: 1, reservedQty: 1, unit: 1, displayUnit: 1, unitMultiplier: 1, packSize: 1, unitCost: 1, stockCategory: 1, createdAt: 1 }).lean();
      const byId = new Map(items.map(i => [String(i._id), i]));
      const byCode = new Map(items.filter(i => i.itemCode).map(i => [String(i.itemCode).trim().toLowerCase(), i]));
      const byName = new Map(items.map(i => [String(i.itemName || '').trim().toLowerCase(), i]));
      // Logistics: one sold unit is one whole item - a 2 L bottle is one pc -
      // and takes exactly what a sale deducts (server.js baseUnitsPerSale:
      // pack size x unit multiplier). A cafe counts in the item's base unit.
      const perUnit = (i) => {
        if (!IS_LOG) return 1;
        const n = baseUnitsPerSale ? Number(baseUnitsPerSale(null, i)) : basePerPack(i);
        return n > 0 && Number.isFinite(n) ? n : 1;
      };
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const stockOf = (i) => num(i.stockQty) / perUnit(i);
      const freeOf = (i) => Math.max(0, num(i.stockQty) - Math.max(0, num(i.reservedQty))) / perUnit(i);

      // ── What sold in the window ──
      const sold = new Map();   // invId -> { qty, orders:Set, days:Set }
      const bump = (invId, qty, order) => {
        const s = sold.get(invId) || { qty: 0, orders: new Set(), days: new Set() };
        s.qty += qty; s.orders.add(String(order._id)); s.days.add(businessDateStr(new Date(order.createdAt)));
        sold.set(invId, s);
      };
      const matchLine = (it) => (it.productCode && byCode.get(String(it.productCode).trim().toLowerCase()))
        || byName.get(String(it.name || '').trim().toLowerCase()) || null;
      const windowOrders = await Order.find({ ...scope, status: 'Completed', createdAt: { $gte: from, $lte: to } },
        IS_LOG ? { items: 1, createdAt: 1 } : { stockMoves: 1, createdAt: 1 }).lean();
      for (const o of windowOrders) {
        if (IS_LOG) {
          for (const it of o.items || []) {
            const inv = matchLine(it);
            const q = Number(it.quantity) || 0;
            if (inv && q > 0 && Number.isFinite(q)) bump(String(inv._id), q, o);
          }
        } else {
          for (const m of o.stockMoves || []) if (byId.has(String(m.invId)) && Number(m.qty) > 0) bump(String(m.invId), Number(m.qty), o);
        }
      }

      // ── The last time each item sold, ever ──
      const lastSold = new Map();
      if (IS_LOG) {
        const rows = await Order.aggregate([
          { $match: { ...scope, status: 'Completed' } }, { $unwind: '$items' },
          { $group: { _id: { code: { $toLower: { $ifNull: ['$items.productCode', ''] } }, name: { $toLower: { $ifNull: ['$items.name', ''] } } }, at: { $max: '$createdAt' } } },
        ]);
        for (const r of rows) {
          const inv = (r._id.code && byCode.get(r._id.code.trim())) || byName.get(r._id.name.trim());
          if (inv) { const k = String(inv._id); if (!lastSold.has(k) || r.at > lastSold.get(k)) lastSold.set(k, r.at); }
        }
      } else {
        const rows = await Order.aggregate([
          { $match: { ...scope, status: 'Completed', 'stockMoves.0': { $exists: true } } }, { $unwind: '$stockMoves' },
          { $group: { _id: '$stockMoves.invId', at: { $max: '$createdAt' } } },
        ]);
        for (const r of rows) lastSold.set(String(r._id), r.at);
      }

      // ── Days each item had nothing on the shelf, from its stock cards ──
      // A product that was out of stock cannot sell, so its rate is worked out
      // over the days it was actually there to buy.
      const ids = items.map(i => String(i._id));
      const [before, inside] = await Promise.all([
        StockCard.aggregate([
          { $match: { inventoryId: { $in: ids }, date: { $lt: from } } }, { $sort: { date: -1, _id: -1 } },
          { $group: { _id: '$inventoryId', balance: { $first: '$balanceAfter' } } },
        ]),
        StockCard.find({ inventoryId: { $in: ids }, date: { $gte: from, $lte: to } }, { inventoryId: 1, date: 1, balanceAfter: 1 }).sort({ date: 1, _id: 1 }).lean(),   // same instant: the order they were written
      ]);
      const startBal = new Map(before.map(b => [String(b._id), Number(b.balance)]));
      const cardsOf = new Map();
      for (const c of inside) { const k = String(c.inventoryId); if (!cardsOf.has(k)) cardsOf.set(k, []); cardsOf.get(k).push(c); }

      // ── Already on its way: open purchase orders ──
      const onOrder = new Map();
      try {
        const pos = await mongoose.model('PurchaseOrder').find({ ...tenantScope(req), status: { $in: ['Ordered', 'Processing', 'Incomplete'] } }, { lines: 1 }).lean();
        for (const po of pos) for (const l of po.lines || []) {
          const inv = l.invId && byId.get(String(l.invId));
          if (!inv) continue;
          const left = Math.max(0, (Number(l.orderedQty) || 0) - (Number(l.receivedQty) || 0));
          const base = left * basePerPack({ unitMultiplier: inv.unitMultiplier, packSize: Number(l.packSize) > 0 ? Number(l.packSize) : inv.packSize });
          onOrder.set(String(inv._id), (onOrder.get(String(inv._id)) || 0) + base / perUnit(inv));
        }
      } catch { /* the recommendation then ignores what is on order */ }

      // ── Per item ──
      const rows = items.map((i) => {
        const k = String(i._id);
        const s = sold.get(k);
        // Logistics sale lines are already whole units; a cafe's moves are base units.
        const soldQty = s ? s.qty : 0;
        const ageDays = i.createdAt ? (Date.now() - new Date(i.createdAt).getTime()) / DAY : Infinity;
        // Days the item could have sold in the window: it existed, and had stock.
        const itemFrom = i.createdAt && new Date(i.createdAt) > from ? new Date(i.createdAt) : from;
        const liveDays = Math.max(0, (to - itemFrom) / DAY);
        const hasTrail = startBal.has(k) || cardsOf.has(k);
        const outDays = hasTrail ? Math.min(liveDays, daysWithoutStock({ start: startBal.has(k) ? startBal.get(k) : null, cards: cardsOf.get(k) || [], from: itemFrom, to })) : 0;
        const inStockDays = Math.max(1, Math.min(effectiveDays, liveDays) - outDays);
        const unit = IS_LOG ? 'pcs' : (i.unit || '');
        return {
          _id: k, itemName: i.itemName, itemCode: i.itemCode || '', category: i.stockCategory || '',
          unit, whole: IS_LOG || /^(pcs?|pieces?|units?|packs?)$/i.test(unit),
          stock: r3(stockOf(i)), available: r3(freeOf(i)), reserved: r3(Math.max(0, num(i.reservedQty)) / perUnit(i)), onOrder: r3(onOrder.get(k) || 0),
          soldQty: r3(soldQty), transactions: s ? s.orders.size : 0, soldDays: s ? s.days.size : 0,
          adu: soldQty / inStockDays, inStockDays: r2(inStockDays), outDays: r2(outDays),
          lastSold: lastSold.get(k) || null, ageDays, unitCost: Number(i.unitCost) || 0, perUnit: perUnit(i), baseUnits: perUnit(i),
          liveDays,
        };
      });

      // Fast is judged against this business's own sellers, not a fixed number:
      // the rate at the chosen percentile of every item that sold.
      // A category with enough sellers of its own is judged against them (a
      // fast-selling cleaning product is not held to the bar of a fast-selling
      // cup); a small one against every seller.
      const sellers = rows.filter(r => r.soldQty > 0);
      const fastThreshold = percentile(sellers.map(r => r.adu), settings.fastPercentile);
      const byCategory = new Map();
      for (const r of sellers) { if (!r.category) continue; if (!byCategory.has(r.category)) byCategory.set(r.category, []); byCategory.get(r.category).push(r.adu); }
      const catThreshold = new Map([...byCategory].filter(([, v]) => v.length >= settings.categoryMinSellers).map(([c, v]) => [c, percentile(v, settings.fastPercentile)]));
      for (const r of rows) {
        r.daysSinceSale = calendarDaysBetween(r.lastSold);
        r.class = classify({
          soldQty: r.soldQty, adu: r.adu, soldDays: r.soldDays, fastThreshold: catThreshold.get(r.category) ?? fastThreshold, settings, historyDays, ageDays: r.ageDays, outDays: r.outDays,
          effectiveDays: Math.min(effectiveDays, r.liveDays || effectiveDays),
          daysSinceSale: r.daysSinceSale ?? Infinity,
        });
        // Only an item with a rate to go by gets a figure: dead stock, an item
        // that could not sell, and one too new to judge get none.
        r.recommend = (r.class === 'fast' || r.class === 'slow')
          ? recommendBuy({ adu: r.adu, available: r.available, onOrder: r.onOrder, settings, whole: r.whole }) : 0;
        r.daysOfStock = r.adu > 0 ? r2(r.available / r.adu) : null;
        r.runOut = runOut({ daysLeft: r.daysOfStock, available: r.available, adu: r.adu, settings });
        r.adu = r.whole ? r2(r.adu) : r3(r.adu);
        r.tiedUp = r2(Math.max(0, r.stock) * r.perUnit * r.unitCost);
        delete r.ageDays; delete r.unitCost; delete r.perUnit; delete r.liveDays; delete r.whole;
      }
      const ORDER = { fast: 0, slow: 1, dead: 2, unavailable: 3, new: 4 };
      rows.sort((a, b) => ORDER[a.class] - ORDER[b.class] || b.adu - a.adu || b.tiedUp - a.tiedUp || a.itemName.localeCompare(b.itemName));
      const counts = Object.fromEntries(Object.keys(ORDER).map(c => [c, rows.filter(r => r.class === c).length]));

      return {
        start: startKey, end: endKey, businessType: BUSINESS_TYPE, timezone: businessTimeZone(),
        windowDays: r2(windowDays), effectiveDays: r2(effectiveDays), historyDays: r2(historyDays),
        settings, fastThreshold: IS_LOG ? r2(fastThreshold) : r3(fastThreshold), counts,
        wholeUnits: IS_LOG, rows,
        // How the figures were worked out, for the screen to say so.
        basis: {
          perDay: 'Sold in the period / days in the period the item existed and had stock',
          buy: `Per day x (${settings.coverDays} cover + ${settings.leadTimeDays} delivery) + ${settings.safetyDays} days safety stock, less free stock and open purchase orders`,
          reserved: 'Stock held for client orders is not counted as free',
        },
      };
  }
  ctx.computeStockMovement = computeMovement;

  app.get('/api/analytics/stock-movement', verifyToken, requireStaff, requirePermission('analytics.view'), async (req, res) => {
    try {
      const out = await computeMovement(req, req.query);
      if (out.error) return res.status(out.status).json({ success: false, error: out.error });
      // baseUnits is for the Suggested PO only.
      res.json({ success: true, ...out, rows: out.rows.map(({ baseUnits, ...r }) => r) });
    } catch (err) { fail(req, res, err); }
  });
}
