import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES as R, taxFromTable, sssFor, philhealthFor, pagibigFor, computeLine, readRules } from './payrollCalc.js';

describe('payroll computation', () => {
  it('withholding tax from the BIR brackets', () => {
    expect(taxFromTable(20000, R.taxTables.monthly)).toBe(0);
    expect(taxFromTable(25000, R.taxTables.monthly)).toBe(625.05);          // 15% over 20,833
    expect(taxFromTable(40000, R.taxTables.monthly)).toBe(3208.40);         // 1,875 + 20% over 33,333
    expect(taxFromTable(20000, R.taxTables.semiMonthly)).toBe(1604.10);     // 937.50 + 20% over 16,667
  });

  it('SSS, PhilHealth and Pag-IBIG shares', () => {
    expect(sssFor(20000, R.sss)).toMatchObject({ ee: 1000, er: 2030, msc: 20000 });
    expect(sssFor(40000, R.sss)).toMatchObject({ ee: 1750, msc: 35000 });  // ceiling
    expect(sssFor(3000, R.sss)).toMatchObject({ ee: 250, er: 510 });       // floor, low EC
    expect(philhealthFor(20000, R.philhealth)).toEqual({ ee: 500, er: 500 });
    expect(philhealthFor(8000, R.philhealth)).toEqual({ ee: 250, er: 250 }); // floor
    expect(pagibigFor(20000, R.pagibig)).toEqual({ ee: 200, er: 200 });      // capped base
    expect(pagibigFor(1200, R.pagibig)).toEqual({ ee: 12, er: 24 });         // 1% at or under 1,500
  });

  it('a semi-monthly line, end to end', () => {
    const l = computeLine({ earnings: { basic: 15000 } }, R, 'semiMonthly');
    expect(l).toMatchObject({ grossPay: 15000, sss: 750, philhealth: 375, pagibig: 100, taxableIncome: 13775, withholdingTax: 503.7, netPay: 13271.3 });
    expect(l).toMatchObject({ sssER: 1515, philhealthER: 375, pagibigER: 100 });
  });

  it('non-taxable pay adds to gross but not to tax; absences and overtime from the day rate', () => {
    const base = computeLine({ earnings: { basic: 15000 } }, R, 'semiMonthly');
    const withDeMinimis = computeLine({ earnings: { basic: 15000, deMinimis: 2000 } }, R, 'semiMonthly');
    expect(withDeMinimis.withholdingTax).toBe(base.withholdingTax);
    expect(withDeMinimis.netPay).toBe(base.netPay + 2000);
    expect(withDeMinimis.nonTaxablePay).toBe(2000);
    const l = computeLine({ earnings: { basic: 10000 }, dailyRate: 800, absentDays: 1, overtimeHours: 2 }, R, 'semiMonthly');
    expect(l.absenceDeduction).toBe(800);
    expect(l.earnings.find((e) => e.key === 'overtime').amount).toBe(250);   // 2 h x 100 x 1.25
  });

  it('a typed amount wins over the computed one, and bad tables are refused', () => {
    expect(computeLine({ earnings: { basic: 15000 }, overrides: { withholdingTax: 0 } }, R, 'semiMonthly').withholdingTax).toBe(0);
    expect(readRules({ taxTables: { monthly: [{ over: 0, base: 0, rate: 0 }, { over: 0, base: 0, rate: 0.2 }] } }).error).toBeTruthy();
    expect(readRules({ taxTables: { monthly: [{ over: 0, base: 0, rate: 1.5 }] } }).error).toBeTruthy();
  });
});
