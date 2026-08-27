// ESC/POS receipt byte-building - shared by the Bluetooth and WebSerial thermal
// print paths in AdminDashboard.jsx's printOrderSlip. Previously duplicated
// almost verbatim between the two transports (which had drifted: only the
// WebSerial copy included the VAT-registration line); this is the one copy
// both now build from. The two transports differ only in how they WRITE these
// bytes (GATT characteristic vs. serial port), not in what the bytes say.

const INIT   = [0x1b, 0x40];
const CENTER = [0x1b, 0x61, 0x01];
const LEFT   = [0x1b, 0x61, 0x00];
const BOLD1  = [0x1b, 0x45, 0x01];
const BOLD0  = [0x1b, 0x45, 0x00];
const LF     = [0x0a];

// Standard Font-A character counts for common thermal roll widths - a 58mm
// printer fits ~32 columns, an 80mm one ~48. Any extra columns beyond the
// 32-char baseline go entirely to the item-name field (the part most likely
// to get truncated), so a wider roll doesn't just leave dead space on the
// right - the receipt actually uses the paper it has.
const CHARS_PER_MM = { 58: 32, 80: 48 };
const charsForPaperWidth = (mm) => CHARS_PER_MM[Number(mm)] || 32;

// order: the completed Order document. opts: { lh (resolveLetterhead result),
// dupe: boolean, vatRegLabel: string, businessType: 'fb'|'log', compReasonLabels,
// paperWidthMm: 58|80 (defaults 80, matching the old hardcoded assumption) }
export function buildEscposReceiptBytes(order, { lh, dupe, vatRegLabel, businessType, compReasonLabels, paperWidthMm = 80 }) {
  const enc = new TextEncoder();
  const buf = [];
  const b   = (arr) => buf.push(...arr);
  const tx  = (str) => b(Array.from(enc.encode(str)));

  const W = charsForPaperWidth(paperWidthMm);
  const SEP = '-'.repeat(W) + '\n';
  const nameColW = 16 + Math.max(0, W - 32);
  const addonColW = Math.max(10, nameColW - 2);

  b(INIT); b(CENTER); b(BOLD1); tx(`${lh.companyName}\n`); b(BOLD0);
  if (lh.address) tx(`${lh.address}\n`);
  tx(`${vatRegLabel}\nOFFICIAL ORDER SLIP\n`); tx(SEP);

  if (order.isComplimentary) {
    b(BOLD1); tx('** COMPLIMENTARY ORDER **\n'); b(BOLD0);
    if (order.complimentaryReasonType) tx(`${compReasonLabels[order.complimentaryReasonType] || ''}\n`);
    if (order.complimentaryApprovedBy) tx(`Approved: ${order.complimentaryApprovedBy}\n`);
    tx(SEP);
  }

  b(LEFT);
  tx(`Order: ${order.orderNumber || '-'}\n`);
  tx(`Table: ${order.table || '-'}\n`);
  tx(`Date:  ${new Date(order.createdAt || Date.now()).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}\n`);
  if (order.cashier && order.cashier !== 'System') tx(`By:    ${order.cashier}\n`);
  if (!order.isComplimentary) tx(`Pay:   ${order.paymentMethod || 'Cash'}\n`);
  tx(SEP);

  order.items.forEach(item => {
    const addOnTotal = (item.selectedAddOns || []).reduce((s, a) => s + Number(a.price || 0), 0);
    const lineTotal  = (item.price + addOnTotal) * item.quantity;
    const nameCol    = item.name.substring(0, nameColW).padEnd(nameColW);
    b(BOLD1);
    tx(`${String(item.quantity).padStart(2)}x ${nameCol} P${lineTotal.toFixed(2).padStart(7)}\n`);
    b(BOLD0);
    (item.selectedAddOns || []).forEach(a => {
      tx(`   + ${a.name.substring(0, addonColW).padEnd(addonColW)} P${Number(a.price || 0).toFixed(2).padStart(7)}\n`);
    });
  });

  b(CENTER); tx(SEP);
  const subTotal = order.subtotal || 0;
  const discAmt  = order.discount  || 0;
  const total    = order.total     || 0;

  if (!order.isComplimentary && discAmt > 0) {
    tx(`Subtotal:              P${subTotal.toFixed(2)}\n`);
    tx(`Discount (${(order.discountType || '').padEnd(6)}): -P${discAmt.toFixed(2)}\n`);
  }
  b(BOLD1);
  if (order.isComplimentary) {
    tx(`Subtotal: P${subTotal.toFixed(2)}\n`);
    tx(`AMOUNT DUE: P0.00\n`);
    tx('** NO PAYMENT REQUIRED **\n');
  } else {
    tx(`TOTAL: P${total.toFixed(2)}\n`);
  }
  b(BOLD0);
  if (!order.isComplimentary && (order.amountTendered || 0) > 0 && order.paymentMethod === 'Cash') {
    tx(`Cash:   P${(order.amountTendered || 0).toFixed(2)}\n`);
    b(BOLD1); tx(`Change: P${(order.changeDue || 0).toFixed(2)}\n`); b(BOLD0);
  }
  tx(SEP);
  b(CENTER); tx(`${businessType === 'log' ? 'Thank you for your business!' : 'Thank you for dining with us!'}\n`);

  // Dynamic feed - fewer lines for larger orders (content itself advances the paper)
  const feedLines = Math.max(4, 8 - Math.floor(order.items.length / 2));
  for (let i = 0; i < feedLines; i++) b(LF);

  if (dupe) { const copy = buf.slice(); buf.push(...copy); } // second (duplicate) receipt
  return new Uint8Array(buf);
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Per-device printer preference - a Bluetooth/USB pairing is physical to one
// terminal, so this deliberately lives in localStorage, not backend Settings
// (see SettingsTab.jsx's "This Device" card for the same dash.* convention).
const STORAGE_KEY = 'dash.printerMode'; // 'auto' | 'browser'

export function readPrinterMode() {
  try { return localStorage.getItem(STORAGE_KEY) === 'browser' ? 'browser' : 'auto'; }
  catch { return 'auto'; }
}

export function writePrinterMode(mode) {
  try { localStorage.setItem(STORAGE_KEY, mode === 'browser' ? 'browser' : 'auto'); }
  catch { /* private mode / storage disabled - degrades to default 'auto' each load */ }
}
