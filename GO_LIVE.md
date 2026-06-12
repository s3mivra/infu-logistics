# Semivra Libellus POS — Go-Live & Rollback Runbook

_Use this to take the `security/hardening-p1-p3` branch to production safely. It deals
specifically with the **breaking dual-token auth change**, which logs every active
user out on deploy and depends on correct CORS/cookie configuration._

---

## 0. Before you touch production

- [ ] You have a **staging** environment (or a throwaway deploy) pointing at a **TEST** MongoDB — never production data.
- [ ] You can reach the server logs (Railway dashboard / `make logs`).
- [ ] You have a **fresh database backup** (`make backup` or `scripts/backup-mongo.sh`) and have **restored it once** to prove the backup works.
- [ ] You know the current running commit (for rollback): `git rev-parse HEAD` on the deployed branch.

## 1. Required environment variables (server)

| Var | Required | Notes |
|-----|----------|-------|
| `MONGO_URI` | ✅ | Production DB connection string |
| `JWT_SECRET` | ✅ | Long random secret. **Rotating it logs everyone out.** |
| `ALLOWED_ORIGINS` | ✅ | **Comma-separated exact frontend origins.** e.g. `https://app.kasalokal.com`. **If wrong, login/refresh return 403.** |
| `NODE_ENV` | ✅ | Set to `production` (enables Secure cookies, hides error detail) |
| `ADMIN_PASS` | first boot | Seeds the initial Super Admin password if no users exist |
| `PORT` | optional | Defaults to 5002 |
| `SENTRY_DSN` | optional | If set, server errors report to Sentry; if unset, monitoring is off |
| `LOG_LEVEL` | optional | `info` in prod by default |

> **Cookie reality check.** The frontend (Vercel) and API (Railway) are different sites, so the
> refresh cookie is `SameSite=None; Secure` in production. This **requires HTTPS on both** and
> `NODE_ENV=production`. Over plain HTTP the cookie will be dropped and login won't persist.

## 2. Staging verification (do this BEFORE production)

Deploy the branch to staging, then walk through every line. **All must pass:**

- [ ] **Login** as Super Admin → reach the dashboard (no 403).
- [ ] **Reload the page** → you stay logged in (silent refresh via cookie works).
- [ ] **Log out** → returns to login. Reload → still logged out (session revoked server-side).
- [ ] **Create a staff user**, log in as them with **starting cash** → shift opens.
- [ ] **Take a cash sale → send to Preparing (enter cash tendered)** → shift cash total increases (not ₱0).
- [ ] **Complete the order** → check the **General Ledger** shows the sale's journal entry (auto-refreshes).
- [ ] **Revolving fund**: create with a "Paid From" account → ledger updates live; **replenish** → ledger updates live.
- [ ] **Void** a completed order (Super Admin) → stock restored, reversing entries posted.
- [ ] **Settings**: toggle **Auto Close OFF/ON** and **QR Orders OPEN/CLOSED** as Super Admin → confirm a non-superadmin cannot see/flip them.
- [ ] **Owner exclusion**: confirm the Super Admin does NOT appear in Staff Hours / Shift History / Cashier Variance.
- [ ] Run the **E2E suite**: `cd client && npm run e2e:install` (once), then `npm run e2e` → green.

If any step fails, fix it on the branch and re-verify. **Do not proceed to production until all pass.**

## 3. Production deploy

1. [ ] Announce a short maintenance window (this deploy logs everyone out).
2. [ ] **Backup production DB** and verify the dump file exists and is non-empty.
3. [ ] Confirm production env vars from §1 are set (especially `ALLOWED_ORIGINS`, `NODE_ENV=production`).
4. [ ] Merge `security/hardening-p1-p3` → `main` (or deploy the branch directly).
5. [ ] Deploy server, then client.
6. [ ] **Smoke test on production** (subset of §2): health check returns `ok`, login works, one reload stays logged in, one test sale posts a journal entry.
7. [ ] Watch logs for 10–15 minutes for 5xx spikes or CORS-blocked errors.

### Health check
```
curl https://<api-host>/health        # expect {"status":"ok","db":"connected",...}
```

## 4. Rollback (if production breaks)

**Symptom → action:**

| Symptom | Likely cause | Action |
|---------|-------------|--------|
| Everyone gets 403 on login | `ALLOWED_ORIGINS` wrong / missing | Fix the env var and redeploy server (no rollback needed) |
| Login works but reload logs out | Cookie not sent (not HTTPS, or `NODE_ENV`≠production) | Fix env/HTTPS; redeploy server |
| 5xx spike / app unusable | Regression in the new code | **Full rollback** (below) |

**Full rollback procedure:**
1. [ ] Redeploy the **previous known-good commit** (the SHA you recorded in §0). On Railway/Vercel, redeploy the prior build, or:
   ```
   git revert --no-edit <range>      # or reset the deployed branch to the old SHA
   ```
2. [ ] The old code used `localStorage` JWTs — users will simply log in again. No data migration is needed to roll back (the new `RefreshSession` collection is additive and harmless if unused).
3. [ ] If the DB was somehow corrupted (it should not be — no destructive migrations were added): restore the backup from §3.2.
4. [ ] Confirm health check + login on the rolled-back version.

> **Data safety note:** this release adds collections/fields (`RefreshSession`, revolving-fund
> source account, stock-card entries for manual batches) but does **not** delete or rewrite
> existing data. Rolling the code back does not require a DB rollback.

## 5. First-week watch

- [ ] Daily: confirm the **midnight auto-close** ran (or that you closed manually if Auto Close is OFF).
- [ ] Daily: confirm **backups** are being produced.
- [ ] Have an accountant review the first batch of **journal entries / P&L / Balance Sheet** for correctness.
- [ ] Watch error monitoring (if `SENTRY_DSN` set) or server logs for recurring warnings.

## 6. Contacts / references
- Deployment details: `DEPLOY.md`
- Ops commands: `Makefile` (`make health`, `make logs`, `make backup`, `make restore`)
- User training: `MANUAL.md` / `Semivra_Libellus_Manual.pdf`
