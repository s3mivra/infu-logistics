// The business's own clock.
//
// A shop's "day" is its wall clock, not the server's. Two different notions of
// it had grown up side by side: report ranges were cut in the SERVER's local
// time, while daily grouping, the EOD lock and the midnight close hardcoded
// Asia/Manila. On a server left on UTC - the default in most containers - the
// two disagreed by eight hours, so a day's report and that same day's EOD count
// covered different sales.
//
// One setting now drives both, and it is a setting rather than an env var
// because moving branch or opening in another country should not need a
// redeploy. Defaults to Asia/Manila, which is what every existing deployment
// was already doing.
export const DEFAULT_BUSINESS_TZ = 'Asia/Manila';

let businessTz = DEFAULT_BUSINESS_TZ;

export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

export function setBusinessTimeZone(tz) {
  if (!isValidTimeZone(tz)) return businessTz;
  businessTz = tz;
  return businessTz;
}

export function businessTimeZone() { return businessTz; }

// How far the zone is from UTC at that instant, in milliseconds. Derived from
// Intl rather than a fixed offset so a zone that observes DST is handled on the
// right side of the changeover.
function offsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUtc - date.getTime();
}

// The instant at which a given wall-clock time starts in the business's zone.
// Applied twice: the first pass uses the offset at the guessed instant, which
// is wrong only across a DST boundary, and the second corrects it.
function zonedInstant(y, mo, d, h, mi, s, ms, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const first = new Date(guess - offsetMs(new Date(guess), tz));
  return new Date(guess - offsetMs(first, tz));
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

// Start of the given day in the business's zone. A plain YYYY-MM-DD is a
// calendar day; anything richer (a full ISO timestamp) already carries its own
// instant and is passed through untouched.
export function businessDayStart(value, tz = businessTz) {
  const s = String(value).trim();
  const m = YMD.exec(s);
  if (!m) return new Date(s);
  return zonedInstant(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0, 0, tz);
}

// The last instant of that same day, so a range covers it whole. Derived as
// "the moment the next day begins, less a millisecond" rather than 23:59:59.999
// directly: the zone offset is only known to the second, so building the end
// from a millisecond figure lands a few milliseconds short of midnight and a
// sale rung up in that sliver falls into no day at all.
export function businessDayEnd(value, tz = businessTz) {
  const s = String(value).trim();
  const m = YMD.exec(s);
  if (!m) {
    const d = new Date(s);
    d.setHours(23, 59, 59, 999);
    return d;
  }
  const nextDay = zonedInstant(Number(m[1]), Number(m[2]), Number(m[3]) + 1, 0, 0, 0, 0, tz);
  return new Date(nextDay.getTime() - 1);
}

// The calendar date an instant falls on, in the business's zone: 'YYYY-MM-DD'.
// This is the string the EOD lock, the midnight close and the daily reports all
// key on, so they agree on which day a sale belongs to.
export function businessDateStr(date = new Date(), tz = businessTz) {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: tz });
}

// The business day that has just ENDED, as of `at`. The midnight auto-close
// fires a moment after the business's own midnight, so by the time it runs
// `businessDateStr()` already names the NEW day: sealing the register under
// that date would lock a day nobody has traded yet and leave the day just
// closed unlocked. Backing up an hour lands safely inside the day being
// closed - and stays inside it even where a DST change moves midnight by one
// hour, because a zone shift never exceeds that within a single step.
export function businessClosingDateStr(at = new Date(), tz = businessTz) {
  return businessDateStr(new Date(new Date(at).getTime() - 60 * 60 * 1000), tz);
}
