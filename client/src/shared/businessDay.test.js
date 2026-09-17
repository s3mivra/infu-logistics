// The date a screen sends has to mean the same day the server reads.
//
// Every date picker used to default to `new Date().toISOString().slice(0, 10)`,
// which is the UTC date. A shop in Manila is eight hours ahead, so for the
// first eight hours of every day the two are different days: at 1am the report
// ranges ended YESTERDAY and the night's sales were missing from them, and an
// expense typed in at that hour was filed under the previous day.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  dateStr, todayStr, monthStartStr, yearStartStr, daysAgoStr,
  setClientBusinessTz, clientBusinessTz,
} from './businessDay.js';

// 00:40 on the 18th in Manila. In UTC it is still the 17th.
const MANILA_EARLY_MORNING = new Date('2026-09-17T16:40:00.000Z');

beforeEach(() => setClientBusinessTz(''));

describe('the business day, in the business zone', () => {
  it('names the day the shop is in, not the day UTC is in', () => {
    setClientBusinessTz('Asia/Manila');
    expect(dateStr(MANILA_EARLY_MORNING)).toBe('2026-09-18');
    // The old way, for contrast: this is the bug in one line.
    expect(MANILA_EARLY_MORNING.toISOString().slice(0, 10)).toBe('2026-09-17');
  });

  it('follows the zone it is given', () => {
    setClientBusinessTz('UTC');
    expect(dateStr(MANILA_EARLY_MORNING)).toBe('2026-09-17');
    setClientBusinessTz('America/New_York');   // 12:40 on the 17th
    expect(dateStr(MANILA_EARLY_MORNING)).toBe('2026-09-17');
    setClientBusinessTz('Pacific/Kiritimati'); // already the 18th, +14
    expect(dateStr(MANILA_EARLY_MORNING)).toBe('2026-09-18');
  });

  it('falls back to the device clock before the setting has loaded', () => {
    // Not UTC: the shop's own tablet is set to the shop's own zone, which is
    // never a whole day out the way UTC is.
    const d = new Date(2026, 8, 18, 0, 40);          // local 18 Sept, 00:40
    expect(clientBusinessTz()).toBe('');
    expect(dateStr(d)).toBe('2026-09-18');
  });

  it('ignores a zone it does not recognise rather than throwing', () => {
    setClientBusinessTz('Not/AZone');
    const d = new Date(2026, 8, 18, 12, 0);
    expect(dateStr(d)).toBe('2026-09-18');
  });

  it('gives an empty string for a date that is not one', () => {
    expect(dateStr(new Date('nonsense'))).toBe('');
  });
});

describe('the ranges a report screen offers', () => {
  beforeEach(() => setClientBusinessTz('Asia/Manila'));

  it('starts the month on the first, not on the last day of the one before', () => {
    // `new Date(y, m, 1).toISOString()` gave the previous month's last day in
    // any zone ahead of UTC, so every "this month" report began a day early.
    expect(monthStartStr()).toBe(`${todayStr().slice(0, 7)}-01`);
    expect(monthStartStr().endsWith('-01')).toBe(true);
  });

  it('starts the year on the first of January', () => {
    expect(yearStartStr()).toBe(`${todayStr().slice(0, 4)}-01-01`);
  });

  it('counts back whole days on the business calendar', () => {
    expect(daysAgoStr(0)).toBe(todayStr());
    expect(daysAgoStr(1) < todayStr()).toBe(true);
  });

  it('is a plain YYYY-MM-DD, which is what the server parses', () => {
    for (const s of [todayStr(), monthStartStr(), yearStartStr(), daysAgoStr(30)]) {
      expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
