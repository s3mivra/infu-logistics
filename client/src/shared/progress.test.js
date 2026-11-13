// The progress panel's tracker: tasks start, move, end; slow requests show up;
// spreadsheet reads and saves report themselves.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { subscribeProgress, startTask, updateTask, endTask, track, _resetProgress } from './progress.js';
import { lagNote } from './ProgressPanel.jsx';
import { wrapXlsx } from './xlsx.js';

let seen;
beforeEach(() => { _resetProgress(); seen = []; subscribeProgress((list) => { seen = list; }); });

describe('tasks', () => {
  it('start, report how far along, and end with a tick or a cross', () => {
    const id = startTask('Importing 600 day(s)', { total: 3 });
    updateTask(id, { done: 2 });
    expect(seen[0]).toMatchObject({ label: 'Importing 600 day(s)', done: 2, total: 3, endedAt: null });
    endTask(id, { ok: true });
    expect(seen[0].ok).toBe(true);
    expect(seen[0].endedAt).toBeTruthy();
  });

  it('track() ends the task however the work ends', async () => {
    await track('Saving', async (step) => { step(1, 2); });
    expect(seen[0].ok).toBe(true);
    await expect(track('Failing', async () => { throw new Error('server said no'); })).rejects.toThrow();
    expect(seen.find((t) => t.label === 'Failing')).toMatchObject({ ok: false, message: 'server said no' });
  });
});

describe('lag', () => {
  it('says "still working" and then "taking longer than usual"', () => {
    expect(lagNote(3)).toBe('');
    expect(lagNote(10)).toMatch(/Still working/);
    expect(lagNote(45)).toMatch(/longer than usual/);
  });
});

describe('spreadsheets', () => {
  it('reading and saving report to the panel', () => {
    const XLSX = wrapXlsx({ utils: {}, read: () => ({ SheetNames: [] }), writeFile: vi.fn() });
    XLSX.read(new Uint8Array());
    XLSX.writeFile({}, 'Purchases.xlsx');
    expect(seen.map((t) => t.label)).toEqual(['Reading the spreadsheet…', 'Saving Purchases.xlsx…']);
    expect(seen.every((t) => t.ok)).toBe(true);
  });
});

describe('slow requests', () => {
  it('a request still waiting after the threshold appears, labelled by what it is', async () => {
    vi.useFakeTimers();
    const { apiFetch, SLOW_REQUEST_MS, requestLabel } = await import('../features/auth/auth.js');
    expect(requestLabel('/api/purchases/import', 'POST')).toBe('Importing…');
    expect(requestLabel('/api/privacy/person?type=client&export=1')).toBe('Preparing the export…');
    let answer;
    globalThis.fetch = vi.fn(() => new Promise((r) => { answer = r; }));
    const pending = apiFetch('http://api.test', '/api/orders/import', { method: 'POST', body: '{}' });
    await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS + 10);
    expect(seen.find((t) => t.label === 'Importing…')?.endedAt).toBeNull();
    answer(new Response('{}', { status: 200 }));
    await pending;
    expect(seen.find((t) => t.label === 'Importing…').ok).toBe(true);
    vi.useRealTimers();
  });
});
