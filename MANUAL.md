# Semivra Libellus — Complete Manual & Tutorial

_Covers both deployment modes: **F&B** (cafe / restaurant POS) and **Logistics** (client ordering, delivery, procurement) · Last updated 2026-09-17_

This document has two parts:
- **Part A — Quick-Start Tutorial:** the shortest path to taking your first order and closing your first day.
- **Part B — Full Reference Manual:** every screen, workflow, and rule explained.

> **Roles at a glance.** The app has two kinds of users:
> - **Owner / Superadmin** — full access: accounting, users, settings, voids, reports. Not counted as a tracked employee (excluded from staff hours, shift history, and cashier variance).
> - **Staff / Cashier / Manager** — day-to-day POS, orders, inventory, their own shift. Locked out of accounting, user management, and other superadmin-only areas (these show a "Superadmin Only" lock).

> **Two modes, one system.** A deployment runs as either **F&B** or **Logistics**. The register, inventory, shifts, and accounting work the same way in both. Logistics adds client accounts, quotations, and delivery scheduling; F&B adds table service and QR self-ordering. Sections below that apply to one mode only say so.

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
- **Completed:** delivered/closed — this is when the **revenue + COGS journal entries** post and inventory deducts. A **receipt number (OR No.)** is issued here too (see §14).
- **Partially Delivered:** for multi-item orders where some items are handed over now and the rest follow ("Give Partial — More Items Coming"); ERP posts on final completion.
- **Park / Recall:** save an unpaid tab ("Park") and bring it back later from the parked list.
- **Complimentary:** zero-charge order (booked at cost, not selling price), with a required reason. No receipt number is issued — nothing was sold.
- **Void (owner only):** reverses a completed order — restores stock and posts reversing journal entries. Use instead of editing a completed order (completed orders are locked).
- **Refund (owner only):** posts a reversal journal for a returned/refunded sale. A **partial refund** keeps the order Completed and reduces what the customer still owes.

**Amending an order (when the customer changes their mind)**
- An order that has been placed but **not yet completed** can be amended: change quantities, add lines, remove lines.
- A **reason is required**, and every amendment is kept as a numbered **revision** on the order, so the original and each change remain visible.
- **Completed orders cannot be amended** — use a refund for returned or excess items. Cancelled, voided, and refunded orders can't be amended either.

## 4. QR self-ordering (customers) · F&B

- Each table gets a **QR code** (generate from the POS). Scanning opens the customer menu on the guest's phone.
- The guest builds an order against a **secure, single-use, time-limited session**; placing the order burns the session.
- Orders flow into the same kitchen queue. A "your order is ready" notification can be pushed to the guest.
- The owner can **open/close QR ordering** globally with the **QR Orders: OPEN/CLOSED** toggle (kitchen-busy switch). Staff POS is unaffected by this toggle.
- **Self-service prices are enforced from the catalogue.** A price sent from a customer's own device is ignored; staff may override a price at the counter, and that override is recorded in the audit log.

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

**Stock reservations**
- Hold stock for a client who has committed to buy it but has not collected yet. Reserved stock stays in inventory but is **not available to sell to anyone else**.
- A reservation can carry an **expiry date**; once it passes, the hold is released automatically and the stock goes back on sale. The sweep runs when the Reservations panel is opened and again at the nightly close.
- Releasing, cancelling, or fulfilling a reservation all log against the client it was held for.

**Excel / CSV bulk import & stock-take**
- **Import** an `.xlsx/.xls/.csv` to bulk onboard or reconcile stock. Standard header: `Code, Product, SRP, Qty Unit, Unit Cost, Expiry date` (older formats still accepted).
- A **preview modal** shows a colour-coded diff (NEW / ↑ / ↓ / SAME / ERROR) before you commit.
- Differences post adjustment journals automatically (gain or variance), and every row writes a stock-card entry.
- Use the **Template** button to download a sample file.

**Low-stock alerts.** Set a per-item threshold; the sidebar and table badge items at or below it.

