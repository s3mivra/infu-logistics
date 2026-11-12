// 2026-11 audit, M108: edge cases in the shared money and date helpers.
import { describe, it, expect } from 'vitest';
import { computePercentageTax } from './tax.js';
import { businessDayStart, businessDayEnd } from './businessTime.js';
import { computeLine, readRules } from './payrollCalc.js';
import { resolveEffectiveDiscountPercent } from './discounts.js';
import { parseMenuSheet } from './menuSheet.js';

describe('percentage tax', () => {
  it('rounds the way the ledger does (1.005 -> 1.01)', () => {
    expect(computePercentageTax({ netCollected: 1.005 }).netCollected).toBe(1.01);
  });
  it('a month of net refunds owes nothing, and says why', () => {
    const t = computePercentageTax({ netCollected: -100 });
    expect(t.taxDue).toBe(0);
    expect(t.negativeBase).toBe(true);
  });
});

describe('business days', () => {
  it('an impossible calendar date is invalid, not the next real one', () => {
    expect(Number.isNaN(businessDayEnd('2026-02-30').getTime())).toBe(true);
    expect(Number.isNaN(businessDayStart('2026-13-01').getTime())).toBe(true);
  });
  it('a real date still works, leap day included', () => {
    expect(Number.isNaN(businessDayStart('2028-02-29').getTime())).toBe(false);
  });
});

describe('payroll inputs', () => {
  const base = { earnings: { basic: 10000 }, dailyRate: 800, skipContributions: true };
  it('negative deductions and absences cannot raise net pay', () => {
    const plain = computeLine(base);
    const gamed = computeLine({ ...base, otherDeductions: -5000, absentDays: -10, overrides: { withholdingTax: -3000 } });
    expect(gamed.netPay).toBeLessThanOrEqual(plain.netPay);
    expect(gamed.otherDeductions).toBe(0);
    expect(gamed.absenceDeduction).toBe(0);
    expect(gamed.withholdingTax).toBe(0);
  });
  it('rules refuse a nonsense multiplier and drop unknown keys', () => {
    expect(readRules({ overtimeMultiplier: 'x' }).error).toMatch(/Overtime/);
    expect(readRules({ hoursPerDay: 0 }).error).toMatch(/Hours per day/);
    const ok = readRules({ overtimeMultiplier: 1.3, sneaky: true });
    expect(ok.rules.overtimeMultiplier).toBe(1.3);
    expect(ok.rules).not.toHaveProperty('sneaky');
  });
});

describe('segment discounts', () => {
  it('match the client\'s tag whatever its case', () => {
    const product = { segmentDiscounts: [{ segment: 'Dealer', percent: 10 }] };
    expect(resolveEffectiveDiscountPercent(product, { buyerSegments: ['dealer'] })).toBe(10);
  });
});

describe('menu sheet prices', () => {
  // Name, size, then ingredient pairs, with the price in column 14.
  const sheet = (price) => { const r = Array(15).fill(''); r[0] = 'Latte'; r[1] = '8oz Hot'; r[14] = price; return [r]; };
  const kinds = (rows) => parseMenuSheet(rows)[0].problems.map((x) => x.kind);
  it('a blank price is a problem, not P0', () => {
    expect(kinds(sheet('  '))).toContain('missing-price');
  });
  it('a negative price is a problem', () => {
    expect(kinds(sheet(-5))).toContain('negative-price');
  });
  it('a real price is not', () => {
    expect(kinds(sheet(120))).toEqual([]);
  });
});
