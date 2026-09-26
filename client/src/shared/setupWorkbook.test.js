import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { availableTemplates, readSetupWorkbook, runSetupImport, bookChecks } from './setupWorkbook';

// The workbook as someone fills it in: a sheet per import, an untouched example
// row on one of them, and a sheet left empty.
const book = (tabs) => {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true });
};

// The server, as far as this module can tell: templates say what the example
// row is, and each importer answers with what it created.
const server = (calls = []) => async (path, init) => {
  calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
  if (path.includes('template=1')) {
    const example = path.includes('suppliers') ? ['Example Supplier', 'Ana', '0917'] : ['Example Item', '1', 'kg'];
    return { json: async () => ({ success: true, example }) };
  }
  return { json: async () => ({ success: true, created: 2 }) };
};

const can = () => true;
const sheets = {
  Suppliers: [['name', 'contactPerson', 'phone'], ['Example Supplier', 'Ana', '0917'], ['Acme Coffee', 'Ben', '0918'], ['', '', '']],
  Inventory: [['Product', 'Pack', 'Unit'], ['Example Item', '1', 'kg'], ['BEANS', '1', 'kg']],
  Bills: [['supplier', 'amount']],   // header only
};

describe('which templates a person gets', () => {
  it('leaves out what they cannot import, and clients unless this is logistics', () => {
    expect(availableTemplates(can, true, 'fb').map(t => t.sheet)).toEqual([
      'Chart of Accounts', 'Suppliers', 'Inventory', 'P&L History', 'Opening Balances', 'Open Receivables', 'Open Payables',
      'Bills', 'Expenses', 'Fixed Assets',
    ]);
    expect(availableTemplates(can, true, 'log').map(t => t.sheet)).toContain('Clients');
    // A manager without accounting rights gets none of the accounting sheets.
    const limited = (perm) => perm === 'procurement.manage';
    expect(availableTemplates(limited, false, 'fb').map(t => t.sheet)).toEqual(['Suppliers']);
  });
});

describe('reading the workbook', () => {
  it('keeps real rows, skips the untouched example and an empty sheet', async () => {
    const steps = await readSetupWorkbook(XLSX, book(sheets), availableTemplates(can, true, 'fb'), server());
    expect(steps.map(s => [s.sheet, s.count, s.skippedExample])).toEqual([['Suppliers', 1, 1], ['Inventory', 1, 1]]);
  });

  it('remembers each row\'s number in the sheet, so a message can name it', async () => {
    const steps = await readSetupWorkbook(XLSX, book(sheets), availableTemplates(can, true, 'fb'), server());
    // Row 2 was the example, so the supplier kept is row 3 of the sheet.
    expect(steps[0].sheetRows).toEqual([3]);
  });

  it('finds nothing in a workbook of empty sheets', async () => {
    const steps = await readSetupWorkbook(XLSX, book({ Suppliers: [['name']], Bills: [['supplier']] }), availableTemplates(can, true, 'fb'), server());
    expect(steps).toEqual([]);
  });
});

describe('importing it', () => {
  it('sends each sheet to its own importer, in order, and stock to the preview', async () => {
    const calls = [];
    const parseImportFile = vi.fn();
    const steps = await readSetupWorkbook(XLSX, book(sheets), availableTemplates(can, true, 'fb'), server());
    const done = await runSetupImport(steps, { apiFetch: server(calls), parseImportFile });

    const posted = calls.filter(c => c.body).map(c => c.path);
    expect(posted).toEqual(['/api/suppliers/import']);      // stock is not posted; it opens the preview
    expect(calls.find(c => c.body).body.rows).toEqual([{ name: 'Acme Coffee', contactPerson: 'Ben', phone: '0918' }]);
    expect(done.results).toEqual([{ key: 'suppliers', sheet: 'Suppliers', ok: true, created: 2, skipped: [], error: '', extra: '' }]);
    expect(done.inventory).toBe(1);
    expect(parseImportFile).toHaveBeenCalledOnce();

    // What the preview receives is a workbook holding just those stock rows.
    const file = parseImportFile.mock.calls[0][0];
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Inventory).map(({ __rowNum__, ...r }) => r);
    // The cells go through as they were typed - a text "1" stays text, which is
    // what the stock reader expects to see.
    expect(rows).toEqual([{ Product: 'BEANS', Pack: '1', Unit: 'kg' }]);
  });

  it('reports a sheet the server refused, without stopping the rest', async () => {
    const steps = await readSetupWorkbook(XLSX, book(sheets), availableTemplates(can, true, 'fb'), server());
    const apiFetch = async (path, init) => {
      if (path.includes('template=1')) return { json: async () => ({ success: true, example: [] }) };
      if (path.includes('suppliers')) return { json: async () => ({ success: false, error: 'Supplier name is required.' }) };
      return { json: async () => ({ success: true, created: 1 }) };
    };
    const done = await runSetupImport(steps, { apiFetch, parseImportFile: vi.fn() });
    expect(done.results[0]).toMatchObject({ sheet: 'Suppliers', ok: false, error: 'Supplier name is required.' });
  });

  it('names the sheet row a rejected row came from', async () => {
    const steps = await readSetupWorkbook(XLSX, book(sheets), availableTemplates(can, true, 'fb'), server());
    const apiFetch = async (path) => (path.includes('template=1')
      ? { json: async () => ({ success: true, example: [] }) }
      : { json: async () => ({ success: true, created: 0, skipped: [{ row: 1, error: 'already on file' }] }) });
    const done = await runSetupImport(steps, { apiFetch, parseImportFile: vi.fn() });
    expect(done.results[0].skipped).toEqual(['Row 3: already on file']);
  });
});

