import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { mergeStockTabs } from './mergeSheetTabs';

// A workbook the way a shop keeps it, written and read back as a real .xlsx.
const book = (tabs) => {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), name);
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return XLSX.read(buf, { type: 'array', cellDates: true, cellNF: true });
};
const rowsOf = (res) => XLSX.utils.sheet_to_json(res.workbook.Sheets.Inventory);

const tabs = {
  Beans: [['Product', 'Qty Unit', 'Unit Cost'], ['Espresso Beans 1kg', 10, 900]],
  Milk: [['Unit Cost', 'Product', 'Qty Unit'], [95, 'Fresh Milk 1L', 24]],   // columns in another order
  Notes: [['Reminder'], ['Order cups on Friday']],
};

describe('merging stock tabs', () => {
  it('takes every stock tab on "all", matching columns by name, and skips the rest', () => {
    const res = mergeStockTabs(XLSX, book(tabs), 'all');
    expect(res.used).toEqual(['Beans', 'Milk']);
    expect(res.skipped).toEqual([{ name: 'Notes', reason: 'no Product and Qty Unit / Unit Cost columns' }]);
    expect(rowsOf(res)).toEqual([
      { Product: 'Espresso Beans 1kg', 'Qty Unit': 10, 'Unit Cost': 900 },
      { Product: 'Fresh Milk 1L', 'Qty Unit': 24, 'Unit Cost': 95 },
    ]);
  });

  it('takes only the chosen tabs, and reports one that is missing', () => {
    const res = mergeStockTabs(XLSX, book(tabs), ['Milk', 'Dairy']);
    expect(res.used).toEqual(['Milk']);
    expect(res.skipped).toEqual([{ name: 'Dairy', reason: 'not in the sheet' }]);
    expect(rowsOf(res).map(r => r.Product)).toEqual(['Fresh Milk 1L']);
  });

  it('keeps a date a date, with its format', () => {
    const res = mergeStockTabs(XLSX, book({
      Beans: [['Product', 'Qty Unit', 'Unit Cost', 'Expiry'], ['Beans', 1, 900, new Date(Date.UTC(2026, 11, 31))]],
    }), 'all');
    const cell = res.workbook.Sheets.Inventory.D2;
    expect(cell.t).toBe('d');
    expect(cell.v instanceof Date).toBe(true);
  });

  it('warns about an item listed on two tabs, which the import would add together', () => {
    const res = mergeStockTabs(XLSX, book({
      Shelf: [['Product', 'Qty Unit'], ['Oat Milk 1L', 6]],
      Chiller: [['Product', 'Qty Unit'], ['oat milk 1l', 4], ['Cream 1L', 2]],
    }), 'all');
    expect(res.duplicates).toEqual(['Oat Milk 1L']);
  });

  it('gives no workbook when none of the tabs is stock', () => {
    const res = mergeStockTabs(XLSX, book({ Notes: tabs.Notes }), 'all');
    expect(res.workbook).toBeNull();
    expect(res.used).toEqual([]);
  });
});
