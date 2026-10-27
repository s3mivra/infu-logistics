import { describe, it, expect, beforeEach } from 'vitest';
import { paymentDetailsPayload, missingPaymentDetail, orderByUse, notePaymentMethodUsed, methodLabel } from './PaymentMethodPicker.jsx';

describe('payment method picker rules', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* no storage */ } });

  it('a check sends its number with the bank, and its date', () => {
    expect(paymentDetailsPayload('Check', { checkNumber: ' 0012345 ', checkBank: 'BDO', checkDate: '2026-11-30' }))
      .toEqual({ paymentReference: '0012345 · BDO', paymentCheckDate: '2026-11-30' });
    expect(missingPaymentDetail('Check', {})).toMatch(/check number/);
  });

  it('e-wallets and transfers send a reference; cash and on account send nothing', () => {
    expect(paymentDetailsPayload('GCash', { reference: 'REF9' })).toEqual({ paymentReference: 'REF9' });
    expect(paymentDetailsPayload('Cash', { reference: 'x' })).toEqual({});
    expect(paymentDetailsPayload('On Account', {})).toEqual({});
    expect(missingPaymentDetail('Cash', {})).toBe('');
  });

  it('the SOA wording, and the most used method first', () => {
    expect(methodLabel('Check')).toBe('Check / Dated Check');
    const base = ['Cash', 'GCash', 'Check'];
    expect(orderByUse(base)[0]).toBe('Cash');
    if (typeof localStorage !== 'undefined') {
      notePaymentMethodUsed('Check'); notePaymentMethodUsed('Check');
      expect(orderByUse(base)).toEqual(['Check', 'Cash', 'GCash']);
    }
  });
});
