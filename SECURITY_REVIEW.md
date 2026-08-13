# Security Review — Pre-Launch Spec Part 3

**Scope actually covered:** static code review of the staff app, client portal,
and control plane (`platform/control-plane/server.js`), against the manual
test cases in the pre-launch spec. **Not covered here** (need a deployed
target, which this review had no access to): the live OWASP ZAP baseline
scan, and the control-plane external-reachability/firewall check — both are
listed as follow-ups below and belong in Part 4's deploy checklist, where
they can actually be exercised against the real box.

Each finding is graded CONFIRMED (a concrete request that produces the bad
outcome, verified by reading the exact code path) or PLAUSIBLE (a real gap,
but exploitability wasn't traced end-to-end). Ranked most-severe first.

**Findings #1-#5 were fixed as part of this pass** (small, contained diffs —
each remediation below matches what actually shipped) and re-verified against
the full test suite (634/634 passing). #6-#8 are documented but not
implemented — #6 is a larger, deliberately-scoped-out Zod rollout; #7-#8 need
a decision or a deployed target, not a code change.

---

## Findings

### 1. NoSQL operator injection → authorization-scope bypass — `GET /api/bank-deposits`
**Severity:** High · **OWASP:** A03:2021 Injection · **Status:** CONFIRMED, FIXED
**File:** [server/features/finance.js:772](server/features/finance.js:772)

```js
const filter = req.query.shiftId ? { shiftId: req.query.shiftId } : {};
const deposits = await BankDeposit.find(filter).sort({ createdAt: -1 });
```
`BankDeposit.shiftId` is an untyped-at-cast `ObjectId` field, and Express's
default `extended: true` query parsing (`server/server.js:167`) turns
`?shiftId[$exists]=true` into `{ shiftId: { $exists: 'true' } }` before it
ever reaches Mongoose. That object is truthy, so it passes the ternary and
executes — returning every bank deposit across all shifts, not just the
caller's. Reachable by the lowest authenticated role (`requireStaff`, no
extra permission).

**Remediation:** coerce with `String(req.query.shiftId)` before building the
filter (rejects objects), or route through a Zod schema. Owner: whoever picks
up the Zod-extension recommendation below.
**Retest:** `GET /api/bank-deposits?shiftId[$exists]=true` with a low-privilege
staff token — must return either a 400 or only that staff's shift-scoped
results, never the full collection.

---

### 2. NoSQL operator injection (filter bypass + ReDoS) — `GET /api/audit-log`
**Severity:** High · **OWASP:** A03:2021 Injection · **Status:** CONFIRMED, FIXED
**File:** [server/features/audit.js:191-193](server/features/audit.js:191)

```js
if (req.query.entity) filter.action = { $regex: `^${req.query.entity}_`, $options: 'i' };
if (req.query.action) filter.action = req.query.action;
if (req.query.actor)  filter.userId = req.query.actor;
```
`AuditLog.action`/`.userId` are plain `String` fields — Mongoose does not
CastError an operator object against a `String` schema type the way it does
against `ObjectId`/`Number`. `?actor[$ne]=x` or `?actor[$regex]=(a+)+$` +
`&actor[$options]=i` reaches `AuditLog.find()` unmodified: a filter bypass at
minimum, and an attacker-controlled `$regex` is a ReDoS vector. Reachable by
any account with `audit.view` permission — not superadmin-only.

**Remediation:** same as #1 — coerce to `String(...)` at minimum; better, add
a Zod query schema for this route.
**Retest:** `GET /api/audit-log?actor[$ne]=nobody` — must not return
every log entry regardless of actor.

---

### 3. Regex injection / ReDoS via unescaped string interpolation
**Severity:** Medium · **OWASP:** A03:2021 Injection · **Status:** CONFIRMED, FIXED
**File:** [server/features/audit.js:191](server/features/audit.js:191) (same line as #2, independent bug)

`req.query.entity` is spliced directly into a `RegExp`-producing template
string with no escaping — contrast with `inventory.js`'s equivalent
regex-from-user-input code, which runs input through the repo's own
`escapeRegex()` helper first (already in `ctx`, just not used here).
**Remediation:** wrap with the existing `escapeRegex()` helper, same as
`inventory.js` already does.
**Retest:** submit a catastrophic-backtracking pattern as `entity` and confirm
response time stays flat.

---

### 4. Control-plane login has no rate limiting
**Severity:** Medium · **OWASP:** A07:2021 Identification & Authentication Failures · **Status:** CONFIRMED, FIXED (absence verified by grep — no `express-rate-limit` import anywhere in this file; fixed with an in-process limiter rather than adding the dependency, see remediation)
**File:** [platform/control-plane/server.js:287-294](platform/control-plane/server.js:287)

`POST /api/login` compares the submitted password against `CP_PASSWORD` with
a timing-safe `safeEqual()`, but nothing throttles repeated attempts. The
process holds the Docker socket (root-equivalent on the host) and is meant to
be reachable only over an SSH tunnel per the file's own top-of-file comment —
that's the primary control, but it has zero defense-in-depth if the tunnel-only
assumption is ever violated (see Part 4 finding below, which is exactly that
scenario).
**Remediation (shipped):** added a small in-memory sliding-window limiter
(`passwordAttemptLimiter`, 5 attempts/15min per IP — mirrors `loginLimiter`'s
numbers) rather than pulling in `express-rate-limit` as a new dependency for
a single-route, single-operator tool. Applied to `/api/login` and both
`CP_DANGER_PASSWORD` checks (`wipe`, `DELETE /api/tenants/:slug`).
**Retest:** script 20 rapid `POST /api/login` attempts with wrong passwords —
must start returning 429s well before 20.

---

### 5. `idempotencyKey` is not DB-unique — retry race can double-create an order
**Severity:** Medium · **OWASP:** A04:2021 Insecure Design (business-logic race) · **Status:** CONFIRMED, FIXED
**File:** [server/server.js:952](server/server.js:952) (schema: `index: true`, not `unique: true`), used at [server/features/orders.js:370-375](server/features/orders.js:370)

```js
const existingOrder = await Order.findOne({ idempotencyKey });
if (existingOrder) return res.status(200).json({ success: true, order: existingOrder, ... });
```
Check-then-create: two concurrent requests carrying the same
`Idempotency-Key` header can both pass the `findOne` before either `create`
completes, producing two orders for one client-side retry. This is the same
class of concurrency issue Part 1's `TenantStats` fix hit under load (see
`applyStatsDelta` in `orders.js`) — worth testing together.
**Remediation (shipped):** index is now `unique: true, sparse: true`
(`server.js`); `POST /api/orders` catches `E11000` on the idempotencyKey
index and returns the existing order (same "Duplicate prevented." response
the findOne check already gave), instead of a 500.
**Retest:** fire two truly concurrent `POST /api/orders` requests with the
same `Idempotency-Key` (mirrors the Part 2 load-test's double-submit
scenario) — must produce exactly one order.

