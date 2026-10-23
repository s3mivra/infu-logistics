import { describe, it, expect } from 'vitest';
import { pctChange, explainChanges, projectPayroll, costMovers } from './ownerInsights.js';

describe('ownerInsights', () => {
  it('pctChange has nothing to say against zero', () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(5, 0)).toBeNull();
  });

  it('names the cost rise behind a falling margin', () => {
    const out = explainChanges({
      cur: { revenue: 1000, cogs: 640, orders: 10 }, prev: { revenue: 1000, cogs: 600, orders: 10 },
      costMovers: [{ itemName: 'Flour', changePct: 12 }],
    });
    expect(out.find(i => i.kind === 'margin').text).toBe('Gross margin down 4 pts to 36% — Flour cost up 12%.');
  });

  it('ranks cost movers by what they cost the business', () => {
    const list = costMovers([
      { key: 'a', itemName: 'Garnish', period: 'cur', qty: 1, cost: 14 }, { key: 'a', itemName: 'Garnish', period: 'prev', qty: 1, cost: 10 },
      { key: 'b', itemName: 'Flour', period: 'cur', qty: 100, cost: 5500 }, { key: 'b', itemName: 'Flour', period: 'prev', qty: 100, cost: 5000 },
    ]);
    expect(list.map(c => c.itemName)).toEqual(['Flour', 'Garnish']);
  });

  it('repeats payroll at the usual gap', () => {
    const today = new Date('2026-01-01T00:00:00Z');
    const p = projectPayroll([{ payDate: '2025-12-27T00:00:00Z', net: 500, status: 'Paid' }, { payDate: '2025-12-13T00:00:00Z', net: 500, status: 'Paid' }], today, 30);
    expect(p.cadenceDays).toBe(14);
    expect(p.events.map(e => e.date.toISOString().slice(0, 10))).toEqual(['2026-01-10', '2026-01-24']);
  });
});
