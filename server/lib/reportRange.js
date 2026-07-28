// Pure date-range validation for bounded report exports. No DB. Unit-testable.
//
// Large exports (e.g. the full journal) must be bounded so a single request can't pull
// the entire ledger into memory. Callers pass start/end query strings; this returns the
// parsed Date bounds or a human error. Default cap is one quarter (92 days — the longest
// calendar quarter is 92 days), tunable per call.

export const DEFAULT_MAX_RANGE_DAYS = 92;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Parse a report date to the START of that day in the SERVER'S LOCAL timezone.
//
// WHY this exists: `new Date('2026-07-26')` is parsed by JS as UTC midnight,
// but `.setHours()` operates in local time. Mixing the two gave a window of
// local 08:00 → 23:59 in UTC+8 — so a "today" report silently dropped every
// sale made between midnight and 8am, and the business never saw them in any
// day's report. Both bounds must share one basis; local is the correct one,
// because a shop's "day" is its own wall clock.
//
// A plain YYYY-MM-DD is built component-wise (local). Anything richer (a full
// ISO timestamp) is passed through to Date, which already carries its own zone.
function parseDayStart(value) {
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return new Date(s);
}

export function validateDateRange(start, end, maxDays = DEFAULT_MAX_RANGE_DAYS) {
  if (!start || !end) {
    return { ok: false, error: 'A start and end date are both required.' };
  }
  const startDate = parseDayStart(start);
  const endDate = parseDayStart(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { ok: false, error: 'Invalid date range.' };
  }
  // Include the whole end day, in the same (local) basis as the start.
  endDate.setHours(23, 59, 59, 999);
  if (endDate.getTime() < startDate.getTime()) {
    return { ok: false, error: 'End date must be on or after the start date.' };
  }
  const spanDays = (endDate.getTime() - startDate.getTime()) / MS_PER_DAY;
  if (spanDays > maxDays) {
    return { ok: false, error: `Date range too large (max ${maxDays} days). Export in smaller chunks.` };
  }
  return { ok: true, startDate, endDate };
}

// Day-boundary helpers for the many routes that filter `createdAt` by a
// YYYY-MM-DD query string. Exported so every report shares ONE definition of
// "a day" — the inline `new Date(start)` / `d.setHours(23,59,59)` pairs each
// re-introduced the UTC-vs-local mismatch described above.
export function dayStart(value) { return parseDayStart(value); }
export function dayEnd(value) {
  const d = parseDayStart(value);
  d.setHours(23, 59, 59, 999);
  return d;
}
