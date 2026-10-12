import * as ui from '../../shared/ui';

// The Z-reading PDF.
// Moved out of AdminDashboard.jsx as it was. The dashboard calls this once per
// render and hands in what these functions read, so each one still sees
// that render's values exactly as it did inline.
export default function makeZReading(deps) {
  const {
    loadPdfLibs, BIZ_NAME, vatRegLabel, archivedOrders, pdfMoney, apiFetch, fetchData,
  } = deps;

  // ── Z-Reading PDF ─────────────────────────────────────────────────────────────
  const printZReading = async () => {
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    const today = new Date().toLocaleDateString('en-PH');
    const now   = new Date().toLocaleTimeString('en-PH');
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text(vatRegLabel, 105, 21, { align: 'center' });
    doc.setFontSize(12); doc.text('Z-READING', 105, 28, { align: 'center' });
    doc.setFontSize(9);  doc.text(`${today}  ${now}  -  OFFICIAL END-OF-DAY REPORT`, 105, 34, { align: 'center' });
    const completed  = archivedOrders.filter(o => o.status === 'Completed');
    const voided     = archivedOrders.filter(o => o.status === 'Voided');
    const cancelled  = archivedOrders.filter(o => o.status === 'Cancelled');
    const comps      = completed.filter(o => o.isComplimentary);
    const regular    = completed.filter(o => !o.isComplimentary);
    const gross      = regular.reduce((s,o) => s+(o.subtotal||0), 0);
    const discounts  = regular.reduce((s,o) => s+(o.discount||0), 0);
    const payMethods = {};
    regular.forEach(o => { const m = o.paymentMethod||'Cash'; if (!payMethods[m]) payMethods[m]={count:0,total:0}; payMethods[m].count++; payMethods[m].total+=(o.total||0); });
    doc.setFontSize(8); doc.setTextColor(120); doc.text('All amounts in PHP. Negatives shown in (parentheses).', 105, 38, { align: 'center' }); doc.setTextColor(0);
    autoTable(doc, {
      startY: 42,
      head: [['Summary', 'Amount (PHP)']],
      body: [
        ['Gross Sales',      pdfMoney(gross)],
        ['Less: Discounts',  pdfMoney(-discounts)],
        ['Net Sales',        pdfMoney(gross - discounts)],
        ['Complimentary',    pdfMoney(-comps.reduce((s,o)=>s+(o.subtotal||0),0))],
        ['Orders Completed', String(completed.length)],
        ['Orders Voided',    String(voided.length)],
        ['Orders Cancelled', String(cancelled.length)],
      ],
      styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] },
      columnStyles: { 1: { halign: 'right' } },
    });
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 6,
      head: [['Payment Method', 'Orders', 'Amount (PHP)']],
      body: Object.entries(payMethods).map(([m, d]) => [m, String(d.count), pdfMoney(d.total)]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
    });
    doc.save(`Z-Reading-${today.replace(/\//g,'-')}.pdf`);
  };

  // Toggle a product's manual availability flag (Removed on/off). Superadmin only.
  const toggleProductAvailability = async (product) => {
    try {
      const next = !(product.isAvailable !== false); // default true → toggle to false
      const res = await apiFetch(`/api/products/${product._id}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable: next }),
      });
      if (res.ok) fetchData(); // refresh products
      else ui.alert('Failed to update availability.');
    } catch (err) { console.error('toggleProductAvailability', err); }
  };

  // Café: show on / hide from the table QR menu. Hidden = counter-only, still
  // sold at the POS.
  const toggleProductQr = async (product) => {
    try {
      const res = await apiFetch(`/api/products/${product._id}/qr`, {
        method: 'PATCH',
        body: JSON.stringify({ showOnQr: product.showOnQr === false }),
      });
      if (res.ok) fetchData();
      else ui.alert((await res.json().catch(() => ({}))).error || 'Failed to update the QR menu setting.');
    } catch (err) { console.error('toggleProductQr', err); }
  };

  // Toggle Out-Of-Stock flag. Stays on the menu (with a badge), still in reports.
  const toggleProductOOS = async (product) => {
    try {
      const next = !product.isOutOfStock;
      const res = await apiFetch(`/api/products/${product._id}/oos`, {
        method: 'PATCH',
        body: JSON.stringify({ isOutOfStock: next }),
      });
      if (res.ok) fetchData();
      else ui.alert('Failed to update OOS status.');
    } catch (err) { console.error('toggleProductOOS', err); }
  };

  return {
    toggleProductAvailability, toggleProductOOS, toggleProductQr, printZReading,
  };
}
