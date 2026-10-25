import { } from 'lucide-react';
import * as ui from '../../shared/ui';

// Loading the reports.
// Moved out of AdminDashboard.jsx as it was. The dashboard calls this once per
// render and hands in what these functions read, so each one still sees
// that render's values exactly as it did inline.
export default function makeReportFetchers(deps) {
  const {
    apiFetch, setMenuEngineering, setCashierVariance, setCommissions, setPurchaseOrder, purchaseOrder, loadPdfLibs, addLogoToPDF,
    BIZ_NAME, pdfMoney, pnlData, pnlRange, vatStmtSuffix, bsData,
  } = deps;

  // ── Reports ───────────────────────────────────────────────────────────────────
  const fetchMenuEngineering = async () => {
    try { const res = await apiFetch('/api/reports/menu-engineering'); const d = await res.json(); if (d.success) setMenuEngineering(d); }
    catch (err) { console.error('fetchMenuEngineering', err); }
  };
  const fetchCashierVariance = async () => {
    try { const res = await apiFetch('/api/reports/cashier-variance'); const d = await res.json(); if (d.success) setCashierVariance(d); }
    catch (err) { console.error('fetchCashierVariance', err); }
  };
  const fetchCommissions = async () => {
    try { const res = await apiFetch('/api/reports/commissions'); const d = await res.json(); if (d.success) setCommissions(d); }
    catch (err) { console.error('fetchCommissions', err); }
  };
  const fetchPurchaseOrder = async () => {
    try {
      const res = await apiFetch('/api/reports/purchase-order?days=7');
      const d = await res.json();
      if (d.success) setPurchaseOrder(d);
      else ui.alert(d.error || 'Failed to generate purchase order.');
    } catch (err) { console.error('fetchPurchaseOrder', err); ui.alert('Network error generating purchase order.'); }
  };

  // Purchase Order → PDF in the requested "Product | Qty Unit" format
  const exportPurchaseOrderPDF = async () => {
    if (!purchaseOrder || !(purchaseOrder.lines || []).length) return ui.alert('Generate a purchase order first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    const today = new Date().toLocaleDateString('en-PH');
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('PURCHASE ORDER', 105, 22, { align: 'center' });
    doc.setFontSize(9);  doc.text(`${today}  ·  covers ~${purchaseOrder.coverDays || 7} days`, 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Product', 'Qty Unit']],
      body: (purchaseOrder.lines || []).map(l => [
        l.itemName + (l.lowStock ? '  (LOW)' : ''),
        `${l.suggestedOrder} ${l.displayUnit}`,
      ]),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [30, 30, 30] },
      columnStyles: { 1: { halign: 'right' } },
    });
    const y = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    doc.text(`Estimated Total (PHP): ${pdfMoney(purchaseOrder.totalEstCost || 0)}`, 14, y);
    doc.save(`Purchase-Order-${today.replace(/\//g, '-')}.pdf`);
  };

  // Profit & Loss → PDF (replaces CSV export)
  const exportPnlPDF = async () => {
    if (!pnlData) return ui.alert('Run the P&L report first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    const range = `${pnlRange.start} to ${pnlRange.end}`;
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text(`PROFIT & LOSS STATEMENT ${vatStmtSuffix}`, 105, 22, { align: 'center' });
    doc.setFontSize(9);  doc.text(range, 105, 28, { align: 'center' });
    const section = (title, rows, startY) => {
      autoTable(doc, {
        startY,
        head: [[title, 'Amount (PHP)']],
        body: rows.length ? rows.map(r => [r.accountName || r.name || r.label || '', pdfMoney(r.amount ?? r.total)]) : [['-', pdfMoney(0)]],
        styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] },
        columnStyles: { 1: { halign: 'right' } },
      });
      return doc.lastAutoTable.finalY + 4;
    };
    let y = 34;
    y = section('Revenue', pnlData.revenue || [], y);
    y = section('Cost of Goods Sold', pnlData.cogs || [], y);
    y = section('Operating Expenses', pnlData.opex || pnlData.expenses || [], y);
    // Summary totals - negatives shown in parentheses, no ± / ₱ glyph issues.
    const t = pnlData.totals || {};
    autoTable(doc, {
      startY: y,
      head: [['Summary', 'Amount (PHP)']],
      body: [
        ['Gross Profit', pdfMoney(t.grossProfit)],
        ['Net Income', pdfMoney(t.netIncome)],
        ...(t.netMargin !== undefined ? [['Net Margin', `${Number(t.netMargin).toFixed(1)}%`]] : []),
      ],
      styles: { fontSize: 10, fontStyle: 'bold' }, headStyles: { fillColor: [70, 70, 70], textColor: 255 },
      columnStyles: { 1: { halign: 'right' } },
    });
    doc.save(`Profit-Loss-${pnlRange.start}_to_${pnlRange.end}.pdf`);
  };

  const exportBalanceSheetPDF = async () => {
    if (!bsData) return ui.alert('Load the Balance Sheet first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    const asOf = bsData.asOf ? new Date(bsData.asOf).toLocaleDateString() : new Date().toLocaleDateString();
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text(`BALANCE SHEET ${vatStmtSuffix}`, 105, 22, { align: 'center' });
    doc.setFontSize(9);  doc.text(`As of ${asOf}`, 105, 28, { align: 'center' });
    const rowName = (r) => r.accountName || r.name || r.label || '';
    const rowAmt = (r) => pdfMoney(r.amount ?? r.balance ?? r.total ?? 0);
    const section = (title, rows, total, startY) => {
      autoTable(doc, {
        startY,
        head: [[title, 'Amount (PHP)']],
        body: [
          ...(rows && rows.length ? rows.map(r => [rowName(r), rowAmt(r)]) : [['-', pdfMoney(0)]]),
          [`Total ${title}`, pdfMoney(total ?? 0)],
        ],
        styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] },
        columnStyles: { 1: { halign: 'right' } },
        didParseCell: (d) => { if (d.row.index === (rows?.length || 1)) d.cell.styles.fontStyle = 'bold'; },
      });
      return doc.lastAutoTable.finalY + 4;
    };
    const t = bsData.totals || {};
    let y = 34;
    y = section('Assets', bsData.assets, t.assets, y);
    y = section('Liabilities', bsData.liabilities, t.liabilities, y);
    y = section('Equity', bsData.equity, t.equity, y);
    const balanced = Math.abs((t.assets || 0) - ((t.liabilities || 0) + (t.equity || 0))) < 0.01;
    autoTable(doc, {
      startY: y,
      head: [['Accounting Equation', '']],
      body: [
        ['Assets', pdfMoney(t.assets)],
        ['Liabilities + Equity', pdfMoney((t.liabilities || 0) + (t.equity || 0))],
        ['Status', balanced ? 'BALANCED' : 'OUT OF BALANCE'],
      ],
      styles: { fontSize: 10, fontStyle: 'bold' }, headStyles: { fillColor: [70, 70, 70], textColor: 255 },
      columnStyles: { 1: { halign: 'right' } },
    });
    doc.save(`Balance-Sheet-${asOf.replace(/\//g, '-')}.pdf`);
  };

  return {
    fetchMenuEngineering, fetchCashierVariance, fetchPurchaseOrder, fetchCommissions, exportPnlPDF, exportBalanceSheetPDF, exportPurchaseOrderPDF,
  };
}
