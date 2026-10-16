# Setup Workbook: what to put on each tab

**Get it:** Ledger → Export All → *Start from templates* → **Download all templates**. You can also link it from Google Sheets: Settings → Setup workbook from Google Sheets.
**Bring it back:** Ledger → Export All → **Import all**.

## Ground rules
- Fill only the tabs you need. **An empty tab is skipped.**
- **Row 2 is an example.** Overwrite it, or leave it exactly as it is and it is ignored.
- Dates are always `YYYY-MM-DD`. Amounts are plain numbers in pesos (no ₱ sign).
- Do not rename the column headers. The one exception is Price Tiers (see that tab).
- You only see the tabs you have permission to import. **Clients** appears for logistics only.
- Tabs are imported **top to bottom in the order below**, because later tabs refer to earlier ones (for example, a bill names a supplier).
- The workbook's own **How to fill**, **Valid Values** and **Accounts** tabs list every column, the accepted entries and the account codes.

**Moving over from existing books?** Fill these tabs:
1. Chart of Accounts (only if your books use their own codes)
2. P&L History
3. Opening Balances
4. Open Receivables
5. Open Payables
6. Open Deposits & Advances

**Opening Balances is the only tab that posts balances.** Stock, assets, open invoices, bills and deposits are registered as the detail behind it, and the import checks that each one adds up.

**Café menu products are not in this workbook.** They have their own sheet: Menu Setup → Menu Sheet.

| # | Tab | Posts to the books? | Fill it when… |
|---|---|---|---|
| 1 | Chart of Accounts | No | Your old books use their own account codes |
| 2 | Suppliers | No | Always, before bills or POs |
| 3 | Clients *(logistics)* | No | You sell on account to named clients |
| 4 | Inventory | No (stock value only) | Always: your stock count and costs |
| 5 | Price Tiers | No | Different customers pay different prices |
| 6 | P&L History | Yes, one entry per month | You want this year's reports to start with real figures |
| 7 | Opening Balances | **Yes, the balance sheet** | You are switching over from other books |
| 8 | Open Receivables | No | Customers owed you money on switch-over day |
| 9 | Purchase Orders | No | Orders already placed with suppliers |
| 10 | Open Payables | No | You owed suppliers on switch-over day |
| 11 | Open Deposits & Advances | No | Prepaid money not yet used |
| 12 | Bills | Only when approved | **New** supplier invoices to process |
| 13 | Expenses | **Yes, immediately** | Expenses to record now |
| 14 | Fixed Assets | **Yes, against cash** | Equipment and other assets you own |

`*` = required column.

---

## 1. Chart of Accounts
Only needed if your old books use their own account codes. Each row adds your account under one of the system's accounts, so the other tabs can use your codes.

| Column | What to put | Example |
|---|---|---|
| code* | Your account code, exactly as your books write it | X-1000 |
| name* | Your account name | Sample Bank - Savings |
| goesUnder* | The system account it belongs under: the code or name from the **Accounts** tab | 112000 |
| keepSeparate | **Yes** (default): its own sub-account. **No**: your code *is* that system account. Use No for Sales, Cost of Sales and Discounts. AR - Trade, Inventory and AP - Trade are always No. | Yes |

Cash, bank, receivable and payable accounts you add here are not offered at the till until you switch them on.

## 2. Suppliers
One row per supplier. A name that already exists is left alone, so re-importing a corrected sheet is safe.

| Column | What to put | Example |
|---|---|---|
| name* | Unique supplier name | Metro Beans |
| contactPerson | Who you deal with | Joy Cruz |
| phone / email / address | Contact details | 0917 555 0100 |
| paymentTerms | As their invoices say it | 30 days |
| leadTimeDays | Days from ordering to delivery, 0-90. Decides how much to buy of what they supply. Blank = default 7 | 5 |
| notes | Anything worth remembering | Delivers Tuesdays only |

## 3. Clients *(logistics only)*
One row per client. There is **no username or password column**. Each client gets a 7-day onboarding link and chooses their own.

