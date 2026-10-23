import { describe, it, expect } from 'vitest';
import { lookupBarcode, needsChoice, scannedLine, addScanned } from './barcodeCart.js';

const fakeFetch = (status, body) => async () => ({ status, ok: status < 400, json: async () => body });

describe('barcode scanning at the till', () => {
  it('reads found / ambiguous / missing / error', async () => {
    const p = { _id: 'p1', name: 'Soap', basePrice: 50 };
    expect(await lookupBarcode(fakeFetch(200, { success: true, product: p }), '123')).toEqual({ kind: 'found', product: p });
    expect((await lookupBarcode(fakeFetch(200, { success: true, product: p, ambiguous: true, matchCount: 3 }), '123')).kind).toBe('ambiguous');
    expect((await lookupBarcode(fakeFetch(404, { success: false }), '123')).kind).toBe('missing');
    expect((await lookupBarcode(async () => { throw new Error('offline'); }, '123')).kind).toBe('error');
  });

  it('never guesses a size or a required option', () => {
    expect(needsChoice({ sizes: [{ name: 'L', price: 1 }] })).toBe(true);
    expect(needsChoice({ modifierGroups: ['g1'] }, [{ _id: 'g1', isRequired: true }])).toBe(true);
    expect(needsChoice({ modifierGroups: ['g1'] }, [{ _id: 'g1', isRequired: false }])).toBe(false);
    expect(needsChoice({ name: 'plain' })).toBe(false);
  });

  it('a second scan of the same item bumps the quantity', () => {
    const line = scannedLine({ _id: 'p1', name: 'Soap', basePrice: 50 }, { department: 'Kitchen' });
    let cart = addScanned([], line);
    cart = addScanned(cart, line);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
    // A line with add-ons is a different thing
    const withAddOn = [{ ...line, selectedAddOns: [{ name: 'x', price: 1 }] }];
    expect(addScanned(withAddOn, line)).toHaveLength(2);
  });

  it('uses the sale price when there is one', () => {
    expect(scannedLine({ _id: 'p', name: 'n', basePrice: 100, activeSalePrice: 80 }).price).toBe(80);
  });
});
