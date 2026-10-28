// How dates read on screen, everywhere: "28 Oct 2026", and for a time stamp
// "Today 2:15 PM", "Yesterday 9:02 AM" or "28 Oct 2026, 2:15 PM". Short, the
// same on every device (not the browser's own 10/28/2026 or 28/10/2026).
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const valid = (d) => { const x = d instanceof Date ? d : new Date(d); return Number.isNaN(x.getTime()) ? null : x; };

/** "28 Oct 2026"; '' for a missing or bad date. */
export function formatDate(d) {
  const x = d == null || d === '' ? null : valid(d);
  return x ? DAY.format(x) : '';
}

/** "Today 2:15 PM", "Yesterday 9:02 AM", else "28 Oct 2026, 2:15 PM". */
export function formatDateTime(d, now = new Date()) {
  const x = d == null || d === '' ? null : valid(d);
  if (!x) return '';
  const day = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diff = Math.round((day(now) - day(x)) / 86400000);
  const t = TIME.format(x);
  if (diff === 0) return `Today ${t}`;
  if (diff === 1) return `Yesterday ${t}`;
  return `${DAY.format(x)}, ${t}`;
}
