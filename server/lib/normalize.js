// Canonical text normalization for user-entered fields.
//
// WHY: without this, "Kasa Lokal", "KASA LOKAL" and "kasa lokal" are three
// different suppliers. Normalizing at the Zod boundary means the DB only ever
// holds one canonical form, which in turn makes case-insensitive unique
// indexes meaningful instead of decorative.
//
// Applied server-side on purpose. A CSS `text-transform: uppercase` lies to the
// user — it shows OSK-001 while storing osk-001.

// Collapse runs of whitespace (including tabs/newlines pasted from Excel) into
// single spaces, and trim the ends. Every other helper builds on this.
export const squish = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Codes, SKUs, PO refs, unit symbols. Also strips spaces entirely for code-like
// fields where an interior space is always a typo ("OSK 001" → "OSK-001" is a
// step too far, but "OSK 001" → "OSK001" matches how staff read it back).
export const upper = (s) => squish(s).toUpperCase();
export const code  = (s) => squish(s).toUpperCase().replace(/\s+/g, '');

// Emails and usernames — case is never meaningful and mixed case causes
// duplicate-account bugs at login.
export const lower = (s) => squish(s).toLowerCase();

// Words that stay lowercase inside a title, and forms that must stay uppercase.
// Deliberately small: over-eager lists mangle real business names.
const MINOR = new Set(['a', 'an', 'and', 'at', 'by', 'de', 'for', 'in', 'ng', 'o', 'of', 'on', 'or', 'sa', 'the', 'to', 'vs']);
// True acronyms only. Company suffixes (Inc, Co, Corp) and generational
// suffixes (Jr, Sr) are deliberately NOT here — "Kasa Lokal Inc" is the normal
// written form; "Kasa Lokal INC" reads like shouting.
const ACRONYM = new Set(['BIR', 'PH', 'LLC', 'OPC', 'DTI', 'SEC', 'BPI', 'VAT', 'AR', 'AP', 'PO', 'DR', 'SKU', 'II', 'III', 'IV']);

const titleWord = (w, isFirst, isLast) => {
  if (!w) return w;
  const bare = w.replace(/[^A-Za-z0-9]/g, '');
  // Preserve things that are already meaningful in caps: acronyms, and any
  // token carrying a digit ("1L", "A4", "3M") which title-casing would break.
  if (ACRONYM.has(bare.toUpperCase())) return w.toUpperCase();
  if (/\d/.test(w)) return w.toUpperCase();
  const lc = w.toLowerCase();
  if (!isFirst && !isLast && MINOR.has(lc)) return lc;
  // Capitalize the first letter of each punctuation-separated segment, so
  // "coca-cola" → "Coca-Cola" and "o'brien" → "O'Brien". Segments of a single
  // letter after an apostrophe are left alone — that's a contraction or a
  // possessive ("don't", "kanto's"), not a name part.
  return lc.replace(/[A-Za-z]+/g, (seg, at) => {
    const prev = lc[at - 1];
    const isContraction = prev === "'" && seg.length === 1;
    return isContraction ? seg : seg[0].toUpperCase() + seg.slice(1);
  });
};

// Product / supplier / client / category / payee names.
export const title = (s) => {
  const words = squish(s).split(' ');
  return words.map((w, i) => titleWord(w, i === 0, i === words.length - 1)).join(' ');
};

// Free text (notes, reasons, addresses) — whitespace-tidied only. Never
// re-cased: "DO NOT STACK" and a typed paragraph both mean what they say.
export const freeText = (s) => String(s ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// ── Number coercion ──────────────────────────────────────────────────────────
// Accepts what people actually type into a peso field: "1,500", "₱1,500.00",
// " 1500 ", 1500. Returns NaN for anything else so Zod can reject it.
export const toNumber = (v) => {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  const cleaned = String(v).replace(/[₱,\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
};

// ── Zod helpers ──────────────────────────────────────────────────────────────
// Usage: zTitle(z).max(120), zCode(z), zMoneyLoose(z)
// `z` is passed in rather than imported so this file stays dependency-free and
// trivially unit-testable.
export const zTitle = (z, max = 120) => z.preprocess(title, z.string().min(1).max(max));
export const zCode  = (z, max = 60)  => z.preprocess(code,  z.string().min(1).max(max));
export const zUpper = (z, max = 60)  => z.preprocess(upper, z.string().min(1).max(max));
export const zLower = (z, max = 120) => z.preprocess(lower, z.string().min(1).max(max));
export const zText  = (z, max = 2000) => z.preprocess(freeText, z.string().max(max));

// Money that tolerates "1,500" from the UI but still rejects junk and negatives.
export const zMoneyLoose = (z) => z.preprocess(toNumber, z.number().finite().min(0));
// For fields where a negative genuinely means something (adjustments, variance).
export const zSignedLoose = (z) => z.preprocess(toNumber, z.number().finite());
