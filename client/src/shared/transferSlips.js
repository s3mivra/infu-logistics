// Network stock transfers as shipments: one row per shipment (like an order
// or an invoice) with its lines, a printable transfer slip for each, and a
// PDF of them all. Every line of one send carries the same shipmentRef.

// Shipment a line belongs to: its shipmentRef, else the reference less its
// "-L<n>" line suffix, else the line itself.
export const shipmentKeyOf = (t) => t.shipmentRef || String(t.reference || '').replace(/-L\d+$/, '') || String(t._id);

// Quantity as people count it: 24000 ml -> "24 L", with the base amount only
// when the unit actually changed.
export function displayQty(t) {
  const mult = Number(t.unitMultiplier) || 1;
  const base = Number(t.qtyBase) || 0;
  if (mult > 1 && t.displayUnit) {
    const shown = Math.round((base / mult) * 1000) / 1000;
    return `${shown} ${t.displayUnit}`;
  }
  return `${base} ${t.unit || ''}`.trim();
}

export const lineValue = (t) => Math.round((Number(t.qtyBase) || 0) * (Number(t.unitCost) || 0) * 100) / 100;

// One status for the shipment: the lines' own when they agree, else the mix.
export function shipmentStatus(lines) {
  const counts = {};
  for (const l of lines) counts[l.status] = (counts[l.status] || 0) + 1;
  const keys = Object.keys(counts);
  if (keys.length === 1) return { label: keys[0], mixed: false };
  return { label: keys.map((k) => `${counts[k]} ${k}`).join(', '), mixed: true };
}

export function groupShipments(transfers = []) {
  const map = new Map();
  for (const t of transfers) {
    const key = shipmentKeyOf(t);
    if (!map.has(key)) map.set(key, { key, ref: key, direction: t.direction, partnerName: t.partnerName || t.partnerSlug || '', partnerSlug: t.partnerSlug, lines: [], date: t.createdAt });
    const s = map.get(key);
    s.lines.push(t);
    if (t.createdAt && (!s.date || new Date(t.createdAt) < new Date(s.date))) s.date = t.createdAt;
  }
  const out = [...map.values()].map((s) => {
    s.lines.sort((a, b) => String(a.reference || '').localeCompare(String(b.reference || ''), undefined, { numeric: true }));
    s.value = Math.round(s.lines.reduce((t, l) => t + lineValue(l), 0) * 100) / 100;
    s.status = shipmentStatus(s.lines);
    s.requestedBy = s.lines.find((l) => l.requestedBy)?.requestedBy || '';
    s.approvedBy = s.lines.find((l) => l.approvedBy)?.approvedBy || '';
    s.notes = [...new Set(s.lines.map((l) => (l.note || '').trim()).filter(Boolean))];
    return s;
  });
  return out.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const money = (n) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The slip for one shipment, drawn on `doc` from y. Returns the y below it.
function drawSlip(doc, autoTable, s, { bizName = '', y = 16 } = {}) {
  const pageW = doc.internal.pageSize.getWidth();
  const out = s.direction === 'outbound';
  doc.setFontSize(15); doc.setFont(undefined, 'bold');
  doc.text('STOCK TRANSFER SLIP', 14, y);
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  doc.text(`Ref: ${s.ref}`, pageW - 14, y - 5, { align: 'right' });
  doc.text(`Date: ${fmtDate(s.date)}`, pageW - 14, y, { align: 'right' });
  doc.text(`Status: ${s.status.label}`, pageW - 14, y + 5, { align: 'right' });
  const from = out ? (bizName || 'This business') : s.partnerName;
  const to = out ? s.partnerName : (bizName || 'This business');
  autoTable(doc, {
    startY: y + 9, theme: 'plain', tableWidth: pageW - 28,
    body: [[{ content: 'FROM', styles: { fontStyle: 'bold', textColor: 110 } }, { content: 'TO', styles: { fontStyle: 'bold', textColor: 110 } }, { content: 'BILLED TO', styles: { fontStyle: 'bold', textColor: 110 } }],
      [{ content: from, styles: { fontStyle: 'bold', fontSize: 11 } }, { content: to, styles: { fontStyle: 'bold', fontSize: 11 } }, { content: to, styles: { fontStyle: 'bold', fontSize: 11 } }]],
    styles: { fontSize: 8, cellPadding: 1 },
  });
  const body = s.lines.map((l, i) => [
    String(i + 1), l.itemCode || '-', l.itemName || '-', displayQty(l),
    money((Number(l.unitCost) || 0) * ((Number(l.unitMultiplier) || 1) > 1 && l.displayUnit ? Number(l.unitMultiplier) : 1)),
    money(lineValue(l)), l.status || '',
  ]);
  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || y) + 4,
    head: [['#', 'Code', 'Item', 'Qty', 'Unit cost', 'Amount', 'Status']],
    body,
    foot: [[{ content: `${s.lines.length} item${s.lines.length === 1 ? '' : 's'}`, colSpan: 5 }, { content: money(s.value), styles: { halign: 'right' } }, '']],
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [30, 30, 30] }, footStyles: { fillColor: [45, 45, 45], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 8 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: (d) => { if (d.section === 'head' && [3, 4, 5].includes(d.column.index)) d.cell.styles.halign = 'right'; },
  });
  let yy = (doc.lastAutoTable?.finalY || y) + 6;
  if (s.notes.length) { doc.setFontSize(8.5); doc.text(`Notes: ${s.notes.join('; ')}`.slice(0, 400), 14, yy, { maxWidth: pageW - 28 }); yy += 8; }
  // Signatures: who sent it out, who received it.
  doc.setFontSize(8.5);
  const sig = (label, name, x) => {
    doc.line(x, yy + 12, x + 70, yy + 12);
    doc.text(name ? `${label}: ${name}` : label, x, yy + 17);
  };
  sig('Prepared by', s.requestedBy, 14);
  sig('Approved by', s.approvedBy, pageW / 2 + 4);
  yy += 22;
  sig('Released by', '', 14);
  sig('Received by (name, date)', '', pageW / 2 + 4);
  return yy + 24;
}

