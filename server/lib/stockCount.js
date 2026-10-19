// Stock counts: the record of every count, the rolling count list, and the
// variance arithmetic.
//
// Every count goes through the one counting route (POST /api/inventory/count),
// whether it is the whole shop at end of day or today's handful of items from
// the rolling list. That route has always adjusted the stock and booked the
// difference; it now also keeps one StockCount row per item counted - zero
// variance included, because "counted and right" is worth knowing - so the
// variance report can say what was expected, what was found, and who found it.
//
// Rolling counts: instead of counting everything at once, a few items a day,
// each as often as it matters. Fast movers drift fastest and are counted
// weekly, slow movers monthly, dead stock quarterly (Analytics -> Stock
// movement decides the class; the intervals are settings). An item that went
// below zero is always on the list - a count is what fixes it.
//
// Quantities are base units (g, ml, pcs), like every stock figure on the server.

export const COUNT_CYCLE_KEY = 'countCycle';
export const COUNT_CYCLE_DEFAULTS = {
  fastDays: 7,      // fast movers: weekly
  slowDays: 30,     // slow movers: monthly
  deadDays: 90,     // dead stock: quarterly
  otherDays: 30,    // too new to judge, or could not sell (out of stock)
  maxPerDay: 20,    // the most items on one day's list (below-zero items come on top)
};
export const COUNT_CYCLE_LIMITS = { fastDays: [1, 90], slowDays: [1, 180], deadDays: [1, 365], otherDays: [1, 365], maxPerDay: [1, 500] };

export function cleanCountCycle(v = {}) {
  const out = {};
  for (const [k, def] of Object.entries(COUNT_CYCLE_DEFAULTS)) {
    const n = Math.round(Number(v?.[k]));
    const [lo, hi] = COUNT_CYCLE_LIMITS[k];
    out[k] = Number.isFinite(n) && n >= lo && n <= hi ? n : def;
  }
  return out;
}

export const intervalFor = (cls, cycle) => (
  cls === 'fast' ? cycle.fastDays : cls === 'slow' ? cycle.slowDays : cls === 'dead' ? cycle.deadDays : cycle.otherDays
);

const DAY = 86400000;
const CLASS_ORDER = { fast: 0, slow: 1, dead: 2, unavailable: 3, new: 4 };

// Today's list. `items`: [{ _id, itemName, stockQty, class }] (class from the
// stock movement report); `lastCounted`: Map(invId -> Date). An item is due
// when its interval has passed since it was last counted (never counted = due).
// Most overdue first - measured against its own interval, so a fast mover a
// week late outranks a dead item a week late - capped at maxPerDay, with every
// below-zero item on top of the cap.
export function selectCountList({ items = [], lastCounted = new Map(), cycle = COUNT_CYCLE_DEFAULTS, now = new Date() }) {
  const rows = [];
  for (const i of items) {
    const key = String(i._id);
    const interval = intervalFor(i.class, cycle);
    const last = lastCounted.get(key) || null;
    const daysSince = last ? Math.floor((now.getTime() - new Date(last).getTime()) / DAY) : null;
    const belowZero = Number(i.stockQty) < -1e-9;
    const due = belowZero || daysSince === null || daysSince >= interval;
    if (!due) continue;
    rows.push({
      ...i, _id: key, intervalDays: interval, lastCountedAt: last, daysSince, belowZero,
      // How far past its interval: never counted ranks as very overdue.
      overdue: daysSince === null ? Infinity : daysSince / interval,
      reason: belowZero ? 'Below zero' : daysSince === null ? 'Never counted' : `Last counted ${daysSince} day(s) ago (every ${interval})`,
    });
  }
  rows.sort((a, b) => (b.belowZero - a.belowZero) || (b.overdue - a.overdue)
    || ((CLASS_ORDER[a.class] ?? 9) - (CLASS_ORDER[b.class] ?? 9)) || String(a.itemName).localeCompare(String(b.itemName)));
  const negatives = rows.filter(r => r.belowZero);
  const rest = rows.filter(r => !r.belowZero).slice(0, Math.max(0, cycle.maxPerDay - negatives.length));
  return { list: [...negatives, ...rest].map(({ overdue: _overdue, ...r }) => r), dueTotal: rows.length };
}

// One counted item: what the books said, what was found, the difference in
// units and in pesos at the item's cost when it was counted.
export function varianceLine({ expectedQty, countedQty, unitCost }) {
  const expected = +(Number(expectedQty) || 0).toFixed(6);
  const counted = +(Number(countedQty) || 0).toFixed(6);
  const variance = +(counted - expected).toFixed(6);
  const cost = Number(unitCost) || 0;
  return { expectedQty: expected, countedQty: counted, variance, unitCost: cost, varianceValue: Math.round(variance * cost * 100) / 100 };
}

// Totals for a set of count rows: shortage and overage kept apart so they do
// not cancel out into a reassuring zero.
export function varianceTotals(rows = []) {
  let shortValue = 0, overValue = 0, withVariance = 0;
  for (const r of rows) {
    const v = Number(r.varianceValue) || 0;
    if (Math.abs(Number(r.variance) || 0) > 1e-9) withVariance += 1;
    if (v < 0) shortValue += v; else overValue += v;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return { counted: rows.length, withVariance, shortValue: r2(shortValue), overValue: r2(overValue), netValue: r2(shortValue + overValue) };
}

export function stockCountModel(mongoose) {
  if (mongoose.models.StockCount) return mongoose.models.StockCount;
  const schema = new mongoose.Schema({
    businessType: { type: String, index: true },
    date: { type: Date, default: Date.now },
    dateString: String,           // the business day it was counted (YYYY-MM-DD)
    inventoryId: String,
    itemName: String,
    itemCode: String,
    unit: String,                 // base unit
    expectedQty: Number,          // what the books said, base units
    countedQty: Number,           // what was found
    variance: Number,             // counted - expected
    unitCost: Number,             // cost per base unit when counted
    varianceValue: Number,        // variance x unitCost, pesos
    countedBy: String,
    reason: String,
    kind: { type: String, enum: ['eod', 'rolling'], default: 'eod' },
    reference: String,            // the EOD-ADJ stock-card reference, when stock moved
  });
  schema.index({ inventoryId: 1, date: -1 });
  schema.index({ date: -1 });
  return mongoose.model('StockCount', schema);
}
