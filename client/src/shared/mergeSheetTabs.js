import { isStockSheetHeader } from './importSheets';

// Several stock tabs of one workbook -> one "Inventory" sheet for the import
// preview, so a sheet kept as Beans / Milk / Cups tabs imports in one go.
//
// Cells are copied as they are - their type, value and number format - not
// re-typed through JSON, so a date stays a date and the import's own
// day-first detection still sees the cell's format. Columns are matched by
// header name, so tabs may order their columns differently.
//
// tabs: 'all' or a list of names. A tab without the stock columns is skipped
// and said so (on 'all' a notes tab is simply not stock); a chosen tab that
// is missing is reported too.
// -> { workbook | null, used, skipped: [{ name, reason }], duplicates }
export function mergeStockTabs(XLSX, wb, tabs) {
  const wanted = tabs === 'all' ? wb.SheetNames : tabs;
  const used = [];
  const skipped = [];
  const header = [];            // merged header, first spelling wins
  const colOf = new Map();      // lower-cased header -> merged column
  const rows = [];              // [{ tab, cells: Map(mergedCol -> cell) }]

  for (const name of wanted) {
    const ws = wb.Sheets[name];
    if (!ws) { skipped.push({ name, reason: 'not in the sheet' }); continue; }
    const hdr = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })[0] || []).map(h => String(h ?? '').trim());
    if (!isStockSheetHeader(hdr)) { skipped.push({ name, reason: 'no Product and Qty Unit / Unit Cost columns' }); continue; }
    used.push(name);
    const range = XLSX.utils.decode_range(ws['!ref']);
    const map = hdr.map((h) => {
      if (!h) return -1;
      const key = h.toLowerCase();
      if (!colOf.has(key)) { colOf.set(key, header.length); header.push(h); }
      return colOf.get(key);
    });
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cells = new Map();
      for (let c = 0; c < map.length; c++) {
        if (map[c] < 0) continue;
        const cell = ws[XLSX.utils.encode_cell({ r, c: range.s.c + c })];
        if (cell && cell.v !== undefined && cell.v !== '') cells.set(map[c], { ...cell });
      }
      if (cells.size) rows.push({ tab: name, cells });
    }
  }

  // The same item on two tabs would be imported as two lots and ADDED - worth
  // a word before it happens. Keyed on the code when there is one, else the name.
  const codeCol = colOf.get('code') ?? colOf.get('item code') ?? colOf.get('itemcode');
  const nameCol = colOf.get('product') ?? colOf.get('itemname');
  const seen = new Map();
  for (const { tab, cells } of rows) {
    const key = String((codeCol != null && cells.get(codeCol)?.v) || cells.get(nameCol)?.v || '').trim().toLowerCase();
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, { label: String(cells.get(nameCol)?.v || key), tabs: new Set() });
    seen.get(key).tabs.add(tab);
  }
  const duplicates = [...seen.values()].filter(v => v.tabs.size > 1).map(v => v.label);

  if (!used.length) return { workbook: null, used, skipped, duplicates };

  const out = {};
  header.forEach((h, c) => { out[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: h }; });
  rows.forEach(({ cells }, i) => {
    for (const [c, cell] of cells) out[XLSX.utils.encode_cell({ r: i + 1, c })] = cell;
  });
  out['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: Math.max(0, header.length - 1) } });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, out, 'Inventory');
  return { workbook, used, skipped, duplicates };
}
