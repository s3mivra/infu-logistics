// Which edits are gated behind an approval, and how a submitted edit is split
// into "apply now" and "needs sign-off". Pure functions, no DB - the money
// rules stay unit-testable without booting a server.
//
// WHY only these fields: the gate protects MONEY LEVERS, not paperwork. A
// selling price, a cost basis, and a client's credit line are each a direct
// decision about how much the business earns or how much it can be owed, and
// each is a single-field edit that is easy to make by accident and expensive
// to notice late. Renaming an item or fixing its category is neither, and
// putting those behind a queue would train people to rubber-stamp the queue -
// which is how an approval gate stops protecting anything at all.

// field -> human label, per entity. The label is what the approver reads in
// the queue, so it has to say what the number MEANS, not what it is called in
// the schema.
export const GUARDED_FIELDS = {
  Product: {
    basePrice:    'Selling price',
    costOverride: 'Recipe cost override',
  },
};

// NOTE on scope: inventory unit cost / SRP and client credit limits are
// deliberately NOT listed. Editing either is already superadmin-only
// (PUT /api/inventory/:id, PATCH /api/client-accounts/:id), and a superadmin
// holds pricing.approve - so a gate on those routes could never fire. Listing
// the fields anyway would be dead config that reads like a protection which
// isn't there. Product pricing is the live surface: PUT /api/products/:id is
// requireStaff, and it is what the Pricing Control tab edits. To gate the
// others, move those routes off requireSuperAdmin first, then add them here.

export const APPROVAL_ENTITIES = Object.keys(GUARDED_FIELDS);

/** Is this field on this entity behind the approval gate? */
export function isGuarded(entity, field) {
  return Boolean(GUARDED_FIELDS[entity]?.[field]);
}

/** The human label for a guarded field, falling back to the raw field name. */
export function labelFor(entity, field) {
  return GUARDED_FIELDS[entity]?.[field] || field;
}

// Money comparison. A price submitted as the string "250" is not a change from
// the number 250, and float noise (250.00000000001) is not one either - both
// would otherwise open a pointless approval request that an approver has to
// clear. Non-numeric values fall back to a plain strict comparison.
function sameValue(a, b) {
  // "Not set" is checked FIRST and never coerced. Number(null) is 0, so a
  // numeric comparison would read an unset credit limit ("no limit") and a
  // zero one ("cash only") as the same value - they are opposites, and
  // treating them as equal would let a change between them skip the gate.
  const unsetA = a == null || a === '';
  const unsetB = b == null || b === '';
  if (unsetA || unsetB) return unsetA && unsetB;

  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 0.000001;
  return a === b;
}

/**
 * Split a submitted update into the part that can be applied immediately and
 * the part that needs sign-off.
 *
 * `canApprove` short-circuits the whole thing: someone holding the approval
 * permission is the person who would sign it off anyway, so making them file a
 * request against themselves adds a click and no oversight.
 *
 * Returns { apply, pending } where:
 *   apply   - the update object to actually write now
 *   pending - [{ field, label, oldValue, newValue }] needing approval (never
 *             includes a field whose value did not actually change)
 */
export function splitUpdate({ entity, existing = {}, update = {}, canApprove = false }) {
  const apply = {};
  const pending = [];

  for (const [field, newValue] of Object.entries(update)) {
    if (!canApprove && isGuarded(entity, field) && !sameValue(existing[field], newValue)) {
      pending.push({
        field,
        label: labelFor(entity, field),
        oldValue: existing[field] ?? null,
        newValue,
      });
      continue;                       // held back - must NOT be written now
    }
    apply[field] = newValue;
  }

  return { apply, pending };
}

/**
 * Can a pending change still be applied, or has the world moved underneath it?
 *
 * A request approved a week after it was filed must not blindly overwrite a
 * price someone has since corrected by another route - the approver agreed to
 * "250 -> 275", not to "whatever it is now -> 275". A mismatch is reported
 * rather than silently applied or silently dropped.
 */
export function checkStale(change = {}, current = {}) {
  const now = current[change.field];
  if (sameValue(now, change.oldValue)) return { stale: false };
  // Already at the requested value - someone applied it by another route. Not
  // a conflict, just nothing left to do.
  if (sameValue(now, change.newValue)) return { stale: true, alreadyApplied: true, currentValue: now };
  return { stale: true, alreadyApplied: false, currentValue: now };
}
