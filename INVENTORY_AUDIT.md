# Inventory movement audit - September 2026

Every code path that changes `Inventory.stockQty` was traced (35 sites in 9
files) and checked for direction, magnitude, unit integrity, whole-unit
validation, atomicity, concurrency, idempotency, negative-stock handling,
ledger integrity, rounding and authorisation. Fixes are on branch
`audit-fixes`; tests are listed at the end with their actual results.

## Stack, as found

- MongoDB (replica set) + Mongoose; Express routes under `server/features/`.
- Stock is held per item in **base units** (`g`, `ml`, `pcs`) in
  `Inventory.stockQty`, with `unitMultiplier` (base units per display unit) and
  `packSize` (display units per pack). Conversion happens at the edge: the
  screens send base units, and imports convert on the way in.
- The movement ledger is the `StockCard` collection: one row per movement with
  `qtyChange`, `balanceAfter` and `unitCost`.
- Money routes run in a MongoDB transaction (`atomic()` / `withTransaction`).
  A read-modify-write on an item inside one is safe against lost updates: two
  writers to the same document raise a write conflict and one retries.

## Findings

| Severity | File:line (before the fix) | Path | Issue | Concrete wrong result |
|---|---|---|---|---|
| Critical | `features/inventory.js:2263, 2276, 2162` | Stock import -> auto-created product | A packed item's product sold **one display unit** per sale, not one pack | 1 can of 377 g sold took 1000 g = **2.6525 cans** (the reported case) |
| Critical | `features/orders.js` void, refund, partial refund, exchange | Reversals | Stock given back was **recomputed from today's recipe** and valued at **today's cost** | Sale took 54 g; recipe then changed to 25 g/cup; void returned 75 g. COGS reversal priced at the new cost, so the ledger drifted |
| Critical | `features/orders.js` void | Void of a combo | Combo lines were never restocked on void | Voiding a ₱199 bundle left its components deducted |
| High | `features/orders.js` partial-fulfill | Partial fulfilment | Used the 1:1 code/name link only - **ignored recipes and add-ons** | A bundle, or any product named apart from its stock, left the warehouse with **no stock deducted** |
| High | `features/admin-tools.js:604` | Backdated sale | Same 1:1-only logic | Backdated recipe product deducted nothing, or the wrong item |
| High | `features/purchase-orders.js:426, 699` | PO receive / purchase return | A line with no `packSize` defaulted to **one display unit** instead of the item's pack | Imported PO "FILTER 250G x 10" received **10 kg** instead of 2.5 kg |
| High | `features/hub.js:568` | Inter-branch transfer | Sender's release call made **inside** the receiver's open transaction, failure **swallowed**, never retried | Call fails: goods counted at both branches. Commit fails after call: goods gone from both |
| High | `features/hub.js:584` | Inter-branch release | Sender stock floored at 0 while the stock card recorded the full quantity | On hand 2, shipped 5: balance 0, card -5; card and balance disagree by 3 |
| High | `features/inventory.js:775` | Stock transfer | No check that source and destination use the **same base unit** | 500 g of beans could arrive as 500 ml or 500 pieces |
| Medium | `features/inventory.js:778` | Stock transfer | Availability ignored `reservedQty` | Stock held for a client's order could be moved away |
| Medium | `features/orders.js:955` | Order creation (logistics) | Fractional quantities accepted (amend already refused them) | 1.5 cartons -> 1.5 packs deducted |
| Medium | `features/orders.js` partial-fulfill | Partial fulfilment | Fractional units accepted per round | 0.5 of a carton fulfilled |
| Medium | `features/orders.js:1911` | Order completion | A line missing price/quantity **returned a plain object** from the handler | Request hangs; transaction left open until timeout |
| Medium | `features/orders.js` sale engine | Sale | Sale stock-card rows recorded **no unit cost** | Stock card shows ₱0.00 cost on every sale |
| Medium | `server.js` StockCardSchema | Movement ledger | Stock card **not append-only**; nothing checked stock = sum of movements | A row could be edited or deleted; drift went unnoticed |
| Medium | `features/inventory.js:948` | Manual item creation | Opening quantity wrote **no stock-card row** | Item's history never summed to its balance |
| Medium | `features/inventory.js:1637` | Delete expiry batch | Balance floored at 0 but card/journal took the whole batch; valued at batch cost, not average cost | Card -12 while balance fell 5; inventory value drifted from the ledger |
| Low | `features/orders.js` partial-fulfill | Partial fulfilment | Did not consume expiry batches (FEFO) | Batches overstated after fulfilment |
| Low | `lib/idempotency.js` | Offline / double click | Explicit key remembered 60 s, in memory | Not a stock risk: orders carry a durable unique `idempotencyKey`, and completion/void refuse a second run. Noted for multi-instance deployments |

