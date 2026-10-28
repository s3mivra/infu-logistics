// The setup workbook: every import template in one file, and that file read
// back in. Shared by the "Start from templates" card (a file from disk) and by
// the Settings card that pulls the same workbook from a linked Google Sheet, so
// both do exactly the same thing with it.
import { formatPeso } from './money.js';

// Dependency order: a bill names a supplier, so suppliers come first; every
// accounting sheet can use the old books' own account codes, so the chart of
// accounts comes before all of them; the P&L goes before the balance sheet,
// which needs to know whether it posted.
// `perm` is what the importer itself requires; a sheet the person cannot import
// is left out of the workbook rather than failing after they have filled it.
const books = (can) => can('accounting.manage');
export const TEMPLATES = [
  { key: 'accounts', sheet: 'Chart of Accounts', perm: books },
  { key: 'suppliers', sheet: 'Suppliers', perm: (can) => can('procurement.manage') },
  { key: 'clients', sheet: 'Clients', perm: (can, su) => su, logOnly: true },
  { key: 'inventory', sheet: 'Inventory', perm: (can, su) => su, preview: true },
  // After Inventory: its products are what the tiers price. Prices for products
  // the Inventory preview has not created yet wait and apply once it is confirmed.
  { key: 'priceTiers', sheet: 'Price Tiers', perm: (can) => can('pricing.tiers') },
  { key: 'pnlHistory', sheet: 'P&L History', perm: books },
  { key: 'openingBalances', sheet: 'Opening Balances', perm: books },
  { key: 'openReceivables', sheet: 'Open Receivables', perm: books },
  // Before the payables and bills, which can name one of these by PO number.
  { key: 'openPurchaseOrders', sheet: 'Purchase Orders', perm: (can) => can('accounting.manage') && can('procurement.manage') },
  { key: 'openPayables', sheet: 'Open Payables', perm: books },
  // After Clients and Suppliers: a credit balance lives on one of them.
  { key: 'openDeposits', sheet: 'Open Deposits & Advances', perm: books },
  { key: 'bills', sheet: 'Bills', perm: books },
  { key: 'expenses', sheet: 'Expenses', perm: books },
  { key: 'fixedAssets', sheet: 'Fixed Assets', perm: books },
  // An Orders export, brought back (Ledger -> Import). Last: its customers are
  // matched to client accounts, and it posts each sale. Not a sheet of the
  // setup workbook itself - only read when a file carries it. An export from
  // before the sheet was named "Orders" is recognised by its header row.
  { key: 'orders', sheet: 'Orders', perm: (can, su) => su, notInWorkbook: true,
    altHeader: ['Order No', 'Date', 'Customer', 'Total'], linesSheet: 'Order Lines' },
];

export const availableTemplates = (can, isSuperAdmin, businessType) =>
  TEMPLATES.filter((t) => (!t.logOnly || businessType === 'log') && t.perm(can, isSuperAdmin));

export const endpointFor = (key) => ({
  accounts: 'setup/accounts/import',
  pnlHistory: 'setup/pnl-history/import',
  openingBalances: 'setup/opening-balances/import',
  openReceivables: 'setup/open-receivables/import',
  openPurchaseOrders: 'setup/purchase-orders/import',
  openPayables: 'setup/open-payables/import',
  openDeposits: 'setup/open-deposits/import',
  suppliers: 'suppliers/import',
  clients: 'client-accounts/import',
  bills: 'bills/import',
  expenses: 'expenses/import',
  fixedAssets: 'fixed-assets/import',
  orders: 'orders/import',
  priceTiers: 'setup/price-tiers/import',
}[key]);

