# Manual QA Checklist — Post Feature-Driven Restructure

Every page/tab is now lazy-loaded from a new path and every API route lives in a new
`server/features/*` module, so the goal is: **open every screen once, and run one
real transaction through every money-touching flow.** A blank screen, spinner that
never resolves, or a red toast = a broken import or route.

Setup: run the server + client, log in as superadmin. Do a run in your normal
BUSINESS_TYPE first; the F&B vs logistics differences are flagged inline.

---

## 1. Boot & Login
- [ ] App loads at `/` and redirects to `/admin` (login screen, no blank page)
- [ ] Wrong password shows an error (doesn't crash)
- [ ] Correct login lands on the dashboard
- [ ] Refresh the page while logged in — session survives (token refresh works)
- [ ] Logout, then confirm a protected page bounces you back to login

## 2. Dashboard Tabs (each is a separately loaded file — open ALL of them)
- [ ] **Orders tab** loads and shows current orders
- [ ] **History tab** loads; pagination (Pager) works — next/prev pages
- [ ] **Inventory tab** loads with stock list
- [ ] **Ledger tab** loads; pagination works; sub-views open: Journal, P&L, Balance Sheet, A/R, A/P
- [ ] **Pricing tab** loads (discounts list)
- [ ] **Products tab** loads with product list
- [ ] **Analytics tab** loads with charts/numbers
- [ ] **Audit tab** loads with audit log entries

## 3. Products & Catalog
- [ ] Create a category
- [ ] Create a product (with price + recipe/stock link if applicable)
- [ ] Edit the product (change price) — saves and shows new price
- [ ] Toggle product availability / out-of-stock
- [ ] Create a modifier group and attach to a product (F&B)
- [ ] Create a combo (F&B)
- [ ] Delete a test product/category

## 4. Orders — Staff Flow (core money path)
- [ ] Create a new order from the Orders tab with 2+ items
- [ ] Order appears in the list with correct total (tax/discount math right)
- [ ] Park an order, then retrieve it from parked
- [ ] Apply a discount to an order
- [ ] Apply complimentary to an item, then remove it
- [ ] Complete/settle the order (each payment method you use: cash, GCash, card…)
- [ ] Completed order appears in **History**
- [ ] Check **Ledger → Journal**: the sale posted a balanced entry (debit = credit)
- [ ] Inventory deducted for recipe items (check stock count before/after)
- [ ] Partial delivery / partial fulfillment on an order (logistics)
- [ ] Dispatch an order (logistics)

## 5. QR Session + Customer Menu (F&B)
- [ ] Go to `/generate-qr`, generate a QR for a table
- [ ] Scan the QR with a phone (or open the URL) — customer menu loads at `/menu/:table`
- [ ] Menu shows only available products
- [ ] Add items to cart, place the order as the customer
- [ ] Order pops up on the staff Orders tab (socket real-time — no manual refresh)
- [ ] Try ordering with an expired/closed session — should be rejected with a clear message
- [ ] Close the session from admin, confirm the customer can no longer order

## 6. Client Portal (logistics)
- [ ] Create a client account in the Super Admin panel
- [ ] Log in at `/client/portal` with those credentials
- [ ] Client sees only THEIR orders (not other clients')
- [ ] Mark an order as "received" as the client
- [ ] Staff token cannot access client routes and vice versa (open a client URL while logged in as staff — should be forbidden)

## 7. Refunds & Voids
- [ ] Refund a completed order (admin or superadmin) — status updates, ledger entry posted, balanced
- [ ] Void an order (superadmin only) — stock restored, reversing journal entry posted
- [ ] Confirm a cashier/staff role CANNOT void

## 8. Inventory Deep Checks
- [ ] Add a new inventory item
- [ ] Restock an existing item — weighted-average cost updates, journal entry posted
- [ ] Record spoilage — stock drops, expense posted
- [ ] Add an expiry batch; check **Expiring soon** view shows it
- [ ] Delete a batch
- [ ] Run **EOD count**: fetch EOD data, submit counts, lock
- [ ] Reopen EOD as admin
- [ ] Inventory revaluation (superadmin) posts and balances
- [ ] Bulk import (if you use it) with a small test file

## 9. Finance / Ledger
- [ ] Create a manual journal entry — rejected if unbalanced, accepted if balanced
- [ ] Record an expense — appears in P&L
- [ ] Settle an A/R order; A/R outstanding drops
- [ ] Record an A/P payment; A/P outstanding drops
- [ ] Bank deposit: record one, balances move correctly
- [ ] Payment-method map: change a method's account, make a sale with that method, confirm it posts to the new account
- [ ] Revolving fund: create → disburse → replenish → close; balance returns to initial; every step posts balanced entries
- [ ] Close an accounting period, try to post into it (should be blocked), reopen it

## 10. Reports (each = one extracted route — just open each and sanity-check numbers)
- [ ] P&L + P&L monthly
- [ ] Balance Sheet + monthly
- [ ] Sales summary / sales by payment
- [ ] Profit by category
- [ ] Percentage tax
- [ ] Menu engineering (F&B)
- [ ] Cashier variance
- [ ] Purchase order report
- [ ] Analytics dashboard numbers match a sale you just made

## 11. Users, Roles & Shifts
- [ ] Create a user with a limited role; log in as them; confirm restricted screens are blocked
- [ ] Change own password, re-login with the new one
- [ ] Create a custom role, delete it
- [ ] Clock in → start break → end break → clock out; entries show for admin
- [ ] Shifts list shows the shift with correct cash totals

## 12. Super Admin Panel (`/admin/admin-panel`)
- [ ] Panel loads (separately lazy-loaded page)
- [ ] Tenants list loads; create/edit/deactivate a test tenant
- [ ] Add-ons CRUD
- [ ] Client accounts CRUD (logistics)
- [ ] Settings: flip a toggle (e.g. accepting QR orders) and confirm it takes effect

## 13. Audit & Guardrails
- [ ] Audit log recorded the actions you just did (void, refund, user edit…)
- [ ] Hitting an API without a token returns 401 (open a `/api/...` URL directly)
- [ ] Unknown route returns the 404 handler, not a crash

## 14. PWA / Offline (if you use it)
- [ ] Install prompt appears / app installable
- [ ] Go offline, queue an order, come back online — it flushes
- [ ] Offline clock-in queues and flushes
- [ ] Notifications permission + a test notification fires

## 15. Cross-cutting
- [ ] Open browser devtools console while doing all of the above — **zero red errors**
- [ ] Two browser windows open: action in one appears live in the other (socket events)
- [ ] Mobile-width check of menu + dashboard (nothing overflows)
- [ ] Hard refresh (Ctrl+Shift+R) on every major URL: `/admin`, `/admin/admin-panel`, `/generate-qr`, `/menu/:table`, `/client-login`, `/client-order` — each loads directly

## 16. Exports & Archives (added — these use lazy-loaded libraries inside the moved dashboard code)
- [ ] Export a PDF (any report that offers it) — jspdf loads on demand; a broken chunk = silent fail or console error
- [ ] Export to Excel (xlsx) — same deal, loads on first use
- [ ] QR code modal on the dashboard renders an actual QR image (react-qr-code — this crashed once before)
- [ ] Archive today's orders (manual archive button) — orders move out of the live list
- [ ] Open **Order Archives** (superadmin) and confirm the archived batch is there

## 17. Admin Maintenance Tools (superadmin, only if you use them)
- [ ] Backdate-sale tool posts a sale on the chosen past date, balanced
- [ ] Seed payment sub-accounts runs without error (idempotent — safe to re-run)
- [ ] Chart of accounts view (`/api/coa` screen) lists all accounts including custom ones

---

**If anything fails:** note the URL + the browser console error. After this restructure,
failures will almost certainly be one of: a bad import path in `client/src/features/*`,
or a missing identifier in a `server/features/*` module (shows as a 500 with a
ReferenceError in server logs).