// One shipment's slip, to print and hand over with the goods.
export async function exportTransferSlip(s, { loadPdfLibs, addLogoToPDF, bizName }) {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const doc = new jsPDF();
  if (addLogoToPDF) await addLogoToPDF(doc);
  // The logo takes the top-right corner (a 30 x 18 box from y 4), where the
  // slip's ref / date / status go - so the slip starts below it.
  drawSlip(doc, autoTable, s, { bizName, y: addLogoToPDF ? 34 : 22 });
  doc.save(`Transfer-${s.ref}.pdf`);
  return doc;
}

// Every shipment shown: a summary list first, then each one's slip.
export async function exportAllTransfers(shipments, { loadPdfLibs, addLogoToPDF, bizName }) {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const doc = new jsPDF();
  if (addLogoToPDF) await addLogoToPDF(doc);
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.text('STOCK TRANSFERS', pageW / 2, 18, { align: 'center' });
  doc.setFont(undefined, 'normal'); doc.setFontSize(9);
  const outV = shipments.filter((s) => s.direction === 'outbound').reduce((t, s) => t + s.value, 0);
  const inV = shipments.filter((s) => s.direction !== 'outbound').reduce((t, s) => t + s.value, 0);
  doc.text(`${bizName || ''}  ·  ${shipments.length} shipment(s)  ·  sent ${money(outV)}  ·  received ${money(inV)}`, pageW / 2, 24, { align: 'center' });
  autoTable(doc, {
    startY: 30,
    head: [['Date', 'Ref', 'Dir', 'Partner', 'Items', 'Value', 'Status']],
    body: shipments.map((s) => [fmtDate(s.date), s.ref, s.direction === 'outbound' ? 'OUT' : 'IN', s.partnerName,
      `${s.lines.length}: ${s.lines.map((l) => l.itemName).join(', ')}`.slice(0, 120), money(s.value), s.status.label]),
    styles: { fontSize: 7.5, cellPadding: 1.8 }, headStyles: { fillColor: [30, 30, 30] },
    columnStyles: { 5: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: (d) => { if (d.section === 'head' && d.column.index === 5) d.cell.styles.halign = 'right'; },
  });
  for (const s of shipments) {
    doc.addPage();
    drawSlip(doc, autoTable, s, { bizName, y: 20 });
  }
  doc.save(`Stock-Transfers-${new Date().toISOString().slice(0, 10)}.pdf`);
  return doc;
}