// Each importer takes only so many rows in one request. A sheet longer than
// that goes up in batches, in order - for the sheets where each row stands on
// its own. The rest must arrive whole: the P&L and the balance sheet are each
// one all-or-nothing posting, and a purchase order's rows share its number.
const BATCH = {
  accounts: 500, suppliers: 500, clients: 500, bills: 500, expenses: 500, fixedAssets: 500,
  openReceivables: 500, openPayables: 500, openDeposits: 500, orders: 500,
};
const sum = (a, b) => Math.round(((Number(a) || 0) + (Number(b) || 0)) * 100) / 100;

// Several batches' answers -> one, as if the sheet had gone up in one request.
// Row numbers are moved back to where the row sits in the whole sheet.
export function mergeImportReplies(replies) {
  const out = { success: replies.some((r) => r.d.success), created: 0, skipped: [], problems: [], total: 0, totals: {}, notes: [], errors: [] };
  for (const { d, offset } of replies) {
    if (!d.success) { out.errors.push(d.error || 'Import failed.'); continue; }
    out.created += Number(d.created ?? d.imported ?? 0) || 0;
    for (const x of d.skipped || []) out.skipped.push({ ...x, row: (Number(x.row) || 1) + offset });
    for (const p of d.problems || []) out.problems.push(String(p).replace(/^Row (\d+):/, (_, n) => `Row ${Number(n) + offset}:`));
    out.total = sum(out.total, d.total);
    for (const [k, v] of Object.entries(d.totals || {})) out.totals[k] = sum(out.totals[k], v);
    if (d.note) out.notes.push(d.note);
  }
  // One batch's note already reads right; several would repeat partial totals.
  out.note = replies.length === 1 ? (out.notes[0] || '') : (out.created ? `${out.created} added, in ${replies.length} batches.` : '');
  out.error = out.errors[0] || '';
  out.partFailed = out.success && out.errors.length > 0;
  return out;
}

const isBlank = (v) => v === '' || v === null || v === undefined;
// A date the person typed arrives as a Date; the importers take YYYY-MM-DD,
// on the calendar day shown - not the UTC one, a day earlier here.
export const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const cellText = (v) => (v instanceof Date ? localDate(v) : String(v ?? '').trim());

// A workbook -> what it would import, sheet by sheet, with each row's number in
// the spreadsheet kept so "row 7" in a message is row 7 on screen.
export async function readSetupWorkbook(XLSX, wb, available, apiFetch) {
  const steps = [];
  for (const t of available) {
    let ws = wb.Sheets[t.sheet];
    // An older export names its only sheet "Data" - known by its headings.
    if (!ws && t.altHeader) {
      const name = wb.SheetNames.find((n) => {
        const head = (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })[0] || []).map((h) => String(h ?? '').trim());
        return t.altHeader.every((h) => head.includes(h));
      });
      if (name) ws = wb.Sheets[name];
    }
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });   // blank rows kept, so row numbers match the sheet
    if (grid.length < 2) continue;
    const header = grid[0].map((h) => String(h ?? '').trim());
    // The example row, as the template wrote it, so an untouched one is skipped.
    let example = null;
    let fields = [], columns = [];
    try {
      const d = await (await apiFetch(`/api/export/${t.key}?template=1`)).json();
      if (d.success) {
        example = (d.example || []).map((v) => String(v ?? '').trim());
        fields = d.fields || []; columns = d.columns || [];
      }
    } catch { /* compare nothing */ }
    const kept = [];
    let skippedExample = 0;
    grid.slice(1).forEach((row, i) => {
      if (!row.some((v) => !isBlank(v))) return;
      // Only row 2 is the example. A real row further down that happens to
      // read the same is data, and dropping it lost a whole year of sales.
      if (i === 0 && example && header.every((_, c) => cellText(row[c]) === (example[c] ?? ''))) { skippedExample++; return; }
      kept.push({ row, sheetRow: i + 2 });
    });
    if (!kept.length) continue;
    // A companion sheet sent along with it (an Orders export's product lines).
    const lines = t.linesSheet && wb.Sheets[t.linesSheet]
      ? XLSX.utils.sheet_to_json(wb.Sheets[t.linesSheet], { defval: '' }).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? localDate(v) : v])))
      : null;
    steps.push({ ...t, header, fields, columns, grid: [grid[0], ...kept.map((k) => k.row)], sheetRows: kept.map((k) => k.sheetRow), count: kept.length, skippedExample, ...(lines ? { lines } : {}) });
  }
  return steps;
}

