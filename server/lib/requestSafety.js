// Two protections every route gets without having to remember them.

// ── 1. No query operators from the outside ──────────────────────────────────
// A value from a request body or query string goes straight into Mongo
// filters all over this codebase - `{ code }`, `{ username }`, `{ sessionId }`.
// JSON lets the caller send an object where a string was expected, and an
// object with a `$` key is a query operator: `{ "code": { "$ne": null } }`
// matches every document instead of the one named. Nothing a client
// legitimately sends has a key starting with `$`, so they are removed before
// any route sees the request.
function stripOperators(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) stripOperators(item, depth + 1);
    return value;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith('$')) delete value[key];
    else stripOperators(value[key], depth + 1);
  }
  return value;
}

export function stripQueryOperators(req, _res, next) {
  stripOperators(req.body);
  stripOperators(req.query);
  next();
}

// ── 2. An async route that throws answers 500 instead of killing the server ─
// Express 4 does not look at the promise an async handler returns. A handler
// with no try/catch that throws - a database hiccup, a value of the wrong type
// - leaves an unhandled rejection, and this server exits on one of those by
// design (see fatalExit in server.js). Wrapping every handler as it is
// registered sends the error to the error middleware instead: the request gets
// a 500, and every other till stays up.
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];

function forward(fn) {
  if (typeof fn !== 'function' || fn.length >= 4) return fn;   // error handlers stay as they are
  return function wrapped(req, res, next) {
    try {
      const out = fn.call(this, req, res, next);
      if (out && typeof out.then === 'function') out.catch(next);
      return out;
    } catch (err) {
      return next(err);
    }
  };
}

export function forwardAsyncErrors(app) {
  for (const m of METHODS) {
    const original = app[m].bind(app);
    app[m] = (...args) => {
      // app.get('trust proxy') with one argument reads a setting.
      if (args.length < 2) return original(...args);
      return original(...args.map((a) => (Array.isArray(a) ? a.map(forward) : forward(a))));
    };
  }
  return app;
}

// ── Client errors thrown deep in a handler ───────────────────────────────────
// An error carrying a 4xx `status` (a closed accounting period, a state
// conflict) is the caller's to fix. Most route catch blocks answer every
// caught error with a hard-coded 500 and, in production, "Internal server
// error" - which hid the reason from the person who could act on it.
// captureError() records the error on the request; this middleware turns that
// 500 back into the error's own status and message.
export const isClientError = (err) => {
  const s = Number(err?.status);
  return Number.isInteger(s) && s >= 400 && s < 500;
};

export function clientErrorStatus(req, res, next) {
  const status = res.status.bind(res);
  const json = res.json.bind(res);
  let clientError = null;
  res.status = (code) => {
    if (code === 500 && isClientError(req.__lastError)) {
      clientError = req.__lastError;
      return status(clientError.status);
    }
    return status(code);
  };
  res.json = (body) => {
    if (clientError && body && typeof body === 'object' && body.success === false) {
      body = { ...body, error: clientError.message, ...(clientError.code ? { code: clientError.code } : {}) };
      clientError = null;
    }
    return json(body);
  };
  next();
}
