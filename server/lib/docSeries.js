// Document numbering - one place that decides what every document a person
// actually holds is called.
//
// The numbers were hard-coded prefix by prefix, scattered across the routes
// that issued them, so a business whose books already say "SI-2026-000123"
// had no way to make this system agree with its own paperwork. Worse, the
// billing counter was keyed on "BIL-..." but stored the number WITHOUT it, so
// billing statements came out as a bare "2026-09-0001" that matched nothing.
//
// Only the series a human sees are listed here. The internal journal
// references (INV-SPOIL, ADV-JE, EXCHANGE and the like) are machine plumbing
// that nobody types or quotes, and giving them a settings field would be fifty
// boxes of noise hiding the eight that matter.
//
// IMPORTANT: the prefix is a LABEL, not an identity. Each series keeps
// counting in a Counter keyed on its canonical `code`, so renaming a prefix
// never resets a sequence, never collides with the numbers already issued, and
// never has to migrate anything.

// `sample` shows the operator what their choice will actually print, which is
// the only way to make a numbering field self-explanatory.
export const DOC_SERIES = [
  {
    code: 'ORD', key: 'docPrefixORD', defaultPrefix: 'ORD',
    label: 'Order', note: 'The ticket number, from the moment an order is placed.',
    sample: (p) => `${p}-2026-A0007`,
  },
  {
    code: 'BIL', key: 'docPrefixBIL', defaultPrefix: 'BIL',
    label: 'Billing statement', note: 'Restarts each month.',
    sample: (p) => `${p}-2026-09-0001`,
  },
  {
    code: 'OR', key: 'orPrefix', defaultPrefix: 'OR', registered: true,
    label: 'Official receipt', note: 'The registered serial. Never restarts - it runs unbroken for the life of the series.',
    sample: (p) => `${p}-00001251`,
  },
  {
    code: 'QUO', key: 'docPrefixQUO', defaultPrefix: 'QUO',
    label: 'Quotation', note: 'What you send a client before they commit.',
    sample: (p) => `${p}-2026-000014`,
  },
  {
    code: 'PO', key: 'docPrefixPO', defaultPrefix: 'PO',
    label: 'Purchase order', note: 'What you send a supplier.',
    sample: (p) => `${p}-2026-000031`,
  },
  {
    code: 'BILL', key: 'docPrefixBILL', defaultPrefix: 'BILL',
    label: "Supplier's bill", note: 'A payable raised against a supplier.',
    sample: (p) => `${p}-2026-000042`,
  },
  {
    code: 'CV', key: 'docPrefixCV', defaultPrefix: 'CV',
    label: 'Check voucher', note: 'The paper trail for money going out.',
    sample: (p) => `${p}-2026-000018`,
  },
  {
    code: 'ADV', key: 'docPrefixADV', defaultPrefix: 'ADV',
    label: 'Advance', note: 'A deposit taken, or money fronted to a supplier.',
    sample: (p) => `${p}-2026-000005`,
  },
  {
    code: 'PAY', key: 'docPrefixPAY', defaultPrefix: 'PAY',
    label: 'Payroll run', note: 'One per pay period.',
    sample: (p) => `${p}-2026-000009`,
  },
];

const BY_CODE = new Map(DOC_SERIES.map((s) => [s.code, s]));
const BY_KEY = new Map(DOC_SERIES.map((s) => [s.key, s]));

export const isSeriesKey = (key) => BY_KEY.has(key);
export const seriesForKey = (key) => BY_KEY.get(key) || null;

// A prefix is a short token, not a format string: letters, digits and the odd
// slash, upper-cased. Separators are the formatter's job, so a trailing dash or
// space is trimmed rather than doubled up ("OR-" and "OR" both print OR-0001).
// Anything left empty falls back to the default, because a document with no
// prefix at all is just a bare number nobody can place.
export function normalizePrefix(raw, fallback = '') {
  const cleaned = String(raw == null ? '' : raw)
    .toUpperCase()
    .replace(/[^A-Z0-9/-]/g, '')
    .replace(/^[-/]+|[-/]+$/g, '')
    .slice(0, 12);
  return cleaned || fallback;
}

// Read on every document write, changed about once in a deployment's life - so
// it is cached, and the settings route clears it the moment one is edited.
let cache = { at: 0, map: null };
const TTL_MS = 60_000;

export function invalidateSeriesCache() { cache = { at: 0, map: null }; }

export async function loadSeriesPrefixes(Settings) {
  if (cache.map && Date.now() - cache.at < TTL_MS) return cache.map;
  const map = new Map(DOC_SERIES.map((s) => [s.code, s.defaultPrefix]));
  try {
    const rows = await Settings.find({ key: { $in: DOC_SERIES.map((s) => s.key) } }).lean();
    for (const row of rows) {
      const series = BY_KEY.get(row.key);
      if (series) map.set(series.code, normalizePrefix(row.value, series.defaultPrefix));
    }
    cache = { at: Date.now(), map };
  } catch {
    // A settings read failing must never stop a sale being numbered; the
    // defaults are always a valid series.
  }
  return map;
}

export async function seriesPrefix(Settings, code) {
  const map = await loadSeriesPrefixes(Settings);
  return map.get(code) || BY_CODE.get(code)?.defaultPrefix || code;
}

// What the Settings screen renders: every series, its current prefix and what
// that prefix will actually print.
export function describeSeries(prefixMap) {
  return DOC_SERIES.map((s) => {
    const prefix = prefixMap?.get?.(s.code) ?? s.defaultPrefix;
    return {
      code: s.code, key: s.key, label: s.label, note: s.note,
      registered: !!s.registered,
      defaultPrefix: s.defaultPrefix,
      prefix,
      sample: s.sample(prefix),
    };
  });
}
