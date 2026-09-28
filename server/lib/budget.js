// Budgets: what each account may spend (or should earn) in a month, set by
// the business, compared with what the ledger says actually happened.
// Pure - the routes supply budget rows and ledger totals.
import { roundMoney } from './money.js';

// An account's activity for the period, in its own natural sign: income
// accounts earn (credit - debit), everything else spends (debit - credit).
export const naturalAmount = (type, dr, cr) => (type === 'revenue' ? cr - dr : dr - cr);

// One row of the Budget vs Actual report.
//   variance > 0 on an expense = over budget; on revenue = ahead of budget.
export function budgetRow({ accountCode, accountName, type, budget = 0, actual = 0 }) {
  const b = roundMoney(budget), a = roundMoney(actual);
  const variance = roundMoney(a - b);
  const pct = b ? roundMoney((a / b) * 100) : null;
  const favourable = type === 'revenue' ? variance >= 0 : variance <= 0;
  return { accountCode, accountName, type, budget: b, actual: a, variance, usedPct: pct, favourable, over: type !== 'revenue' && b > 0 && a > b };
}

// Can this request be met from what is left of the month's budget?
// `committed` is spending already asked for but not yet in the ledger
// (other requisition slips still waiting for approval).
export function budgetAvailability({ budget, spent = 0, committed = 0, requested = 0 }) {
  if (budget == null) return { hasBudget: false, over: false };
  const available = roundMoney(budget - spent - committed);
  return {
    hasBudget: true,
    budget: roundMoney(budget), spent: roundMoney(spent), committed: roundMoney(committed), requested: roundMoney(requested),
    available, over: roundMoney(requested) > available + 0.004,
  };
}

// The accounts a requisition slip would charge, and how much to each.
export function slipCharges(slip) {
  const out = new Map();
  const add = (code, amt) => { if (!code || !(amt > 0)) return; out.set(code, roundMoney((out.get(code) || 0) + amt)); };
  if (slip.type === 'petty-cash') add(slip.categoryCode, Number(slip.amount) || 0);
  if (slip.type === 'procurement') {
    for (const l of slip.lines || []) {
      const amt = (Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0);
      if (l.purchaseType === 'expense') add(l.expenseAccountCode, amt);
      else if (l.purchaseType === 'fixedAsset') add(l.assetAccountCode, amt);
      else add('130000', amt);            // stock bought for resale
    }
  }
  return [...out.entries()].map(([accountCode, amount]) => ({ accountCode, amount }));
}
