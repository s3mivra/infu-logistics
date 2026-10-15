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
| Class | The item's label (see below). The small "out of stock N day(s)" note shows days it could not sell. |
| In stock | Current stock, plus anything already on order with suppliers |
| Sold | Quantity sold in the period |
| Orders | How many sales it was on, and on how many separate days |
| Per day | Average daily sales, counting only the days it was **in stock** |
| Lasts | How many days current stock will last at that rate |
| Last sold | The last completed sale, even if it was before the period |
| Buy | Suggested quantity to order |

## The classes
| Class | Meaning |
|---|---|
| **Fast-moving** | Among your top sellers by daily rate (default: top 25%), **and** sold on at least 3 different days, so one big order doesn't count as fast. |
| **Slow-moving** | Sells, but less than that, or only now and then. |
| **Dead stock** | In stock, with enough history to judge, and **no sale for 30 days**. |
| **Out of stock** | No sales, but it was out of stock for at least half of the period. That says nothing about demand, so it is not called dead. |
| **Too new to tell** | No sales yet, and the item, or the business's sales history, is younger than the dead-stock period. |

"Fast" is measured against your own sellers, so the bar rises as sales grow.

## How "Buy" is worked out
```
Buy = Per day × (cover days + delivery days + spare days) − in stock − on order
```
The defaults are 30 cover days, 7 delivery days and 3 spare days. A negative result shows as "–", meaning nothing to buy.

Buy is only suggested for fast and slow items. Dead stock, out-of-stock and too-new items get no suggestion, because there is no reliable rate to buy against.

## Thresholds and their defaults
| Setting | Default |
|---|---|
| Fast-moving = at or above the __th percentile of sellers | 75 (= top 25%) |
| …and sold on at least __ days | 3 |
| Dead stock = no sale for __ days | 30 |
| Buy enough for __ days | 30 |
| Delivery takes __ days | 7 |
| Plus spare __ days | 3 |

## Good to know
- **Logistics:** backdated sales count as sales.
- **Logistics:** a sale is matched to its stock item by product code, or by exact name if there is no code.
- **Café:** usage comes from exactly what each sale deducted, so recipes, sizes and add-ons are all reflected.
- Out-of-stock days are read from each item's stock card history.
- Nothing here changes stock, prices or the books. It is read-only reporting.
