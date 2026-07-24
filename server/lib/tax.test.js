import { describe, it, expect } from 'vitest';
import { computePercentageTax, PERCENTAGE_TAX_RATE } from './tax.js';

describe('tax.computePercentageTax', () => {
  it('taxes the NET collected amount at 3% (no-discount case)', () => {
    const r = computePercentageTax({ netCollected: 1000, discounts: 0 });
    expect(r.grossSales).toBe(1000);
    expect(r.discounts).toBe(0);
    expect(r.netCollected).toBe(1000);
    expect(r.taxDue).toBe(30);
    expect(r.rate).toBe(PERCENTAGE_TAX_RATE);
  });

  it('discounted-order case: base is net collected, discount shown so it reconciles', () => {
    // Gross sales 1000, ₱100 discount → customer paid 900. Tax = 3% of 900 = 27.
    const r = computePercentageTax({ netCollected: 900, discounts: 100 });
    expect(r.grossSales).toBe(1000);       // derived: net + discounts
    expect(r.discounts).toBe(100);
    expect(r.netCollected).toBe(900);
    expect(r.taxDue).toBe(27);
    // reconciliation: gross − discounts === net collected (the base)
    expect(+(r.grossSales - r.discounts).toFixed(2)).toBe(r.netCollected);
  });

  it('returns all zeros for an empty period', () => {
    const r = computePercentageTax({ netCollected: 0, discounts: 0 });
    expect(r).toMatchObject({ grossSales: 0, discounts: 0, netCollected: 0, taxDue: 0 });
  });

  it('rounds tax to two decimals', () => {
    const r = computePercentageTax({ netCollected: 33.33, discounts: 0 });
    expect(r.taxDue).toBe(1); // 33.33 * 0.03 = 0.9999 → 1.00
  });

  it('handles missing/garbage input safely', () => {
    expect(computePercentageTax().taxDue).toBe(0);
    expect(computePercentageTax({}).netCollected).toBe(0);
  });
});