### Paths checked and found correct

- **Sale / completion:** conditional atomic decrement (`stockQty - reservedQty >= qty`) in one transaction; a short ingredient aborts the whole sale. N+1 on products already batched; ingredient updates are one per line (bounded by recipe size).
- **Local stock transfer release:** one transaction, -q/+q, both stock-card rows.
- **EOD count, waste/spoilage, production approve/reconcile, fund-paid restock:** transactional, stock-card rows written, conversion done at the screen with the item's pack.
- **Un-void:** replays the void's own stock-card rows (exact).
- **Offline queue:** only order creation is queued, and it is protected by a unique `idempotencyKey`.
- **Authorisation:** every stock-changing route is permission-gated server-side (`inventory.manage`, `inventory.count`, `inventory.waste`, `orders.*`, superadmin for imports and batch edits).

## Fixes

1. **Record what a sale took** - `Order.stockMoves` (new field, `server.js`):
   `{ invId, qty, unitCost, lineIndex }` per stock item, written by completion,
   every partial-fulfilment round and backdated sales. `lib/stockMoves.js`
   builds it and works out what to give back.
2. **Reverse exactly that** - void, full refund, partial refund and exchange
   return use `restoreStockMoves()` (`features/orders.js`): quantities from the
   record, valued at the sale-time cost, with the item's average cost
   re-blended in the same atomic pipeline update so stock value keeps tying to
   the Inventory account. Orders from before the field existed use the old
   recipe path.
3. **One pack per unit** - `basePerPack()` in `lib/units.js`
   (`packSize x unitMultiplier`, rounded to 6 dp) used by the import's product
   creation, `baseUnitsPerSale`, PO receiving and purchase returns. A one-time
   startup repair (`repairPackRecipes`, flag `packRecipeFixV1`) corrects
   products the old import created; hand-written recipes are left alone.
4. **Partial fulfilment and backdated sales** use the recipe (size recipe,
   base recipe, add-ons), falling back to the 1:1 link only with no recipe.
5. **Hub transfers** - the release call runs after commit and is retried by a
   sweep (on accept + every 10 minutes) until the sender confirms
   (`CrossTransfer.releaseConfirmedAt`, new). The sender records exactly what
   left.
6. **Transfers** refuse mismatched units, fractional pieces, and reserved stock.
7. **Whole units** for logistics order lines and fulfilment rounds.
8. **Stock card is append-only** (same guard as the journal); purge, restore
   and tests declare maintenance. **Books Health** gains "Stock card vs stock
   on hand", listing every item whose balance differs from its movements.
9. Sale stock-card rows carry `unitCost`; manual item creation writes an
   opening row; batch deletion records one consistent quantity at average cost;
   the hanging response on a malformed line is fixed.

## Unit conversion

`lib/units.js` already had a typed registry (`UNIT_TABLE`, `UNIT_TO_BASE`,
`unitTypeOf` separating mass / volume / count). Added `basePerPack`. Cross-
category moves are now refused at the transfer boundary; recipes and sales
never convert across categories.

**Precision policy:** base units, rounded to 6 decimal places on every write
(`roundQty`, `+x.toFixed(6)`, `$round: [.., 6]` in the pipeline update). A
10,000-step run of 0.1 increments lands exactly on 1000 (test below).

## Schema changes (no migration script needed)

