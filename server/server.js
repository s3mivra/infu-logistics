import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { assertBalanced, debitAccountFor, suggestedSettleAccount } from './lib/ledger.js';
import { ACCOUNTS, EXPENSE_CATEGORIES, CODE_MAP } from './lib/chartOfAccounts.js';
import { resolveUnit, displayToBase, effectiveDisplay, UNIT_TO_BASE, unitTypeOf } from './lib/units.js';
import { title, code, lower, freeText, zTitle, zText, zMoneyLoose } from './lib/normalize.js';
import { addBatch, consumeBatches, consumeSpecificBatch, soonestExpiry, sortBatchesFEFO, batchesTotal } from './lib/expiry.js';
import { requireStaff, evaluateClientAccess, requirePermission, resolvePermissions, hasPermission, PERMISSIONS, PERMISSION_KEYS, ROLE_DEFAULT_PERMISSIONS, setCustomRolePermissions } from './lib/authz.js';
import { computePercentageTax, PERCENTAGE_TAX_RATE } from './lib/tax.js';
import { computeOrderVat, extractVat, normaliseVatRate, DEFAULT_VAT_RATE } from './lib/vat.js';
import { validateDateRange } from './lib/reportRange.js';
import { initErrorLog } from './lib/errorLog.js';
import registerTenants from './features/tenants.js';
import registerAddons from './features/addons.js';
import registerUsers from './features/users.js';
import registerClientPortal from './features/client-portal.js';
import registerPricing from './features/pricing.js';
import registerInventory from './features/inventory.js';
import registerProducts from './features/products.js';
import registerQrSessions from './features/qr-sessions.js';
import registerOrders from './features/orders.js';
import registerFinance from './features/finance.js';
import registerReports from './features/reports.js';
import registerShifts from './features/shifts.js';
import registerScheduling from './features/scheduling.js';
import registerDiscountRules from './features/discount-rules.js';
import registerPriceTiers from './features/price-tiers.js';
import registerAdminTools from './features/admin-tools.js';
import registerAudit from './features/audit.js';
import registerSettings from './features/settings.js';
import registerPurchaseOrders from './features/purchase-orders.js';
import registerBills from './features/bills.js';
import registerRequisitions from './features/requisitions.js';
import registerCollections from './features/collections.js';
import registerChangeRequests from './features/change-requests.js';
import registerNotifications from './features/notifications.js';
import registerClients from './features/clients.js';
import registerHub from './features/hub.js';

const log = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: 'semivra-pos' },
  ...(process.env.NODE_ENV !== 'production' && { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } } })
});

// Optional error monitoring - completely inert unless SENTRY_DSN is set.
const SENTRY_ON = !!process.env.SENTRY_DSN;
if (SENTRY_ON) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0, // error reporting only; no perf tracing overhead
  });
  log.info('Sentry error monitoring enabled');
}

// Fail fast on missing required env vars
if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  console.error('❌ MONGO_URI and JWT_SECRET must be set in .env - server will not start.');
  process.exit(1);
}

// Production config hardening - refuse to boot with weak/default secrets so a
// deployment can never silently ship a guessable signing key or admin password.
if (process.env.NODE_ENV === 'production') {
  const weakReasons = [];
  if ((process.env.JWT_SECRET || '').length < 32) {
    weakReasons.push('JWT_SECRET must be at least 32 chars (use `openssl rand -hex 32`)');
  }
  if (!process.env.ADMIN_PASS || process.env.ADMIN_PASS === 'ChangeMe@2026!') {
    weakReasons.push('ADMIN_PASS must be set to a strong, non-default value');
  }
  if (!(process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL)) {
    weakReasons.push('ALLOWED_ORIGINS (or FRONTEND_URL) must list your frontend origin(s)');
  }
  if (weakReasons.length) {
    console.error('❌ Insecure production config - server will not start:\n  - ' + weakReasons.join('\n  - '));
    process.exit(1);
  }
}

const app = express();
const server = http.createServer(app);

