// A daily sales summary sheet: one row per day, split by how the money came
// in - cash (less discounts, then deposited), a bank (card / QR, e.g. RCBC),
// and Grab (gross, less Grab's commission = what Grab credits). Read into the
// rows POST /api/orders/import-daily takes.
//
// The sheet is the business's own, so the header row is FOUND (rows of totals
// usually sit above it) and its columns matched by name. A label above the
// bank's "GROSS AMOUNT" column (e.g. "RCBC") names the bank.

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// field -> the header names that mean it (normalised)
const FIELDS = {
  date: ['date', 'sales date', 'day'],
  totalSales: ['total sales', 'total'],
  cashSales: ['cash sales', 'cash'],
  discountType: ['type of discount', 'discount type'],
  discount: ['discont', 'discount', 'discounts'],
  cashAfter: ['cash sales after discount', 'net cash', 'cash after discount'],
  depositDate: ['date deposited', 'deposit date'],
  depositSlip: ['validated deposit slip', 'deposit slip', 'deposit slip no', 'slip no'],
  bankSales: ['gross amount', 'bank', 'card', 'card sales'],
  grabGross: ['grab', 'grab gross', 'grab sales'],
  grabCommission: ['commission', 'grab commission'],
  grabCredited: ['credited amount', 'grab credited', 'credited'],
};

export const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/[₱,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const isDateLike = (v) => v instanceof Date
  || (typeof v === 'number' && v > 20000 && v < 80000)
  || /^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\s*$/.test(String(v ?? ''))
  || /^\s*[A-Za-z]{3,9}\.? \d{1,2},? \d{2,4}\s*$/.test(String(v ?? ''));

// Is this grid a daily sales summary? -> the header row index, or -1.
export function findDailyHeader(grid = []) {
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const cells = (grid[i] || []).map(norm);
    if (cells.includes('date') && cells.some((c) => c === 'total sales')
      && cells.some((c) => FIELDS.cashSales.includes(c) || c === 'cash sales after discount')) return i;
  }
  return -1;
}

// grid (sheet_to_json with header: 1) -> { rows, bankLabel, columns } or null.
export function readDailySales(grid = []) {
  const h = findDailyHeader(grid);
  if (h < 0) return null;
  const header = (grid[h] || []).map(norm);
  const col = {};
  header.forEach((name, i) => {
    for (const [field, names] of Object.entries(FIELDS)) {
      if (col[field] === undefined && names.includes(name)) { col[field] = i; break; }
    }
  });
  // "CASH" alone could be the label row above; only take it from the header.
  const above = grid[h - 1] || [];
  const bankLabel = col.bankSales !== undefined ? String(above[col.bankSales] ?? '').trim() : '';
  const get = (r, f) => (col[f] === undefined ? '' : r[col[f]]);
  const rows = [];
  for (let i = h + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const date = get(r, 'date');
    if (!isDateLike(date)) continue;           // totals, notes, blank rows
    rows.push({
      sheetRow: i + 1,
      date: date instanceof Date ? date.toISOString().slice(0, 10) : String(date).trim(),
      totalSales: toNumber(get(r, 'totalSales')),
      cashSales: toNumber(get(r, 'cashSales')),
      discountType: String(get(r, 'discountType') ?? '').trim(),
      discount: toNumber(get(r, 'discount')),
      cashAfter: toNumber(get(r, 'cashAfter')),
      depositDate: (() => { const d = get(r, 'depositDate'); return d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').trim(); })(),
      depositSlip: String(get(r, 'depositSlip') ?? '').trim(),
      bankSales: toNumber(get(r, 'bankSales')),
      grabGross: toNumber(get(r, 'grabGross')),
      grabCommission: toNumber(get(r, 'grabCommission')),
      grabCredited: toNumber(get(r, 'grabCredited')),
    });
  }
  return { rows, bankLabel, columns: Object.keys(col) };
}

// The sheet's own arithmetic, row by row: what does not add up, in words.
export function dailyChecks(r) {
  const off = (a, b) => Math.abs(a - b) > 0.01;
  const out = [];
  const cashAfter = r.cashSales - r.discount;
  if (r.cashAfter && off(cashAfter, r.cashAfter)) out.push(`cash after discount is ${r.cashAfter.toFixed(2)}, but cash ${r.cashSales.toFixed(2)} less discount ${r.discount.toFixed(2)} is ${cashAfter.toFixed(2)}`);
  if (r.grabCredited && off(r.grabGross - r.grabCommission, r.grabCredited)) out.push(`Grab ${r.grabGross.toFixed(2)} less commission ${r.grabCommission.toFixed(2)} is not the credited ${r.grabCredited.toFixed(2)}`);
  const total = r.cashSales + r.bankSales + (r.grabCredited || (r.grabGross - r.grabCommission));
  if (r.totalSales && off(total, r.totalSales)) out.push(`total sales is ${r.totalSales.toFixed(2)}, but cash + bank + Grab credited is ${total.toFixed(2)}`);
  return out;
}

// The same date on two tabs (a period tab and a month tab, say) would be two
// days of sales. Days come back from the server preview with the date already
// read the same way; the first is kept and later ones are marked, saying when
// their numbers differ so someone checks which tab is right.
export function markRepeatedDays(days = []) {
  const seen = new Map();
  return days.map((d) => {
    if (d.errors?.length) return d;
    const first = seen.get(d.date);
    if (first) {
      const same = ['cash', 'discount', 'bank', 'grab', 'commission'].every((k) => Math.abs((first[k] || 0) - (d[k] || 0)) < 0.01);
      return { ...d, repeatOf: first.row, repeatDiffers: !same };
    }
    seen.set(d.date, d);
    return d;
  });
}
