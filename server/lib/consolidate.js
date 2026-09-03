// Consolidation helpers: turn a TRIAL BALANCE (per-account debit/credit totals)
// into a P&L or a Balance Sheet.
//
// Every branch is its own deployment with its own database (see features/hub.js
// - there is no shared DB to query), so a combined statement has to be built by
// pulling from each branch and merging here. The wire format between branches is
// deliberately a trial balance rather than a finished report: summing raw debits
// and credits by account code and classifying ONCE on the combined result is the
// standard consolidation input, and it stops sign conventions or account
// classification from drifting between branches running different builds.
//
// Classification below mirrors /api/reports/profit-loss-monthly and
// /api/reports/balance-sheet in features/reports.js. If the rules there change,
// change them here too.

import { sectionAncestor } from './chartOfAccounts.js';

const r2 = (n) => +Number(n || 0).toFixed(2);

// Which P&L section an account belongs to. Returns null for balance-sheet
// accounts, which are excluded from the P&L entirely.
export function pnlSectionOf(code, meta) {
  if (!meta) return null;
  if (meta.type === 'revenue') return 'revenue';
  if (meta.type === 'other-income') return 'otherincome';
  if (meta.type === 'contra-revenue') return 'contra';
  if (meta.type === 'expense' && meta.cogs) return 'cogs';
  if (meta.type === 'expense') return String(code).startsWith('9') ? 'otherexpense' : 'opex';
  return null;
}

// Merge many branches' trial balances into one, summing debit/credit per code.
// `rows` entries are { code, name, debit, credit }.
export function mergeTrialBalances(perBranch) {
  const merged = new Map();
  for (const { rows = [] } of perBranch) {
    for (const row of rows) {
      const code = String(row.code);
      if (!merged.has(code)) merged.set(code, { code, name: row.name || code, debit: 0, credit: 0 });
      const m = merged.get(code);
      m.debit += Number(row.debit || 0);
      m.credit += Number(row.credit || 0);
    }
  }
  return [...merged.values()]
    .map(m => ({ ...m, debit: r2(m.debit), credit: r2(m.credit) }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

// An account code a branch used but this instance's chart doesn't know about -
// usually a custom sub-account added on one branch only. Rolling it up to its
// parent would need metadata we don't have, so it is reported separately rather
// than silently dropped from the totals.
export function unknownCodes(rows, acctMeta) {
  return rows.filter(r => !acctMeta(r.code)).map(r => ({ code: r.code, name: r.name }));
}

export function buildPnl(rows, acctMeta) {
  const accounts = [];
  const sec = { revenue: 0, contra: 0, cogs: 0, opex: 0, otherincome: 0, otherexpense: 0 };

  for (const row of rows) {
    const meta = acctMeta(row.code);
    const section = pnlSectionOf(row.code, meta);
    if (!section) continue;
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);
    // Revenue-side accounts carry credit balances, everything else debit.
    const amount = (section === 'revenue' || section === 'otherincome') ? credit - debit : debit - credit;
    accounts.push({ code: row.code, name: meta.name || row.name, section, amount: r2(amount) });
    sec[section] += amount;
  }

  const netRevenue = sec.revenue - sec.contra;
  const grossProfit = netRevenue - sec.cogs;
  const netIncome = grossProfit - sec.opex + sec.otherincome - sec.otherexpense;

  return {
    accounts: accounts.sort((a, b) => a.code.localeCompare(b.code)),
    totals: {
      revenue: r2(sec.revenue), contra: r2(sec.contra), netRevenue: r2(netRevenue),
      cogs: r2(sec.cogs), grossProfit: r2(grossProfit), opex: r2(sec.opex),
      otherincome: r2(sec.otherincome), otherexpense: r2(sec.otherexpense),
      netIncome: r2(netIncome),
    },
  };
}

export function buildBalanceSheet(rows, acctMeta) {
  const assets = [], liabilities = [], equity = [];
  let totalAssets = 0, totalLiabilities = 0, totalEquity = 0, retainedEarnings = 0;

  for (const row of rows) {
    const meta = acctMeta(row.code);
    if (!meta) continue;
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);

    if (meta.type === 'asset') {
      const bal = debit - credit;
      assets.push({ code: row.code, name: meta.name, amount: r2(bal) });
      totalAssets += bal;
    } else if (meta.type === 'liability') {
      const bal = credit - debit;
      liabilities.push({ code: row.code, name: meta.name, amount: r2(bal) });
      totalLiabilities += bal;
    } else if (meta.type === 'equity') {
      const bal = credit - debit;
      equity.push({ code: row.code, name: meta.name, amount: r2(bal) });
      totalEquity += bal;
    } else if (meta.type === 'revenue' || meta.type === 'other-income') {
      retainedEarnings += credit - debit;
    } else if (meta.type === 'contra-revenue' || meta.type === 'expense') {
      retainedEarnings -= debit - credit;
    }
  }

  equity.push({ code: '330000', name: 'Retained Earnings (computed)', amount: r2(retainedEarnings) });
  totalEquity += retainedEarnings;

  const sectionize = (items) => {
    const bySection = new Map();
    for (const item of items) {
      const s = sectionAncestor(item.code, acctMeta) || { code: item.code, name: item.name };
      if (!bySection.has(s.code)) bySection.set(s.code, { code: s.code, name: s.name, items: [], total: 0 });
      const bucket = bySection.get(s.code);
      bucket.items.push(item);
      bucket.total = r2(bucket.total + item.amount);
    }
    return [...bySection.values()].sort((a, b) => a.code.localeCompare(b.code));
  };

  const totalLiabAndEquity = totalLiabilities + totalEquity;
  return {
    assets, liabilities, equity,
    sections: { assets: sectionize(assets), liabilities: sectionize(liabilities) },
    totals: {
      assets: r2(totalAssets),
      liabilities: r2(totalLiabilities),
      equity: r2(totalEquity),
      liabilitiesAndEquity: r2(totalLiabAndEquity),
      balanced: Math.abs(totalAssets - totalLiabAndEquity) <= 0.01,
    },
  };
}