// Hardened edge posture:
// - Hide Express version fingerprint
// - Trust the single upstream proxy (Railway/Vercel) so req.ip + rate-limit keys
//   reflect the real client IP, not the load balancer's.
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Hardened security headers. This is a JSON API consumed by a separate SPA origin,
// so the restrictive default CSP is relaxed to avoid breaking nothing-served-here,
// while HSTS, nosniff, frameguard, and referrer policy are enforced.
app.use(helmet({
  contentSecurityPolicy: false,            // API serves no HTML; CSP belongs on the frontend host
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow the SPA origin to read responses
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

app.use(compression());

// --- CORS CONFIG (env-driven for production, LAN auto-allow for dev) ---
const IS_PROD = process.env.NODE_ENV === 'production';
// 'fb' = food & beverage (QR ordering), 'log' = logistics (client-login ordering)
const BUSINESS_TYPE = (process.env.BUSINESS_TYPE || 'fb').toLowerCase();
// Reserved standard customer ID for walk-in/guest sales (no linked ClientAccount).
// Never issued by the CUS-1000 sequence - real signups start at CUS-1000-A0002
// (the counter is pre-seeded to 1 at boot so the first real signup increments past it).
const WALK_IN_CUSTOMER_CODE = 'CUS-1000-A0001';
const ENV_ORIGINS = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const allowedOrigins = [
  "http://localhost:3000",
  ...ENV_ORIGINS
];

const corsOriginCheck = (origin, callback) => {
  if (!origin) return callback(null, true);
  if (allowedOrigins.includes(origin)) return callback(null, true);
  // LAN auto-allow only when not in production
  if (!IS_PROD && (origin.startsWith('http://192.168.') || origin.startsWith('http://172.') || origin.startsWith('http://10.'))) {
    return callback(null, true);
  }
  callback(new Error(`CORS blocked: ${origin}`));
};

app.use(cors({
  origin: corsOriginCheck,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: true
}));

// Update Socket.io CORS to match
// ✅ KEEP THIS NEW ONE
const io = new Server(server, {
  cors: {
    origin: corsOriginCheck,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true
  }
});

// Structured request logging (skips noisy health checks)
app.use(pinoHttp({
  logger: log,
  autoLogging: { ignore: req => req.url === '/health' },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: req => ({ method: req.method, url: req.url, id: req.id }),
    res: res => ({ statusCode: res.statusCode })
  }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());

// ── STANDARDISED LEDGER REFERENCE GENERATOR ─────────────────────────────────────
//
//  Format:  PREFIX-YYYY-NNNNNN
//
//  • PREFIX   - document type code  (ORD, VOID, EXP, …)
//  • YYYY     - calendar year        (sequences reset annually - standard BIR practice)
//  • NNNNNN   - 6-digit zero-padded sequential number, atomic & collision-free
//
//  For order-linked entries (ORD, VOID, ARS) the caller passes the order number
//  as `suffix` and we use  PREFIX-{orderNumber}  instead (no counter needed -
//  the order number is already the unique id).
//
//  Examples:
//    ORD-KL-2025-0001          ← sale linked to order KL-2025-0001
//    VOID-KL-2025-0001         ← void of that same order
//    ARS-KL-2025-0001          ← A/R settlement of that order
//    EXP-2025-000042           ← 42nd expense entry of 2025
//    INV-SPOIL-2025-000007     ← 7th spoilage entry of 2025
//    JRN-2025-000001           ← 1st manual journal entry of 2025
//
//  Counter keys are stored in the Counter collection as  "{PREFIX}-{YYYY}".
//  They are shared with nothing else - safe to increment even inside transactions
//  because Counter documents are upserted outside the session.
//
// mkRef - SYNCHRONOUS. Use when the source document already provides a unique ID.
//   Completion JE  →  order.orderNumber as-is   e.g. "ORD-2025-A0001"
//   Void JE        →  "VOID-ORD-2025-A0001"
//   ARS JE         →  "ARS-ORD-2025-A0001"
// Pass prefix='' to use orderNumber directly (no extra prefix needed for sales JEs).
const mkRef = (prefix, suffix) => prefix ? `${prefix}-${suffix}` : suffix;

// Logistics 1:1 mapping: a product with no BOM/recipe represents a stocked good
// directly. Resolve the linked Inventory doc by matching itemCode === productCode
// first, then falling back to itemName === product name. Returns the Mongoose doc
// (or null). One sold unit consumes (unitMultiplier || 1) base units and books
// COGS at unitCost (always per base unit).
async function resolveLinkedInventory(product, productCode, session) {
  const or = [];
  if (productCode) or.push({ itemCode: productCode });
  if (product?.productCode) or.push({ itemCode: product.productCode });
  if (product?.name) or.push({ itemName: product.name });
  if (!or.length) return null;
  return Inventory.findOne({ $or: or }).session(session);
}

// UNIT_TO_BASE now lives in lib/units.js (single source of truth) and is imported above.
// Base units of stock consumed by ONE sold unit of a logistics 1:1 product.
// The pack size is encoded in the product/inventory name (e.g. "…250G", "…1KG",
// "…500ML") and converted into the inventory item's base unit (inv.unit). NOTE:
// unitCost is per base unit, so COGS = baseUnitsPerSale × unitCost. Falls back to
// one full display unit (unitMultiplier) only when no weight token is present.
function baseUnitsPerSale(product, invItem) {
  const src = `${product?.name || ''} ${product?.baseSize || ''} ${invItem?.itemName || ''}`;
  const mt = src.match(/(\d+(?:\.\d+)?)\s*(mg|kg|g|ml|cl|l|pcs|pc|pack|unit)\b/i);
  const invBaseFactor = UNIT_TO_BASE[(invItem?.unit || '').toLowerCase()] || 1;
  if (mt) {
    const val = parseFloat(mt[1]);
    const f = UNIT_TO_BASE[mt[2].toLowerCase()];
    if (f !== undefined && val > 0) return val * (f / invBaseFactor);
  }
  return invItem?.unitMultiplier || 1;
}

// Escape user input before interpolating into a RegExp - prevents regex injection
// and ReDoS (catastrophic backtracking) when matching names case-insensitively.
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Multi-tenancy (Phase 2b) - DISABLED. This was meant to be a no-op for
// single-tenant deployments ("all current data + staff live on the default
// tenant"), but that assumption was false in practice: the boot migration
// backfills tenantId onto EXISTING Users, but nothing stamps tenantId onto
// NEWLY CREATED docs (Orders, Inventory, etc.) going forward - those default
// to null. Once a deployment has been running long enough for the backfill to
// have run, every staff token carries a tenantId while every fresh order/item
// does not, so filtering reads by tenantId silently hid all new data (this was
// the root cause of "orders/inventory not showing up"). Per this project's
// direction (one deployment per business, not shared multi-tenant), tenant
// scoping is paused rather than finished - always return {} so it's a true
// no-op everywhere it's used, until/unless multi-tenancy is revisited.
const tenantScope = (req) => ({});

// bcrypt work factor - 12 rounds (OWASP-recommended minimum for 2025+).
const BCRYPT_ROUNDS = 12;

// Mongo filter for cash that has physically entered the drawer during a shift.
// Cash is tendered at the Preparing transition (amountTendered), so the drawer
// holds cash from: every Completed cash sale, PLUS any in-progress (Preparing/Ready)
// cash order that already has amountTendered recorded. Pending/Cancelled/Voided/
// Parked are excluded (no cash collected, or cash reversed).
const shiftCashFilter = (cashierName, shiftStart) => ({
  cashier: cashierName,
  paymentMethod: 'Cash',
  createdAt: { $gte: shiftStart },
  $or: [
    { status: 'Completed' },
    { status: { $in: ['Preparing', 'Ready'] }, amountTendered: { $gt: 0 } },
  ],
});

// ── DUAL-TOKEN AUTH CONFIG ───────────────────────────────────────────────────
// Access token: short-lived (15m), sent as a Bearer header, held in client memory.
// Refresh token: opaque random secret, long-lived (30d), httpOnly+Secure+SameSite
// cookie, persisted (hashed) in the RefreshSession collection so it can be revoked
// instantly on logout / privilege change. Rotated on every use.
const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_COOKIE = 'semivra_rt';

const signAccessToken = (user) => jwt.sign(
  // aud:'staff' lets staff routes reject client-audience tokens structurally
  // (see verifyToken / lib/authz.js), independent of the role string.
  // `perms` carries the resolved permission set so requirePermission needn't hit
  // the DB; legacy tokens without it fall back to role defaults in hasPermission.
  { _id: user._id, name: user.name, userCode: user.userCode, role: user.role, tenantId: user.tenantId || null, perms: resolvePermissions(user), aud: 'staff' },
  process.env.JWT_SECRET,
  { expiresIn: ACCESS_TTL }
);

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

// In production the SPA (Vercel) and API (Railway) are different sites, so the
// refresh cookie MUST be SameSite=None; Secure to be sent cross-site. That removes
// SameSite's CSRF protection, so the /api/auth/* endpoints additionally enforce an
// Origin allowlist (see requireTrustedOrigin). In dev (same-ish origin) we use Lax.
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: IS_PROD,                         // None requires Secure; HTTPS-only in prod
  sameSite: IS_PROD ? 'none' : 'lax',
  maxAge: REFRESH_TTL_MS,
  path: '/',                       // cookie only ever sent to the refresh/logout endpoints
});

// CSRF defense for the cookie-bearing auth endpoints: reject requests whose Origin
// is not on the allowlist. The access-token API is header-based (CSRF-immune); only
// these cookie endpoints need this guard.
const requireTrustedOrigin = (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser / same-origin server call
  const ok = allowedOrigins.includes(origin) ||
    (!IS_PROD && (origin.startsWith('http://192.168.') || origin.startsWith('http://172.') || origin.startsWith('http://10.')));
  if (!ok) return res.status(403).json({ success: false, error: 'Untrusted origin.' });
  next();
};

// Issue a fresh access token + a new rotated refresh session, set the cookie.
const issueSession = async (res, user, meta = {}) => {
  const rawRefresh = crypto.randomBytes(48).toString('hex');
  await RefreshSession.create({
    tokenHash: hashToken(rawRefresh),
    userId: user._id,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: meta.userAgent?.slice(0, 200),
  });
  res.cookie(REFRESH_COOKIE, rawRefresh, refreshCookieOptions());
  return signAccessToken(user);
};

// Revoke every active refresh session for a user - call on password/role change
// or account deletion so existing logins can no longer silently refresh.
const revokeUserSessions = (userId) =>
  RefreshSession.updateMany({ userId, revoked: false }, { revoked: true });

// ── BOUNDARY VALIDATION ──────────────────────────────────────────────────────
// validate(schema) parses req.body against a Zod schema. Zod strips unknown keys
// by default, so this doubles as mass-assignment (BOPLA) defense: req.body is
// REPLACED with only the allowlisted, type-checked fields before it reaches any
// handler or Model.create(). Returns 422 with field errors on failure.
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      success: false,
      error: 'Validation failed.',
      details: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  req.body = result.data;
  next();
};

// Reusable field primitives
// zName stays RAW (trim only) - it backs loginSchema and userCreateSchema, and
// canonicalizing a staff login name would break existing accounts whose stored
// name doesn't survive a round-trip (e.g. "JM" → "Jm"). Use zLabel for anything
// that is a display label rather than an identity.
const zName  = z.string().trim().min(1).max(120);
// zLabel canonicalizes user-facing names so "abc trading" / "ABC Trading" /
// "  ABC   Trading " collapse to one stored value.
const zLabel = zTitle(z, 120);
const zMoney = z.number().finite().min(0);
const zRole  = z.enum(['superadmin', 'Manager', 'Staff', 'Cashier']).or(z.string().trim().min(1).max(40));

// Schemas for the previously raw `Model.create(req.body)` routes (mass-assignment fixes)
const loginSchema    = z.object({ name: zName, password: z.string().min(1).max(200) });
// password min 4 to match the client's staff-PIN policy (SuperAdminPanel validateForm).
// permissions passes through so the create route can honour an explicit override.
const userCreateSchema = z.object({ name: zName, password: z.string().min(4).max(200), role: zRole.optional(), permissions: z.array(z.string()).optional() });
const addonSchema    = z.object({
  name: zLabel, price: zMoneyLoose(z), category: zTitle(z, 60).optional(),
  recipe: z.array(z.object({ invId: z.string(), name: z.string(), qty: z.number(), cost: z.number().optional(), unit: z.string().optional() })).optional(),
});

// Reusable recipe-line shape
const zRecipe = z.array(z.object({
  invId: z.string().optional(), name: z.string().optional(),
  qty: z.number().optional(), cost: z.number().optional(), unit: z.string().optional(),
})).optional();

// Mass-assignment fixes: each schema OMITS server-controlled fields
// (codes, isArchived, timestamps) so a client can never set them via create().
const productSchema = z.object({
  name: zLabel, description: zText(z, 2000).optional(), category: zTitle(z, 80).optional(),
  basePrice: zMoneyLoose(z), discountPercent: z.number().min(0).max(100).optional(),
  clientDiscounts: z.array(z.object({ clientId: z.string(), percent: z.number().min(0).max(100) })).optional(),
  segmentDiscounts: z.array(z.object({ segment: z.string(), percent: z.number().min(0).max(100) })).optional(),
  bulkBreaks: z.array(z.object({ minQty: z.number().positive(), percent: z.number().min(0).max(100) })).optional(),
  baseSize: z.string().max(40).optional(), baseRecipe: zRecipe,
  sizes: z.array(z.object({ sizeCode: z.string().optional(), name: z.string().optional(), price: zMoney.optional(), recipe: zRecipe })).optional(),
  addOns: z.array(z.object({ name: z.string(), price: zMoney.optional(), recipe: zRecipe })).optional(),
  image: z.string().optional(), isAvailable: z.boolean().optional(),
  vatExempt: z.boolean().optional(),
  barcode: z.string().max(120).optional(),
  isBulk: z.boolean().optional(),
  modifierGroups: z.array(z.string()).optional(),
});
const comboSchema = z.object({
  name: zLabel, description: zText(z, 2000).optional(), price: zMoneyLoose(z), image: z.string().optional(),
  isActive: z.boolean().optional(),
  items: z.array(z.object({ productId: z.string().optional(), name: z.string().optional(), sizeName: z.string().optional(), quantity: z.number().int().positive().optional() })).optional(),
});
const discountSchema = z.object({
  name: zLabel, percentage: z.number().min(0).max(100).optional(), isSCPWD: z.boolean().optional(),
});
const roleSchema = z.object({ name: zName, permissions: z.array(z.string()).optional() });
// roleSchema keeps zName: role names are matched against stored user.role values
// and the built-in 'superadmin' literal, so canonicalizing them would break authz.
const modifierGroupSchema = z.object({
  name: zLabel, isRequired: z.boolean().optional(),
  minSelect: z.number().int().min(0).optional(), maxSelect: z.number().int().min(0).optional(),
  options: z.array(z.object({ name: z.string(), price: zMoney.optional(), recipe: zRecipe })).optional(),
});

// mkSeqRef - ASYNC. Use for entries that have no natural document ID.
//   Atomically increments a per-prefix-per-year counter, zero-collision.
//   e.g.  await mkSeqRef('EXP')       →  "EXP-2025-000042"
//          await mkSeqRef('INV-SPOIL') →  "INV-SPOIL-2025-000007"
const mkSeqRef = async (prefix) => {
  const year    = new Date().getFullYear();
  const key     = `${prefix}-${year}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return `${key}-${counter.seq.toString().padStart(6, '0')}`;
};

// --- HEALTH CHECK (no auth, for load balancers / uptime monitors) ---
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState; // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const healthy = dbState === 1;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    db: states[dbState] || 'unknown',
    // Exposed so the client can detect a build/server BUSINESS_TYPE mismatch
    // (the #1 mis-deployment: fb client pointed at a log server or vice-versa).
    businessType: BUSINESS_TYPE,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Brute-force protection. Skip-successful=true means only failures count against
// the bucket, so a legit user mistyping once then logging in normally is unaffected.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // 5 FAILED attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, error: 'Too many failed login attempts. Try again in 15 minutes.' }
});

const orderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Order rate limit exceeded. Slow down.' }
});

// Baseline throttle for the whole API surface (scraping / brute / cheap-DoS guard).
// The stricter loginLimiter / orderLimiter stack on top of this for their routes.
//
// Keyed per logged-in user (decoded from the JWT), not per IP: a physical
// location typically runs several tablets - POS, Logistics, Warehouse, an
// office desktop - all going out through the SAME router/public IP. Keying by
// IP alone meant every device at that location shared ONE 300-req/min bucket,
// so ordinary multi-tablet traffic (notification polls, clock status, order
// syncs) could exhaust it and start 429-ing devices that individually did
// nothing wrong. Decoding is best-effort and unverified (jwt.verify already
// runs downstream in each route's own auth middleware) - this key only needs
// to be a stable per-device bucket, not a trust boundary.
const rateLimitKey = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.decode(authHeader.slice(7));
      if (decoded?._id) return String(decoded._id);
    } catch { /* fall through to IP */ }
  }
  return req.ip;
};
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,            // generous per device; no longer shared across a whole location
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: { success: false, error: 'Too many requests. Please slow down.' }
});
app.use('/api', generalApiLimiter);


// --- STARTUP TASKS (run once after DB connect) ---
// Idempotent: seed superadmin, backfill businessType, seed payment-method sub-accounts,
// run the one-time COA 4→6-digit code migration, and sync atomic counters. Extracted into
// a named, exported function so integration tests can seed legacy data and invoke it.
const runStartupTasks = async () => {
    log.info('Connected to MongoDB Atlas');
    try {
      const adminCount = await User.countDocuments();
      if (adminCount === 0) {
        const defaultPass = process.env.ADMIN_PASS || 'ChangeMe@2026!';
        const hashedPassword = await bcrypt.hash(defaultPass, BCRYPT_ROUNDS);
        const userCode = 'ADN-A0001';
        await User.create({ userCode, name: 'Super Admin', password: hashedPassword, role: 'superadmin' });
        log.info(`✅ Default Superadmin seeded: Code [${userCode}]`);
      }
      // Backfill: any legacy "Super Admin" user without a role gets `superadmin` set
      const backfill = await User.updateMany(
        { name: 'Super Admin', $or: [{ role: { $exists: false } }, { role: null }, { role: '' }] },
        { $set: { role: 'superadmin' } }
      );
      if (backfill.modifiedCount > 0) log.info(`✅ Backfilled role=superadmin on ${backfill.modifiedCount} legacy admin doc(s)`);

      // ── ONE-TIME businessType BACKFILL ──────────────────────────────────
      // Stamps every legacy Order/Product/Inventory/Category doc that lacks
      // a businessType with the current env BUSINESS_TYPE. After this runs
      // we can safely read-filter every list endpoint by businessType.
      const bfFilter = { $or: [{ businessType: { $exists: false } }, { businessType: null }, { businessType: '' }] };
      const [bO, bP, bI, bC] = await Promise.all([
        Order.updateMany(bfFilter, { $set: { businessType: BUSINESS_TYPE } }),
        Product.updateMany(bfFilter, { $set: { businessType: BUSINESS_TYPE } }),
        Inventory.updateMany(bfFilter, { $set: { businessType: BUSINESS_TYPE } }),
        Category.updateMany(bfFilter, { $set: { businessType: BUSINESS_TYPE } }),
      ]);
      const stampedTotal = (bO.modifiedCount || 0) + (bP.modifiedCount || 0) + (bI.modifiedCount || 0) + (bC.modifiedCount || 0);
      if (stampedTotal > 0) log.info(`✅ Stamped businessType=${BUSINESS_TYPE} on ${stampedTotal} legacy doc(s) - Orders:${bO.modifiedCount} Products:${bP.modifiedCount} Inventory:${bI.modifiedCount} Categories:${bC.modifiedCount}`);
    } catch (err) {
      log.error({ err }, 'Seeding error');
    }

    // ── DEFAULT TENANT SEED + tenantId BACKFILL (multi-tenancy Phase 1) ────
    // Idempotent: ensure a "default" tenant exists, then stamp every tenant-scoped
    // doc that lacks a tenantId with it. Additive only - no query behavior changes.
    try {
      let defaultTenant = await Tenant.findOne({ slug: 'default' });
      if (!defaultTenant) {
        defaultTenant = await Tenant.create({
          name: process.env.BUSINESS_NAME || 'Default Tenant',
          slug: 'default',
          businessType: BUSINESS_TYPE,
        });
        log.info(`✅ Default tenant seeded: ${defaultTenant._id}`);
      }
      const tFilter = { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] };
      const [tO, tP, tI, tC, tU] = await Promise.all([
        Order.updateMany(tFilter, { $set: { tenantId: defaultTenant._id } }),
        Product.updateMany(tFilter, { $set: { tenantId: defaultTenant._id } }),
        Inventory.updateMany(tFilter, { $set: { tenantId: defaultTenant._id } }),
        Category.updateMany(tFilter, { $set: { tenantId: defaultTenant._id } }),
        User.updateMany(tFilter, { $set: { tenantId: defaultTenant._id } }),
      ]);
      const tStamped = (tO.modifiedCount || 0) + (tP.modifiedCount || 0) + (tI.modifiedCount || 0) + (tC.modifiedCount || 0) + (tU.modifiedCount || 0);
      if (tStamped > 0) log.info(`✅ Backfilled tenantId on ${tStamped} doc(s) - Orders:${tO.modifiedCount} Products:${tP.modifiedCount} Inventory:${tI.modifiedCount} Categories:${tC.modifiedCount} Users:${tU.modifiedCount}`);
    } catch (err) {
      log.error({ err }, 'Tenant seed/backfill error');
    }

    // ── PAYMENT-METHOD SUB-ACCOUNT SEEDING ────────────────────────────────
    // Own try block so an earlier failure can't silently skip this step.
    // For each method, take the preferred code; if it's taken (e.g. user
    // already added a custom account there), pick the next free child code
    // under the same parent so the method still gets its own GL bucket.
    try {
      const SEED_SUB_ACCOUNTS = [
        { name: 'GCash',           parent: '113000', preferred: '113001' },
        { name: 'Maya',            parent: '113000', preferred: '113002' },
        { name: 'Maribank',        parent: '113000', preferred: '113003' },
        { name: 'Other E-Wallet',  parent: '113000', preferred: '113004' },
        { name: 'QR',              parent: '113000', preferred: '113005' },
        { name: 'Bank Transfer',   parent: '112000', preferred: '112001' },
        { name: 'Foodpanda',       parent: '120000', preferred: '120001' },
        { name: 'Grab Delivery',   parent: '120000', preferred: '120002' },
        { name: 'Lalamove',        parent: '111000', preferred: '111001' },
        { name: 'Manual Delivery', parent: '111000', preferred: '111002' },
        { name: 'Pickup',          parent: '111000', preferred: '111003' },
      ];
      const nextFreeCodeUnder = async (parent) => {
        // parent is a 6-digit canonical code like '113000'. Children share the
        // first 3 digits + a 3-digit sequence. Scan 001..999 for an unused one.
        const base = String(parent).slice(0, 3);
        const taken = new Set([
          ...Object.keys(ACCOUNTS),
          ...(await Account.find({ code: { $regex: `^${base}` } }, { code: 1 }).lean()).map(a => a.code),
        ]);
        for (let i = 1; i <= 999; i++) {
          const cand = base + String(i).padStart(3, '0');
          if (!taken.has(cand)) return cand;
        }
        return null;
      };

      const PM_DEFAULTS = {};
      let seededAccts = 0;
      for (const s of SEED_SUB_ACCOUNTS) {
        const parentMeta = ACCOUNTS[s.parent];
        if (!parentMeta) continue;
        // If a sub-account with this NAME already exists under this parent
        // (regardless of code), reuse it for the routing default.
        const existsByName = await Account.findOne({ parent: s.parent, name: s.name }).lean();
        if (existsByName) { PM_DEFAULTS[s.name] = existsByName.code; continue; }
        // Otherwise take the preferred code if free, else next available.
        const existsByCode = await Account.findOne({ code: s.preferred }).lean();
        const codeToUse = existsByCode ? await nextFreeCodeUnder(s.parent) : s.preferred;
        if (!codeToUse) continue;
        await Account.create({
          code: codeToUse, name: s.name, type: parentMeta.type, parent: s.parent,
          custom: true, normalBalance: /^[15679]/.test(codeToUse) ? 'Debit' : 'Credit',
        });
        PM_DEFAULTS[s.name] = codeToUse;
        seededAccts++;
      }
      log.info(`✅ Payment-method sub-account seed complete - created ${seededAccts}, reused ${SEED_SUB_ACCOUNTS.length - seededAccts}.`);
      // Refresh COA cache so the new codes are immediately resolvable.
      await refreshCustomMeta();
      // Update the in-memory defaults so routing falls back to the granular
      // codes when no explicit override exists in the PaymentMethodMap.
      for (const [m, c] of Object.entries(PM_DEFAULTS)) {
        if (acctMeta(c)) DEFAULT_PAYMENT_ACCOUNT_MAP[m] = c;
      }
      await refreshPaymentMap();
    } catch (err) {
      log.error({ err }, 'Payment-method seed error');
    }

    // ── ONE-TIME COA MIGRATION (4-digit → 6-digit SAP codes) ──────────────────
    // Rewrites historical journal-entry line codes via CODE_MAP. Guarded by a
    // Settings flag so it runs exactly once.
    try {
      const done = await Settings.findOne({ key: 'coaV2Migrated' }).lean();
      if (!done) {
        let migrated = 0;
        for (const [oldC, newC] of Object.entries(CODE_MAP)) {
          const r = await JournalEntry.updateMany(
            { 'lines.accountCode': oldC },
            { $set: { 'lines.$[el].accountCode': newC } },
            { arrayFilters: [{ 'el.accountCode': oldC }] }
          );
          migrated += r.modifiedCount || 0;
        }
        await Settings.updateOne({ key: 'coaV2Migrated' }, { $set: { value: true } }, { upsert: true });
        log.info({ entriesTouched: migrated }, '✅ COA v2: migrated journal entry account codes 4-digit → 6-digit');
      }
    } catch (err) {
      log.error({ err }, 'COA migration error');
    }

    // Sync atomic Counters to the highest existing seq so new inserts never collide
    try {
      // Orders: ORD-YYYY-AXXXX
      const allOrders = await Order.find({}, { orderNumber: 1 }).lean();
      const orderPrefixMax = {};
      for (const o of allOrders) {
        const m = o.orderNumber?.match(/^(ORD-\d{4})-A(\d+)$/);
        if (m) orderPrefixMax[m[1]] = Math.max(orderPrefixMax[m[1]] || 0, parseInt(m[2], 10));
      }
      for (const [prefix, seq] of Object.entries(orderPrefixMax)) {
        await Counter.collection.updateOne({ _id: prefix }, { $max: { seq } }, { upsert: true });
      }

      // Users: ADN-AXXXX
      const allUsers = await User.find({}, { userCode: 1 }).lean();
      let maxUserSeq = 0;
      for (const u of allUsers) {
        const m = u.userCode?.match(/^ADN-A(\d+)$/);
        if (m) maxUserSeq = Math.max(maxUserSeq, parseInt(m[1], 10));
      }
      if (maxUserSeq > 0) await Counter.collection.updateOne({ _id: 'ADN' }, { $max: { seq: maxUserSeq } }, { upsert: true });

      // Products: XXX-AXXXX (variable category prefix)
      const allProducts = await Product.find({}, { productCode: 1 }).lean();
      const prodPrefixMax = {};
      for (const p of allProducts) {
        const m = p.productCode?.match(/^([A-Z]{3})-A(\d+)$/);
        if (m) prodPrefixMax[m[1]] = Math.max(prodPrefixMax[m[1]] || 0, parseInt(m[2], 10));
      }
      for (const [prefix, seq] of Object.entries(prodPrefixMax)) {
        await Counter.collection.updateOne({ _id: prefix }, { $max: { seq } }, { upsert: true });
      }

      // ── ONE-TIME MIGRATION: legacy CLT-AXXXX → CUS-1000-AXXXX ──────────────
      // Every ClientAccount is a real client (walk-ins never get one - see
      // WALK_IN_CUSTOMER_CODE). Renumber any surviving CLT- codes into the standard
      // sequence, oldest account first, continuing after whatever CUS-1000 codes
      // already exist. Idempotent: once no CLT- codes remain, this is a no-op.
      const legacyClients = await ClientAccount.find({ clientCode: /^CLT-A\d+$/ }, { clientCode: 1 }).sort({ createdAt: 1 }).lean();
      if (legacyClients.length) {
        const existingCus = await ClientAccount.find({ clientCode: /^CUS-1000-A\d+$/ }, { clientCode: 1 }).lean();
        let seq = 1; // A0001 stays reserved for walk-in - never reissue it
        for (const c of existingCus) {
          const m = c.clientCode.match(/^CUS-1000-A(\d+)$/);
          if (m) seq = Math.max(seq, parseInt(m[1], 10));
        }
        for (const c of legacyClients) {
          seq += 1;
          const newCode = `CUS-1000-A${String(seq).padStart(4, '0')}`;
          await ClientAccount.updateOne({ _id: c._id }, { $set: { clientCode: newCode } });
        }
        log.info(`✅ Migrated ${legacyClients.length} legacy CLT- client code(s) to CUS-1000- format`);
      }

      // Client accounts (customer ID): CUS-1000-AXXXX is the standard format.
      const allClients = await ClientAccount.find({}, { clientCode: 1 }).lean();
      let maxClientSeq = 0;
      for (const c of allClients) {
        const m = c.clientCode?.match(/^CUS-1000-A(\d+)$/);
        if (m) maxClientSeq = Math.max(maxClientSeq, parseInt(m[1], 10));
      }
      if (maxClientSeq > 0) await Counter.collection.updateOne({ _id: 'CUS-1000' }, { $max: { seq: maxClientSeq } }, { upsert: true });
      // A0001 is reserved for walk-in/guest sales (WALK_IN_CUSTOMER_CODE) - never
      // issued to a real signup. Floor the counter at 1 so the next real
      // generateNextSequence() call always lands on A0002 or higher.
      await Counter.collection.updateOne({ _id: 'CUS-1000' }, { $max: { seq: 1 } }, { upsert: true });

      log.info('Counters synced from existing data');
    } catch (err) {
      log.error({ err }, 'Counter sync error');
    }

    // Seed the business's actual job titles as custom roles (idempotent - only
    // creates whichever of these don't already exist by name, never touches one
    // that's already there, so re-running this on every boot is safe even after
    // someone's edited these in the Access Roles UI). Chosen for a logistics
    // operation that also runs a café counter: Logistics/Office split the
    // warehouse-vs-back-office work, Barista/Head Barista are the counter
    // staff, Admin is the full-ops role.
    try {
      const wantedRoles = [
        { name: 'Logistics',    permissions: ['inventory.view', 'inventory.manage', 'procurement.view', 'orders.view', 'requisitions.view'] },
        { name: 'Office',       permissions: ['orders.view', 'orders.manage', 'procurement.view', 'procurement.manage', 'accounting.view', 'requisitions.view', 'reports.view', 'analytics.view'] },
        { name: 'Admin',        permissions: ['pos.use', 'orders.view', 'orders.manage', 'orders.delete', 'inventory.view', 'inventory.manage', 'inventory.delete', 'products.view', 'products.manage', 'procurement.view', 'procurement.manage', 'procurement.delete', 'accounting.view', 'requisitions.view', 'requisitions.approve', 'reports.view', 'analytics.view', 'audit.view', 'scheduling.manage', 'settings.manage'] },
        { name: 'Barista',      permissions: ['pos.use', 'orders.view', 'inventory.view', 'products.view'] },
        { name: 'Head Barista', permissions: ['pos.use', 'orders.view', 'orders.manage', 'inventory.view', 'inventory.manage', 'products.view', 'requisitions.view'] },
      ];
      for (const r of wantedRoles) {
        const exists = await Role.findOne({ name: { $regex: `^${escapeRegex(r.name)}$`, $options: 'i' } }).lean();
        if (!exists) { await Role.create(r); log.info(`✅ Seeded role: ${r.name}`); }
      }
    } catch (err) {
      log.error({ err }, 'Role seed error');
    }

    // Load custom-role → permissions into the authz resolver (function is hoisted).
    await refreshCustomRolePerms();
};

// --- MONGODB CONNECTION (single connect) ---
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10000, // fail fast on an unreachable cluster instead of hanging
  socketTimeoutMS: 45000,
  maxPoolSize: 20,
})
  // The capped error collection has to be registered once the connection is up;
  // captureError() is a no-op until then, so early boot errors are simply not
  // recorded rather than crashing the process.
  .then(() => { initErrorLog(); return runStartupTasks(); })
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

  // --- 🔒 NEW: JWT MIDDLEWARE 🔒 ---
  const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
      // Stage 1 - signature/expiry. A malformed/expired token throws here and never
      // reaches the audience/role logic below.
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Stage 2 - audience. A client-audience token must never satisfy the staff gate,
      // even before role checks. This makes every verifyToken route client-hostile by
      // default (defense-in-depth alongside requireStaff). aud beats role.
      if (decoded.aud === 'client') {
        return res.status(403).json({ success: false, message: 'Forbidden: client token not permitted here.' });
      }
      req.user = decoded; // Stage 3 (role allowlist) is enforced by requireStaff on staff routes.
      next();
    } catch (error) {
      // 401 (not 403) for an expired/invalid token so the client silently refreshes
      // and retries - otherwise an idle session shows "Forbidden" until manual reload.
      return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or expired token' });
    }
  };

  // --- 🔒 CLIENT-PORTAL TOKEN GUARD 🔒 ---
  // Strict gate for the two client-scoped routes (/api/client/orders[...]). Requires a
  // valid signature AND aud:'client' AND role:'client' (see evaluateClientAccess). A
  // staff token, or a client token missing the aud claim, is rejected - clients
  // re-authenticate after deploy. Staff routes use verifyToken + requireStaff instead.
  const verifyClientToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
    }
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
      if (!evaluateClientAccess(decoded).ok) {
        return res.status(403).json({ success: false, error: 'Client session required.' });
      }
      req.user = decoded;
      return next();
    } catch (error) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired token' });
    }
  };

  // Hard-gate: role === 'superadmin' ONLY - never trust name strings.
  const requireSuperAdmin = (req, res, next) => {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'Forbidden: Superadmin role required.' });
    }
    next();
  };

  // Allows superadmin OR admin (e.g. for refund). Role match is case-insensitive.
  // NOTE: voids are superadmin-only (requireSuperAdmin) - do not add void here.
  const requireSuperOrAdmin = (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'superadmin' || role === 'admin') return next();
    return res.status(403).json({ success: false, error: 'Forbidden: Admin or Superadmin role required.' });
  };

  // Accepts valid JWT (staff/admin) OR active QR session (customer dine-in).
  const verifyOrderAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        return next();
      } catch {
        // 401 so the client refreshes + retries instead of failing an expired session.
        return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
      }
    }
    const { sessionId, table } = req.body;
    if (sessionId && table && !['Takeout', 'Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(table)) {
      const qrSession = await QRSession.findOne({ sessionId, table, isActive: true });
      if (qrSession && new Date() < qrSession.expiresAt) {
        req.qrSession = qrSession;
        return next();
      }
      return res.status(401).json({ success: false, error: 'QR session expired or invalid. Please scan again.' });
    }
    return res.status(401).json({ success: false, error: 'Unauthorized: provide a staff token or a valid QR session.' });
  };

// --- DATABASE SCHEMAS ---
const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  // fb routes to Kitchen/Bar; log routes to Logistics/Warehouse. The enum must
  // cover both or category creation 500s in log mode, where the Products tab
  // only offers the logistics pair. Default follows the running BUSINESS_TYPE.
  department: {
    type: String,
    enum: ['Kitchen', 'Bar', 'Logistics', 'Warehouse'],
    default: () => (BUSINESS_TYPE === 'log' ? 'Logistics' : 'Kitchen'),
  },
  // Tenancy seed: which business type owns this category. Defaults to the env
  // BUSINESS_TYPE on create. Old docs without this field still read fine.
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  // Multi-tenancy (Phase 1): every tenant-scoped doc carries a tenantId. Backfilled
  // to the default tenant on boot. Query-scoping/auth wiring lands in Phase 2.
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
}, { timestamps: true });
const Category = mongoose.model('Category', CategorySchema);
// ── MODIFIER GROUPS ─────────────────────────────────────────────────────────
// A modifier group is a required or optional selection prompt on a product.
// e.g. "Choose your milk" (required, pick 1) or "Extra shots" (optional, 0–3).
const ModifierGroupSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  isRequired: { type: Boolean, default: true },
  minSelect:  { type: Number, default: 1 },
  maxSelect:  { type: Number, default: 1 },
  options:    [{ name: String, price: { type: Number, default: 0 }, recipe: [{ invId: String, name: String, qty: Number, unit: String }] }]
}, { timestamps: true });
const ModifierGroup = mongoose.model('ModifierGroup', ModifierGroupSchema);

// ── SETTINGS ─────────────────────────────────────────────────────────────────
// Key/value store for system-wide toggles (isAcceptingQROrders, etc.)
const SettingsSchema = new mongoose.Schema({ key: { type: String, unique: true, required: true }, value: { type: mongoose.Schema.Types.Mixed } });
const Settings = mongoose.model('Settings', SettingsSchema);

// ── TENANT (multi-tenancy, Phase 1) ──────────────────────────────────────────
// A Tenant is an isolated business in a shared deployment. Phase 1 introduces the
// model + a default tenant + tenantId backfill (additive, non-breaking - existing
// queries are unchanged). Phase 2 wires tenantId into the access token, per-tenant
// query scoping, and Socket.io room partitioning.
const TenantSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  slug:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  businessType: { type: String, default: () => BUSINESS_TYPE },
  isActive:     { type: Boolean, default: true },
}, { timestamps: true });
const Tenant = mongoose.model('Tenant', TenantSchema);

// Tenant management - superadmin only (Phase 1 CRUD over the tenant registry).
const tenantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/i, 'slug must be alphanumeric/hyphen'),
  businessType: z.enum(['fb', 'log']).optional(),
  isActive: z.boolean().optional(),
});

// --- ADD-ONS SCHEMA & ROUTES ---
const AddOnSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, default: 'Extras' },
  recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }]
}, { timestamps: true });
const AddOn = mongoose.model('AddOn', AddOnSchema);



// 1. UPDATE THE PRODUCT SCHEMA (Add Recipes)
const ProductSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  // Multi-tenancy (Phase 1): every tenant-scoped doc carries a tenantId. Backfilled
  // to the default tenant on boot. Query-scoping/auth wiring lands in Phase 2.
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  productCode: String,
  // Scanned barcode (UPC/EAN/QR payload). Sparse index: most products may not
  // have one, but the ones that do are looked up by it at the POS
  // (GET /api/products/by-barcode/:code). NOT unique at the schema level - a
  // shop can legitimately have the same barcode on two size variants, and a
  // hard unique constraint would reject the second on import; the lookup route
  // returns the first match and the response notes when a barcode is ambiguous.
  barcode: { type: String, default: '', index: true },
  // Bulk-sale flag - surfaces the product under a dedicated "Bulk" filter in the
  // POS and client portal (e.g. wholesale/sack quantities), separate from the
  // per-line quantity-break pricing in `bulkBreaks`.
  isBulk: { type: Boolean, default: false, index: true },
  name: { type: String, required: true, index: true },
  description: String,
  category: { type: String, index: true },
  basePrice: { type: Number, required: true },
  // Per-product discount (%). Applies only to this product's order lines, not the
  // whole order. 0 = no discount. Applies to ALL buyers by default.
  discountPercent: { type: Number, default: 0 },
  // VAT classification. Defaults to VATable (false), the ERP convention: the
  // company-level VAT setting governs, and you flag the EXCEPTIONS here - raw
  // agricultural produce, prescription medicines, and the like. Defaulting the
  // other way would silently under-remit VAT on any product left unconfigured,
  // which surfaces at audit rather than at the counter.
  vatExempt: { type: Boolean, default: false },
  // Optional per-client overrides. When a logged-in client buys this product, the
  // matching entry's percent is used instead of the default discountPercent. Lets
  // you give a specific client a special rate on a specific product (pre-reg, VIP,
  // bulk-buyer, etc.). Empty array = no overrides → falls back to discountPercent.
  clientDiscounts: [{ clientId: String, percent: { type: Number, default: 0 } }],
  // Segment-level overrides - same idea as clientDiscounts but keyed by a tag on
  // the buyer's ClientAccount.segments (e.g. "wholesale", "vip") instead of one
  // specific client id, so a rate can apply to a whole class of buyer at once.
  // When a buyer carries more than one matching segment, the highest percent
  // wins (see productDiscPct in orders.js) - never stacked.
  segmentDiscounts: [{ segment: String, percent: { type: Number, default: 0 } }],
  // Quantity-break bulk pricing, independent of the fixed-price Combo model.
  // Each line item's ordered quantity is checked against minQty (highest
  // qualifying minQty wins) and combined with the other discount percents via
  // Math.max, same as clientDiscounts/segmentDiscounts - never stacked.
  bulkBreaks: [{ minQty: { type: Number, required: true }, percent: { type: Number, default: 0 } }],
  baseSize: String,
  costOverride: Number,
  baseRecipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }],
  sizes: [{
    sizeCode: String,
    name: String,
    price: Number,
    costOverride: Number,
    recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }]
  }],
  addOns: [{ name: String, price: Number, recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }] }],
  image: String,
  // Renamed from "86'd". `isAvailable === false` means REMOVED from the menu
  // (and from reporting too - unless the product still has stock, in which
  // case it shows in reporting so historical inventory is visible).
  isAvailable:    { type: Boolean, default: true },
  // Manual out-of-stock toggle. OOS products STILL show in menu (with an OOS
  // badge) and STILL appear in every report. Separate from isAvailable so a
  // temporary stockout doesn't get conflated with a permanent removal.
  isOutOfStock:   { type: Boolean, default: false },
  isArchived:     { type: Boolean, default: false },   // soft-delete; hidden from menu + POS
  modifierGroups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ModifierGroup' }]  // required/optional selection prompts
}, { timestamps: true });
const Product = mongoose.model('Product', ProductSchema);

// ── COMBO / BUNDLE (Product Promo) ───────────────────────────────────────────
// A fixed-price set of existing products sold as one line, e.g.
// "Budget Meal: Americano + Pandesal = ₱99". On completion the ERP engine
// deducts each component product's recipe so COGS and stock stay accurate.
const ComboSchema = new mongoose.Schema({
  comboCode:   String,
  name:        { type: String, required: true },
  description: String,
  price:       { type: Number, required: true },   // fixed bundle price
  image:       String,
  isActive:    { type: Boolean, default: true },
  items: [{
    productId: String,
    name:      String,
    sizeName:  String,   // optional specific size; '' = base
    quantity:  { type: Number, default: 1 },
  }],
}, { timestamps: true });
const Combo = mongoose.model('Combo', ComboSchema);

// ── SALES / PROMOTIONS ────────────────────────────────────────────────────────
// Time-boxed promotional pricing overlaid on top of normal product prices.
// Rules:
//   fixed_price  – product sells at salePrice during the window
//   percent_off  – product gets discountPercent% off
//   threshold    – if order subtotal >= thresholdAmount, a product gets discountPercent% off
const SaleSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  description: String,
  startsAt:    { type: Date, required: true },
  endsAt:      { type: Date, required: true },
  isActive:    { type: Boolean, default: true },
  rules: [{
    ruleType:          { type: String, enum: ['fixed_price', 'percent_off', 'threshold'], required: true },
    productId:         String,
    productName:       String,
    salePrice:         Number,   // for fixed_price
    discountPercent:   Number,   // for percent_off and threshold
    thresholdAmount:   Number,   // for threshold: minimum order subtotal
  }],
}, { timestamps: true });
const Sale = mongoose.model('Sale', SaleSchema);

const OrderSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  // Multi-tenancy (Phase 1): every tenant-scoped doc carries a tenantId. Backfilled
  // to the default tenant on boot. Query-scoping/auth wiring lands in Phase 2.
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  orderNumber: String,
  table: String,
  // Which branch/location rang this up - a StorageLocation name snapshot, set
  // by the device (see client localStorage 'posBranch'), same convention as
  // Inventory.stockLocation. Blank means single-location or unset - every
  // existing order predates this and is untagged, which is fine (reports
  // treat blank as its own "(Unassigned)" bucket, never dropped).
  location: { type: String, default: '', index: true },
  isArchived: { type: Boolean, default: false, index: true },
  status: { type: String, default: 'Pending' },
  // Parked / held tabs: saved but not yet sent to the kitchen or completed.
  isParked: { type: Boolean, default: false, index: true },
  // Idempotency key - prevents duplicate orders from retries / offline-queue replays.
  // unique+sparse: makes double-submit protection DB-enforced, not just the
  // app-level findOne-then-create check in orders.js (which has a TOCTOU
  // window - two concurrent requests can both pass the findOne before either
  // create() completes). The unique index turns a lost race into an E11000
  // the create-order route catches, instead of a duplicate order.
  idempotencyKey: { type: String, index: true, unique: true, sparse: true },
  customerName: { type: String, default: 'Guest' },
  paymentMethod: { type: String, default: 'Cash' },
  
  // Item Level Tracking
items: [{
    productId: String,
    productCode: String,
    name: String,
    price: Number,
    quantity: Number,
    fulfilledQty: { type: Number, default: 0 },        // units fulfilled so far (partial fulfillment)
    // Cumulative units of THIS line refunded/returned so far, across however many
    // partial-refund passes (see POST /api/orders/:id/partial-refund). Never
    // exceeds `quantity`. Whole-order /refund and /void don't touch this - they
    // already terminate the order outright.
    refundedQty: { type: Number, default: 0 },
    // True for a line added by POST /api/orders/:id/exchange (a replacement item) -
    // distinguishes it from the order's original lines in the UI/receipt history.
    addedViaExchange: { type: Boolean, default: false },
    productDiscountPercent: { type: Number, default: 0 }, // per-product discount applied to this line
    // VAT classification COPIED from the product at ring-up. Stamped rather than
    // looked up later: reclassifying a product must never rewrite the tax on
    // receipts already issued.
    vatExempt: { type: Boolean, default: false },
    selectedAddOns: [{ name: String, price: Number }],
    hasDiscount: { type: Boolean, default: true },
    department: { type: String, default: 'Kitchen' }, // <-- NEW: Routes to Kitchen or Bar
    itemStatus: { type: String, default: 'Received' }, // <-- NEW: Item-level progress
    discountPercent: { type: Number, default: 0 },
    // Combo / bundle line: deducts each component recipe on completion
    isCombo: { type: Boolean, default: false },
    comboItems: [{ productId: String, name: String, sizeName: String, quantity: Number }]
  }],
  
  // Strict Accounting Fields
  isVatInclusive: { type: Boolean, default: true }, // Enforces Rule 3 (System-wide standard)
  discountType: { type: String, default: 'None' },  // Enforces Rules 6 & 9
  discountBy: { type: String },                      // staff who applied the discount (logged-in user, not the order's cashier)

  subtotal: { type: Number, default: 0 },           // Gross Sales
  vatableSales: { type: Number, default: 0 },       // Base for VAT
  vatExemptSales: { type: Number, default: 0 },     // Base for SC/PWD
  vatRate: { type: Number, default: 0 },
  vatAmount: { type: Number, default: 0 },
  discountPercent: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  // SC/PWD exemption for this sale. Defaults FALSE - an ordinary sale is VATable.
  // This used to default true, which was harmless only while VAT was disabled
  // system-wide; with VAT live it would have exempted every legacy order and
  // quietly zeroed the output VAT on all of them.
  isVatExempt: { type: Boolean, default: false },
  // Which SC/PWD basis was in force when this order was rung up. Stamped per
  // order, not read from settings at read time: changing the setting must never
  // retroactively alter a receipt that has already been issued, and the math
  // validator has to be able to reproduce a historical total exactly.
  scPwdOrder: { type: String, default: 'vat-first' },
  // --- ENTERPRISE FIELDS ---
  cashier: { type: String, default: 'System', index: true },
  // --- PARTIAL FULFILLMENT (logistics - single order, fulfilled in batches) ---
  amountPaid:       { type: Number, default: 0 },        // cash/AR collected so far
  depositRemaining: { type: Number, default: 0 },        // prepaid-but-unfulfilled value held as Customer Deposits
  // When the remaining units of a partially-fulfilled order are dropped, the
  // order finalizes as Completed at the fulfilled quantity and the dropped units
  // are recorded here (they carry no ledger entries - they were never fulfilled).
  droppedItems: [{ name: String, productCode: String, droppedQty: Number, price: Number }],
  droppedBy:   { type: String, default: '' },
  droppedAt:   { type: Date },
  clientReceived:   { type: Boolean, default: false },   // client confirmed receipt from the portal
  transactionType: { type: String, enum: ['NORMAL', 'COMPLIMENTARY', 'REFUND', 'VOID'], default: 'NORMAL' },
  isComplimentary: { type: Boolean, default: false },
  employeeName: { type: String, default: '' },          // beneficiary (who the comp is for)
  complimentaryReasonType: {
    type: String,
    enum: ['VIP_CUSTOMER','CUSTOMER_RECOVERY','FOOD_QUALITY_ISSUE','SERVICE_DELAY','EMPLOYEE_MEAL',
           'OWNER_APPROVAL','MARKETING_PROMOTION','INFLUENCER_PROMO','SYSTEM_ERROR',
           'TRAINING_ORDER','LOYALTY_REWARD','EVENT_SPONSORSHIP'],
    default: null
  },
  complimentaryReasonNote: { type: String, default: '' },
  complimentaryApprovedBy: { type: String, default: '' },
  complimentaryApprovedAt: { type: Date },
  complimentaryAmount: { type: Number, default: 0 },
  complimentaryCost:   { type: Number, default: 0 },
  complimentaryReferenceNumber: { type: String, default: '' },
  voidReason: { type: String, default: '' },
  // Attribution - who actually voided / cancelled the order. Captured from the
  // verified JWT, never the request body. Distinct from `cashier` (which is the
  // original placer - could be the client themselves on a client-portal order).
  voidedBy: { type: String, default: '' },
  voidedAt: { type: Date },
  cancelledBy: { type: String, default: '' },
  cancelledAt: { type: Date },
  // Audit trail of partial refunds (see POST /api/orders/:id/partial-refund) -
  // not everything has to be refunded at once, and it can happen more than once
  // over time as long as no line is ever refunded past what was ordered. Whole-
  // order /refund and /void are unaffected - they stay one-shot/terminal.
  refundHistory: [{
    reference:       { type: String, default: '' },
    at:              { type: Date, default: Date.now },
    by:              { type: String, default: '' },
    reason:          { type: String, default: '' },
    inventoryAction: { type: String, default: 'None' }, // 'Restock' | 'Spoilage' | 'None'
    items:           [{ itemIndex: Number, name: String, qty: Number }],
    amount:          { type: Number, default: 0 },
  }],
  // True when a logged-in client placed the order directly from the client portal.
  // Used to exclude these orders from "staff activity" panels - their `cashier`
  // is the client's own username, not real staff.
  placedByClient: { type: Boolean, default: false, index: true },
  clientAccountId: { type: String, index: true },
  // Marks orders added via the superadmin Backdate Sales tool. Skips inventory
  // deduction and recipe COGS - purely a revenue/finance tally.
  isBackdated:    { type: Boolean, default: false, index: true },
  // Source transaction/invoice number from a Backdate Sale bulk Excel import
  // (the sheet's own reference, e.g. "TRANSACTION NO."). Blank for a manually
  // entered backdated sale, which has no such reference to dedupe against.
  // Lets re-importing the same (or an overlapping) file skip rows that were
  // already posted instead of creating a second sale for the same reference.
  importRef:      { type: String, default: '', index: true },
  amountTendered: { type: Number, default: 0 },
  changeDue: { type: Number, default: 0 },
  // --- DELIVERY / PICKUP FIELDS ---
  deliveryAddress: { type: String, default: '' },
  customerPhone:   { type: String, default: '' },
  deliveryFee:     { type: Number, default: 0 },
  scheduledTime:   { type: String, default: '' },
  dispatchStatus:  { type: String, enum: ['', 'Preparing', 'Out for Delivery', 'Awaiting Pickup', 'Delivered', 'Picked Up'], default: '' },
  // Customer / cashier special instructions (e.g. "no sugar", "extra shot")
  orderNotes: { type: String, default: '' },
  // Guest/cover count (for analytics - how many people at the table)
  guestCount: { type: Number, default: 1 },
  // Split-payment breakdown: [{ method, amount }]
  payments: [{ method: String, amount: Number }],
  // External reference the CUSTOMER supplies for their own payment - the GCash
  // / Maya / InstaPay confirmation number after scanning a payment QR, a bank
  // transfer reference, etc. Required for QR orders placed through the client
  // portal, because a QR payment leaves no trace on our side otherwise: the
  // money arrives in the wallet and this number is the only thing tying it to
  // an order. Distinct from arSettledReference, which is OUR reference for
  // collecting a receivable later.
  paymentReference: { type: String, default: '' },
  // Date written on the check when the sale was tendered by check. Post-dated
  // checks are normal in PH trade, so this is not necessarily the sale date -
  // it is the earliest the check can be banked. Carried through to the check
  // register when the receivable is collected.
  paymentCheckDate: { type: Date, default: null },
  // A/R settlement tracking (delivery partner payouts: Grab/Foodpanda/Manual Delivery)
  arSettled:        { type: Boolean, default: false },
  arSettledAt:      { type: Date },
  arSettledAmount:  { type: Number, default: 0 },
  arSettledMethod:  { type: String, default: '' },
  arSettledNote:    { type: String, default: '' },
  // External reference for this settlement - a bank transaction ID, check
  // number, GCash ref, etc. Distinct from the auto-generated internal
  // JournalEntry.reference (mkRef('ARS', ...)) - this is what ties the record
  // back to an actual bank statement line or receipt for reconciliation.
  arSettledReference: { type: String, default: '' },
  // --- PARTIAL A/R SETTLEMENT ---
  // A receivable is rarely paid in one clean shot: a client settles ₱1,500 of a
  // ₱1,700 invoice and the remaining ₱200 must stay on the books. `arPaidAmount`
  // is the running sum of every collection posted against this order, and
  // `arSettled` only flips true once that sum reaches `total`. Every A/R view
  // reads `total - arPaidAmount` (see arBalance in lib/credit.js) so a partly
  // paid invoice ages on its remaining balance, not its original face value.
  arPaidAmount: { type: Number, default: 0 },
  // One row per collection. collectionDate = when the money was actually taken
  // in from the client (what the collector reports); depositDate = when it hit
  // the bank/fund. They are genuinely different dates - cash collected Friday
  // is often only banked Monday - and reconciliation needs both.
  arPayments: [{
    amount:          { type: Number, required: true },
    paymentMethod:   { type: String, default: '' },
    referenceNumber: { type: String, default: '' },
    note:            { type: String, default: '' },
    collectionDate:  { type: Date },
    depositDate:     { type: Date },
    collectedBy:     { type: String, default: '' },
    recordedBy:      { type: String, default: '' },
    journalRef:      { type: String, default: '' },
    createdAt:       { type: Date, default: Date.now },
    // --- CHECK COLLECTIONS ---
    // A check is a PROMISE of money, not money. It is booked to Checks on Hand
    // (115000) and only becomes bank cash once it clears, so it carries its own
    // little lifecycle on top of the collection:
    //   On Hand -> Deposited -> Cleared      (the money is really ours)
    //                        -> Bounced      (it never was - the receivable reopens)
    // checkDate is the date written ON the check: post-dated checks are normal
    // in PH trade, and one cannot be deposited before that date.
    checkNumber:     { type: String, default: '' },
    checkDate:       { type: Date },
    checkBank:       { type: String, default: '' },
    // Whose account the check is drawn against - usually but not always the
    // client themselves (a third-party check is worth flagging).
    checkDrawer:     { type: String, default: '' },
    checkStatus:     { type: String, enum: ['', 'On Hand', 'Deposited', 'Cleared', 'Bounced'], default: '' },
    checkDepositedAt:{ type: Date },
    checkClearedAt:  { type: Date },
    checkBouncedAt:  { type: Date },
    checkBounceReason:{ type: String, default: '' },
    // Where a cleared check's money landed, so the JE and the register agree.
    checkClearedTo:  { type: String, default: '' },
  }],
  // Payment-terms snapshot for on-account (non-cash) sales, captured when the
  // order Completes so later changes to the client's default terms don't
  // retroactively move an existing receivable's due date.
  //   arTermsDays = the terms in days that applied at completion (null if none)
  //   arDueDate   = completedAt + arTermsDays; the date this A/R turns overdue.
  arTermsDays:      { type: Number, default: null },
  arDueDate:        { type: Date, default: null },
  // ── Logistics fields ──────────────────────────────────────────────────────
  // billingNumber: monthly-reset sequential ref (YYYY-MM-XXXX), log mode only
  billingNumber:   { type: String, default: '' },
  termsOfPayment:  { type: String, default: '' },
  // Client who placed the order (log mode; blank for fb/POS-originated orders)
  clientId:        { type: String, default: '' },
  clientUsername:  { type: String, default: '' },
}, { timestamps: true });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ status: 1, isArchived: 1 });
OrderSchema.index({ orderNumber: 1 }, { unique: true, sparse: true });
const Order = mongoose.model('Order', OrderSchema);

const QRSessionSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true },
  table: String,
  isActive: { type: Boolean, default: true },
  expiresAt: Date
});
const QRSession = mongoose.model('QRSession', QRSessionSchema);

// --- NEW ERP SCHEMAS ---
const InventorySchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  // Multi-tenancy (Phase 1): every tenant-scoped doc carries a tenantId. Backfilled
  // to the default tenant on boot. Query-scoping/auth wiring lands in Phase 2.
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  itemCode: String,
  itemName: String,
  // Organisational tags (both optional, free-form strings matching a StorageLocation
  // / StockCategory `name`). stockLocation = where the physical stock sits (a branch,
  // warehouse, or store room); stockCategory = the grouping used for the auto item-code
  // prefix (#9) and inventory filtering. Empty = untagged.
  stockLocation: { type: String, default: '', index: true },
  stockCategory: { type: String, default: '', index: true },
  stockQty: { type: Number, default: 0 },           // ALWAYS stored in base unit (g/ml/pcs) for recipe precision
  unit: String,                                       // base unit: 'g', 'ml', 'pcs'
  unitCost: { type: Number, default: 0 },             // ALWAYS per base unit (e.g. P0.07/ml when 1L costs P70)
  lowStockThreshold: { type: Number, default: 0 },
  // Display layer - what operators see (kg / L / pcs). storage stays in base units for recipe precision.
  displayUnit:     { type: String, default: '' },     // 'L', 'kg', 'pcs', 'g', 'ml' - falls back to `unit` when empty
  unitMultiplier:  { type: Number, default: 1 },      // base units per displayUnit (1 for g/ml/pcs; 1000 for L/kg)
  // Per-qty (pack) size, in displayUnit - how much ONE purchased unit/pack holds,
  // e.g. 1 for "Milk 1L", 0.25 for "Filter 250G". Distinct from unitMultiplier
  // (the fixed kg/L↔g/ml conversion factor): this is the SKU's own package size,
  // parsed from the item name on import or entered manually. null = not tracked.
  packSize:        { type: Number, default: null },
  // Suggested Retail Price (per displayUnit) - optional reference for items intended for resale.
  srp:             { type: Number, default: 0 },
  // Expiry monitoring - multi-batch (FEFO)
  // expiryDate is the SOONEST expiry across all batches (main view shows this).
  expiryDate: { type: Date },
  expiryWarnDays: { type: Number, default: 7 },
  expiryBatches: [{
    qty:         { type: Number, default: 0 },      // qty in BASE units (ml/g/pcs)
    expiryDate:  { type: Date },
    // For goods with no real expiry (roasted beans, etc.) - dates freshness by
    // when it was made instead. Used as the FEFO fallback (see batchSortDate in
    // lib/expiry.js): rotation goes by expiryDate when known, else productionDate.
    productionDate: { type: Date },
    receivedAt:  { type: Date, default: Date.now },
    reference:   { type: String, default: '' },
    unitCost:    { type: Number, default: 0 }       // per-base-unit cost when this batch was received
  }]
}, { timestamps: true });
InventorySchema.index({ expiryDate: 1 });
InventorySchema.index({ itemName: 1 });
const Inventory = mongoose.model('Inventory', InventorySchema);

// Storage places - the physical locations stock can sit in (branch, warehouse,
// cold room). Referenced by name from Inventory.stockLocation and by the
// stock-transfer workflow (#8). Kept as its own small collection so places can be
// managed (renamed, deactivated) without touching every inventory row.
const StorageLocationSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  name:      { type: String, required: true },
  note:      { type: String, default: '' },
  isActive:  { type: Boolean, default: true },
}, { timestamps: true });
StorageLocationSchema.index({ businessType: 1, name: 1 }, { unique: true });
const StorageLocation = mongoose.model('StorageLocation', StorageLocationSchema);

// Stock categories - the grouping for raw-material/inventory items (distinct from
// product menu Categories). Each carries a short manual `prefix` (2 chars) that
// drives the auto item-code sequence (#9), e.g. prefix "P" → P10001, P10002.
const StockCategorySchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  name:      { type: String, required: true },
  prefix:    { type: String, default: '' },   // uppercased, ≤4 chars; blank = fall back to global RML codes
  note:      { type: String, default: '' },
  isActive:  { type: Boolean, default: true },
}, { timestamps: true });
StockCategorySchema.index({ businessType: 1, name: 1 }, { unique: true });
const StockCategory = mongoose.model('StockCategory', StockCategorySchema);

// #8 Stock transfers - a request → approve → release workflow moving base-unit
// quantity from one inventory item (at a source location) to another (at a
// destination location). Because inventory is one-doc-per-item, "the same product
// at two locations" is modelled as two items; a transfer moves qty between them.
// This is an INTERNAL asset move (Inventory 130000 unchanged) so it posts NO
// journal entry - only StockCard audit rows on release.
const STOCK_TRANSFER_STATUSES = ['Requested', 'Approved', 'Released', 'Rejected', 'Cancelled'];
const StockTransferSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  reference:    { type: String, index: true },
  fromItemId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
  toItemId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
  itemName:     { type: String, default: '' },       // snapshot of the source item name for display
  fromLocation: { type: String, default: '' },
  toLocation:   { type: String, default: '' },
  qtyBase:      { type: Number, required: true },     // ALWAYS base units (g/ml/pcs)
  unit:         { type: String, default: '' },        // base unit label, for display
  // Which expiry lot to draw from on release. null = FEFO (oldest first, the
  // default); set = pinned to that one batch only, no FEFO spillover.
  expiryDate:   { type: Date, default: null },
  status:       { type: String, enum: STOCK_TRANSFER_STATUSES, default: 'Requested', index: true },
  note:         { type: String, default: '' },
  requestedBy:  { type: String, default: '' },
  approvedBy:   { type: String, default: '' },
  releasedBy:   { type: String, default: '' },
  approvedAt:   { type: Date },
  releasedAt:   { type: Date },
}, { timestamps: true });
StockTransferSchema.index({ businessType: 1, status: 1, createdAt: -1 });
const StockTransfer = mongoose.model('StockTransfer', StockTransferSchema);

// ── Backdate Sale Queue ────────────────────────────────────────────────────
// A billing-statement row that's missing something the sale needs to post
// (today: only "Terms of Payment" left blank, i.e. no payment method) lands
// here instead of being silently defaulted or dropped during bulk Excel
// import. An operator opens the queue, supplies the missing piece, and
// "Save" turns it into a real backdated sale through the same posting path
// as every other one.
const BackdateQueueItemSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  transNo: { type: String, default: '' },
  client: { type: String, default: '' },
  date: { type: String, default: '' }, // YYYY-MM-DD, as parsed from the sheet
  sheet: { type: String, default: '' }, // originating Excel tab, for traceability
  items: [{
    code: String, name: String, quantity: Number, price: Number,
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    productCode: String,
  }],
  missingFields: [{ type: String }], // e.g. ['paymentMethod']
  status: { type: String, enum: ['pending', 'resolved', 'discarded'], default: 'pending', index: true },
  resolvedOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
}, { timestamps: true });
BackdateQueueItemSchema.index({ businessType: 1, status: 1, createdAt: -1 });
const BackdateQueueItem = mongoose.model('BackdateQueueItem', BackdateQueueItemSchema);

// ── Hub: inter-business connections & cross-tenant transfers ─────────────────
const LinkedBusinessSchema = new mongoose.Schema({
  businessType: { type: String, required: true, index: true },
  role:         { type: String, enum: ['hub', 'client'], required: true },
  partnerSlug:  { type: String, required: true },
  partnerName:  String,
  partnerUrl:   String,
  linkToken:    { type: String, required: true },
  status:       { type: String, enum: ['active', 'suspended'], default: 'active' },
  linkedAt:     Date,
}, { timestamps: true });
LinkedBusinessSchema.index({ businessType: 1, partnerSlug: 1 }, { unique: true });
const LinkedBusiness = mongoose.model('LinkedBusiness', LinkedBusinessSchema);

const HubInviteSchema = new mongoose.Schema({
  businessType: { type: String, required: true },
  code:         { type: String, required: true, unique: true },
  expiresAt:    { type: Date, required: true },
  usedAt:       Date,
}, { timestamps: true });
const HubInvite = mongoose.model('HubInvite', HubInviteSchema);

const CrossTransferSchema = new mongoose.Schema({
  businessType: { type: String, required: true, index: true },
  direction:    { type: String, enum: ['outbound', 'inbound'], required: true },
  partnerSlug:  String,
  partnerName:  String,
  itemId:       mongoose.Schema.Types.ObjectId,
  targetItemId: mongoose.Schema.Types.ObjectId,
  itemName:     String,
  unit:         String,
  qtyBase:      Number,
  note:         String,
  // --- ITEM DESCRIPTOR SNAPSHOT ---
  // Taken from the sending item when the slip is filed and carried across the
  // wire. Without these the receiving business auto-creates a nameless item at
  // zero cost, which values the whole shipment at nothing: the inbound journal
  // entry posts 0 and the stock arrives worthless. The snapshot is frozen on
  // purpose - it is what the goods were worth when they left, which is what
  // the receiving side must book them in at.
  unitCost:       { type: Number, default: 0 },   // per BASE unit, at send time
  displayUnit:    { type: String, default: '' },  // e.g. 'pcs', 'box'
  unitMultiplier: { type: Number, default: 1 },   // base units per display unit
  packSize:       { type: Number, default: null },
  itemCode:       { type: String, default: '' },
  stockCategory:  { type: String, default: '' },
  reference:    { type: String, index: true },
  // Groups all line-items sent in the same "send" action.
  shipmentRef:  { type: String, index: true },
  // Which expiry batch was picked when sending (internal use only, not shown to customers).
  batchInfo:    { expiryDate: Date, batchIdx: Number },
  // 'Requested' is the pre-send approval gate: an outbound shipment is drafted
  // by staff and sits here until someone with authority approves it, exactly
  // like an internal StockTransfer or a requisition slip. Only on approval is
  // the partner notified, so nothing crosses a business boundary unapproved.
  // Inbound rows never enter 'Requested' - they arrive already approved by the
  // sending business and start at 'Pending' awaiting our accept/reject.
  status:       { type: String, enum: ['Requested', 'Pending', 'Accepted', 'Rejected', 'Cancelled', 'Released', 'Received'], default: 'Pending' },
  receivedAt:   Date,
  // Transfer-slip trail - who asked, who authorised, and why it was refused.
  requestedBy:  { type: String, default: '' },
  approvedBy:   { type: String, default: '' },
  approvedAt:   { type: Date },
  rejectedBy:   { type: String, default: '' },
  rejectionReason: { type: String, default: '' },
}, { timestamps: true });
const CrossTransfer = mongoose.model('CrossTransfer', CrossTransferSchema);

// ── HUB TRANSFER REQUESTS - negotiated stock ASKS between businesses ────────
// Distinct from CrossTransfer (an already-agreed shipment being sent/received):
// this is the negotiation that happens BEFORE one exists. Either business can
// initiate - "send me your extra 50 units of X" - and the other side can
// decline outright, or counter with what they can actually give (fewer units,
// or drop a line entirely), before it ever commits to moving real stock.
//
// Each business's own server keeps its OWN copy of the SAME negotiation,
// linked by `requestRef` (shared across both databases, since Mongo _ids
// differ per tenant) and kept in sync via the existing partnerCall/
// requireLinkToken internal-route pattern CrossTransfer already uses.
// `side` says which copy this is: 'filed' on the initiator's server, 'received'
// on the other party's.
//
// Fixed-depth negotiation (by design, not an oversight - see the state
// machine in hub.js):
//   Pending        - awaiting the OTHER party's first response
//     -> Declined       (either party, any time before Approved)
//     -> Approved       (the other party accepts the ask exactly as asked -
//                        nothing negotiated, so it commits immediately)
//     -> CounterPending (the other party proposes different quantities/lines)
//   CounterPending -> Declined | AwaitingFinal (original requester accepts the
//                     counter - but the fulfilling side gets one more look
//                     before real stock commits, since accepting a counter
//                     isn't the same as promising to ship it NOW)
//   AwaitingFinal  -> Declined | Approved (fulfilling side's final sign-off -
//                     THIS is what actually creates the CrossTransfer shipment)
const TRANSFER_REQUEST_STATUSES = ['Pending', 'CounterPending', 'AwaitingFinal', 'Approved', 'Declined', 'Cancelled'];
const TransferRequestSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  requestRef:   { type: String, index: true, required: true },   // shared across both businesses' copies
  side:         { type: String, enum: ['filed', 'received'], required: true },
  fromSlug:     String, fromName: String,   // who would SHIP if this is approved
  toSlug:       String, toName:   String,   // who would RECEIVE
  filedBySlug:  String,                     // fromSlug or toSlug - whoever initiated the ask
  status:       { type: String, enum: TRANSFER_REQUEST_STATUSES, default: 'Pending', index: true },
  // `lines` is always "what's currently on the table" - overwritten wholesale
  // on a counter, so there is exactly one place to read the live proposal
  // from. `originalLines` is a frozen snapshot of the very first ask, kept so
  // the negotiation history can show what changed.
  lines:         [{ itemId: String, itemName: String, unit: String, qty: Number, note: String }],
  originalLines: [{ itemId: String, itemName: String, unit: String, qty: Number, note: String }],
  round:         { type: Number, default: 1 },   // 1 = original ask, 2 = countered
  history:       [{ by: String, slug: String, action: String, note: String, at: { type: Date, default: Date.now } }],
  requestedBy:   { type: String, default: '' },   // staff name who filed the ask
  respondedBy:   { type: String, default: '' },   // staff name who last acted on the other side
  // Set once Approved - the CrossTransfer shipmentRef the negotiation turned into.
  linkedShipmentRef: { type: String, default: '' },
}, { timestamps: true });
TransferRequestSchema.index({ businessType: 1, requestRef: 1, side: 1 }, { unique: true });
const TransferRequest = mongoose.model('TransferRequest', TransferRequestSchema);


const JournalEntrySchema = new mongoose.Schema({
  date: { type: Date, default: Date.now, index: true },
  reference: { type: String, index: true },
  description: String,
  lines: [{
    accountCode: String,
    accountName: String,
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 }
  }],
  totalDebit: Number,
  totalCredit: Number,
  // Supplier attribution for A/P entries - set when goods are received on credit
  // and when the supplier is paid. Without this, "how much do we owe Best Beans?"
  // can only be answered by reading descriptions. Optional and additive: entries
  // that predate it simply group under "Unattributed".
  supplierId:   { type: String, default: null, index: true },
  supplierName: { type: String, default: '' },
}, { timestamps: true });

// ── Data-layer double-entry guarantee ────────────────────────────────────────
// A journal entry can NEVER be persisted unbalanced. This is the floor beneath
// every app-level assertBalanced() call: no route, migration, script, or future
// code path can write books that don't balance, because Mongoose runs this on
// every create()/save()/insertMany() before the document is stored. Debits must
// equal credits to within one centavo; the denormalized totals are re-derived
// from the lines here so they can never drift out of sync with them.
JournalEntrySchema.pre('validate', function () {
  const lines = this.lines || [];
  if (!lines.length) return;
  // Throws on imbalance - Mongoose 9 runs validate hooks promise-style, so a
  // throw here rejects the create()/save()/insertMany() before anything is
  // written. This is the single chokepoint every entry must pass through.
  assertBalanced(lines, `ref ${this.reference || '?'}`);
  this.totalDebit = Math.round(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0) * 100) / 100;
  this.totalCredit = Math.round(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0) * 100) / 100;
});

const JournalEntry = mongoose.model('JournalEntry', JournalEntrySchema);

// --- CUMULATIVE DASHBOARD COUNTERS ---
// Replaces the two unbounded Order.aggregate() scans the dashboard used to run
// on every load (full order history, every time). Updated with atomic $inc
// inside the same transaction as whatever flips an order's status to/from
// 'Completed' (see applyStatsDelta in orders.js).
//
// SHARDED, not true singletons: a hot document written by EVERY concurrent
// order completion/void/refund inside a multi-document transaction collides
// on WriteConflict far more than any other document in this schema (proven
// under a 20-way concurrent-completion test during development, all sharing
// one product - see test/tenant-stats-concurrency.integration.test.js).
// STATS_SHARDS documents share one businessType (ProductStats: one businessType
// +productName); applyStatsDelta picks a random shard per write, and reads
// (reports.js) sum across all shards. Read cost stays ~O(shard count), not
// O(order history) - TenantStats always has businessType×STATS_SHARDS docs
// total; ProductStats has at most businessType×productCount×STATS_SHARDS.
const STATS_SHARDS = 8;
const TenantStatsSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  shard: { type: Number, default: 0 },
  cumulativeRevenue: { type: Number, default: 0 },
  cumulativeComp: { type: Number, default: 0 },
  cumulativeOrderCount: { type: Number, default: 0 },
  cumulativeNonCompCount: { type: Number, default: 0 },
}, { timestamps: true });
TenantStatsSchema.index({ businessType: 1, shard: 1 }, { unique: true });
const TenantStats = mongoose.model('TenantStats', TenantStatsSchema);

const ProductStatsSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  productName: { type: String, required: true },
  shard: { type: Number, default: 0 },
  cumulativeQty: { type: Number, default: 0 },
  cumulativeRevenue: { type: Number, default: 0 },
}, { timestamps: true });
ProductStatsSchema.index({ businessType: 1, productName: 1, shard: 1 }, { unique: true });
const ProductStats = mongoose.model('ProductStats', ProductStatsSchema);

const InventoryMovementSchema = new mongoose.Schema({
  date: { type: Date, required: true }, // Normalized to start of the day
  inventoryId: String,
  itemName: String,
  unit: String,
  beginningBalance: { type: Number, default: 0 },
  purchasesIn: { type: Number, default: 0 },
  salesOut: { type: Number, default: 0 },
  systemEndingBalance: { type: Number, default: 0 },
  actualPhysicalCount: { type: Number, default: null },
  variance: { type: Number, default: 0 },
  isClosed: { type: Boolean, default: false }
});
const InventoryMovement = mongoose.model('InventoryMovement', InventoryMovementSchema);

const StockCardSchema = new mongoose.Schema({
  inventoryId: String,
  itemName: String,
  date: { type: Date, default: Date.now },
  type: String, // 'Restock', 'Sale', 'Adjustment', 'Initial'
  reference: String, // Order Number, JE ref, etc.
  qtyChange: Number, // Positive for in, Negative for out
  balanceAfter: Number,
  unitCost: Number,
  remarks: String
});
StockCardSchema.index({ inventoryId: 1 });
StockCardSchema.index({ reference: 1 });
const StockCard = mongoose.model('StockCard', StockCardSchema);

// --- SHIFT MANAGEMENT SCHEMA ---
const ShiftSchema = new mongoose.Schema({
  cashierId:       { type: String, required: true },
  cashierName:     { type: String, required: true },
  startingCash:    { type: Number, required: true, default: 0 },
  shiftStart:      { type: Date, default: Date.now },
  shiftEnd:        Date,
  salesTotal:      { type: Number, default: 0 },   // Cash sales only during this shift
  expectedCash:    Number,                          // startingCash + salesTotal
  actualCash:      Number,                          // What cashier counted at close
  variance:        Number,                          // actualCash - expectedCash
  depositedAmount: { type: Number, default: 0 },   // Total posted to bank this shift
  isReconciled:    { type: Boolean, default: false },
  status:          { type: String, default: 'Open' } // 'Open' | 'Closed' | 'Reconciled'
}, { timestamps: true });
const Shift = mongoose.model('Shift', ShiftSchema);

// ── STAFF CLOCK ENTRIES ──────────────────────────────────────────────────────
const ClockEntrySchema = new mongoose.Schema({
  staffId:         { type: String, required: true, index: true },
  staffName:       { type: String, required: true },
  clockIn:         { type: Date, default: Date.now },
  clockOut:        { type: Date },
  durationMinutes: { type: Number },        // gross minutes (clockIn → clockOut)
  breakMinutes:    { type: Number, default: 0 },  // total break minutes used this shift
  workedMinutes:   { type: Number },        // gross minus breaks (for payroll)
  breaks:          [{ start: Date, end: Date, minutes: Number }],
  date:            { type: String, index: true }, // YYYY-MM-DD (Manila)
  notes:           { type: String, default: '' }
}, { timestamps: true });
const ClockEntry = mongoose.model('ClockEntry', ClockEntrySchema);

// ── SHIFT SCHEDULING (ROSTER) ────────────────────────────────────────────────
// A PLANNED future shift - distinct from `Shift` (a cash-drawer reconciliation
// record created when a cashier actually opens the register) and `ClockEntry`
// (attendance, created on clock-in). This is the roster: a manager assigns a
// staff member to a date + time window ahead of time, staff see their upcoming
// schedule. Deliberately does NOT auto-link to the real Shift/ClockEntry a
// staffer later opens - comparing planned vs. actual is a reporting concern
// that can layer on later; the roster stands alone.
//
// `date` is the local calendar day (YYYY-MM-DD, Manila) the shift is scheduled
// for; startTime/endTime are 'HH:MM' strings within that day. Storing wall-
// clock strings rather than absolute Datetimes keeps a roster stable across DST
// and matches how a manager thinks ("Ana, Tuesday, 9am-5pm"), the same
// YYYY-MM-DD convention ClockEntry.date already uses.
const SCHEDULED_SHIFT_STATUSES = ['Draft', 'Published', 'Cancelled'];
const ScheduledShiftSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  staffId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  staffName:    { type: String, required: true },              // snapshot for display without a join
  date:         { type: String, required: true, index: true }, // YYYY-MM-DD (Manila)
  startTime:    { type: String, required: true },              // 'HH:MM'
  endTime:      { type: String, required: true },              // 'HH:MM'
  role:         { type: String, default: '' },                 // station/role for the shift, e.g. 'Cashier', 'Kitchen'
  notes:        { type: String, default: '' },
  // Draft rosters are the manager's working copy; staff only see Published ones
  // (enforced in scheduling.js's my-schedule route).
  status:       { type: String, default: 'Draft', enum: SCHEDULED_SHIFT_STATUSES, index: true },
  createdBy:    { type: String, default: '' },
}, { timestamps: true });
ScheduledShiftSchema.index({ businessType: 1, date: 1, staffId: 1 });
const ScheduledShift = mongoose.model('ScheduledShift', ScheduledShiftSchema);

// The owner (superadmin) is excluded from staff-facing reports - hours, shift
// history, cashier variance - since they're not a tracked employee/cashier.
// Returns their user _id strings for use in a $nin filter.
const ownerUserIds = async () => {
  const owners = await User.find({ role: 'superadmin' }, { _id: 1 }).lean();
  return owners.map(o => String(o._id));
};

// Owner identity for staff-report exclusion. Returns both _ids AND names so we
// also filter out shifts/clock rows left behind by a PREVIOUS superadmin account
// (orphaned cashierId that no longer matches the current owner _id).
const ownerIdentity = async () => {
  const owners = await User.find({ role: 'superadmin' }, { _id: 1, name: 1 }).lean();
  return {
    ids:   owners.map(o => String(o._id)),
    names: owners.map(o => o.name).filter(Boolean),
  };
};

// Helper: append a structured audit log entry. Uses the existing AuditLog
// schema (userId/action/targetReference/details) - see model defined further
// below. Wrapped in try/catch so accounting calls never fail because logging did,
// but failures are surfaced to the application logger so silent loss is visible.
async function logAudit(req, { action, entity, entityId, before, after, notes }) {
  // Cap payload size so a freak large object can't bloat the audit collection.
  const cap = (v) => {
    if (v == null) return null;
    try {
      const s = JSON.stringify(v);
      if (s.length <= 4000) return v;
      return { _truncated: true, preview: s.slice(0, 4000) };
    } catch (e) { return { _unserializable: String(e?.message || e) }; }
  };
  try {
    const actor = req?.user || {};
    await AuditLog.create({
      userId: actor.name || 'system',
      action: `${entity}_${(action || 'change').toUpperCase()}`,
      targetReference: entityId ? String(entityId) : (entity || 'n/a'),
      details: { entity, before: cap(before), after: cap(after), notes: notes || null, ip: req?.ip || null },
    });
  } catch (e) {
    // Logging is best-effort, but never let a failure stay invisible.
    try { (typeof log !== 'undefined' ? log.error : console.error)({ err: e, entity, action, entityId }, 'logAudit failed'); }
    catch { console.error('logAudit failed:', e?.message || e); }
  }
}

// --- PAYMENT METHOD → ACCOUNT MAP ──────────────────────────────────────────
// Lets a finance manager route each POS payment method to a specific account.
// Default mappings are seeded on first boot; superadmin can change them or
// point a method at a custom child sub-account (e.g. "GCash → BPI E-Wallet 113001").
const PaymentMethodMapSchema = new mongoose.Schema({
  method:      { type: String, unique: true, index: true },  // 'Cash', 'GCash', 'Bank Transfer', etc.
  accountCode: { type: String, required: true },             // any canonical or custom account code
  updatedBy:   String,
}, { timestamps: true });
const PaymentMethodMap = mongoose.model('PaymentMethodMap', PaymentMethodMapSchema);

// Default routing seeded on first boot. Overridable per-method via the UI.
const DEFAULT_PAYMENT_ACCOUNT_MAP = {
  'Cash':              '111000',
  'Pickup':            '111000',
  'Manual Delivery':   '111000',
  'Lalamove':          '111000',
  'Bank Transfer':     '112000',
  'Cash in Bank':      '112000',
  // Checks land in Checks on Hand, not the bank - see 115000 in chartOfAccounts.js.
  'Check':             '115000',
  // Scan-to-pay QR (GCash/Maya/InstaPay QR Ph). Lands in E-Wallet like the
  // named wallets it is funded from - the reference number on the order is
  // what identifies which wallet actually received it.
  'QR':                '113000',
  'GCash':             '113000',
  'Maya':              '113000',
  'Maribank':          '113000',
  'E-Wallet':          '113000',
  'Other E-Wallet':    '113000',
  'On Account':        '220000',
  'Grab Delivery':     '120000',
  'Foodpanda':         '120000',
};

// In-memory cache; refreshed on every mutation. Avoids a DB lookup on every order.
let PAYMENT_MAP_CACHE = { ...DEFAULT_PAYMENT_ACCOUNT_MAP };
async function refreshPaymentMap() {
  try {
    const rows = await PaymentMethodMap.find().lean();
    const next = { ...DEFAULT_PAYMENT_ACCOUNT_MAP };
    for (const r of rows) if (r.method && r.accountCode) next[r.method] = r.accountCode;
    PAYMENT_MAP_CACHE = next;
  } catch { /* keep prior cache */ }
}
refreshPaymentMap();

// Resolve a payment method to { code, name }.
//   1) Explicit override in PaymentMethodMap (user picked a specific account in
//      the Routing UI) - wins unconditionally.
//   2) Otherwise: look under the canonical parent (e.g. GCash → 113xxx parent)
//      for a CUSTOM CHILD whose name matches the payment method (case-insensitive).
//      So if the user adds "GCash" as 113001 under E-Wallet, the GCash payment
//      method routes to it automatically - no manual mapping needed.
//   3) Otherwise: the canonical parent code.
//   4) Otherwise: Cash on Hand.
function accountForPaymentMethod(method) {
  // (1) Explicit override
  const overrideCode = PAYMENT_MAP_CACHE[method];
  // We can't tell from PAYMENT_MAP_CACHE whether this is a default or an override;
  // the user-facing override always points at a specific code (canonical or custom).
  // If a custom override exists in the Account collection, prefer it.
  if (overrideCode) {
    const overrideMeta = acctMeta(overrideCode);
    if (overrideMeta?.parent) {
      return { code: overrideCode, name: overrideMeta.name || method };
    }
  }
  // (2a) Custom sub-account whose NAME equals the payment method, regardless
  //      of which parent - lets the cashier pick "Metrobank" or "Gotyme" at
  //      checkout even though those names aren't in the canonical default map.
  //      Only matches under payment-relevant parents (cash/bank/ewallet/AR/AP)
  //      so a random expense sub-account can't be accidentally targeted.
  const PAYMENT_PARENTS = new Set(['111000','112000','113000','115000','120000','220000']);
  const wanted = String(method || '').trim().toLowerCase();
  for (const [code, meta] of CUSTOM_META.entries()) {
    if (!PAYMENT_PARENTS.has(meta.parent)) continue;
    if (String(meta.name || '').trim().toLowerCase() === wanted) {
      return { code, name: meta.name };
    }
  }
  // (2b) Auto-bind: legacy path. Method has a canonical default parent and a
  //      custom child of that parent happens to share its name.
  const knownDefault = DEFAULT_PAYMENT_ACCOUNT_MAP[method];
  const defaultParent = knownDefault || '111000';
  for (const [code, meta] of CUSTOM_META.entries()) {
    if (meta.parent === defaultParent && String(meta.name || '').trim().toLowerCase() === wanted) {
      return { code, name: meta.name };
    }
  }
  // (3) Canonical parent
  if (overrideCode) {
    return { code: overrideCode, name: acctMeta(overrideCode)?.name || method };
  }
  // (4) Unassigned fallback. The tender has no explicit mapping, no matching
  //     custom sub-account, and isn't a seeded default - so we can't safely
  //     guess its account. Park it in a dedicated clearing account (118000)
  //     and flag `fallback` so callers can alert a manager to route it. Never
  //     silently absorb an unmapped tender into Cash on Hand.
  if (!knownDefault) {
    const meta = acctMeta('118000');
    return { code: '118000', name: meta?.name || 'Unassigned Receipts', fallback: true };
  }
  const meta = acctMeta(defaultParent);
  return { code: defaultParent, name: meta?.name || 'Cash on Hand' };
}

// --- CLOSED ACCOUNTING PERIODS ──────────────────────────────────────────────
// A period (year + month) once closed blocks all back-dated mutations to
// journal entries / orders / inventory in that month. Reopening is allowed
// for superadmin and is itself audited.
const ClosedPeriodSchema = new mongoose.Schema({
  year:      { type: Number, required: true, index: true },
  month:     { type: Number, required: true, index: true }, // 1-12
  closedBy:  String,
  closedAt:  { type: Date, default: Date.now },
  notes:     String,
  reopenedBy: String,
  reopenedAt: Date,
  isOpen:    { type: Boolean, default: false, index: true },
}, { timestamps: true });
ClosedPeriodSchema.index({ year: 1, month: 1 }, { unique: true });
const ClosedPeriod = mongoose.model('ClosedPeriod', ClosedPeriodSchema);

// Check if a given date falls in a closed period. Returns the period doc if
// closed, else null. Use this to gate any back-dated write.
async function periodLockFor(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const lock = await ClosedPeriod.findOne({
    year: d.getFullYear(), month: d.getMonth() + 1, isOpen: false,
  }).lean();
  return lock || null;
}

// --- CHART OF ACCOUNTS ---
const AccountSchema = new mongoose.Schema({
  code:          { type: String, unique: true },
  name:          String,
  type:          String, // 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' …
  normalBalance: String, // 'Debit' | 'Credit'
  parent:        String,            // parent account code (for custom child accounts)
  custom:        { type: Boolean, default: false }, // user-created child account
  // Lets a custom sub-account be pulled out of the payment-method list (POS,
  // client portal, QR menu) WITHOUT deleting it - deleting is blocked once a
  // journal entry has posted to the code, so this is the only way to retire a
  // discontinued tender ("we stopped accepting GoTyme") while keeping its
  // history intact. Canonical accounts ignore this - they are never deleted.
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });
const Account = mongoose.model('Account', AccountSchema);

// --- BANK DEPOSITS ---
const BankDepositSchema = new mongoose.Schema({
  shiftId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
  amount:             { type: Number, required: true },
  depositedBy:        String,
  reference:          String,  // slip number or note
  journalEntryId:     { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  drawerBalanceAfter: Number,
  isDrawerReconciled: { type: Boolean, default: false },
}, { timestamps: true });
const BankDeposit = mongoose.model('BankDeposit', BankDepositSchema);

// Seed cash management accounts (codes match existing JournalEntry account codes)
const DEFAULT_ACCOUNTS = [
  { code: '111000', name: 'Cash on Hand',             type: 'Asset',   normalBalance: 'Debit'  },
  { code: '112000', name: 'Cash in Bank',              type: 'Asset',   normalBalance: 'Debit'  },
  { code: '118000', name: 'Unassigned Receipts',       type: 'Asset',   normalBalance: 'Debit'  },
  { code: '410000', name: 'Sales Revenue',             type: 'Income',  normalBalance: 'Credit' },
  { code: '930000', name: 'Cash Short & Over Expense', type: 'Expense', normalBalance: 'Debit'  },
  { code: '830000', name: 'Cash Short & Over Income',  type: 'Income',  normalBalance: 'Credit' },
];
(async () => {
  for (const acct of DEFAULT_ACCOUNTS) {
    await Account.findOneAndUpdate({ code: acct.code }, acct, { upsert: true, setDefaultsOnInsert: true });
  }
})();

// In-memory meta for custom child accounts so reports (P&L / Balance Sheet) can
// classify them. Each custom child inherits its canonical parent's behaviour
// (type + cogs flag). Refreshed at boot and after every COA mutation.
const CUSTOM_META = new Map();
async function refreshCustomMeta() {
  try {
    const rows = await Account.find({ custom: true }).lean();
    CUSTOM_META.clear();
    for (const a of rows) {
      const p = ACCOUNTS[a.parent] || {};
      CUSTOM_META.set(a.code, { name: a.name, type: a.type || p.type, parent: a.parent, cogs: !!p.cogs, isActive: a.isActive !== false });
    }
  } catch { /* non-fatal */ }
}
// Resolve account meta from the canonical chart, falling back to custom children.
const acctMeta = (code) => ACCOUNTS[code] || CUSTOM_META.get(code) || null;
refreshCustomMeta();

const UserSchema = new mongoose.Schema({
  userCode: { type: String, index: true },
  name: { type: String, required: true, index: true },
  password: { type: String, required: true },
  role: { type: String, default: 'Staff' },
  // Seller commission: percent (0-100) applied to this user's own Completed,
  // non-complimentary sales (matched by Order.cashier === User.name - see
  // GET /api/reports/commissions in reports.js). 0 = no commission, the
  // default for every existing account until explicitly set.
  commissionRate: { type: Number, default: 0, min: 0, max: 100 },
  // Granular RBAC: explicit permission override. Empty ⇒ fall back to the role's
  // defaults (see lib/authz.js resolvePermissions). Ignored for superadmin (full).
  permissions: { type: [String], default: [] },
  // Multi-tenancy (Phase 2a): which tenant this staff user belongs to. Carried into
  // the access token so Phase 2b can scope every query by the caller's tenant.
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null }
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

// ── CLIENT ACCOUNTS (logistics mode only) ────────────────────────────────────
// Pre-registered clients who log in to place orders directly (no QR scan).
// Created/managed by superadmin. paymentMethod is pre-set per client.
const ClientAccountSchema = new mongoose.Schema({
  clientCode:    { type: String, index: true },                 // standard customer ID, e.g. CUS-1000-A0001 (legacy accounts may still carry CLT-A0001)
  username:      { type: String, required: true, unique: true },
  password:      { type: String, required: true },              // bcrypt-hashed
  name:          { type: String, required: true },
  // Contact details for collections/notices/general CRM. All optional and
  // free-form - a POS-promoted walk-in (source:'pos') often has none, and a
  // portal signup isn't required to provide them either. `phone`/`email` are
  // deliberately NOT unique: two family members can legitimately share a phone.
  phone:         { type: String, default: '' },
  email:         { type: String, default: '' },
  contactNotes:  { type: String, default: '' },                 // free-form ("prefers SMS", "call after 5pm", etc.)
  paymentMethod: { type: String, default: 'Cash' },             // pre-set; can be overridden per order
  isActive:      { type: Boolean, default: true },
  // 'portal' = real client-portal login (username/password usable). 'pos' = auto-promoted
  // from a repeat POS walk-in (3+ Completed orders under the same name) - carries a
  // placeholder username/unusable password since it has no login of its own.
  source:        { type: String, enum: ['portal', 'pos'], default: 'portal' },
  // Credit limit in pesos for on-account (non-cash) buying.
  //   null  = no per-client limit set - falls back to the global limit if the
  //           active mode uses one.
  //   0     = an explicit "no credit at all" (different from null on purpose).
  // Whether either limit is enforced at all is decided by the `creditLimitMode`
  // setting; see resolveCreditLimit().
  creditLimit:   { type: Number, default: null },
  // Payment terms in days for on-account (non-cash) sales. When a non-cash order
  // Completes, this is snapshotted onto the order to compute its A/R due date
  // (dueDate = completedAt + creditTermsDays). 0 = due on receipt (COD-style).
  // null = no terms configured - the A/R views then age from the order date only.
  creditTermsDays: { type: Number, default: null },
  // Free-form tags (e.g. "wholesale", "vip") a product's segmentDiscounts can
  // target instead of (or in addition to) a one-off clientDiscounts entry for
  // this specific client. Empty = no segment-level discount applies.
  segments:      { type: [String], default: [] },
  // The client's OWN portal appearance, stored on the account so it follows them
  // across devices. Deliberately separate from the staff-side `dash.theme`
  // (per-device localStorage): a shop changing its POS theme must not restyle
  // its customers' portals. null = follow the shipped default.
  theme:         { type: String, enum: ['default', 'light', 'yellow', 'ocean', null], default: null },
  // Self-service onboarding link (#10): superadmin generates a one-time token
  // from the Command Center for an auto-promoted (source:'pos') account that
  // has no real login yet - the client opens the link, confirms/fills their
  // own contact details, and sets their own username/password. Single-use:
  // cleared the moment onboarding completes. null = no link outstanding.
  onboardingToken:          { type: String, default: null, index: true },
  onboardingTokenExpiresAt: { type: Date, default: null },
}, { timestamps: true });
const ClientAccount = mongoose.model('ClientAccount', ClientAccountSchema);

// --- AR COLLECTION REMINDERS ---
// A log of contact attempts against an overdue client, not an automated
// sender - nothing in this app emails/SMSes a client on its own (same reason
// payment gateway integration is out of scope: no new third-party dependency).
// Staff log that a call/text/email/letter went out and when to follow up next;
// `/api/collections/overdue` and `/api/collections/due` (collections.js) turn
// that into a worklist.
//
// Keyed by `clientKey`, NOT clientAccountId - orders here can carry
// customerName with no linked ClientAccount at all (see ar-ageing's own
// `keyOf` resolution in finance.js), so reminders use the exact same resolved
// key the aging views group by, or the two would silently disagree about who
// owes what.
const CollectionReminderSchema = new mongoose.Schema({
  businessType:     { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  clientKey:        { type: String, required: true, index: true },
  clientAccountId:  { type: mongoose.Schema.Types.ObjectId, ref: 'ClientAccount', default: null },
  method:           { type: String, enum: ['Call', 'SMS', 'Email', 'In-person', 'Letter', 'Other'], required: true },
  note:             { type: String, default: '' },
  amountOwedAtTime: { type: Number, default: 0 }, // snapshot - the aged balance keeps moving, this is what it was when contact was made
  loggedBy:         { type: String, default: '' },
  nextFollowUpDate: { type: Date, default: null },
}, { timestamps: true });
CollectionReminderSchema.index({ businessType: 1, clientKey: 1, createdAt: -1 });
const CollectionReminder = mongoose.model('CollectionReminder', CollectionReminderSchema);

// Refresh-token session store - enables instant server-side revocation.
// tokenHash = sha256(rawRefreshToken); the raw token lives only in the client's
// httpOnly cookie. `revoked` is set on logout/rotation; expired docs auto-purge
// via the TTL index on expiresAt.
const RefreshSessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, index: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  revoked:   { type: Boolean, default: false },
  replacedBy:{ type: String },          // tokenHash of the rotated successor (audit trail)
  userAgent: { type: String },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
RefreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL auto-cleanup
const RefreshSession = mongoose.model('RefreshSession', RefreshSessionSchema);

// --- NEW: CUSTOM ROLES SCHEMA & ROUTES ---
// Custom roles created in the UI role-maker. `permissions` is the granular set a
// user with this role gets by default (unless the user has an explicit override).
const RoleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  permissions: { type: [String], default: [] },
});
const Role = mongoose.model('Role', RoleSchema);

// Load custom-role permissions into the authz resolver. Called at boot and after
// every role mutation so newly-granted permissions take effect on next login/refresh.
async function refreshCustomRolePerms() {
  try { setCustomRolePermissions(await Role.find().lean()); }
  catch (e) { (typeof log !== 'undefined' ? log.error : console.error)({ err: e }, 'refreshCustomRolePerms failed'); }
}


// ── CLIENT ACCOUNTS (logistics mode only) ────────────────────────────────────








// 1. Minimal Audit Log Schema (New)
// ── CHANGE REQUESTS ──────────────────────────────────────────────────────────
// A held edit to a money lever - a selling price, a cost basis, a client's
// credit line. Someone without pricing.approve edits as normal; the guarded
// FIELDS of that edit are peeled off into one of these and the rest is written
// straight away, so a price change never lands unreviewed while a harmless
// rename still works. See lib/changeApproval.js for which fields are gated.
//
// `changes` snapshots BOTH values: the approver is agreeing to a specific
// "250 -> 300", so applying it later re-checks that the current value is still
// 250 rather than blindly overwriting whatever it has since become.
const CHANGE_REQUEST_STATUSES = ['Pending', 'Approved', 'Rejected'];
const ChangeRequestSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  entity:       { type: String, enum: ['Product', 'Inventory', 'ClientAccount'], required: true },
  entityId:     { type: String, required: true, index: true },
  entityName:   { type: String, default: '' },   // snapshot, so the queue reads well even if renamed later
  changes: [{
    field:    { type: String, required: true },
    label:    { type: String, default: '' },
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
  }],
  reason:       { type: String, default: '' },
  status:       { type: String, enum: CHANGE_REQUEST_STATUSES, default: 'Pending', index: true },
  requestedBy:  { type: String, default: '' },
  approvedBy:   { type: String, default: '' },
  approvedAt:   { type: Date },
  rejectedBy:   { type: String, default: '' },
  rejectionReason: { type: String, default: '' },
  appliedAt:    { type: Date },
}, { timestamps: true });
ChangeRequestSchema.index({ businessType: 1, status: 1, createdAt: -1 });
const ChangeRequest = mongoose.model('ChangeRequest', ChangeRequestSchema);

const AuditLogSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  action: { type: String, required: true },
  targetReference: { type: String, required: true },
  details: { type: Object },
  timestamp: { type: Date, default: Date.now }
});
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

// (Auth middleware - verifyToken, requireStaff, verifyClientToken, requireSuperAdmin,
//  requireSuperOrAdmin, verifyOrderAuth - are defined earlier, before the first route
//  that uses them, to avoid TDZ errors.)

const DiscountSchema = new mongoose.Schema({
  name: String,        // e.g., "Senior Citizen 20%", "Employee 10%"
  percentage: Number,  // e.g., 20
  isSCPWD: { type: Boolean, default: false },
});
const Discount = mongoose.model('Discount', DiscountSchema);

// --- CONFIGURABLE DISCOUNT RULE ENGINE ---
// Order-level CONDITIONAL discount rules - the "spend ₱1000 get 10% off",
// "15% off on Tuesdays", "wholesale segment gets 5% all December" kind - which
// none of the existing discount mechanisms cover: Product.discountPercent /
// clientDiscounts / segmentDiscounts / bulkBreaks are all PER-LINE and
// unconditional, and the Discount model is just named SC/PWD-style presets.
//
// DELIBERATELY NOT auto-applied in the order money path. The POS calls
// POST /api/discount-rules/evaluate with an order's context, gets back the
// single best matching rule's percent, and applies it through the EXISTING,
// fully-tested order-level `discountPercent` field on the order. That keeps the
// VAT/discount/ledger math - the most safety-critical code in the app -
// completely untouched; this feature only decides WHICH percent to suggest,
// never how it's booked.
const DiscountRuleSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  name:         { type: String, required: true },
  percent:      { type: Number, required: true, min: 0, max: 100 }, // the discount this rule grants
  active:       { type: Boolean, default: true, index: true },
  priority:     { type: Number, default: 0 }, // tie-breaker when two rules grant the same percent (higher wins)
  // Conditions - ALL present ones must hold for the rule to apply. An omitted
  // condition is simply not checked (a rule with no conditions always applies).
  minSubtotal:  { type: Number, default: null },        // order subtotal must be ≥ this
  daysOfWeek:   { type: [Number], default: [] },         // 0=Sun..6=Sat (Manila); empty = any day
  startDate:    { type: Date, default: null },           // active-from (inclusive)
  endDate:      { type: Date, default: null },           // active-until (inclusive)
  segment:      { type: String, default: '' },           // client must carry this segment tag; '' = any
  createdBy:    { type: String, default: '' },
}, { timestamps: true });
DiscountRuleSchema.index({ businessType: 1, active: 1 });
const DiscountRule = mongoose.model('DiscountRule', DiscountRuleSchema);

// --- PRICE TIERS (customer classes: Dealer, Satellite, Wholesale, ...) ---
// The canonical registry for the free-form tags that already live in
// ClientAccount.segments and Product.segmentDiscounts[].segment. Those two
// fields are matched by EXACT string in orders.js productDiscPct, so a
// "Dealer" tag on the account and a "dealer" override on the product silently
// grant no discount at all - money quietly leaks with no error anywhere. This
// collection makes the tag list pickable in both editors so the two sides can
// never disagree.
//
// `percent` is the tier's DEFAULT rate, applied to every product the buyer
// touches. It's what makes "Dealers get 15% off" a one-line setup instead of a
// segmentDiscounts row on every single product. A per-product segment override
// still beats it (see productDiscPct), so a tier default is a floor, not a cap.
const PriceTierSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  name:     { type: String, required: true },                        // the segment tag itself, e.g. "Dealer"
  percent:  { type: Number, default: 0, min: 0, max: 100 },          // default discount for this class; 0 = tag only, no automatic rate
  // 'percent' = the flat `percent` above applies to every product (the original
  // behaviour). 'per_product' = this tier instead prices EVERY product
  // individually via `productPrices` below - for a dealer sheet that isn't a
  // clean percent off list price. `percent` is ignored in that mode.
  pricingMode: { type: String, enum: ['percent', 'per_product'], default: 'percent' },
  // Only meaningful when pricingMode === 'per_product'. One row per product
  // this tier has an explicit price for; a product with no row here has no
  // per-product rate from this tier (falls through to whatever else applies).
  productPrices: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    price:     { type: Number, required: true, min: 0 },
  }],
  note:     { type: String, default: '' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
PriceTierSchema.index({ businessType: 1, name: 1 }, { unique: true });
const PriceTier = mongoose.model('PriceTier', PriceTierSchema);

const EODRecordSchema = new mongoose.Schema({
  dateString: String, // e.g., '2026-04-29'
  status: { type: String, default: 'OPEN' }, // 'OPEN' or 'LOCKED'
  lockedAt: Date,
  lockedBy: String
});
const EODRecord = mongoose.model('EODRecord', EODRecordSchema);

// Atomic sequence counter - one document per prefix, incremented with $inc to prevent race conditions
const CounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.model('Counter', CounterSchema);

// ── PURCHASE ORDERS (procurement workflow) ───────────────────────────────────
// Two-stage tracking tool. A PO is drafted with line items pulled from inventory,
// tracked through Ordered → Processing, then reconciled against the actual
// delivery (per-line receivedQty typed in by hand) which flips it to Complete
// (everything arrived) or Incomplete (short/over). Purely a tracking record - it
// does NOT post to inventory or the ledger; restock + journal entries stay on the
// existing /api/inventory/restock flow so there's no double counting.
// Suppliers - a managed directory (CRUD) that POs can be drawn from. A PO stores
// both a supplierId link AND a supplier name snapshot, so renaming/deleting a
// supplier never rewrites the history of past POs.
const SupplierSchema = new mongoose.Schema({
  supplierCode:  { type: String, index: true },             // SUP-2026-000001
  name:          { type: String, required: true, index: true },
  contactPerson: { type: String, default: '' },
  phone:         { type: String, default: '' },
  email:         { type: String, default: '' },
  address:       { type: String, default: '' },
  notes:         { type: String, default: '' },
  isActive:      { type: Boolean, default: true },
  tenantId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  // Catalog: what this supplier says they sell + their quoted price - set by staff,
  // independent of whether a PO has ever been placed. This is what lets "who's
  // cheaper for X" be answered before ever buying, not just from purchase history.
  catalog: [{
    invId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', default: null },
    itemName:  { type: String, required: true },
    itemCode:  { type: String, default: '' },
    unit:      { type: String, default: '' },
    packSize:  { type: Number, default: null },
    unitCost:  { type: Number, required: true },
    notes:     { type: String, default: '' },
  }],
}, { timestamps: true });
const Supplier = mongoose.model('Supplier', SupplierSchema);

const PO_STATUSES = ['Ordered', 'Processing', 'Complete', 'Incomplete', 'Cancelled'];
const PurchaseOrderSchema = new mongoose.Schema({
  poNumber:     { type: String, index: true },              // PO-2026-000001
  supplier:     { type: String, default: '' },              // name snapshot at draft time
  supplierId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  status:       { type: String, default: 'Ordered', enum: PO_STATUSES, index: true },
  expectedDate: { type: Date },
  notes:        { type: String, default: '' },
  lines: [{
    invId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', default: null },
    itemName:    { type: String, default: '' },
    itemCode:    { type: String, default: '' },
    unit:        { type: String, default: '' },             // display unit captured at draft time (kg/L/pcs)
    packSize:    { type: Number, default: null },           // weight/volume per pack, in `unit` (e.g. 1 for "1L", 250 for "250g"); optional
    orderedQty:  { type: Number, default: 0 },
    unitCost:    { type: Number, default: 0 },
    expiryDate:  { type: Date, default: null },             // optional expiry for the incoming stock
    productionDate: { type: Date, default: null },          // for goods with no real expiry (beans, etc.)
    receivedQty: { type: Number, default: null },           // null until reconciled
  }],
  estTotal:     { type: Number, default: 0 },
  actualTotal:  { type: Number, default: 0 },
  receivedAt:   { type: Date, default: null },
  receivedBy:   { type: String, default: '' },
  createdBy:    { type: String, default: '' },
  tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
}, { timestamps: true });
const PurchaseOrder = mongoose.model('PurchaseOrder', PurchaseOrderSchema);

// --- AP BILL APPROVAL WORKFLOW ---
// A Bill is a payable awaiting sign-off, in one of two ways:
//   - source:'PO'     - created automatically when a PO delivery is received
//                        (purchase-orders.js's /receive route). The A/P journal
//                        entry (DR Inventory / CR 220000) posts immediately at
//                        receipt as before - that's a real liability the moment
//                        goods arrive, not something to hold open pending review.
//                        Approving a PO-sourced bill doesn't post anything new;
//                        it's the "someone checked this invoice against the PO"
//                        sign-off gate before it can be scheduled/paid.
//   - source:'Manual'  - entered directly (a utility bill, rent, anything with
//                        no PO). No JE exists yet when Pending - approval is
//                        what books the liability (DR expenseAccountCode /
//                        CR 220000), since a manual entry has no independent
//                        physical-receipt event to already justify it.
const BILL_STATUSES = ['Pending', 'Approved', 'Rejected', 'Paid'];
const BillSchema = new mongoose.Schema({
  businessType:      { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  billNumber:        { type: String, index: true },              // BILL-2026-000001
  supplierId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  supplierName:      { type: String, default: '' },               // snapshot at creation time
  source:            { type: String, enum: ['PO', 'Manual'], required: true },
  purchaseOrderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
  poNumber:          { type: String, default: '' },
  description:       { type: String, default: '' },               // required context for Manual bills
  amount:            { type: Number, required: true },
  expenseAccountCode:{ type: String, default: '' },               // Manual bills only - which account to debit on approval
  status:            { type: String, default: 'Pending', enum: BILL_STATUSES, index: true },
  dueDate:           { type: Date, default: null },                // when the supplier expects payment
  scheduledPaymentDate: { type: Date, default: null },              // when WE plan to pay it - only settable once Approved
  createdBy:         { type: String, default: '' },
  approvedBy:        { type: String, default: '' },
  approvedAt:        { type: Date, default: null },
  rejectedBy:        { type: String, default: '' },
  rejectedAt:        { type: Date, default: null },
  rejectionReason:   { type: String, default: '' },
  paidAt:            { type: Date, default: null },
  // Reference of the JournalEntry this bill is tied to: the PO-receipt entry for
  // source:'PO' bills, the approval entry for source:'Manual' bills, and
  // overwritten with the payment entry's reference once Paid.
  journalEntryRef:   { type: String, default: '' },
  // External reference for the payment - a bank transaction ID, check number,
  // GCash ref, etc. Distinct from journalEntryRef (the internal mkSeqRef code) -
  // this is what ties the record back to an actual bank statement or receipt.
  paymentReference:  { type: String, default: '' },
}, { timestamps: true });
BillSchema.index({ businessType: 1, status: 1 });
const Bill = mongoose.model('Bill', BillSchema);

// --- API ROUTES ---




// --- INVENTORY PHYSICAL COUNT & DAILY CLOSE ---


























// --- ERP ROUTES ---


























// --- SOCKET.IO ---
// ── SOCKET ROOMS ─────────────────────────────────────────────────────────────
// Clients call  socket.emit('joinRoom', role)  after login.
// Rooms: 'cashier' (staff + all roles), 'manager' (superadmin only), 'kitchen' (kitchen display)
// Helpers so server code stays clean:
const emitToOps  = (evt, data) => io.to('cashier').to('kitchen').emit(evt, data);   // operational events
const emitToAll  = (evt, data) => io.emit(evt, data);                               // menu / archive - everyone
const emitToMgr  = (evt, data) => io.to('manager').emit(evt, data);                 // ledger/ERP - superadmin only

// Verify JWT on the socket handshake. The client passes the access token via
// auth.token (preferred) or the Authorization header. Unauthenticated
// connections are still allowed for public surfaces (customer menu, QR session)
// but they don't get room membership for sensitive broadcasts.
io.use((socket, next) => {
  try {
    const raw =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization || '').replace(/^Bearer /, '') ||
      '';
    if (!raw) { socket.data.user = null; return next(); }
    const decoded = jwt.verify(raw, process.env.JWT_SECRET);
    socket.data.user = decoded;        // { _id, name, role, ... }
    return next();
  } catch (err) {
    // Invalid / expired token - treat as anonymous rather than refusing the
    // connection, so public surfaces keep working without auth.
    socket.data.user = null;
    return next();
  }
});

io.on('connection', (socket) => {
  const user = socket.data.user || null;
  const role = String(user?.role || '').toLowerCase();
  log.info({ sid: socket.id, role: role || 'anonymous' }, 'Device connected');

  // Auto-room placement based on the verified JWT. The client no longer
  // controls which rooms it joins - the server decides from the token's role.
  if (user) {
    socket.join('cashier'); // every authenticated user gets order updates
    if (role === 'superadmin' || role === 'admin') socket.join('manager');
    if (role === 'kitchen') socket.join('kitchen');
  }

  // Back-compat shim: ignore client-declared roles for room placement so an
  // attacker can't elevate by spoofing the joinRoom payload. The verified
  // handshake already placed them correctly above.
  socket.on('joinRoom', () => { /* intentionally no-op; rooms are server-decided */ });

  socket.on('updateOrderStatus', async () => { /* stub - HTTP PUT handles all mutations */ });

  socket.on('disconnect', () => {
    log.info({ sid: socket.id }, 'Device disconnected');
  });
});



// --- AUTO-CODE GENERATORS (Make sure these are defined BEFORE the routes) ---
const getCategoryPrefix = (categoryName) => {
  const clean = categoryName.toUpperCase().replace(/[^A-Z]/g, '');
  if (clean.length < 3) return (clean + 'XXX').substring(0, 3);
  return clean[0] + clean[1] + clean[clean.length - 1]; 
};

const generateNextSequence = async (_Model, prefix, _fieldName) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return `${prefix}-A${counter.seq.toString().padStart(4, '0')}`;
};

// --- MIDNIGHT AUTO-ARCHIVE SYSTEM ---
function scheduleMidnightArchive() {
  const now = new Date();
  
  // 1. Calculate precise time to Midnight in the Philippines (Asia/Manila)
  const manilaDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const manilaMidnight = new Date(manilaDate);
  manilaMidnight.setHours(24, 0, 0, 0); 
  const msToMidnight = manilaMidnight.getTime() - manilaDate.getTime();

  // 2. Set the countdown timer
  setTimeout(async () => {
    // Superadmin-controlled toggle: when autoCloseEnabled is explicitly false,
    // skip the automatic cancel/archive/lock and leave the day open for a manual
    // close. The timer still reschedules for the next midnight.
    const acSetting = await Settings.findOne({ key: 'autoCloseEnabled' }).lean();
    if (acSetting && acSetting.value === false) {
      log.info('  Midnight reached (PH Time): auto-close is DISABLED - leaving the day open for manual close.');
      scheduleMidnightArchive();
      return;
    }
    log.info('  Midnight reached (PH Time): Auto-closing the day...');

    try {
      // Step A: Force any hanging order to Cancelled - Pending/Preparing/Ready
      //         plus Parked (held unpaid tabs); clear isParked so none linger.
      await Order.updateMany(
        { status: { $in: ['Pending', 'Preparing', 'Ready', 'Parked'] }, isArchived: false },
        { $set: { status: 'Cancelled', isParked: false } }
      );

      // Step B: Sweep completed/cancelled/voided orders into the archive.
      //         Reserved and Partially Fulfilled carry over to the next day.
      await Order.updateMany(
        { isArchived: false, status: { $nin: ['Reserved', 'Partially Fulfilled'] } },
        { $set: { isArchived: true, isParked: false } }
      );
      emitToAll('ordersArchived'); // Tell all iPads/phones to clear their screens

      // Step C: Take the Midnight Inventory Snapshot
      const allItems = await Inventory.find();
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0); 
      for (const item of allItems) {
        await InventoryMovement.create({
          date: todayDate,
          inventoryId: item._id,
          itemName: item.itemName,
          systemEndingBalance: item.stockQty,
        });
      }

      // Step D: 🚨 LOCK THE REGISTER IN THE EOD RECORD 🚨
      const closedDateStr = manilaDate.toLocaleDateString('en-CA'); // YYYY-MM-DD
      await EODRecord.findOneAndUpdate(
        { dateString: closedDateStr },
        { status: 'LOCKED', lockedAt: new Date(), lockedBy: 'SYSTEM AUTO-CLOSE' },
        { upsert: true, returnDocument: 'after' }
      );

      log.info(`  Register locked automatically for ${closedDateStr}`);
      emitToMgr('erpUpdated'); // Refreshes the Admin UI to show "EOD Locked"

      // Step E: Telegram daily summary webhook (set TELEGRAM_WEBHOOK_URL in .env)
      if (process.env.TELEGRAM_WEBHOOK_URL) {
        try {
          const todayStart = new Date(closedDateStr + 'T00:00:00.000');
          const todayOrds  = await Order.find({ isArchived: true, createdAt: { $gte: todayStart } }).lean();
          const completed  = todayOrds.filter(o => o.status === 'Completed' && !o.isComplimentary);
          const revenue    = completed.reduce((s, o) => s + (o.total || 0), 0);
          const cashSales  = completed.filter(o => o.paymentMethod === 'Cash').reduce((s, o) => s + (o.total || 0), 0);
          const voids      = todayOrds.filter(o => o.status === 'Voided').length;
          const prodCount  = {};
          completed.forEach(o => (o.items || []).forEach(i => { const n = (i.name || '').replace(/\s*\(.*?\)\s*/g, '').trim(); prodCount[n] = (prodCount[n] || 0) + i.quantity; }));
          const topProd    = Object.entries(prodCount).sort(([, a], [, b]) => b - a)[0];
          const msg = [
            `📊 *${closedDateStr} Daily Summary*`,
            `💰 Revenue: ₱${revenue.toFixed(2)}`,
            `📦 Orders: ${completed.length} completed${voids > 0 ? `, ${voids} voided` : ''}`,
            `💵 Cash: ₱${cashSales.toFixed(2)} | Non-Cash: ₱${(revenue - cashSales).toFixed(2)}`,
            topProd ? `🏆 Top item: ${topProd[0]} (${topProd[1]}x)` : '',
          ].filter(Boolean).join('\n');
          await fetch(process.env.TELEGRAM_WEBHOOK_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: msg, parse_mode: 'Markdown' })
          });
          log.info('Telegram daily summary sent');
        } catch (tErr) { log.warn({ err: tErr }, 'Telegram webhook failed (non-fatal)'); }
      }

    } catch (error) {
      log.error({ err: error }, 'Auto-Archive Error');
    }

    // 3. Schedule it again for tomorrow!
    scheduleMidnightArchive();
  }, msToMidnight);
}

// --- 🛡️ STRICT ORDER VALIDATION ENGINE (VAT-INCLUSIVE) 🛡️ ---
// ---   STRICT ORDER VALIDATION ENGINE (VAT-EXCLUSIVE)   ---
const validateOrderMath = (order) => {
  const TOLERANCE = 0.05;

  if (order.subtotal === undefined || order.total === undefined || order.vatAmount === undefined) {
    return { valid: false, error: "Missing critical financial fields (Subtotal, Total, or VAT)." };
  }

  let expectedGross = 0;
  let baseAfterLineDisc = 0;
  let discountableBase = 0;
  let exemptBase = 0;

  for (const item of order.items) {
    if (item.price === undefined || item.quantity === undefined) return { valid: false, error: "Line item missing price or quantity." };

    const addOnTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + Number(a.price || 0), 0);
    const itemBase = (item.price + addOnTotal) * item.quantity;
    expectedGross += itemBase;

    // Same MAX rule as the totals recalc - server-resolved per-product/per-client
    // discount and the cashier per-item override coexist; take the higher.
    const prodPct = Number(item.productDiscountPercent || 0);
    const cashierPct = Number(item.discountPercent || 0);
    const linePct = Math.max(prodPct, cashierPct);
    const lineDisc = +(itemBase * linePct / 100).toFixed(2);
    baseAfterLineDisc += itemBase - lineDisc;
    if (linePct === 0 && item.hasDiscount !== false) discountableBase += itemBase;
    if (item.vatExempt === true) exemptBase += itemBase - lineDisc;
  }

  // Re-derive through the SAME function the create path used, rather than
  // restating the rules here. The previous duplicate drifted out of step with
  // the real calculation, which is exactly how a validator starts rejecting
  // correct orders. The order carries its own rate and basis, so a historical
  // receipt still validates after the settings change.
  const expected = order.isComplimentary
    ? { total: 0, vatAmount: 0, discount: +baseAfterLineDisc.toFixed(2) }
    : computeOrderVat({
        grossInclusive: baseAfterLineDisc,
        discountableGross: discountableBase,
        exemptGross: exemptBase,
        discountPercent: Number(order.discountPercent || 0),
        flatDiscount: 0,
        vatEnabled: Number(order.vatRate || 0) > 0,
        vatRate: Number(order.vatRate || 0),
        isVatExempt: !!order.isVatExempt,
        scPwdOrder: order.scPwdOrder === 'discount-first' ? 'discount-first' : 'vat-first',
        vatInclusive: order.isVatInclusive !== false,
      });

  if (Math.abs(expectedGross - order.subtotal) > TOLERANCE) return { valid: false, error: `Gross mismatch. Expected P${expectedGross.toFixed(2)}, got P${order.subtotal}` };
  if (Math.abs(expected.vatAmount - order.vatAmount) > TOLERANCE) return { valid: false, error: `VAT invalid. Expected P${expected.vatAmount.toFixed(2)}, got P${order.vatAmount}` };
  if (Math.abs(expected.total - order.total) > TOLERANCE) return { valid: false, error: `Total invalid. Expected P${expected.total.toFixed(2)}, got P${order.total}` };

  return { valid: true };
};
// Start the timer when the server boots up
scheduleMidnightArchive();

// --- SHIFT MANAGEMENT ROUTES ---






// ── CHART OF ACCOUNTS (canonical + custom child accounts) ─────────────────────
// Debit-normal classes: assets (1), cost-of-sales / expenses (5,6,7,9). The rest
// (liabilities 2, equity 3, revenue 4, other income 8) are credit-normal.
const normalBalanceForCode = (code) => (/^[15679]/.test(String(code)) ? 'Debit' : 'Credit');



















// --- USER / ADMIN ROUTES ---
















// Expand an order line into per-product report lines.
//  • Non-combo: one line for the matched product (size-aware recipe + add-on revenue).
//  • Combo: one line per component - the bundle price is allocated across components
//    by their standalone selling price, and COGS comes from each component's recipe.
// Keeps combo sales visible in product/category analytics.
function reportLinesForItem(item, prods, prodMap, invMap) {
  const recipeCost = (recipe) => (recipe || []).reduce((s, ing) => {
    const iv = invMap[ing.invId]; return s + (iv ? (ing.qty || 0) * (iv.unitCost || 0) : 0);
  }, 0);
  // COGS for one unit: recipe cost if the product has a BOM, else the LOG 1:1
  // fallback - the product IS a stocked good (matched by code/name), so one unit
  // costs unitCost × unitMultiplier. invMap is keyed by _id AND itemCode/itemName.
  const lineCost = (recipe, product) => {
    if ((recipe || []).some(r => r.invId)) return recipeCost(recipe);
    const inv = product && (invMap[product.productCode] || invMap[product.name]);
    return inv ? (inv.unitCost || 0) * baseUnitsPerSale(product, inv) : 0;
  };
  const qty = item.quantity || 0;

  if (item.isCombo && (item.comboItems || []).length) {
    const comps = item.comboItems.map(c => {
      const p = prodMap[c.productId] || prods.find(pr => pr.name === c.name);
      let stand = p?.basePrice || 0;
      let recipe = p?.baseRecipe || [];
      if (c.sizeName && p?.sizes) { const sz = p.sizes.find(s => s.name === c.sizeName); if (sz) { stand = sz.price || stand; if (sz.recipe?.length) recipe = sz.recipe; } }
      return { product: p, name: c.name, cqty: (c.quantity || 1), stand, recipe };
    });
    const weightTotal = comps.reduce((s, c) => s + c.stand * c.cqty, 0);
    const comboRevenue = (item.price || 0) * qty;
    return comps.map(c => {
      const share = weightTotal > 0 ? (c.stand * c.cqty) / weightTotal : 1 / comps.length;
      return {
        name: c.name || 'Unknown', category: c.product?.category || 'Uncategorized',
        qty: c.cqty * qty, revenue: comboRevenue * share, cogs: lineCost(c.recipe, c.product) * c.cqty * qty,
      };
    });
  }

  const base = (item.name || '').replace(/\s*\(.*?\)\s*/g, '').trim();
  const prod = prodMap[item.productId] || prods.find(p => p.name === base);
  const aoT = (item.selectedAddOns || []).reduce((s, a) => s + Number(a.price || 0), 0);
  let recipe = prod?.baseRecipe || [];
  const sm = (item.name || '').match(/\(([^)]+)\)$/);
  if (sm && prod?.sizes) { const sz = prod.sizes.find(s => s.name === sm[1]); if (sz?.recipe?.length) recipe = sz.recipe; }
  return [{
    name: base || 'Unknown', category: prod?.category || 'Uncategorized',
    qty, revenue: ((item.price || 0) + aoT) * qty, cogs: lineCost(recipe, prod) * qty,
  }];
}







// ── REPORT: SALES SUMMARY BY CHANNEL (Cash / E-Wallet / Bank / Delivery) ──────
// Per-order rows (client can roll up to per-day). Splits each order's payment(s)
// into the four channels, keeping the per-method detail (GCash/Maya/Grab/...).
const paymentChannel = (method) => {
  // A check, once collected, is physically handled the same way cash is -
  // it goes in the drawer/bag with the cash, not into a wallet balance. It
  // books to its own COA account (115000 Checks on Hand, see chartOfAccounts.js)
  // so the ledger keeps it distinct from real cash, but this report is about
  // how the money moved through the till, so it groups with Cash, not E-Wallet.
  if (!method || method === 'Cash' || method === 'Check') return 'cash';
  if (method === 'Bank Transfer') return 'bank';
  if (['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(method)) return 'delivery';
  return 'ewallet'; // GCash, Maya, Maribank, E-Wallet, Other E-Wallet, etc.
};



// ── STAFF CLOCK-IN / CLOCK-OUT ────────────────────────────────────────────────
// Parse an optional client-supplied timestamp for offline clock events. Only
// accepts a valid date within the last 24h and not in the future; otherwise null
// (caller falls back to server "now"). Prevents backdating abuse.
const parseClockAt = (raw) => {
  if (!raw) return null;
  const t = new Date(raw);
  if (isNaN(t.getTime())) return null;
  const now = Date.now();
  if (t.getTime() > now + 60000) return null;            // not in the future
  if (t.getTime() < now - 24 * 60 * 60 * 1000) return null; // not older than 24h
  return t;
};

// Total break minutes already completed in this shift (excludes an in-progress break).
const completedBreakMinutes = (entry) =>
  (entry.breaks || []).reduce((s, b) => s + (b.end ? (b.minutes || 0) : 0), 0);
const openBreak = (entry) => (entry.breaks || []).find(b => b.start && !b.end);
const BREAK_CAP_MIN = 60; // staff get up to 1 hour of break per shift





// ── REVOLVING FUND SCHEMAS ────────────────────────────────────────────────────
const RevolvingFundSchema = new mongoose.Schema({
  name:           { type: String, required: true },   // e.g. "Kasa Lokal Petty Cash"
  initialAmount:  { type: Number, required: true },   // the fixed float amount
  currentBalance: { type: Number, required: true },   // live running balance
  description:    { type: String, default: '' },      // purpose / notes
  isActive:       { type: Boolean, default: true },
  createdBy:      { type: String },
}, { timestamps: true });

const RevolvingFund = mongoose.model('RevolvingFund', RevolvingFundSchema);

const RevolvingFundTxSchema = new mongoose.Schema({
  fundId:      { type: mongoose.Schema.Types.ObjectId, ref: 'RevolvingFund', required: true, index: true },
  type:        { type: String, enum: ['disbursement', 'replenishment', 'adjustment'], required: true },
  amount:      { type: Number, required: true },       // always positive
  description: { type: String, required: true },
  categoryCode:{ type: String, default: '760000' },      // expense account for disbursements
  performedBy: { type: String },
  date:        { type: Date, default: Date.now },
  balanceAfter:{ type: Number },                       // snapshot of fund balance after this tx
  journalRef:  { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
}, { timestamps: true });

const RevolvingFundTx = mongoose.model('RevolvingFundTx', RevolvingFundTxSchema);

// ── REQUISITION SLIPS ─────────────────────────────────────────────────────────
// A gate in front of two kinds of money/stock movement that used to happen
// immediately: a petty-cash disbursement and a new purchase order. Staff files
// a slip (Pending); only once someone with accounting.manage approves it does
// the actual movement happen (fund balance drops / a real PurchaseOrder is
// created) - mirrors the existing Bill approve/reject shape (BillSchema above)
// so the pattern stays consistent across the app. `preparedBy` is the
// requester's name for the printed slip's "Prepared By" line; `approvedBy` -
// once set - is the "Approved By" line beneath it.
const REQ_SLIP_STATUSES = ['Pending', 'Approved', 'Rejected'];
const RequisitionSlipSchema = new mongoose.Schema({
  businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  slipNumber: { type: String, index: true },              // REQ-2026-000001
  // 'new-fund' establishes a brand-new RevolvingFund - staff-initiated fund
  // creation used to be immediate (no approval), same gap this whole slip
  // system closed for disbursements. Reuses the same petty-cash-shaped
  // fields below: fundName/amount/description as the fund's name/opening
  // amount/note, categoryCode as the funding source account (mirrors how
  // POST /api/revolving-funds itself takes a sourceAccount).
  type: { type: String, enum: ['petty-cash', 'procurement', 'new-fund'], required: true, index: true },
  status: { type: String, default: 'Pending', enum: REQ_SLIP_STATUSES, index: true },

  // petty-cash / new-fund fields
  fundId: { type: mongoose.Schema.Types.ObjectId, ref: 'RevolvingFund', default: null },
  fundName: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  description: { type: String, default: '' },
  categoryCode: { type: String, default: '' },

  // procurement fields
  supplier: { type: String, default: '' },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  expectedDate: { type: Date, default: null },
  lines: [{
    invId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', default: null },
    itemName: { type: String, default: '' },
    itemCode: { type: String, default: '' },
    unit: { type: String, default: '' },
    packSize: { type: Number, default: null },
    orderedQty: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
    expiryDate: { type: Date, default: null },
    productionDate: { type: Date, default: null },
    // Carried through unchanged to the PurchaseOrder line on approval - only
    // meaningful for a brand-new item (no invId), where receiving needs to
    // know how to create the Inventory doc it becomes.
    expiryWarnDays: { type: Number, default: null },
    lowStockThreshold: { type: Number, default: null },
    stockLocation: { type: String, default: null },
    stockCategory: { type: String, default: null },
    creditAccount: { type: String, default: null },
  }],
  estTotal: { type: Number, default: 0 },

  notes: { type: String, default: '' },
  preparedBy: { type: String, default: '' },               // requester's name - the slip's "Prepared By" line
  approvedBy: { type: String, default: '' },                // the slip's "Approved By" line, once set
  approvedAt: { type: Date, default: null },
  rejectedBy: { type: String, default: '' },
  rejectedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: '' },
  // What approval actually created - a RevolvingFundTx id or a PurchaseOrder
  // id/number, so the slip links straight through to the real record.
  resultRefId: { type: String, default: '' },
  resultRefLabel: { type: String, default: '' },
}, { timestamps: true });
RequisitionSlipSchema.index({ businessType: 1, status: 1, createdAt: -1 });
const RequisitionSlip = mongoose.model('RequisitionSlip', RequisitionSlipSchema);

// ── REVOLVING FUND ROUTES ─────────────────────────────────────────────────────








// --- 404 FALLBACK (unmatched routes) ---

// --- FEATURE ROUTE MODULES ---------------------------------------------------
// Routes were moved verbatim into ./features/*. They close over nothing: every
// model/helper/middleware they use is passed via this ctx object. Registration
// order preserves the original in-file route order per feature.
const ctx = {
  app,
  io,
  server,
  express,
  http,
  Server,
  cors,
  helmet,
  cookieParser,
  Sentry,
  z,
  mongoose,
  bcrypt,
  jwt,
  compression,
  rateLimit,
  crypto,
  pino,
  pinoHttp,
  assertBalanced,
  debitAccountFor,
  suggestedSettleAccount,
  ACCOUNTS,
  EXPENSE_CATEGORIES,
  CODE_MAP,
  resolveUnit,
  displayToBase,
  effectiveDisplay,
  addBatch,
  consumeBatches,
  consumeSpecificBatch,
  soonestExpiry,
  sortBatchesFEFO,
  batchesTotal,
  requireStaff,
  evaluateClientAccess,
  computePercentageTax,
  PERCENTAGE_TAX_RATE,
  computeOrderVat,
  extractVat,
  normaliseVatRate,
  DEFAULT_VAT_RATE,
  validateDateRange,
  log,
  SENTRY_ON,
  IS_PROD,
  BUSINESS_TYPE,
  WALK_IN_CUSTOMER_CODE,
  ENV_ORIGINS,
  allowedOrigins,
  corsOriginCheck,
  mkRef,
  resolveLinkedInventory,
  UNIT_TO_BASE,
  unitTypeOf,
  baseUnitsPerSale,
  escapeRegex,
  tenantScope,
  BCRYPT_ROUNDS,
  shiftCashFilter,
  ACCESS_TTL,
  REFRESH_TTL_MS,
  REFRESH_COOKIE,
  signAccessToken,
  hashToken,
  refreshCookieOptions,
  requireTrustedOrigin,
  issueSession,
  revokeUserSessions,
  validate,
  zName,
  zMoney,
  zRole,
  loginSchema,
  userCreateSchema,
  addonSchema,
  zRecipe,
  productSchema,
  comboSchema,
  discountSchema,
  roleSchema,
  modifierGroupSchema,
  mkSeqRef,
  loginLimiter,
  orderLimiter,
  generalApiLimiter,
  runStartupTasks,
  CategorySchema,
  Category,
  ModifierGroupSchema,
  ModifierGroup,
  SettingsSchema,
  Settings,
  TenantSchema,
  Tenant,
  tenantSchema,
  AddOnSchema,
  AddOn,
  ProductSchema,
  Product,
  ComboSchema,
  Combo,
  SaleSchema,
  Sale,
  OrderSchema,
  Order,
  QRSessionSchema,
  QRSession,
  InventorySchema,
  Inventory,
  StorageLocationSchema,
  StorageLocation,
  StockCategorySchema,
  StockCategory,
  PriceTierSchema,
  PriceTier,
  StockTransferSchema,
  StockTransfer,
  STOCK_TRANSFER_STATUSES,
  BackdateQueueItemSchema,
  BackdateQueueItem,
  LinkedBusinessSchema, LinkedBusiness,
  HubInviteSchema, HubInvite,
  CrossTransferSchema, CrossTransfer,
  TRANSFER_REQUEST_STATUSES,
  TransferRequestSchema,
  TransferRequest,
  JournalEntrySchema,
  JournalEntry,
  TenantStatsSchema,
  TenantStats,
  STATS_SHARDS,
  ProductStatsSchema,
  ProductStats,
  InventoryMovementSchema,
  InventoryMovement,
  StockCardSchema,
  StockCard,
  ShiftSchema,
  Shift,
  ClockEntrySchema,
  ClockEntry,
  ScheduledShiftSchema,
  ScheduledShift,
  SCHEDULED_SHIFT_STATUSES,
  ownerUserIds,
  ownerIdentity,
  ChangeRequestSchema,
  ChangeRequest,
  CHANGE_REQUEST_STATUSES,
  logAudit,
  PaymentMethodMapSchema,
  PaymentMethodMap,
  DEFAULT_PAYMENT_ACCOUNT_MAP,
  refreshPaymentMap,
  accountForPaymentMethod,
  ClosedPeriodSchema,
  ClosedPeriod,
  periodLockFor,
  AccountSchema,
  Account,
  BankDepositSchema,
  BankDeposit,
  DEFAULT_ACCOUNTS,
  CUSTOM_META,
  refreshCustomMeta,
  acctMeta,
  UserSchema,
  User,
  ClientAccountSchema,
  ClientAccount,
  CollectionReminderSchema,
  CollectionReminder,
  RefreshSessionSchema,
  RefreshSession,
  RoleSchema,
  Role,
  AuditLogSchema,
  AuditLog,
  DiscountSchema,
  Discount,
  DiscountRuleSchema,
  DiscountRule,
  EODRecordSchema,
  EODRecord,
  CounterSchema,
  Counter,
  SupplierSchema,
  Supplier,
  PurchaseOrderSchema,
  PurchaseOrder,
  PO_STATUSES,
  BillSchema,
  Bill,
  BILL_STATUSES,
  emitToOps,
  emitToAll,
  emitToMgr,
  getCategoryPrefix,
  generateNextSequence,
  scheduleMidnightArchive,
  validateOrderMath,
  normalBalanceForCode,
  reportLinesForItem,
  paymentChannel,
  parseClockAt,
  completedBreakMinutes,
  openBreak,
  BREAK_CAP_MIN,
  RevolvingFundSchema,
  RevolvingFund,
  RevolvingFundTxSchema,
  RevolvingFundTx,
  RequisitionSlipSchema,
  RequisitionSlip,
  REQ_SLIP_STATUSES,
  verifyToken,
  verifyClientToken,
  requireSuperAdmin,
  requireSuperOrAdmin,
  verifyOrderAuth,
  requirePermission,
  resolvePermissions,
  hasPermission,
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_DEFAULT_PERMISSIONS,
  refreshCustomRolePerms,
  // live getter: refreshPaymentMap() reassigns this module-level variable
  get PAYMENT_MAP_CACHE() { return PAYMENT_MAP_CACHE; },
};
registerTenants(ctx);
registerAddons(ctx);
registerUsers(ctx);
registerClientPortal(ctx);
registerPricing(ctx);
registerInventory(ctx);
registerProducts(ctx);
registerQrSessions(ctx);
registerOrders(ctx);
registerFinance(ctx);
registerReports(ctx);
registerShifts(ctx);
registerScheduling(ctx);
registerDiscountRules(ctx);
registerPriceTiers(ctx);
registerAdminTools(ctx);
registerAudit(ctx);
registerSettings(ctx);
registerPurchaseOrders(ctx);
registerBills(ctx);
registerRequisitions(ctx);
registerCollections(ctx);
registerChangeRequests(ctx);
registerNotifications(ctx);
registerClients(ctx);
registerHub(ctx);

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found.' });
});

// --- CENTRALIZED ERROR HANDLER ---
// Catches synchronous throws, CORS rejections, and anything passed to next(err).
// In production it never leaks stack traces, query strings, or internal messages.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (/^CORS blocked/.test(err.message || '') ? 403 : 500);
  log.error({ err, url: req.url, method: req.method }, 'Unhandled request error');
  if (SENTRY_ON && status >= 500) Sentry.captureException(err);
  res.status(status).json({
    success: false,
    error: IS_PROD ? 'An unexpected error occurred.' : (err.message || 'Internal error'),
  });
});

// --- SERVER START ---
// Under test (supertest) the app is imported and driven in-process - we must NOT bind
// a port or register process-killing signal handlers that would interfere with vitest.
const IS_TEST = process.env.NODE_ENV === 'test';
const PORT = process.env.PORT || 5002;
if (!IS_TEST) {
  server.listen(PORT, () => {
    log.info({ port: PORT }, 'API server running');
  });
}
// Exported for in-process integration tests (supertest + socket.io-client). Importing
// the module still connects to MONGO_URI; tests point that at an in-memory MongoDB.
// `server` (the http.Server) is exported so socket tests can listen on an ephemeral port.
export { app, server, runStartupTasks };

const shutdown = async (signal, exitCode = 0) => {
  log.info({ signal }, 'Shutting down gracefully');
  server.close(async () => {
    await mongoose.connection.close();
    log.info('MongoDB connection closed. Server stopped.');
    process.exit(exitCode);
  });
  setTimeout(() => { log.error('Forced shutdown after timeout'); process.exit(1); }, 10000);
};
if (!IS_TEST) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
// A process that has hit an uncaught exception is in an undefined state - log,
// drain in-flight traffic via the normal shutdown path, then let the supervisor
// (Railway / pm2 / Docker restart policy) start a fresh, clean process.
const fatalExit = (kind) => (err) => {
  log.fatal({ err }, kind);
  if (SENTRY_ON) { try { Sentry.captureException(err); } catch { /* never block exit */ } }
  // Best-effort graceful drain; force-exit guard inside shutdown() caps the wait.
  try { shutdown(kind, 1); } catch { process.exit(1); }
};
if (!IS_TEST) {
  process.on('uncaughtException', fatalExit('uncaughtException'));
  process.on('unhandledRejection', fatalExit('unhandledRejection'));
}
