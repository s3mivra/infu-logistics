// One CSV cell, safe to open in a spreadsheet.
//
// A text cell that starts with = + - @ (or a tab / carriage return) is read by
// Excel, Sheets and LibreOffice as a formula. Export files carry text that
// anyone could type - a failed sign-in's name lands in the audit log - so such
// a cell is prefixed with an apostrophe, which the spreadsheet shows as plain
// text. Numbers are left alone: a negative amount is a number, not a formula.
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  s = s.replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}
