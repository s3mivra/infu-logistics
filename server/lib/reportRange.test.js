import { describe, it, expect } from 'vitest';
import { validateDateRange, DEFAULT_MAX_RANGE_DAYS } from './reportRange.js';

describe('reportRange.validateDateRange', () => {
  it('rejects a missing start or end', () => {
    expect(validateDateRange(undefined, '2026-01-31').ok).toBe(false);
    expect(validateDateRange('2026-01-01', undefined).ok).toBe(false);
    expect(validateDateRange('', '').ok).toBe(false);
  });

  it('rejects unparseable dates', () => {
    expect(validateDateRange('not-a-date', '2026-01-31').ok).toBe(false);
  });

  it('rejects end before start', () => {
    expect(validateDateRange('2026-02-01', '2026-01-01').ok).toBe(false);
  });

  it('accepts a one-month range and includes the whole end day', () => {
    const r = validateDateRange('2026-01-01', '2026-01-31');
    expect(r.ok).toBe(true);
    expect(r.endDate.getHours()).toBe(23);
    expect(r.endDate.getMinutes()).toBe(59);
  });

  it('accepts a full quarter (~92 days)', () => {
    expect(validateDateRange('2026-07-01', '2026-09-30').ok).toBe(true);
  });

  it('rejects a range longer than the cap', () => {
    const r = validateDateRange('2026-01-01', '2026-12-31');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large/i);
  });

  it('honors a custom maxDays', () => {
    expect(validateDateRange('2026-01-01', '2026-01-10', 5).ok).toBe(false);
    expect(validateDateRange('2026-01-01', '2026-01-04', 5).ok).toBe(true);
  });

  it('exposes a sane default cap', () => {
    expect(DEFAULT_MAX_RANGE_DAYS).toBe(92);
  });
});

describe('day boundaries use one consistent (local) basis', () => {
  // Regression: start was parsed as UTC midnight while the end used local
  // setHours, so in UTC+8 a one-day report actually covered local 08:00–23:59
  // and silently dropped every sale made between midnight and 8am.
  it('starts at local midnight, not UTC midnight', () => {
    const { startDate } = validateDateRange('2026-07-26', '2026-07-26');
    expect(startDate.getHours()).toBe(0);
    expect(startDate.getMinutes()).toBe(0);
    expect(startDate.getDate()).toBe(26);
  });

  it('ends at local end-of-day on the same calendar date', () => {
    const { endDate } = validateDateRange('2026-07-26', '2026-07-26');
    expect(endDate.getHours()).toBe(23);
    expect(endDate.getMinutes()).toBe(59);
    expect(endDate.getDate()).toBe(26);
  });

  it('a single-day range spans a full 24 hours', () => {
    const { startDate, endDate } = validateDateRange('2026-07-26', '2026-07-26');
    const hours = (endDate.getTime() - startDate.getTime()) / 3600000;
    expect(hours).toBeGreaterThan(23.99);   // was ~15.99 before the fix
  });

  it('includes an order timestamped just after local midnight', () => {
    const { startDate, endDate } = validateDateRange('2026-07-26', '2026-07-26');
    const justAfterMidnight = new Date(2026, 6, 26, 0, 30, 0);
    expect(justAfterMidnight >= startDate && justAfterMidnight <= endDate).toBe(true);
  });
});
