// Server-side error capture.
//
// Every 5xx the app returns is recorded to a CAPPED collection in the tenant's
// own database, so errors never leave the box and can never fill the disk -
// MongoDB evicts the oldest documents once the cap is reached.
//
// WHY a module and not just pino: in production the API masks the real message
// ("Internal server error") before it reaches the client, and pino-http only
// sees the status code. The real `err` exists solely inside each route's catch
// block, so capture has to happen there.
//
// Nothing in here may throw. An error in the error logger would turn a handled
// 500 into a crash.

import mongoose from 'mongoose';
import crypto from 'node:crypto';

const COLLECTION = 'errorevents';
const CAP_BYTES = 32 * 1024 * 1024;   // ~32 MB of history per tenant
const CAP_DOCS = 20000;

let Model = null;
let ready = false;

const ErrorEventSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  // Stable hash of route + message, so the UI can group repeats into one row.
  signature: String,
  method: String,
  route: String,
  status: { type: Number, default: 500 },
  message: String,
  stack: String,
  userCode: String,
  role: String,
  kind: { type: String, default: 'request' },  // request | uncaught | rejection
}, { capped: { size: CAP_BYTES, max: CAP_DOCS }, versionKey: false });

export function initErrorLog() {
  try {
    Model = mongoose.models[COLLECTION] || mongoose.model(COLLECTION, ErrorEventSchema, COLLECTION);
    ready = true;
    installProcessHandlers();
  } catch (e) {
    console.error('[errorLog] init failed:', e.message);
  }
  return Model;
}

// Strips anything that could carry customer data or secrets out of the route.
// /api/orders/6a69.../cancel -> /api/orders/:id/cancel
function normalizeRoute(req) {
  const raw = (req?.originalUrl || req?.url || '').split('?')[0];
  return raw
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 200);
}

const sign = (route, message) =>
  crypto.createHash('sha1').update(`${route}|${message}`).digest('hex').slice(0, 12);

/**
 * Record a handled server error. Safe to call from any catch block.
 * Never throws and never awaits - the response should not wait on logging.
 */
export function captureError(req, err, { status = 500, kind = 'request' } = {}) {
  try {
    if (!ready || !Model) return;
    const message = String(err?.message || err || 'Unknown error').slice(0, 500);
    const route = normalizeRoute(req);
    Model.create({
      signature: sign(route, message),
      method: req?.method || '-',
      route,
      status,
      message,
      stack: String(err?.stack || '').slice(0, 4000),
      userCode: req?.user?.userCode || req?.user?.clientCode || null,
      role: req?.user?.role || null,
      kind,
    }).catch(() => { /* logging must never break the request */ });
  } catch { /* as above */ }
}

let handlersInstalled = false;
function installProcessHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  // These have no request context but are the most valuable errors to see -
  // they're the ones that can take the process down.
  process.on('unhandledRejection', (reason) => {
    captureError(null, reason instanceof Error ? reason : new Error(String(reason)), { kind: 'rejection' });
  });
  process.on('uncaughtException', (err) => {
    captureError(null, err, { kind: 'uncaught' });
    console.error('[uncaughtException]', err);
  });
}

/** Grouped view for the control plane: most frequent signatures first. */
export async function summarize({ hours = 24, limit = 50 } = {}) {
  if (!ready || !Model) return [];
  const since = new Date(Date.now() - hours * 3600_000);
  return Model.aggregate([
    { $match: { at: { $gte: since } } },
    { $group: {
        _id: '$signature',
        count: { $sum: 1 },
        lastSeen: { $max: '$at' },
        firstSeen: { $min: '$at' },
        method: { $first: '$method' },
        route: { $first: '$route' },
        message: { $first: '$message' },
        status: { $first: '$status' },
        kind: { $first: '$kind' },
        stack: { $first: '$stack' },
      } },
    { $sort: { count: -1, lastSeen: -1 } },
    { $limit: limit },
  ]);
}

export async function recent({ limit = 100 } = {}) {
  if (!ready || !Model) return [];
  return Model.find({}, { stack: 0 }).sort({ $natural: -1 }).limit(limit).lean();
}
