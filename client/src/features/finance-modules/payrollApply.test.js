import { describe, it, expect } from 'vitest';
import { applyToLines } from './PayrollTab.jsx';

const line = (name, basic, over = {}) => ({ employeeName: name, grossPay: String(basic), allowances: '', sss: '', philhealth: '', pagibig: '', withholdingTax: '', otherDeductions: '', sel: false, ...over });

describe('apply to lines', () => {
  it('a percent of extra pay is of basic pay, and adds to what is there', () => {
    const out = applyToLines([line('Ana', 10000, { allowances: '500' }), line('Ben', 8000)], { key: 'allowances', how: 'pct', value: '10', scope: 'all' });
    expect(out.map(l => l.allowances)).toEqual(['1500', '800']);
  });

  it('a percent taken off is of gross (basic + extra), and a statutory amount replaces', () => {
    const out = applyToLines([line('Ana', 10000, { allowances: '1000', sss: '999' })], { key: 'sss', how: 'pct', value: '5', scope: 'all' });
    expect(out[0].sss).toBe('550');
  });

  it('a fixed amount goes only on the ticked lines when asked', () => {
    const out = applyToLines([line('Ana', 10000, { sel: true }), line('Ben', 8000)], { key: 'otherDeductions', how: 'fixed', value: '200', scope: 'selected' });
    expect(out.map(l => l.otherDeductions)).toEqual(['200', '']);
  });

  it('leaves blank rows alone and ignores a negative or empty value', () => {
    const blank = line('', 0);
    expect(applyToLines([blank], { key: 'allowances', how: 'fixed', value: '100', scope: 'all' })[0]).toBe(blank);
    const ana = [line('Ana', 1000)];
    expect(applyToLines(ana, { key: 'allowances', how: 'fixed', value: '-5', scope: 'all' })).toBe(ana);
  });
});
