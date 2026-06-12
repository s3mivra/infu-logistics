# Semivra Libellus POS — Complete Audit & Project Overview
_Generated 2026-06-05 · Principal AppSec + QA / Systems Architecture review_

---

## 1. What this product is

**Semivra Libellus** is a full-stack, offline-capable **Point-of-Sale + back-office ERP** built for F&B (cafés / restaurants), initially deployed for the "Kasa Lokal" brand in Angeles City, Pampanga, PH, and architected for **white-label resale** to other F&B clients.

It is **not** just a cash register. It bundles POS, inventory, double-entry accounting, BIR-aware Philippine tax handling, QR self-ordering, and shift/cash-drawer management into a single tablet-first app.

| | |
|---|---|
| **Frontend** | React 18 · Vite 5 · Tailwind CSS v3 · lucide-react · socket.io-client · PWA (service worker, installable, offline order queue) |
| **Backend** | Node/Express 4 · MongoDB (Mongoose 9) · Socket.io · JWT auth · pino structured logging |
| **Deploy** | Backend on Railway, frontend on Vercel; Docker + docker-compose + nginx provided for self-host |
| **Scale target** | Single-tenant per deployment; tablet hardware (e.g. Amazon Fire, 12GB RAM) |

---

## 2. Complete feature inventory (capabilities)

### Point of Sale
- Real-time POS register with search, large (≥44px) tablet touch targets, inline ₱/% discounts
- Payment checkout modal: thermal receipt preview, payment-method pills, quick-cash denomination buttons (₱20–₱1000), exact/round shortcuts, live change calc
- Fulfilment modes: **Dine-In, Takeout, Pickup, Manual Delivery, Grab, Foodpanda**
- Park/recall orders; complimentary orders; voids (superadmin-gated)
- Order lifecycle: Preparing → Ready → Delivered/Picked-Up, plus **Partial Delivery** state
- Dispatch pipeline tracker for delivery/pickup orders
- Double-tap/duplicate-order protection; atomic order-number sequencing

### QR self-ordering (customer-facing)
- `CustomerMenu.jsx` — QR-code table ordering, cryptographically-random session IDs, time-boxed sessions, single-use ("burned") on order
- Web-push "order ready" notification path

### Inventory & stock
- Recipe-based ingredient deduction (base + add-on recipes) on order completion — **atomic** (`findOneAndUpdate $inc`), race-safe
- Multi-batch **FEFO** expiry tracking (`expiryBatches`), soonest-expiry badges, expiry watch panel
- Low-stock thresholds + alert badges; waste/spoilage logging with enforced reason
- Excel/CSV bulk import & stock-take (SheetJS) with diff-preview modal, journal-backed adjustments
- Restock, manual batch add/remove, EOD physical-count reconciliation in display units (kg/L/pcs)
- Unit system: storage in base units (g/ml/pcs) for recipe precision; display always kg/L/pcs

### Accounting / ERP (double-entry)
- Canonical chart of accounts (Assets 1xxx … OpEx 6xxx) in `server/lib/chartOfAccounts.js`
- Every sale/void/spoilage/expense posts a **balanced** journal entry (assertion throws if DR≠CR)
- Non-VAT-registered Philippine compliance (3% percentage-tax model; gross-receipts formula)
- A/R policy: only physical cash hits Cash-on-Hand; all e-wallet/bank/delivery channels book to Accounts Receivable until settled
- Reports: **P&L**, **Balance Sheet**, **A/R Outstanding**, Journal, CSV export — MongoDB aggregation pipelines (OOM-safe)
- Expense entry (with On-Account/AP support), revolving/petty-cash fund with replenishment ledger

### Shifts & cash control
- Mandatory starting-cash on login; End-of-Shift reconciliation modal (expected vs actual, variance)
- Shift history archive; X-Reading (mid-shift PDF summary without closing register)

