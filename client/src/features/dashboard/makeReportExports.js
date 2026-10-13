import { Menu } from 'lucide-react';
import * as ui from '../../shared/ui';
import { todayStr } from '../../shared/businessDay.js';

// Reports as PDF and Excel.
// Moved out of AdminDashboard.jsx as it was. The dashboard calls this once per
// render and hands in what these functions read, so each one still sees
// that render's values exactly as it did inline.
export default function makeReportExports(deps) {
  const {
    arOutstanding, loadPdfLibs, addLogoToPDF, BIZ_NAME, pdfMoney, arAgeing, apData, salesByPayment,
    sbpRange, profitByCategory, menuEngineering, cashierVariance, commissions, bills, billsFilter, auditLogEntries,
    expenseList, stockTransfers, inventory, apiFetch, products, BUSINESS_TYPE, rfFunds, rfTxs,
    rfActiveFund, calcRecipeCost, pricingTable,
  } = deps;

  // ── Reports that previously had no export - same jsPDF/autoTable/addLogoToPDF
  // pattern as every export above, just matching each report's own on-screen columns.
  // (Trial Balance and Percentage Tax export locally in LedgerTab.jsx instead -
  // their source state (tb/ptax/ptaxRange) lives there, not here.)
  const exportArPDF = async () => {
    if (!arOutstanding?.orders) return ui.alert('Load AR first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('ACCOUNTS RECEIVABLE', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`Total outstanding: ${pdfMoney(arOutstanding.totalOutstanding)}`, 105, 28, { align: 'center' });
    let y = 34;
    if (arAgeing?.clients?.length) {
      autoTable(doc, {
        startY: y,
        head: [['Client', 'Current', '31-60', '61-90', '91+', 'Total', 'Committed']],
        body: arAgeing.clients.map(r => [r.client, pdfMoney(r.current), pdfMoney(r.d31_60), pdfMoney(r.d61_90), pdfMoney(r.d90_plus), pdfMoney(r.total), pdfMoney(r.exposure)]),
        styles: { fontSize: 7 }, headStyles: { fillColor: [30, 30, 30] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      });
      y = doc.lastAutoTable.finalY + 6;
    }
    autoTable(doc, {
      startY: y,
      head: [['Order #', 'Customer', 'Channel', 'Date', 'Due', 'Amount']],
      body: arOutstanding.orders.map(o => [o.orderNumber, o.customerName, o.paymentMethod, new Date(o.createdAt).toLocaleDateString(), o.arDueDate ? new Date(o.arDueDate).toLocaleDateString() : '-', pdfMoney(o.total)]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 5: { halign: 'right' } },
    });
    doc.save(`AR-Outstanding-${todayStr()}.pdf`);
  };

  const exportApPDF = async () => {
    if (!apData) return ui.alert('Load AP first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('ACCOUNTS PAYABLE', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`Outstanding: ${pdfMoney(apData.outstandingBalance)}  ·  Purchased on credit: ${pdfMoney(apData.totalCredit)}  ·  Paid: ${pdfMoney(apData.totalDebit)}`, 105, 28, { align: 'center' });
    let y = 34;
    if ((apData.bySupplier || []).length) {
      autoTable(doc, {
        startY: y,
        head: [['Supplier', 'Purchased', 'Paid', 'Balance']],
        body: apData.bySupplier.map(s => [s.supplier, pdfMoney(s.incurred), pdfMoney(s.paid), pdfMoney(s.balance)]),
        styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      });
      y = doc.lastAutoTable.finalY + 6;
    }
    autoTable(doc, {
      startY: y,
      head: [['Date', 'Reference', 'Supplier', 'Description', 'Incurred', 'Paid']],
      body: (apData.recent || []).map(e => [new Date(e.date).toLocaleDateString(), e.reference, e.supplierName || '-', e.description, e.credit ? pdfMoney(e.credit) : '', e.debit ? pdfMoney(e.debit) : '']),
      styles: { fontSize: 7 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
    doc.save(`AP-${todayStr()}.pdf`);
  };

  const exportPaymentsPDF = async () => {
    if (!salesByPayment) return ui.alert('Load the Payments report first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('SALES BY PAYMENT METHOD', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`${sbpRange.start} to ${sbpRange.end}  ·  Total: ${pdfMoney(salesByPayment.grandTotal)}`, 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Payment Method', 'Orders', 'Amount', '% Share']],
      body: (salesByPayment.breakdown || []).map(r => [r.method || 'Unknown', r.count, pdfMoney(r.total), `${(r.pct || 0).toFixed(1)}%`]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    doc.save(`Sales-By-Payment-${sbpRange.start}_to_${sbpRange.end}.pdf`);
  };

  const exportProfitByCategoryPDF = async () => {
    if (!profitByCategory) return ui.alert('Refresh Profit by Category first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('PROFIT BY CATEGORY', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(new Date().toLocaleDateString(), 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Category', 'Revenue', 'Est. COGS', 'Gross Profit', 'Margin']],
      body: (profitByCategory.categories || profitByCategory || []).map(c => [c.category, pdfMoney(c.revenue), pdfMoney(c.estimatedCOGS), pdfMoney(c.grossProfit), `${c.margin.toFixed(1)}%`]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    });
    doc.save(`Profit-By-Category-${todayStr()}.pdf`);
  };

  const exportMenuEngineeringPDF = async () => {
    if (!menuEngineering) return ui.alert(`Refresh ${BUSINESS_TYPE === 'log' ? 'Product Mix' : 'Menu Engineering'} first.`);
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('MENU ENGINEERING', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(new Date().toLocaleDateString(), 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Item', 'Qty', 'Revenue', 'Margin', 'Class']],
      body: (menuEngineering.items || menuEngineering || []).map(r => [r.name, r.qty, pdfMoney(r.revenue), `${r.margin.toFixed(1)}%`, r.quadrant]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    doc.save(`Menu-Engineering-${todayStr()}.pdf`);
  };

  const exportVariancePDF = async () => {
    if (!cashierVariance) return ui.alert('Refresh Cashier Variance first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('CASHIER VARIANCE', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(new Date().toLocaleDateString(), 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Cashier', 'Shifts', 'Avg Variance', 'Times Short', 'Worst']],
      body: (cashierVariance.cashiers || []).map(c => [c.cashierName, c.shifts, pdfMoney(c.avgVariance), c.shortCount, pdfMoney(c.worstShort)]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    });
    doc.save(`Cashier-Variance-${todayStr()}.pdf`);
  };

  const exportCommissionsPDF = async () => {
    if (!commissions) return ui.alert('Refresh Commissions first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('COMMISSIONS', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(new Date().toLocaleDateString(), 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Cashier', 'Orders', 'Sales', 'Rate', 'Commission']],
      body: (commissions.sellers || []).map(c => [c.name, c.orderCount, pdfMoney(c.salesTotal), `${c.commissionRate}%`, pdfMoney(c.commissionEarned)]),
      foot: [[{ content: 'Total', colSpan: 4 }, pdfMoney(commissions.totalCommission)]],
      styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] }, footStyles: { fillColor: [70, 70, 70], fontStyle: 'bold', textColor: 255 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 4: { halign: 'right' } },
    });
    doc.save(`Commissions-${todayStr()}.pdf`);
  };

  const exportBillsPDF = async () => {
    if (!bills || bills.length === 0) return ui.alert('No bills to export.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('BILLS (ACCOUNTS PAYABLE)', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`Filter: ${billsFilter}  ·  ${new Date().toLocaleDateString()}`, 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Bill #', 'Supplier', 'Source', 'Description', 'Amount', 'Status']],
      body: bills.map(b => [b.billNumber, b.supplierName || '-', b.source, b.description || b.poNumber || '-', pdfMoney(b.amount), b.status]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 4: { halign: 'right' } },
    });
    doc.save(`Bills-${billsFilter}-${todayStr()}.pdf`);
  };

  const exportAuditLogPDF = async () => {
    if (!auditLogEntries || auditLogEntries.length === 0) return ui.alert('No audit entries loaded - run a query first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 148, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('AUDIT LOG', 148, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(new Date().toLocaleString(), 148, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['When', 'Actor', 'Action', 'Reference', 'Details']],
      body: auditLogEntries.map(e => [new Date(e.timestamp).toLocaleString(), e.userId, e.action, e.targetReference, e.details ? JSON.stringify(e.details).slice(0, 120) : '-']),
      styles: { fontSize: 7 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 4: { cellWidth: 120 } },
    });
    doc.save(`Audit-Log-${todayStr()}.pdf`);
  };

  const exportExpensesPDF = async () => {
    if (!expenseList || (expenseList.expenses || []).length === 0) return ui.alert('No expenses to export.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('EXPENSES', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`Total: ${pdfMoney(expenseList.total)}`, 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Date', 'Reference', 'Category', 'Description', 'Amount']],
      body: expenseList.expenses.map(e => [new Date(e.date).toLocaleDateString(), e.reference, e.categoryName, e.description, pdfMoney(e.amount)]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 4: { halign: 'right' } },
    });
    doc.save(`Expenses-${todayStr()}.pdf`);
  };

  // ── Newly-added report exports ─────────────────────────────────────────────

  const exportStockTransfersPDF = async () => {
    if (!stockTransfers || stockTransfers.length === 0) return ui.alert('No transfers to export - load Inventory → Transfers first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('STOCK TRANSFER HISTORY', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(new Date().toLocaleString(), 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Date', 'Reference', 'Item', 'From', 'To', 'Qty', 'Status', 'By']],
      body: stockTransfers.map(t => [
        new Date(t.createdAt).toLocaleDateString(), t.reference || '-', t.itemName || '-',
        t.fromLocation || '-', t.toLocation || '-', `${t.qtyBase ?? 0} ${t.unit || ''}`.trim(),
        t.status, t.releasedBy || t.approvedBy || t.requestedBy || '-',
      ]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] },
    });
    doc.save(`Stock-Transfer-History-${todayStr()}.pdf`);
  };

  // Batches dated by production (goods with no real expiry - beans, etc, FPFO
  // instead of FEFO) flattened out of every inventory item's expiryBatches -
  // a full roast/production log across the whole catalogue, not just one item.
  const exportProductionHistoryPDF = async () => {
    const rows = [];
    for (const item of (inventory || [])) {
      for (const b of (item.expiryBatches || [])) {
        if (!b.productionDate) continue;
        rows.push({ item: item.itemName, date: b.productionDate, qty: b.qty, unit: item.unit, ref: b.reference || '-', received: b.receivedAt });
      }
    }
    if (rows.length === 0) return ui.alert('No batches with a production date recorded yet.');
    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('PRODUCTION HISTORY', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`${rows.length} batch(es) · ${new Date().toLocaleDateString()}`, 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Production Date', 'Item', 'Qty', 'Received', 'Reference']],
      body: rows.map(r => [new Date(r.date).toLocaleDateString(), r.item, `${r.qty} ${r.unit}`, r.received ? new Date(r.received).toLocaleDateString() : '-', r.ref]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] },
    });
    doc.save(`Production-History-${todayStr()}.pdf`);
  };

  // Production Report - reconciled Production Orders (batchNumber, planned vs
  // actual output, and the moisture/variance between them), distinct from
  // exportProductionHistoryPDF above (that one reads Inventory's raw
  // production-dated batches; this one reads the Production Orders
  // themselves, so it's the only report that can show moisture at all).
  const exportProductionOrdersPDF = async () => {
    try {
      const res = await apiFetch('/api/production-orders?fulfillmentStatus=Complete');
      const res2 = await apiFetch('/api/production-orders?fulfillmentStatus=Partial');
      const [d1, d2] = await Promise.all([res.json(), res2.json()]);
      const rows = [...(d1.success ? d1.orders : []), ...(d2.success ? d2.orders : [])];
      if (rows.length === 0) return ui.alert('No reconciled production batches yet - approve and reconcile a batch first.');
      rows.sort((a, b) => new Date(b.reconciledAt) - new Date(a.reconciledAt));
      const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
      await addLogoToPDF(doc);
      doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
      doc.setFontSize(10); doc.text('PRODUCTION REPORT', 105, 22, { align: 'center' });
      doc.setFontSize(9); doc.text(`${rows.length} batch(es) · ${new Date().toLocaleDateString()}`, 105, 28, { align: 'center' });
      autoTable(doc, {
        startY: 34,
        head: [['Batch', 'Product', 'Planned', 'Actual', 'Moisture / Variance', 'Status', 'Reconciled']],
        body: rows.map(r => [
          r.batchNumber, r.outputName,
          `${r.outputQty}${r.outputUnit}`, `${r.actualOutputQty}${r.outputUnit}`,
          r.moistureLossPercent > 0 ? `-${r.moistureLossPercent}% loss` : r.moistureLossPercent < 0 ? `+${Math.abs(r.moistureLossPercent)}% over` : '0%',
          r.fulfillmentStatus, r.reconciledAt ? new Date(r.reconciledAt).toLocaleDateString() : '-',
        ]),
        styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] },
      });
      doc.save(`Production-Report-${todayStr()}.pdf`);
    } catch { ui.alert('Failed to load production orders for the report.'); }
  };

  const exportMenuItemsPDF = async () => {
    if (!products || products.length === 0) return ui.alert('No menu items to export.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('MENU ITEMS', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`${products.length} item(s) · ${new Date().toLocaleDateString()}`, 105, 28, { align: 'center' });
    // Sizes (small/medium/large) is an fb menu concept - a log item has no
    // sizes at all (always "-"), it has a unit/pack instead (e.g. "1kg",
    // "pcs"). Show whichever actually applies to this business type.
    const lastCol = BUSINESS_TYPE === 'log' ? 'Unit' : 'Sizes';
    autoTable(doc, {
      startY: 34,
      head: [['Name', 'Category', 'Code', 'Price', 'Available', lastCol]],
      body: products.map(p => [
        p.name, p.category || '-', p.productCode || '-', pdfMoney(p.basePrice),
        p.isAvailable === false ? 'Removed' : (p.isOutOfStock ? 'Out of Stock' : 'Yes'),
        BUSINESS_TYPE === 'log' ? (p.baseSize || 'pcs') : ((p.sizes || []).map(s => s.name).join(', ') || '-'),
      ]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 3: { halign: 'right' } },
    });
    doc.save(`Menu-Items-${todayStr()}.pdf`);
  };

  const exportRevolvingFundsPDF = async () => {
    if (!rfFunds || rfFunds.length === 0) return ui.alert('No revolving funds to export.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('REVOLVING FUNDS', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(new Date().toLocaleString(), 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Fund', 'Initial Amount', 'Current Balance', 'Used', 'Status']],
      body: rfFunds.map(f => [f.name, pdfMoney(f.initialAmount), pdfMoney(f.currentBalance), pdfMoney(f.initialAmount - f.currentBalance), f.isActive === false ? 'Closed' : 'Active']),
      styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    // If one fund's transactions happen to be loaded (drilled into), append them.
    if (rfTxs && rfTxs.length > 0 && rfActiveFund) {
      doc.addPage();
      doc.setFontSize(12); doc.text(`${rfActiveFund.name} - Transactions`, 105, 15, { align: 'center' });
      autoTable(doc, {
        startY: 22,
        head: [['Date', 'Type', 'Description', 'Amount', 'Balance After', 'By']],
        body: rfTxs.map(t => [new Date(t.date).toLocaleDateString(), t.type, t.description, pdfMoney(t.amount), pdfMoney(t.balanceAfter), t.performedBy || '-']),
        styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
      });
    }
    doc.save(`Revolving-Funds-${todayStr()}.pdf`);
  };

  const exportPricingMasterlistPDF = async () => {
    if (!products || products.length === 0) return ui.alert('No products to export.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('PRODUCT PRICING MASTERLIST', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`${products.length} item(s) · ${new Date().toLocaleDateString()}`, 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Name', 'Category', 'Price', 'Cost', 'Margin']],
      body: products.map(p => {
        const cost = p.costOverride != null ? p.costOverride : (calcRecipeCost(p.baseRecipe) || 0);
        const margin = p.basePrice > 0 ? ((p.basePrice - cost) / p.basePrice) * 100 : 0;
        return [p.name, p.category || '-', pdfMoney(p.basePrice), pdfMoney(cost), `${margin.toFixed(1)}%`];
      }),
      styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    });
    doc.save(`Pricing-Masterlist-${todayStr()}.pdf`);
  };

  const exportPriceTiersPDF = async () => {
    if (!pricingTable.tiers || pricingTable.tiers.length === 0) return ui.alert('No price tiers set up yet - open Pricing Control first (or Super Admin → Price Tiers) so this can load.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 148, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('MARKET SEGMENT PRICING', 148, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`${pricingTable.tiers.length} tier(s) · ${new Date().toLocaleDateString()}`, 148, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Product', 'List Price', ...pricingTable.tiers.map(t => t.name)]],
      body: (pricingTable.products || []).map(p => [
        p.name, pdfMoney(p.basePrice),
        ...pricingTable.tiers.map(t => pdfMoney(t.prices?.[String(p._id)] ?? p.basePrice)),
      ]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] },
    });
    doc.save(`Market-Segment-Pricing-${todayStr()}.pdf`);
  };

  return {
    exportArPDF, exportApPDF, exportPaymentsPDF, exportProfitByCategoryPDF, exportMenuEngineeringPDF, exportVariancePDF, exportCommissionsPDF, exportBillsPDF,
    exportAuditLogPDF, exportExpensesPDF, exportStockTransfersPDF, exportProductionHistoryPDF, exportProductionOrdersPDF, exportMenuItemsPDF, exportRevolvingFundsPDF, exportPricingMasterlistPDF,
    exportPriceTiersPDF,
  };
}
