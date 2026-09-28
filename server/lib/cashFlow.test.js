import { describe, it, expect } from 'vitest';
import { buildCashFlow, classify, isCashCode } from './cashFlow.js';

const je = (...lines) => ({ lines: lines.map(([accountCode, debit, credit]) => ({ accountCode, debit, credit })) });

describe('cash flow statement (direct method)', () => {
  it('classifies the other side of each cash movement', () => {
    const r = buildCashFlow({
      openingCash: 1000,
      entries: [
        je(['111000', 500, 0], ['410000', 0, 500]),                 // cash sale
        je(['112000', 300, 0], ['120000', 0, 300]),                 // customer paid on account
        je(['220000', 200, 0], ['112000', 0, 200]),                 // paid a supplier
        je(['140200', 1000, 0], ['112000', 0, 1000]),               // bought equipment
        je(['112000', 5000, 0], ['250100', 0, 5000]),               // bank loan
        je(['112000', 400, 0], ['111000', 0, 400]),                 // deposit - cash to bank
        je(['630000', 150, 0], ['111000', 0, 150]),                 // rent
      ],
    });
    const find = (k) => r.sections.find(s => s.key === k);
    expect(find('operating').lines.find(l => l.label === 'Received from customers').inflow).toBe(800);
    expect(find('operating').lines.find(l => l.label === 'Paid to suppliers').outflow).toBe(200);
    expect(find('operating').net).toBe(450);
    expect(find('investing').net).toBe(-1000);
    expect(find('financing').net).toBe(5000);
    expect(r.netChange).toBe(4450);
    expect(r.netFromEntries).toBe(4450);
    expect(r.closingCash).toBe(5450);
  });
  it('splits one payment across several accounts the way the entry does', () => {
    // Paid a bill: 1000 of it is the payable, 20 of it a bank charge.
    const r = buildCashFlow({ entries: [je(['220000', 1000, 0], ['720000', 20, 0], ['112000', 0, 1020])] });
    const op = r.sections[0];
    expect(op.lines.find(l => l.label === 'Paid to suppliers').outflow).toBe(1000);
    expect(op.lines.find(l => l.label === 'Operating expenses paid').outflow).toBe(20);
    expect(r.netChange).toBe(-1020);
  });
  it('knows which accounts are cash', () => {
    expect(['111000', '112100', '113000', '114000', '115000'].every(isCashCode)).toBe(true);
    expect(isCashCode('120000')).toBe(false);
    expect(classify('310000')[0]).toBe('financing');
  });
});
