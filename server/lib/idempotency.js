// Collapses duplicate write requests so a laggy connection cannot turn one
// click into several records.
//
// THE PROBLEM. A cashier presses "Create", nothing visibly happens because the
// network is slow, so they press it twice more. Three POSTs arrive, all valid,
// all authenticated, and three orders (or bills, or purchase orders) are
// created. The damage is silent - the ledger balances, every document is
// individually correct, and nobody notices until a reconciliation.
//
// THE APPROACH. The extra clicks are *concurrent* with the first: the user is
// clicking precisely because the first request has not come back yet. So the
// rule is to collapse requests that are genuinely in flight at the same time,
// and nothing else. A duplicate waits for the original and is then served the
// original's exact response, so the client sees one success rather than an
// error it has to explain.
//
// WHY NOT A TIME WINDOW. "Ignore identical requests for the next 10 seconds"
// would also swallow legitimate repeats - two customers buying the same single
// coffee, paid separately, seconds apart. Those are sequential, not concurrent,
// so in-flight collapsing never touches them. Correctness here matters more
// than catching the rarer case of a click that lands after the first finished;
// the client-side in-flight guard covers that one.
//
// AN EXPLICIT KEY IS STRONGER. A caller that sends `Idempotency-Key` gets the
// original response replayed for a grace period after completion too, which
// survives a reload or a second tab. Nothing in the app is required to send
// one; without it, the fingerprint path above applies.
//
// SCOPE. Single-process only - the map lives in this instance's memory. Behind
// several server instances without sticky routing, two clicks can land on
// different processes and both proceed. That is a real limit, not an oversight:
// a shared store (Redis, or a unique index on the document itself) is the fix
// if this ever runs multi-instance.
import crypto from 'node:crypto';

// How long a duplicate will wait for the original before giving up. Past this
// the original is pathological, and answering "already processing" is safer
// than starting a second one.
const WAIT_TIMEOUT_MS = 30_000;
// How long an explicit Idempotency-Key keeps its result replayable.
const EXPLICIT_KEY_TTL_MS = 60_000;
// Hard cap so a flood cannot grow the map without bound.
const MAX_TRACKED = 5000;

// Login and refresh mint tokens and set cookies; collapsing them would hand two
// sessions the same response. Health checks are not writes worth tracking.
const SKIP = [
  '/api/users/login',
  '/api/users/refresh',
  '/api/users/logout',
  '/api/clients/login',
  '/api/clients/refresh',
];

export function createIdempotencyMiddleware({ log } = {}) {
  /** fingerprint -> { done: bool, waiters: [], status, body, isJson, timer } */
  const inFlight = new Map();

  const fingerprint = (req) => {
    const explicit = req.get('Idempotency-Key');
    // The caller's identity comes from the bearer token: this middleware runs
    // before any route's verifyToken, so req.user does not exist yet. Hashing
    // keeps the token out of the map's keys.
    const who = crypto.createHash('sha256')
      .update(String(req.get('Authorization') || req.ip || ''))
      .digest('hex').slice(0, 16);
    if (explicit) return { key: `k:${who}:${String(explicit).slice(0, 200)}`, explicit: true };
    const body = (() => { try { return JSON.stringify(req.body ?? {}); } catch { return ''; } })();
    const key = crypto.createHash('sha256')
      .update(`${who}|${req.method}|${req.originalUrl}|${body}`)
      .digest('hex');
    return { key: `f:${key}`, explicit: false };
  };

  const replay = (res, entry) => {
    res.setHeader('X-Idempotent-Replay', '1');
    if (entry.isJson) return res.status(entry.status).json(entry.body);
    return res.status(entry.status).send(entry.body);
  };

  return function idempotency(req, res, next) {
    // Only creates. PATCH/PUT are naturally idempotent here (they address an
    // existing document by id), and DELETE twice is already harmless.
    if (req.method !== 'POST') return next();
    if (!req.originalUrl.startsWith('/api/')) return next();
    if (SKIP.some(p => req.originalUrl.startsWith(p))) return next();

    const { key, explicit } = fingerprint(req);
    const existing = inFlight.get(key);

    if (existing) {
      if (existing.done) return replay(res, existing);
      // Still running: wait for it rather than starting a second one.
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        existing.waiters = existing.waiters.filter(w => w.fn !== onDone);
        res.status(409).json({
          success: false,
          error: 'This request is already being processed. Please wait a moment before trying again.',
        });
      }, WAIT_TIMEOUT_MS);
      const onDone = (entry) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        replay(res, entry);
      };
      existing.waiters.push({ fn: onDone });
      return undefined;
    }

    if (inFlight.size >= MAX_TRACKED) {
      // Degrade to no protection rather than refusing real work.
      log?.warn?.({ size: inFlight.size }, 'idempotency: tracker full, passing request through');
      return next();
    }

    const entry = { done: false, waiters: [], status: 200, body: undefined, isJson: true, captured: false };
    inFlight.set(key, entry);

    // Capture whatever the route ends up sending, so waiters get the identical
    // response instead of a re-run.
    //
    // Only the FIRST of these to fire is recorded. Express implements res.json
    // by serialising and calling res.send, so without the guard the send
    // wrapper overwrites the json capture with the already-stringified body -
    // which then replays as text/html and arrives at the client as an
    // unparseable response whose text just happens to look like JSON.
    const origJson = res.json.bind(res);
    const origSend = res.send.bind(res);
    res.json = (payload) => {
      if (!entry.captured) { entry.captured = true; entry.status = res.statusCode; entry.body = payload; entry.isJson = true; }
      return origJson(payload);
    };
    res.send = (payload) => {
      if (!entry.captured) { entry.captured = true; entry.status = res.statusCode; entry.body = payload; entry.isJson = false; }
      return origSend(payload);
    };

    const settle = () => {
      if (entry.done) return;
      entry.done = true;
      const waiters = entry.waiters.splice(0);
      for (const w of waiters) { try { w.fn(entry); } catch { /* a waiter that already went away */ } }
      if (explicit && entry.body !== undefined) {
        // Keep an explicitly-keyed result replayable for a short grace period.
        entry.timer = setTimeout(() => inFlight.delete(key), EXPLICIT_KEY_TTL_MS);
        entry.timer.unref?.();
      } else {
        // Fingerprinted requests are collapsed only while concurrent, so the
        // entry goes as soon as the original finishes.
        inFlight.delete(key);
      }
    };

    // 'finish' covers a normal response; 'close' covers a dropped connection or
    // a route that never answers, so a stuck key cannot block later attempts.
    res.on('finish', settle);
    res.on('close', settle);

    return next();
  };
}
