// Reading a Google Sheet the business has shared by link.
//
// No Google sign-in: the sheet must be shared as "Anyone with the link can
// view" or published to the web. Only Google's own hosts are ever contacted -
// the link is parsed down to a sheet id and the export URL rebuilt here, so a
// saved link can never point this server at an arbitrary address.
import crypto from 'node:crypto';

const ID_RE = /^[A-Za-z0-9_-]{20,}$/;
const ALLOWED_HOST = (h) => h === 'docs.google.com' || h.endsWith('.googleusercontent.com');

// -> { kind: 'id', id, gid } | { kind: 'pub', id, gid } | null
export function parseSheetLink(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'spreadsheets' || parts[1] !== 'd') return null;
  const gidRaw = u.searchParams.get('gid') || (u.hash.match(/gid=(\d+)/) || [])[1] || '';
  const gid = /^\d+$/.test(gidRaw) ? gidRaw : '';
  if (parts[2] === 'e' && ID_RE.test(parts[3] || '')) return { kind: 'pub', id: parts[3], gid };
  if (ID_RE.test(parts[2] || '')) return { kind: 'id', id: parts[2], gid };
  return null;
}

// The whole workbook (xlsx), or one tab (csv) - the tab in the link, else the first.
export function exportUrl(link, format) {
  const gid = format === 'csv' && link.gid ? `&gid=${link.gid}` : '';
  return link.kind === 'pub'
    ? `https://docs.google.com/spreadsheets/d/e/${link.id}/pub?output=${format}${gid}${gid ? '&single=true' : ''}`
    : `https://docs.google.com/spreadsheets/d/${link.id}/export?format=${format}${gid}`;
}

export class SheetError extends Error {}

// Fetches an export URL, following redirects only within Google's hosts.
// A sheet that is not shared answers with a sign-in PAGE rather than an error
// status, so an HTML answer is reported as "not shared", not parsed as data.
export async function fetchSheet(url, { fetchImpl = globalThis.fetch, maxBytes = 10 * 1024 * 1024, timeoutMs = 20000 } = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const host = new URL(current).hostname;
    if (!ALLOWED_HOST(host)) throw new SheetError('The sheet link redirected somewhere other than Google.');
    let res;
    try {
      res = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new SheetError('Could not reach Google Sheets. Check the internet connection and try again.');
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new SheetError('Google Sheets gave an unexpected answer.');
      const nextUrl = new URL(next, current).toString();
      // Google sends an unshared sheet to its sign-in page.
      if (new URL(nextUrl).hostname === 'accounts.google.com') throw notShared();
      current = nextUrl;
      continue;
    }
    if (res.status === 401 || res.status === 403) throw notShared();
    if (res.status === 404) throw new SheetError('That sheet was not found. It may have been deleted or the link changed.');
    if (!res.ok) throw new SheetError(`Google Sheets answered with an error (${res.status}). Try again later.`);
    if (/text\/html/i.test(res.headers.get('content-type') || '')) throw notShared();
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new SheetError('The sheet is too large to import.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new SheetError('The sheet is too large to import.');
    return buf;
  }
  throw new SheetError('Google Sheets redirected too many times.');
}

function notShared() {
  return new SheetError('The sheet is not shared. In Google Sheets, click Share and set "Anyone with the link" to Viewer, then try again.');
}

export const hashContent = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// "HH:MM" on the business's clock, for comparing against the check time.
export function localTime(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}

export const isCheckTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));

// Is the daily check due? Past the check time on the business clock and not
// yet done today. ">=" rather than "==", so a server that was down at the
// check time still checks when it comes back.
export function isCheckDue(sheet, now, timeZone, today) {
  if (!sheet?.url || !isCheckTime(sheet.checkTime)) return false;
  if (sheet.lastCheckDate === today) return false;
  return localTime(now, timeZone) >= sheet.checkTime;
}
