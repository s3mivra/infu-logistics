// The setup workbook: every import template in one file, and that file read
// back in. Shared by the "Start from templates" card (a file from disk) and by
// the Settings card that pulls the same workbook from a linked Google Sheet, so
// both do exactly the same thing with it.

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
  { key: 'pnlHistory', sheet: 'P&L History', perm: books },
  { key: 'openingBalances', sheet: 'Opening Balances', perm: books },
  { key: 'openReceivables', sheet: 'Open Receivables', perm: books },
  { key: 'openPayables', sheet: 'Open Payables', perm: books },
  { key: 'bills', sheet: 'Bills', perm: books },
  { key: 'expenses', sheet: 'Expenses', perm: books },
  { key: 'fixedAssets', sheet: 'Fixed Assets', perm: books },
];

export const availableTemplates = (can, isSuperAdmin, businessType) =>
  TEMPLATES.filter((t) => (!t.logOnly || businessType === 'log') && t.perm(can, isSuperAdmin));

export const endpointFor = (key) => ({
  accounts: 'setup/accounts/import',
  pnlHistory: 'setup/pnl-history/import',
  openingBalances: 'setup/opening-balances/import',
  openReceivables: 'setup/open-receivables/import',
  openPayables: 'setup/open-payables/import',
  suppliers: 'suppliers/import',
  clients: 'client-accounts/import',
  bills: 'bills/import',
  expenses: 'expenses/import',
  fixedAssets: 'fixed-assets/import',
}[key]);

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
    const ws = wb.Sheets[t.sheet];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });   // blank rows kept, so row numbers match the sheet
    if (grid.length < 2) continue;
    const header = grid[0].map((h) => String(h ?? '').trim());
    // The example row, as the template wrote it, so an untouched one is skipped.
    let example = null;
    try {
      const d = await (await apiFetch(`/api/export/${t.key}?template=1`)).json();
      if (d.success) example = (d.example || []).map((v) => String(v ?? '').trim());
    } catch { /* compare nothing */ }
    const kept = [];
    let skippedExample = 0;
    grid.slice(1).forEach((row, i) => {
      if (!row.some((v) => !isBlank(v))) return;
      if (example && header.every((_, c) => cellText(row[c]) === (example[c] ?? ''))) { skippedExample++; return; }
      kept.push({ row, sheetRow: i + 2 });
    });
    if (!kept.length) continue;
    steps.push({ ...t, header, grid: [grid[0], ...kept.map((k) => k.row)], sheetRows: kept.map((k) => k.sheetRow), count: kept.length, skippedExample });
  }
  return steps;
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
    }[s.key] || {};
    // "Row 3" from the server counts the rows it was sent; say the sheet's row.
    const sheetRow = (n) => s.sheetRows[(Number(n) || 1) - 1] ?? n;
    try {
      const d = await (await apiFetch(`/api/${endpointFor(s.key)}`, { method: 'POST', body: JSON.stringify({ rows, ...extra }) })).json();
      if (d.success) outcome[s.key] = d;
      results.push({
        key: s.key, sheet: s.sheet, ok: !!d.success,
        created: d.created ?? d.imported ?? (d.success ? rows.length - (d.skipped || []).length : 0),
        skipped: [
          ...(d.skipped || []).map((x) => `Row ${sheetRow(x.row)}: ${x.error || x.reason || 'not added'}`),
          ...(d.problems || []).map((p) => String(p).replace(/^Row (\d+):/, (_, n) => `Row ${sheetRow(n)}:`)),
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

const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
    if (stock) checks.push({ ok: null, text: `Stock opens in a preview - confirm it there. Its value should come to the Inventory on the balance sheet (${peso(c.inventory)}); Reports → Books Health compares the two.` });
  }
  return checks;
}

// The workbook itself: one sheet per template, a read-me, the column guide and
// the reference lists. Returned as a workbook for the caller to save.
export async function buildSetupWorkbook(XLSX, available, apiFetch) {
  const specs = [];
  for (const t of available) {
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
    ['Moving over from books you already keep? Fill Chart of Accounts (only if your books use their own codes), P&L History, Opening Balances, Open Receivables and Open Payables.'],
    ['Opening Balances is your balance sheet on the switch-over day, and it is the only sheet that posts balances. Stock, fixed assets and the open invoices and bills are then registered without posting - they are the detail behind that balance sheet - and the result checks that each one adds up to it.'],
    ['Or keep it in Google Sheets and link it: Settings → Setup workbook from Google Sheets.'],
    [],
    ['Sheet', 'What it adds', 'Done in this order because'],
    ...specs.map((s, i) => [s.sheet, s.intro || '', i === 0 ? 'Goes first.' : `Comes after ${specs.slice(0, i).map((x) => x.sheet).join(', ')}.`]),
    [],
    ['Menu products are not in this workbook - they have their own sheet with recipes and sizes: Menu Setup → Menu Sheet.'],
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