**Importing a menu sheet** · F&B

Menu Setup → **Read Menu Sheet** takes a spreadsheet of drinks written the way a bar writes them:

| Category & Name | Base & Extra Size | *(ingredient)* | *(quantity)* | … | Price |
|---|---|---|---|---|---|
| Long Black | 8oz Hot | `G60004/G60008` | `1/1` | … | 100 |
|  | 12oz Iced | `G60001/G60006` | `1/1` | … | 120 |

- **A row is one size.** A row with no name in the first column is another size of the drink above it, with its own price and its own recipe.
- **A name on its own row is a category heading** for everything beneath it.
- **Ingredients come in pairs of columns:** identifiers on the left, quantities on the right, matched left to right. `G10002/Water` with `20g/35ml` means G10002 is 20 g and Water is 35 ml.
- **An identifier that is a stock code is that inventory item**; anything else is recorded as a non-stock line — measured in the recipe, never deducted, never costed.
- **No unit means pieces.** `1/1` against a cup and a lid is one of each.
- Nothing is written until you have seen the preview. Anything the sheet does not say clearly — a quantity with no ingredient beside it, two quantities for one ingredient — is **listed and left out**, never guessed at.

> Watch for Excel turning `1/1` into a date. The importer recovers those (the two numbers survive inside the date), but it is worth formatting those columns as text in the sheet.

## 6. End-of-Day (EOD) inventory count
1. Open the **EOD / count** flow.
2. Enter the **physical count** for each item in display units (kg/L/pcs).
3. The app shows **System End vs Physical**, movement (Start / In / Out), and **variance** per item.
4. Submit to record the count and **lock** the day.

> **This is also how you correct a wrong stock figure.** Don't edit the number directly — a count posts the difference to Spoilage, Variance & Waste, which is what keeps the ledger tied to the stock.

## 7. Shifts & cash control

- **Start:** opening a shift requires the **starting float** (staff).
- **During the shift:** the running **cash sales** total reflects cash that has actually entered the drawer — i.e. **completed cash sales plus paid in-progress orders** (cash tendered at the Preparing step). An order still sitting as *Pending* (not yet paid) shows ₱0 until it's taken — that's correct.
- **End Shift:** count the drawer, enter actual cash, review **Expected vs Actual** and the **variance**. A non-zero variance posts a **Cash Short/Over** journal entry.
- **Bank deposit:** move excess drawer cash to the bank (keeps the starting float); posts a journal entry.
- **Pay-out from the drawer:** money taken out of the till for a small expense is filed as an expense, not lost as a variance.
- **Shift History (owner):** full ledger of past shifts with variance colours. **X-Reading** prints a mid-shift summary PDF without closing the register.
- **One shared drawer:** where several people ring on a single till, switch **One Shared Cash Drawer** on in Settings. The float is declared once by whoever opens up, instead of each cashier declaring the same money again.

> **Owner note:** the owner/superadmin is **not** treated as a cashier. Owner shifts and clock entries are hidden from **Shift History**, **Staff Hours**, and **Cashier Variance**.

## 8. Staff time tracking
- **Clock In / Out** (and break) from the sidebar; the app tracks worked minutes for payroll.
- **Staff Hours (owner):** paginated list of clock entries by staff and date. The owner is excluded.

## 9. Clients & receivables

For customers who buy **on account** rather than paying at the counter.

- **Client accounts** carry a client code, contact details, payment terms (in days), a credit limit, and — for a VAT-registered buyer — their **registered name, TIN and registered address**, which must appear on the invoice or they cannot claim the VAT they paid you.
- **Credit limits** can be off, per-client, a single global figure, or both. Only on-account orders count against a limit; cash sales settle immediately and are never blocked.
- **Deposits / advances:** money a client pays ahead of any order. It offsets what they owe and is drawn down as orders complete.

