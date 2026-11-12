// 2026-11 audit, M111: a chunk missing after a deploy reloads once, not forever.
import { describe, it, expect, vi } from 'vitest';
import { importWithRetry } from './lazyRetry.js';

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/Ledger-abc123.js');

describe('importWithRetry', () => {
  it('a dropped connection: the second try loads it, no reload', async () => {
    const factory = vi.fn().mockRejectedValueOnce(chunkError()).mockResolvedValueOnce({ default: 'Tab' });
    const reload = vi.fn();
    expect(await importWithRetry(factory, { retryDelayMs: 0, storage: memStorage(), reload })).toEqual({ default: 'Tab' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('a deploy renamed the chunk: reloads once to fetch the new build', async () => {
    const reload = vi.fn();
    const storage = memStorage();
    const pending = importWithRetry(() => Promise.reject(chunkError()), { retryDelayMs: 0, storage, reload });
    await new Promise((r) => setTimeout(r, 5));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem('semivra.chunkReloadAt')).toBeTruthy();
    void pending;   // never settles: the page is reloading
  });

  it('just reloaded and still missing: the error reaches the boundary instead of a reload loop', async () => {
    const reload = vi.fn();
    const storage = memStorage();
    storage.setItem('semivra.chunkReloadAt', String(Date.now()));
    await expect(importWithRetry(() => Promise.reject(chunkError()), { retryDelayMs: 0, storage, reload })).rejects.toThrow(/dynamically imported/);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a real bug in the module is not retried', async () => {
    const factory = vi.fn().mockRejectedValue(new ReferenceError('x is not defined'));
    await expect(importWithRetry(factory, { retryDelayMs: 0, storage: memStorage(), reload: vi.fn() })).rejects.toThrow(/x is not defined/);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
