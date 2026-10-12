// A date cell from a spreadsheet, however it was typed or however the file
// was read -> the calendar day as YYYY-MM-DD.
//
// Every importer reads its date columns through this, so they all accept the
// same things and refuse the same things:
//
//   2026-09-30                 the form the templates ask for
//   9/30/2026, 09-30-26        month first, the way dates are written here
//   30/09/2026                 day first, when the first number cannot be a month
//   Sept 30, 2026, 30 Sep 2026 written out
//   46295                      the number Excel stores a date as, which is what
//                              arrives when a file is read without converting it
//
// What it refuses matters as much: a day that does not exist (2026-09-31 used
// to slide silently to October 1), a bare number that is not a date (46295 was
// read as the YEAR 46295), "########" (a column too narrow, copied as text),
// and any year outside 1990-2100.
//
// -> ''   the cell is blank
//    null it holds something that is not a date
//    a full timestamp (2026-09-30T14:05:00Z) is handed back untouched: it
//    already says exactly when, and the caller reads it as it always has.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

function ymd(y, m, d) {
  if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const real = new Date(Date.UTC(y, m - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) return null;   // 31 Sept, 30 Feb
  return `${y}-${pad(m)}-${pad(d)}`;
}
const fullYear = (y) => (String(y).length <= 2 ? 2000 + Number(y) : Number(y));

// Excel counts days from 30 Dec 1899. 1990-01-01 is 32874, 2100-12-31 is 73415.
function fromSerial(n) {
  if (!(n >= 32874 && n <= 73415)) return null;
  const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function sheetDay(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') return fromSerial(v);
  const s = String(v).trim();
  if (!s) return '';
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return ymd(+m[1], +m[2], +m[3]);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return Number.isNaN(new Date(s).getTime()) ? null : s;
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromSerial(Number(s));
  if ((m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s))) return ymd(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
    const a = +m[1], b = +m[2], y = fullYear(m[3]);
    return a > 12 ? ymd(y, b, a) : ymd(y, a, b);
  }
  // Sept 30, 2026 · September 30 2026
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) {
    const mo = MONTHS[m[1].toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo ? ymd(+m[3], mo, +m[2]) : null;
  }
  // 30 Sep 2026 · 30-Sep-26
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2}|\d{4})$/.exec(s))) {
    const mo = MONTHS[m[2].toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mo ? ymd(fullYear(m[3]), mo, +m[1]) : null;
  }
  return null;
}

// What to tell the person when a cell is refused.
export const SHEET_DATE_HELP = 'Write it as YYYY-MM-DD, for example 2026-09-30.';
