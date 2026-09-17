// Counting a production batch's output.
//
// A batch is planned in whatever unit the person making it thinks in - 1700 ml
// of milk, 2 pcs of a packed item, 5 kg of flour - but stock is always stored
// in base units. Two places convert between the two: filing the batch, and
// confirming the actual yield afterwards. They have to agree.
//
// They did not. Filing offered a unit picker; reconciling ignored it and chose
// pieces of its own accord, derived from the pack size embedded in the item's
// name. A batch filed as 1700 ml came back as "planned 1.7 pcs", the operator
// retyped the 1700 they had in mind, and it was multiplied by the 1000 ml pack
// into 1700 L of stock - a thousandfold overstatement of a perishable.
//
// The rule these functions enforce: a quantity is only ever converted by the
// factor of the unit that was on screen beside it.

/** One of `options` is always returned; `factor` is base units per 1 of it. */
const first = (options) => options[0] || { label: 'units', factor: 1 };

/**
 * What the reconcile step may count a batch's yield in.
 *
 * `itemOptions` is the output item's own unit list (pcs / display / base) when
 * the item already exists. A 'new' output has no item yet - it is created in
 * the unit it was filed in, so that unit IS its base, plus pieces when a pack
 * size was given at filing time.
 */
export function reconcileUnitOptions(order, itemOptions = null) {
  if (!order) return [{ label: 'units', factor: 1 }];
  if (order.outputType === 'existing' && itemOptions?.length) return itemOptions;

  const out = [];
  const packSize = Number(order.outputPackSize) || 0;
  if (packSize > 0) out.push({ label: 'pcs', factor: packSize });
  out.push({ label: order.outputUnit || 'units', factor: 1 });
  return out.filter((o, i) => out.findIndex(x => x.label === o.label) === i);
}

/**
 * The unit a batch was planned in, resolved against what its item offers today.
 *
 * Falls back to the most natural reading when the planned unit is no longer on
 * offer - the item's pack size may have changed since filing - and for batches
 * filed before the planned unit was recorded at all.
 */
export function plannedUnitChoice(order, itemOptions = null) {
  const options = reconcileUnitOptions(order, itemOptions);
  return options.find(o => o.label === order?.outputEnteredUnit) || first(options);
}

/** A typed quantity, in base units. */
export function toBaseQty(entered, choice) {
  const n = Number(entered);
  if (!Number.isFinite(n)) return 0;
  return +(n * (Number(choice?.factor) || 1)).toFixed(6);
}

/** A base quantity, read in a chosen unit. */
export function inUnit(baseQty, choice) {
  const n = Number(baseQty) || 0;
  return +(n / (Number(choice?.factor) || 1)).toFixed(4);
}

/**
 * The same real quantity, re-expressed when the operator switches unit. What is
 * on screen must always mean what the label beside it says - silently leaving
 * "1700" in the box while the label flips from ml to pcs is how the
 * thousandfold error happened in the first place.
 */
export function restateQty(entered, fromChoice, toChoice) {
  // An empty box stays empty. Number('') is 0, so converting it would drop a
  // stray "0" into a field the operator had deliberately cleared.
  if (entered === '' || entered == null) return '';
  const n = Number(entered);
  if (!Number.isFinite(n)) return '';
  return String(inUnit(toBaseQty(n, fromChoice), toChoice));
}