**Statement of account**
Open **Clients**, expand a client, then **Statement of account**.
- Choose the period (defaults to this month). It shows the **balance brought forward**, then every charge and payment in date order with a **running balance**, and the **amount due** at the end.
- Refunds appear as their own credit line, so a client can see *why* the balance dropped.
- **Ageing** (current / 31-60 / 61-90 / 91+) is shown as at the statement date, and any deposits held are netted off.
- **Print** produces it on your letterhead, with the client's TIN and registered address when you hold them.

**Collections.** The A/R views, the collections worklist and the client's own statement all read the same balance: the invoice less anything refunded and anything already collected.

## 10. Procurement — suppliers, purchase orders & returns

**Suppliers.** Name, contact, terms, and — for a VAT-registered supplier — their **TIN and registered name**. Each supplier can hold a price catalogue, and the **Compare Prices** panel shows who is cheapest per item.

**Raising an order**
- A **new** purchase order is filed as a **Requisition Slip** first. It becomes a real PO once approved (Ledger → Approvals), so nobody orders on the company's account without sign-off.
- Each line is one of three kinds, and the choice decides where it lands in the books:

| Line kind | Goes to | Owes |
|---|---|---|
| **Stock** | Inventory | Trade payable |
| **Equipment** | Its asset class, and the asset register (depreciable from day one) | Non-trade payable |
| **Service** | The expense account you choose | Non-trade payable |

- **Prepaid orders:** paying before the goods arrive is *not* a payable — nothing is owed, the supplier owes you a delivery. It books a **supplier advance**, and receiving draws that advance down. No bill is raised for the part already paid for.

**Receiving**
- Enter what actually arrived, per line. A short delivery leaves the PO open so a follow-up delivery can top it up.
- **Expiry or production date** is captured per line at receiving time — the real delivery's date, not whatever was guessed on the draft.
- **Supplier charged VAT:** tick to claim the input VAT. The VAT is split out and held separately, so stock is never carried at a VAT-inclusive cost.
- Receiving posts the stock and raises the supplier's bill for whatever is actually still owed.