| Column | What to put | Example |
|---|---|---|
| name* | Unique client name | Kasa Lokal |
| phone | | 0917 555 0101 |
| email | Checked. An invalid address rejects the row. | ar@kasalokal.ph |
| paymentMethod | How they usually pay (default Cash) | Account |
| creditLimit | Pesos they may owe at once. Blank = no limit; **0 = no credit** | 50000 |
| creditTermsDays | Days to pay. Blank = shop default. | 30 |
| segments | Comma-separated, used for pricing and filters | wholesale, cafe |
| contactNotes | | Invoice to accounts@ |

## 4. Inventory
One row per stock item. **Everything is per pack:** Pack and Unit describe one pack, Qty counts packs, and Cost is the price of one pack. You check a preview before it is applied. In logistics, each item also becomes a product you can sell, priced from its SRP.

| Column | What to put | Example |
|---|---|---|
| Code | Your code. Blank = assigned for you. | RM-MILK |
| Product* | The name only. The size goes in Pack and Unit. | Full Milk |
| Pack | What ONE pack holds, as a number. Blank if not sold in packs. | 1 |
| Unit* | kg, g, L, ml or pcs | L |
| Qty* | Packs counted. Blank = not counted; **0 = counted zero**. | 20 |
| Cost / pack* | What one pack costs you. **Zero cost = zero cost of sale later.** | 82 |
| SRP / unit | Selling price per kg, L or piece. Selling by the pack? Rename the column to `SRP / pack`. | 110 |
| Expiry date | YYYY-MM-DD | 2026-12-31 |
| Production date | For goods with no real expiry. Only read if Expiry date is blank. | |
| Low Stock At | Warn below this, in the unit above | 5 |
| Location | Where it is kept | Main bar |

> Logistics: a 2 L bottle sold as one unit is `Pack 2, Unit L`. It is sold and reordered as whole bottles.

## 5. Price Tiers
What each customer class pays for each product, in the same layout Pricing Control exports. After Code, Product and List Price, **add one column per tier, headed with the tier's name**. Tiers that don't exist yet are created.

| Column | What to put | Example |
|---|---|---|
| Code* | Product code (the Inventory item code for stock products) | X-1 |
| Product | Name. Only used if there is no code. | Sample Product |
| List Price | For reading only. It is not changed. | 100 |
| *Dealer Price* … | One column per tier. Rename it and add as many as you need. Blank = no tier price. | 90 |

## 6. P&L History
This year's income statement: one row per account, one column per month. **All amounts are positive**, as the statement shows them. Leave out subtotal rows (Gross profit, Net income). Each month posts on its last day.

| Column | What to put | Example |
|---|---|---|
| code* | Your code or the system's. Revenue, discount, cost and expense accounts only. | X-4000 |
| name | For reading only | Sample Sales |
| year* | | 2026 |
| jan … dec | That month's amount. Blank for months not yet closed. | 100000 |

## 7. Opening Balances
Your balance sheet on switch-over day: one row per account, **every** account, including cash, AR, inventory, equipment, AP and retained earnings. Contra accounts such as accumulated depreciation go in as negatives. If P&L History is filled, the Net Income line is left out automatically.

| Column | What to put | Example |
|---|---|---|
| code* | Balance-sheet accounts only | X-1000 |
| name | For reading only | Sample Bank - Savings |
| balance* | As the balance sheet shows it. Brackets or a minus sign for contra balances. | 50000 |
| asOf* | Date of the balance sheet. The same date on every row. | 2026-08-31 |

## 8. Open Receivables
Every customer invoice still unpaid on switch-over day. They appear in Ledger → AR & AP, aged and ready to collect. **The total should equal AR - Trade** on Opening Balances.

| Column | What to put | Example |
|---|---|---|
| customer* | A name matching a client links the debt to them | Reyes Hardware |
| invoiceNo* | Your invoice number | SI-004512 |
| invoiceDate* | Used to age the debt | 2026-08-12 |
| dueDate | When it falls overdue | 2026-09-11 |
| amountOwed* | What is **still** owed, after any part payment | 38500 |

## 9. Purchase Orders
Orders already placed with suppliers: **one row per item**, and rows with the same poNumber make one order. They arrive as open orders in Procurement. No stock moves. Put the same poNumber on an Open Payables or Bills row to link them.

