import { describe, it, expect } from 'vitest';
import { sheetDay } from './sheetDate.js';

describe('a date cell from a spreadsheet', () => {
  it('reads the forms people actually type', () => {
    for (const v of ['2026-09-30', '2026-9-30', '9/30/2026', '09-30-26', '30/09/2026', '2026/09/30',
      'Sept 30, 2026', 'September 30 2026', '30 Sep 2026', '30-Sep-26', ' 2026-09-30 ']) {
      expect(sheetDay(v), v).toBe('2026-09-30');
    }
  });

  it('reads the number Excel stores a date as', () => {
    expect(sheetDay(46295)).toBe('2026-09-30');
    expect(sheetDay('46295')).toBe('2026-09-30');
    expect(sheetDay(46295.75)).toBe('2026-09-30');
  });

  it('reads a Date as the calendar day it shows', () => {
    expect(sheetDay(new Date(2026, 8, 30, 0, 0, 0))).toBe('2026-09-30');
  });

  it('takes the first number as the month unless it cannot be one', () => {
    expect(sheetDay('5/6/2026')).toBe('2026-05-06');
    expect(sheetDay('13/6/2026')).toBe('2026-06-13');
  });

  it('says blank for blank', () => {
    for (const v of ['', '   ', null, undefined]) expect(sheetDay(v)).toBe('');
  });

  it('refuses what is not a date, instead of guessing', () => {
    for (const v of ['########', '2026-09-31', '2026-02-30', '13/13/2026', '0', 12, 46295000, 'soon',
      '1850-01-01', '46295-01-01', new Date('nope')]) {
      expect(sheetDay(v), String(v)).toBeNull();
    }
  });

  it('leaves a full timestamp as it is', () => {
    expect(sheetDay('2026-09-30T14:05:00.000Z')).toBe('2026-09-30T14:05:00.000Z');
  });
});