// ── A look before anything is imported ──────────────────────────────────────
// What a sheet holds, checked against its own template: the first rows as they
// will go in, and the mistakes that can be seen without the server - a
// required cell left empty, a column the import does not know, a date or an
// amount that is not one. It changes nothing and asks the server nothing more.
// The importer still has the last word (it knows what already exists, which
// names match a supplier, which periods are closed); this catches the plain
// slips first, on screen, row by row, before the first sheet posts.
const DATE_COLUMN = /date|asof|^due$/i;
const AMOUNT_COLUMN = /amount|balance|cost|price|qty|quantity|limit|total|salvage|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i;
const looksLikeDate = (v) => {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v === 'number') return v >= 32874 && v <= 73415;            // an Excel date number, 1990-2100
  const s = String(v).trim();
  return /^\d{4}-\d{1,2}-\d{1,2}(T.*)?$/.test(s) || /^\d{1,2}[/.-]\d{1,2}[/.-](\d{2}|\d{4})$/.test(s) || /^\d{4}[/.]\d{1,2}[/.]\d{1,2}$/.test(s)
    || /^[A-Za-z]{3,9}\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{4}$/.test(s) || /^\d{1,2}(st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}\.?,?[\s-]+(\d{2}|\d{4})$/.test(s) || /^\d{5}(\.\d+)?$/.test(s);
};
const looksLikeAmount = (v) => {
  if (typeof v === 'number') return Number.isFinite(v);
  let s = String(v).trim();
  if (/^[-–—]+$/.test(s)) return true;                                   // a dash for nothing
  if (/^\(.*\)$/.test(s)) s = s.slice(1, -1);
  s = s.replace(/[₱$,\s%]/g, '').replace(/^PHP/i, '').replace(/^-/, '');
  return /^\d*\.?\d+$/.test(s);
};

export function previewStep(step, { sampleRows = 3, maxProblems = 8 } = {}) {
  const header = step.header || [];
  const rows = (step.grid || []).slice(1);
  const known = new Set([...(step.columns || []), ...(step.fields || []).map((f) => f.name)].map((c) => String(c).trim().toLowerCase()));
  const has = (name) => header.some((h) => h.toLowerCase() === String(name).toLowerCase());
  const required = (step.fields || []).filter((f) => f.required).map((f) => f.name);

  const problems = [];
  let problemRows = 0;
  const missingColumns = required.filter((name) => !has(name));
  // Only when the template is known: with nothing to compare against, every column would look unknown.
  const unknownColumns = known.size ? header.filter((h) => h && !known.has(h.toLowerCase())) : [];
  for (const name of missingColumns) problems.push(`The "${name}" column is missing - every row needs it.`);

  rows.forEach((row, i) => {
    const sheetRow = step.sheetRows?.[i] ?? i + 2;
    const found = [];
    header.forEach((h, c) => {
      const v = row[c];
      const blank = isBlank(v) || String(v).trim() === '';
      if (blank) { if (required.some((r) => r.toLowerCase() === h.toLowerCase())) found.push(`${h} is empty`); return; }
      if (String(v).trim().startsWith('#####')) { found.push(`${h} shows "${String(v).trim().slice(0, 8)}" - the column was too narrow when it was copied; retype the value`); return; }
      if (DATE_COLUMN.test(h) && !looksLikeDate(v)) found.push(`${h} "${cellText(v)}" is not a date (write it as YYYY-MM-DD)`);
      else if (AMOUNT_COLUMN.test(h) && !DATE_COLUMN.test(h) && !looksLikeAmount(v)) found.push(`${h} "${cellText(v)}" is not a number`);
    });
    if (found.length) {
      problemRows++;
      if (problems.length < maxProblems) problems.push(`Row ${sheetRow}: ${found.join('; ')}.`);
    }
  });

  return {
    key: step.key, sheet: step.sheet, count: rows.length,
    header, sample: rows.slice(0, sampleRows).map((r) => header.map((_, c) => cellText(r[c]))),
    problems, problemRows, moreProblems: Math.max(0, problemRows + missingColumns.length - problems.length),
    unknownColumns, ready: problems.length === 0,
  };
}

