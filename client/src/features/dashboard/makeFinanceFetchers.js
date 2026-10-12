import * as ui from '../../shared/ui';

// Loading the finance screens.
// Moved out of AdminDashboard.jsx as it was. The dashboard calls this once per
// render and hands in what these functions read, so each one still sees
// that render's values exactly as it did inline.
export default function makeFinanceFetchers(deps) {
  const {
    activeAdmin, apiFetch, pnlRange, setPnlData, pnlmRange, setPnlMonthly, pnlMonthly, loadPdfLibs,
    pnlmView, addLogoToPDF, BIZ_NAME, pdfMoney, bsmRange, setBsMonthly, bsMonthly, bsmView,
  } = deps;

  // ===== FINANCE FETCHERS =====
  const fetchPnl = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/reports/pnl?start=${pnlRange.start}&end=${pnlRange.end}`);
      const data = await res.json();
      if (data.success) setPnlData(data);
    } catch (err) { console.error('fetchPnl', err); }
  };
  const fetchPnlMonthly = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/reports/pnl-monthly?start=${pnlmRange.start}&end=${pnlmRange.end}`);
      const data = await res.json();
      if (data.success) setPnlMonthly(data);
    } catch (err) { console.error('fetchPnlMonthly', err); }
  };
  const exportPnlMonthlyPDF = async () => {
    if (!pnlMonthly) return ui.alert('Load the Monthly P&L first.');
    const { jsPDF, autoTable } = await loadPdfLibs();
    const m = pnlMonthly;
    const doc = new jsPDF(pnlmView === 'matrix' ? 'landscape' : 'portrait');
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(`${BIZ_NAME} - Profit & Loss`, 14, 14);
    doc.setFontSize(9); doc.text(`${pnlmRange.start} to ${pnlmRange.end}  ·  ${pnlmView === 'matrix' ? 'Monthly' : 'Period'}`, 14, 20);
    const SECTIONS = [['revenue','REVENUE'],['contra','LESS: DISCOUNTS/RETURNS'],['cogs','COST OF SALES'],['opex','OPERATING EXPENSES'],['otherincome','OTHER INCOME'],['otherexpense','OTHER EXPENSES']];
    const nr = m.grandTotals.netRevenue || 0;
    if (pnlmView === 'matrix') {
      const head = ['Account', ...m.months, 'Total'];
      const body = [];
      for (const [sec, label] of SECTIONS) {
        body.push([{ content: label, colSpan: head.length, styles: { fontStyle: 'bold', fillColor: [235,235,235] } }]);
        m.accounts.filter(a => a.section === sec).forEach(a => body.push([`  ${a.code} ${a.name}`, ...m.months.map(mm => pdfMoney(a.byMonth[mm] || 0)), pdfMoney(a.total)]));
      }
      body.push(['NET INCOME', ...m.months.map(mm => pdfMoney(m.monthTotals.netIncome[mm] || 0)), pdfMoney(m.grandTotals.netIncome)]);
      autoTable(doc, { startY: 24, head: [head], body, styles: { fontSize: 6 }, headStyles: { fillColor: [30,30,30] } });
    } else {
      const head = ['Account', 'Amount', '% Rev', '% Parent'];
      const parentTotals = {};
      m.accounts.forEach(a => { parentTotals[a.parentCode] = (parentTotals[a.parentCode] || 0) + a.total; });
      const body = [];
      for (const [sec, label] of SECTIONS) {
        const rows = m.accounts.filter(a => a.section === sec);
        if (!rows.length) continue;
        body.push([{ content: label, colSpan: 4, styles: { fontStyle: 'bold', fillColor: [235,235,235] } }]);
        rows.forEach(a => body.push([`  ${a.code} ${a.name}`, pdfMoney(a.total), nr ? `${(a.total/nr*100).toFixed(1)}%` : '-', parentTotals[a.parentCode] ? `${(a.total/parentTotals[a.parentCode]*100).toFixed(1)}%` : '-']));
      }
      body.push(['NET INCOME', pdfMoney(m.grandTotals.netIncome), nr ? `${(m.grandTotals.netIncome/nr*100).toFixed(1)}%` : '-', '']);
      autoTable(doc, { startY: 24, head: [head], body, styles: { fontSize: 8 }, headStyles: { fillColor: [30,30,30] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } });
    }
    doc.save(`PnL-${pnlmRange.start}_to_${pnlmRange.end}.pdf`);
  };
  const fetchBsMonthly = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/reports/balance-sheet-monthly?start=${bsmRange.start}&end=${bsmRange.end}`);
      const data = await res.json();
      if (data.success) setBsMonthly(data);
    } catch (err) { console.error('fetchBsMonthly', err); }
  };
  const exportBsMonthlyPDF = async () => {
    if (!bsMonthly) return ui.alert('Load the Monthly Balance Sheet first.');
    const { jsPDF, autoTable } = await loadPdfLibs();
    const b = bsMonthly;
    const doc = new jsPDF(bsmView === 'matrix' ? 'landscape' : 'portrait');
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(`${BIZ_NAME} - Balance Sheet`, 14, 14);
    doc.setFontSize(9); doc.text(`${bsmRange.start} to ${bsmRange.end}  ·  ${bsmView === 'matrix' ? 'Monthly' : 'As of ' + b.asOf}`, 14, 20);
    const SECTIONS = [['assets','ASSETS'],['liabilities','LIABILITIES'],['equity','EQUITY']];
    const totalAssets = b.monthTotals.assets[b.asOf] || 0;
    if (bsmView === 'matrix') {
      const head = ['Account', ...b.months];
      const body = [];
      for (const [sec, label] of SECTIONS) {
        body.push([{ content: label, colSpan: head.length, styles: { fontStyle: 'bold', fillColor: [235,235,235] } }]);
        b[sec].forEach(a => body.push([`  ${a.code} ${a.name}`, ...b.months.map(mm => pdfMoney(a.byMonth[mm] || 0))]));
        body.push([`  Total ${label}`, ...b.months.map(mm => pdfMoney(b.monthTotals[sec][mm] || 0))]);
      }
      autoTable(doc, { startY: 24, head: [head], body, styles: { fontSize: 6 }, headStyles: { fillColor: [30,30,30] } });
    } else {
      const head = ['Account', 'Amount', '% Assets', '% Parent'];
      const parentTotals = {};
      [...b.assets, ...b.liabilities, ...b.equity].forEach(a => { parentTotals[a.parentCode] = (parentTotals[a.parentCode] || 0) + a.total; });
      const body = [];
      for (const [sec, label] of SECTIONS) {
        body.push([{ content: label, colSpan: 4, styles: { fontStyle: 'bold', fillColor: [235,235,235] } }]);
        b[sec].forEach(a => body.push([`  ${a.code} ${a.name}`, pdfMoney(a.total), totalAssets ? `${(a.total/totalAssets*100).toFixed(1)}%` : '-', parentTotals[a.parentCode] ? `${(a.total/parentTotals[a.parentCode]*100).toFixed(1)}%` : '-']));
        body.push([`  Total ${label}`, pdfMoney(b.monthTotals[sec][b.asOf] || 0), '', '']);
      }
      autoTable(doc, { startY: 24, head: [head], body, styles: { fontSize: 8 }, headStyles: { fillColor: [30,30,30] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } });
    }
    doc.save(`BalanceSheet-${bsmRange.start}_to_${bsmRange.end}.pdf`);
  };

  return {
    fetchPnlMonthly, fetchBsMonthly, fetchPnl, exportPnlMonthlyPDF, exportBsMonthlyPDF,
  };
}
