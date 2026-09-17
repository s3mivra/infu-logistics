// Read-only report: production batches whose yield was counted in the wrong unit.
//
// Filing a batch let the operator choose the unit ("1700 ml"), but the reconcile
// step ignored that choice and counted in PIECES, taken from the pack size in
// the output item's name. A batch filed as 1700 ml was shown back as "planned
// 1.7 pcs"; anyone who retyped the 1700 they had in mind had it multiplied by
// the 1000 ml pack, and a thousand times the real quantity went into stock.
//
// Fixed in features/production.js + ProductionTab.jsx (the planned unit is now
// recorded on the order and reconcile asks in that same unit). This lists the
// batches reconciled BEFORE that fix so the wrong stock can be found.
//
// Detection: the actual yield is almost exactly the planned figure multiplied
// by the output item's pack factor. That is the signature of retyping the
// planned number into a box that had silently switched to pieces - a genuine
// overrun does not land within a fraction of a percent of plan x pack size.
//
// Ranked by how much stock the difference put in: the top rows are the ones
// worth recounting first.
//
// Writes NOTHING. Correct anything it finds through Inventory -> Stock Count,
// not by editing the number: the count posts the difference to Spoilage,
// Variance & Waste (535000), which is what keeps the ledger tied to the stock.
// Check the item's unit cost afterwards too - reconcile divided the batch's
// material cost by the inflated quantity, so the cost per unit is too low by
// the same factor.
//
// Usage (from server/):
//   node scripts/audit-production-units.mjs                      table to stdout
//   node scripts/audit-production-units.mjs --csv > batches.csv  spreadsheet
//   node scripts/audit-production-units.mjs --business-type=log
//   node scripts/audit-production-units.mjs --all                every reconciled batch
//   node scripts/audit-production-units.mjs --count-csv          a sheet to count against
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const asCsv = args.includes('--csv');
const asCountSheet = args.includes('--count-csv');
const showAll = args.includes('--all');
const btArg = args.find(a => a.startsWith('--business-type='));
const BUSINESS_TYPE = (btArg ? btArg.split('=')[1] : (process.env.BUSINESS_TYPE || 'fb')).toLowerCase();
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// Base units are what is stored, but "1698300 ml" is not a figure anyone can
// act on. Show the reading a person would recognise beside it.
const inDisplay = (baseQty, item) => {
  const mult = Number(item?.unitMultiplier) || 1;
  const unit = item?.displayUnit || item?.unit || '';
  if (mult <= 1) return `${r4(baseQty)} ${unit}`.trim();
  return `${r4(baseQty / mult)} ${unit} (${r4(baseQty)} ${item?.unit || ''})`.trim();
};

// The same pack reading the app itself uses (AdminDashboard packInfo): an
// explicit packSize field first, else a size embedded in the item's name.
const PACK_RE = /(\d+(?:\.\d+)?)\s*(mg|kg|g|ml|cl|l|pcs|pc|pack|unit)\b/i;
const PACK_TO_BASE = { mg: 0.001, g: 1, kg: 1000, ml: 1, cl: 10, l: 1000, pcs: 1, pc: 1, pack: 1, unit: 1 };

function packFactorOf(item) {
  if (!item) return { factor: 1, from: 'none' };
  const mult = Number(item.unitMultiplier) || 1;
  if (Number(item.packSize) > 0) {
    return { factor: Number(item.packSize) * mult, from: `packSize ${item.packSize}` };
  }
  const m = String(item.itemName || '').match(PACK_RE);
  if (m) {
    const val = parseFloat(m[1]);
    const f = PACK_TO_BASE[m[2].toLowerCase()];
    const baseFactor = PACK_TO_BASE[String(item.unit || '').toLowerCase()] || 1;
    if (f !== undefined && val > 0) {
      return { factor: val * (f / baseFactor), from: `name "${m[0]}"` };
    }
  }
  // No pack known: the app falls back to the display multiplier, which is the
  // other way the same mistake could be made (ml typed into an "L" box).
  return { factor: mult, from: mult > 1 ? `display ${item.displayUnit || ''}` : 'none' };
}

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const orders = await db.collection('productionorders').find({
  businessType: BUSINESS_TYPE,
  actualOutputQty: { $ne: null, $exists: true },
}, {
  projection: {
    batchNumber: 1, createdAt: 1, reconciledAt: 1, outputType: 1, outputInvId: 1,
    outputName: 1, outputQty: 1, outputUnit: 1, outputEnteredUnit: 1, outputPackSize: 1,
    actualOutputQty: 1, fulfillmentStatus: 1, totalMaterialsCost: 1,
  },
}).sort({ createdAt: 1 }).toArray();

