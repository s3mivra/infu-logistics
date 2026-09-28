// The offline queue must never lose a sale, and must never retry forever a
// sale the server will not take.
import { describe, it, expect, beforeEach } from 'vitest';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
const { queueOrder, getQueuedOrders, flushQueue, getRejectedOrders, queueClock, getQueuedClock, flushClockQueue } = await import('./pwa.js');

beforeEach(() => mem.clear());

describe('offline order queue', () => {
  it('keeps an order queued WHILE a flush is running (it used to be erased)', async () => {
    queueOrder({ n: 1 }, 'a');
    const flushing = flushQueue(async () => {
      // The cashier takes another order mid-flush.
      queueOrder({ n: 2 }, 'b');
      return 'sent';
    });
    await flushing;
    expect(getQueuedOrders().map(e => e.id)).toEqual(['b']);
  });

  it('moves a server refusal out of the retry queue and keeps its reason', async () => {
    queueOrder({ n: 1 }, 'bad');
    queueOrder({ n: 2 }, 'offline');
    const r = await flushQueue(async (e) => (e.id === 'bad'
      ? { status: 'rejected', reason: '"Mystery" is not on the menu.' }
      : 'retry'));
    expect(r).toMatchObject({ sent: 0, rejected: 1, remaining: 1 });
    expect(getQueuedOrders().map(e => e.id)).toEqual(['offline']);
    expect(getRejectedOrders()).toHaveLength(1);
    expect(getRejectedOrders()[0].reason).toMatch(/not on the menu/);
  });

  it('keeps an order that failed to send (offline or a server fault)', async () => {
    queueOrder({ n: 1 }, 'x');
    await flushQueue(async () => { throw new Error('network'); });
    expect(getQueuedOrders().map(e => e.id)).toEqual(['x']);
    expect(getRejectedOrders()).toHaveLength(0);
  });
});

describe('offline clock queue', () => {
  it('stops at the first failure so a shift is never recorded out of order', async () => {
    queueClock('in'); queueClock('out');
    const sentTypes = [];
    await flushClockQueue(async (e) => { if (e.type === 'in') return false; sentTypes.push(e.type); return true; });
    expect(sentTypes).toEqual([]);                          // the clock-out was NOT sent ahead of the clock-in
    expect(getQueuedClock().map(e => e.type)).toEqual(['in', 'out']);
  });

  it('keeps a clock event made while a flush is running', async () => {
    queueClock('in');
    await flushClockQueue(async () => { queueClock('out'); return true; });
    expect(getQueuedClock().map(e => e.type)).toEqual(['out']);
  });
});
