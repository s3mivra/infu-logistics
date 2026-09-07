// Straight-line depreciation. The two rules worth breaking a test over:
// accumulated depreciation must never exceed cost minus salvage, and net book
// value must never fall below salvage. Both failures produce a balance sheet
// that looks perfectly plausible and is wrong - a fully written-down machine
// that keeps reducing profit every month is the classic symptom.
import { describe, it, expect } from 'vitest';
import {
  depreciableBase, monthlyDepreciation, netBookValue, depreciatedFraction,
  monthsBetween, depreciationDue, applyDepreciation, disposalResult, schedule,
} from './depreciation.js';

// A P60,000 espresso machine, 5 years, P6,000 salvage: P900/month.
const machine = (over = {}) => ({
  acquisitionCost: 60000, salvageValue: 6000, usefulLifeMonths: 60,
  accumulatedDepreciation: 0, acquisitionDate: new Date(2026, 0, 15),
  status: 'Active', ...over,
});

describe('the depreciable base', () => {
  it('is cost minus salvage', () => {
    expect(depreciableBase(machine())).toBe(54000);
  });

  it('treats salvage above cost as nothing to depreciate, not an appreciation', () => {
    expect(depreciableBase({ acquisitionCost: 1000, salvageValue: 5000 })).toBe(0);
  });

  it('ignores a negative salvage rather than inflating the base', () => {
    expect(depreciableBase({ acquisitionCost: 1000, salvageValue: -500 })).toBe(1000);
  });
});

describe('the monthly charge', () => {
  it('spreads the base evenly over the life', () => {
    expect(monthlyDepreciation(machine())).toBe(900);
  });

  it('is zero when no useful life is set, rather than dividing by zero', () => {
    expect(monthlyDepreciation({ acquisitionCost: 1000, usefulLifeMonths: 0 })).toBe(0);
    expect(monthlyDepreciation({ acquisitionCost: 1000 })).toBe(0);
  });
});

describe('counting whole months', () => {
  it('counts a month only once its day has come round', () => {
    expect(monthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 14))).toBe(0);
    expect(monthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 15))).toBe(1);
  });

  it('spans years correctly', () => {
    expect(monthsBetween(new Date(2025, 11, 1), new Date(2026, 2, 1))).toBe(3);
  });

  it('never goes negative for a date in the past', () => {
    expect(monthsBetween(new Date(2026, 5, 1), new Date(2026, 0, 1))).toBe(0);
  });
});

describe('what is due', () => {
  it('charges nothing before the first whole month is up', () => {
    const due = depreciationDue(machine(), new Date(2026, 0, 31));
    expect(due.months).toBe(0);
    expect(due.amount).toBe(0);
  });

  it('charges one month after one month', () => {
    const due = depreciationDue(machine(), new Date(2026, 1, 15));
    expect(due).toMatchObject({ months: 1, amount: 900, capped: false });
  });

  it('catches up several missed months in one posting', () => {
    const due = depreciationDue(machine(), new Date(2026, 4, 15));
    expect(due.months).toBe(4);
    expect(due.amount).toBe(3600);
  });

  it('runs from the last posting, not from acquisition', () => {
    const asset = machine({ accumulatedDepreciation: 2700, lastDepreciationDate: new Date(2026, 3, 15) });
    expect(depreciationDue(asset, new Date(2026, 5, 15)).months).toBe(2);
  });

  it('CAPS the final charge at what is left, and says so', () => {
    // 53,700 already written off; only 300 of the 54,000 base remains, but a
    // full month would be 900.
    const nearlyDone = machine({ accumulatedDepreciation: 53700, lastDepreciationDate: new Date(2026, 0, 15) });
    const due = depreciationDue(nearlyDone, new Date(2026, 3, 15));
    expect(due.amount).toBe(300);
    expect(due.capped).toBe(true);
  });

  it('charges nothing once fully depreciated', () => {
    const done = machine({ accumulatedDepreciation: 54000, lastDepreciationDate: new Date(2026, 0, 15) });
    expect(depreciationDue(done, new Date(2030, 0, 1)).amount).toBe(0);
  });

  it('charges nothing on a disposed asset', () => {
    const gone = machine({ status: 'Disposed' });
    expect(depreciationDue(gone, new Date(2030, 0, 1)).amount).toBe(0);
  });
});

