// The setup workbook: every import template in one file, and that file read
// back in. Shared by the "Start from templates" card (a file from disk) and by
// the Settings card that pulls the same workbook from a linked Google Sheet, so
// both do exactly the same thing with it.

// Dependency order: a bill names a supplier, so suppliers come first.
// `perm` is what the importer itself requires; a sheet the person cannot import
// is left out of the workbook rather than failing after they have filled it.
export const TEMPLATES = [
  { key: 'suppliers', sheet: 'Suppliers', perm: (can) => can('procurement.manage') },
  { key: 'clients', sheet: 'Clients', perm: (can, su) => su, logOnly: true },
  { key: 'inventory', sheet: 'Inventory', perm: (can, su) => su, preview: true },
  { key: 'bills', sheet: 'Bills', perm: (can) => can('accounting.manage') },
  { key: 'expenses', sheet: 'Expenses', perm: (can) => can('accounting.manage') },
  { key: 'fixedAssets', sheet: 'Fixed Assets', perm: (can) => can('accounting.manage') },
];

export const availableTemplates = (can, isSuperAdmin, businessType) =>
  TEMPLATES.filter((t) => (!t.logOnly || businessType === 'log') && t.perm(can, isSuperAdmin));

export const endpointFor = (key) => ({
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
export async function runSetupImport(steps, { apiFetch, parseImportFile, onProgress = () => {} }) {
  const results = [];
  let inventoryStep = null;
  for (const s of steps) {
    if (s.preview) { inventoryStep = s; continue; }
    onProgress(`Importing ${s.sheet}…`);
    const rows = s.grid.slice(1).map((row) => Object.fromEntries(s.header.map((h, i) => {
      const v = row[i];
      return [h, v instanceof Date ? localDate(v) : v];
    })));
    try {
      const d = await (await apiFetch(`/api/${endpointFor(s.key)}`, { method: 'POST', body: JSON.stringify({ rows }) })).json();
      results.push({
        sheet: s.sheet, ok: !!d.success,
        created: d.created ?? d.imported ?? (d.success ? rows.length - (d.skipped || []).length : 0),
        skipped: (d.skipped || []).map((x) => `Row ${s.sheetRows[(Number(x.row) || 1) - 1] ?? x.row}: ${x.error || x.reason || 'not added'}`),
        error: d.success ? '' : (d.error || 'Import failed.'),
        extra: d.note || '',
      });
    } catch {
      results.push({ sheet: s.sheet, ok: false, created: 0, skipped: [], error: 'No connection to the server.' });
    }
  }
  onProgress('');

  if (inventoryStep && parseImportFile) {
    const XLSX = await import('xlsx');
    const out = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(inventoryStep.grid), 'Inventory');
    const bytes = XLSX.write(out, { type: 'array', bookType: 'xlsx' });
    const f = new File([bytes], 'Inventory.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await parseImportFile(f);
  }
  return { results, inventory: inventoryStep ? inventoryStep.count : 0 };
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