const itemIds = [...new Set(orders.map(o => o.outputInvId).filter(Boolean).map(String))];
const items = itemIds.length
  ? await db.collection('inventories').find(
      { _id: { $in: itemIds.map(id => new mongoose.Types.ObjectId(id)) } },
      { projection: { itemName: 1, unit: 1, displayUnit: 1, unitMultiplier: 1, packSize: 1, stockQty: 1, unitCost: 1 } },
    ).toArray()
  : [];
const byId = new Map(items.map(i => [String(i._id), i]));

const suspect = [];
const checked = [];
for (const o of orders) {
  const item = o.outputInvId ? byId.get(String(o.outputInvId)) : null;
  const { factor, from } = o.outputType === 'existing'
    ? packFactorOf(item)
    : { factor: Number(o.outputPackSize) || 1, from: o.outputPackSize ? `filed pack ${o.outputPackSize}` : 'none' };

  const planned = Number(o.outputQty) || 0;
  const actual = Number(o.actualOutputQty) || 0;
  const ratio = planned > 0 ? actual / planned : 0;
  const row = {
    batch: o.batchNumber, date: o.createdAt, item: item?.itemName || o.outputName || '',
    itemUnit: item?.unit || o.outputUnit || '', planned, actual, factor, from, ratio: r4(ratio),
    // What the yield almost certainly should have been.
    shouldBe: factor > 1 ? r4(actual / factor) : actual,
    overstatedBy: factor > 1 ? r4(actual - actual / factor) : 0,
    onHandNow: item?.stockQty ?? null,
    outputItem: item,
    plannedUnitRecorded: o.outputEnteredUnit || '',
  };
  checked.push(row);

  // The signature: a pack factor above 1, and an actual that lands within a
  // whisker of planned x factor. Batches filed after the fix record the unit
  // they were planned in, so they are not guesswork and are left alone.
  if (o.outputEnteredUnit) continue;
  if (factor > 1 && planned > 0 && Math.abs(ratio - factor) <= factor * 0.005) suspect.push(row);
}


// A sheet to take to the shelf.
//
// Correcting these means a physical count - the system's figure is exactly what
// cannot be trusted here, and some of the excess may have been sold or consumed
// since. So this lists WHICH items to count and what the figure should come to
// if nothing else moved, as a sanity check against what is actually there.
//
// Quantities are in the unit the count screen itself asks for (packages for a
// packed item, kg/L otherwise) - the same pack factor that caused the error is
// the one that screen counts in, so these can be read straight across.
function countSheet(rows) {
  const byItem = new Map();
  for (const r of rows) {
    const cur = byItem.get(r.item) || { item: r.item, outputItem: r.outputItem, excess: 0, batches: [] };
    cur.excess = r4(cur.excess + r.overstatedBy);
    cur.batches.push(r.batch);
    byItem.set(r.item, cur);
  }
  return [...byItem.values()].map((g) => {
    const item = g.outputItem;
    const { factor, from } = packFactorOf(item);
    const per = factor || 1;
    const onHand = Number(item?.stockQty) || 0;
    const display = item?.displayUnit || item?.unit || 'units';

    // What the count screen is actually asking for. A packed item is counted in
    // PACKAGES - saying "kg" next to a figure that means "sacks" is how this
    // whole class of mistake starts.
    const mult = Number(item?.unitMultiplier) || 1;
    const countIn = from === 'none' ? (item?.unit || 'units')
      : from.startsWith('display') ? display
      : `packs of ${r4(per / mult)}${display}`;

    // More may have been sold or consumed since than was wrongly added, which
    // puts the arithmetic below zero. Stock cannot be negative, so that is
    // reported as what it is - a figure only the shelf can settle.
    const expectedRaw = (onHand - g.excess) / per;
    return {
      item: g.item,
      countIn,
      onHandNow: r4(onHand / per),
      addedInError: r4(g.excess / per),
      expectedAfter: expectedRaw < 0 ? 'count it - more went out than was wrongly added' : r4(expectedRaw),
      batches: g.batches.join(' '),
    };
  }).sort((a, b) => b.addedInError - a.addedInError);
}

