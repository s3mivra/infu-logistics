// A quotation as a document to print or send: who it is for, the items at
// their quoted prices, the total, how long the price holds, and the terms.
// Nothing on it is a sale - it says so at the bottom.

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const money = (n) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function quotationRows(q) {
  return (q.lines || []).map((l, i) => {
    const unit = l.quotedPrice != null ? Number(l.quotedPrice) : Number(l.askedPrice) || 0;
    const list = Number(l.askedPrice) || 0;
    return { n: i + 1, name: l.name, note: l.note || '', qty: Number(l.quantity) || 1, list, unit, amount: Math.round(unit * (Number(l.quantity) || 1) * 100) / 100 };
  });
}

export async function exportQuotationPDF(q, { loadPdfLibs, addLogoToPDF, bizName = '' }) {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const doc = new jsPDF();
  if (addLogoToPDF) await addLogoToPDF(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const y = addLogoToPDF ? 34 : 22;   // below the logo's corner
  doc.setFontSize(18); doc.setFont(undefined, 'bold');
  doc.text('QUOTATION', 14, y);
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  doc.text(`No.: ${q.quoteNumber || '-'}`, pageW - 14, y - 5, { align: 'right' });
  doc.text(`Date: ${fmtDate(q.quotedAt || q.createdAt)}`, pageW - 14, y, { align: 'right' });
  doc.text(`Valid until: ${q.validUntil ? fmtDate(q.validUntil) : '-'}`, pageW - 14, y + 5, { align: 'right' });

  autoTable(doc, {
    startY: y + 9, theme: 'plain', tableWidth: pageW - 28,
    body: [
      [{ content: 'FROM', styles: { fontStyle: 'bold', textColor: 110 } }, { content: 'TO', styles: { fontStyle: 'bold', textColor: 110 } }],
      [{ content: bizName || '', styles: { fontStyle: 'bold', fontSize: 11 } }, { content: q.clientName || '', styles: { fontStyle: 'bold', fontSize: 11 } }],
      ['', q.clientContact || ''],
    ],
    styles: { fontSize: 8.5, cellPadding: 1 },
  });

  const rows = quotationRows(q);
  const showList = rows.some((r) => Math.abs(r.list - r.unit) > 0.004);
  const total = rows.reduce((t, r) => t + r.amount, 0);
  const listTotal = rows.reduce((t, r) => t + r.list * r.qty, 0);
  const head = ['#', 'Item', 'Qty', ...(showList ? ['List price'] : []), 'Unit price', 'Amount'];
  const body = rows.map((r) => [String(r.n), r.note ? `${r.name}\n${r.note}` : r.name, String(r.qty), ...(showList ? [money(r.list)] : []), money(r.unit), money(r.amount)]);
  const lastCol = head.length - 1;
  const foot = [];
  if (showList && listTotal - total > 0.004) foot.push([{ content: 'Discount', colSpan: lastCol, styles: { halign: 'right' } }, { content: `-${money(listTotal - total)}`, styles: { halign: 'right' } }]);
  foot.push([{ content: 'TOTAL', colSpan: lastCol, styles: { halign: 'right' } }, { content: money(total), styles: { halign: 'right' } }]);
  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || y) + 4,
    head: [head], body, foot,
    styles: { fontSize: 9, cellPadding: 2.2 },
    headStyles: { fillColor: [30, 30, 30] }, footStyles: { fillColor: [45, 45, 45], textColor: 255, fontStyle: 'bold' },
    columnStyles: Object.fromEntries([[0, { cellWidth: 8 }], ...head.slice(2).map((_, i) => [i + 2, { halign: 'right' }]), [lastCol, { halign: 'right', fontStyle: 'bold' }]]),
    didParseCell: (d) => { if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right'; },
  });
  let yy = (doc.lastAutoTable?.finalY || y) + 7;
  doc.setFontSize(9);
  if (q.quoteNotes) {
    doc.setFont(undefined, 'bold'); doc.text('Terms & notes', 14, yy); doc.setFont(undefined, 'normal');
    const lines = doc.splitTextToSize(q.quoteNotes, pageW - 28);
    doc.text(lines, 14, yy + 5);
    yy += 5 + lines.length * 4.5;
  }
  yy += 6;
  doc.setFontSize(8); doc.setTextColor(110);
  doc.text(`This is a price offer, not an invoice.${q.validUntil ? ` Prices hold until ${fmtDate(q.validUntil)}.` : ''}`, 14, yy);
  doc.setTextColor(0);
  yy += 16;
  doc.setFontSize(8.5);
  doc.line(14, yy, 84, yy); doc.text('Prepared by', 14, yy + 5);
  doc.line(pageW / 2 + 4, yy, pageW / 2 + 74, yy); doc.text('Accepted by (name, date)', pageW / 2 + 4, yy + 5);
  doc.save(`Quotation-${q.quoteNumber || 'draft'}.pdf`);
  return doc;
}
