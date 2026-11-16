// The Now Serving board: which orders show as preparing and which as ready.
import { describe, it, expect } from 'vitest';
import { queueState, displayState } from './customerDisplay.js';

const o = (n, status, items, extra = {}) => ({ orderNumber: `ORD-2026-${n}`, status, items: items.map((s) => ({ itemStatus: s })), createdAt: `2026-11-16T0${n % 10}:00:00Z`, ...extra });

describe('queueState', () => {
  it('sorts open orders into preparing and ready, and drops the rest', () => {
    const q = queueState([
      o(1, 'Preparing', ['Preparing', 'Received'], { customerName: 'Ana Cruz' }),
      o(2, 'Preparing', ['Finished', 'Finished']),
      o(3, 'Ready', ['Finished']),
      o(4, 'Completed', ['Delivered']),
      o(5, 'Preparing', ['Delivered', 'Delivered']),
      o(6, 'Pending', ['Received']),
      o(7, 'Preparing', ['Preparing'], { isParked: true }),
      o(8, 'Preparing', ['Preparing'], { customerName: 'Walk-in' }),
    ], 'Cafe');
    expect(q.kind).toBe('queue');
    expect(q.preparing.map((e) => e.number)).toEqual(['1', '8']);
    expect(q.ready.map((e) => e.number)).toEqual(['2', '3']);
    expect(q.preparing[0].name).toBe('Ana');
    expect(q.preparing[1].name).toBe('');
  });

  it('the order view is marked as the cart', () => {
    expect(displayState({ cart: [] }).kind).toBe('cart');
  });
});
