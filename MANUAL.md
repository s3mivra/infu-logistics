# Semivra Libellus POS — Complete Manual & Tutorial

_For Kasa Lokal and white-label F&B deployments · Last updated 2026-06-05_

This document has two parts:
- **Part A — Quick-Start Tutorial:** the shortest path to taking your first order and closing your first day.
- **Part B — Full Reference Manual:** every screen, workflow, and rule explained.

> **Roles at a glance.** The app has two kinds of users:
> - **Owner / Superadmin** — full access: accounting, users, settings, voids, reports. Not counted as a tracked employee (excluded from staff hours, shift history, and cashier variance).
> - **Staff / Cashier / Manager** — day-to-day POS, orders, inventory, their own shift. Locked out of accounting, user management, and other superadmin-only areas (these show a "Superadmin Only" lock).

---

# PART A — QUICK-START TUTORIAL

## 1. Log in
1. Open the app. Enter your **Admin Name** and **Password**.
2. **Staff/Cashier:** you must enter your **Starting Cash** (the float in the drawer, e.g. `1000`). This opens your shift.
3. **Owner/Superadmin:** Starting Cash is optional.
4. Press **Log In**.

> Your session stays signed in across page reloads. You'll see a brief "Restoring session…" splash while it reconnects — that's normal.

## 2. Take a sale (POS)
1. Go to **Orders & POS**.
2. Open the **Register**. Use the **search bar** to find a product, tap it to add to the cart. Adjust quantity with **+ / −**.
3. (Optional) Add a **discount**: enter a `₱` amount or `%` in the discount row.
4. Choose the **order type** (Dine-In, Takeout, Pickup, etc.) and enter the **customer name** if required.
5. Press **Charge / Place Order**.

## 3. Collect payment & send to kitchen
1. The order appears in the **Orders** list as **Pending**.
2. Tap **Prepare / Send to Kitchen**. For a **cash** sale, enter the **cash tendered** — the app shows the **change**. *(This is the moment cash enters your drawer and counts toward your shift.)*
3. The kitchen marks it **Ready**, then **Delivered/Completed** when handed over.

## 4. Close your shift (End of Day)
1. Press **End Shift** (top of the screen).
2. Count your drawer and enter the **Actual Cash** (or use the denomination counter).
3. The app shows **Expected vs Actual** and the **variance**. Confirm to record the shift.
4. (Optional) Record a **bank deposit** of excess cash.

That's the core loop. Everything else below is detail and back-office.

---

# PART B — FULL REFERENCE MANUAL

## 1. Logging in & sessions

| Field | Who | Notes |
|------|-----|-------|
| Admin Name | everyone | Your account name |
| Password | everyone | Min 6 characters |
| Starting Cash | staff (required), owner (optional) | Opens a shift with this float |