| Change | Where | Existing data |
|---|---|---|
| `Order.stockMoves[]` | `server.js` OrderSchema | Absent on old orders -> old reversal path |
| `CrossTransfer.releaseConfirmedAt` | `server.js` | `null` -> the sweep re-asks; the sender answers "already released" |
| Stock card append-only hooks | `server.js` StockCardSchema | No data change |
| Product recipe repair | startup, flag `packRecipeFixV1` | Runs once |

MongoDB has no check constraints; non-negative stock is enforced by the
conditional update on the sale path.

## Negative-stock policy (as it stands)

- **Blocked:** sales, partial fulfilment, backdated sales, waste, transfers,
  production - each refuses rather than going below zero.
- **Allowed, deliberately:** returns and voids (they only add), and the hub
  sender's release (the goods have physically left; a negative balance flags
  the shortfall for a count rather than hiding it).
- **Not configurable today.** Making it a setting (block / allow with flag) is
  listed under residual risks.

## Tests - actual results

| File | What it proves | Result |
|---|---|---|
| `lib/stockUnits.unit.test.js` | kg/g and L/ml boundaries (0, 1 base unit, very large, tiny); category separation; one pack = packSize x multiplier; float noise; line-share returns; 10,000-step rounding | 12/12 pass |
| `test/inventory-audit-fb.integration.test.js` | 3 lattes = 54 g + 600 ml; add-on; stock moves recorded with cost; **multi-ingredient rollback**; **void after recipe change returns the original 54 g**; COGS reversed at sale cost; full and partial refund; **5 tills racing for the last cup - exactly one succeeds**; **same Idempotency-Key -> one order**; double completion deducts once; **property test** - 40 random sales/voids/refunds/waste, every item's stock = sum of its stock card and Books Health agrees; stock card refuses edits | 13/13 pass |
| `test/inventory-audit-log.integration.test.js` | 1 can = 377 g; **1.5 cans refused**; **PO line with no pack receives 24 cans, not 24 kg**; **transfer net zero**; unit mismatch refused; reserved stock refused; **bundle via partial fulfilment deducts and a void restores**; half-unit fulfilment refused; backdated bundle uses the recipe | 9/9 pass |
| `test/packed-item-sale.integration.test.js` | The reported condensed-milk case, 3 packs, plain pieces, 1 kg bags; the startup repair fixes old products and leaves hand-made recipes | 5/5 pass |
| Whole server suite | | **222 files, 2374 tests, all pass** |
| Client unit tests + build | | 148 pass; build OK |

Not run: a test with the fixes reverted to show each new test failing on the
old code (the condensed-milk test was run first and did fail: 1000 g taken for
one can). The inter-branch retry needs two live servers and has no automated
test; its idempotency relies on the sender's existing "already released" check.

## Residual risks and trade-offs

- **Negative stock is block-only for sales.** A rush-hour policy of "allow and
  flag" would keep the till moving when a count is behind, at the cost of
  COGS booked against stock that is not there. It needs a setting and a
  reconciliation queue; not built.
- **Reversals of orders from before this change** still use the recipe. Voiding
  one after its recipe changed can return a different amount. Those orders age
  out; the Books Health stock-card check will show any drift they cause.
- **Exchange replacements** deduct stock but are not added to `stockMoves`, so a
  later return of the replacement goes through the recipe path.
- **Partial fulfilment** does not release a client reservation before deducting
  (a full sale does), so a reserved order fulfilled in rounds can be refused
  for stock its own hold is keeping.
- **Concurrency** relies on MongoDB write-conflict detection inside
  transactions plus the conditional decrement on sales. That is correct on a
  replica set; on a standalone dev database (no transactions) the read-modify-
  write paths (count, waste, receiving) can lose an update under concurrent use.
- **In-memory request de-duplication** is per process; behind several server
  instances two double-clicks could both proceed on routes without a durable
  key (not order creation).
- **Your data:** `BISCOFF LOTUS CRUMBS 750 G` has Pack 7 g (should be 750 g),
  and 12 raw-material rows have no Pack/Unit. Fix them in the sheet before the
  next import.