---

### 6. Zod validation absent on 11 other route files (hygiene gap, not concretely exploitable as reviewed)
**Severity:** Low · **OWASP:** A03:2021 Injection (defense-in-depth) · **Status:** PLAUSIBLE
**Files:** `orders.js`, `inventory.js`, `admin-tools.js`, `client-portal.js`, `clients.js`, `notifications.js`, `purchase-orders.js`, `qr-sessions.js`, `reports.js`, `settings.js`, `shifts.js` (plus `finance.js`/`audit.js` above, which DO have concrete findings)

Every other `.find()`/`.aggregate()` call across these files was traced and
either filters on `req.params.id` (protected by Mongoose ObjectId
CastError), filters on server-derived `req.user.*` fields, or already
coerces/escapes input (e.g. `inventory.js` already uses `escapeRegex()`).
`AUDIT_OVERVIEW.md` (2026-06-05) already flags "extend Zod `validate()` to
all write routes" as an open recommendation — this review corroborates it as
still-open defense-in-depth, not new information, and downgrades the
spec's working assumption of blanket injection risk across all 13 files to
the two concrete findings above.
**Remediation:** extend Zod per the existing `AUDIT_OVERVIEW.md`
recommendation; add `express-mongo-sanitize` globally as a cheap blanket
backstop against this whole class (currently nothing strips `$`/`.` keys
anywhere in the app).
**Retest:** re-run the grep this review used (any `req.query`/`req.body`
value reaching a Mongo filter without `String()`/`Number()`/Zod) and confirm
zero remaining hits.

---

### 7. `trust proxy` hop-count comment doesn't match the actual deploy topology
**Severity:** Info · **Status:** PLAUSIBLE — needs a decision, not a code fix
**File:** [server/server.js:97](server/server.js:97)

`app.set('trust proxy', 1)` is commented as tuned for "Railway/Vercel," but
the actual 4-tenant target is Caddy on the same Hostinger KVM2 box. One hop
(Caddy) is still probably correct, but confirm there's no additional
Hostinger-edge hop that would make `req.ip`/rate-limit keying wrong — this
directly affects whether IP-based limiting (`loginLimiter`, etc.) is
bypassable by proxy header spoofing.
**Retest:** from outside, send a request with a spoofed
`X-Forwarded-For` and confirm `req.ip` in logs reflects the real connecting
IP, not the spoofed header.

---

## Verify-at-deploy (not code defects — infrastructure decisions, belongs in Part 4)

**Cross-tenant isolation** is an app-level no-op by design:
`tenantScope(req)` always returns `{}` (`server.js:249`, explicitly commented
— multi-tenancy was paused in favor of one-container-per-tenant). This is
correct for the actual architecture, *provided* isolation is real at the
infrastructure layer: each tenant needs its own generated `JWT_SECRET` (a
token signed by tenant A's secret must fail verification on tenant B's
container), and Caddy must have no fallback route that could serve tenant B's
UI/API under tenant A's subdomain. Both are exactly the Part 4 checklist
items — this review can't verify them without the real box's config.

**Control-plane port exposure**: the app binds `0.0.0.0` inside its own
container (`platform/control-plane/server.js:567`); the actual restriction to
`127.0.0.1`-only comes from the port mapping in
`platform/docker-compose.yml`, not the app itself. Confirm that mapping is
still in place on the real box and blocked at the firewall — this is the
scenario finding #4 above (control-plane login has no rate limiting) assumes
can't happen; if it ever does, #4 becomes far more serious.

---

## Follow-ups requiring a deployed target (out of scope for this pass)
- OWASP ZAP / Burp baseline scan against the live SPA/API.
- Live control-plane external-reachability check (`nmap`/`curl` from outside
  the SSH tunnel).
- `npm audit` CI-gate confirmation on both `client` and `server` — check the
  actual `.github/workflows/ci.yml` run logs, not just that the step exists.
