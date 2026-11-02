// Payroll computation, in one place. Pure functions: the routes, the tests
// and the payroll screen (through POST /api/payroll/compute) all get the same
// answer. Every rate and table here is a DEFAULT - the business can change
// them in Payroll > Rules (stored in Settings as `payrollRules`), because the
// government changes them and the app must not need a release when it does.
//
// The order a line is worked out in:
//   1. earnings, each of a pay type that is taxable or not
//   2. less absences (days absent x daily rate) and late time
//   3. SSS, PhilHealth and Pag-IBIG on the month's regular pay
//   4. taxable income = taxable earnings - absences - the three contributions
//      (non-taxable pay is added to gross but never to taxable income)
//   5. withholding tax from the BIR table: find the bracket the taxable
//      income falls in, tax = fixed amount + rate x (income - bracket floor)
//   6. net = gross - absences - contributions - tax - other deductions

import { roundMoney } from './money.js';

export const PAY_FREQUENCIES = { monthly: 1, semiMonthly: 2, weekly: 52 / 12 };

const round2 = (n) => roundMoney(Number(n) || 0);

export const DEFAULT_RULES = {
  // BIR withholding tax on compensation (TRAIN law, 2023 onwards). A row is a
  // bracket: income OVER `over` pays `base` plus `rate` of the part above
  // `over`. The first row (0, 0, 0) is the tax-free band.
  taxTables: {
    monthly: [
      { over: 0, base: 0, rate: 0 },
      { over: 20833, base: 0, rate: 0.15 },
      { over: 33333, base: 1875, rate: 0.20 },
      { over: 66667, base: 8541.80, rate: 0.25 },
      { over: 166667, base: 33541.80, rate: 0.30 },
      { over: 666667, base: 183541.80, rate: 0.35 },
    ],
    semiMonthly: [
      { over: 0, base: 0, rate: 0 },
      { over: 10417, base: 0, rate: 0.15 },
      { over: 16667, base: 937.50, rate: 0.20 },
      { over: 33333, base: 4270.70, rate: 0.25 },
      { over: 83333, base: 16770.70, rate: 0.30 },
      { over: 333333, base: 91770.70, rate: 0.35 },
    ],
    weekly: [
      { over: 0, base: 0, rate: 0 },
      { over: 4808, base: 0, rate: 0.15 },
      { over: 7692, base: 432.60, rate: 0.20 },
      { over: 15385, base: 1971.20, rate: 0.25 },
      { over: 38462, base: 7740.45, rate: 0.30 },
      { over: 153846, base: 42355.65, rate: 0.35 },
    ],
  },
  // SSS (2025 schedule): 15% of the monthly salary credit, 5% from the
  // employee and 10% from the employer, plus the employer's EC. The salary
  // credit is the month's pay rounded to the nearest 500, kept between the
  // floor and the ceiling.
  sss: { eeRate: 0.05, erRate: 0.10, mscMin: 5000, mscMax: 35000, step: 500, ecLow: 10, ecHigh: 30, ecThreshold: 15000 },
  // PhilHealth (2025): 5% of the month's basic pay, between the floor and the
  // ceiling, shared equally.
  philhealth: { rate: 0.05, floor: 10000, ceiling: 100000, eeShare: 0.5 },
  // Pag-IBIG: 1% from the employee up to 1,500 a month, 2% above it; 2% from
  // the employer; both on pay up to the maximum fund salary.
  pagibig: { eeRateLow: 0.01, lowLimit: 1500, eeRate: 0.02, erRate: 0.02, maxBase: 10000 },
  // Kinds of pay, and whether each is taxable. "regular" pay is what the
  // contributions are figured on.
  payTypes: [
    { key: 'basic', label: 'Basic pay', taxable: true, regular: true },
    { key: 'overtime', label: 'Overtime pay', taxable: true },
    { key: 'holiday', label: 'Holiday pay', taxable: true },
    { key: 'nightDiff', label: 'Night differential', taxable: true },
    { key: 'commission', label: 'Commission', taxable: true },
    { key: 'allowance', label: 'Taxable allowance', taxable: true },
    { key: 'deMinimis', label: 'De minimis benefits', taxable: false },
    { key: 'thirteenth', label: '13th month & other benefits (up to ₱90,000 a year)', taxable: false },
    { key: 'nonTaxableAllowance', label: 'Non-taxable allowance', taxable: false },
  ],
  overtimeMultiplier: 1.25,
  hoursPerDay: 8,
};