describe('carrying a set of books in', () => {
  const books = {
    'P&L History': [['code', 'year', 'jan'], ['B-410101', 2026, 1000]],
    'Opening Balances': [['code', 'balance', 'asOf'], ['B-101501', 5000, '2026-02-28']],
    'Fixed Assets': [['name', 'class', 'acquisitionCost'], ['Printer', '140200', 1200]],
    Inventory: [['Product', 'Pack', 'Unit'], ['BEANS', '1', 'kg']],
  };
  const ledger = (calls, answers = {}) => async (path, init) => {
    if (path.includes('template=1')) return { json: async () => ({ success: true, example: [] }) };
    calls.push({ path, body: JSON.parse(init.body) });
    const key = Object.keys(answers).find(k => path.includes(k));
    return { json: async () => (key ? answers[key] : { success: true, created: 1 }) };
  };

  it('tells the balance sheet the P&L posted, and registers stock and assets without posting', async () => {
    const calls = [];
    const parseImportFile = vi.fn();
    const steps = await readSetupWorkbook(XLSX, book(books), availableTemplates(can, true, 'log'), ledger([]));
    await runSetupImport(steps, { apiFetch: ledger(calls, { 'pnl-history': { success: true, created: 1, netIncome: 1000 } }), parseImportFile });
    expect(calls.map(c => c.path)).toEqual(['/api/setup/pnl-history/import', '/api/setup/opening-balances/import', '/api/fixed-assets/import']);
    expect(calls[1].body.pnlHistory).toBe(true);
    expect(calls[2].body.opening).toBe(true);
    expect(parseImportFile.mock.calls[0][1]).toEqual({ opening: true });
  });

  it('keeps the net income line when the P&L did not post', async () => {
    const calls = [];
    const steps = await readSetupWorkbook(XLSX, book(books), availableTemplates(can, true, 'log'), ledger([]));
    await runSetupImport(steps, { apiFetch: ledger(calls, { 'pnl-history': { success: false, error: 'Nothing was posted.', problems: ['Row 1: "B-9" is not an account.'] } }), parseImportFile: vi.fn() });
    expect(calls.find(c => c.path.includes('opening-balances')).body.pnlHistory).toBe(false);
  });

  it('points a problem at the row in the sheet', async () => {
    const steps = await readSetupWorkbook(XLSX, book(books), availableTemplates(can, true, 'log'), ledger([]));
    const done = await runSetupImport(steps, { apiFetch: ledger([], { 'pnl-history': { success: false, error: 'Nothing was posted.', problems: ['Row 1: "B-9" is not an account.'] } }), parseImportFile: vi.fn() });
    expect(done.results[0].skipped).toEqual(['Row 2: "B-9" is not an account.']);
  });
});

describe('do the books agree', () => {
  const ob = { balancingToCapital: 1050, controls: { receivables: 1500, payables: 900, inventory: 2000 } };
  it('says so when the P&L, the balance sheet and the registers all tie out', () => {
    const checks = bookChecks({ openingBalances: ob, pnlHistory: { netIncome: 1050 }, openReceivables: { total: 1500 }, openPayables: { total: 900 } });
    expect(checks.map(c => c.ok)).toEqual([true, true, true]);
  });
  it('says by how much when they do not', () => {
    const checks = bookChecks({ openingBalances: ob, pnlHistory: { netIncome: 1250 }, openReceivables: { total: 1000 } }, { stock: true });
    expect(checks[0]).toMatchObject({ ok: false });
    expect(checks[0].text).toMatch(/₱200\.00 apart/);
    expect(checks[1].text).toMatch(/₱500\.00 apart/);
    expect(checks[2]).toMatchObject({ ok: false });        // AP on the balance sheet, no bills listed
    expect(checks[3]).toMatchObject({ ok: null });         // stock is checked after its preview
  });
  it('with no P&L, expects the balance sheet to balance by itself', () => {
    expect(bookChecks({ openingBalances: { balancingToCapital: 0, controls: {} } })).toEqual([{ ok: true, text: 'The balance sheet balances by itself.' }]);
  });
});
