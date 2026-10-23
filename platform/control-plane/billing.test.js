import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthsBetween, billingRow } from './billing.js';

test('months run across a year end, inclusive', () => {
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(monthsBetween('2026-10', '2026-10'), ['2026-10']);
});

test('unpaid months since setup are owed at the monthly fee', () => {
  const row = billingRow({ createdAt: '2026-07-15T03:00:00Z', billing: { monthlyFee: 1500, paidMonths: ['2026-07', '2026-09'] } }, '2026-10');
  assert.equal(row.monthsBilled, 4);
  assert.deepEqual(row.unpaidMonths, ['2026-08', '2026-10']);
  assert.equal(row.outstanding, 3000);
  assert.equal(row.collected, 3000);
  assert.equal(row.paidThisMonth, false);
});

test('billFrom overrides the setup month; no fee means nothing is owed in pesos', () => {
  const row = billingRow({ createdAt: '2026-01-01T00:00:00Z', billing: { monthlyFee: null, paidMonths: [], billFrom: '2026-09' } }, '2026-10');
  assert.equal(row.billFrom, '2026-09');
  assert.equal(row.monthsBilled, 2);
  assert.equal(row.outstanding, null);
});

test('a client with no setup date or a future start is billed for this month only', () => {
  assert.equal(billingRow({}, '2026-10').monthsBilled, 1);
  assert.equal(billingRow({ billing: { billFrom: '2027-01', monthlyFee: 500 } }, '2026-10').outstanding, 500);
});
