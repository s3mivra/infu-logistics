// Statement of cash flows, direct method, straight from the ledger.
//
// Every journal entry that moves cash (cash on hand, bank, e-wallets, petty
// cash, undeposited checks) is read for what was on the OTHER side of it: the
// customer receivable it collected, the supplier it paid, the loan it drew.
// Each non-cash line's amount is the cash it accounts for, so an entry that
// splits a payment across several accounts is split the same way here. A move
// between two cash accounts (a bank deposit) nets to nothing and drops out.
//
// Pure: the report route feeds it entries and account metadata.
import { roundMoney } from './money.js';

// Cash and cash equivalents: 111 cash on hand, 112 bank, 113 e-wallets,
// 114 petty cash / revolving funds, 115 checks received not yet deposited -
// and any sub-account opened under them.
export const isCashCode = (code) => /^11[1-5]/.test(String(code || ''));

// [activity, line label] for the account on the other side of the cash.
export function classify(code) {
  const c = String(code || '');
  if (/^1[45]/.test(c) || c === '225100' || c === '920000') return ['investing', 'Purchase and disposal of equipment and other fixed assets'];
  if (/^25/.test(c)) return ['financing', 'Loans received and repaid'];
  if (/^3/.test(c)) return ['financing', 'Owner contributions and withdrawals'];
  if (c === '910000') return ['operating', 'Interest paid'];
  if (/^4/.test(c) || c === '120000' || c === '118000' || /^260/.test(c) || c === '230300' || c === '430000') return ['operating', 'Received from customers'];
  if (c === '220000' || c === '130000' || /^5/.test(c) || c === '170200' || c === '170300' || c === '160100' || c === '225200') return ['operating', 'Paid to suppliers'];
  if (c === '610000' || c === '620000' || /^240/.test(c) || c === '170100') return ['operating', 'Paid to and for employees'];
  if (/^230/.test(c) || c === '745000') return ['operating', 'Taxes paid'];
  if (/^[67]/.test(c)) return ['operating', 'Operating expenses paid'];
  return ['operating', 'Other operating cash'];
}

export const ACTIVITIES = [
  ['operating', 'Cash flows from operating activities'],
  ['investing', 'Cash flows from investing activities'],
  ['financing', 'Cash flows from financing activities'],
];

export function buildCashFlow({ entries = [], openingCash = 0 }) {
  const byActivity = { operating: new Map(), investing: new Map(), financing: new Map() };
  let netFromEntries = 0;
  for (const e of entries) {
    const lines = e.lines || [];
    const cashNet = lines.filter(l => isCashCode(l.accountCode)).reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
    if (Math.abs(cashNet) < 0.005) continue;               // cash to cash, or no cash at all
    netFromEntries += cashNet;
    for (const l of lines) {
      if (isCashCode(l.accountCode)) continue;
      // A credit on the other side is cash coming in; a debit, cash going out.
      const amount = (Number(l.credit) || 0) - (Number(l.debit) || 0);
      if (Math.abs(amount) < 0.005) continue;
      const [activity, label] = classify(l.accountCode);
      const bucket = byActivity[activity];
      const row = bucket.get(label) || { label, inflow: 0, outflow: 0 };
      if (amount > 0) row.inflow += amount; else row.outflow += -amount;
      bucket.set(label, row);
    }
  }
  const sections = ACTIVITIES.map(([key, title]) => {
    const lines = [...byActivity[key].values()].map(r => ({
      label: r.label, inflow: roundMoney(r.inflow), outflow: roundMoney(r.outflow), net: roundMoney(r.inflow - r.outflow),
    })).sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow));
    return { key, title, lines, net: roundMoney(lines.reduce((s, l) => s + l.net, 0)) };
  });
  const netChange = roundMoney(sections.reduce((s, x) => s + x.net, 0));
  return {
    sections,
    openingCash: roundMoney(openingCash),
    netChange,
    closingCash: roundMoney(openingCash + netChange),
    // Should always equal netChange - a gap means an entry was unbalanced
    // around its cash lines, which the ledger guard makes impossible.
    netFromEntries: roundMoney(netFromEntries),
  };
}
