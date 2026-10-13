import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { TEMPLATES, availableTemplates, readSetupWorkbook, runSetupImport, bookChecks, mergeImportReplies, previewStep } from './setupWorkbook';

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
      'Chart of Accounts', 'Suppliers', 'Inventory', 'Price Tiers', 'P&L History', 'Opening Balances', 'Open Receivables', 'Purchase Orders', 'Open Payables',
      'Open Deposits & Advances', 'Bills', 'Expenses', 'Fixed Assets', 'Orders',
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

  it('keeps a real row that happens to read like the example, anywhere below row 2', async () => {
    // Filled in over the example: the business's own first row sits on row 2
    // and matches nothing; a later row that equals the example is still data.
    const filled = { Suppliers: [['name', 'contactPerson', 'phone'], ['Acme Coffee', 'Ben', '0918'], ['Example Supplier', 'Ana', '0917']] };
    const steps = await readSetupWorkbook(XLSX, book(filled), availableTemplates(can, true, 'fb'), server());
    expect(steps.map(s => [s.sheet, s.count, s.skippedExample])).toEqual([['Suppliers', 2, 0]]);
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
  it('checks each kind of deposit and advance against its own account', () => {
    const withDeposits = { balancingToCapital: 0, controls: { customerDeposit: 5000, supplierAdvance: 3000, employeeAdvance: 0 } };
    const checks = bookChecks({ openingBalances: withDeposits, openDeposits: { totals: { customerDeposit: 5000, supplierAdvance: 2500, employeeAdvance: 0 } } });
    const dep = checks.find(c => /Customer deposits/.test(c.text));
    const sup = checks.find(c => /Supplier advances/.test(c.text));
    expect(dep).toMatchObject({ ok: true });
    expect(sup).toMatchObject({ ok: false });
    expect(sup.text).toMatch(/₱500.00 apart.*Advances to Suppliers/);
    expect(checks.some(c => /Employee advances/.test(c.text))).toBe(false); // nothing on either side
  });
  it('with no P&L, expects the balance sheet to balance by itself', () => {
    expect(bookChecks({ openingBalances: { balancingToCapital: 0, controls: {} } })).toEqual([{ ok: true, text: 'The balance sheet balances by itself.' }]);
  });
});

describe('an Orders export brought back', () => {
  it('finds an older export by its headings, and sends its product lines along', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Order No', 'OR No', 'Date', 'Customer', 'Status', 'Payment', 'Subtotal', 'Discount', 'Total'],
      ['ORD-2026-A0742', '', '2026-09-30', 'COSTA VERDE', 'Completed', 'On Account', 126410, 0, 126410],
    ]), 'Data');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Order No', 'Code', 'Product', 'Qty', 'Unit Price', 'Line Discount %'],
      ['ORD-2026-A0742', 'P40022', 'BD LYCHEE 2L', 5, 395, 0],
    ]), 'Order Lines');
    const steps = await readSetupWorkbook(XLSX, wb, availableTemplates(can, true, 'log'), async () => ({ json: async () => ({ success: false }) }));
    const orders = steps.find(s => s.key === 'orders');
    expect(orders.count).toBe(1);
    expect(orders.lines).toHaveLength(1);
    expect(orders.lines[0]).toMatchObject({ 'Order No': 'ORD-2026-A0742', Qty: 5 });
  });

  it('is never written into the setup workbook itself', () => {
    expect(TEMPLATES.find(t => t.key === 'orders').notInWorkbook).toBe(true);
  });
});

