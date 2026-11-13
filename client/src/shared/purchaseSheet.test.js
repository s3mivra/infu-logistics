import { describe, it, expect } from 'vitest';
import { purchaseField, toPurchaseRows, missingPurchaseColumns } from './purchaseSheet.js';

describe('purchases sheet headers', () => {
  it('reads the business\'s own column names', () => {
    expect(purchaseField('Item Code')).toBe('itemCode');
    expect(purchaseField(' OR No. ')).toBe('reference');
    expect(purchaseField('Total Paid')).toBe('amountPaid');
    expect(purchaseField('Quantity')).toBe('qty');
    expect(purchaseField('Colour')).toBeNull();
  });

  it('turns sheet rows into import rows, dropping unknown columns', () => {
    const rows = toPurchaseRows([{ Date: '2026-11-01', 'OR No': 'OR-9', SKU: 'RICE-25', Quantity: '3', Amount: '3,600', Extra: 'x' }]);
    expect(rows).toEqual([{ date: '2026-11-01', reference: 'OR-9', itemCode: 'RICE-25', qty: '3', amountPaid: '3,600' }]);
  });

  it('says which needed columns are missing', () => {
    expect(missingPurchaseColumns(['Date', 'Product', 'Qty'])).toEqual(['Amount Paid']);
    expect(missingPurchaseColumns(['Date', 'Code', 'Qty', 'Paid'])).toEqual([]);
  });
});
