import { businessTimeZone } from './businessTime.js';
// Time-boxed sale pricing, in one place.
//
// The catalogue shows a product's sale price (products.js) and the order route
// charges it (orders.js). Both must read the same rules the same way, or a
// customer is shown one price and charged another.
//
// fixed_price  - the product sells at salePrice during the window
// percent_off  - basePrice less discountPercent, unless a fixed price also applies
// threshold    - order-level, not a unit price; returned separately
//
// A sale can also keep hours inside its dates: only on some weekdays, only
// between two times of day ("happy hour, weekdays 2 to 5"). That is decided
// here too, on the business's own clock - so the price shown on the menu and
// the price charged at the till switch on and off at the same moment.

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes = (hhmm) => { const m = HHMM.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// The weekday (0 = Sunday) and minutes past midnight, on the business's clock.
export function businessClock(now = new Date(), timeZone = businessTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

// Is this sale on at this moment? A sale with no weekdays and no hours is on
// for the whole of its dates, as every sale was before these existed. Hours
// that run past midnight (22:00 to 02:00) belong to the day they started on.
export function saleRunsNow(sale, now = new Date(), timeZone = businessTimeZone()) {
  const days = Array.isArray(sale?.daysOfWeek) ? sale.daysOfWeek.map(Number).filter(d => d >= 0 && d <= 6) : [];
  const from = minutes(sale?.dailyFrom), to = minutes(sale?.dailyTo);
  const hasHours = from !== null && to !== null && from !== to;
  if (!days.length && !hasHours) return true;
  const clock = businessClock(now, timeZone);
  const yesterday = (clock.weekday + 6) % 7;
  const onDay = (d) => !days.length || days.includes(d);
  if (!hasHours) return onDay(clock.weekday);
  if (from < to) return onDay(clock.weekday) && clock.minutes >= from && clock.minutes < to;
  // Overnight: tonight's part counts for today, the small hours for yesterday.
  return (onDay(clock.weekday) && clock.minutes >= from) || (onDay(yesterday) && clock.minutes < to);
}

// What may be saved as a sale's hours. -> { daysOfWeek, dailyFrom, dailyTo } or { error }
export function cleanSaleHours(body = {}) {
  const days = [...new Set((Array.isArray(body.daysOfWeek) ? body.daysOfWeek : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const from = String(body.dailyFrom || '').trim(), to = String(body.dailyTo || '').trim();
  if ((from && !to) || (to && !from)) return { error: 'Give both a start time and an end time, or neither.' };
  if (from && (!HHMM.test(from) || !HHMM.test(to))) return { error: 'Times must be written as HH:MM, for example 14:00.' };
  if (from && from === to) return { error: 'The start and end time cannot be the same.' };
  return { daysOfWeek: days.length === 7 ? [] : days, dailyFrom: from, dailyTo: to };
}

export function buildSalePriceMap(activeSales = [], now = new Date()) {
  const map = {};              // productId -> { salePrice, salePercent, saleName }
  const thresholdRules = [];
  for (const sale of activeSales) {
    if (!saleRunsNow(sale, now)) continue;
    for (const rule of (sale.rules || [])) {
      if (rule.ruleType === 'threshold') {
        thresholdRules.push({ saleName: sale.name, productId: rule.productId, productName: rule.productName, thresholdAmount: rule.thresholdAmount, discountPercent: rule.discountPercent });
      } else if (rule.productId) {
        const pid = String(rule.productId);
        const existing = map[pid];
        // Last sale wins if multiple overlap.
        if (rule.ruleType === 'fixed_price') {
          map[pid] = { salePrice: rule.salePrice, saleName: sale.name, salePercent: null };
        } else if (rule.ruleType === 'percent_off' && !existing?.salePrice) {
          map[pid] = { salePercent: rule.discountPercent, saleName: sale.name, salePrice: null };
        }
      }
    }
  }
  return { map, thresholdRules };
}

// The unit price a product sells at right now, before any client discount.
export function saleUnitPrice(product, overlay) {
  if (!overlay) return null;
  if (overlay.salePrice != null) return Number(overlay.salePrice);
  if (overlay.salePercent != null) return +(Number(product.basePrice || 0) * (1 - overlay.salePercent / 100)).toFixed(2);
  return null;
}

export const activeSalesQuery = (now = new Date()) => ({ isActive: true, startsAt: { $lte: now }, endsAt: { $gte: now } });