suspect.sort((a, b) => b.overstatedBy - a.overstatedBy);
const rows = showAll ? checked : suspect;

if (asCountSheet) {
  console.log('item,countIn,onHandNow,addedInError,expectedAfterCorrection,batches');
  for (const r of countSheet(suspect)) {
    const cells = [r.item, r.countIn, r.onHandNow, r.addedInError, r.expectedAfter, r.batches];
    console.log(cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
  }
} else if (asCsv) {
  console.log('batch,date,item,unit,planned,actualRecorded,packFactor,factorFrom,shouldBe,overstatedBy,onHandNow');
  for (const r of rows) {
    const cells = [r.batch, new Date(r.date).toISOString().slice(0, 10), r.item, r.itemUnit,
      r.planned, r.actual, r.factor, r.from, r.shouldBe, r.overstatedBy, r.onHandNow ?? ''];
    console.log(cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
  }
} else {
  console.log(`Business type: ${BUSINESS_TYPE}`);
  console.log(`Reconciled batches checked: ${orders.length}`);
  console.log(`Counted in the wrong unit: ${suspect.length}`);
  if (suspect.length) {
    const byItem = new Map();
    for (const r of suspect) byItem.set(r.item, r4((byItem.get(r.item) || 0) + r.overstatedBy));
    console.log('\nStock to recount, worst first:');
    for (const [item, over] of [...byItem.entries()].sort((a, b) => b[1] - a[1])) {
      const row = suspect.find(r => r.item === item);
      // This is what those batches PUT IN wrongly. Some of it may have been
      // sold or consumed since, so it is not necessarily all still sitting
      // there - the physical count is what settles that.
      console.log(`  ${item}`);
      console.log(`      put in wrongly: ~${inDisplay(over, row?.outputItem)}`);
      console.log(`      on hand now:    ${row?.onHandNow != null ? inDisplay(row.onHandNow, row.outputItem) : 'unknown'}`);
    }
    console.log('\nBatch              Date        Item                      Planned      Recorded    Should be   Pack from');
    for (const r of rows) {
      console.log(
        `${String(r.batch || '').padEnd(18)} ${new Date(r.date).toISOString().slice(0, 10)}  ` +
        `${String(r.item).slice(0, 24).padEnd(24)} ${String(r.planned).padStart(11)} ` +
        `${String(r.actual).padStart(12)} ${String(r.shouldBe).padStart(11)}   ${r.from}`,
      );
    }
    console.log('\nThe table below is in each item\'s stored base unit (g / ml / pcs).');
    console.log('\nCorrect these through Inventory -> Stock Count, not by editing the number:');
    console.log('the count posts the difference to Spoilage, Variance & Waste (535000), which');
    console.log('keeps the ledger tied to the stock. Check each item\'s unit cost afterwards -');
    console.log('it is too low by the same factor the quantity was too high.');
  } else {
    console.log('\nNothing found. Every reconciled batch either records the unit it was planned');
    console.log('in, or its yield does not look like a pack-size multiplication.');
  }
  if (showAll) console.log(`\n(--all: listing every one of the ${checked.length} reconciled batches)`);
}

await mongoose.disconnect();
