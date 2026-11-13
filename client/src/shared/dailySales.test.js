// A daily sales summary laid out the way the cafe keeps it: totals above the
// header, CASH / RCBC / GRAB labels above their columns. Numbers are made up
// but add up the same way the real sheet does.
import { describe, it, expect } from 'vitest';
import { readDailySales, findDailyHeader, dailyChecks, markRepeatedDays } from './dailySales.js';

const tsv = [
  '1,000.00\t\t\t\t\t\t\t\t500.00\t\t\t',
  '\t2,000.00\tCASH \t\t\t\t\t\tRCBC\tGRAB \t\t',
  'DATE \tTOTAL SALES \t CASH SALES \tTYPE OF DISCOUNT \tDISCONT \tCASH SALES AFTER DISCOUNT \tDATE DEPOSITED \tVALIDATED DEPOSIT SLIP \tGROSS AMOUNT \tGRAB \tCOMMISSION \tCREDITED AMOUNT ',
  '10-01-26\t1,500.00\t500.00\t\t\t500.00\t10/08/26\t1111-0001\t400\t800.00\t200.00\t600.00',
  '10-23-26\t2,100.00\t1,000.00\tPWD, SENIOR & REGULAR\t100.00\t900.00\t10/27/26\t2222-0002\t500\t800.00\t200.00\t600.00',
  '\t\t\t\t\t\t\t\t\t\t\t',
].map((line) => line.split('\t'));

describe('daily sales summary sheet', () => {
  it('finds the header under the totals rows', () => {
    expect(findDailyHeader(tsv)).toBe(2);
    expect(findDailyHeader([['Order No', 'Date', 'Total']])).toBe(-1);
  });

  it('reads each day, and the bank from the label above its column', () => {
    const got = readDailySales(tsv);
    expect(got.bankLabel).toBe('RCBC');
    expect(got.rows).toHaveLength(2);
    expect(got.rows[1]).toMatchObject({
      date: '10-23-26', totalSales: 2100, cashSales: 1000, discountType: 'PWD, SENIOR & REGULAR', discount: 100,
      cashAfter: 900, depositDate: '10/27/26', depositSlip: '2222-0002', bankSales: 500,
      grabGross: 800, grabCommission: 200, grabCredited: 600,
    });
  });

  it('checks the sheet\'s own arithmetic', () => {
    const [ok] = readDailySales(tsv).rows;
    expect(dailyChecks(ok)).toEqual([]);
    expect(dailyChecks({ ...ok, totalSales: 1499 })[0]).toMatch(/total sales is 1499.00/);
    expect(dailyChecks({ ...ok, grabCredited: 650 })[0]).toMatch(/Grab 800.00 less commission 200.00/);
  });
});

describe('the same date on two tabs', () => {
  it('keeps the first, marks the rest, and says when the numbers differ', () => {
    const day = (row, date, cash) => ({ row, date, cash, errors: [] });
    const out = markRepeatedDays([day('01P26!4', '2026-01-01', 500), day('JANUARY!4', '2026-01-01', 500), day('JANUARY!5', '2026-01-01', 700), day('01P26!5', '2026-01-02', 300)]);
    expect(out.map((d) => d.repeatOf || '')).toEqual(['', '01P26!4', '01P26!4', '']);
    expect(out[1].repeatDiffers).toBe(false);
    expect(out[2].repeatDiffers).toBe(true);
  });
});