// Runs the steps in order, each through the same importer its own screen uses.
// Stock is left to last and handed to the Inventory preview instead - units,
// pack sizes and categories are worth a look before they land.
//
// With an Opening Balances sheet in the workbook, that sheet is the only thing
// that posts balances: stock and fixed assets are registered without posting
// (their value is already on it), as are the open invoices and bills. The
// checks at the end compare each register with the balance it should equal.
export async function runSetupImport(steps, { apiFetch, parseImportFile, onProgress = () => {} }) {
  const results = [];
  const hasOpening = steps.some((s) => s.key === 'openingBalances');
  const outcome = {};                       // key -> the importer's response, when it succeeded
  let inventoryStep = null;
  for (const s of steps) {
    if (s.preview) { inventoryStep = s; continue; }
    onProgress(`Importing ${s.sheet}…`);
    const rows = s.grid.slice(1).map((row) => Object.fromEntries(s.header.map((h, i) => {
      const v = row[i];
      return [h, v instanceof Date ? localDate(v) : v];
    })));
    const extra = {
      // The net income line is left out of the balance sheet only when the
      // P&L months really posted - otherwise it would be lost altogether.
      openingBalances: { pnlHistory: !!outcome.pnlHistory },
      fixedAssets: { opening: hasOpening },
      orders: s.lines ? { lines: s.lines } : {},
    }[s.key] || {};
    // "Row 3" from the server counts the rows it was sent; say the sheet's row.
    const sheetRow = (n) => s.sheetRows[(Number(n) || 1) - 1] ?? n;
    try {
      const size = BATCH[s.key] || rows.length || 1;
      const replies = [];
      for (let at = 0; at < rows.length; at += size) {
        const part = rows.slice(at, at + size);
        if (rows.length > size) onProgress(`Importing ${s.sheet}… ${Math.min(at + size, rows.length)} of ${rows.length}`);
        // An order's product lines travel with the batch its order is in.
        const partExtra = s.key === 'orders' && extra.lines
          ? { lines: (() => { const nos = new Set(part.map((r) => String(r['Order No'] ?? '').trim())); return extra.lines.filter((l) => nos.has(String(l['Order No'] ?? '').trim())); })() }
          : extra;
        const d = await (await apiFetch(`/api/${endpointFor(s.key)}`, { method: 'POST', body: JSON.stringify({ rows: part, ...partExtra }) })).json();
        replies.push({ d, offset: at });
      }
      const single = replies.length === 1 ? replies[0].d : null;
      const d = single || mergeImportReplies(replies);
      if (d.success) outcome[s.key] = d;
      results.push({
        key: s.key, sheet: s.sheet, ok: !!d.success,
        created: d.created ?? d.imported ?? (d.success ? rows.length - (d.skipped || []).length : 0),
        skipped: [
          ...(d.skipped || []).map((x) => `Row ${sheetRow(x.row)}: ${x.error || x.reason || 'not added'}`),
          ...(d.problems || []).map((p) => String(p).replace(/^Row (\d+):/, (_, n) => `Row ${sheetRow(n)}:`)),
          ...(d.partFailed ? d.errors.map((e) => `A batch was refused: ${e}`) : []),
        ],
        error: d.success ? '' : (d.error || 'Import failed.'),
        extra: d.note || '',
      });
    } catch {
      results.push({ key: s.key, sheet: s.sheet, ok: false, created: 0, skipped: [], error: 'No connection to the server.' });
    }
  }
  onProgress('');

  if (inventoryStep && parseImportFile) {
    const XLSX = await import('xlsx');
    const out = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(inventoryStep.grid), 'Inventory');
    const bytes = XLSX.write(out, { type: 'array', bookType: 'xlsx' });
    const f = new File([bytes], 'Inventory.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await parseImportFile(f, { opening: hasOpening });
  }
  return { results, inventory: inventoryStep ? inventoryStep.count : 0, checks: bookChecks(outcome, { stock: !!inventoryStep }) };
}