describe('a sheet longer than one request takes', () => {
  it('goes up in batches, and names rows by where they sit in the whole sheet', async () => {
    const rows = Array.from({ length: 1201 }, (_, i) => [`Supplier ${i + 1}`, 'Ana', '0917']);
    const wb = book({ Suppliers: [['name', 'contactPerson', 'phone'], ...rows] });
    const steps = await readSetupWorkbook(XLSX, wb, availableTemplates(can, true, 'log'), server());
    const sent = [];
    const apiFetch = async (path, init) => {
      const body = JSON.parse(init.body);
      sent.push(body.rows.length);
      // The second row of every batch is refused.
      return { json: async () => ({ success: true, created: body.rows.length - 1, skipped: [{ row: 2, error: 'already exists' }] }) };
    };
    const done = await runSetupImport(steps, { apiFetch, parseImportFile: vi.fn() });
    expect(sent).toEqual([500, 500, 201]);
    const r = done.results[0];
    expect(r.ok).toBe(true);
    expect(r.created).toBe(1198);
    // Sheet rows: header is row 1, so the 2nd row of each batch is row 3, 503, 1003.
    expect(r.skipped).toEqual(['Row 3: already exists', 'Row 503: already exists', 'Row 1003: already exists']);
  });

  it('adds the batches\' totals, which the closing checks compare with the balance sheet', () => {
    const d = mergeImportReplies([
      { offset: 0, d: { success: true, created: 500, total: 1000.1, totals: { customerDeposit: 5 } } },
      { offset: 500, d: { success: true, created: 20, total: 0.2, totals: { customerDeposit: 2.5, supplierAdvance: 1 } } },
    ]);
    expect(d).toMatchObject({ success: true, created: 520, total: 1000.3, totals: { customerDeposit: 7.5, supplierAdvance: 1 } });
  });

  it('says so when one batch was refused and the others went in', () => {
    const d = mergeImportReplies([
      { offset: 0, d: { success: true, created: 500 } },
      { offset: 500, d: { success: false, error: 'No connection.' } },
    ]);
    expect(d.success).toBe(true);
    expect(d.partFailed).toBe(true);
    expect(d.errors).toEqual(['No connection.']);
  });

  it('sends an order\'s product lines with the batch its order is in', async () => {
    const orders = Array.from({ length: 501 }, (_, i) => ({ 'Order No': `ORD-${i + 1}`, Date: '2026-09-01', Customer: 'A', Total: 10 }));
    const step = { key: 'orders', sheet: 'Orders', header: Object.keys(orders[0]), grid: [Object.keys(orders[0]), ...orders.map((o) => Object.values(o))],
      sheetRows: orders.map((_, i) => i + 2), count: orders.length, lines: [{ 'Order No': 'ORD-1', Product: 'X' }, { 'Order No': 'ORD-501', Product: 'Y' }] };
    const sent = [];
    const apiFetch = async (path, init) => { const b = JSON.parse(init.body); sent.push(b.lines.map((l) => l['Order No'])); return { json: async () => ({ success: true, created: b.rows.length }) }; };
    await runSetupImport([step], { apiFetch, parseImportFile: vi.fn() });
    expect(sent).toEqual([['ORD-1'], ['ORD-501']]);
  });
});

describe('a look at a sheet before it is imported', () => {
  const step = (header, rows, fields) => ({
    key: 'openReceivables', sheet: 'Open Receivables', header, fields, columns: fields.map((f) => f.name),
    grid: [header, ...rows], sheetRows: rows.map((_, i) => i + 2), count: rows.length,
  });
  const fields = [{ name: 'customer', required: true }, { name: 'invoiceNo', required: true }, { name: 'invoiceDate', required: true }, { name: 'dueDate' }, { name: 'amountOwed', required: true }];
  const header = fields.map((f) => f.name);

  it('says a clean sheet is ready, and shows its first rows as they will go in', () => {
    const pv = previewStep(step(header, [
      ['Reyes Hardware', 'SI-1', new Date(2026, 8, 30), '10/30/2026', '1,000.00'],
      ['Dela Cruz', 'SI-2', '2026-09-01', '', 500],
    ], fields));
    expect(pv.ready).toBe(true);
    expect(pv.problems).toEqual([]);
    expect(pv.sample[0]).toEqual(['Reyes Hardware', 'SI-1', '2026-09-30', '10/30/2026', '1,000.00']);
  });

  it('names the row and the cell for each plain slip', () => {
    const pv = previewStep(step(header, [
      ['Reyes Hardware', '', '2026-09-30', '', 100],          // row 2: no invoice number
      ['Dela Cruz', 'SI-2', '########', '', 'lots'],          // row 3: a too-narrow date, and not an amount
      ['Good Co', 'SI-3', 'Sept 30, 2026', 46295, '(250)'],   // row 4: fine
    ], fields));
    expect(pv.ready).toBe(false);
    expect(pv.problemRows).toBe(2);
    expect(pv.problems[0]).toMatch(/^Row 2: invoiceNo is empty/);
    expect(pv.problems[1]).toMatch(/^Row 3: invoiceDate shows "########".*amountOwed "lots" is not a number/);
  });

  it('says when a required column is not in the sheet at all, and which columns will be ignored', () => {
    const pv = previewStep(step(['customer', 'invoiceNo', 'amountOwed', 'my notes'], [['A', 'SI-1', 10, 'x']], fields));
    expect(pv.problems[0]).toMatch(/"invoiceDate" column is missing/);
    expect(pv.unknownColumns).toEqual(['my notes']);
  });

  it('keeps the list short and says how many more there are', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [`C${i}`, '', '2026-09-30', '', 1]);
    const pv = previewStep(step(header, rows, fields));
    expect(pv.problems).toHaveLength(8);
    expect(pv.moreProblems).toBe(22);
  });
});
