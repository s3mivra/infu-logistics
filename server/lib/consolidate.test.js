import { describe, it, expect } from 'vitest';
import { ACCOUNTS } from './chartOfAccounts.js';
import {
  pnlSectionOf,
  mergeTrialBalances,
  unknownCodes,
  buildPnl,
  buildBalanceSheet,
} from './consolidate.js';

// Consolidation runs against the real chart, so use the real lookup.
const acctMeta = (code) => ACCOUNTS[code] || null;
const row = (code, debit = 0, credit = 0) => ({ code, name: ACCOUNTS[code]?.name || code, debit, credit });

describe('pnlSectionOf', () => {
  it('routes each account type to its P&L section', () => {
    expect(pnlSectionOf('410000', { type: 'revenue' })).toBe('revenue');
    expect(pnlSectionOf('430000', { type: 'contra-revenue' })).toBe('contra');
    expect(pnlSectionOf('510000', { type: 'expense', cogs: true })).toBe('cogs');
    expect(pnlSectionOf('610000', { type: 'expense' })).toBe('opex');
    expect(pnlSectionOf('810000', { type: 'other-income' })).toBe('otherincome');
  });

  it('sends 9-prefixed expenses to other-expense, not opex', () => {
    expect(pnlSectionOf('910000', { type: 'expense' })).toBe('otherexpense');
  });

  it('excludes balance-sheet accounts and unknown codes from the P&L', () => {
    expect(pnlSectionOf('111000', { type: 'asset' })).toBeNull();
    expect(pnlSectionOf('220000', { type: 'liability' })).toBeNull();
    expect(pnlSectionOf('310000', { type: 'equity' })).toBeNull();
    expect(pnlSectionOf('999999', null)).toBeNull();
  });
});

describe('mergeTrialBalances', () => {
  it('sums debits and credits per account code across branches', () => {
    const merged = mergeTrialBalances([
      { rows: [row('111000', 100, 0), row('410000', 0, 500)] },
      { rows: [row('111000', 50, 20), row('410000', 0, 300)] },
    ]);
    const cash = merged.find(r => r.code === '111000');
    expect(cash.debit).toBe(150);
    expect(cash.credit).toBe(20);
    expect(merged.find(r => r.code === '410000').credit).toBe(800);
  });

  it('keeps an account only one branch used', () => {
    const merged = mergeTrialBalances([
      { rows: [row('111000', 100, 0)] },
      { rows: [row('112000', 40, 0)] },
    ]);
    expect(merged.map(r => r.code)).toEqual(['111000', '112000']);
  });

  it('returns codes sorted and is a no-op on empty input', () => {
    expect(mergeTrialBalances([])).toEqual([]);
    const merged = mergeTrialBalances([{ rows: [row('610000', 5), row('111000', 5)] }]);
    expect(merged.map(r => r.code)).toEqual(['111000', '610000']);
  });
});

describe('unknownCodes', () => {
  it('flags codes absent from this instance chart', () => {
    const rows = [row('111000', 10), { code: '118999', name: 'Branch-only wallet', debit: 25, credit: 0 }];
    expect(unknownCodes(rows, acctMeta)).toEqual([{ code: '118999', name: 'Branch-only wallet' }]);
  });

  it('returns nothing when every code is known', () => {
    expect(unknownCodes([row('111000', 10)], acctMeta)).toEqual([]);
  });
});