// [kind key, how the check names it, the account it must equal]
const OPEN_DEPOSIT_CHECKS = [
  ['customerDeposit', 'Customer deposits', 'Customer Advances / Deposits'],
  ['customerCredit', 'Customer credit balances', 'Client Credit Balance'],
  ['supplierAdvance', 'Supplier advances', 'Advances to Suppliers'],
  ['supplierCredit', 'Supplier credit balances', 'Supplier Credit Balance'],
  ['employeeAdvance', 'Employee advances', 'Advances to Employees'],
];

const peso = formatPeso;
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;

// Does what was carried in agree with itself? -> [{ ok: true | false | null, text }]
// (null: nothing to judge yet - it happens after this, somewhere else.)
export function bookChecks(outcome, { stock = false } = {}) {
  const checks = [];
  const ob = outcome.openingBalances;
  const pnl = outcome.pnlHistory;
  if (ob && pnl) {
    const left = (Number(ob.balancingToCapital) || 0) - (Number(pnl.netIncome) || 0);
    checks.push(near(left, 0)
      ? { ok: true, text: `The balance sheet and the P&L agree: net income ${peso(pnl.netIncome)}.` }
      : { ok: false, text: `The balance sheet and the P&L are ${peso(Math.abs(left))} apart - that amount is sitting in Owner's Capital. Usually a P&L amount with the wrong sign, a missing account, or a balance-sheet line left out.` });
  } else if (ob) {
    checks.push(near(ob.balancingToCapital, 0)
      ? { ok: true, text: 'The balance sheet balances by itself.' }
      : { ok: false, text: `The balance sheet was ${peso(Math.abs(ob.balancingToCapital))} out of balance - that went to Owner's Capital. Check for a missing account or a wrong sign.` });
  }
  if (ob) {
    const c = ob.controls || {};
    const compare = (label, registerTotal, control, fix) => checks.push(near(registerTotal, control)
      ? { ok: true, text: `${label} add up to the balance sheet: ${peso(control)}.` }
      : { ok: false, text: `${label} total ${peso(registerTotal)}, but the balance sheet says ${peso(control)} - ${peso(Math.abs(registerTotal - control))} apart. ${fix}` });
    if (outcome.openReceivables || c.receivables) compare('Open invoices', outcome.openReceivables?.total || 0, c.receivables || 0, 'Add the missing invoices, or correct Accounts Receivable - Trade.');
    if (outcome.openPayables || c.payables) compare('Open bills', outcome.openPayables?.total || 0, c.payables || 0, 'Add the missing bills, or correct Accounts Payable - Trade.');
    // Each kind of prepaid money against its own account on the balance sheet.
    for (const [key, label, account] of OPEN_DEPOSIT_CHECKS) {
      const got = outcome.openDeposits?.totals?.[key] || 0;
      if (got || c[key]) compare(label, got, c[key] || 0, `Add the missing rows on Open Deposits & Advances, or correct ${account}.`);
    }
    if (stock) checks.push({ ok: null, text: `Stock opens in a preview - confirm it there. Its value should come to the Inventory on the balance sheet (${peso(c.inventory)}); Reports → Books Health compares the two.` });
  }
  return checks;
}

