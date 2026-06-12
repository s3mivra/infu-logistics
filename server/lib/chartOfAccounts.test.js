import { describe, it, expect } from 'vitest';
import {
  ACCOUNTS,
  EXPENSE_CATEGORIES,
  CODE_MAP,
  getAccount,
  isAssetCode,
  isLiabilityCode,
  isEquityCode,
  isRevenueCode,
  isExpenseCode,
  isOtherIncomeCode,
} from './chartOfAccounts.js';

describe('chartOfAccounts.ACCOUNTS coverage (6-digit SAP)', () => {
  it('defines the core account types', () => {
    const types = new Set(Object.values(ACCOUNTS).map(a => a.type));
    ['asset', 'liability', 'equity', 'revenue', 'expense', 'other-income'].forEach(t => expect(types.has(t)).toBe(true));
  });
  it('marks COGS account with cogs: true', () => {
    expect(ACCOUNTS['510000'].cogs).toBe(true);
  });
  it('marks Sales Discounts as contra-revenue', () => {
    expect(ACCOUNTS['430000'].type).toBe('contra-revenue');
  });
  it('all codes are 6 digits', () => {
    for (const code of Object.keys(ACCOUNTS)) expect(/^[0-9]{6}$/.test(code)).toBe(true);
  });
  it('child accounts reference an existing parent', () => {
    for (const [code, meta] of Object.entries(ACCOUNTS)) {
      if (meta.parent) expect(ACCOUNTS[meta.parent], `parent of ${code}`).toBeDefined();
    }
  });
});

describe('code-range classifiers (leading digit)', () => {
  it('1xxxxx assets', () => ['111000','112000','113000','120000','130000'].forEach(c => { expect(isAssetCode(c)).toBe(true); expect(ACCOUNTS[c].type).toBe('asset'); }));
  it('2xxxxx liabilities', () => ['220000','240000','260000'].forEach(c => { expect(isLiabilityCode(c)).toBe(true); expect(ACCOUNTS[c].type).toBe('liability'); }));
  it('3xxxxx equity', () => ['310000','315000','330000'].forEach(c => { expect(isEquityCode(c)).toBe(true); expect(ACCOUNTS[c].type).toBe('equity'); }));
  it('4xxxxx revenue/contra', () => ['410000','420000','430000','440000'].forEach(c => expect(isRevenueCode(c)).toBe(true)));
  it('5/6/7/9 are expenses', () => ['510000','535000','540000','610000','720000','760000','930000'].forEach(c => expect(isExpenseCode(c)).toBe(true)));
  it('8xxxxx other income', () => ['810000','830000'].forEach(c => expect(isOtherIncomeCode(c)).toBe(true)));
  it('every account maps to exactly one top-level class', () => {
    for (const code of Object.keys(ACCOUNTS)) {
      const hits = [isAssetCode, isLiabilityCode, isEquityCode, isRevenueCode, isOtherIncomeCode, isExpenseCode]
        .filter(fn => fn(code)).length;
      expect(hits, `code ${code}`).toBe(1);
    }
  });
});

describe('getAccount', () => {
  it('returns the canonical entry for a known code', () => {
    expect(getAccount('111000').name).toBe('Cash on Hand');
  });
  it('returns a fallback for unknown codes', () => {
    const acct = getAccount('999999');
    expect(acct.name).toMatch(/999999/);
    expect(acct.type).toBe('unknown');
  });
});

describe('EXPENSE_CATEGORIES integrity', () => {
  it('every category code exists in ACCOUNTS and is an expense', () => {
    for (const cat of EXPENSE_CATEGORIES) {
      expect(ACCOUNTS[cat.code], cat.code).toBeDefined();
      expect(isExpenseCode(cat.code)).toBe(true);
    }
  });
  it('has at least 8 operator-facing categories with non-empty labels', () => {
    expect(EXPENSE_CATEGORIES.length).toBeGreaterThanOrEqual(8);
    for (const cat of EXPENSE_CATEGORIES) expect(cat.label.length).toBeGreaterThan(0);
  });
});

describe('CODE_MAP migration table', () => {
  it('every new code exists in the new COA', () => {
    for (const [oldC, newC] of Object.entries(CODE_MAP)) {
      expect(/^[0-9]{4}$/.test(oldC)).toBe(true);
      expect(ACCOUNTS[newC], `${oldC} -> ${newC}`).toBeDefined();
    }
  });
});

describe('Non-VAT compliance', () => {
  it('has no VAT Payable account', () => {
    for (const meta of Object.values(ACCOUNTS)) expect(meta.name.toLowerCase()).not.toMatch(/vat payable/);
  });
});
