// Carrying a business's existing books in: the arithmetic, with no database.
//
// Used by the setup workbook's accounting sheets (features/setup-import.js) and
// by the opening-balances screen (features/finance.js), so both assemble the
// entry by the same rules.

export const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// A money cell as people type it, or as an accounting spreadsheet exports it:
// 1,061,821 · (29,762) · -29762 · ₱ 20,000 · "-" or blank for nothing.
// -> a number, or NaN when the cell holds something that is not an amount.
export function parseAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? '').trim();
  if (!s || /^[-–—]+$/.test(s)) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[₱$,\s]/g, '').replace(/^PHP/i, '');
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (!/^\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
}

// Which way an account's balance normally runs. Assets, expenses and discounts
// (contra-revenue) grow on the debit side; liabilities, equity and income on
// the credit side.
export const debitNatured = (type) => type === 'asset' || type === 'expense' || type === 'contra-revenue';
export const isPnlType = (type) => ['revenue', 'contra-revenue', 'expense', 'other-income'].includes(type);
export const isBalanceSheetType = (type) => ['asset', 'liability', 'equity'].includes(type);

// An amount in the account's natural direction -> the debit/credit it posts.
// A negative amount runs against it, which is how a contra balance such as
// accumulated depreciation, "(29,762)", is carried.
export function naturalSide(type, amount) {
  const a = round2(amount);
  if (debitNatured(type)) return { debit: Math.max(0, a), credit: Math.max(0, -a) };
  return { debit: Math.max(0, -a), credit: Math.max(0, a) };
}

// Balance-sheet lines -> a balanced opening entry. Whatever does not balance is
// the owner's stake in what was carried in, plugged to `plugCode`.
// lines: [{ accountCode, amount }]. -> { jeLines, totalDebit, totalCredit, plug, error }
export function buildOpeningEntry(lines, acctMeta, { plugCode = '310000' } = {}) {
  const jeLines = [];
  let totalDebit = 0, totalCredit = 0;
  for (const raw of lines) {
    const code = String(raw.accountCode || '').trim();
    const amount = round2(raw.amount);
    if (!amount) continue;                       // a blank row is nothing to carry, not an error
    const meta = acctMeta(code);
    if (!meta) return { error: `Unknown account code: ${code}.` };
    if (!isBalanceSheetType(meta.type)) {
      return { error: `${code} ${meta.name} is a ${meta.type} account. Opening balances carry the balance sheet only - accumulated results belong in equity.` };
    }
    const { debit, credit } = naturalSide(meta.type, amount);
    jeLines.push({ accountCode: code, accountName: meta.name, debit, credit });
    totalDebit += debit; totalCredit += credit;
  }
  if (!jeLines.length) return { error: 'Every line was zero - nothing to carry in.' };
  const plug = round2(totalDebit - totalCredit);
  if (Math.abs(plug) > 0.01) {
    const plugMeta = acctMeta(plugCode);
    jeLines.push({
      accountCode: plugCode, accountName: plugMeta?.name || "Owner's Capital",
      debit: plug < 0 ? -plug : 0, credit: plug > 0 ? plug : 0,
    });
    if (plug > 0) totalCredit += plug; else totalDebit += -plug;
  }
  return { jeLines, totalDebit: round2(totalDebit), totalCredit: round2(totalCredit), plug: Math.abs(plug) > 0.01 ? plug : 0 };
}

// One month of a P&L carried in -> a balanced entry. Each account's amount is
// in its natural direction (sales and income positive, expenses and discounts
// positive); the month's result is offset to `offsetCode`, which the opening
// balance sheet then clears - see setup-import.js.
// accounts: [{ accountCode, amount }] -> { jeLines, totalDebit, totalCredit, netIncome, revenue, expenses }
export function buildPnlMonthEntry(accounts, acctMeta, { offsetCode = '310000' } = {}) {
  const jeLines = [];
  let totalDebit = 0, totalCredit = 0, revenue = 0, expenses = 0;
  for (const a of accounts) {
    const amount = round2(a.amount);
    if (!amount) continue;
    const meta = acctMeta(a.accountCode);
    const { debit, credit } = naturalSide(meta.type, amount);
    jeLines.push({ accountCode: a.accountCode, accountName: meta.name, debit, credit });
    totalDebit += debit; totalCredit += credit;
    if (meta.type === 'revenue' || meta.type === 'other-income') revenue += amount;
    else if (meta.type === 'contra-revenue') revenue -= amount;
    else expenses += amount;
  }
  if (!jeLines.length) return null;
  const netIncome = round2(totalCredit - totalDebit);
  if (Math.abs(netIncome) > 0.005) {
    const m = acctMeta(offsetCode);
    jeLines.push({
      accountCode: offsetCode, accountName: m?.name || "Owner's Capital",
      debit: netIncome > 0 ? netIncome : 0, credit: netIncome < 0 ? -netIncome : 0,
    });
    if (netIncome > 0) totalDebit += netIncome; else totalCredit += -netIncome;
  }
  return { jeLines, totalDebit: round2(totalDebit), totalCredit: round2(totalCredit), netIncome, revenue: round2(revenue), expenses: round2(expenses) };
}

// The last calendar day of a month, as YYYY-MM-DD.
export function monthEnd(year, month) {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

// A row's month columns -> { 1: amount, ... 12: amount }, reading the headers
// people actually write: jan, Jan, January, JANUARY.
export function readMonths(row) {
  const out = {};
  const bad = [];
  for (const [key, value] of Object.entries(row || {})) {
    const k = String(key).trim().toLowerCase().slice(0, 3);
    const idx = MONTH_KEYS.indexOf(k);
    if (idx < 0) continue;
    // "total", "junk" etc. must not read as a month: only the name itself counts.
    const full = String(key).trim().toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    if (full !== k && full !== names[idx]) continue;
    const n = parseAmount(value);
    if (Number.isNaN(n)) { bad.push(`${key}: "${value}"`); continue; }
    if (n) out[idx + 1] = round2((out[idx + 1] || 0) + n);
  }
  return { months: out, bad };
}
