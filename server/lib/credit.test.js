import { describe, it, expect } from 'vitest';
import {
  resolveCreditLimit, checkCreditAvailable, bucketFor, ageingBuckets, ageingByClient,
} from './credit.js';

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

describe('resolveCreditLimit - which limit applies', () => {
  it('off: nobody is limited, even with values set', () => {
    expect(resolveCreditLimit({ mode: 'off', globalLimit: 5000, clientLimit: 100 })).toBe(null);
  });

  it('per_client: only the client value counts', () => {
    expect(resolveCreditLimit({ mode: 'per_client', globalLimit: 5000, clientLimit: 100 })).toBe(100);
    expect(resolveCreditLimit({ mode: 'per_client', globalLimit: 5000, clientLimit: null })).toBe(null);
  });

  it('global: one limit for everyone, per-client ignored', () => {
    expect(resolveCreditLimit({ mode: 'global', globalLimit: 5000, clientLimit: 100 })).toBe(5000);
    expect(resolveCreditLimit({ mode: 'global', globalLimit: null, clientLimit: 100 })).toBe(null);
  });

  it('both: the client value overrides the global default', () => {
    expect(resolveCreditLimit({ mode: 'both', globalLimit: 5000, clientLimit: 100 })).toBe(100);
    expect(resolveCreditLimit({ mode: 'both', globalLimit: 5000, clientLimit: null })).toBe(5000);
  });

  it('treats a client limit of 0 as "cash only", NOT as unset', () => {
    // The bug this guards: `clientLimit || globalLimit` would silently grant
    // a ₱5,000 limit to a client explicitly set to zero credit.
    expect(resolveCreditLimit({ mode: 'both', globalLimit: 5000, clientLimit: 0 })).toBe(0);
    expect(resolveCreditLimit({ mode: 'per_client', globalLimit: 5000, clientLimit: 0 })).toBe(0);
  });

  it('falls back to unrestricted on an unknown mode', () => {
    expect(resolveCreditLimit({ mode: 'nonsense', globalLimit: 5000, clientLimit: 100 })).toBe(null);
  });
});

describe('checkCreditAvailable', () => {
  it('allows anything when there is no limit', () => {
    const r = checkCreditAvailable({ limit: null, outstanding: 99999, orderTotal: 99999 });
    expect(r.allowed).toBe(true);
    expect(r.available).toBe(null);
  });

  it('allows an order that lands exactly on the limit', () => {
    const r = checkCreditAvailable({ limit: 1000, outstanding: 400, orderTotal: 600 });
    expect(r.allowed).toBe(true);
    expect(r.projected).toBe(1000);
    expect(r.available).toBe(600);
  });

  it('blocks the peso that goes over', () => {
    const r = checkCreditAvailable({ limit: 1000, outstanding: 400, orderTotal: 601 });
    expect(r.allowed).toBe(false);
    expect(r.projected).toBe(1001);
  });

  it('blocks every order for a zero-credit client', () => {
    expect(checkCreditAvailable({ limit: 0, outstanding: 0, orderTotal: 1 }).allowed).toBe(false);
    // ...but a zero-value order is not a breach
    expect(checkCreditAvailable({ limit: 0, outstanding: 0, orderTotal: 0 }).allowed).toBe(true);
  });

  it('never reports negative headroom when already over', () => {
    expect(checkCreditAvailable({ limit: 1000, outstanding: 1500, orderTotal: 0 }).available).toBe(0);
  });
});

describe('ageing buckets', () => {
  it('places invoices on the correct side of each edge', () => {
    expect(bucketFor(0)).toBe('current');
    expect(bucketFor(30)).toBe('current');    // 30 is still current
    expect(bucketFor(31)).toBe('d31_60');
    expect(bucketFor(60)).toBe('d31_60');
    expect(bucketFor(61)).toBe('d61_90');
    expect(bucketFor(90)).toBe('d61_90');
    expect(bucketFor(91)).toBe('d90_plus');
  });

  it('sums each bucket and the overall total', () => {
    const rows = [
      { total: 100, createdAt: daysAgo(5) },
      { total: 200, createdAt: daysAgo(45) },
      { total: 300, createdAt: daysAgo(75) },
      { total: 400, createdAt: daysAgo(200) },
      { total: 50,  createdAt: daysAgo(10) },
    ];
    const b = ageingBuckets(rows);
    expect(b.current).toBe(150);
    expect(b.d31_60).toBe(200);
    expect(b.d61_90).toBe(300);
    expect(b.d90_plus).toBe(400);
    expect(b.total).toBe(1050);
  });

  it('handles an empty ledger without NaN', () => {
    expect(ageingBuckets([])).toEqual({ current: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 });
  });

  it('does not drift when summing many centavo amounts', () => {
    const rows = Array.from({ length: 3 }, () => ({ total: 0.1, createdAt: daysAgo(1) }));
    expect(ageingBuckets(rows).current).toBe(0.3);   // not 0.30000000000000004
  });

  it('groups by client, biggest debtor first', () => {
    const rows = [
      { customerName: 'Small Co', total: 100, createdAt: daysAgo(5) },
      { customerName: 'Big Co',   total: 900, createdAt: daysAgo(70) },
      { customerName: 'Big Co',   total: 100, createdAt: daysAgo(5) },
    ];
    const out = ageingByClient(rows);
    expect(out[0].client).toBe('Big Co');
    expect(out[0].total).toBe(1000);
    expect(out[0].d61_90).toBe(900);
    expect(out[0].count).toBe(2);
    expect(out[1].client).toBe('Small Co');
  });
});