### Platform / ops
- RBAC: `superadmin` role gate (role-only, no legacy name-string bypass) on all sensitive routes
- Real-time multi-device sync via Socket.io
- PWA offline order queue (`client/src/lib/pwa.js`, `usePwa.js`)
- Graceful shutdown (SIGTERM/SIGINT drain), `/health` endpoint, structured JSON logs
- Day-1 ops kit: `scripts/setup-env.sh`, `backup-mongo.sh`, `restore-mongo.sh`, `Makefile`, `DEPLOY.md` runbook, GitHub Actions CI, Docker
- Test suite: **75 vitest** tests over ledger / units / expiry / chart-of-accounts pure logic

---

## 3. Security posture — hardened THIS review (2026-06-05)

| Area | Fix shipped | Verified |
|---|---|---|
| Edge | `app.disable('x-powered-by')` + `trust proxy: 1` (correct rate-limit IP keying behind Railway) | ✅ |
| Headers | **Helmet** wired — HSTS preload, nosniff, frameguard, referrer policy; CORP cross-origin | ✅ |
| Injection | `escapeRegex()` — fixed **ReDoS / regex-injection** on `POST /api/inventory` + `POST /api/users` (raw user input was going into `new RegExp()`) | ✅ |
| Passwords | bcrypt cost **10 → 12** (OWASP 2025 min), all 5 hash sites | ✅ |
| Errors | Centralized error handler + 404 fallback; prod hides `err.message`/stack | ✅ |
| BOPLA/validation | **Zod `validate()`** middleware (strips unknown keys = mass-assignment defense + 422 field errors) on login, user-create, addon-create | ✅ |
| Deps (server) | `npm audit fix` → **0 vulnerabilities** | ✅ |
| Deps (client) | `xlsx` HIGH (proto-pollution + ReDoS) → swapped abandoned npm pkg for **patched SheetJS 0.20.3** CDN build; client build clean | ✅ |

Already-strong from prior passes: JWT secret enforced (no fallback), env fail-fast, rate-limiting (login 10/15min, orders 60/min), atomic inventory deduction, balanced-journal assertions, superadmin RBAC, completed-order immutability, A/R void guards, crypto-random QR sessions.

---

## 4. Open vulnerabilities & weaknesses (prioritized)

### 🔴 P1 — Token architecture (not yet done; **breaking**)
- Single JWT, **12h expiry, stored in `localStorage`** → XSS-exfiltratable, no refresh rotation, **no server-side revocation/blacklist**. Logout is client-side only; a stolen token is valid until expiry.
- Target: 15-min access JWT + httpOnly/Secure/SameSite=Strict refresh cookie + revocation store. Requires coordinated client+server change and a deploy window (logs everyone out).

### 🟠 P2
- **Mass-assignment** on remaining `Model.create(req.body)` routes (product, inventory, discount, role, combo, modifier-group). Mongoose strict mode drops unknown keys so real risk is low, but explicit Zod allowlists + type validation should be extended for defense-in-depth and consistent 422s.
- **No CSRF protection** — currently fine because auth is a Bearer header (not a cookie). Becomes mandatory the moment the refresh-cookie rewrite lands.
- **`uncaughtException` handler logs but keeps running** — process may continue in a corrupt state; consider controlled exit + supervisor restart.
- **Client dev-server vuln** (esbuild/vite ≤6.4.1, moderate) — dev-only, not in production bundle; fix requires breaking `vite@8`. Schedule, don't rush.

### 🟡 P3
- **`AdminDashboard.jsx` is 4,661 lines** — maintainability/perf risk; tab extraction started (`components/tabs/`) but the monolith remains. High-risk to split; defer with care.
- Analytics computed entirely client-side (acceptable at current scale).
- No Socket.io rooms — all clients receive all events (acceptable single-tenant; **must** fix before multi-tenant).
- No automated client/E2E tests (only server-side vitest).

---

## 5. Strengths