// The workbook itself: one sheet per template, a read-me, the column guide and
// the reference lists. Returned as a workbook for the caller to save.
export async function buildSetupWorkbook(XLSX, available, apiFetch, { businessType = 'fb' } = {}) {
  const specs = [];
  for (const t of available) {
    if (t.notInWorkbook) continue;
    const d = await (await apiFetch(`/api/export/${t.key}?template=1`)).json();
    if (d.success && d.importable) specs.push({ ...t, ...d });
  }
  if (!specs.length) return null;

  const wb = XLSX.utils.book_new();
  const readMe = [
    ['Setup workbook'],
    [],
    ['Fill in the sheets you need and leave the rest empty - an empty sheet is skipped.'],
    ['Row 2 of every sheet is an example. Overwrite it, or leave it exactly as it is and it will be ignored.'],
    ['Then bring the whole file back: Ledger → Export All → Import all.'],
    [],
    ['Moving over from books you already keep? Fill Chart of Accounts (only if your books use their own codes), P&L History, Opening Balances, Open Receivables, Open Payables and Open Deposits & Advances.'],
    ['Opening Balances is your balance sheet on the switch-over day, and it is the only sheet that posts balances. Stock, fixed assets, the open invoices and bills, and the deposits and advances still unused are then registered without posting - they are the detail behind that balance sheet - and the result checks that each one adds up to it.'],
    ['Orders already placed with suppliers go on Purchase Orders. Put the same poNumber on an Open Payables or Bills row (for the same total) and the two arrive linked - nothing to connect by hand afterwards.'],
    ['Or keep it in Google Sheets and link it: Settings → Setup workbook from Google Sheets.'],
    [],
    ['Sheet', 'What it adds', 'Done in this order because'],
    ...specs.map((s, i) => [s.sheet, s.intro || '', i === 0 ? 'Goes first.' : `Comes after ${specs.slice(0, i).map((x) => x.sheet).join(', ')}.`]),
    [],
    [businessType === 'log'
      ? 'Your catalog comes from the Inventory sheet: each stocked item becomes a product you can sell, priced from its SRP / unit. Adjust prices afterwards in Catalog Setup or Pricing Control.'
      : 'Menu products are not in this workbook - they have their own sheet with recipes and sizes: Menu Setup → Menu Sheet.'],
    ['"How to fill" lists every column: required or not, what to put, and an example. "Valid Values" and "Accounts" list the accepted entries.'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readMe), 'Read me');
  for (const s of specs) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([s.columns, s.example]), s.sheet);

  const guide = [['Sheet', 'Column', 'Required?', 'What to put', 'Example']];
  for (const s of specs) for (const f of s.fields || []) guide.push([s.sheet, f.name, f.required ? 'REQUIRED' : 'optional', f.note || '', String(f.example ?? '')]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(guide), 'How to fill');

  try {
    const vv = await (await apiFetch('/api/export/valid-values')).json();
    if (vv.success) {
      const keys = new Set(specs.map((s) => s.key));
      const rows = vv.table.filter((t) => keys.has(t.dataset)).map((t) => [t.dataset, t.column, t.values.join(' | '), t.note]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([vv.columns, ...rows]), 'Valid Values');
    }
  } catch { /* still usable without it */ }
  try {
    const acc = await (await apiFetch('/api/export/account-balances')).json();
    if (acc.success) {
      const codeIdx = acc.columns.findIndex((c) => /code/i.test(String(c)));
      const nameIdx = acc.columns.findIndex((c) => /name/i.test(String(c)));
      const rows = (acc.rows || []).map((r) => [r[codeIdx >= 0 ? codeIdx : 0], r[nameIdx >= 0 ? nameIdx : 1]]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Code', 'Account'], ...rows]), 'Accounts');
    }
  } catch { /* still usable without it */ }

  return wb;
}