| Column | What to put | Example |
|---|---|---|
| poNumber* | Your PO number, repeated on every line of the order | PO-2026-0412 |
| supplier* | Must be on the Suppliers tab | Metro Packaging Corp |
| orderDate / expectedDate | | 2026-08-01 |
| itemCode | Inventory item code, to link the line | PKG-001 |
| itemName* | What was ordered | Cartons 12x12 |
| qty* | Quantity ordered | 500 |
| unitCost* | Price each | 250 |
| notes | | August delivery |

## 10. Open Payables
Every supplier invoice still unpaid on switch-over day. They arrive **Approved** in Bills (AP), ready to pay. **The total should equal AP - Trade.** (New invoices go on the Bills tab instead.)

| Column | What to put | Example |
|---|---|---|
| supplier* | Must be on the Suppliers tab | Metro Packaging Corp |
| invoiceNo* | The supplier's invoice number | INV-88120 |
| invoiceDate / dueDate | | 2026-08-05 |
| amountOwed* | What is **still** owed | 125000 |
| description | What it was for | Cartons, August delivery |
| poNumber | The PO it was for (optional) | PO-2026-0412 |

## 11. Open Deposits & Advances
Money paid ahead that is still unused. Each row lands on the Advances screen, or as a client or supplier credit balance. Each kind should add up to its account on Opening Balances.

| Column | What to put | Example |
|---|---|---|
| kind* | Customer deposit · Customer credit · Supplier advance · Supplier credit · Employee advance | Customer deposit |
| name* | The client, supplier or employee. A customer credit or anything for a supplier **must** match an existing record. | Reyes Hardware |
| reference* | Receipt, OR or voucher number. Prevents double entry. | OR-10233 |
| date | When the money was paid (default: today) | 2026-09-15 |
| amountRemaining* | What is **still** unused | 5000 |
| note | | Deposit on October order |

## 12. Bills
**New** unpaid supplier invoices. Each arrives as **Pending** and posts nothing until you approve it.

| Column | What to put | Example |
|---|---|---|
| supplier* | Exactly as on Suppliers | Metro Beans |
| description* | What it's for | March coffee beans |
| amount* | Invoice total | 12000 |
| expenseAccountCode* | Account to charge (see the Accounts tab). Without it the bill can't be approved. | 510000 |
| dueDate | | 2026-04-15 |
| supplierInvoiceNo | Can't be entered twice | INV-88120 |
| poNumber | Optional | PO-2026-0412 |

## 13. Expenses
One row per expense. **Each posts immediately, with no approval step**, so check the sheet first. A date in a closed month is refused.

| Column | What to put | Example |
|---|---|---|
| amount* | Full amount, before any tax withheld | 3500 |
| categoryCode* | Expense account (see the Accounts tab) | 640000 |
| description* | | March electricity |
| paymentMethod* | Paid from (see the Valid Values tab) | Cash on Hand |
| date | Default: today | 2026-03-31 |
| vendor / refNo | Who was paid; their OR or invoice number | Meralco |
| withholdingRate | Percent withheld. Only read when Withholding Tax is on (rent 5, professional fees 10). | 5 |

## 14. Fixed Assets
One row per asset. **Each posts an acquisition entry against cash.** Include accumulated depreciation for used assets, or they import as brand new.

| Column | What to put | Example |
|---|---|---|
| name* | | La Marzocco espresso machine |
| class* | Name or code from the Accounts tab | Machinery & Equipment |
| acquisitionCost* | What was paid | 60000 |
| usefulLifeMonths* | 60 = 5 years | 60 |
| salvageValue | Worth at end of life | 6000 |
| acquisitionDate | Default: today. A closed month is refused. | 2026-01-15 |
| accumulatedDepreciation | Already worn off | 2700 |
| serialNumber / location / supplierName / referenceNumber | For your records | LM-77120 |

---

## Before you press Import all: checklist
- [ ] Row 2 examples overwritten or left untouched
- [ ] Suppliers (and Clients) are filled before anything that names them
- [ ] Inventory costs are filled in, not zero
- [ ] Open Receivables total = AR - Trade; Open Payables total = AP - Trade
- [ ] Opening Balances has one asOf date and includes every balance-sheet account
- [ ] Expenses and Fixed Assets checked: they post immediately
