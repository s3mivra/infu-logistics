// lib/jobLock.js: one copy of the API runs each job (2026-11 audit, M46).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootApp } from './helpers/harness.js';
import { claimJob, releaseJob, runExclusive, waitForRelease } from '../lib/jobLock.js';

let ctx;
beforeAll(async () => { ctx = await bootApp({ businessType: 'fb' }); }, 120000);
afterAll(async () => { await ctx.stop(); });

describe('job lease', () => {
  it('of many copies asking at once, exactly one gets it', async () => {
    const owners = ['a', 'b', 'c', 'd', 'e', 'f'];
    const got = await Promise.all(owners.map((owner) => claimJob('race-test', 60_000, { owner })));
    expect(got.filter(Boolean)).toHaveLength(1);
  });

  it('the holder can renew; the others cannot take it until it runs out', async () => {
    expect(await claimJob('renew-test', 60_000, { owner: 'a' })).toBe(true);
    expect(await claimJob('renew-test', 60_000, { owner: 'a' })).toBe(true);
    expect(await claimJob('renew-test', 60_000, { owner: 'b' })).toBe(false);
  });

  it('a lease that ran out (a copy that died) is taken over', async () => {
    const past = new Date(Date.now() - 120_000);
    expect(await claimJob('expiry-test', 60_000, { owner: 'dead', now: past })).toBe(true);
    expect(await claimJob('expiry-test', 60_000, { owner: 'alive' })).toBe(true);
  });

  it('a once-a-day claim keeps the others out for that day', async () => {
    expect(await claimJob('midnight-close:2026-11-13', 12 * 3600_000, { owner: 'a' })).toBe(true);
    expect(await claimJob('midnight-close:2026-11-13', 12 * 3600_000, { owner: 'b' })).toBe(false);
    expect(await claimJob('midnight-close:2026-11-14', 12 * 3600_000, { owner: 'b' })).toBe(true);
  });

  it('runExclusive runs for one copy at a time and releases afterwards', async () => {
    let inside = 0, most = 0;
    const job = async () => { inside += 1; most = Math.max(most, inside); await new Promise((r) => setTimeout(r, 50)); inside -= 1; };
    const runs = await Promise.all(['a', 'b', 'c'].map((owner) => runExclusive('startup-test', 60_000, job, { owner })));
    expect(runs.filter((r) => r.ran)).toHaveLength(1);
    expect(most).toBe(1);
    expect(await claimJob('startup-test', 60_000, { owner: 'z' })).toBe(true);   // released
  });

  it('waitForRelease returns once the holder lets go', async () => {
    await claimJob('wait-test', 60_000, { owner: 'a' });
    setTimeout(() => { releaseJob('wait-test', { owner: 'a' }); }, 100);
    expect(await waitForRelease('wait-test', { timeoutMs: 5000, pollMs: 20 })).toBe(true);
  });
});
