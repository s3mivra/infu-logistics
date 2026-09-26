// What day it is, according to the business.
//
// `new Date().toISOString().slice(0, 10)` is the UTC date, and a shop is not in
// UTC. In Manila (UTC+8) the two disagree for the first eight hours of every
// day, which is exactly when a bar is closing up: at 1am the report pickers
// defaulted to YESTERDAY, so the night's sales were missing from every total,
// and an expense typed in at that hour was filed under the previous day and
// went into the books that way.
//
// The server already settled this: businessTime.js cuts every range in the
// business's own zone. This is the same idea on the client, so the date a
// screen sends and the date the server reads mean the same day.
//
// The zone comes from the businessTimeZone setting as soon as settings load.
// Before that - and it is only the first moment of a session - the device's own
// zone is used, which is the shop's zone on the shop's own tablet and is never
// a whole day out the way UTC is.
let businessTz = '';

export function setClientBusinessTz(tz) {
  businessTz = typeof tz === 'string' ? tz.trim() : '';
}

export function clientBusinessTz() {
  return businessTz;
}

// One formatter per zone, kept. Building an Intl.DateTimeFormat is the
// expensive part - about 45 times the cost of using one - and the dashboard
// asks for today's date some forty times on every redraw. Building a fresh one
// each time added a few milliseconds to every keystroke at the till on a
// desktop, and several times that on a tablet.
let cachedFormatter = null;
let cachedFor = null;
function formatterFor(tz) {
  if (cachedFormatter && cachedFor === tz) return cachedFormatter;
  cachedFormatter = new Intl.DateTimeFormat('en-CA', {
    ...(tz ? { timeZone: tz } : {}),
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  cachedFor = tz;
  return cachedFormatter;
}

// 'YYYY-MM-DD' for an instant, in the business's zone. en-CA formats exactly
// that way, and formatToParts is used rather than the formatted string so a
// locale that would reorder the parts cannot produce a date the server refuses.
export function dateStr(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = formatterFor(businessTz)
      .formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
  } catch { /* an unknown zone falls through to the device's own clock */ }
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr() {
  return dateStr(new Date());
}

// The first day of the current month, and of the current year. Built from the
// business's own date rather than from a local Date object: constructing
// `new Date(year, month, 1)` and then taking its UTC date gave the LAST day of
// the previous month in any zone ahead of UTC, so every "this month" report
// quietly began a day early.
export function monthStartStr() {
  return `${todayStr().slice(0, 7)}-01`;
}

export function yearStartStr() {
  return `${todayStr().slice(0, 4)}-01-01`;
}

// N days ago, on the business's calendar. Used for the rolling ranges a report
// screen offers ("last 30 days").
export function daysAgoStr(days) {
  return dateStr(new Date(Date.now() - (Number(days) || 0) * 86400000));
}

// One-click report ranges ("Today", "Last 7 days", "Last month"...). Worked out
// on the business's own calendar date as plain Y-M-D arithmetic - no local
// Date objects - for the same reason as monthStartStr above.
const ymd = (s) => s.split('-').map(Number);
const fmt = (d) => d.toISOString().slice(0, 10);          // a UTC-midnight Date back to Y-M-D
const shift = (s, days) => { const [y, m, d] = ymd(s); return fmt(new Date(Date.UTC(y, m - 1, d + days))); };

export const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'thisQuarter', label: 'This quarter' },
  { key: 'thisYear', label: 'This year' },
  { key: 'lastYear', label: 'Last year' },
];

// -> { start, end } for a preset key, as of `today` (defaults to the business's today).
export function presetRange(key, today = todayStr()) {
  const [y, m] = ymd(today);
  const pad = (n) => String(n).padStart(2, '0');
  switch (key) {
    case 'today': return { start: today, end: today };
    case 'yesterday': { const d = shift(today, -1); return { start: d, end: d }; }
    case '7d': return { start: shift(today, -6), end: today };
    case '30d': return { start: shift(today, -29), end: today };
    case 'thisMonth': return { start: `${y}-${pad(m)}-01`, end: today };
    case 'lastMonth': {
      const firstThis = `${y}-${pad(m)}-01`;
      const end = shift(firstThis, -1);
      return { start: `${end.slice(0, 7)}-01`, end };
    }
    case 'thisQuarter': return { start: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, end: today };
    case 'thisYear': return { start: `${y}-01-01`, end: today };
    case 'lastYear': return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
    default: return null;
  }
}

// Which preset a range is, if any - so the matching button shows as selected.
export function matchPreset(range, today = todayStr()) {
  if (!range?.start || !range?.end) return null;
  const hit = RANGE_PRESETS.find(p => { const r = presetRange(p.key, today); return r.start === range.start && r.end === range.end; });
  return hit ? hit.key : null;
}