1. **Accounting is real.** Genuine double-entry with balanced-journal assertions and an A/R settlement model — most SMB POS products fake this or bolt on a spreadsheet export.
2. **Race-safe money & stock.** Atomic `$inc` inventory deduction and atomic order-number sequencing — no oversell, no duplicate order numbers under concurrency.
3. **PH-tax native.** Non-VAT percentage-tax model, BIR-style sequential references, gross-receipts math built in — not a US-centric tool retrofitted.
4. **Offline-first PWA.** Order queue survives connectivity loss — critical for PH retail.
5. **Inventory depth.** FEFO multi-batch expiry + recipe costing + Excel stock-take is closer to a mid-market ERP than a café register.
6. **Operationally turnkey.** Backup/restore scripts, deploy runbook, CI, Docker, health checks — production hygiene most indie POS lack.
7. **Hardened.** Post-this-review: Helmet, Zod, bcrypt-12, regex-injection closed, 0 known dep vulns server-side.

---

## 6. Uniqueness & competitive weapons

| Competitor | Their gap | Semivra's weapon |
|---|---|---|
| **Square / Toast** | US-tax-centric, expensive, online-dependent, per-transaction fees | PH Non-VAT/BIR native, flat self-host cost, **offline-first**, no per-txn cut |
| **Loyverse** | Free POS but **inventory + accounting are shallow / paywalled**, no true double-entry | Built-in **double-entry GL + P&L + Balance Sheet**, FEFO batch expiry |
| **StoreHub / SariPOS (SEA)** | SaaS lock-in, limited recipe costing, monthly fees | **White-label, self-hostable**, deep recipe-level COGS, full ledger export |
| **Spreadsheet + generic POS** | Manual reconciliation, error-prone | Auto-journaling, EOD cash reconciliation, audit trail (StockCard) |

**Sharpest differentiators to lead with:**
- "**A POS that closes its own books**" — every sale, void, and spoilage is already a balanced journal entry; export-ready P&L and Balance Sheet, no bookkeeper re-keying.
- "**BIR-aware, Non-VAT ready out of the box**" — purpose-built for PH micro/small F&B.
- "**Offline never loses a sale**" — PWA queue + atomic sync.
- "**Ingredient-true costing**" — recipe + FEFO batch expiry gives real COGS and waste visibility, not guess margins.

**Honest competitive weaknesses:** single-tenant only (no multi-branch/franchise rollup yet); no native hardware-printer/cash-drawer certification matrix; no loyalty/CRM/marketing module; one giant frontend file raises the cost of fast iteration; no mobile-app-store presence (PWA only).

---

## 7. Recommendations (roadmap)

**Security (next)**
1. Refresh-token rewrite (15-min JWT + httpOnly refresh cookie + Mongo/Redis revocation) — **schedule a window**; add CSRF tokens at the same time.
2. Extend Zod `validate()` to all write routes; add a shared response shape.
3. Convert `uncaughtException` to log-then-exit under a process supervisor.

**Product / competitive moat**
4. **Multi-branch / franchise rollup** (Socket.io rooms + tenant scoping) — unlocks the biggest market segment and is the natural upsell.
5. **Loyalty / customer CRM** module — closes the gap vs Square/Loyverse, drives repeat revenue.
6. Hardware certification matrix (ESC/POS printer, cash drawer, barcode) + graceful peripheral fault isolation tests.
7. Split `AdminDashboard.jsx` behind tests; add Playwright E2E for checkout, void, EOD.

**Ops**
8. Schedule the `vite@8` upgrade (clears the dev-server advisory).
9. Add client-side dependency in CI audit gate.

---

## 8. Verification status of this review
- `server: node --check` ✅ · `server: vitest` **75/75** ✅ · `server: npm audit` **0 vulns** ✅
- `client: npm run build` ✅ · `client xlsx` → patched 0.20.3 ✅ · remaining client audit: 2 moderate **dev-only** (vite/esbuild)
- All changes are in the working tree, **uncommitted**.