- **Security:** logins use a short-lived access token kept in memory plus a secure refresh cookie. Reloading the page keeps you signed in; **logging out fully revokes the session** on the server (a stolen session can't be reused).
- **Forgot/My password:** change your own password from your profile (requires your current password). Changing it logs out your other devices.
- **Owner-managed accounts:** only the owner can create staff, reset their passwords, or change roles (which also force-logs that user out).

## 2. The POS Register (Orders & POS)

**Building an order**
- **Search** by product name; tap to add. Large touch targets are tuned for tablets.
- **Modifiers / Add-ons / Sizes:** if a product has options (e.g. milk choice, size), you'll be prompted to pick them.
- **Quantity:** `+ / −` on each cart line.
- **Discounts:** inline row — enter either a peso amount (`₱ off`) or a percentage (`%`). SC/PWD and promo types are supported.
- **Order notes:** free text passed to the kitchen ticket.
- **Guest count:** for dine-in covers.

**Order types (fulfilment modes)**
Dine-In · Takeout · Pickup · Manual Delivery · Grab Delivery · Foodpanda.
- **Pickup / Manual Delivery** collect address, phone, delivery fee, and scheduled time.
- **Grab / Foodpanda / Manual Delivery** are booked to **Accounts Receivable** (the partner owes you) until settled — they do **not** hit your cash drawer.

**Checkout & payment**
- The payment modal shows a **thermal receipt preview**, payment-method pills, and **quick-cash denomination buttons** (₱20–₱1000) with **Exact / Round** shortcuts and **live change** calculation.
- **Cash** is the only method that increases your drawer. E-wallet / bank / delivery channels book to A/R until you verify and settle them.

## 3. Order lifecycle

```
Pending ──Prepare──▶ Preparing ──▶ Ready ──Deliver──▶ Completed
                    (cash tendered here)         │
                                                 └▶ Partially Delivered ─▶ Completed
```

- **Pending:** placed, not yet paid or sent.
- **Preparing:** sent to kitchen; for cash, this is where you enter cash tendered (money enters the drawer).
- **Ready:** made, awaiting hand-off.
- **Completed:** delivered/closed — this is when the **revenue + COGS journal entries** post and inventory deducts.
- **Partially Delivered:** for multi-item orders where some items are handed over now and the rest follow ("Give Partial — More Items Coming"); ERP posts on final completion.
- **Park / Recall:** save an unpaid tab ("Park") and bring it back later from the parked list.
- **Complimentary:** zero-charge order (booked at cost, not selling price), with a required reason.
- **Void (owner only):** reverses a completed order — restores stock and posts reversing journal entries. Use instead of editing a completed order (completed orders are locked).
- **Refund (owner only):** posts a reversal journal for a returned/refunded sale.

## 4. QR self-ordering (customers)

- Each table gets a **QR code** (generate from the POS). Scanning opens the customer menu on the guest's phone.
- The guest builds an order against a **secure, single-use, time-limited session**; placing the order burns the session.
- Orders flow into the same kitchen queue. A "your order is ready" notification can be pushed to the guest.
- The owner can **open/close QR ordering** globally with the **QR Orders: OPEN/CLOSED** toggle (kitchen-busy switch). Staff POS is unaffected by this toggle.

## 5. Inventory & Stock

**Units.** You always work in **kg / L / pcs**. Internally the system stores base units (g / ml / pcs) for recipe precision and converts for display.

**Core actions**
- **Procurement (new item):** add an item with quantity, unit cost, low-stock threshold, and optional expiry. Posts an inventory asset journal entry.
- **Restock:** add stock to an existing item; appends a new expiry batch and books the purchase.
- **Edit item (owner):** rename, change unit/cost/threshold/expiry. **Stock quantity is not editable here** — use Restock / Spoilage / counts so the audit trail and ledger stay intact.
- **Spoilage / Waste:** log wasted stock with a required reason; posts `DR Spoilage/Variance / CR Inventory` and a stock-card entry.
- **Recipes:** each product (and add-on) has a recipe of inventory ingredients; completing an order deducts them automatically.

**Expiry (FEFO — First Expired, First Out)**
- Items can hold **multiple batches**, each with its own expiry, cost, and received date.
- The main view shows the **soonest** expiry with colour-coded badges (Expired / Today / ≤warn-days / ≤30d).
- The **Expiry Watch** panel lists items expiring within 30 days.
- Order completion and spoilage consume the **oldest batch first**.
- **Manual batch add/remove (owner):** correct the physical batch breakdown. Adding a batch increases stock (booked as an inventory gain); removing one decreases stock (booked as a variance/write-off). Both keep stock and the ledger in sync — no stock "from thin air."

**Excel / CSV bulk import & stock-take**
- **Import** an `.xlsx/.xls/.csv` to bulk onboard or reconcile stock. Standard header: `Code, Product, SRP, Qty Unit, Unit Cost, Expiry date` (older formats still accepted).
- A **preview modal** shows a colour-coded diff (NEW / ↑ / ↓ / SAME / ERROR) before you commit.
- Differences post adjustment journals automatically (gain or variance), and every row writes a stock-card entry.
- Use the **Template** button to download a sample file.

**Low-stock alerts.** Set a per-item threshold; the sidebar and table badge items at or below it.

## 6. End-of-Day (EOD) inventory count
1. Open the **EOD / count** flow.
2. Enter the **physical count** for each item in display units (kg/L/pcs).
3. The app shows **System End vs Physical**, movement (Start / In / Out), and **variance** per item.
4. Submit to record the count and **lock** the day.

## 7. Shifts & cash control

- **Start:** opening a shift requires the **starting float** (staff).
- **During the shift:** the running **cash sales** total reflects cash that has actually entered the drawer — i.e. **completed cash sales plus paid in-progress orders** (cash tendered at the Preparing step). An order still sitting as *Pending* (not yet paid) shows ₱0 until it's taken — that's correct.
- **End Shift:** count the drawer, enter actual cash, review **Expected vs Actual** and the **variance**. A non-zero variance posts a **Cash Short/Over** journal entry.
- **Bank deposit:** move excess drawer cash to the bank (keeps the starting float); posts a journal entry.
- **Shift History (owner):** full ledger of past shifts with variance colours. **X-Reading** prints a mid-shift summary PDF without closing the register.

> **Owner note:** the owner/superadmin is **not** treated as a cashier. Owner shifts and clock entries are hidden from **Shift History**, **Staff Hours**, and **Cashier Variance**.

## 8. Staff time tracking
- **Clock In / Out** (and break) from the sidebar; the app tracks worked minutes for payroll.
- **Staff Hours (owner):** paginated list of clock entries by staff and date. The owner is excluded.

## 9. Accounting & Ledger (owner only)

Everything that moves money or stock posts a **balanced double-entry journal entry** automatically. The Ledger tab has these sub-views:

| Sub-tab | What it shows |
|--------|----------------|
| **Journal** | Every journal entry (paginated), with CSV export |
| **P&L** | Profit & Loss over a date range — revenue, COGS, OpEx, gross/net margin |
| **Balance Sheet** | Assets / Liabilities / Equity with a balanced-equation check |
| **A/R Outstanding** | Non-cash sales (e-wallet/bank/delivery) awaiting settlement — **Settle** each one |
| **A/P Payables** | Amounts you owe (on-account purchases/expenses) |
| **Sales by Payment** | Breakdown of sales by payment method over a range |
| **Profit by Category** | Gross profit and margin per menu category |
| **Menu Engineering** | Stars / Plowhorses / Puzzles / Dogs classification by sales × margin |
| **Cashier Variance** | Average drawer variance per cashier (owner excluded) |
| **Purchase Order** | Suggested reorder quantities from usage + low-stock, with PDF export |
| **Add Expense** | Record an operating expense (cash or on-account) |
| **Revolving Funds** | Petty-cash pools (see below) |

All the report tables are **paginated** (10 rows per page).

**Accounting rules to know**
- **Non-VAT registered.** The system uses the percentage-tax model; receipts show "NON-VAT REGISTERED."
- **Cash vs A/R.** Only physical **cash** hits Cash on Hand immediately. Bank transfer, GCash, Maya, Maribank, e-wallet, Grab, Foodpanda, and manual delivery all book to **Accounts Receivable** until you settle them via the A/R sub-tab (choose where the money was deposited).
- **Balanced guarantee.** Every entry is asserted to balance (debits = credits) before it's saved.

**Revolving / petty-cash funds**
- **Create a fund:** name, initial amount, and **Paid From** (Cash on Hand or Cash in Bank) — the chosen account is credited in the opening entry, so the float comes from a real source, not thin air.
- **Out (disburse):** log a small expense paid from the fund (`DR Expense / CR Petty Cash`).
- **In (replenish):** top the fund back up from a chosen cash account.
- **History:** per-fund transaction ledger, paginated.

## 10. Settings (owner only)

| Setting | Effect |
|--------|--------|
| **QR Orders: OPEN / CLOSED** | Globally accept or pause customer QR orders (staff POS unaffected) |
| **Auto Close: ON / OFF** | When ON, the system auto-cancels hanging orders, archives the day, and locks the register at **midnight (PH time)**. When **OFF**, the day stays open past midnight and you must **archive/close manually** |

**Manual day-close / archive.** The archive sweep force-cancels any hanging orders — **Pending, Preparing, Ready, and Parked** (held unpaid tabs) — then archives the day so cancelled and parked orders are never left dangling.

## 11. Superadmin Panel (owner only)
- **Users:** create staff, set roles, reset passwords, delete accounts. (Role/password changes log that user out.)
- **Roles:** manage the role list.
- Search, filter, and batch-update users.

## 12. Devices, offline & install
- **Tablet-first.** Touch targets, layouts, and contrast are tuned for tablets (e.g. Amazon Fire).
- **Install as app:** when the browser offers it, use **Install App** for a full-screen PWA.
- **Offline-first:** if the connection drops while placing an order, it's **queued locally** and **auto-syncs** when you're back online — you won't lose the sale.
- **Receipts/printing:** kitchen tickets and receipts print to a connected thermal printer; receipts show "NON-VAT REGISTERED" and any delivery details.

---

## 13. Common tasks — step by step

**Void a completed order (owner)**
Orders → find the completed order → **Void** → enter reason. Stock is restored and reversing entries post. (You can't void an already-settled A/R order.)

**Settle a delivery / e-wallet sale (owner)**
Ledger → **A/R Outstanding** → **Settle** on the order → confirm amount and the deposit account. Posts `DR cash / CR A/R`.

**Record an expense (owner)**
Ledger → **Add Expense** → amount, category, paid-from (or On Account), vendor, date.

**Reorder stock**
Ledger → **Purchase Order** → **Generate** → review suggested quantities → **PDF** to send to your supplier.

**Pause customer QR ordering when slammed (owner)**
Sidebar → **QR Orders** → toggle to **CLOSED**. Switch back to **OPEN** when ready.

**Keep the register open past midnight (owner)**
Sidebar → **Auto Close** → toggle **OFF** (confirm). Remember to archive the day manually.

---

## 14. Troubleshooting

| Symptom | Cause / fix |
|--------|-------------|
| Login fails / immediately logs out | Server `ALLOWED_ORIGINS` must list the exact frontend URL. Check with the deployer. |
| "Restoring session…" then login screen | Session expired or was revoked — log in again. |
| Shift cash shows ₱0 after a sale | The order is still **Pending** (cash not yet collected). Send it to **Preparing** and enter cash tendered. |
| A non-superadmin sees "Superadmin Only" locks | Expected — accounting, users, settings, voids are owner-only. |
| Order won't change after Completed | Completed orders are locked by design — use **Void** instead. |
| "Too many requests" | Rate limit hit (e.g. rapid retries) — wait a moment and retry. |
| Excel import shows ERROR rows | Fix the flagged rows (bad qty/unit/cost) and re-import; the preview won't commit errors. |

---

## 15. Glossary
- **COGS** — Cost of Goods Sold (recipe ingredient cost of items sold).
- **FEFO** — First Expired, First Out (oldest-expiry batch consumed first).
- **A/R** — Accounts Receivable (money owed to you, e.g. by delivery partners).
- **A/P** — Accounts Payable (money you owe, e.g. on-account purchases).
- **EOD** — End of Day (inventory count + register lock).
- **X-Reading** — mid-shift sales summary that does **not** close the register.
- **Variance** — Actual cash counted minus expected cash.
- **Float / Starting Cash** — the cash you start a shift with.
- **Non-VAT** — registered under percentage tax, not VAT.

---

_Questions about a workflow not covered here, or a screen that behaves differently? Note the exact screen and step and it can be added to this manual._