**Returning goods to a supplier**
Procurement → the PO → **Return**.
- Pick the lines and quantities, and give a **reason** (required — a return with no reason can't be explained to the supplier or to an examiner).
- The stock leaves at the cost it came in at, and any input VAT claimed on it is given back.
- The money side follows where the money actually is: a **prepayment** is restored first, then any **unpaid invoice** shrinks, and only the remainder becomes **credit the supplier holds** for you.
- You can't return more than arrived, return the same goods twice, or return stock that is no longer on hand.

## 11. Production batches

Turning materials into something else — a sub-recipe, a repack, a finished good.

1. **File the batch:** choose the materials and quantities, then what it produces (an existing item, or a brand-new one) and how much.
2. **Approve** it.
3. **Reconcile:** enter what *actually* came out. This is what gets added to stock — not the planned figure — so the recorded unit cost reflects the real yield.

> **Units — read this one.** A batch is counted in whatever unit you think in: **ml, L, g, kg, pcs**. Whatever unit you plan in, the reconcile step **asks for the yield in that same unit**, and shows a dropdown if you want to count it differently. Switching the unit re-states the number already in the box, so the figure on screen always means what the label beside it says.
>
> Check the unit label before typing. "1700" against **ml** is 1.7 litres; "1700" against **pcs** of a 1-litre carton is 1,700 litres.

- **Moisture loss / variance:** the gap between planned and actual is recorded, with the percentage, so a consistently short yield is visible rather than lost.
- A batch that yields less than planned is marked **Partial**; meeting or beating the plan marks it **Complete**.

## 12. Payroll

Off by default — switch **Payroll** on under Settings → Accounting modules.

- **Employee statutory numbers** live on the staff record (Superadmin → Users → edit): **SSS, PhilHealth, Pag-IBIG, TIN**, and an employee number. Fill these in before the first payslip.
- **A run** is filed as a draft — gross pay and each deduction per employee. Nothing posts until it is **approved**; approving books the wages and holds each deduction in its own liability account. **Paying out** discharges what is owed to staff; the deductions stay held until each agency is paid.
- The statutory numbers are **copied onto the run when it is created**, not read back later — so correcting a number next year never rewrites payslips already issued.
- **Payslips** print per employee, on your letterhead, showing each deduction against the number it is remitted under.
- **Remittance** (the Remittance button) breaks the period's total down **per employee, under their own account number**, for SSS, PhilHealth, Pag-IBIG and withholding tax — which is what each agency actually asks for. It names anyone whose number is missing, before the filing goes out.

## 13. Accounting & Ledger (owner only)

Everything that moves money or stock posts a **balanced double-entry journal entry** automatically. The Ledger tab carries around three dozen sub-views, grouped in the sidebar. The ones you'll use most:

| Sub-tab | What it shows |
|--------|----------------|
| **Journal** | Every journal entry (paginated), with CSV export |
| **P&L** · **Monthly P&L** | Profit & Loss over a range — revenue, COGS, OpEx, gross/net margin |
| **Balance Sheet** · **Trial Balance** | Assets / Liabilities / Equity, with a balanced-equation check |
| **Chart of Accounts** | Every account, and where each one is used |
| **A/R Outstanding** | Non-cash sales awaiting settlement — **Settle** each one |
| **A/P Payables** · **Bills** · **Supplier Payments** | What you owe, and paying it |
| **Collections** | The chase list for overdue receivables, including checks |
| **Approvals** | Requisition slips awaiting sign-off — approving one creates the PO |
| **Expenses** | Record and review operating expenses |
| **Revolving Funds** | Petty-cash pools (see below) |
| **Sales by Payment** · **Sales Summary** | Sales broken down by method and by line |
| **Profit by Category** · **Menu Engineering** | Margin per category; Stars / Plowhorses / Puzzles / Dogs |
| **Cashier Variance** · **Commissions** | Drawer variance and seller commission per person |
| **VAT Return** · **Percentage Tax** | Both are listed; only one applies to you, and the other says so rather than showing a page of zeroes — see §14 |
| **Books Health** | Tie-out checks — see below |
| **Accounting Periods** | Close a month so nothing can be posted back into it |
| **Export All Data** | Full backup — see §15 |

All the report tables are **paginated** (10 rows per page).

**Accounting rules to know**
- **Cash vs A/R.** Only physical **cash** hits Cash on Hand immediately. Bank transfer, GCash, Maya, e-wallet, Grab, Foodpanda, on-account and manual delivery all book to **Accounts Receivable** until you settle them (choose where the money was deposited).
- **Balanced guarantee.** Every entry is asserted to balance (debits = credits) before it's saved.
- **Refunds reduce what is owed.** A partial refund on an on-account sale credits A/R, and every view of that debt — ageing, credit limit, collections, the client's statement — reads the reduced figure.

**Books Health.** A set of tie-outs that check each subledger against its ledger account: receivables, payables, inventory, customer deposits, client and supplier credit balances, employee and supplier advances, petty cash, checks on hand, and the accounting equation itself. Every line should read **0 difference**. A non-zero line names what disagrees so it can be chased.

**Revolving / petty-cash funds**
- **Create a fund:** name, initial amount, and **Paid From** (Cash on Hand or Cash in Bank) — the chosen account is credited in the opening entry, so the float comes from a real source, not thin air.
- **Out (disburse):** log a small expense paid from the fund (`DR Expense / CR Petty Cash`).
- **In (replenish):** top the fund back up from a chosen cash account.
- **History:** per-fund transaction ledger, paginated.

**Check vouchers** — *Reports → Payable → Check Vouchers*

The document you sign for money going out, and the file that "money out" reconciles against. One is issued **automatically** whenever money actually leaves a cash, bank or e-wallet account:

| What happened | Voucher purpose |
|---|---|
| Paid a supplier's bill | bill-payment |
| Paid staff (payroll pay-out) | payroll |
| Paid an expense | expense |
| Bought or restocked inventory with money | expense |
| Opened or topped up a petty-cash float | petty-cash |
| Spent out of a petty-cash float | petty-cash |
| Issued an advance, or prepaid a PO | advance |
| Refunded a client's credit balance | client-credit-refund |

- **Nothing left the drawer, no voucher.** An expense or a stock purchase put *on account* raises a payable and pays nobody; the voucher comes later, when that bill is paid.
- **Petty cash counts.** The float is a cash account like any other, so both topping it up and spending from it are documented.
- **Print** produces it on your letterhead with the payee, amount, account it came out of, check/reference number, purpose, journal reference, and three signature lines — prepared, approved, received.
- **Void** requires a reason. A voided voucher still prints, with the void reason on its face, because the cancellation has to be filed too.
- **Money coming back the other way is not a voucher.** A supplier returning an overpayment is a *receipt*, not a disbursement. Record it at **Procurement → Suppliers → Refunded to us** (it shows on the supplier's row whenever they hold credit of yours): choose which account the money landed in, and the credit clears. No voucher is issued, because nothing left.

## 14. Tax, receipts & document numbering (owner only)

**VAT — on or off.** Settings → VAT.
- **Off (the default):** sales are reported under the **3% percentage tax**, and receipts show "NON-VAT REGISTERED".
- **On:** the VAT you collect is held as **Output VAT** rather than counted as revenue, the VAT you pay on purchases can be claimed as **Input VAT**, and the **VAT Return** view shows what is payable. Set the **rate** (12% is standard here), whether your prices are **VAT-inclusive or exclusive**, your **VAT registration TIN**, and whether **delivery fees carry VAT**.
- **SC/PWD:** a senior-citizen or PWD discount also exempts that sale from VAT. The **cardholder's name and ID number are required** before the sale can complete — after the customer has left, nobody can supply them, and a discount with no name on it is disallowed.
- Changing any of this affects **new orders only**. Receipts already issued keep the rate they were rung up under.

**Receipt registration (BIR).** Settings → Receipt registration.

| Field | What it is |
|---|---|
| **ATP / Permit no.** | From your Authority to Print or Permit to Use — printed on every receipt |
| **Machine ID / serial** | The machine receipts are issued from — printed on every receipt |
| **Receipt serial prefix** | e.g. `OR`, giving `OR-00001251` |
| **Continue serials from** | The number your registered series is already up to |

- A **receipt number is issued when a sale completes** — an unfinished or cancelled order never had a receipt, and spending a serial on one would leave a gap you'd have to explain.
- **Set "Continue serials from" before your first sale.** It **locks permanently** once the first receipt is issued: moving it afterwards would renumber receipts already in customers' hands, or skip a block nobody can account for.
- **Settings warns you while there is still time.** Until these are filled in, a banner at the top of Settings lists what is outstanding, flagging the serial start number as the one with a deadline. Once the first receipt is issued it stops offering it — there is no longer anything you can do about it — and says how many receipts the series has run.

**Document numbering.** Settings → Document numbering. Every document a person actually holds has its own prefix, each shipped with a sensible default and a live sample of what it prints:

Order · Billing statement · Official receipt · Quotation · Purchase order · Supplier's bill · Check voucher · Advance · Payroll run.

> Renaming a series changes what **future** documents are called. It never renumbers anything already issued and never restarts a sequence — each series keeps counting where it was, under its new name.

## 15. Backup & restore (owner only)

- **Full backup** exports every record in the system to a single workbook — orders, inventory, clients, suppliers, the ledger, settings, everything. A progress bar shows it working; large databases are fetched in pages rather than in one go.
- **Restore** takes that workbook back in. It asks you to type `RESTORE` to confirm, checks the file came from the same kind of business, and replaces what is there.
- Login sessions and QR ordering sessions are deliberately **not** included — they are short-lived tokens that should die with the old database.

> Take a backup before anything irreversible: a bulk import, a purge, an upgrade.

## 16. Settings (owner only)

| Setting | Effect |
|--------|--------|
| **Time zone** | The business's own clock. Decides which day a sale belongs to, when the day locks, and what a daily report covers — whatever timezone the server itself runs in. Change it between trading days |
| **QR Orders: OPEN / CLOSED** | Globally accept or pause customer QR orders (staff POS unaffected) |
| **Auto Close: ON / OFF** | When ON, the system auto-cancels hanging orders, archives the day, and locks the register at **midnight on the business clock**. When **OFF**, the day stays open and you must **archive/close manually** |
| **Require Cash Shift on Login** | Whether staff must declare a float before starting |
| **One Shared Cash Drawer** | One float for the shop's single till, instead of one per cashier |
| **Product Images** | Show product images across the menu, portal and lists |
| **VAT** | See §14 |
| **Receipt registration / Document numbering** | See §14 |
| **Accounting modules** | Switch **Bank Reconciliation**, **Withholding Tax** and **Payroll** on or off. A module that is off hides its screen and posts nothing |
| **Credit limits** | Off / per-client / same for all / both |
| **Branding** | Logo, logo background, corner radius, payment QR |
| **Letterhead & print size** | What appears on printed documents, and the paper size |

**Manual day-close / archive.** The archive sweep force-cancels any hanging orders — **Pending, Preparing, Ready, and Parked** (held unpaid tabs) — then archives the day so cancelled and parked orders are never left dangling.

## 17. Superadmin Panel (owner only)
- **Users:** create staff, set roles, reset passwords, delete accounts. (Role/password changes log that user out.)
- **Commission rate:** percent of a cashier's own attributed sales, shown on the Commissions report.
- **Payroll & statutory numbers:** employee number, TIN, SSS, PhilHealth, Pag-IBIG — see §12.
- **Roles:** manage the role list and per-role permissions.
- Search, filter, and batch-update users.

## 18. Devices, offline & install
- **Tablet-first.** Touch targets, layouts, and contrast are tuned for tablets (e.g. Amazon Fire).
- **Install as app:** when the browser offers it, use **Install App** for a full-screen PWA.
- **Offline-first:** if the connection drops while placing an order, it's **queued locally** and **auto-syncs** when you're back online — you won't lose the sale.
- **Receipts/printing:** kitchen tickets and receipts print to a connected thermal printer. Receipts carry your letterhead, TIN, permit and machine ID where set, the OR number, and any delivery details.

---

## 19. Common tasks — step by step

**Void a completed order (owner)**
Orders → find the completed order → **Void** → enter reason. Stock is restored and reversing entries post. (You can't void an already-settled A/R order.)

**Change an order the customer just placed**
Orders → the order (not yet completed) → **Amend** → adjust quantities or lines → enter a reason. The change is kept as a numbered revision.

**Settle a delivery / e-wallet sale (owner)**
Ledger → **A/R Outstanding** → **Settle** on the order → confirm amount and the deposit account. Posts `DR cash / CR A/R`.

**Send a client their statement**
Clients → expand the client → **Statement of account** → pick the period → **Print**.

**Send goods back to a supplier**
Procurement → the PO → **Return** → pick lines and quantities → enter a reason. The stock, the VAT and what you owe all move together.

**Print a check voucher for signing**
Reports → Payable → **Check Vouchers** → **Print** on the row.

**Record an expense (owner)**
Ledger → **Add Expense** → amount, category, paid-from (or On Account), vendor, date.

**Reorder stock**
Ledger → **Purchase Order** → **Generate** → review suggested quantities → **PDF** to send to your supplier.

**File this month's SSS / PhilHealth / Pag-IBIG**
Payroll → **Remittance** → pick the agency and the period. Every employee's share, under their own number.

**Correct a wrong stock figure**
Inventory → **EOD / count** → enter the true physical count. The difference posts to variance; don't edit the number directly.

**Find stock that a production batch got wrong**
From `server/`: `node scripts/audit-production-units.mjs` lists batches whose yield looks like it was counted in the wrong unit, worst first. Add `--count-csv` for a sheet to take to the shelf: which items to count, in the unit the count screen asks for, with what the figure should come to. Read-only — it changes nothing.

**Pause customer QR ordering when slammed (owner)**
Sidebar → **QR Orders** → toggle to **CLOSED**. Switch back to **OPEN** when ready.

**Keep the register open past midnight (owner)**
Sidebar → **Auto Close** → toggle **OFF** (confirm). Remember to archive the day manually.

---

## 20. Troubleshooting

| Symptom | Cause / fix |
|--------|-------------|
| Login fails / immediately logs out | Server `ALLOWED_ORIGINS` must list the exact frontend URL. Check with the deployer. |
| "Restoring session…" then login screen | Session expired or was revoked — log in again. |
| Shift cash shows ₱0 after a sale | The order is still **Pending** (cash not yet collected). Send it to **Preparing** and enter cash tendered. |
| A non-superadmin sees "Superadmin Only" locks | Expected — accounting, users, settings, voids are owner-only. |
| Order won't change after Completed | Completed orders are locked by design — use **Void**, **Refund**, or amend it before completion. |
| "Too many requests" | Rate limit hit (e.g. rapid retries) — wait a moment and retry. |
| Excel import shows ERROR rows | Fix the flagged rows (bad qty/unit/cost) and re-import; the preview won't commit errors. |
| A production batch added far too much stock | The yield was typed against the wrong unit. Check the unit label beside the box (§11), then correct the stock with a physical count. |
| Can't change "Continue serials from" | Correct — it locks once the first receipt is issued (§14). |
| Books Health shows a non-zero difference | A subledger disagrees with its ledger account. The line names which one; the usual causes are a manual journal entry or an import posted directly to a controlled account. |
| A day's sales landed on the wrong date | Check Settings → **Time zone**. It decides which day a sale belongs to. |
| "Open" on another branch goes nowhere | That branch's **app** address is unknown, so the link is guessed from its API address. Set `HUB_APP_URL_PATTERN` on the server (e.g. `https://{slug}.semivra.app`) to the address staff actually use. |
| Sale won't complete: asks for a cardholder name | An SC/PWD discount needs the cardholder's name and ID before completion (§14). |

---

## 21. Glossary
- **COGS** — Cost of Goods Sold (recipe ingredient cost of items sold).
- **FEFO** — First Expired, First Out (oldest-expiry batch consumed first).
- **A/R** — Accounts Receivable (money owed to you).
- **A/P** — Accounts Payable (money you owe, e.g. on-account purchases).
- **EOD** — End of Day (inventory count + register lock).
- **X-Reading** — mid-shift sales summary that does **not** close the register.
- **Variance** — Actual cash counted minus expected cash.
- **Float / Starting Cash** — the cash you start a shift with.
- **Non-VAT** — registered under percentage tax, not VAT.
- **Output VAT** — VAT you collected on sales and owe to the BIR.
- **Input VAT** — VAT you paid on purchases and can claim against output VAT.
- **OR No.** — the serial number on the registered official receipt for a sale.
- **ATP / PTU** — Authority to Print / Permit to Use, the registration your receipts are issued under.
- **Debit memo** — the record of goods sent back to a supplier and the credit due for them.
- **Check voucher** — the document authorising and recording a payment out of a cash or bank account.
- **SOA** — Statement of Account (what a client owes, and how it got there).
- **Advance** — money paid before the goods or service: a client's deposit to you, or your prepayment to a supplier.
- **Reservation** — stock held for a client and unavailable to sell to anyone else.
- **Requisition slip** — a purchase request awaiting approval; becomes a PO once approved.

---

_Questions about a workflow not covered here, or a screen that behaves differently? Note the exact screen and step and it can be added to this manual._
