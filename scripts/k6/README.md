# Load/stress test harness — pre-launch spec Part 2

Six k6 scenarios plus the data seeder, matching the spec's test-scenario
table. Requires the standalone [k6](https://k6.io) binary (not an npm
package) — install it separately, it isn't in `package.json`.

## Order of operations

1. Ship Part 1 (the `TenantStats`/`ProductStats` dashboard-counter fix) first
   — the seed script below assumes it exists.
2. Provision the 4 tenant stacks through `platform/control-plane` (the real
   deploy path — testing anything else doesn't validate what will ship), each
   capped at `--cpus=2 --memory=8g` to match the target Hostinger KVM2.
3. Confirm the shared `mongod` is a genuine `rs0` replica-set member.
4. Seed realistic volume per tenant:
   ```bash
   cd server
   node scripts/seed-load-test-data.mjs --orders=30000 --months=9
   node scripts/backfill-stats.mjs
   node scripts/backfill-stats.mjs --verify   # must print "OK"
   ```
   Repeat against each tenant's own `MONGO_URI`/`BUSINESS_TYPE`.
5. Run the scenarios below, in order, against the provisioned stacks.

## Scenarios

| # | File | What it checks |
|---|------|-----------------|
| 1 | `01-single-tenant-baseline.js` | Per-tenant ceiling — the number everything else compares against. |
| 2 | `02-concurrent-tenant-peak.js` | **The critical test.** All 4 stacks under simultaneous lunch-rush load. |
| 3 | `03-report-data-volume.js` | P&L, balance sheet, inventory/FEFO, order-history under seeded volume. |
| 4 | `04-websocket-stress.js` | Concurrent Socket.io connection count, no reconnect storm. |
| 5 | `05-soak-test.js` | Sustained load across a full simulated business day (span local midnight to hit the auto-archive job). |
| 6 | `06-spike-test.js` | Sudden opening-rush burst — rate limiters must degrade to clean 429s, never a 5xx. |
| 7 | `07-inventory-stress.js` | Inventory reads + concentrated concurrent restock (tests the WAC read-modify-write transaction's retry logic). Business-type-agnostic — run against both an `fb` and a `log` tenant, since `log` products are effectively 1:1 with inventory (no stock, no sellable products). |

Each file's header comment has its exact `k6 run` invocation and required
`-e` env vars (`BASE_URL`, `STAFF_NAME`, `STAFF_PASSWORD`, etc.). All auth
against a real staff account you create on the tenant beforehand — none of
these scripts create one.

## Reading a high error rate: rate limiter vs. real capacity

`server/server.js` applies `generalApiLimiter` (300 requests/min, keyed by IP)
to all of `/api`. k6 sends every VU's traffic from ONE source IP, so any
scenario running enough concurrent VUs from one k6 instance will trip that
limiter — and a burst of clean, sub-10ms `429`s can look identical to a
capacity problem in the raw `http_req_failed` rate if you don't check status
codes. Before concluding "the server can't handle this load," check whether
the failures are actually `429`s (rate limiter working as designed, not a
finding) or `5xx`/timeouts (a real problem). `01-single-tenant-baseline.js`
tracks this explicitly as a separate `rate_limited` metric so the two don't
get conflated.

This cuts the other way too: `01-single-tenant-baseline.js` runs at a
deliberately modest, human-paced VU count (peak 8, 2-4s between polls) meant
to resemble one location's real concurrent usage — multiple POS terminals, a
live dashboard, the occasional report pull. If even THAT produces a non-zero
`rate_limited` count, it's a real, separate finding worth escalating before
go-live: legitimate concurrent traffic from one location likely shares a
single public IP via NAT, and 300 req/min may be tight for a busy location
during a rush. That's a product decision (raise the limit? key it some other
way?), not a capacity fix.

## Thresholds (starting defaults — confirm before treating as hard gates)

| Metric | Target |
|---|---|
| p95 API latency (reads) | < 500ms |
| p95 order-completion latency | < 800ms |
| Error rate under peak | < 1% |
| Sustained CPU across the box | < 85% |
| OOM kills | zero, ever |
| Replica-set health | no unexpected primary stepdowns |
| Order-completion transaction success | 100% under peak |

## Capturing results (the actual deliverable — not just a live k6 terminal)

For every run, capture alongside k6's own summary (`k6 run --summary-export=result.json ...`):

- `docker stats --no-stream` (or equivalent) per container during the run
- `mongosh --eval 'db.serverStatus()'` — connections, and `rs.status()` for
  replica-set health
- Mongo slow-query log, if profiling is enabled

A results report is p95/p99 latency + error rate + those three captures, per
scenario, per run — not just "it looked fine on the terminal."
