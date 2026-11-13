// One copy of the API does each scheduled job, however many are running
// (2026-11 audit, M46). Every copy runs the same timers and the same startup
// migrations; without this, two copies both auto-closed the day at midnight,
// both raised the month's repeating bills, both sent the daily e-mail, and both
// ran a startup migration at once.
//
// A lease in the database: a document per job name holding who has it and
// until when. claim() takes it when it is free or expired, atomically, so of
// two copies asking at once exactly one gets it. A copy that dies mid-job
// simply lets its lease run out. A job meant to run once per day is claimed
// under a name with the date in it and never released, so the other copies
// skip that day.
import os from 'node:os';
import crypto from 'node:crypto';
import mongoose from 'mongoose';

// This process, as the holder of a lease.
export const LOCK_OWNER = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

const locks = () => mongoose.connection.collection('joblocks');

// -> true when this process now holds `name` for `ttlMs`; false when another does.
export async function claimJob(name, ttlMs, { owner = LOCK_OWNER, now = new Date() } = {}) {
  const until = new Date(now.getTime() + ttlMs);
  try {
    const r = await locks().findOneAndUpdate(
      { _id: name, $or: [{ expiresAt: { $lte: now } }, { owner }] },
      { $set: { owner, expiresAt: until, claimedAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    const doc = r && 'value' in r ? r.value : r;
    return !!doc && doc.owner === owner;
  } catch (err) {
    // Another process holds an unexpired lease: the filter did not match, and
    // the upsert then collided with its document.
    if (err?.code === 11000) return false;
    throw err;
  }
}

export async function releaseJob(name, { owner = LOCK_OWNER } = {}) {
  await locks().deleteOne({ _id: name, owner });
}

// Runs fn only when this process gets the lease; released afterwards unless
// `keep` (a once-per-period job keeps it so the others skip this period).
export async function runExclusive(name, ttlMs, fn, { keep = false, owner = LOCK_OWNER } = {}) {
  if (!(await claimJob(name, ttlMs, { owner }))) return { ran: false };
  try {
    return { ran: true, value: await fn() };
  } finally {
    if (!keep) await releaseJob(name, { owner }).catch(() => {});
  }
}

// Waits while another process holds `name` (e.g. the startup migrations), up
// to `timeoutMs`. -> true once it is free, false on timeout.
export async function waitForRelease(name, { timeoutMs = 15 * 60 * 1000, pollMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const doc = await locks().findOne({ _id: name });
    if (!doc || doc.expiresAt <= new Date()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
