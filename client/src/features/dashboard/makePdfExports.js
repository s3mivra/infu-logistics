import { } from 'lucide-react';
import { } from '../../shared/receiptTemplate';
import * as ui from '../../shared/ui';
import { todayStr } from '../../shared/businessDay.js';
import { BUSINESS_TYPE, DEFAULT_DEPARTMENT, DELIVERY_METHODS } from '../../shared/businessType.js';

// The PDF exports: the shared page furniture (logo, money format) and the reports printed with it.
// Moved out of AdminDashboard.jsx as it was. The dashboard calls this once per
// render and hands in what these functions read, so each one still sees
// that render's values exactly as it did inline.
export default function makePdfExports(deps) {
  const {
    systemSettings, inventory, apiFetch, loadPdfLibs, BIZ_NAME, itemDisplay, effectiveDisplay, journalEntries,
    archivedOrders, activeAdmin, archiveTotal, archiveSearch, archiveDateRange, orders, analyticsData, analyticsDisplay,
    pdfMoney, onceAtATime, catForm, editingCategory, setEditingCategory, setCatForm, fetchData, setFormData,
    formData, editingProduct, resetProductForm, packInfo,
  } = deps;

  // ==========================================

  const formatMoney = (val) => `P${(val || 0).toFixed(2)}`;

  // Stamps the business logo in the top-right corner of any jsPDF doc.
  // Converts via canvas so any format (PNG/JPEG/WebP/etc.) renders crisply.
  const addLogoToPDF = async (doc) => {
    // Same priority as the shared receipt/billing-doc letterhead (resolveLetterhead
    // in shared/receiptTemplate.js): a dedicated Print Logo wins when it's toggled
    // on, else fall back to the regular business logo. This function was always
    // using businessLogo unconditionally, so Settings → Printer Settings → Print
    // Logo had zero effect on any of these tabular PDF exports - the print-specific
    // logo the user uploaded (usually plain black line art, made to read on white
    // paper) never showed, only the app's own logo (often styled for a dark UI,
    // so it can render as a barely-visible wash on a white page).
    const logo = (systemSettings.printLogoEnabled && systemSettings.printLogo) ? systemSettings.printLogo : systemSettings.businessLogo;
    if (!logo) return;
    try {
      const img = new Image();
      img.src = logo;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const pngData = canvas.toDataURL('image/png');
      const pw = doc.internal.pageSize.getWidth();
      // Fit the logo INSIDE a 30×18 box, preserving its real aspect ratio -
      // passing mismatched w/h straight to addImage stretches/squishes it to
      // fill that exact box instead.
      const maxW = 30, maxH = 18;
      const ratio = img.naturalWidth / img.naturalHeight;
      let logoW = maxW, logoH = maxW / ratio;
      if (logoH > maxH) { logoH = maxH; logoW = maxH * ratio; }
      doc.addImage(pngData, 'PNG', pw - logoW - 8, 4, logoW, logoH);
    } catch { /* unsupported image - skip */ }
  };

  // 1. Inventory & Movement History PDF (Unchanged)
  const exportInventoryToPDF = async () => {
    if (inventory.length === 0) return ui.alert("No inventory to export.");
    try {
      // Ask for the day this report covers, not the whole trading history.
      // The filter below used to run in the browser over every stock movement
      // ever recorded, which grows without bound.
      const dayKey = todayStr();
      const res = await apiFetch(`/api/inventory/history?start=${dayKey}&end=${dayKey}`);
      const data = await res.json();
      const allHistory = data.success ? data.history : [];
      if (data.truncated) {
        ui.alert(`Showing the most recent ${data.limit} movements for today - there were more than that, so the report is clipped.`);
      }
      const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
      await addLogoToPDF(doc);
      doc.setFontSize(18); doc.text(`${BIZ_NAME} - Daily Inventory & Movement Report`, 14, 15);
      const printedDate = new Date().toLocaleDateString();
      doc.setFontSize(10); doc.text(`Date: ${printedDate} | Generated: ${new Date().toLocaleString()}`, 14, 22);
      
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayHistory = allHistory.filter(h => new Date(h.date) >= startOfDay);
      
      const stockBody = inventory.map(item => {
        const itemHistory = todayHistory.filter(h => h.inventoryId === item._id);
        let purchases = 0, sales = 0, adjustments = 0;
        itemHistory.forEach(h => {
          if (h.type === 'Restock' || h.type === 'Initial') purchases += h.qtyChange;
          else if (h.type === 'Sale') sales += Math.abs(h.qtyChange);
          else if (h.type === 'Adjustment') adjustments += h.qtyChange;
        });
        const ending = item.stockQty;
        const beginning = ending - purchases + sales - adjustments;
        // Show quantities in the item's DISPLAY unit (e.g. 1 L, not 1000 ml). LOG counts
        // in packages (pcs); FB in kg/L/pcs - same conversion the inventory table uses.
        const eff = BUSINESS_TYPE === 'log'
          ? { mult: itemDisplay(item).packBase || 1, unit: 'pcs' }
          : effectiveDisplay(item);
        const conv = (n) => (n / eff.mult).toLocaleString(undefined, { maximumFractionDigits: 3 });
        return [
          item.itemName, eff.unit, conv(beginning), conv(purchases),
          conv(sales), (adjustments > 0 ? '+' : '') + conv(adjustments), conv(ending)
        ];
      });
      autoTable(doc, {
        startY: 30,
        head: [['Item Name', 'Unit', 'Beginning Bal.', 'Purchases (In)', 'Sales (Out)', 'Adjustments', 'Ending Bal.']],
        body: stockBody, theme: 'grid', headStyles: { fillColor: [30, 30, 30], textColor: [255,255,255] }
      });
      doc.save(`Inventory_Movement_${todayStr()}.pdf`);
    } catch (err) { ui.alert("Failed to generate PDF: " + err.message); }
  };

  const exportLedgerToPDF = async () => {
    if (journalEntries.length === 0) return ui.alert("No entries to export.");
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(18); doc.text(`${BIZ_NAME} - General Ledger Report`, 14, 15);
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 22);
    let currentY = 30;
    journalEntries.forEach(entry => {
      if (currentY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); currentY = 20; }
      doc.setFontSize(11); doc.setFont(undefined, 'bold');
      doc.text(`Ref: ${entry.reference}  |  Date: ${new Date(entry.date).toLocaleDateString()}`, 14, currentY);
      doc.setFontSize(10); doc.setFont(undefined, 'normal');
      doc.text(`Memo: ${entry.description}`, 14, currentY + 6);
      const rows = entry.lines.map(line => [`${line.accountCode} - ${line.accountName}`, line.debit ? line.debit.toFixed(2) : '', line.credit ? line.credit.toFixed(2) : '']);
      rows.push(['TOTAL', entry.totalDebit ? entry.totalDebit.toFixed(2) : '0.00', entry.totalCredit ? entry.totalCredit.toFixed(2) : '0.00']);
      autoTable(doc, {
        startY: currentY + 10, head: [['Account', 'Debit (P)', 'Credit (P)']], body: rows,
        theme: 'grid', headStyles: { fillColor: [40, 40, 40] }, styles: { fontSize: 9 }
      });
      currentY = doc.lastAutoTable.finalY + 15;
    });
    doc.save(`General_Ledger_${todayStr()}.pdf`);
  };

  // 1. COMPLETE SALES HISTORY (Master Summary + Daily Breakdown)
  const exportAllToPDF = async () => {
    // The screen holds only the newest 200 past sales; "Export All" means all
    // of them (within the search / dates set on the screen), so read every page.
    // Backdated sales sit among the past sales, and were what went missing.
    let past = archivedOrders;
    if (activeAdmin?.role === 'superadmin' && archiveTotal > archivedOrders.length) {
      try {
        past = [];
        for (let page = 1; page <= 200; page++) {
          const q = new URLSearchParams({ page: String(page), limit: '500' });
          if (archiveSearch) q.set('search', archiveSearch);
          if (archiveDateRange.start) q.set('start', archiveDateRange.start);
          if (archiveDateRange.end) q.set('end', archiveDateRange.end);
          const d = await (await apiFetch(`/api/orders/archives?${q.toString()}`, { cache: 'no-store' })).json();
          if (!d.success) throw new Error(d.error || 'failed');
          past.push(...(d.archives || []));
          if (!(d.archives || []).length || past.length >= (d.total || 0)) break;
        }
      } catch { return ui.alert('Could not load all past sales for the export - check the connection and try again.'); }
    }
    const allOrders = [...orders.filter(o => o.status !== 'Pending' && o.status !== 'Preparing' && o.status !== 'Ready'), ...past].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (allOrders.length === 0) return ui.alert("No orders to export.");
    
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    await addLogoToPDF(doc);
    doc.setFontSize(18); doc.text(`${BIZ_NAME} - Complete Sales History`, 14, 15);
    const timeGenerated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleDateString()} at ${timeGenerated}`, 14, 22);

    const grouped = {};
    allOrders.forEach(o => {
      const date = new Date(o.createdAt).toLocaleDateString();
      if (!grouped[date]) grouped[date] = { orders: [], ordersCount: 0, gross: 0, vatable: 0, vatExempt: 0, vat: 0, discount: 0, netSales: 0 };
      grouped[date].orders.push(o);
      
      // ONLY calculate revenue if the order is officially 'Completed'
      if (o.status === 'Completed') {
        grouped[date].ordersCount++;
        grouped[date].gross += o.subtotal;
        if (o.isVatExempt) { grouped[date].vatExempt += (o.subtotal / 1.12); }
        else { grouped[date].vatable += (o.total / 1.12); }
        grouped[date].vat += o.vatAmount || 0;
        grouped[date].discount += o.isComplimentary ? o.subtotal : (o.discount || 0); // comp = 100% discount
        grouped[date].netSales += o.total;
      }
    });

    // MASTER SUMMARY TABLE
    const summaryBody = Object.keys(grouped).map(date => [
      date, grouped[date].ordersCount.toString(), formatMoney(grouped[date].gross), formatMoney(grouped[date].vatable),
      formatMoney(grouped[date].vatExempt), formatMoney(grouped[date].vat), formatMoney(grouped[date].discount), formatMoney(grouped[date].netSales)
    ]);
    autoTable(doc, {
      startY: 28, head: [['Date', 'Completed Orders', 'Gross Sales (VAT-Inc)', 'VATable Sales', 'VAT-Exempt (PWD)', 'VAT (12%)', 'Discounts', 'Net Sales']],
      body: summaryBody, theme: 'grid', headStyles: { fillColor: [40, 40, 40] }
    });

    let currentY = doc.lastAutoTable.finalY + 15;

    // INDIVIDUAL DAILY BREAKDOWN TABLES
    Object.keys(grouped).forEach(date => {
      if (currentY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); currentY = 20; }
      doc.setFontSize(14); doc.setTextColor(0, 0, 0); doc.text(`Sales Breakdown: ${date}`, 14, currentY);
      
      const dayRows = [];
      let dayTotals = { cash: 0, bank: 0, ewallet: 0, grand: 0 };
      
      grouped[date].orders.forEach(order => {
        const time = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        // --- NEW PAYMENT CLASSIFICATION LOGIC ---
        const pm = order.paymentMethod || 'Cash';
        const isCash = pm === 'Cash';
        const isBank = pm === 'Bank Transfer';
        const isEwallet = ['E-Wallet', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'].includes(pm);
        const isDelivery = DELIVERY_METHODS.includes(pm);
        const isCompleted = order.status === 'Completed';

        // Protect Daily Totals from Voided/Cancelled Orders
        if (isCompleted) {
          if (dayTotals.delivery === undefined) dayTotals.delivery = 0; // Ensure delivery exists
          dayTotals.cash += isCash ? order.total : 0;
          dayTotals.bank += isBank ? order.total : 0;
          dayTotals.ewallet += isEwallet ? order.total : 0;
          dayTotals.delivery += isDelivery ? order.total : 0;
          dayTotals.grand += order.total;
        }

        let discType = '-';
        if (order.isComplimentary || order.transactionType === 'COMPLIMENTARY' || order.discountType === 'Complimentary') {
          discType = 'COMPLIMENTARY';
        } else if (order.discountPercent > 0) {
          discType = order.isVatExempt ? `SC/PWD (${order.discountPercent}%)` : `Promo (${order.discountPercent}%)`;
        }

        // Update the array pushing logic to include Delivery
        order.items.forEach((item, index) => {
          const isLastItem = index === order.items.length - 1;
          dayRows.push([
            time, order.orderNumber, order.status, `${item.quantity}x ${item.name}`,
            formatMoney(item.price * item.quantity),
            isLastItem && isCompleted ? formatMoney(order.vatAmount) : '-',
            isLastItem && isCompleted ? formatMoney(order.discount) : '-', 
            isLastItem ? discType : '-',
            isLastItem && isCash && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isBank && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isEwallet && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isDelivery && isCompleted ? formatMoney(order.total) : '-', // <-- NEW DELIVERY COLUMN
            isLastItem ? (isCompleted ? formatMoney(order.total) : 'VOID') : '-'
          ]);
        });
      });

      // Daily Footer
      dayRows.push(['', '', '', '', '', '', '', 'DAILY TOTAL:', formatMoney(dayTotals.cash), formatMoney(dayTotals.bank), formatMoney(dayTotals.ewallet), formatMoney(dayTotals.delivery), formatMoney(dayTotals.grand)]);
      autoTable(doc, {
        startY: currentY + 5, // Use 28 for exportDayToPDF
        // ADDED 'Delivery' to the Headers!
        head: [['Time', 'Order #', 'Status', 'Item', 'Gross', 'VAT', 'Discount', 'Type', 'Cash', 'Bank', 'E-Wallet', 'Delivery', 'Total']],
        body: dayRows, theme: 'striped', styles: { fontSize: 7 }, columnStyles: { 3: { cellWidth: 40 } },
        willDrawCell: function(data) {
          if (data.row.index === dayRows.length - 1) { doc.setFont(undefined, 'bold'); doc.setTextColor(0, 0, 0); }
        }
      });
      currentY = doc.lastAutoTable.finalY + 15;
    });
    doc.save(`Complete_Sales_History_${todayStr()}.pdf`);
  };

  // 2. EXPORT SPECIFIC DAY 
  const exportDayToPDF = async (dateString, dayOrders) => {
    if (dayOrders.length === 0) return ui.alert("No orders to export.");
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    await addLogoToPDF(doc);
    doc.setFontSize(18); doc.text(`${BIZ_NAME} - Sales Report: ${dateString}`, 14, 15);
    const timeGenerated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleDateString()} at ${timeGenerated}`, 14, 22);
    
    const dayRows = [];
    let dayTotals = { cash: 0, bank: 0, ewallet: 0, grand: 0 };
    
    dayOrders.forEach(order => {
      const time = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // --- NEW PAYMENT CLASSIFICATION LOGIC ---
      const pm = order.paymentMethod || 'Cash';
      const isCash = pm === 'Cash';
      const isBank = pm === 'Bank Transfer';
      const isEwallet = ['E-Wallet', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'].includes(pm);
      const isDelivery = DELIVERY_METHODS.includes(pm);
      const isCompleted = order.status === 'Completed';

      // Protect Daily Totals from Voided/Cancelled Orders
      if (isCompleted) {
        if (dayTotals.delivery === undefined) dayTotals.delivery = 0; // Ensure delivery exists
        dayTotals.cash += isCash ? order.total : 0;
        dayTotals.bank += isBank ? order.total : 0;
        dayTotals.ewallet += isEwallet ? order.total : 0;
        dayTotals.delivery += isDelivery ? order.total : 0;
        dayTotals.grand += order.total;
      }

      let discType = '-';
      if (order.discountPercent > 0) discType = order.isVatExempt ? `SC/PWD (${order.discountPercent}%)` : `Promo (${order.discountPercent}%)`;
      if (order.isComplimentary) discType = 'COMPLIMENTARY';

      // Update the array pushing logic to include Delivery
        order.items.forEach((item, index) => {
          const isLastItem = index === order.items.length - 1;
          dayRows.push([
            time, order.orderNumber, order.status, `${item.quantity}x ${item.name}`,
            formatMoney(item.price * item.quantity),
            isLastItem && isCompleted ? formatMoney(order.vatAmount) : '-',
            isLastItem && isCompleted ? formatMoney(order.discount) : '-', 
            isLastItem ? discType : '-',
            isLastItem && isCash && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isBank && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isEwallet && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isDelivery && isCompleted ? formatMoney(order.total) : '-', // <-- NEW DELIVERY COLUMN
            isLastItem ? (isCompleted ? formatMoney(order.total) : 'VOID') : '-'
          ]);
        });
      });

      // Daily Footer
      dayRows.push(['', '', '', '', '', '', '', 'DAILY TOTAL:', formatMoney(dayTotals.cash), formatMoney(dayTotals.bank), formatMoney(dayTotals.ewallet), formatMoney(dayTotals.delivery), formatMoney(dayTotals.grand)]);
      autoTable(doc, {
        startY: 28,
        // ADDED 'Delivery' to the Headers!
        head: [['Time', 'Order #', 'Status', 'Item', 'Gross', 'VAT', 'Discount', 'Type', 'Cash', 'Bank', 'E-Wallet', 'Delivery', 'Total']],
        body: dayRows, theme: 'striped', styles: { fontSize: 7 }, columnStyles: { 3: { cellWidth: 40 } },
        willDrawCell: function(data) {
          if (data.row.index === dayRows.length - 1) { doc.setFont(undefined, 'bold'); doc.setTextColor(0, 0, 0); }
        }
      });
    doc.save(`Sales_${dateString.replace(/,/g, '').replace(/ /g, '_')}.pdf`);
  };

  // 3. DAILY SALES SUMMARY (Analytics Trend Export)
  const exportAnalyticsToPDF = async () => {
    // STRICT FILTER: Analytics must ONLY track Completed orders. Voided orders must never touch analytics.
    const allCompletedOrders = [...orders.filter(o => o.status === 'Completed'), ...archivedOrders.filter(o => o.status === 'Completed')].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (allCompletedOrders.length === 0) return ui.alert("No analytics data to export.");
    
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    await addLogoToPDF(doc);
    doc.setFontSize(18); doc.text(`${BIZ_NAME} - Analytics Report`, 14, 15);
    const timeGenerated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleDateString()} at ${timeGenerated}`, 14, 22);

    const grouped = {};
    allCompletedOrders.forEach(o => {
      const date = new Date(o.createdAt).toLocaleDateString();
      if (!grouped[date]) grouped[date] = { ordersCount: 0, gross: 0, vatable: 0, vatExempt: 0, vat: 0, discount: 0, netSales: 0 };
      grouped[date].ordersCount++;
      grouped[date].gross += o.subtotal;
      // Prefer the figures the server stamped on the order. The /1.12 fallback
      // is for legacy rows written before VAT was configurable - it assumes the
      // 12% standard rate, which is all those rows can tell us.
      if (o.isVatExempt) { grouped[date].vatExempt += (o.vatExemptSales ?? (o.subtotal / 1.12)); }
      else { grouped[date].vatable += (o.vatableSales ?? (o.total / 1.12)); }
      grouped[date].vat += o.vatAmount || 0;
      grouped[date].discount += o.isComplimentary ? o.subtotal : (o.discount || 0); // comp = 100% discount
      grouped[date].netSales += o.total;
    });

    const summaryBody = Object.keys(grouped).map(date => [
      date, grouped[date].ordersCount.toString(), formatMoney(grouped[date].gross), formatMoney(grouped[date].vatable),
      formatMoney(grouped[date].vatExempt), formatMoney(grouped[date].vat), formatMoney(grouped[date].discount), formatMoney(grouped[date].netSales)
    ]);
    autoTable(doc, {
      startY: 28, head: [['Date', 'Orders', 'Gross Sales (VAT-Inc)', 'VATable Sales', 'VAT-Exempt (PWD/SC)', 'VAT (12%)', 'Discounts', 'Net Sales']],
      body: summaryBody, theme: 'grid', headStyles: { fillColor: [40, 40, 40] }
    });

    // ── Inventory analytics sections (display units: pcs for log, kg/L/pcs for fb) ──
    const ad = analyticsData || {};
    const du = (item) => analyticsDisplay(item || {});
    const sect = (title, head, body, fill) => {
      if (!body.length) return;
      doc.setFontSize(12); doc.text(title, 14, doc.lastAutoTable.finalY + 8);
      autoTable(doc, { startY: doc.lastAutoTable.finalY + 11, head: [head], body, theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: fill } });
    };

    // High Velocity & Forecast
    sect('High Velocity & Forecast', ['Item', 'Daily Burn', 'Lasts', 'Buy 1wk', 'Buy 1mo', 'Trend'],
      (ad.mostUsedStock || []).map(i => { const d = du(i); return [
        i.name, `${((i.dailyAvg||0)/d.mult).toFixed(2)} ${d.unit}`,
        (!isFinite(i.daysLeft) ? '∞' : `${i.daysLeft}d`),
        `${((i.weeklyNeed||0)/d.mult).toFixed(2)} ${d.unit}`,
        `${((i.monthlyNeed||0)/d.mult).toFixed(2)} ${d.unit}`,
        `${i.trend > 0.1 ? 'rising' : i.trend < -0.1 ? 'easing' : 'stable'} ${Math.abs((i.trend||0)*100).toFixed(0)}%`,
      ]; }), [50, 50, 50]);

    // Low Stock (Risk)
    sect('Low Stock (Risk)', ['Item', 'On Hand', 'Days of Supply'],
      (ad.lowestStock || []).map(i => { const d = du(i); return [
        i.itemName, `${(Number(i.stockQty||0)/d.mult).toFixed(2)} ${d.unit}`,
        (i.daysOfSupply <= 0 ? 'OUT' : `~${Math.floor(i.daysOfSupply)}d`),
      ]; }), [30, 30, 30]);

    // Overstock Watch
    sect('Overstock Watch', ['Item', 'On Hand', 'Days of Supply', 'Tied-up Capital (PHP)'],
      (ad.highestStock || []).map(i => { const d = du(i); return [
        i.itemName, `${(Number(i.stockQty||0)/d.mult).toFixed(2)} ${d.unit}`,
        (isFinite(i.daysOfSupply) ? `~${Math.floor(i.daysOfSupply)}d` : '∞'),
        pdfMoney(i.tiedUpCapital || 0),
      ]; }), [90, 90, 90]);

    doc.save(`Analytics_Report_${todayStr()}.pdf`);
  };

  // 4. Sales History PDF Helper
  const handleSaveCategory = onceAtATime('category', async (e) => {
    e.preventDefault(); 
    if(!catForm.name.trim()) return; 

    if (editingCategory) {
      await apiFetch(`/api/categories/${editingCategory._id}`, { 
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(catForm) 
      });
      setEditingCategory(null);
    } else {
      await apiFetch(`/api/categories`, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(catForm) 
      });
    }
    setCatForm({ name: '', department: DEFAULT_DEPARTMENT });
    fetchData();
  });

  const deleteCategory = async (id) => { if(await ui.confirm('Delete category?')) await apiFetch(`/api/categories/${id}`, { method: 'DELETE' }); };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image(); img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scaleSize = 600 / img.width;
        canvas.width = 600; canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setFormData({ ...formData, image: canvas.toDataURL('image/webp', 0.8) });
      };
    };
  };

  const handleSaveProduct = onceAtATime('product', async (e) => {
    e.preventDefault();
    const method = editingProduct ? 'PUT' : 'POST';
    const url = editingProduct ? `/api/products/${editingProduct._id}` : `/api/products`;
    // Normalize modifierGroups to just IDs before sending
    const payload = {
      ...formData,
      modifierGroups: (formData.modifierGroups||[]).map(id => (id && id._id) ? id._id : id),
      image: formData.imageUrl?.trim() || formData.image, // URL overrides uploaded base64
    };
    const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.success) { ui.alert(data.error || 'Failed to save product.'); return false; }
    resetProductForm();
    fetchData();
    return true;
  });
  const deleteProduct = async (id) => {
    if(await ui.confirm("Delete this product permanently?")) {
      await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
      if (editingProduct && editingProduct._id === id) resetProductForm();
    }
  };
  
  const addSize = () => setFormData({ ...formData, sizes: [...formData.sizes, { name: '', price: 0 }] });
  const updateSize = (index, field, value) => { const newSizes = [...formData.sizes]; newSizes[index][field] = field === 'price' ? parseFloat(value) || 0 : value; setFormData({ ...formData, sizes: newSizes }); };
  const removeSize = (index) => setFormData({ ...formData, sizes: formData.sizes.filter((_, i) => i !== index) });

  const addMaterialToRecipe = (invId, sizeIndex = null) => {
    if (!invId) return;
    const invItem = inventory.find(i => i._id === invId);
    if (!invItem) return;
    // A cafe writes recipes in the real measure - 20 g, 150 ml, 1 pc - the
    // same way the stock card reports what a sale took. Starting a new line at
    // one whole PACK put a kilo of beans into a coffee until someone noticed.
    if (BUSINESS_TYPE !== 'log') {
      const material = {
        invId: invItem._id, name: invItem.itemName,
        qty: 1, cost: invItem.unitCost, unit: invItem.unit || 'pcs', packBase: 1,
      };
      if (sizeIndex === null) setFormData({ ...formData, baseRecipe: [...(formData.baseRecipe || []), material] });
      else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe = [...(newSizes[sizeIndex].recipe || []), material]; setFormData({ ...formData, sizes: newSizes }); }
      return;
    }
    const pack = packInfo(invItem);
    const packBase = pack.packBase || 1;         // base units per display unit (e.g. 377 for a 377g can)
    // Logistics sells per piece - always label ingredients as "pcs" so qty=1 means 1 package/unit.
    // qty below is ONE PACK in base units, so the label has to be the pack's
    // own label ("377g"), not the raw display unit - otherwise a 377g can
    // reads as "1 kg".
    const displayUnit = BUSINESS_TYPE === 'log' ? 'pcs' : pack.label;
    const material = {
      invId: invItem._id, name: invItem.itemName,
      qty: packBase,           // stored in BASE units; 1 pack's worth by default
      cost: invItem.unitCost,  // ₱ per BASE unit (for calcRecipeCost)
      unit: displayUnit,       // display unit shown in UI (pcs, kg, L)
      packBase,                // conversion factor; 1 = no conversion (legacy/pcs)
    };
    if (sizeIndex === null) { setFormData({ ...formData, baseRecipe: [...(formData.baseRecipe || []), material] });
    } else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe = [...(newSizes[sizeIndex].recipe || []), material]; setFormData({ ...formData, sizes: newSizes }); }
  };
  // A recipe line that is measured but is not stock - filtered water is the
  // case this exists for. It has no inventory item behind it, so nothing is
  // deducted when the drink sells and nothing can run out; it is there so the
  // recipe records how much goes in, which is what makes two baristas produce
  // the same cold brew. Cost stays at zero deliberately: see the zRecipe note
  // in server.js for why an invented cost has nowhere to balance.
  const addNonStockToRecipe = (name, unit, sizeIndex = null) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const material = { name: clean, qty: 0, cost: 0, unit: String(unit || '').trim() || 'ml', packBase: 1, nonStock: true };
    if (sizeIndex === null) { setFormData({ ...formData, baseRecipe: [...(formData.baseRecipe || []), material] });
    } else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe = [...(newSizes[sizeIndex].recipe || []), material]; setFormData({ ...formData, sizes: newSizes }); }
  };
  const updateMaterialQty = (val, matIndex, sizeIndex = null) => {
    const newQty = parseFloat(val) || 0;
    if (sizeIndex === null) { const newRecipe = [...formData.baseRecipe]; newRecipe[matIndex].qty = newQty; setFormData({ ...formData, baseRecipe: newRecipe });
    } else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe[matIndex].qty = newQty; setFormData({ ...formData, sizes: newSizes }); }
  };
  const removeMaterial = (matIndex, sizeIndex = null) => {
    if (sizeIndex === null) { setFormData({ ...formData, baseRecipe: formData.baseRecipe.filter((_, i) => i !== matIndex) });
    } else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe = newSizes[sizeIndex].recipe.filter((_, i) => i !== matIndex); setFormData({ ...formData, sizes: newSizes }); }
  };
  // Non-stock lines are excluded, so this preview matches the COGS the server
  // actually books (orders.js skips any ingredient that resolves to no
  // inventory item). Counting them here would quietly overstate the cost of
  // every drink containing one.
  //
  // Priced on the ingredient's cost as it is NOW, not the cost copied onto the
  // recipe line the day it was added. The till books cost of sale at the live
  // cost and the menu export does too; this screen alone used the snapshot, so
  // after a supplier raised a price the margin shown here - and the "Set 30%
  // Margin" suggestion built on it - stayed flattering while real COGS rose.
  // Same resolution as a sale: stock link first, then name, and the snapshot
  // only when the stock item no longer exists.
  const calcRecipeCost = (recipe) => (recipe || [])
    .filter(item => !item.nonStock)
    .reduce((sum, item) => {
      const live = (item.invId && inventory.find(i => String(i._id) === String(item.invId)))
        || (item.name && inventory.find(i => String(i.itemName || '').toUpperCase() === String(item.name).toUpperCase()));
      const perBase = live ? (Number(live.unitCost) || 0) : (Number(item.cost) || 0);
      return sum + (Number(item.qty) || 0) * perBase;
    }, 0);

  // --- ESTIMATED MENU STOCK CALCULATOR ---
  const getEstimatedStock = (recipe) => {
    if (!recipe || recipe.length === 0) return null;
    // A recipe made only of non-stock ingredients has nothing that can run out,
    // so it has no stock estimate at all - `null` (not applicable), the same
    // answer an empty recipe gives. Reporting 0 would read as "cannot make any".
    if ((recipe || []).every(m => m.nonStock)) return null;
    let minServings = Infinity;
    for (let mat of recipe) {
      // A non-stock ingredient never limits how many you can make - there is no
      // quantity of it to run out. Without this skip it would fall through to
      // the `return 0` below and report every drink containing filtered water
      // as unmakeable.
      if (mat.nonStock) continue;
      const invItem = inventory.find(i => i._id === mat.invId);
      if (!invItem) return 0;
      let possibleServings;
      if (BUSINESS_TYPE === 'log') {
        // Work in BASE units so stale recipe rows (saved before packBase was
        // tracked) are handled correctly.  If mat.packBase is stored we can
        // derive how many packs the recipe calls for; otherwise assume 1 pack.
        const currentPackBase = packInfo(invItem).packBase || 1;
        let qtyBase;
        if (mat.packBase > 1) {
          const packCount = mat.qty / mat.packBase;  // e.g. 377/377 = 1 pack
          qtyBase = packCount * currentPackBase;      // re-express in current base
        } else if (mat.packBase === 1) {
          // Already in base units - an imported line is written in the unit
          // stock is counted in, one unit to one base unit. Re-expressing it
          // against the pack would multiply it by the pack size.
          qtyBase = mat.qty;
        } else {
          qtyBase = currentPackBase;                  // legacy: treat as 1 pack per serving
        }
        possibleServings = Math.floor(invItem.stockQty / (qtyBase || 1));
      } else {
        // FB: qty stored in base units; direct division gives servings.
        possibleServings = Math.floor(invItem.stockQty / (mat.qty || 1));
      }
      if (possibleServings < minServings) minServings = possibleServings;
    }
    return minServings === Infinity ? 0 : minServings;
  };

  return {
    addLogoToPDF, calcRecipeCost, exportAnalyticsToPDF, exportDayToPDF, exportInventoryToPDF, exportLedgerToPDF, exportAllToPDF, handleSaveProduct,
    handleSaveCategory, deleteProduct, deleteCategory, updateSize, removeSize, addSize, addMaterialToRecipe, addNonStockToRecipe,
    updateMaterialQty, removeMaterial, getEstimatedStock, handleImageUpload,
  };
}