/** Rules with any saved changes laid over the defaults. */
export function mergeRules(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return {
    ...DEFAULT_RULES,
    ...s,
    taxTables: { ...DEFAULT_RULES.taxTables, ...(s.taxTables || {}) },
    sss: { ...DEFAULT_RULES.sss, ...(s.sss || {}) },
    philhealth: { ...DEFAULT_RULES.philhealth, ...(s.philhealth || {}) },
    pagibig: { ...DEFAULT_RULES.pagibig, ...(s.pagibig || {}) },
    payTypes: Array.isArray(s.payTypes) && s.payTypes.length ? s.payTypes : DEFAULT_RULES.payTypes,
  };
}

/** Checks rules sent from the screen; returns { rules } or { error }. */
export function readRules(body) {
  const r = mergeRules(body);
  for (const [freq, rows] of Object.entries(r.taxTables)) {
    if (!Array.isArray(rows) || !rows.length) return { error: `The ${freq} tax table is empty.` };
    let last = -1;
    for (const row of rows) {
      const over = Number(row.over), base = Number(row.base), rate = Number(row.rate);
      if (![over, base, rate].every(Number.isFinite) || over < 0 || base < 0 || rate < 0 || rate > 1) return { error: `The ${freq} tax table has a row that is not a number (rates are 0 to 1, e.g. 0.15).` };
      if (over <= last) return { error: `The ${freq} tax table must go up: each bracket starts above the one before.` };
      last = over;
    }
    r.taxTables[freq] = rows.map((x) => ({ over: Number(x.over), base: Number(x.base), rate: Number(x.rate) }));
  }
  const keys = new Set();
  for (const t of r.payTypes) {
    if (!t.key || !t.label || keys.has(t.key)) return { error: 'Every kind of pay needs a name, once.' };
    keys.add(t.key);
    t.taxable = !!t.taxable; t.regular = !!t.regular;
  }
  return { rules: r };
}

/** Withholding tax on `taxable` for a pay period, from the bracket table. */
export function taxFromTable(taxable, table) {
  const x = Number(taxable) || 0;
  if (x <= 0) return 0;
  let row = table[0];
  for (const r of table) if (x > r.over) row = r;
  return round2(row.base + row.rate * (x - row.over));
}

/** SSS shares for a month's pay. */
export function sssFor(monthlyPay, s) {
  const pay = Number(monthlyPay) || 0;
  if (pay <= 0) return { ee: 0, er: 0, msc: 0 };
  const msc = Math.min(s.mscMax, Math.max(s.mscMin, Math.round(pay / s.step) * s.step));
  const ec = msc < s.ecThreshold ? s.ecLow : s.ecHigh;
  return { ee: round2(msc * s.eeRate), er: round2(msc * s.erRate + ec), msc };
}

/** PhilHealth shares for a month's basic pay. */
export function philhealthFor(monthlyBasic, p) {
  const pay = Number(monthlyBasic) || 0;
  if (pay <= 0) return { ee: 0, er: 0 };
  const base = Math.min(p.ceiling, Math.max(p.floor, pay));
  const total = base * p.rate;
  const ee = round2(total * p.eeShare);
  return { ee, er: round2(total - ee) };
}

