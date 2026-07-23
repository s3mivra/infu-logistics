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

// ── PERMISSIONS (granular RBAC) ───────────────────────────────────────────────
// Fine-grained capabilities layered ON TOP of the coarse staff roles above. A
// permission key is `<domain>.<action>`. `manage` implies create+update; `delete`
// is called out separately so "view + update but not delete" is expressible.
//
// The canonical catalogue — the UI renders exactly these, grouped by domain.
export const PERMISSIONS = [
  { key: 'pos.use',            group: 'Sales',       label: 'Use POS / take sales' },
  { key: 'orders.view',        group: 'Sales',       label: 'View orders' },
  { key: 'orders.manage',      group: 'Sales',       label: 'Manage orders (edit/status)' },
  { key: 'orders.delete',      group: 'Sales',       label: 'Void / delete orders' },
  { key: 'inventory.view',     group: 'Inventory',   label: 'View inventory' },
  { key: 'inventory.manage',   group: 'Inventory',   label: 'Manage inventory (count/restock)' },
  { key: 'inventory.delete',   group: 'Inventory',   label: 'Delete inventory items' },
  { key: 'products.view',      group: 'Menu',        label: 'View menu / products' },
  { key: 'products.manage',    group: 'Menu',        label: 'Manage menu / products' },
  { key: 'procurement.view',   group: 'Procurement', label: 'View purchase orders' },
  { key: 'procurement.manage', group: 'Procurement', label: 'Manage POs & suppliers' },
  { key: 'procurement.delete', group: 'Procurement', label: 'Delete POs & suppliers' },
  { key: 'accounting.view',    group: 'Accounting',  label: 'View accounting / ledger' },
  { key: 'accounting.manage',  group: 'Accounting',  label: 'Post journal entries / manage books' },
  { key: 'reports.view',       group: 'Reports',     label: 'View reports' },
  { key: 'analytics.view',     group: 'Reports',     label: 'View analytics dashboard' },
  { key: 'audit.view',         group: 'Reports',     label: 'View audit report' },
  { key: 'users.manage',       group: 'Admin',       label: 'Manage staff & permissions' },
  { key: 'settings.manage',    group: 'Admin',       label: 'Change system settings' },
];
export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

// Sensible defaults per role, applied when a user has NO explicit permission
// override. Superadmin bypasses this entirely (full access). These are chosen to
// preserve today's behaviour so nothing breaks when the layer ships.
export const ROLE_DEFAULT_PERMISSIONS = {
  admin:   PERMISSIONS.map((p) => p.key).filter((k) => k !== 'users.manage'),
  manager: ['pos.use', 'orders.view', 'orders.manage', 'orders.delete', 'inventory.view', 'inventory.manage',
            'products.view', 'products.manage', 'procurement.view', 'procurement.manage',
            'accounting.view', 'reports.view', 'analytics.view', 'audit.view'],
  finance: ['orders.view', 'inventory.view', 'procurement.view',
            'accounting.view', 'accounting.manage', 'reports.view', 'analytics.view', 'audit.view'],
  cashier: ['pos.use', 'orders.view', 'orders.manage', 'inventory.view', 'products.view', 'procurement.view'],
  staff:   ['pos.use', 'orders.view', 'inventory.view', 'products.view'],
};

// Resolve a user's EFFECTIVE permission set.
//   - superadmin → every permission (bypass)
//   - explicit user.permissions (non-empty) → exactly those (intersected with the catalogue)
//   - otherwise → the role's defaults (empty for unknown roles)
export function resolvePermissions(user) {
  const role = norm(user && user.role);
  if (role === 'superadmin') return PERMISSIONS.map((p) => p.key);
  const explicit = Array.isArray(user && user.permissions) ? user.permissions.filter((k) => PERMISSION_KEYS.has(k)) : [];
  if (explicit.length) return explicit;
  return ROLE_DEFAULT_PERMISSIONS[role] || [];
}

// Does this (decoded token OR user doc) hold a given permission?
// Reads token `perms` when present; falls back to resolving from role/permissions
// so legacy tokens minted before `perms` shipped keep working.
export function hasPermission(user, perm) {
  if (!user) return false;
  if (norm(user.role) === 'superadmin') return true;
  const perms = Array.isArray(user.perms) ? user.perms : resolvePermissions(user);
  return perms.includes(perm);
}

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

// Middleware factory: require a specific granular permission. Mount AFTER
// verifyToken + requireStaff. Superadmin always passes; everyone else must hold
// the permission (via token `perms` or resolved role defaults).
export function requirePermission(perm) {
  return (req, res, next) => {
    if (hasPermission(req.user, perm)) return next();
    return res.status(403).json({ success: false, error: `Forbidden: missing permission "${perm}".` });
  };
}
