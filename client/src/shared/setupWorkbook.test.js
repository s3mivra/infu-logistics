import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { availableTemplates, readSetupWorkbook, runSetupImport } from './setupWorkbook';

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
    expect(availableTemplates(can, true, 'fb').map(t => t.sheet)).toEqual(['Suppliers', 'Inventory', 'Bills', 'Expenses', 'Fixed Assets']);
    expect(availableTemplates(can, true, 'log').map(t => t.sheet)).toContain('Clients');
    // A manager without accounting rights gets neither bills nor expenses.
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
    expect(done.results).toEqual([{ sheet: 'Suppliers', ok: true, created: 2, skipped: [], error: '', extra: '' }]);
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
