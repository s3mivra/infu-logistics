import { describe, it, expect } from 'vitest';
import { parseAmount, naturalSide, buildOpeningEntry, buildPnlMonthEntry, readMonths, monthEnd } from './setupBooks.js';

const META = {
  '112000': { name: 'Cash in Bank', type: 'asset' },
  '150200': { name: 'Accum. Dep.', type: 'asset' },
  '220000': { name: 'Accounts Payable', type: 'liability' },
  '310000': { name: "Owner's Capital", type: 'equity' },
  '410000': { name: 'Product Sales', type: 'revenue' },
  '430000': { name: 'Sales Discounts', type: 'contra-revenue' },
  '510000': { name: 'COGS', type: 'expense' },
  '830000': { name: 'Other Income', type: 'other-income' },
};
const meta = (c) => META[c] || null;

describe('reading an amount the way statements write it', () => {
  it.each([
    ['1,061,821', 1061821], ['(29,762)', -29762], [' -   ', 0], ['', 0], ['₱ 20,000', 20000],
    ['-5.5', -5.5], [1234.5, 1234.5], ['(1,015)', -1015], ['PHP 300', 300],
  ])('%s -> %s', (cell, n) => expect(parseAmount(cell)).toBe(n));
  it('refuses what is not a number', () => {
    expect(parseAmount('n/a')).toBeNaN();
    expect(parseAmount('#DIV/0!')).toBeNaN();
  });
});

describe('natural sides', () => {
  it('puts assets and expenses on the debit, the rest on the credit, and flips a negative', () => {
    expect(naturalSide('asset', 100)).toEqual({ debit: 100, credit: 0 });
    expect(naturalSide('asset', -30)).toEqual({ debit: 0, credit: 30 });     // accumulated depreciation
    expect(naturalSide('liability', 50)).toEqual({ debit: 0, credit: 50 });
    expect(naturalSide('contra-revenue', 10)).toEqual({ debit: 10, credit: 0 });
  });
});

describe('an opening balance sheet', () => {
  it('balances to Owner\'s Capital and says by how much', () => {
    const e = buildOpeningEntry([
      { accountCode: '112000', amount: 1000 }, { accountCode: '150200', amount: -200 }, { accountCode: '220000', amount: 300 },
    ], meta);
    expect(e.plug).toBe(500);
    expect(e.totalDebit).toBe(e.totalCredit);
    expect(e.jeLines.at(-1)).toMatchObject({ accountCode: '310000', credit: 500 });
  });
  it('refuses a P&L account', () => {
    expect(buildOpeningEntry([{ accountCode: '410000', amount: 5 }], meta).error).toMatch(/balance sheet only/);
  });
});

describe('a P&L month', () => {
  it('posts each account on its side and the month\'s profit against capital', () => {
    const e = buildPnlMonthEntry([
      { accountCode: '410000', amount: 1000 }, { accountCode: '430000', amount: 100 },
      { accountCode: '510000', amount: 600 }, { accountCode: '830000', amount: 50 },
    ], meta);
    expect(e.netIncome).toBe(350);
    expect(e.revenue).toBe(950);
    expect(e.totalDebit).toBe(e.totalCredit);
    expect(e.jeLines.at(-1)).toMatchObject({ accountCode: '310000', debit: 350 });
  });
});

describe('month columns', () => {
  it('reads jan, Jan and January, and ignores lookalikes', () => {
    const { months, bad } = readMonths({ code: 'x', jan: 1, Feb: '2', March: '(3)', Total: 99, junk: 5, aug: 'n/a' });
    expect(months).toEqual({ 1: 1, 2: 2, 3: -3 });
    expect(bad).toEqual(['aug: "n/a"']);
  });
  it('knows each month\'s last day', () => {
    expect(monthEnd(2024, 2)).toBe('2024-02-29');
    expect(monthEnd(2026, 12)).toBe('2026-12-31');
  });
});
