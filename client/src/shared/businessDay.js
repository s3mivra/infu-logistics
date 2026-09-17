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

// 'YYYY-MM-DD' for an instant, in the business's zone. en-CA formats exactly
// that way, and formatToParts is used rather than the formatted string so a
// locale that would reorder the parts cannot produce a date the server refuses.
export function dateStr(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      ...(businessTz ? { timeZone: businessTz } : {}),
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
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