describe('buildPnl', () => {
  it('computes net revenue, gross profit and net income from a trial balance', () => {
    const rows = [
      row('410000', 0, 1000),  // revenue
      row('430000', 100, 0),   // contra-revenue (Sales Discounts)
      row('510000', 400, 0),   // COGS
      row('610000', 150, 0),   // opex
    ];
    const { totals } = buildPnl(rows, acctMeta);
    expect(totals.revenue).toBe(1000);
    expect(totals.contra).toBe(100);
    expect(totals.netRevenue).toBe(900);
    expect(totals.cogs).toBe(400);
    expect(totals.grossProfit).toBe(500);
    expect(totals.opex).toBe(150);
    expect(totals.netIncome).toBe(350);
  });

  it('ignores balance-sheet accounts entirely', () => {
    const { accounts, totals } = buildPnl([row('111000', 5000, 0), row('410000', 0, 200)], acctMeta);
    expect(accounts.map(a => a.code)).toEqual(['410000']);
    expect(totals.netIncome).toBe(200);
  });

  it('adds other income and subtracts other expense after gross profit', () => {
    const { totals } = buildPnl([
      row('410000', 0, 1000),
      row('810000', 0, 50),   // other income (Interest Income)
      row('910000', 30, 0),   // other expense
    ], acctMeta);
    expect(totals.otherincome).toBe(50);
    expect(totals.otherexpense).toBe(30);
    expect(totals.netIncome).toBe(1020);
  });

  it('nets a contra-debit against revenue rather than double counting', () => {
    const { totals } = buildPnl([row('410000', 200, 1000)], acctMeta);
    expect(totals.revenue).toBe(800);
  });
});

describe('buildBalanceSheet', () => {
  it('balances assets against liabilities plus equity via retained earnings', () => {
    // Sale of 1000 on cash, cost of 400 out of inventory.
    const rows = [
      row('111000', 1000, 0),  // cash (asset)
      row('130000', 0, 400),   // inventory relief (asset credit)
      row('410000', 0, 1000),  // revenue
      row('510000', 400, 0),   // COGS
    ];
    const bs = buildBalanceSheet(rows, acctMeta);
    expect(bs.totals.assets).toBe(600);
    expect(bs.totals.balanced).toBe(true);
    expect(bs.totals.liabilitiesAndEquity).toBe(600);
  });

  it('folds revenue and expense into a computed retained earnings line', () => {
    const bs = buildBalanceSheet([row('111000', 300, 0), row('410000', 0, 300)], acctMeta);
    const re = bs.equity.find(e => e.code === '330000');
    expect(re.amount).toBe(300);
    expect(re.name).toMatch(/retained earnings/i);
  });

  it('reports liabilities as credit balances', () => {
    const bs = buildBalanceSheet([row('111000', 500, 0), row('220000', 0, 500)], acctMeta);
    expect(bs.totals.liabilities).toBe(500);
    expect(bs.totals.balanced).toBe(true);
  });

  it('skips codes it cannot classify instead of corrupting totals', () => {
    const bs = buildBalanceSheet([
      row('111000', 100, 0),
      { code: '118999', name: 'Branch-only', debit: 9999, credit: 0 },
    ], acctMeta);
    expect(bs.totals.assets).toBe(100);
  });

  it('groups accounts into named balance-sheet sections', () => {
    const bs = buildBalanceSheet([row('111000', 100, 0), row('220000', 0, 100)], acctMeta);
    expect(bs.sections.assets.length).toBeGreaterThan(0);
    expect(bs.sections.assets[0]).toHaveProperty('name');
    expect(bs.sections.assets[0]).toHaveProperty('total');
  });
});

describe('consolidation end to end', () => {
  it('produces the same books as one branch would if the other is empty', () => {
    const branchA = [row('111000', 1000, 0), row('410000', 0, 1000)];
    const solo = buildPnl(branchA, acctMeta);
    const merged = buildPnl(mergeTrialBalances([{ rows: branchA }, { rows: [] }]), acctMeta);
    expect(merged.totals).toEqual(solo.totals);
  });

  it('sums two branches into one set of books that still balances', () => {
    const branchA = [row('111000', 1000, 0), row('410000', 0, 1000)];
    const branchB = [row('111000', 250, 0), row('410000', 0, 250)];
    const rows = mergeTrialBalances([{ rows: branchA }, { rows: branchB }]);

    expect(buildPnl(rows, acctMeta).totals.netIncome).toBe(1250);
    const bs = buildBalanceSheet(rows, acctMeta);
    expect(bs.totals.assets).toBe(1250);
    expect(bs.totals.balanced).toBe(true);
  });
});
