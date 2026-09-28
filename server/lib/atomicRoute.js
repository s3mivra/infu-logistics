// Run a whole route handler as ONE MongoDB transaction.
//
// An audit found 38 of 57 journal-entry writes outside any transaction. No
// single entry could be unbalanced (the schema forbids it), but a route that
// writes a journal entry AND other records - pays a bill, disposes an asset,
// settles a receivable - could half-fail: the bill marked paid with no entry
// in the books, or the reverse. That is exactly the drift the subledger
// tie-outs exist to catch.
//
// Converting ~30 handlers to thread a `session` through every query is where
// mistakes creep in. Instead, with mongoose's transactionAsyncLocalStorage on
// (see server.js), every query inside connection.transaction() joins the
// transaction by itself. This wrapper supplies that transaction and one more
// thing the handlers need: they catch their own errors and answer with a 4xx
// or 5xx, which would otherwise COMMIT whatever was written before the error.
// So the response is held until the transaction ends, and any error response
// rolls the whole request back before it is sent.
//
// On a standalone mongod (no replica set - a bare dev box) transactions are
// impossible; the handler then runs as before, without atomicity, exactly as
// lib/txn.js withOptionalTransaction already does.

class Rollback extends Error {}

// Error codes MongoDB uses for "try again": WriteConflict (112), LockTimeout
// (24), and anything the driver labels TransientTransactionError. The label is
// added when missing so withTransaction's own retry loop picks it up.
function isTransient(err) {
  if (!err) return false;
  const labelled = typeof err.hasErrorLabel === 'function' && err.hasErrorLabel('TransientTransactionError');
  const code = err.code ?? err.errorResponse?.code;
  const byCode = code === 112 || code === 24 || /Unable to acquire .* lock|WriteConflict/i.test(String(err.message || ''));
  if (byCode && !labelled && typeof err.addErrorLabel === 'function') err.addErrorLabel('TransientTransactionError');
  return labelled || byCode;
}

let supportsTxn = null;
async function transactionsSupported(mongoose) {
  if (supportsTxn !== null) return supportsTxn;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    supportsTxn = !!(hello.setName || hello.msg === 'isdbgrid');
  } catch { supportsTxn = false; }
  return supportsTxn;
}

// A stand-in for `res` that records the answer instead of sending it.
function holdResponse(res) {
  const held = { status: 200, kind: null, body: undefined, headers: [] };
  const proxy = new Proxy(res, {
    get(target, prop) {
      if (prop === 'status') return (code) => { held.status = code; return proxy; };
      if (prop === 'sendStatus') return (code) => { held.status = code; held.kind = 'end'; return proxy; };
      if (prop === 'json') return (body) => { held.kind = 'json'; held.body = body; return proxy; };
      if (prop === 'send') return (body) => { held.kind = 'send'; held.body = body; return proxy; };
      if (prop === 'end') return (body) => { held.kind = 'end'; held.body = body; return proxy; };
      if (prop === 'set' || prop === 'setHeader' || prop === 'header') {
        return (...args) => { held.headers.push(args); return proxy; };
      }
      if (prop === 'headersSent') return held.kind !== null;
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { proxy, held };
}

function deliver(res, held) {
  for (const args of held.headers) res.set(...args);
  res.status(held.status);
  if (held.kind === 'json') return res.json(held.body);
  if (held.kind === 'send') return res.send(held.body);
  return res.end(held.body);
}

export function atomic(mongoose, handler, { log } = {}) {
  return async (req, res, next) => {
    if (!(await transactionsSupported(mongoose))) return handler(req, res, next);

    let held;
    try {
      await mongoose.connection.transaction(async (session) => {
        // Open the transaction with one read on its own. A handler that starts
        // with Promise.all sends several first operations at once, and MongoDB
        // refuses all but one of them ("Only servers in a sharded cluster can
        // start a new transaction at the active transaction number").
        await mongoose.connection.db.collection('shifts').findOne({}, { session, projection: { _id: 1 } });
        // A transient write conflict re-runs this callback; start clean.
        const h = holdResponse(res);
        held = h.held;
        req.__lastError = undefined;
        await handler(req, h.proxy, next);
        if (held.kind === null) throw new Error('atomic route finished without answering');
        // The handler caught a TRANSIENT transaction error (a write conflict, or
        // a lock still held by an index build on a fresh collection) and turned
        // it into a 500. Re-throw the real error so MongoDB's withTransaction
        // retries the whole request, instead of the user seeing a failure that
        // would succeed a moment later.
        if (held.status >= 500 && isTransient(req.__lastError)) throw req.__lastError;
        if (held.status >= 400) throw new Rollback();     // the handler refused or failed: undo its writes
      });
    } catch (err) {
      if (!(err instanceof Rollback)) {
        (log?.error ?? console.error)({ err, path: req.originalUrl }, 'atomic route rolled back');
        if (!held || held.kind === null || held.status < 400) {
          held = { status: 500, kind: 'json', headers: [], body: { success: false, error: 'Internal server error' } };
        }
      }
    }
    return deliver(res, held);
  };
}

// For tests: forget the cached capability check.
export function _resetAtomicCache() { supportsTxn = null; }
