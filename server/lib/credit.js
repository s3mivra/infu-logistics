// Client credit limits and A/R ageing — pure functions, no DB access.
//
// Two independent concerns live here on purpose:
//   • resolveCreditLimit  — which limit applies to a given client, if any
//   • ageingBuckets       — how outstanding receivables split by age
// Keeping them pure means the money rules are unit-testable without booting a
// server, which is how the off-by-one on bucket edges got caught.

// How limits are applied across the business. Chosen by the owner in Settings.
//   'off'        — nobody has a limit; on-account selling is unrestricted
//   'per_client' — only clients with their own creditLimit are restricted
//   'global'     — one limit applies to every client; per-client values ignored
//   'both'       — global default, overridden by a client's own value when set
export const CREDIT_MODES = ['off', 'per_client', 'global', 'both'];
export const DEFAULT_CREDIT_MODE = 'off';

/**
 * Decide the peso credit limit in force for one client.
 * Returns null when the client is unrestricted.
 *
 * A client's own limit of 0 is meaningful ("cash only") and must not be
 * confused with null ("no limit set") — hence the explicit null checks rather
 * than truthiness anywhere in here.
 */
export function resolveCreditLimit({ mode, globalLimit, clientLimit }) {
  const m = CREDIT_MODES.includes(mode) ? mode : DEFAULT_CREDIT_MODE;
  const g = Number.isFinite(Number(globalLimit)) && globalLimit !== null ? Number(globalLimit) : null;
  const c = Number.isFinite(Number(clientLimit)) && clientLimit !== null ? Number(clientLimit) : null;

  switch (m) {
    case 'off':        return null;
    case 'per_client': return c;
    case 'global':     return g;
    case 'both':       return c !== null ? c : g;
    default:           return null;
  }
}

/**
 * Would this order breach the client's limit?
 * `outstanding` is what they already owe; `orderTotal` is the new charge.
 *
 * Returns { allowed, limit, outstanding, projected, available }.
 * A null limit always allows.
 */
export function checkCreditAvailable({ limit, outstanding = 0, orderTotal = 0 }) {
  const out = Number(outstanding) || 0;
  const amt = Number(orderTotal) || 0;
  if (limit === null || limit === undefined) {
    return { allowed: true, limit: null, outstanding: out, projected: out + amt, available: null };
  }
  const lim = Number(limit) || 0;
  const projected = out + amt;
  return {
    allowed: projected <= lim,
    limit: lim,
    outstanding: out,
    projected,
    available: Math.max(0, lim - out),
  };
}

// Bucket edges in days. An invoice is "current" up to and including 30 days old.
export const AGEING_BUCKETS = ['current', 'd31_60', 'd61_90', 'd90_plus'];

/** Which bucket an invoice of `age` days belongs to. */
export function bucketFor(ageDays) {
  const d = Number(ageDays) || 0;
  if (d <= 30) return 'current';
  if (d <= 60) return 'd31_60';
  if (d <= 90) return 'd61_90';
  return 'd90_plus';
}

/**
 * Split receivables into ageing buckets.
 * `rows` are { total, createdAt }; `asOf` defaults to now.
 * Returns per-bucket totals plus the overall sum.
 */
export function ageingBuckets(rows = [], asOf = new Date()) {
  const out = { current: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
  for (const r of rows) {
    const age = Math.floor((asOf - new Date(r.createdAt)) / 86400000);
    const amt = Number(r.total) || 0;
    out[bucketFor(age)] += amt;
    out.total += amt;
  }
  // Round once at the end — summing rounded values drifts.
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

/** Group rows by client and age each group. `keyOf` extracts the grouping key. */
export function ageingByClient(rows = [], keyOf = (r) => r.customerName || 'Unknown', asOf = new Date()) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()]
    .map(([client, list]) => ({ client, ...ageingBuckets(list, asOf), count: list.length }))
    .sort((a, b) => b.total - a.total);
}
