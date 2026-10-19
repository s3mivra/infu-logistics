import { describe, it, expect } from 'vitest';
import { threeWayMatch, normalizeInvoiceNo } from './threeWayMatch.js';

const po = (lines) => ({ lines });

describe('threeWayMatch', () => {
  it('matches when PO, receipt and invoice agree (within a peso)', () => {
    const r = threeWayMatch({ po: po([{ itemName: 'Cups', orderedQty: 10, receivedQty: 10, unitCost: 50 }]), receivedValue: 500, invoiceAmount: 500.4 });
    expect(r.status).toBe('Matched');
    expect(r.issues).toEqual([]);
  });
  it('flags an invoice that differs from the receipt and the PO', () => {
    const r = threeWayMatch({ po: po([{ orderedQty: 10, receivedQty: 10, unitCost: 50 }]), receivedValue: 500, invoiceAmount: 560 });
    expect(r.status).toBe('Exception');
    expect(r.issues.map((i) => i.code)).toEqual(['invoice_vs_receipt', 'invoice_vs_po']);
    expect(r.variance).toBe(60);
  });
  it('flags an over-receipt even when the money agrees', () => {
    const r = threeWayMatch({ po: po([{ itemName: 'Lids', orderedQty: 10, receivedQty: 12, unitCost: 5 }]), receivedValue: 60, invoiceAmount: 60 });
    expect(r.status).toBe('Exception');
    expect(r.issues[0].code).toBe('over_receipt');
  });
  it('values a short delivery at what arrived, not what was ordered', () => {
    const r = threeWayMatch({ po: po([{ orderedQty: 10, receivedQty: 6, unitCost: 50 }]), receivedValue: 300, invoiceAmount: 300 });
    expect(r).toMatchObject({ status: 'Matched', poValue: 300 });
  });
});

describe('normalizeInvoiceNo', () => {
  it('treats case, spaces and dashes as the same invoice', () => {
    expect(normalizeInvoiceNo(' inv-0012 ')).toBe(normalizeInvoiceNo('INV 0012'));
    expect(normalizeInvoiceNo('INV0012')).toBe('INV0012');
  });
});