/** Pag-IBIG shares for a month's pay. */
export function pagibigFor(monthlyPay, g) {
  const pay = Number(monthlyPay) || 0;
  if (pay <= 0) return { ee: 0, er: 0 };
  const base = Math.min(g.maxBase, pay);
  const eeRate = pay <= g.lowLimit ? g.eeRateLow : g.eeRate;
  return { ee: round2(base * eeRate), er: round2(base * g.erRate) };
}

/**
 * One employee's pay for the period.
 * input: { earnings: { [payTypeKey]: amount }, dailyRate, absentDays,
 *          lateMinutes, overtimeHours, otherDeductions,
 *          skipContributions, overrides: { sss, philhealth, pagibig, withholdingTax } }
 * frequency: 'monthly' | 'semiMonthly' | 'weekly'
 */
export function computeLine(input, rulesIn, frequency = 'semiMonthly') {
  const rules = mergeRules(rulesIn);
  const per = PAY_FREQUENCIES[frequency] || 1;
  const types = new Map(rules.payTypes.map((t) => [t.key, t]));
  const earnings = { ...(input.earnings || {}) };
  const daily = Number(input.dailyRate) || 0;
  const hourly = daily / (rules.hoursPerDay || 8);
  // Overtime from hours, when hours are given and no amount was typed.
  if (Number(input.overtimeHours) > 0 && !(Number(earnings.overtime) > 0) && hourly > 0) {
    earnings.overtime = round2(Number(input.overtimeHours) * hourly * rules.overtimeMultiplier);
  }
  const lines = Object.entries(earnings)
    .map(([key, amount]) => ({ key, amount: round2(amount), ...(types.get(key) || { label: key, taxable: true }) }))
    .filter((l) => l.amount > 0)
    .map(({ key, label, taxable, regular, amount }) => ({ key, label, taxable: !!taxable, regular: !!regular, amount }));
  const gross = round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxablePay = round2(lines.filter((l) => l.taxable).reduce((s, l) => s + l.amount, 0));
  const nonTaxablePay = round2(gross - taxablePay);
  const regularPay = round2(lines.filter((l) => l.regular).reduce((s, l) => s + l.amount, 0));
  const absenceDeduction = round2((Number(input.absentDays) || 0) * daily + (Number(input.lateMinutes) || 0) * (hourly / 60));

  // Contributions are figured on the month, then split over the pay periods in it.
  const monthly = Math.max(0, (regularPay - absenceDeduction) * per);
  const ov = input.overrides || {};
  const share = (x) => round2(x / per);
  const sss = input.skipContributions ? { ee: 0, er: 0 } : sssFor(monthly, rules.sss);
  const ph = input.skipContributions ? { ee: 0, er: 0 } : philhealthFor(monthly, rules.philhealth);
  const pi = input.skipContributions ? { ee: 0, er: 0 } : pagibigFor(monthly, rules.pagibig);
  const pick = (k, v) => (ov[k] !== undefined && ov[k] !== '' && ov[k] !== null ? round2(ov[k]) : v);
  const out = {
    earnings: lines,
    grossPay: gross, taxablePay, nonTaxablePay, absenceDeduction,
    sss: pick('sss', share(sss.ee)), philhealth: pick('philhealth', share(ph.ee)), pagibig: pick('pagibig', share(pi.ee)),
    sssER: share(sss.er), philhealthER: share(ph.er), pagibigER: share(pi.er),
  };
  out.taxableIncome = round2(Math.max(0, taxablePay - absenceDeduction - out.sss - out.philhealth - out.pagibig));
  const table = rules.taxTables[frequency] || rules.taxTables.monthly;
  out.withholdingTax = pick('withholdingTax', taxFromTable(out.taxableIncome, table));
  out.otherDeductions = round2(input.otherDeductions);
  out.netPay = round2(gross - absenceDeduction - out.sss - out.philhealth - out.pagibig - out.withholdingTax - out.otherDeductions);
  return out;
}
