import { describe, it, expect } from 'vitest';
import { budgetRow, budgetAvailability, slipCharges, naturalAmount } from './budget.js';

describe('budget vs actual', () => {
  it('an expense over budget is unfavourable, revenue over budget is favourable', () => {
    expect(budgetRow({ accountCode: '630000', type: 'expense', budget: 20000, actual: 23000 })).toMatchObject({ variance: 3000, over: true, favourable: false, usedPct: 115 });
    expect(budgetRow({ accountCode: '410000', type: 'revenue', budget: 100000, actual: 120000 })).toMatchObject({ variance: 20000, over: false, favourable: true });
  });
  it('reads income and spending in their natural sign', () => {
    expect(naturalAmount('revenue', 100, 900)).toBe(800);
    expect(naturalAmount('expense', 900, 100)).toBe(800);
  });
});

describe('budget availability for a request', () => {
  it('counts what was spent and what is already asked for', () => {
    expect(budgetAvailability({ budget: 10000, spent: 6000, committed: 3000, requested: 1500 })).toMatchObject({ available: 1000, over: true });
    expect(budgetAvailability({ budget: 10000, spent: 6000, committed: 3000, requested: 1000 })).toMatchObject({ over: false });
  });
  it('no budget set means nothing to check against', () => {
    expect(budgetAvailability({ budget: null, requested: 999 })).toEqual({ hasBudget: false, over: false });
  });
});

describe('what a requisition slip charges', () => {
  it('petty cash charges its category; a purchase charges each line where it lands', () => {
    expect(slipCharges({ type: 'petty-cash', categoryCode: '650000', amount: 800 })).toEqual([{ accountCode: '650000', amount: 800 }]);
    expect(slipCharges({ type: 'procurement', lines: [
      { purchaseType: 'inventory', orderedQty: 10, unitCost: 50 },
      { purchaseType: 'expense', expenseAccountCode: '680000', orderedQty: 1, unitCost: 1200 },
      { purchaseType: 'inventory', orderedQty: 2, unitCost: 25 },
    ] })).toEqual([{ accountCode: '130000', amount: 550 }, { accountCode: '680000', amount: 1200 }]);
  });
});
