// Pure authorization helpers — no Express, no jwt, no env. Unit-testable in isolation.
//
// These encode WHO may pass the staff gate vs the client gate, given an ALREADY-
// decoded JWT payload ({ role, aud, ... }). The Express middleware in server.js does
// the signature/expiry verification (jwt.verify), then delegates the aud/role
// decision to these functions. Keeping the decision logic pure lets us unit-test
// every branch without booting the server or a database.

// The only roles permitted on staff routes. Allowlist (fail-closed): anything not
// listed here — 'client', an unknown string, or a missing role — is denied.
export const STAFF_ROLES = new Set(['superadmin', 'admin', 'manager', 'finance', 'cashier', 'staff']);

const norm = (v) => String(v == null ? '' : v).toLowerCase();

// Decide whether a decoded token may access a STAFF route.
// Precedence:
//   1. aud beats role — an explicit aud:'client' is rejected even if the role string
//      looks staffish. A client-audience token must never satisfy the staff gate.
//   2. role allowlist — pass only the six staff roles.
//   3. fail closed — unknown/missing role, or role:'client' carrying no aud, is denied.
//
// TRANSITIONAL LENIENCY: a token with NO aud claim is accepted as long as its role is
// a staff role. This avoids logging out staff whose access tokens were minted before
// the aud claim shipped. The access-token TTL is 15m, so legacy tokens drain quickly.
// STRICT FLIP (do this after ~one TTL window post-deploy): require aud === 'staff' by
// replacing the marked guard below — see the inline STRICT comment.
export function evaluateStaffAccess(user) {
  const aud = user && user.aud;            // undefined on legacy (pre-aud) tokens
  const role = norm(user && user.role);
  if (aud === 'client') return { ok: false, reason: 'client-audience' };
  // STRICT (post-transition): replace the next line with
  //   if (aud !== 'staff') return { ok: false, reason: 'missing-staff-audience' };
  if (STAFF_ROLES.has(role)) return { ok: true, reason: 'staff-role' };
  return { ok: false, reason: 'not-staff-role' };
}

// Decide whether a decoded token may access a CLIENT-scoped route.
// Strict: BOTH aud:'client' AND role:'client' are required. A missing aud is rejected
// (no legacy fallback) — clients simply re-authenticate after deploy. This guards the
// two client-portal routes only.
export function evaluateClientAccess(user) {
  const aud = user && user.aud;
  const role = norm(user && user.role);
  if (aud === 'client' && role === 'client') return { ok: true, reason: 'client' };
  return { ok: false, reason: 'not-client' };
}

// Express middleware (pure: reads req.user, no jwt/env). Mount AFTER verifyToken so a
// malformed/expired token is already rejected before role logic runs. This is the
// named, tested staff guard; verifyToken additionally rejects aud:'client' structurally
// so staff routes are client-hostile by default (defense-in-depth).
export function requireStaff(req, res, next) {
  if (evaluateStaffAccess(req.user).ok) return next();
  return res.status(403).json({ success: false, error: 'Forbidden: staff access required.' });
}
