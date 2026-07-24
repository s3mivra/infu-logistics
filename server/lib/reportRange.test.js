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
