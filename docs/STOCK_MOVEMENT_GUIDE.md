# Stock Movement: quick guide

**Where:** Analytics, in the **Stock movement** section above the Reorder Forecast.
**Who:** anyone who can view Analytics. Only someone with stock setup permission can change the thresholds.

## What it does
It shows, for each stock item, how fast the item sells over a period you choose. It labels each item **Fast-moving**, **Slow-moving** or **Dead stock**, and suggests how much to buy.

Only **completed** sales count. Voided and cancelled orders are ignored.

| | Logistics | Café |
|---|---|---|
| Counted as | Whole units sold (1 bottle, 1 box) | What the recipes took from stock (g, ml, pcs) |
| Stock shown in | pcs | The item's own unit |
| Suggested buy | Always whole units, rounded **up** (never 0.5 pc) | Can be a fraction |

## How to use it
1. Pick a period: the last 7, 30, 60 or 90 days, or **Choose dates…** for your own range.
2. Tap a class chip to filter by class. Use the search box to find an item by name or code.
3. Read the **Buy** column for what to order. **Excel** exports the list as it is filtered.
4. Use **Thresholds** to change how items are judged (see below).

## The columns
| Column | Meaning |
|---|---|
| Item | Name and code |
| In stock | Current stock in the item's unit. Also shows how much is **held** for client orders and how much is **on order**. |
| Sold | Quantity sold in the period |
| Orders | How many sales it was on, and on how many separate days |
| Per day | Sold ÷ the days in the period the item existed **and had stock**. A stock-out is not read as low demand. N/A if it hasn't sold. |
| Days left | Free stock (on hand minus held) ÷ Per day. N/A if it hasn't sold. Flagged **Out**, **Order now** (runs out before a delivery could arrive) or **Low** (inside the safety margin). |
| Last sold | The last completed sale, even if it was before the period, as a date on the business's calendar |
| Since sale | Whole days since that sale, by the business's calendar. Sold Sep 30, today Oct 15 = 15 days. |
| Class | The item's label (see below). "out of stock N day(s)" shows days it could not sell. |
| Buy | Suggested quantity to order. Shown in red when the item is out or must be ordered now. |

The **Runs out soon** chip lists every item flagged Out, Order now or Low.

## The classes
| Class | Meaning |
|---|---|
| **Fast-moving** | At or above the 75th percentile of sellers by daily rate (top 25%), **and** sold on at least 3 different days, so one big order doesn't count as fast. Once a stock category has 5+ sellers, an item is compared within its own category. |
| **Slow-moving** | Sells, but less than that. Also an item that didn't sell in this period but did sell within the dead-stock period. |
| **Dead stock** | In stock, with enough history to judge, and **no sale for 90 days**. A short quiet spell never makes an item dead. |
| **Out of stock** | No sales, but it was out of stock for at least half of the period. That says nothing about demand. |
| **Too new to tell** | No sales yet, and the item, or the business's sales history, is younger than the dead-stock period. |

## How "Buy" is worked out
```
Target stock = Per day × (cover days + delivery days) + safety stock
Safety stock = Per day × safety days
Buy          = max(0, Target stock − (free stock + on order))
```
- Free stock = on hand minus what is held for client orders, so held stock isn't counted twice.
- On order = what open purchase orders still have to deliver.
- **Delivery days are per supplier.** Each item uses its supplier's own lead time (Procurement → Suppliers → Lead time), else the default under Thresholds (7). The supplier is the cheapest on its price lists, else whoever the item was last bought from. The Buy column shows which: "2-day lead", or "7-day lead (default)".
- **Spike guard:** for Buy, no single day counts for more than 3× the item's typical (median) selling day, so one bulk order doesn't inflate the purchase. Sold still shows everything. Items where this applied are marked *spike-adjusted*.
- **Why not Sold ÷ days it sold?** That assumes the item sells every day. 1,678 sold on 13 of 30 days is about 56 a day, not 129.
- Logistics, and any café item counted in pcs, is rounded **up** to whole units. Café ingredients can be fractions.

Buy is only suggested for fast and slow items. Dead stock, out-of-stock and too-new items get none, because there is no reliable rate to buy against.

**Suggested PO** (Procurement) uses this same figure, so what Analytics says to buy is what the draft PO contains. It also keeps the older low-stock-level suggestions; where both give a figure for an item, the larger is used.

## Thresholds and their defaults
| Setting | Default |
|---|---|
| Fast-moving = at or above the __th percentile of sellers | 75 (= top 25%) |
| …and sold on at least __ days | 3 |
| Dead stock = no sale for __ days | 90 |
| Buy enough for __ days | 14 |
| Delivery takes __ days (when the supplier has no lead time) | 7 |
| Plus spare __ days (safety stock) | 3 |
| Judge fast within a category of __+ sellers | 5 |
| For buying, cap one day at __× a typical selling day | 3 |

## Good to know
- **Logistics:** backdated sales count as sales.
- **Logistics:** a sale is matched to its stock item by product code, or by exact name if there is no code. One pc is one whole item, so a 2 L bottle is 1 pc, the same amount a sale takes off the shelf.
- **Café:** usage comes from exactly what each sale deducted, so recipes, sizes and add-ons are all reflected.
- Out-of-stock days are read from each item's stock card history.
- Nothing here changes stock, prices or the books. It is read-only reporting.
