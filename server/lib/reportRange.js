// Pure date-range validation for bounded report exports. No DB. Unit-testable.
//
// Large exports (e.g. the full journal) must be bounded so a single request can't pull
// the entire ledger into memory. Callers pass start/end query strings; this returns the
// parsed Date bounds or a human error. Default cap is one quarter (92 days - the longest
// calendar quarter is 92 days), tunable per call.

import { businessDayStart, businessDayEnd } from './businessTime.js';

export const DEFAULT_MAX_RANGE_DAYS = 92;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function validateDateRange(start, end, maxDays = DEFAULT_MAX_RANGE_DAYS) {
  if (!start || !end) {
    return { ok: false, error: 'A start and end date are both required.' };
  }
  const startDate = businessDayStart(start);
  const endDate = businessDayEnd(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { ok: false, error: 'Invalid date range.' };
  }
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
// "a day" - the inline `new Date(start)` / `d.setHours(23,59,59)` pairs each
// re-introduced the UTC-vs-local mismatch described above.
export function dayStart(value) { return businessDayStart(value); }
export function dayEnd(value) { return businessDayEnd(value); }
