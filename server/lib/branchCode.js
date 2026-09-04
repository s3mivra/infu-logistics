// Branch codes: "AC-A001".
//
//   AC    the business
//   A     the physical location
//   001   which inventory at that location
//
// The middle part is what makes this worth having. Two branches can sit at the
// SAME address and still be separate businesses to the system - separate
// deployments, separate stock, separate books - because they are separate
// inventories (a kiosk and a full bar in one mall, say). "AC-A001" and
// "AC-A002" are those two; "AC-B001" is somewhere else entirely.
//
// So a consolidated report has three meaningful levels, not two:
//   business  every AC-*        - the whole company
//   location  every AC-A*       - one address, however many counters
//   branch    AC-A001           - one inventory
//
// Without the location level, a report can only show "all branches" or "this
// branch", and an owner asking "how did the mall site do?" has to add two rows
// up by hand.

// Business is letters/digits, location is letters, sequence is digits. The
// separator is a single hyphen, and the sequence carries its own leading zeros
// so "AC-A001" sorts before "AC-A010" as text.
const BRANCH_CODE_RE = /^([A-Z0-9]{1,8})-([A-Z]{1,4})(\d{1,6})$/i;

export const UNASSIGNED = 'Unassigned';

/**
 * Parse a branch code into its parts.
 * Returns { valid: false, raw } for anything that does not fit the shape - an
 * unrecognised code is never guessed at, because grouping money under the wrong
 * location is worse than showing it as unassigned.
 */
export function parseBranchCode(code) {
  const raw = String(code == null ? '' : code).trim().toUpperCase();
  const m = raw.match(BRANCH_CODE_RE);
  if (!m) return { valid: false, raw, locationKey: UNASSIGNED };
  const [, business, location, seq] = m;
  return {
    valid: true,
    raw,
    business,
    location,
    sequence: parseInt(seq, 10),
    // What two branches at one address share.
    locationKey: `${business}-${location}`,
  };
}

export function isValidBranchCode(code) {
  return parseBranchCode(code).valid;
}

/** Build a canonical code, zero-padded so codes sort correctly as text. */
export function formatBranchCode({ business, location, sequence, pad = 3 } = {}) {
  const b = String(business || '').trim().toUpperCase();
  const l = String(location || '').trim().toUpperCase();
  const n = Number(sequence);
  if (!b || !l || !Number.isFinite(n) || n < 0) return '';
  return `${b}-${l}${String(Math.trunc(n)).padStart(pad, '0')}`;
}

/**
 * The next free code at a location, given the codes already in use.
 * nextBranchCode('AC', 'A', ['AC-A001', 'AC-B001']) => 'AC-A002'
 */
export function nextBranchCode(business, location, existing = []) {
  const key = `${String(business || '').toUpperCase()}-${String(location || '').toUpperCase()}`;
  const used = existing
    .map(parseBranchCode)
    .filter(p => p.valid && p.locationKey === key)
    .map(p => p.sequence);
  const next = used.length ? Math.max(...used) + 1 : 1;
  return formatBranchCode({ business, location, sequence: next });
}

/**
 * Group branches by location for a consolidated report.
 *
 * Takes rows carrying a `branchCode`, returns one entry per location with its
 * branches nested. Anything with a missing or malformed code is collected under
 * "Unassigned" rather than dropped - a branch whose code was never set still has
 * real money in it, and silently omitting it would understate the totals.
 */
export function groupByLocation(rows = []) {
  const byKey = new Map();
  for (const row of rows) {
    const parsed = parseBranchCode(row?.branchCode);
    const key = parsed.locationKey;
    if (!byKey.has(key)) {
      byKey.set(key, {
        locationKey: key,
        business: parsed.valid ? parsed.business : '',
        location: parsed.valid ? parsed.location : '',
        branches: [],
      });
    }
    byKey.get(key).branches.push({ ...row, parsedCode: parsed });
  }

  return [...byKey.values()]
    .map(g => ({
      ...g,
      // Within a location, order by the sequence an operator would expect.
      branches: g.branches.sort((a, b) =>
        (a.parsedCode.sequence ?? 0) - (b.parsedCode.sequence ?? 0)
        || String(a.branchCode || '').localeCompare(String(b.branchCode || ''))),
    }))
    // Unassigned always last; it is an exception list, not a location.
    .sort((a, b) => {
      if (a.locationKey === UNASSIGNED) return 1;
      if (b.locationKey === UNASSIGNED) return -1;
      return a.locationKey.localeCompare(b.locationKey);
    });
}

/**
 * Sum numeric fields across the branches of each location.
 * `fields` names which keys to total, so callers stay explicit about what rolls
 * up rather than summing whatever happens to be numeric.
 */
export function rollUpByLocation(rows = [], fields = []) {
  return groupByLocation(rows).map(g => {
    const totals = {};
    for (const f of fields) {
      totals[f] = +g.branches.reduce((s, b) => s + (Number(b?.[f]) || 0), 0).toFixed(2);
    }
    return { ...g, branchCount: g.branches.length, totals };
  });
}
