# Semivra Libellus POS — Complete Guide

### Project Overview + Full User Manual · Written in plain language for everyone

_Last updated 2026-06-06 · For Kasa Lokal and white-label F&B deployments_

---

This single guide has two parts:

- **Part A — About the System** (what it is, why it exists, and how it's built — in plain terms).
- **Part B — How to Use It** (a complete, step-by-step manual for everyone, no tech background needed).

A **Glossary** and **Troubleshooting** section are at the end.

---

# PART A — ABOUT THE SYSTEM

## 1. What is Semivra Libellus?

Semivra Libellus is an all-in-one **Point of Sale (POS) and back-office system** for cafés and restaurants. It runs on a tablet at the counter and also lets customers order from their phones by scanning a QR code at their table.

In one app it handles:

- **Taking orders and payments** (the cash register)
- **Tracking ingredients and stock** (inventory)
- **Keeping the books** (real double-entry accounting — the kind an accountant uses)
- **Managing cashier shifts and the cash drawer**
- **Reports** — sales, profit & loss, balance sheet, and more
- **Working offline** — keeps taking orders even when the internet drops

## 2. The problem it solves

Most small food businesses are stuck between two bad options:

- **Cheap/free POS apps** that only ring up sales — no real inventory, no real accounting. You still do the books by hand in a notebook or spreadsheet.
- **Expensive foreign systems** (built for US taxes) that charge a fee on every transaction, need constant internet, and don't fit Philippine **Non-VAT** rules.

The result: owners spend hours reconciling sales, guessing their food cost, and preparing numbers for their accountant — and mistakes are common.

## 3. The solution

Semivra Libellus is **built for Philippine small F&B**. Every sale automatically:

- Reduces the right ingredients from stock (based on each product's recipe),
- Records a proper, balanced accounting entry, and
- Feeds real-time reports.

So at the end of the day you already have your sales summary, your profit figure, your cash position, and books that are ready for your accountant — **with no manual bookkeeping**.

## 4. What makes it different

- **It closes its own books.** Every sale, void, expense, and spoilage becomes a balanced journal entry automatically. Most small POS can't do this.
- **Non-VAT / BIR-aware** out of the box — built for PH percentage-tax businesses.
- **Offline-first.** A dropped connection never stops you from taking orders; they sync automatically when you're back online.
- **Recipe-true food cost.** It knows the exact ingredient cost of every item sold, so your profit is real, not a guess.
- **Tablet-friendly.** Big buttons, fast, designed for a busy counter.

## 5. Who uses it (roles)

- **Owner (Super Admin)** — sees everything: accounting, reports, settings, user management. The owner is *not* treated as a regular cashier (not counted in staff hours or shift reports).
- **Staff / Cashier / Manager** — take orders, handle the register, manage stock, run their own shift. They cannot see the owner-only areas (accounting, settings, user management).

## 6. How it's built (plain version)

You don't need this to use the app, but for completeness:

- It's a **web app** that works on any modern tablet/computer browser, and can be "installed" like a real app (PWA).
- There are two pieces: a **frontend** (what you see and tap) and a **backend** (the brain + database that stores everything).
- The backend keeps all your data in a secure cloud database. The app talks to it over an encrypted connection.
- Logins are protected by modern security (short-lived access keys, encrypted password storage, automatic session refresh).

---

# PART B — HOW TO USE IT

## 7. Logging in & starting your day

1. Open the app. Type your **Staff Name** and **Password**.
2. **Staff/Cashier:** enter your **Starting Cash** — the money already in the drawer (your float). This opens your shift.
3. **Owner:** Starting Cash is optional.
4. Tap **Start Shift**.

**Mandatory clock-in:** after logging in, staff must **Clock In** before they can use the register. (The owner is exempt.) This tracks work hours for payroll.

> Your login stays active even if you refresh or briefly lose connection — you won't be kicked out. After a long idle period it quietly refreshes itself.

## 8. Taking an order (the register)

1. Go to **Orders & POS** and open the **Register**.
2. **Search** for a product and tap it to add it to the cart. Use **+ / −** to change quantity.
3. If a product has options (size, add-ons, milk choice), you'll be asked to pick them.
4. Add a **discount** if needed — a peso amount (₱ off) or a percent (%). Senior/PWD and promo discounts are supported.
5. Choose the **order type**:
   - **Dine-In, Takeout, Pickup** — normal in-store sales.
   - **Manual Delivery, Grab, Foodpanda** — delivery orders (these are tracked as money owed to you until the partner pays out).
6. Tap **Place Order**.

**Out-of-stock protection:** if a product's ingredients are used up, it shows a red **"Out"** badge and **can't be added** at the register, and it's **hidden** from the customer's phone menu. You can't accidentally sell something you can't make.

**No double charges:** tapping "Place Order" twice quickly will only ever create **one** order.

## 9. From order to payment

Orders move through clear stages:

```
Pending → Preparing → Ready → Completed
```

- **Pending:** the order is placed but not yet paid or sent to the kitchen.
- **Preparing:** you send it to the kitchen. For cash, you enter the **cash received** here and the app shows the **change**. *(This is the moment the money enters your drawer.)*
- **Ready:** it's made, waiting to be handed over.
- **Completed:** handed to the customer. At this point the sale is finalized — the books and inventory update automatically.

Other actions:
- **Park / Recall** — hold an unpaid tab and bring it back later.
- **Void** (owner only) — cancel a completed order; it restores stock and reverses the accounting.
- **Refund** (owner only) — refund a completed sale.
- **Complimentary** — give an item for free (recorded at cost, with a reason).

## 10. Customer self-ordering (QR)

Each table has a **QR code**. A customer scans it, browses the menu on their phone, and places an order that goes straight to your kitchen. The owner can **pause** customer ordering anytime (e.g., when the kitchen is slammed) with the **QR Orders: OPEN/CLOSED** switch — this doesn't affect the staff register.

## 11. Inventory & stock

**Units.** You always work in **kg, L, or pcs**. (The system stores tiny units internally for recipe accuracy, but only ever shows you kg/L/pcs.)

**Day-to-day:**
- **Procurement** — add a new ingredient with its quantity and **cost**. *(Always enter a cost — this is what keeps your books accurate.)*
- **Restock** — add more of an existing ingredient.
- **Spoilage / Waste** — log thrown-away stock with a reason.
- **Recipes** — each product has a recipe; selling it automatically subtracts the ingredients.

**Smart features:**
- **Expiry tracking (FEFO)** — items can have multiple batches with expiry dates; the oldest is used first, and you get colour-coded warnings before things expire.
- **Low-stock alerts** — a badge warns you when an item runs low.
- **Excel/CSV import** — bulk-update stock from a spreadsheet, with a preview before saving.
- **Reconcile Inventory** (owner) — a one-tap button (on the Balance Sheet) that sets your book inventory value equal to what's actually on the shelf. Use it to set your **opening stock** when you first start, or to correct the books.

## 12. End-of-day stock count

When you do a physical count, the app shows **System vs Physical** for each item, highlights the difference, and records the adjustment — then locks the day.

## 13. Shifts & the cash drawer

- **Start:** opening a shift requires your starting cash (float).
- **During the shift:** the app shows your running **cash sales** — the money actually collected (counted from the moment you take payment, not only at completion).
- **End Shift:** count your drawer, enter the actual amount, and the app shows **Expected vs Actual** and the **difference (variance)**. Any difference is recorded automatically.
- **Bank deposit:** move excess cash to the bank; it's recorded for you.
- **Owner** logs out directly (no cash count needed) and is **not** included in staff hours or shift reports.
- **Logging out also clocks you out** automatically.

## 14. Reports (the back office) — owner only

All reports live under **Accounting & Ledger** and **Daily History & Shifts**. In plain terms:

### Daily History & Shifts
- **Daily Register** — today's sales overview.
- **Shift History** — every past shift, with cash variances.
- **Staff Hours** — clock-in/out records for payroll.
- **Summary Sales** — a sales breakdown by payment method, with columns: **Date, Order ID, Cash, Bank, GCash, Maya, Maribank/SeaBank, Other E-Wallet, GrabFood, Foodpanda, Manual/Direct, Total.** View it **per order** or **per day**, over any date range, and export to PDF.

### Accounting & Ledger
- **Journal** — every accounting entry (auto-recorded). Updates live as sales happen.
- **Profit & Loss (P&L)** — your income vs expenses for a date range.
- **Monthly P&L** — the same, but you can see **each month side-by-side** *and* a single-period view showing each line as a **% of revenue** and a **% of its group**.
- **Balance Sheet** — what you own (assets), owe (liabilities), and your equity, at a point in time. It always balances.
- **Monthly Balance Sheet** — month-by-month, over a date range, with the same ratio breakdowns.
- **A/R Outstanding** — money owed to you by e-wallet/bank/delivery channels, until you mark it settled.
- **A/P Payables** — money you owe (e.g., on-account purchases).
- **Profit by Category, Menu Engineering, Cashier Variance, Purchase Order suggestions** — operational insights.
- **Add Expense** — record a business expense (rent, utilities, etc.).
- **Revolving Funds** — petty-cash pools; record what you spend and top them up. (Money always comes from a real account — never from nowhere.)

> **Everything is a real accounting entry.** Sales, voids, refunds, expenses, spoilage, deposits, fund top-ups — each one posts a balanced double-entry record behind the scenes, so your books are always complete and your P&L ties to your Balance Sheet.

### About the Chart of Accounts
The system uses a professional **6-digit chart of accounts** (SAP-style), organised into Assets (1xxxxx), Liabilities (2xxxxx), Equity (3xxxxx), Revenue (4xxxxx), Cost of Sales (5xxxxx), Operating Expenses (6xxxxx), Administrative Expenses (7xxxxx), Other Income (8xxxxx), and Other Expenses (9xxxxx). Accounts are grouped as **parents and children**, which makes your reports clean and accountant-ready.

## 15. Settings (owner only)
- **QR Orders: OPEN / CLOSED** — accept or pause customer phone orders.
- **Auto Close: ON / OFF** — when ON, the system automatically closes and archives the day at midnight. When OFF, the day stays open until the owner closes it manually.

## 16. Users (owner only)
In the **Superadmin Panel**, the owner can add staff, set their roles, reset passwords, and remove accounts. Changing someone's role or password logs them out for security.

## 17. Working offline & installing the app
- **Install:** when the browser offers it, tap **Install App** for a full-screen experience.
- **Offline:** if the internet drops, you can **keep taking orders** — they're saved on the device and **sync automatically and exactly once** when the connection returns. A small indicator shows how many orders are waiting. Nothing is lost and nothing is duplicated.

---

## 18. Common tasks — quick steps

| I want to… | Do this |
|------------|---------|
| Take a cash sale | Register → add items → Place Order → mark Preparing → enter cash received |
| Pause customer QR orders | Sidebar → QR Orders → CLOSED |
| Add new stock | Inventory & Stock → Procurement (enter cost!) |
| Fix negative/opening inventory | Accounting & Ledger → Balance Sheet → **Reconcile Inventory** |
| See sales by payment method | Daily History & Shifts → **Summary Sales** |
| See month-by-month profit | Accounting & Ledger → **Monthly P&L** |
| Record an expense | Accounting & Ledger → Add Expense |
| Void a completed order | Orders → find it → Void (owner) |
| Close the day manually | Use the day-close/archive action (if Auto Close is OFF) |

---

## 19. Troubleshooting

| What you see | What it means / what to do |
|--------------|----------------------------|
| Product shows **"Out"** / missing from customer menu | Its ingredients are depleted — restock it (Procurement/Restock). |
| Can't finish an order: "Insufficient stock" | You're trying to sell more than you have — restock first. |
| Inventory shows a **negative** value | Past stock was never recorded as purchased. Use **Reconcile Inventory** once, then always record purchases with a cost. |
| "Too many requests" | You tapped too fast — wait a moment and retry. |
| A non-owner sees "Superadmin Only" | Expected — accounting, settings, and user management are owner-only. |
| Orders waiting to sync (offline badge) | Normal when offline — they'll send automatically when the internet returns. |
| Logged out after a long time | Just log in again; your session expired for security. |

---

## 20. Glossary (plain English)

- **POS** — Point of Sale; the cash-register part of the app.
- **Float / Starting Cash** — the money in the drawer at the start of a shift.
- **COGS** — Cost of Goods Sold; the ingredient cost of what you sold.
- **Inventory** — the value/quantity of ingredients you have in stock.
- **FEFO** — First Expired, First Out; oldest stock is used first.
- **A/R (Accounts Receivable)** — money owed *to you* (e.g., by Grab/GCash until they pay out).
- **A/P (Accounts Payable)** — money *you owe* (e.g., supplier bought on credit).
- **P&L** — Profit & Loss; income minus expenses.
- **Balance Sheet** — a snapshot of what you own, owe, and your equity.
- **Journal entry** — a single accounting record; every transaction makes one.
- **Variance** — the difference between expected and actual cash in the drawer.
- **Non-VAT** — registered under percentage tax (not VAT).
- **86** — restaurant slang for "we're out of this item."
- **Void** — cancel a completed order and reverse its effects.
- **Revolving fund** — a small petty-cash pool for minor expenses.

---

_This guide reflects the current version of Semivra Libellus. For setup/deployment details, an accountant can also refer to the chart of accounts and journal export. Questions about a screen not covered here can be added in a future revision._
