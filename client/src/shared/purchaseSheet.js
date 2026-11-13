// Reading a purchases sheet (an Excel file, or the linked Google Sheet) into
// the rows POST /api/purchases/import takes. Headers are matched loosely -
// "Product Code", "Item Code" and "Code" are all the code - because the sheet
// is the business's own and was rarely made from our template.

export const PURCHASE_COLUMNS = [
  { key: 'date', label: 'Date', example: '2026-11-13', aliases: ['date', 'purchase date', 'date purchased', 'receipt date', 'or date', 'invoice date'] },
  { key: 'reference', label: 'Reference', example: 'OR-1001', aliases: ['reference', 'ref', 'ref no', 'reference no', 'or', 'or no', 'or number', 'invoice', 'invoice no', 'si no', 'dr no', 'receipt no'] },
  { key: 'itemCode', label: 'Product Code', example: 'RICE-25', aliases: ['product code', 'item code', 'code', 'sku', 'stock code'] },
  { key: 'itemName', label: 'Product', example: 'Rice 25kg', aliases: ['product', 'product name', 'item', 'item name', 'description', 'name'] },
  { key: 'qty', label: 'Qty', example: 10, aliases: ['qty', 'quantity', 'qty purchased', 'pcs', 'units'] },
  { key: 'amountPaid', label: 'Amount Paid', example: 12000, aliases: ['amount paid', 'amount', 'paid', 'total', 'total paid', 'total cost', 'cost', 'price paid'] },
  { key: 'supplier', label: 'Supplier', example: 'Mill Co', aliases: ['supplier', 'vendor', 'from', 'bought from'] },
  { key: 'paidFrom', label: 'Paid From', example: 'Cash', aliases: ['paid from', 'payment', 'paid by', 'payment method', 'mode of payment', 'source'] },
  { key: 'notes', label: 'Notes', example: '', aliases: ['notes', 'note', 'remarks', 'memo'] },
];

const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/[._#:]/g, ' ').replace(/\s+/g, ' ').trim();
const ALIAS = new Map(PURCHASE_COLUMNS.flatMap((c) => c.aliases.map((a) => [a, c.key])));

// The header -> field it is, or null.
export const purchaseField = (header) => ALIAS.get(norm(header)) || null;

// sheet_to_json objects -> import rows; unknown columns are dropped.
export function toPurchaseRows(objects = []) {
  return objects.map((o) => {
    const row = {};
    for (const [h, v] of Object.entries(o || {})) {
      const k = purchaseField(h);
      if (k && (row[k] === undefined || row[k] === '')) row[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
    }
    return row;
  });
}

// Which of the needed columns a sheet is missing (by its header row).
export function missingPurchaseColumns(headers = []) {
  const have = new Set(headers.map(purchaseField).filter(Boolean));
  const missing = [];
  if (!have.has('date')) missing.push('Date');
  if (!have.has('itemCode') && !have.has('itemName')) missing.push('Product Code (or Product)');
  if (!have.has('qty')) missing.push('Qty');
  if (!have.has('amountPaid')) missing.push('Amount Paid');
  return missing;
}

// Every tab of a workbook that looks like purchases, read as rows.
export function readPurchaseWorkbook(XLSX, wb) {
  const rows = [];
  const used = [], skipped = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const objects = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
    const headers = Object.keys(objects[0] || {});
    const missing = missingPurchaseColumns(headers);
    if (!objects.length || missing.length) { skipped.push({ name, missing }); continue; }
    used.push(name);
    rows.push(...toPurchaseRows(objects));
  }
  return { rows, used, skipped };
}