describe('applying a charge', () => {
  it('accumulates and moves the last-posted date', () => {
    const after = applyDepreciation(machine(), 900, new Date(2026, 1, 15));
    expect(after.accumulatedDepreciation).toBe(900);
    expect(after.status).toBe('Active');
    expect(after.netBookValue).toBe(59100);
  });

  it('never accumulates past the base, even if asked to', () => {
    // Rule 1, tested directly: an over-large charge must be clipped.
    const after = applyDepreciation(machine(), 999999, new Date(2026, 1, 15));
    expect(after.accumulatedDepreciation).toBe(54000);
    expect(after.status).toBe('Fully Depreciated');
  });

  it('never carries the asset below its salvage value', () => {
    // Rule 2: the floor is salvage, not zero.
    const after = applyDepreciation(machine(), 999999, new Date(2026, 1, 15));
    expect(after.netBookValue).toBe(6000);
    expect(after.netBookValue).toBeGreaterThanOrEqual(6000);
  });

  it('flips to Fully Depreciated exactly at the floor', () => {
    const almost = machine({ accumulatedDepreciation: 53100 });
    expect(applyDepreciation(almost, 900).status).toBe('Fully Depreciated');
    expect(applyDepreciation(almost, 899).status).toBe('Active');
  });
});

describe('net book value and progress', () => {
  it('is cost less accumulated depreciation', () => {
    expect(netBookValue(machine({ accumulatedDepreciation: 10800 }))).toBe(49200);
  });

  it('reports how far through its life the asset is', () => {
    expect(depreciatedFraction(machine({ accumulatedDepreciation: 27000 }))).toBeCloseTo(0.5, 3);
    expect(depreciatedFraction(machine({ accumulatedDepreciation: 54000 }))).toBe(1);
  });

  it('treats an asset with nothing to depreciate as complete', () => {
    expect(depreciatedFraction({ acquisitionCost: 100, salvageValue: 100 })).toBe(1);
  });
});

describe('disposal', () => {
  it('is a gain when it sells for more than it is carried at', () => {
    const asset = machine({ accumulatedDepreciation: 27000 }); // NBV 33,000
    expect(disposalResult(asset, 40000)).toMatchObject({ netBookValue: 33000, gain: 7000, loss: 0 });
  });

  it('is a loss when it sells for less', () => {
    const asset = machine({ accumulatedDepreciation: 27000 });
    expect(disposalResult(asset, 25000)).toMatchObject({ gain: 0, loss: 8000 });
  });

  it('scrapping for nothing writes off the whole carrying value as a loss', () => {
    const asset = machine({ accumulatedDepreciation: 27000 });
    expect(disposalResult(asset, 0).loss).toBe(33000);
  });

  it('is neither when proceeds exactly match the carrying value', () => {
    const asset = machine({ accumulatedDepreciation: 27000 });
    expect(disposalResult(asset, 33000)).toMatchObject({ gain: 0, loss: 0 });
  });
});

describe('the schedule', () => {
  it('walks the asset down month by month', () => {
    const rows = schedule(machine(), 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ charge: 900, accumulated: 900, netBookValue: 59100 });
    expect(rows[2]).toMatchObject({ accumulated: 2700, netBookValue: 57300 });
  });

  it('stops at the floor instead of running past it', () => {
    const nearlyDone = machine({ accumulatedDepreciation: 53500 });
    const rows = schedule(nearlyDone, 12);
    expect(rows).toHaveLength(1);
    expect(rows[0].charge).toBe(500);
    expect(rows[0].netBookValue).toBe(6000);
  });
});
