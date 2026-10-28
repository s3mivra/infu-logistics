import React, { useState, useEffect, useRef } from 'react';
import { roundMoney } from '../../shared/money.js';
import SplitPayEditor, { newSplit, splitReady, splitPayload } from './SplitPayEditor';
import { X, Lock, Unlock, FileText, AlertTriangle, Plus, Trash2, Download, Upload, RefreshCw, Clock, ChevronRight, ChevronLeft, ShieldCheck, Search, History } from 'lucide-react';
import { isCancelledRow, isCancelledSheet, partitionCancelledGroups } from '../../shared/backdateCancelled';
import { usePagination } from '../../shared/usePagination';
import Pager from '../../shared/Pager';
import ExpensesPage from './ExpensesPage';
import * as ui from '../../shared/ui';
import { buildBillingDocHTML, printBillingDoc } from '../../shared/billingDocument';
import { LEDGER_TAB_GROUPS, REPORT_TAB_GROUPS } from '../dashboard/navRegistry';
import * as auth from '../auth/auth';

import { dateStr, monthStartStr, todayStr } from '../../shared/businessDay.js';
import SearchSelect from '../../shared/ui/SearchSelect';
import ManualJournalApprovals from './ManualJournalApprovals';
import LedgerEntryEditor from './LedgerEntryEditor';
import CommissionRules from './CommissionRules';
import PaymentMethodPicker, { paymentDetailsPayload, missingPaymentDetail, notePaymentMethodUsed, mostUsedMethod, NEEDS_REFERENCE } from '../../shared/PaymentMethodPicker';
import { CashFlowReport, SalesByChannelReport, SalesByCustomerReport, BudgetReport, ExceptionsReport, ClosingChecklist } from './ProcessReports';
import Attachments from '../../shared/Attachments';
import RangePresets from '../../shared/RangePresets';
import FundSpendsToCheck from './FundSpendsToCheck';
import RecurringBills from './RecurringBills';
import { PrepListReport, FeedbackReport } from '../cafe/CafeExtras';
import { SupplierStatementReport } from '../ops/OpsExtras';
import { WasteReport, SalesByHourReport, CashForecastReport, CashierPerformanceReport, SupplierPricesReport, SalesTargetsReport, DeliverySheetReport } from './InsightReports';
import AdvancesTab from './AdvancesTab';
import CollectionsTab from './CollectionsTab';
import ReceivablesTab from './ReceivablesTab';
import PayablesTab from './PayablesTab';
import PaymentRoutingTab from './PaymentRoutingTab';
import RevolvingFundTab from './RevolvingFundTab';
import PriceLogTab from './PriceLogTab';
import ChartOfAccountsTab from './ChartOfAccountsTab';
import CheckVouchersTab from './CheckVouchersTab';
import ExportAllTab from './ExportAllTab';
import PayablesReportTab from './PayablesReportTab';
import ProfitAndLossTab from './ProfitAndLossTab';
import ReceivablesReportTab from './ReceivablesReportTab';
import SupplierPaymentsTab from './SupplierPaymentsTab';
import BalanceSheetTab from './BalanceSheetTab';
import SalesDocsTab from './SalesDocsTab';
import SalesByOrderTab from './SalesByOrderTab';
import { BUSINESS_TYPE } from '../../shared/businessType.js';

// ── LedgerTab - extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
// The P&L and the Balance Sheet each used to be two pages, one per period
// and one month by month, in two different menus. Now one page each, with
// this switch between the two views.
const STATEMENT_PAGES = ['pnlmonthly', 'bsmonthly', 'arreport', 'apreport'];
function StatementViewSwitch({ value, onChange, options }) {
  return (
    <div className="flex mb-3" role="tablist" aria-label="View">
      <div className="inline-flex bg-white/5 border border-white/10 rounded-xl p-1">
        {options.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${value === id ? 'bg-brand text-on-brand' : 'text-fg/75 hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function LedgerTab({ ctx }) {
  // Destructure everything from ctx
  // What this tab reads from ctx - only the names it uses. Add one here when
  // the tab needs it (scripts_temp/fix_tab_destructures.cjs would re-add all ~300).
  const {
    BIZ_NAME, 
    accountingPage,
    journalSearch, setJournalSearch,
    activeAdmin, activeTab, can,
    apiFetch,
    arOutstanding, arAgeing, fetchArAgeing, fetchExpenses,
    openArHistory, todayLocal,
    arReport, arReportAsOf, setArReportAsOf, fetchArReport,
    apReport, apReportAsOf, setApReportAsOf, fetchApReport,
    supplierPayments, supPayRange, setSupPayRange, fetchSupplierPayments,
    collectionReport, collRange, setCollRange, fetchCollectionReport,
    checkRegister, checkFilter, setCheckFilter, fetchChecks, actOnCheck,
    changeRequests, canApprovePricing, fetchChangeRequests, actOnChangeRequest,
    priceChangeLog, priceLogRange, setPriceLogRange, fetchPriceChangeLog,
    bsData, cashOnHand, 
    closeRfFund, 
    currentEntries,
    exportLedgerToPDF, fetchArOutstanding,
    fetchBalanceSheet, fetchERPData, fetchExpenseCategories, setBulkOpInProgress,
    exportRevolvingFundsPDF,
    fetchPnl, fetchRfFunds, fetchRfTxs, 
    isSuperAdmin, 
    jeForm, ledgerSubTab, 
    parseImportFile, peso,
    pnlData, pnlRange, pnlMonthly, pnlmRange, setPnlmRange, pnlmView, setPnlmView, fetchPnlMonthly, exportPnlMonthlyPDF, bsMonthly, bsmRange, setBsmRange, bsmView, setBsmView, fetchBsMonthly, exportBsMonthlyPDF, 
    products,
    rfActiveFund, rfFunds,
    rfLoading, 
    rfTxPage, rfTxPages, rfTxTotal,
    rfTxs, setAccountingPage, 
    setJeForm, setLedgerSubTab,
    setPnlRange, 
    setRfActiveFund, setRfDisbForm, setRfDisbModal, 
    setRfNewModal, setRfReplForm, setRfReplModal, setRfTxs, 
    setSettleForm, setSettleModal, 
    standardAccounts, 
    totalAccountingPages, 
    apData, fetchApData, apPayModal, setApPayModal, apPayForm, setApPayForm, apPaySubmitting, submitApPayment, suppliers, fetchSuppliers,
    bills, billsFilter, setBillsFilter, fetchBills, billBusy,
    billCreate, setBillCreate, submitCreateBill,
    approveBill, rejectBill, scheduleBill,
    billInvoiceModal, setBillInvoiceModal, billInvoiceForm, setBillInvoiceForm, openBillInvoice, submitBillInvoice,
    billPayModal, setBillPayModal, billPayFrom, setBillPayFrom, billPayReference, setBillPayReference, submitBillPay, expenseAccounts,
    billPayAmount, setBillPayAmount, applySupplierCredit,
    clientCreditModal, setClientCreditModal, openClientCredit, submitClientCredit,
    checkVouchers, cvTotal, cvFilter, setCvFilter, fetchCheckVouchers,
    cvVoidModal, setCvVoidModal, submitVoidVoucher,
    advances, advTotals, advFilter, setAdvFilter, fetchAdvances, advBusy,
    advIssueModal, setAdvIssueModal, submitIssueAdvance, ADV_ISSUE_BLANK,
    advLiqModal, setAdvLiqModal, openAdvLiquidate, submitLiquidateAdvance,
    advCancelModal, setAdvCancelModal, submitCancelAdvance,
    obEntry, obRows, setObRows, obMeta, setObMeta, obBusy, fetchOpeningBalances, submitOpeningBalances, balanceSheetAccounts,
    exportBusy, downloadDataset, downloadAccountBalances,
    exportAllBusy, downloadAllExports, exportProgress, exportDatasets, fetchExportDatasets,
    backupBusy, backupProgress, downloadFullBackup, restoreFullBackup,
    profitByCategory, fetchProfitByCategory,
    salesByPayment, sbpRange, setSbpRange, fetchSalesByPayment,
    salesSummary, sssRange, setSssRange, sssGroup, setSssGroup, sssRows, fetchSalesSummary, exportSalesSummaryPDF,
    salesLineItems, sliRange, setSliRange, salesSource, setSalesSource, fetchSalesLineItems, exportSalesLineItemsPDF,
    menuEngineering, fetchMenuEngineering, cashierVariance, fetchCashierVariance, 
    commissions, fetchCommissions,
    exportPnlPDF, exportBalanceSheetPDF, reconcileInventory,
    exportArPDF, exportApPDF, exportPaymentsPDF,
    exportProfitByCategoryPDF, exportMenuEngineeringPDF, exportVariancePDF, exportCommissionsPDF,
    exportBillsPDF, loadPdfLibs, addLogoToPDF, pdfMoney,
    coaAccounts, fetchCoa, coaParent, setCoaParent, coaNewName, setCoaNewName,
    coaEditId, setCoaEditId, coaEditName, setCoaEditName, coaBusy,
    addCoaChild, renameCoaChild, deleteCoaChild, toggleAccountActive, seedPaymentSubaccounts,
    cashAndBankAccounts, apAccounts, arAccounts,
    closedPeriods, fetchClosedPeriods, closePeriod, reopenPeriod,
    periodCloseForm, setPeriodCloseForm,
    paymentMap, fetchPaymentMap, savePaymentMapping, resetPaymentMapping,
    tenancyReport, tenancyBusy, tenancyError, tenancyProgress, fetchTenancyReport, runTenancyRebackfill,
    clientAccounts,
    systemSettings = {},
    setActiveTab,
  } = ctx;

  // ── Stage 2 report views: self-contained fetches via ctx.apiFetch ──────────

  // A check voucher exists to be printed and signed - prepared, approved,
  // received. Until now it could only be listed and voided on screen, which is
  // the one thing a voucher is not for.
  const printCheckVoucher = (v) => {
    const PURPOSE_LABEL = {
      'bill-payment': "Payment of supplier's bill",
      'client-credit-refund': 'Refund of client credit balance',
      payroll: 'Payroll - net pay',
      expense: 'Operating expense',
      'petty-cash': 'Petty cash / revolving fund',
      advance: 'Advance payment',
      other: 'Disbursement',
    };
    printBillingDoc(buildBillingDocHTML({
      docTitle: 'CHECK VOUCHER',
      dateLabel: 'Date',
      dateStr: new Date(v.date).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }),
      settings: systemSettings,
      metaFields: [
        { label: 'Voucher No.', value: v.voucherNumber || '' },
        { label: 'Pay To', value: v.payeeName || '' },
        ...(v.branchCode ? [{ label: 'Branch', value: v.branchCode }] : []),
        { label: 'Paid From', value: v.sourceAccountName || v.sourceAccount || '' },
        ...(v.referenceNumber ? [{ label: 'Check / Ref No.', value: v.referenceNumber }] : []),
      ],
      subFields: [
        { label: 'Purpose', value: PURPOSE_LABEL[v.purpose] || v.purpose || '' },
        ...(v.journalEntryRef ? [{ label: 'Journal Ref.', value: v.journalEntryRef }] : []),
      ],
      // A voided voucher still prints - it has to be filed as evidence of the
      // cancellation, with the reason on its face.
      schedRows: v.status === 'Voided'
        ? [{ label: 'VOIDED:', value: `${v.voidReason || 'No reason given'}${v.voidedBy ? ` (by ${v.voidedBy})` : ''}` }]
        : [],
      itemColumns: [
        { label: 'Particulars', key: 'desc' },
        { label: 'Reference', key: 'ref' },
        { label: 'Amount', key: 'amount', align: 'right', money: true },
      ],
      items: [{
        desc: v.notes || PURPOSE_LABEL[v.purpose] || 'Disbursement',
        ref: v.referenceNumber || v.journalEntryRef || '',
        amount: v.amount,
      }],
      totals: [{ label: 'TOTAL', value: v.amount, grand: true }],
      termsTitle: 'Please note',
      terms: [
        'This voucher records a payment made out of the account shown above.',
        'It is valid only with the authorising signature; keep it with the supporting invoice or receipt.',
        v.status === 'Voided'
          ? 'THIS VOUCHER HAS BEEN VOIDED. It is kept on file as the record of the cancellation - do not pay against it.'
          : 'Sign on receipt of the amount stated.',
      ],
      signatures: [
        'PREPARED BY: Signature over Printed Name / Date',
        'APPROVED BY: Signature over Printed Name / Date',
        'RECEIVED BY: Signature over Printed Name / Date',
      ],
      copies: ['ORIGINAL'],
    }));
  };
  const money2 = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // journalEntries only ever holds the 500 most recent-by-date entries, so an
  // old-dated entry (e.g. a backdated sale) may not be in memory at all - no
  // amount of client-side filtering can find it. Re-fetch from the server's
  // own search whenever the ledger search box has a term, so the lookup isn't
  // bounded by that recent-500 window. Debounced so it doesn't fire per keystroke.
  const journalSearchMounted = useRef(false);
  // Module import result needs to survive across renders (a plain `let` here
  // gets re-initialized to null on every re-render, which threw "XLSX not
  // loaded" the moment the sheet-picker's setState triggered a re-render
  // between the dynamic import and the later parse).
  const xlsxRef = useRef(null);
  useEffect(() => {
    if (!journalSearchMounted.current) { journalSearchMounted.current = true; return; }
    const q = journalSearch.trim();
    const t = setTimeout(() => { fetchERPData(q); }, q ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalSearch]);

  // ── Backdate Sale - a mini-POS: pick products, quantities, discount, comp,
  //    then record it against a past date (optionally reducing today's stock). ──
  const [bd, setBd] = useState({
    date: todayStr(),
    customerName: '', paymentMethod: mostUsedMethod(['Cash', 'Bank Transfer', 'GCash', 'Maya', 'Check', 'On Account']), notes: '', checkNumber: '', checkBank: '', checkDate: '', reference: '',
    discountPercent: 0, affectInventory: false, isComplimentary: false,
  });
  const [bdCart, setBdCart] = useState([]); // [{ productId, productCode, name, price, quantity }]
  // Tenancy Health scans every businessType-carrying collection (~two dozen),
  // and nearly all of them are clean, so defects are what the panel shows by
  // default and the full list is opt-in.
  const [tenancyShowAll, setTenancyShowAll] = useState(false);
  // Export All defaults to the current month: the journal export is capped at
  // one quarter server-side, so a wide-open default would just fail.
  const [exportAllRange, setExportAllRange] = useState(() => {
    return { start: monthStartStr(), end: todayStr() };
  });
  // What to export. A key that is missing counts as selected, so everything is
  // ticked until someone chooses otherwise; the presets write explicit values.
  const [exportPicked, setExportPicked] = useState({ ds: {}, rep: {} });
  const EXPORT_REPORTS = [
    { key: 'journal', label: 'General Journal', note: 'PDF report, one line per posting, with totals - capped at one quarter' },
    { key: 'auditlog', label: 'Audit Log', note: 'PDF report - who changed what, and when' },
    { key: 'accountBalances', label: 'Account Balances', note: 'Sheet in the workbook - every account and its balance' },
    { key: 'validValues', label: 'Valid Values', note: 'Sheet in the workbook - accepted values for each column' },
  ];

  // One progress bar for both long-running screens. It shows finished steps
  // out of the total, so it only ever moves when real work completes - a
  // spinner cannot tell "nearly done" from "stuck", and that was the problem.
  const renderProgress = (prog, fallback) => {
    if (!prog) return null;
    const pct = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
    return (
      <div className="space-y-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
        <div className="flex justify-between gap-3 text-[10px] font-bold uppercase tracking-widest text-fg/70">
          <span className="truncate">{prog.label || fallback}</span>
          <span className="tabular-nums shrink-0">{prog.done} / {prog.total} - {pct}%</span>
        </div>
        <div className="h-2 bg-page-bg border border-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-brand transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };
  const [bdSearch, setBdSearch] = useState('');
  const [bdBusy, setBdBusy] = useState(false);
  // Bumped when an entry is sent for approval, so the waiting list reloads.
  const [jeDraftsKey, setJeDraftsKey] = useState(0);
  // A change request's values in the terms of their field: money in pesos,
  // terms in days, yes/no for flags, and text (a TIN, a name) as written.
  const MONEY_FIELDS = new Set(['basePrice', 'costOverride', 'creditLimit', 'unitCost', 'srp']);
  const crValue = (field, v) => {
    if (v === null || v === undefined || v === '') return field === 'creditLimit' ? 'no limit' : '(blank)';
    if (MONEY_FIELDS.has(field)) return `₱${Number(v || 0).toFixed(2)}`;
    if (field === 'creditTermsDays') return `${v} days`;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  };
  const CR_ENTITY = { Product: 'Product', Inventory: 'Stock item', ClientAccount: 'Client', Supplier: 'Supplier' };
  // Daily sales report: the item-level detail, or one row per sales document.
  const [sliView, setSliView] = useState('detail');
  const [sliSummary, setSliSummary] = useState(null);
  // All sales, or only backdated ones, or only live ones - the same choice on
  // every sales report (see salesSource in AdminDashboard).
  const srcOf = (arg) => (typeof arg === 'string' ? arg : (salesSource || ''));
  const salesSourceSelect = (onPick) => (
    <select value={salesSource || ''} aria-label="Which sales"
      onChange={e => { const v = e.target.value; setSalesSource?.(v); onPick(v); }}
      title="All sales, only backdated sales (entered after the fact or imported), or only live sales"
      className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg text-xs font-bold outline-none focus:border-brand/60">
      <option value="">All sales</option>
      <option value="backdated">Backdated only</option>
      <option value="live">Live only</option>
    </select>
  );
  const loadSliSummary = async (src) => {
    try {
      const s = srcOf(src);
      const d = await (await apiFetch(`/api/reports/sales-documents?start=${sliRange.start}&end=${sliRange.end}${s ? `&source=${s}` : ''}`)).json();
      if (d.success) setSliSummary(d); else ui.alert(d.error || 'Could not load the summary.');
    } catch { ui.alert('Network error.'); }
  };
  const loadSli = (src) => (sliView === 'summary' ? loadSliSummary(src) : fetchSalesLineItems(src));
  // One Sales page, four ways to read it. The first two are the same report
  // (by payment channel) per order or per day; "Orders" is one row per order
  // with just its subtotal, discount and total; "Detailed" is one row per item.
  const [salesView, setSalesView] = useState(sssGroup === 'day' ? 'day' : 'order');
  // Writing a PO number on a bill that did not come from one of our POs.
  const [billPoEdit, setBillPoEdit] = useState(null);   // { id, value }
  // Check vouchers: writing one by hand, and the list as Excel / PDF (what is
  // on screen - the filters above it apply).
  const [cvNewOpen, setCvNewOpen] = useState(false);
  // Cost of goods sold for backdated sales that have products but no cost yet.
  const [bdCosting, setBdCosting] = useState(false);
  // The Ledger Editor's open entry (superadmin only).
  const [editingEntryId, setEditingEntryId] = useState(null);
  const bookBackdatedCosts = async () => {
    if (!(await ui.confirm({
      title: 'Book cost of goods sold for backdated sales?',
      message: 'Each backdated sale that has its products but no cost yet gets its cost of goods sold booked on its own date, from what its stock items cost now. Stock quantities are not changed. Sales already costed are left alone.',
      confirmLabel: 'Book the cost',
    }))) return;
    setBdCosting(true);
    try {
      const d = await (await apiFetch('/api/admin/backdate-sale/book-costs', { method: 'POST' })).json();
      if (!d.success) return ui.alert(d.error || 'Could not book the cost.');
      const p2 = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      ui.alert(`${d.booked} of ${d.checked} sale(s) costed - ${p2(d.total)} booked as cost of goods sold.`
        + ((d.noCost || []).length ? `\n\nNo cost found for (no stock item, or its cost is 0):\n- ${d.noCost.slice(0, 15).join('\n- ')}${d.noCost.length > 15 ? `\n...and ${d.noCost.length - 15} more` : ''}` : '')
        + ((d.problems || []).length ? `\n\nSkipped:\n- ${d.problems.slice(0, 5).join('\n- ')}` : ''));
      fetchERPData?.();
    } catch { ui.alert('Network error - run it again; sales already costed are skipped.'); }
    finally { setBdCosting(false); }
  };
  const cvExportRows = () => (checkVouchers || []).map(v => [
    v.voucherNumber || '', v.date ? dateStr(v.date) : '', v.payeeName || '', v.payeeType || '', v.purpose || '',
    v.sourceAccountName || v.sourceAccount || '', v.referenceNumber || '', v.notes || '', v.status || '',
  ]);
  const CV_HEAD = ['Voucher No.', 'Date', 'Payee', 'Payee type', 'Purpose', 'Paid from', 'Reference', 'Particulars', 'Status'];
  const cvStamp = () => `${cvFilter.start || 'start'}_to_${cvFilter.end || todayStr()}`;
  const exportCvExcel = async () => {
    if (!(checkVouchers || []).length) return ui.alert('No vouchers to export.');
    const XLSX = await import('xlsx');
    const body = checkVouchers.map((v, i) => [...cvExportRows()[i], v.amount || 0]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...CV_HEAD, 'Amount'], ...body, [], ['TOTAL ISSUED (voided excluded)', '', '', '', '', '', '', '', '', cvTotal || 0]]), 'Check Vouchers');
    XLSX.writeFile(wb, `Check-Vouchers_${cvStamp()}.xlsx`);
  };
  const exportCvPDF = async () => {
    if (!(checkVouchers || []).length) return ui.alert('No vouchers to export.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(`${BIZ_NAME} - Check Vouchers`, 14, 14);
    doc.setFontSize(9); doc.text(`${cvFilter.start || 'All dates'}${cvFilter.end ? ` to ${cvFilter.end}` : ''}${cvFilter.status ? `  ·  ${cvFilter.status}` : ''}${cvFilter.payeeType ? `  ·  ${cvFilter.payeeType}` : ''}`, 14, 20);
    autoTable(doc, {
      startY: 24, head: [[...CV_HEAD, 'Amount']],
      body: checkVouchers.map((v, i) => [...cvExportRows()[i], pdfMoney(v.amount)]),
      foot: [['TOTAL ISSUED (voided excluded)', '', '', '', '', '', '', '', '', pdfMoney(cvTotal || 0)]],
      styles: { fontSize: 7 }, headStyles: { fillColor: [30, 30, 30] }, footStyles: { fillColor: [70, 70, 70], textColor: 255 },
    });
    doc.save(`Check-Vouchers_${cvStamp()}.pdf`);
  };
  const saveBillPo = async () => {
    if (!billPoEdit) return;
    try {
      const d = await (await apiFetch(`/api/bills/${billPoEdit.id}/po-number`, { method: 'PATCH', body: JSON.stringify({ poNumber: billPoEdit.value }) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not save the PO number.');
      const typed = billPoEdit.value.trim();
      setBillPoEdit(null);
      fetchBills();
      if (typed) ui.toast(d.linked ? `Linked to purchase order ${d.bill.poNumber}.` : `Saved as a reference - there is no purchase order ${typed} in the app.`);
    } catch { ui.alert('Network error.'); }
  };
  const SALES_VIEWS = [
    ['order', 'Summary', 'One row per order, by how it was paid'],
    ['day', 'Daily', 'One row per day, by how it was paid'],
    ['docs', 'Orders', 'One row per order: gross sales, discount and sales after discount'],
    ['detail', 'Detailed', 'One row per item sold'],
  ];
  const pickSalesView = (k) => {
    setSalesView(k);
    if (k === 'order' || k === 'day') { setSssGroup(k); if (!salesSummary) fetchSalesSummary(); }
    else if (k === 'docs') { setSliView('summary'); if (!sliSummary) setTimeout(loadSliSummary, 0); }
    else { setSliView('detail'); if (!salesLineItems) fetchSalesLineItems(); }
  };
  const salesViewTabs = () => (
    <div className="flex gap-1 mt-2 flex-wrap" role="tablist" aria-label="How to show the sales">
      {SALES_VIEWS.map(([k, label, hint]) => (
        <button key={k} role="tab" aria-selected={salesView === k} title={hint} onClick={() => pickSalesView(k)}
          className={`px-3 py-1 rounded-lg text-[11px] font-bold ${salesView === k ? 'bg-brand text-on-brand' : 'bg-white/5 text-fg/80 hover:bg-white/10'}`}>{label}</button>
      ))}
    </div>
  );
  const exportSssExcel = async () => {
    if (!salesSummary) return ui.alert('Load the report first.');
    const XLSX = await import('xlsx');
    const day = sssGroup === 'day';
    const head = ['Date', ...(day ? ['Orders'] : ['Customer ID', 'Customer Name', 'Order']), 'Cash', 'E-Wallet', 'Bank', 'Delivery', 'Gross Sales', 'Sales After Discount'];
    const body = sssRows.map(r => [r.date ? dateStr(r.date) : '', ...(day ? [r.count] : [r.customerId || '', r.customerName || '', r.orderNumber]), r.cash || 0, r.ewallet || 0, r.bank || 0, r.delivery || 0, r.subtotal || 0, r.total || 0]);
    const t = salesSummary.totals || {};
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body, [], ['TOTAL', ...(day ? [''] : ['', '', '']), t.cash || 0, t.ewallet || 0, t.bank || 0, t.delivery || 0, t.subtotal || 0, t.total || 0]]), day ? 'Sales per day' : 'Sales per order');
    XLSX.writeFile(wb, `Sales-${day ? 'Daily' : 'Summary'}_${sssRange.start}_to_${sssRange.end}.xlsx`);
  };
  const exportSliSummaryPDF = async () => {
    if (!sliSummary) return ui.alert('Load the report first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(`${BIZ_NAME} - Sales by Order`, 14, 14);
    doc.setFontSize(9); doc.text(`${sliRange.start} to ${sliRange.end}`, 14, 20);
    const t = sliSummary.rows.reduce((a, r) => ({ g: a.g + (r.gross || 0), d: a.d + (r.discount || 0) }), { g: 0, d: 0 });
    const d8 = (v) => (v ? dateStr(v) : '');
    autoTable(doc, {
      startY: 24,
      head: [['Date', 'Cust. No.', 'Customer', 'Order', 'Billing Doc', 'DR No.', 'SI / OR No.', 'Payment', 'Gross Sales', 'Discount', 'Sales After Discount']],
      body: sliSummary.rows.map(r => [d8(r.postingDate), r.customerNumber || '', r.customerName || '', r.orderNumber || '', r.billingNumber || '', r.drNumbers || '', r.orNumber || '', r.paymentMethod || '', pdfMoney(r.gross), pdfMoney(r.discount), pdfMoney(r.amount)]),
      foot: [[`TOTAL (${sliSummary.count})`, '', '', '', '', '', '', '', pdfMoney(t.g), pdfMoney(t.d), pdfMoney(sliSummary.total)]],
      styles: { fontSize: 7 }, headStyles: { fillColor: [30, 30, 30] }, footStyles: { fillColor: [70, 70, 70], textColor: 255 },
    });
    doc.save(`Sales-Orders_${sliRange.start}_to_${sliRange.end}.pdf`);
  };
  const fmtD = (d) => (d ? dateStr(d) : '');
  const exportSliExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    if (sliView === 'summary') {
      if (!sliSummary) return ui.alert('Load the summary first.');
      const head = ['Posting Date', 'Document Date', 'Customer Number', 'Customer Name', 'Order', 'Billing Document No.', 'Delivery Receipt No.', 'Sales Invoice / OR No.', 'Payment', 'Gross Sales', 'Discount', 'Sales After Discount'];
      const body = sliSummary.rows.map(r => [fmtD(r.postingDate), fmtD(r.documentDate), r.customerNumber, r.customerName, r.orderNumber, r.billingNumber, r.drNumbers, r.orNumber, r.paymentMethod, r.gross, r.discount, r.amount]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body, [], ['TOTAL', '', '', '', '', '', '', '', '', '', '', sliSummary.total]]), 'Daily Sales Summary');
    } else {
      if (!salesLineItems) return ui.alert('Load the report first.');
      const head = ['Posting Date', 'Document Date', 'Item Code', 'Product Name', 'Customer Number', 'Customer Name', 'Billing Document No.', 'Delivery Receipt No.', 'Sales Invoice / OR No.', 'SRP', 'Unit Price', 'Price After Discount', 'Quantity', 'Gross Sales', 'Discount', 'Sales After Discount'];
      const body = salesLineItems.rows.filter(r => !r.isComponent).map(r => [fmtD(r.postingDate || r.date), fmtD(r.documentDate || r.date), r.itemCode, r.itemName, r.customerId, r.customerName, r.billingNumber || '', r.drNumbers || '', r.orNumber || '', r.srp ?? r.unitPrice ?? '', r.unitPrice ?? '', r.unitAfterDiscount ?? r.unitPrice ?? '', r.quantity, r.grossSales ?? r.lineTotal, r.discount ?? 0, r.netSales ?? r.lineTotal]);
      const t = salesLineItems.totals || {};
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body, [], ['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', t.gross ?? salesLineItems.grandTotal, t.discount ?? 0, t.net ?? salesLineItems.grandTotal]]), 'Daily Sales Detail');
    }
    XLSX.writeFile(wb, `Daily-Sales-${sliView === 'summary' ? 'Summary' : 'Detail'}_${sliRange.start}_to_${sliRange.end}.xlsx`);
  };
  // The voucher whose supporting documents are open.
  const [cvDocs, setCvDocs] = useState(null);

  const bdAddProduct = (p) => setBdCart(prev => {
    const key = String(p._id);
    const found = prev.find(x => x.productId === key);
    if (found) return prev.map(x => x.productId === key ? { ...x, quantity: x.quantity + 1 } : x);
    return [...prev, { productId: key, productCode: p.productCode || null, name: p.name, price: Number(p.basePrice || p.price || 0), quantity: 1 }];
  });
  const bdSetQty = (id, q) => setBdCart(prev => prev.flatMap(x => {
    if (x.productId !== id) return [x];
    const n = Math.max(0, q);
    return n === 0 ? [] : [{ ...x, quantity: n }];
  }));
  const bdSetPrice = (id, price) => setBdCart(prev => prev.map(x => x.productId === id ? { ...x, price: Math.max(0, Number(price) || 0) } : x));
  // A line's own discount (0-100%), kept as typed so the field can be cleared.
  const bdSetLineDisc = (id, v) => setBdCart(prev => prev.map(x => x.productId === id ? { ...x, discountPercent: v } : x));
  const bdRemove = (id) => setBdCart(prev => prev.filter(x => x.productId !== id));

  const r2 = roundMoney;
  const bdLinePct = (x) => Math.max(0, Math.min(100, Number(x.discountPercent) || 0));
  const bdGross = bdCart.reduce((s, x) => s + x.price * x.quantity, 0);
  const bdPct = bd.isComplimentary ? 0 : Math.max(0, Math.min(100, Number(bd.discountPercent) || 0));
  // Same order as the server: each line's own discount first, then the
  // order-wide percent on what is left.
  const bdLineDiscount = bd.isComplimentary ? 0 : r2(bdCart.reduce((s, x) => s + r2(x.price * x.quantity * bdLinePct(x) / 100), 0));
  const bdDiscount = r2(bdLineDiscount + (bdGross - bdLineDiscount) * bdPct / 100);
  const bdTotal = bd.isComplimentary ? 0 : r2(bdGross - bdDiscount);

  const submitBackdateCart = async () => {
    if (!bd.date) return ui.alert('Pick the sale date.');
    if (bdCart.length === 0) return ui.alert('Add at least one product to the sale.');
    if (!bd.isComplimentary && missingPaymentDetail(bd.paymentMethod, bd)) return ui.alert(missingPaymentDetail(bd.paymentMethod, bd));
    if (!bd.isComplimentary && bd.paymentMethod === 'Split' && !splitReady(bdTotal, bd.payments || [])) return ui.alert('The split payments must add up to the sale total, with at least two parts.');
    const label = bd.isComplimentary ? 'complimentary (₱0)' : `₱${bdTotal.toFixed(2)}`;
    const stockNote = bd.affectInventory ? '\n\nThis WILL reduce current inventory.' : '';
    if (!(await ui.confirm(`Record a backdated sale of ${label} on ${bd.date}?${stockNote}`))) return;
    setBdBusy(true);
    try {
      const r = await apiFetch('/api/admin/backdate-sale', { method: 'POST', body: JSON.stringify({
        date: bd.date, customerName: bd.customerName, paymentMethod: bd.paymentMethod, notes: bd.notes,
        ...(bd.isComplimentary ? {} : paymentDetailsPayload(bd.paymentMethod, bd)),
        ...(bd.paymentMethod === 'Split' && !bd.isComplimentary ? { payments: splitPayload(bd.payments) } : {}),
        discountPercent: bdPct, affectInventory: bd.affectInventory, isComplimentary: bd.isComplimentary,
        items: bdCart.map(x => ({ name: x.name, price: x.price, quantity: x.quantity, discountPercent: bdLinePct(x), productId: x.productId, productCode: x.productCode })),
      }) });
      const d = await r.json();
      if (d.success) {
        ui.alert(`Backdated sale recorded: ${d.order.orderNumber}\nJournal ref: ${d.journalReference}`);
        setBdCart([]);
        notePaymentMethodUsed(bd.paymentMethod);
        setBd(b => ({ ...b, customerName: '', notes: '', discountPercent: 0, isComplimentary: false, checkNumber: '', checkBank: '', checkDate: '', reference: '' }));
        fetchERPData();
        fetchBdHistory(1);
      } else ui.alert(d.error || 'Failed to record backdated sale.');
    } catch { ui.alert('Network error.'); }
    finally { setBdBusy(false); }
  };

  // ── Backdate Sale - bulk Excel import ────────────────────────────────────────
  // Parses a billing-statement-style spreadsheet (one row per line item, sharing
  // a transaction no./client/date across the rows of one sale - same shape as
  // the printed "BILLING STATEMENT" doc these are usually exported from) and
  // groups it into one backdated sale per transaction. Confirming loops through
  // the SAME /api/admin/backdate-sale endpoint the manual cart above uses, one
  // call per transaction, so every posting rule (period lock, journal entry,
  // etc.) is identical to entering them by hand - just faster for a batch.
  const [bdImportPreview, setBdImportPreview] = useState(null); // { groups: [...], skipped }
  const [bdImporting, setBdImporting] = useState(false);
  const [bdImportSettings, setBdImportSettings] = useState({ paymentMethod: 'Cash', affectInventory: false, replaceExisting: false });
  // Workbooks with more than one tab pause here so the user can pick which
  // sheet(s) to pull sales from, instead of silently only reading the first.
  const [bdSheetPicker, setBdSheetPicker] = useState(null); // { wb, sheetNames, selected: Set<string> }
  const [bdParseProgress, setBdParseProgress] = useState(null); // { done, total } while reading selected sheets

  const bdNumify = (v) => { const n = parseFloat(String(v ?? '').replace(/[₱,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
  const bdNorm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Excel dates arrive as a JS Date (when the sheet used real date cells), a
  // serial day-number (Excel's own epoch, 1899-12-30), or plain text.
  const bdParseDate = (v) => {
    if (!v) return '';
    if (v instanceof Date) {
      // cellDates:true builds this from a LOCAL wall-clock construction (verified
      // empirically against this xlsx version), so .toISOString() (UTC getters)
      // silently rolls the date back a day for any timezone ahead of UTC. Local
      // getters undo exactly what was baked in, correctly, for any timezone.
      if (isNaN(v.getTime())) return '';
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
    let s = String(v).trim();
    // Every date column in these sheets is MM/DD/YYYY (not DD/MM) - convert
    // explicitly instead of handing "M/D/YYYY" text to `new Date(...)`, which
    // reads it correctly in most engines but isn't guaranteed to everywhere
    // this string gets re-parsed (same class of bug fixed in the inventory
    // importer: a 2-digit year read as 19xx, or month/day silently flipped).
    const m2 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
    if (m2) { const yy = parseInt(m2[3], 10); s = `${m2[1]}/${m2[2]}/${yy < 50 ? 2000 + yy : 1900 + yy}`; }
    const m3 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m3) {
      const mo = parseInt(m3[1], 10), da = parseInt(m3[2], 10), yr = parseInt(m3[3], 10);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) s = `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    }
    const d = new Date(s);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  };

  const downloadBackdateTemplate = async () => {
    const XLSX = await import('xlsx');
    const headers = ['TRANSACTION NO.', 'PAYABLE TO', 'SUBMITTED DATE', 'CODE', 'DESCRIPTION', 'QTY', 'UNIT PRICE'];
    const sample = [
      ['2026-08-1936', "DAR'S KITCHEN", '2026-08-25', 'P30008', 'HORCHATA POWDER 1KG', 2, 800],
      ['', '', '', 'P30020', 'BLACK SESAME POWDER 1KG', 1, 800],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(14, Math.min(28, h.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Backdated Sales');
    XLSX.writeFile(wb, 'backdate_sale_import_template.xlsx');
  };

  // Finds a "LABEL ... VALUE" pair anywhere in the sheet's top rows - the shape
  // used by the real BILLING STATEMENT template (one transaction per sheet,
  // with "INVOICE FOR" / "PAYABLE TO" / "TRANSACTION NO." / "Submitted date"
  // written as labels ABOVE the item table, not as table columns). The value
  // sits either later in the same row (e.g. "Submitted date", "", "", 46259)
  // or directly below the label in the same column (e.g. "TRANSACTION NO."
  // on one row, the actual number on the next).
  const BD_ALL_LABEL_WORDS = ['transactionno', 'transno', 'invoiceno', 'payableto', 'invoicefor', 'submitteddate', 'termsofpayment', 'description', 'itemcode', 'unitprice', 'totalprice'];
  const bdFindLabelValue = (grid, aliases) => {
    for (let r = 0; r < Math.min(grid.length, 60); r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = bdNorm(row[c]);
        if (!cell || !aliases.some(a => cell.includes(a))) continue;
        // Prefer directly below the label (the layout most of these fields
        // use) before scanning right, so a blank field (e.g. an unused
        // "PAYABLE TO") doesn't grab the NEXT label sitting further along the
        // same row as if it were its value.
        const below = (grid[r + 1] || [])[c];
        if (below !== '' && below != null) return below;
        for (let c2 = c + 1; c2 < row.length; c2++) {
          const v = row[c2];
          if (v === '' || v == null) continue;
          if (BD_ALL_LABEL_WORDS.some(w => bdNorm(v).includes(w))) break; // hit another label, not a value
          return v;
        }
      }
    }
    return '';
  };

  // Same-row-only lookup, for fields whose label and value sit side by side
  // (e.g. "DELIVERY FEE | ₱0.00") on a template that also has a large MERGED
  // Grand Total cell sitting just below that row. bdFindLabelValue's
  // check-below-first behavior would grab that merged total instead of the
  // real (often zero) value beside the label, doubling the imported total -
  // so fields like this must never look below, only rightward on their own row.
  const bdFindLabelValueSameRow = (grid, aliases) => {
    for (let r = 0; r < Math.min(grid.length, 80); r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = bdNorm(row[c]);
        if (!cell || !aliases.some(a => cell.includes(a))) continue;
        for (let c2 = c + 1; c2 < row.length; c2++) {
          const v = row[c2];
          if (v === '' || v == null) continue;
          return v;
        }
      }
    }
    return '';
  };

  // The grand total: the first amount BELOW the "DELIVERY FEE" row (the big
  // merged cell the billing statement puts there), in any column. That is the
  // figure the customer was billed - after the discount and with the delivery
  // fee - so it is taken as the sale's total rather than rebuilt from the
  // item lines, which missed the sheet's DISCOUNT line. Null when the sheet
  // has no such row.
  const bdFindGrandTotal = (grid) => {
    for (let r = 0; r < Math.min(grid.length, 120); r++) {
      const row = grid[r] || [];
      if (!row.some(c => ['deliveryfee', 'freight', 'shippingfee', 'deliverycharge'].some(a => bdNorm(c).includes(a)))) continue;
      for (let r2 = r + 1; r2 < Math.min(grid.length, r + 6); r2++) {
        // Only a cell that IS an amount ("₱21,698.18", 21698.18) - the same
        // rows carry the Terms text ("within 24-48 hours"), whose digits
        // must never be read as a total. Rightmost first: the total sits on
        // the right, the terms on the left.
        const row2 = grid[r2] || [];
        for (let c2 = row2.length - 1; c2 >= 0; c2--) {
          const v = row2[c2];
          if (v === '' || v == null) continue;
          const isAmount = typeof v === 'number' || /^\s*(PHP|Php|₱|P)?\s*-?[\d,]+(\.\d+)?\s*$/.test(String(v));
          if (!isAmount) continue;
          const n = bdNumify(typeof v === 'number' ? v : String(v).replace(/^\s*(PHP|Php|P)\s*/, ''));
          if (n > 0) return n;
        }
      }
      return null;
    }
    return null;
  };

  // Parses ONE sheet's grid (array-of-arrays) into { groups, skipped }. Used
  // for both the single-sheet fast path and each sheet picked in the
  // multi-sheet picker below.
  const parseBackdateGrid = (grid, sheetName) => {
    let hIdx = -1;
    for (let i = 0; i < Math.min(grid.length, 40); i++) {
      const cells = (grid[i] || []).map(bdNorm);
      if (cells.some(c => c.includes('description') || c === 'item') && cells.some(c => c === 'qty' || c.includes('quantity'))) { hIdx = i; break; }
    }
    if (hIdx === -1) return { groups: [], skipped: 0, noHeader: true };

    const header = (grid[hIdx] || []).map(bdNorm);
    const col = (aliases) => header.findIndex(c => aliases.some(a => c.includes(a)));
    const idx = {
      transNo: col(['transactionno', 'transno', 'invoiceno', 'transactionnumber']),
      client:  col(['payableto', 'client', 'customer', 'invoicefor']),
      date:    col(['submitteddate', 'date']),
      code:    col(['code', 'itemcode']),
      desc:    col(['description']),
      qty:     header.findIndex(c => c === 'qty' || c.includes('quantity')),
      price:   col(['unitprice', 'price']),
    };
    if (idx.desc < 0) idx.desc = header.findIndex(c => c === 'item' || c === 'product');

    // The real template writes transaction no. / client / date as labels
    // ABOVE the item table (once per sheet) rather than as table columns, so
    // look for them there first - "PAYABLE TO" is usually left blank in
    // practice, with the actual client name under "INVOICE FOR" instead.
    const sheetTrans = idx.transNo < 0 ? String(bdFindLabelValue(grid, ['transactionno', 'transno', 'invoiceno']) ?? '').trim() : '';
    const sheetClient = idx.client < 0
      ? (String(bdFindLabelValue(grid, ['payableto']) ?? '').trim() || String(bdFindLabelValue(grid, ['invoicefor']) ?? '').trim())
      : '';
    const sheetDate = idx.date < 0 ? bdFindLabelValue(grid, ['submitteddate', 'date']) : '';
    // If the sheet leaves "Terms of Payment" blank, we don't know how this
    // sale was actually paid - don't silently default it to Cash. Flag the
    // sheet's group(s) so finishBackdateImport routes them to the review
    // queue instead of the ready-to-import preview.
    const needsPaymentMethod = !String(bdFindLabelValue(grid, ['termsofpayment']) ?? '').trim();
    // Some billing statements carry a delivery/freight fee as its own labeled
    // value alongside Transaction No./Submitted Date, on top of the item
    // lines. Summing item lines alone and calling that "the total" undercounts
    // by exactly this amount for those sheets - it needs to ride along and
    // add onto the total the same way the live POS delivery fee now does
    // (see POST /api/orders and createBackdatedSale server-side).
    const sheetDeliveryFee = bdNumify(bdFindLabelValueSameRow(grid, ['deliveryfee', 'freight', 'shippingfee', 'deliverycharge']));
    const sheetGrandTotal = bdFindGrandTotal(grid);

    // Transaction/client/date usually only repeat on the FIRST row of a sale
    // (exactly how a flat-columns import lays them out) - carry the
    // last-seen value forward onto the item-only rows that follow. Sheet-level
    // label values (above) seed the default so the label/value template works
    // even though nothing repeats per-row there.
    // A sale annotated CANCELLED never happened. Importing it books revenue
    // for nothing, and because it arrives backdated it is easy to miss later.
    // A stamp in the header block voids the whole sheet; a note beside one
    // line voids only that line (see shared/backdateCancelled).
    if (isCancelledSheet(grid, hIdx)) {
      return { groups: [], skipped: 0, cancelled: 0, cancelledSheet: true, noHeader: false };
    }

    const byTrans = new Map();
    let skipped = 0;
    let cancelled = 0;
    let curTrans = sheetTrans, curClient = sheetClient, curDate = sheetDate;
    for (let i = hIdx + 1; i < grid.length; i++) {
      const row = grid[i] || [];
      // Counted separately from `skipped`: a malformed row is a data problem,
      // a cancelled row is the sheet working as intended. Lumping them
      // together hides whether the import did the right thing.
      if (isCancelledRow(row)) { cancelled++; continue; }
      const desc = idx.desc >= 0 ? String(row[idx.desc] ?? '').trim() : '';
      const qty = idx.qty >= 0 ? bdNumify(row[idx.qty]) : 0;
      const rowTrans = idx.transNo >= 0 ? String(row[idx.transNo] ?? '').trim() : '';
      const rowClient = idx.client >= 0 ? String(row[idx.client] ?? '').trim() : '';
      const rowDate = idx.date >= 0 ? row[idx.date] : '';
      if (rowTrans) curTrans = rowTrans;
      if (rowClient) curClient = rowClient;
      if (rowDate) curDate = rowDate;
      if (!desc || qty <= 0) { if (desc || qty) skipped++; continue; }

      const key = curTrans || (curClient && curDate ? `${curClient}|${curDate}` : `row-${sheetName}-${i}`);
      if (!byTrans.has(key)) byTrans.set(key, { transNo: curTrans, client: curClient, date: bdParseDate(curDate), sheet: sheetName, items: [] });
      byTrans.get(key).items.push({
        code: idx.code >= 0 ? String(row[idx.code] ?? '').trim() : '',
        name: desc, quantity: qty,
        price: idx.price >= 0 ? bdNumify(row[idx.price]) : 0,
      });
    }

    const groups = [...byTrans.values()].filter(g => g.items.length).map(g => {
      const items = g.items.map(it => {
        const match = (products || []).find(p => (it.code && p.productCode === it.code) || p.name.toLowerCase() === it.name.toLowerCase());
        return { ...it, productId: match?._id || null, productCode: match?.productCode || it.code || null, matched: !!match };
      });
      const itemsTotal = roundMoney(items.reduce((s, x) => s + x.price * x.quantity, 0));
      const built = roundMoney(itemsTotal + sheetDeliveryFee);
      // One sale per sheet carries the sheet's grand total; the gap between
      // it and the item lines is the sheet's discount, sent as pesos.
      const oneSale = byTrans.size === 1;
      const discountAmount = oneSale && sheetGrandTotal != null ? roundMoney(Math.max(0, built - sheetGrandTotal)) : 0;
      return { ...g, items, deliveryFee: sheetDeliveryFee, discountAmount, total: roundMoney(built - discountAmount), sheetTotal: oneSale ? sheetGrandTotal : null, needsPaymentMethod };
    });
    // A group whose transaction no. or client carries the mark - someone wrote
    // "INV-1042 CANCELLED" rather than annotating each line.
    const { kept, cancelled: cancelledGroups } = partitionCancelledGroups(groups);
    return { groups: kept, skipped, cancelled: cancelled + cancelledGroups.length, noHeader: false };
  };

  // Runs the parser across every selected sheet and merges the results into
  // one preview. Sheets are kept independent (no cross-sheet grouping) so a
  // repeated transaction no. across two tabs never silently merges. Any group
  // whose sheet left "Terms of Payment" blank is routed to the review queue
  // instead of the ready-to-import preview - we don't know how it was paid.
  const finishBackdateImport = async (wb, sheetNames) => {
    let allGroups = [], totalSkipped = 0, anyHeaderFound = false;
    let totalCancelled = 0, cancelledSheets = 0;
    setBdParseProgress({ done: 0, total: sheetNames.length });
    let i = 0;
    for (const name of sheetNames) {
      const sheet = wb.Sheets[name];
      if (sheet) {
        const grid = XLSX_sheetToGrid(wb, name);
        const { groups, skipped, noHeader, cancelled, cancelledSheet } = parseBackdateGrid(grid, name);
        if (!noHeader) anyHeaderFound = true;
        allGroups = allGroups.concat(groups);
        totalSkipped += skipped;
        totalCancelled += cancelled || 0;
        if (cancelledSheet) { cancelledSheets++; anyHeaderFound = true; }
      }
      i++;
      // Yield every few sheets so the progress bar actually paints instead of
      // the whole parse running as one blocking synchronous loop.
      if (i % 5 === 0 || i === sheetNames.length) {
        setBdParseProgress({ done: i, total: sheetNames.length });
        await new Promise(r => setTimeout(r, 0));
      }
    }
    setBdParseProgress(null);
    if (!anyHeaderFound) { ui.alert('Could not find the header row (needs at least a Description and Qty column) in the selected sheet(s).'); return; }
    if (allGroups.length === 0) {
      // Distinguish "nothing importable" from "everything was cancelled" -
      // the second is the importer working correctly, and saying "no sale rows
      // found" would send someone hunting for a parsing bug that isn't there.
      ui.alert(totalCancelled > 0 || cancelledSheets > 0
        ? `Nothing to import - every sale in the selected sheet(s) is marked cancelled (${cancelledSheets} sheet(s), ${totalCancelled} row(s)).`
        : 'No sale rows found under the header in the selected sheet(s).');
      return;
    }
    if (totalCancelled > 0 || cancelledSheets > 0) {
      ui.alert(`Excluded ${totalCancelled} cancelled row(s)${cancelledSheets ? ` and ${cancelledSheets} fully cancelled sheet(s)` : ''} - these are not imported as sales.`);
    }

    const readyGroups = allGroups.filter(g => !g.needsPaymentMethod);
    const queueGroups = allGroups.filter(g => g.needsPaymentMethod);

    let queuedCount = 0, queuedDupes = 0;
    if (queueGroups.length > 0) {
      try {
        const r = await apiFetch('/api/admin/backdate-sale/queue', {
          method: 'POST',
          body: JSON.stringify({ items: queueGroups.map(g => ({
            transNo: g.transNo, client: g.client, date: g.date, sheet: g.sheet,
            items: g.items.map(it => ({ name: it.name, price: it.price, quantity: it.quantity, code: it.code, productId: it.productId, productCode: it.productCode })),
            deliveryFee: g.deliveryFee || 0, discountAmount: g.discountAmount || 0,
            missingFields: ['paymentMethod'],
          })) }),
        });
        const d = await r.json();
        if (d.success) { queuedCount = d.queued; queuedDupes = d.skippedDuplicates || 0; fetchBdQueue(1); }
      } catch { /* queueing is best-effort - the rest of the import still proceeds */ }
    }

    if (readyGroups.length === 0) {
      ui.alert(queuedCount > 0
        ? `No "Terms of Payment" found on ${queuedCount} sale(s) - sent to the Backdate Queue for review instead of importing blind.${queuedDupes ? `\n\n${queuedDupes} row(s) skipped - already imported/queued (same reference).` : ''}`
        : (queuedDupes ? `All ${queuedDupes} row(s) were already imported or queued (same reference) - nothing new to add.`
          : 'No sale rows found under the header in the selected sheet(s).'));
      return;
    }
    setBdImportPreview({ groups: readyGroups, skipped: totalSkipped, multiSheet: sheetNames.length > 1, queuedCount, queuedDupes });
  };

  const XLSX_sheetToGrid = (wb, name) => {
    if (!xlsxRef.current) throw new Error('XLSX not loaded');
    return xlsxRef.current.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  };

  // The Orders export (Order No | Date | Customer | Status | Payment | Subtotal |
  // Discount | Total, and "Order Lines" beside it when the export is a recent
  // one) brought back through /api/orders/import: each completed order returns
  // as a sale on its own date with its own number. Returns false when the file
  // is not one, so the caller carries on reading it as billing statements.
  const importOrdersExport = async (XLSX, wb) => {
    const need = ['Order No', 'Date', 'Customer', 'Total'];
    const sheet = (wb.SheetNames || []).find((n) => {
      const head = (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })[0] || []).map(h => String(h ?? '').trim());
      return need.every(h => head.includes(h));
    });
    if (!sheet) return false;
    const php = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).filter(r => String(r['Order No'] || '').trim());
    if (!rows.length) { ui.alert('That Orders export has no orders in it.'); return true; }
    const lines = wb.Sheets['Order Lines'] ? XLSX.utils.sheet_to_json(wb.Sheets['Order Lines'], { defval: '' }) : [];
    const total = rows.reduce((sum, r) => sum + (Number(r.Total) || 0), 0);
    const ok = await ui.confirm({
      title: `Import ${rows.length} order(s) - ${php(total)}?`,
      message: 'This is an Orders export. Each completed order comes back as a sale on its own date, with its own order number, and is posted to the books. Orders already in the app are skipped. '
        + (lines.length
          ? 'It carries its product lines, so the products come back too.'
          : 'It has no product lines, so each order comes back with one summary line - totals and receivables will be right, but product reports will not include them and stock is not touched.'),
      confirmLabel: 'Import orders',
    });
    if (!ok) return true;
    setBulkOpInProgress?.(true);
    try {
      let created = 0, sum = 0, costed = 0, costSum = 0; const skipped = [], problems = [];
      // In batches, so a long export is never one enormous request.
      for (let i = 0; i < rows.length; i += 200) {
        const part = rows.slice(i, i + 200);
        const nums = new Set(part.map(r => String(r['Order No']).trim()));
        const d = await (await apiFetch('/api/orders/import', {
          method: 'POST', body: JSON.stringify({ rows: part, lines: lines.filter(l => nums.has(String(l['Order No'] || '').trim())) }),
        })).json();
        if (!d.success) { ui.alert(d.error || 'The import failed - nothing more was imported.'); break; }
        created += d.created || 0; sum += d.total || 0; costed += d.costed || 0; costSum += d.costTotal || 0;
        skipped.push(...(d.skipped || []).map(x => x.error)); problems.push(...(d.problems || []));
      }
      const already = skipped.filter(e => /already in the app/i.test(e)).length;
      const other = skipped.filter(e => !/already in the app/i.test(e));
      ui.alert(
        `${created} order(s) imported - ${php(sum)}.`
        + (costed ? `
Cost of goods sold booked for ${costed} order(s) - ${php(costSum)}.` : '')
        + (already ? `\n${already} were already in the app and were skipped.` : '')
        + (other.length ? `\n\nNot imported (${other.length}):\n- ${other.slice(0, 12).join('\n- ')}${other.length > 12 ? `\n...and ${other.length - 12} more` : ''}` : '')
        + (problems.length ? `\n\nCheck these:\n- ${problems.slice(0, 8).join('\n- ')}` : ''),
      );
      fetchERPData?.();
      fetchBdHistory(1);
    } catch { ui.alert('Network error - check which orders came in before trying again (those already in are skipped).'); }
    finally { setBulkOpInProgress?.(false); }
    return true;
  };

  const parseBackdateExcel = async (file) => {
    if (!file) return;
    // Defensive reset - a leftover preview/queue-resolve modal from a prior
    // run must never still be mounted while a fresh file is being read (it
    // would fight the new sheet-picker for the same overlay slot and could
    // flash the OLD popup back up mid-read).
    setBdImportPreview(null);
    setBdQueueResolve(null);
    setBdParseProgress(null);
    setBdImporting(true);
    try {
      const XLSX = await import('xlsx');
      xlsxRef.current = XLSX;
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheetNames = wb.SheetNames || [];
      // An Orders export, not a billing statement: it has its own importer, and
      // this is the button people reach for with it - so take it here too.
      if (await importOrdersExport(XLSX, wb)) { setBdImporting(false); return; }
      // Always pause here first - even a single-sheet file - so Payment Method
      // and Reduce Inventory are chosen BEFORE the sale preview is built, same
      // as the manual entry form asks for them up front.
      // Real workbooks like this carry template/reference/archive tabs
      // alongside the actual per-transaction sheets - pre-uncheck the obvious
      // non-sales ones so the user isn't pruning a hundred boxes by hand; they
      // can still tick any of them back on.
      const looksNonSale = (name) => /\b(template|cheat\s*code|archive|copy of)\b/i.test(name);
      const preselected = sheetNames.filter(n => !looksNonSale(n));
      setBdImporting(false);
      setBdSheetPicker({ wb, sheetNames, selected: new Set(preselected) });
    } catch {
      setBdImporting(false);
      ui.alert('Could not read the file. Make sure it is a valid .xlsx / .csv.');
    }
  };

  const confirmBdSheetPicker = async () => {
    if (!bdSheetPicker) return;
    const chosen = bdSheetPicker.sheetNames.filter(n => bdSheetPicker.selected.has(n));
    if (chosen.length === 0) { ui.alert('Pick at least one sheet.'); return; }
    setBdImporting(true);
    try { await finishBackdateImport(bdSheetPicker.wb, chosen); }
    finally { setBdImporting(false); setBdSheetPicker(null); }
  };

  const [bdImportProgress, setBdImportProgress] = useState(null); // { done, total }

  const confirmBdImport = async () => {
    if (!bdImportPreview) return;
    // A split whose parts do not add up to the sale would be refused one by one
    // mid-import - say which, before anything is posted.
    const badSplits = bdImportPreview.groups.filter(g => g.paymentMethod === 'Split' && !splitReady(g.total, g.payments || []));
    const noCheckNo = bdImportPreview.groups.filter(g => (g.paymentMethod || bdImportSettings.paymentMethod) === 'Check' && !(g.checkNumber || '').trim());
    if (noCheckNo.length) return ui.alert(`Enter the check number for: ${noCheckNo.slice(0, 10).map(g => g.client || g.transNo || 'a sale').join(', ')}${noCheckNo.length > 10 ? ` and ${noCheckNo.length - 10} more` : ''}.`);
    if (badSplits.length) return ui.alert(`Fix the split payment on: ${badSplits.map(g => g.client || g.transNo || 'a sale').join(', ')} - the parts must add up to the sale total, with at least two parts, and each check needs its number.`);
    if (bdImportSettings.replaceExisting && !(await ui.confirm({
      title: 'Replace sales already imported?',
      message: 'Any sale here whose transaction no. was imported before will be reversed - its journal entries and any stock it took - and recorded again from this sheet. The old one stays in history as Voided.',
      confirmLabel: 'Import and replace',
    }))) return;
    setBdImporting(true);
    const total = bdImportPreview.groups.length;
    setBdImportProgress({ done: 0, total });
    // Each successful row broadcasts a socket event the dashboard reacts to
    // with a full data refetch - fine for one sale, but a storm of them (plus
    // this loop's own POSTs) is what was tripping the API rate limiter on a
    // 180-row import. Pause that auto-refresh for the run; one manual
    // fetchERPData() below covers it once the whole import is done.
    setBulkOpInProgress?.(true);
    let ok = 0, fail = 0, dupes = 0;
    const errors = [];
    try {
      for (const g of bdImportPreview.groups) {
        const label = g.client || g.transNo || 'row';
        if (!g.date) { fail++; errors.push(`${label}: missing/unreadable date`); setBdImportProgress(p => ({ ...p, done: p.done + 1 })); continue; }
        try {
          // A bulk run posts one sale per request, in sequence, but a few
          // hundred rows can still trip the API rate limiter (each success also
          // fans out a socket-triggered dashboard refresh). Back off and retry
          // on 429 instead of counting a throttled row as a hard failure.
          let res, attempt = 0;
          for (;;) {
            res = await apiFetch('/api/admin/backdate-sale', {
              method: 'POST',
              body: JSON.stringify({
                date: g.date, customerName: g.client, paymentMethod: g.paymentMethod || bdImportSettings.paymentMethod,
                ...(g.paymentMethod === 'Split' ? { payments: splitPayload(g.payments) } : {}),
                ...paymentDetailsPayload(g.paymentMethod || bdImportSettings.paymentMethod, g),
                ...(bdImportSettings.replaceExisting ? { replaceExisting: true } : {}),
                notes: g.transNo ? `Imported - ${g.transNo}` : 'Imported from Excel',
                // The sheet's own transaction/invoice number - lets the server skip
                // this row as a duplicate if it (or an overlapping file) was already
                // imported under the same reference, instead of posting it twice.
                importRef: g.transNo || undefined,
                affectInventory: bdImportSettings.affectInventory, isComplimentary: false, discountPercent: 0,
                deliveryFee: g.deliveryFee || undefined,
                discountAmount: g.discountAmount || undefined,
                items: g.items.map(it => ({ name: it.name, price: it.price, quantity: it.quantity, productId: it.productId, productCode: it.productCode })),
              }),
            });
            if (res.status !== 429 || attempt >= 4) break;
            attempt++;
            await new Promise(r => setTimeout(r, 1500 * attempt));
          }
          const d = await res.json();
          if (d.success) ok++;
          else if (res.status === 409) { dupes++; errors.push(`${label}: ${d.error}`); }
          else { fail++; errors.push(`${label}: ${d.error}`); }
        } catch { fail++; errors.push(`${label}: network error`); }
        setBdImportProgress(p => ({ ...p, done: p.done + 1 }));
        // Small pace between rows so a fast/local server doesn't out-race the
        // rate limiter even before any 429 shows up.
        await new Promise(r => setTimeout(r, 120));
      }
    } finally {
      setBulkOpInProgress?.(false);
    }
    setBdImporting(false);
    setBdImportProgress(null);
    setBdImportPreview(null);
    fetchERPData();
    fetchBdHistory();
    const totalDupes = dupes + (bdImportPreview.queuedDupes || 0);
    ui.alert(`Imported ${ok} sale(s).${totalDupes ? `\n\n${totalDupes} skipped - already imported/queued (same reference).` : ''}${fail ? `\n\n${fail} failed:\n${errors.slice(0, 10).join('\n')}` : ''}`);
  };

  // ── Backdate Sale - history (both manual entries and bulk imports) ──────────
  const [bdHistory, setBdHistory] = useState(null); // { orders, total, page, pages }
  const [bdHistoryLoading, setBdHistoryLoading] = useState(false);
  const [bdHistoryPage, setBdHistoryPage] = useState(1);
  const fetchBdHistory = async (page = bdHistoryPage) => {
    setBdHistoryLoading(true);
    try {
      const r = await apiFetch(`/api/admin/backdate-sale/history?page=${page}&limit=20`);
      const d = await r.json();
      if (d.success) { setBdHistory(d); setBdHistoryPage(d.page); }
    } catch { /* silent - history is supplementary, not blocking */ }
    finally { setBdHistoryLoading(false); }
  };

  const [bdExporting, setBdExporting] = useState(false);
  const exportBackdateHistoryPDF = async () => {
    if (!bdHistory || bdHistory.total === 0) return ui.alert('No backdated sales to export.');
    setBdExporting(true);
    try {
      // The on-screen list is paginated 20 at a time - pull every record in
      // one shot for the export instead of only exporting whatever page is showing.
      const r = await apiFetch(`/api/admin/backdate-sale/history?page=1&limit=${bdHistory.total}`);
      const d = await r.json();
      if (!d.success) return ui.alert(d.error || 'Failed to load backdated sales for export.');
      const { jsPDF, autoTable } = await loadPdfLibs();
      const doc = new jsPDF();
      await addLogoToPDF(doc);
      doc.setFontSize(14); doc.text('Backdate Sale History', 14, 16);
      doc.setFontSize(9); doc.text(`${d.orders.length} sale(s) · ${new Date().toLocaleDateString()}`, 14, 22);
      autoTable(doc, {
        startY: 28,
        head: [['Date', 'Order No.', 'Customer', 'Payment', 'Notes', 'Total']],
        body: d.orders.map(o => [
          new Date(o.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
          o.orderNumber, o.customerName || 'Walk-in', o.paymentMethod, o.orderNotes || '-', pdfMoney(o.total),
        ]),
        foot: [[{ content: 'Total', colSpan: 5 }, pdfMoney(d.orders.reduce((s, o) => s + (o.total || 0), 0))]],
        styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 5: { halign: 'right' } },
      });
      doc.save(`Backdate-Sale-History-${todayStr()}.pdf`);
    } catch { ui.alert('Failed to export backdated sales.'); }
    finally { setBdExporting(false); }
  };

  // ── Backdate Sale - review queue (rows a bulk import couldn't post blind,
  // e.g. no Terms of Payment on the sheet) ────────────────────────────────────
  const [bdQueue, setBdQueue] = useState(null); // { rows, total, page, pages }
  const [bdQueueLoading, setBdQueueLoading] = useState(false);
  const [bdQueuePage, setBdQueuePage] = useState(1);
  const fetchBdQueue = async (page = bdQueuePage) => {
    setBdQueueLoading(true);
    try {
      const r = await apiFetch(`/api/admin/backdate-sale/queue?page=${page}&limit=20`);
      const d = await r.json();
      if (d.success) { setBdQueue(d); setBdQueuePage(d.page); }
    } catch { /* silent - queue count is supplementary, not blocking */ }
    finally { setBdQueueLoading(false); }
  };

  const [bdQueueResolve, setBdQueueResolve] = useState(null); // { row, paymentMethod, affectInventory }
  const [bdQueueSaving, setBdQueueSaving] = useState(false);
  const saveBdQueueItem = async () => {
    if (!bdQueueResolve) return;
    if (!bdQueueResolve.paymentMethod) { ui.alert('Pick a payment method.'); return; }
    if (missingPaymentDetail(bdQueueResolve.paymentMethod, bdQueueResolve)) { ui.alert(missingPaymentDetail(bdQueueResolve.paymentMethod, bdQueueResolve)); return; }
    setBdQueueSaving(true);
    try {
      const row = bdQueueResolve.row;
      const r = await apiFetch(`/api/admin/backdate-sale/queue/${row._id}/save`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod: bdQueueResolve.paymentMethod, affectInventory: !!bdQueueResolve.affectInventory,
          ...paymentDetailsPayload(bdQueueResolve.paymentMethod, bdQueueResolve),
        }),
      });
      const d = await r.json();
      if (d.success) {
        ui.alert(`Backdated sale recorded: ${d.order.orderNumber}\nJournal ref: ${d.journalReference}`);
        setBdQueueResolve(null);
        fetchBdQueue(1);
        fetchBdHistory(1);
        fetchERPData();
      } else ui.alert(d.error || 'Failed to record this backdated sale.');
    } catch { ui.alert('Network error.'); }
    finally { setBdQueueSaving(false); }
  };
  const discardBdQueueItem = async (row) => {
    if (!(await ui.holdForUndo(`Discarding the queued sale for "${row.client || 'this row'}"…`))) return;
    try {
      await apiFetch(`/api/admin/backdate-sale/queue/${row._id}`, { method: 'DELETE' });
      fetchBdQueue(1);
    } catch { ui.alert('Network error.'); }
  };

  const [backfillBusy, setBackfillBusy] = useState(false);
  const runBackfillLedger = async () => {
    if (!(await ui.confirm('Scan every backdated sale and post a journal entry for any that are missing one?'))) return;
    setBackfillBusy(true);
    try {
      const r = await apiFetch('/api/admin/backdate-sale/backfill-ledger', { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json();
      if (d.success) {
        ui.alert(`Scanned ${d.scanned}. Already linked: ${d.alreadyLinked}. Posted: ${d.created.length}.${d.failed.length ? ` Failed: ${d.failed.length} (see console).` : ''}`);
        if (d.failed.length) console.error('backfill-ledger failures', d.failed);
        if (d.created.length) fetchERPData();
      } else ui.alert(d.error || 'Backfill failed.');
    } catch { ui.alert('Network error.'); }
    finally { setBackfillBusy(false); }
  };
  const [tb, setTb] = useState(null);
  const [tbLoading, setTbLoading] = useState(false);
  const loadTrial = async () => {
    setTbLoading(true);
    try { const r = await apiFetch('/api/reports/trial-balance'); const d = await r.json(); setTb(d.success ? d : { error: d.error || 'Failed to load' }); }
    catch { setTb({ error: 'Network error' }); }
    finally { setTbLoading(false); }
  };
  const [ptax, setPtax] = useState(null);
  const [ptaxRange, setPtaxRange] = useState(() => ({ start: monthStartStr(), end: todayStr() }));
  const [ptaxLoading, setPtaxLoading] = useState(false);
  const loadPtax = async () => {
    setPtaxLoading(true);
    try {
      const q = ptaxRange.start && ptaxRange.end ? `?start=${ptaxRange.start}&end=${ptaxRange.end}` : '';
      const r = await apiFetch(`/api/reports/percentage-tax${q}`); const d = await r.json();
      setPtax(d.success ? d : { error: d.error || 'Provide a start and end date.' });
    } catch { setPtax({ error: 'Network error' }); }
    finally { setPtaxLoading(false); }
  };
  // Books health: subledgers vs their control accounts.
  const [bookshealth, setBooksHealth] = useState(null);
  const [bookshealthLoading, setBooksHealthLoading] = useState(false);
  const loadBooksHealth = async () => {
    setBooksHealthLoading(true);
    try {
      const r = await apiFetch('/api/reports/books-health'); const d = await r.json();
      setBooksHealth(d.success ? d : { error: d.error || 'Could not run the checks.' });
    } catch { setBooksHealth({ error: 'Network error' }); }
    finally { setBooksHealthLoading(false); }
  };

  // VAT return: output VAT collected, input VAT creditable, net owed.
  const [vatRet, setVatRet] = useState(null);
  const [vatRange, setVatRange] = useState(() => ({ start: monthStartStr(), end: todayStr() }));
  const [vatLoading, setVatLoading] = useState(false);
  const loadVatReturn = async () => {
    setVatLoading(true);
    try {
      const q = vatRange.start && vatRange.end ? `?start=${vatRange.start}&end=${vatRange.end}` : '';
      const r = await apiFetch(`/api/reports/vat${q}`); const d = await r.json();
      setVatRet(d.success ? d : { error: d.error || 'Provide a start and end date.' });
    } catch { setVatRet({ error: 'Network error' }); }
    finally { setVatLoading(false); }
  };

  // Book a month's percentage tax into the ledger (DR 745000 / CR 230400).
  // The report alone never reached the books, so the P&L overstated net
  // income. Safe to re-run: it posts only the difference from what is
  // already accrued, and nothing at all when the month is unchanged.
  const [ptaxMonth, setPtaxMonth] = useState(() => {
    const d = new Date(); d.setDate(0);            // last month
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [ptaxAccruing, setPtaxAccruing] = useState(false);
  const accruePtax = async () => {
    if (!await ui.confirm(`Book the 3% percentage tax for ${ptaxMonth} into the ledger?

It posts only what is not already accrued for that month.`)) return;
    setPtaxAccruing(true);
    try {
      const r = await apiFetch('/api/reports/percentage-tax/accrue', { method: 'POST', body: JSON.stringify({ month: ptaxMonth }) });
      const d = await r.json();
      if (!d.success) return ui.alert(d.error || 'Could not accrue.');
      ui.alert(d.posted
        ? `Posted ${d.reference}: ${money2(d.amount)}. The month's tax is ${money2(d.taxDue)}.`
        : `Nothing to post - ${ptaxMonth} is already accrued at ${money2(d.taxDue)}.`);
    } catch { ui.alert('Network error.'); }
    finally { setPtaxAccruing(false); }
  };
  const exportTrialBalancePDF = async () => {
    if (!tb || tb.error) return ui.alert('Load the Trial Balance first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('TRIAL BALANCE', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(new Date().toLocaleDateString(), 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Code', 'Account', 'Debit', 'Credit']],
      body: tb.rows.map(r => [r.code, r.name, r.debit ? pdfMoney(r.debit) : '', r.credit ? pdfMoney(r.credit) : '']),
      foot: [[{ content: `Totals ${tb.balanced ? '(Balanced)' : '(OUT OF BALANCE)'}`, colSpan: 2 }, pdfMoney(tb.totalDebit), pdfMoney(tb.totalCredit)]],
      styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] }, footStyles: { fillColor: [70, 70, 70], fontStyle: 'bold', textColor: 255 },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    doc.save(`Trial-Balance-${todayStr()}.pdf`);
  };
  const exportPercentageTaxPDF = async () => {
    if (!ptax || ptax.error) return ui.alert('Compute the Percentage Tax report first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('PERCENTAGE TAX', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`${ptaxRange.start} to ${ptaxRange.end}  ·  ${ptax.orders} order(s)`, 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Line', 'Amount']],
      body: (ptax.lines || []).map(l => [l.label, pdfMoney(l.amount)]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 1: { halign: 'right' } },
    });
    doc.save(`Percentage-Tax-${ptaxRange.start}_to_${ptaxRange.end}.pdf`);
  };
  // ── Requisition Slips / Approvals ────────────────────────────────────────────
  // A petty-cash disbursement or a new purchase order files a Pending slip
  // instead of moving anything directly - approving it here is what actually
  // triggers the movement (see requisitions.js on the server).
  const [reqSlips, setReqSlips] = useState([]);
  const [reqSlipsLoading, setReqSlipsLoading] = useState(false);
  const [reqSlipView, setReqSlipView] = useState('pending'); // 'pending' | 'all'
  const [reqSlipPreview, setReqSlipPreview] = useState(null);
  const [reqSlipRejecting, setReqSlipRejecting] = useState(null); // slip being rejected (reason prompt)
  const [reqSlipRejectReason, setReqSlipRejectReason] = useState('');
  const [reqSlipBusy, setReqSlipBusy] = useState(false);
  // Live fund balance for the previewed slip - fetched fresh on open rather
  // than trusted from whatever rfFunds happens to hold, since an approver
  // reviewing this queue may never have opened the Revolving Funds panel
  // this session. Only meaningful for the two types that touch a fund
  // (petty-cash out, fund-replenish in); null otherwise.
  const [reqSlipFundBalance, setReqSlipFundBalance] = useState(null);
  useEffect(() => {
    const needsFund = reqSlipPreview && ['petty-cash', 'fund-replenish'].includes(reqSlipPreview.type) && reqSlipPreview.fundId;
    if (!needsFund) { setReqSlipFundBalance(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch('/api/revolving-funds');
        const d = await r.json();
        const fund = d.success ? (d.funds || []).find(f => String(f._id) === String(reqSlipPreview.fundId)) : null;
        if (!cancelled) setReqSlipFundBalance(fund ? fund.currentBalance : null);
      } catch { if (!cancelled) setReqSlipFundBalance(null); }
    })();
    return () => { cancelled = true; };
  }, [reqSlipPreview, apiFetch]);

  const fetchRequisitionSlips = async (status) => {
    setReqSlipsLoading(true);
    try {
      const s = status !== undefined ? status : (reqSlipView === 'pending' ? 'Pending' : '');
      const qs = s ? `?status=${s}` : '';
      const r = await apiFetch(`/api/requisition-slips${qs}`);
      const d = await r.json();
      if (d.success) setReqSlips(d.slips);
    } catch { /* silent - approvals list is supplementary, not blocking */ }
    finally { setReqSlipsLoading(false); }
  };

  const approveReqSlip = async (slip) => {
    const label = slip.type === 'petty-cash' ? `₱${slip.amount.toFixed(2)} from ${slip.fundName}`
      : slip.type === 'new-fund' ? `new fund "${slip.fundName}" opened with ₱${slip.amount.toFixed(2)}`
      : slip.type === 'fund-replenish' ? `${slip.amount > 0 ? `₱${slip.amount.toFixed(2)}` : 'a top-up'} into ${slip.fundName}`
      : `PO to ${slip.supplier || 'supplier'} (est. ₱${slip.estTotal.toFixed(2)})`;
    if (!(await ui.confirm(`Approve ${slip.slipNumber}: ${label}?`))) return;
    setReqSlipBusy(true);
    try {
      const send = async (body) => (await apiFetch(`/api/requisition-slips/${slip._id}/approve`, { method: 'POST', body: JSON.stringify(body) })).json();
      let d = await send({});
      // Over the month's budget: the server holds it until the approver says
      // why it should go ahead anyway. The reason is kept on the slip.
      if (!d.success && d.overBudget) {
        const reason = prompt(`${d.error}\n\nApprove over budget? Give the reason:`);
        if (!reason || !reason.trim()) return;
        d = await send({ acceptOverBudget: true, overBudgetReason: reason.trim() });
      }
      if (d.success) { fetchRequisitionSlips(); fetchERPData(); ui.alert(`${slip.slipNumber} approved.`); }
      else ui.alert(d.error || 'Failed to approve.');
    } catch { ui.alert('Network error.'); }
    finally { setReqSlipBusy(false); }
  };

  const submitRejectReqSlip = async () => {
    if (!reqSlipRejecting || !reqSlipRejectReason.trim()) return;
    setReqSlipBusy(true);
    try {
      const r = await apiFetch(`/api/requisition-slips/${reqSlipRejecting._id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reqSlipRejectReason.trim() }) });
      const d = await r.json();
      if (d.success) { setReqSlipRejecting(null); setReqSlipRejectReason(''); fetchRequisitionSlips(); }
      else ui.alert(d.error || 'Failed to reject.');
    } catch { ui.alert('Network error.'); }
    finally { setReqSlipBusy(false); }
  };

  // Small shared helpers so all three type-branch spots below (PDF export,
  // the on-screen table, the preview modal) read the same way for the new
  // 'new-fund' type instead of it falling through to "Procurement" by accident.
  const reqTypeLabel = (t) => t === 'petty-cash' ? 'Petty Cash' : t === 'new-fund' ? 'New Fund' : t === 'fund-replenish' ? 'Fund Replenish' : 'Procurement';
  const reqSummary = (s) => s.type === 'petty-cash' ? `${s.fundName} - ${s.description}`
    : s.type === 'new-fund' ? `Open "${s.fundName}"${s.description ? ` - ${s.description}` : ''}`
    : s.type === 'fund-replenish' ? `Top up ${s.fundName}${s.description ? ` - ${s.description}` : ''}`
    : `${s.supplier || 'No supplier'} (${(s.lines || []).length} item(s))`;
  // fund-replenish's amount is 0 when the filer left it blank ("top up to
  // full" - resolved from the fund's actual shortfall at approval time), so
  // the Approvals table shows "to full" instead of a misleading ₱0.00.
  const reqAmount = (s) => (s.type === 'petty-cash' || s.type === 'new-fund') ? s.amount
    : s.type === 'fund-replenish' ? (s.amount > 0 ? s.amount : null)
    : s.estTotal;

  const exportRequisitionSlipsPDF = async () => {
    if (!reqSlips || reqSlips.length === 0) return ui.alert('No requisition slips to export.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    await addLogoToPDF(doc);
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('REQUISITION SLIPS / APPROVALS', 105, 22, { align: 'center' });
    doc.setFontSize(9); doc.text(`${reqSlips.length} slip(s) · ${reqSlipView === 'pending' ? 'Pending only' : 'All statuses'} · ${new Date().toLocaleDateString()}`, 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Slip #', 'Type', 'Summary', 'Amount', 'Prepared By', 'Status', 'Approved/Rejected By']],
      body: reqSlips.map(s => [
        s.slipNumber, reqTypeLabel(s.type), reqSummary(s), reqAmount(s) === null ? 'To full' : pdfMoney(reqAmount(s)),
        s.preparedBy || '-', s.status, s.approvedBy || s.rejectedBy || '-',
      ]),
      styles: { fontSize: 7.5 }, headStyles: { fillColor: [30, 30, 30] }, columnStyles: { 3: { halign: 'right' } },
    });
    doc.save(`Requisition-Slips-${todayStr()}.pdf`);
  };

  // Opening a page: set it, and load what it shows. Used by the page buttons
  // and by the landing rule below, so a page reached either way arrives with
  // its figures rather than an empty table.
  const openLedgerPage = (id) => {
  setLedgerSubTab(id);
  // Merged "Accounts & Periods" page: load all its sections.
  if (id === 'accperiods') { fetchCoa(); fetchClosedPeriods(); fetchPaymentMap(); fetchOpeningBalances(); }
  // Merged "AR & AP" page.
  if (id === 'araap') { fetchArOutstanding(); fetchArAgeing(); fetchApData(); fetchSuppliers(); }
  if (id === 'bills') { fetchBills(); fetchSuppliers(); fetchCoa(); }
  if (id === 'ar') { fetchArOutstanding(); fetchArAgeing(); }
  if (id === 'ap') { fetchApData(); fetchSuppliers(); }
  if (id === 'pnl' && !pnlData) fetchPnl();
  if (id === 'trial') loadTrial();
  if (id === 'percentagetax') loadPtax();
  if (id === 'vatreturn' && !vatRet) loadVatReturn();
  if (id === 'bookshealth' && !bookshealth) loadBooksHealth();
  if (id === 'pnlmonthly' && !pnlMonthly) fetchPnlMonthly();
  if (id === 'balance' && !bsData) fetchBalanceSheet();
  if (id === 'bsmonthly' && !bsMonthly) fetchBsMonthly();
  if (id === 'salessummary') fetchSalesSummary();
  if (id === 'payments') fetchSalesByPayment();
  if (id === 'arreport' && !arReport) fetchArReport();
  if (id === 'collections') { if (!collectionReport) fetchCollectionReport(); if (!checkRegister) fetchChecks(); }
  if (id === 'pricelog') { fetchChangeRequests(); if (!priceChangeLog) fetchPriceChangeLog(); }
  if (id === 'apreport' && !apReport) fetchApReport();
  if (id === 'supplierpay' && !supplierPayments) fetchSupplierPayments();
  if (id === 'checkvouchers' && !checkVouchers) fetchCheckVouchers();
  // The liquidate modal picks from real bills / receivables,
  // so those lists have to be present before it can open.
  if (id === 'advances') { if (!advances) fetchAdvances(); fetchBills(); fetchArOutstanding(); }
  if (id === 'profitcat') fetchProfitByCategory();
  if (id === 'menueng') fetchMenuEngineering();
  if (id === 'variance') fetchCashierVariance();
  if (id === 'commissions') fetchCommissions();
  if (id === 'revolving') { fetchRfFunds(); setRfActiveFund(null); setRfTxs([]); }
  if (id === 'expenses') { fetchExpenseCategories(); fetchExpenses(); }
  if (id === 'approvals') fetchRequisitionSlips();
  };

  // The pages of this tab this person may open. A page they may not is not
  // listed - and not landed on: a deep link, the tab's default page or the
  // page left open by someone else on this till moves to the first allowed
  // one. The old merged ids (coa, periods, payroute, ar, ap) still resolve to
  // the page that now holds them.
  // pnl and balance are the single-period views of the Reports P&L and
  // Balance Sheet pages (pnlmonthly, bsmonthly), behind the switch on each.
  const LEDGER_ALIAS = { coa: 'accperiods', periods: 'accperiods', payroute: 'accperiods', pnl: 'pnlmonthly', balance: 'bsmonthly',
    // The views of Reports > Receivables and Payables, and the old AR & AP page.
    ar: 'arreport', araap: 'arreport', collections: 'arreport', ap: 'apreport', bills: 'apreport' };
  const pageTab = activeTab === 'reports' ? 'reports' : 'ledger';
  const canRecordPayments = can('accounting.view') && can('screen.ledger.araap');
  const canPayBills = can('accounting.view') && can('screen.ledger.bills');
  // Approvals has its own sidebar entry: this screen then shows that one page
  // and nothing of the Ledger around it - no page tabs, no export bar.
  const soloApprovals = activeTab === 'approvals';
  const pageGroups = soloApprovals ? [] : (pageTab === 'reports' ? REPORT_TAB_GROUPS : LEDGER_TAB_GROUPS)
    .map(([label, items]) => [label, items.filter(([id]) => can(`screen.${pageTab}.${id}`))])
    .filter(([, items]) => items.length > 0);
  useEffect(() => {
    if (!soloApprovals) return;
    if (ledgerSubTab !== 'approvals') setLedgerSubTab('approvals');
    fetchRequisitionSlips();
  }, [soloApprovals]); // eslint-disable-line react-hooks/exhaustive-deps
  const allowedPages = pageGroups.flatMap(([, items]) => items.map(([id]) => id));
  useEffect(() => {
    if (activeTab !== 'ledger' && activeTab !== 'reports') return;
    const cur = LEDGER_ALIAS[ledgerSubTab] || ledgerSubTab;
    if (activeTab === 'ledger' && STATEMENT_PAGES.includes(cur)) { setActiveTab?.('reports'); return; }
    // The old combined AR & AP page: open the receivables view this person can use.
    if (ledgerSubTab === 'araap') { openLedgerPage(canRecordPayments ? 'ar' : 'arreport'); return; }
    if (allowedPages.includes(cur) || allowedPages.length === 0) return;
    openLedgerPage(allowedPages[0]);
  }, [activeTab, ledgerSubTab, allowedPages.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load the active view's data on entry (nav landing or sub-tab click).
  useEffect(() => {
    if (!allowedPages.includes(LEDGER_ALIAS[ledgerSubTab] || ledgerSubTab)) return;
    if (ledgerSubTab === 'trial') loadTrial();
    if (ledgerSubTab === 'revolving') fetchRfFunds();
    if (ledgerSubTab === 'salessummary' && !salesSummary) fetchSalesSummary();
    if (ledgerSubTab === 'backdate' && !bdHistory) fetchBdHistory(1);
    if (ledgerSubTab === 'backdate' && !bdQueue) fetchBdQueue(1);
    // Tenancy Health had no entry here at all, so opening the page never
    // started the check: it sat on its loading line indefinitely, and the only
    // buttons that could start it appear after a result or an error.
    if (ledgerSubTab === 'tenancy' && !tenancyReport && !tenancyProgress) fetchTenancyReport?.();
    if (ledgerSubTab === 'exportall' && !exportDatasets) fetchExportDatasets?.();
  }, [ledgerSubTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which Payment Routing parent groups (111000 / 112000 / etc.) are expanded.
  // Default-collapsed so the operator sees only the high-level parent rows;
  // they click the chevron to drill into the children (Bank Transfer, GCash, etc.).
  const [expandedPayRouteGroups, setExpandedPayRouteGroups] = useState(() => new Set());
  const togglePayRouteGroup = (parentCode) => {
    setExpandedPayRouteGroups(prev => {
      const next = new Set(prev);
      if (next.has(parentCode)) next.delete(parentCode); else next.add(parentCode);
      return next;
    });
  };

  // Parents the operator can add children under = canonical posting/header accounts.
  const coaParents = (coaAccounts || []).filter(a => !a.custom);
  const coaChildrenOf = (code) => (coaAccounts || []).filter(a => a.custom && a.parent === code);
  // Journal-entry account picker = standard accounts + any custom child accounts.
  const jeAccounts = [
    ...standardAccounts,
    ...(coaAccounts || []).filter(a => a.custom).map(a => ({ accountCode: a.code, accountName: a.name })),
  ];

  // ── AR / AP aging helpers ──────────────────────────────────────────────────
  const agingBuckets = (items, getDate, getAmt) => {
    const now = Date.now();
    const b = { c: 0, d60: 0, d90: 0, over: 0 };
    (items || []).forEach(item => {
      const days = Math.floor((now - new Date(getDate(item)).getTime()) / 86400000);
      const amt  = getAmt(item);
      if      (days <= 30) b.c    += amt;
      else if (days <= 60) b.d60  += amt;
      else if (days <= 90) b.d90  += amt;
      else                 b.over += amt;
    });
    return b;
  };

  // FIFO: allocate payments (totalDebit) to oldest AP credits first → residual = outstanding
  const apCreditEntries = (() => {
    if (!apData?.recent) return [];
    const credits = apData.recent
      .filter(e => e.credit > 0)
      .map(e => ({ ...e }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    let remaining = apData.totalDebit || 0;
    return credits.map(e => {
      if (remaining <= 0)           { return { ...e, outstandingAmt: e.credit }; }
      if (remaining >= e.credit)    { remaining -= e.credit; return { ...e, outstandingAmt: 0 }; }
      const o = e.credit - remaining; remaining = 0; return { ...e, outstandingAmt: o };
    }).filter(e => e.outstandingAmt > 0.005);
  })();

  // ── Report-table pagination (client-side, 10 rows/page) ──
  const arPage   = usePagination(arOutstanding?.orders, 10);
  const apPage   = usePagination(apData?.recent, 10);
  const sbpPage  = usePagination(salesByPayment?.breakdown, 10);
  const sliPage  = usePagination(salesLineItems?.rows, 15);
  const pbcPage  = usePagination(profitByCategory?.categories, 10);
  const mePage   = usePagination(menuEngineering?.items, 10);
  const cvPage   = usePagination(cashierVariance?.cashiers, 10);
  const cmPage   = usePagination(commissions?.sellers, 10);
  const billsPage = usePagination(bills, 12);

  // Sub-tab nav, grouped. These used to be one long horizontally-scrolling
  // strip of 17 (reports) / 12 (ledger) buttons, which meant scrolling blind to
  // find anything. Grouping by what the page is FOR lets the whole set wrap and
  // stay visible at once.
  // Bills import. The sheet is read in the browser and the rows handed to the
  // server, same as every other importer here.
  const [billImporting, setBillImporting] = useState(false);
  const importBills = async (file) => {
    if (!file) return;
    setBillImporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (rows.length === 0) { ui.alert('That sheet has no rows.'); return; }
      const ok = await ui.confirm(
        `Import ${rows.length} bill(s)?\n\nThey arrive as Pending and post nothing - approve each one to book the payable.`,
      );
      if (!ok) return;
      const d = await (await apiFetch('/api/bills/import', {
        method: 'POST', body: JSON.stringify({ rows }),
      })).json();
      if (!d.success) { ui.alert(d.error || 'Import failed.'); return; }
      const bad = (d.skipped || []).map(x => `Row ${x.row}: ${x.error}`);
      ui.alert(`Added ${d.created} bill(s), ${d.totalAmount?.toLocaleString?.('en-PH') ?? d.totalAmount} in total.\n\n${d.note}`
        + (bad.length ? `\n\nNot added:\n- ${bad.join('\n- ')}` : ''));
      fetchBills?.();
    } catch (err) {
      console.error('bill import', err);
      ui.alert('Could not read that file. Use the downloaded template.');
    } finally { setBillImporting(false); }
  };

  // The sub-nav lists live in navRegistry.js, shared with the Ctrl+K palette so
  // a page added here is searchable without being registered a second time.

  return (
        <div className="space-y-4">

          {/* SUB-TAB NAV - two levels instead of one flat wall.
              One row per group meant five rows of identical chips and a dead
              left gutter, with nothing telling the eye where it was. The groups
              are now the primary control and only the ACTIVE group's pages are
              listed, so the nav stays two rows however many reports exist. */}
          {/* Export / template control. Which dataset a page exports is a
              lookup, not a button per screen - a new page is one line here. */}
          {!soloApprovals && (() => {
            const DATASET_FOR_PAGE = {
              checkvouchers: 'checkVouchers', advances: 'advances', expenses: 'expenses',
              journal: 'journal', bills: 'bills', araap: 'bills', revolving: 'revolvingFunds',
              apreport: 'bills', arreport: 'orders', salesline: 'orders', salessummary: 'orders',
            };
            const ds = DATASET_FOR_PAGE[ledgerSubTab];
            if (!ds) return null;
            const busy = exportBusy === ds;
            // The buttons name themselves; a lone "EXPORT" label pushed to the
            // far left of an empty row just looked like stray text.
            return (
              <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
                <button onClick={() => downloadDataset(ds)} disabled={busy}
                  className="flex items-center gap-1.5 text-[10px] bg-brand/10 hover:bg-brand/20 text-brand-text px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
                  <Download size={12} /> {busy ? 'Working…' : 'Export Data'}
                </button>
                <button onClick={() => downloadDataset(ds, { template: true })} disabled={busy}
                  title="Blank workbook with the same columns, plus a sheet of the accepted values for each one"
                  className="flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
                  <FileText size={12} /> Template
                </button>
                {/* An importer only where one exists. A template with no way
                    back in is a dead end, and the Bills page is where a
                    business arrives on day one holding a drawer of unpaid
                    invoices. */}
                {ledgerSubTab === 'bills' && (
                  <label className={`flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider transition ${billImporting ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
                    <Upload size={12} /> {billImporting ? 'Reading…' : 'Import'}
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; importBills(f); }} />
                  </label>
                )}
              </div>
            );
          })()}

          {(() => {
            const groups = pageGroups;
            if (groups.length === 0) return null;
            // Derived from the current page rather than stored: deep links,
            // reloads and the merged pages all resolve to the right group
            // without a second piece of state that could disagree with it.
            const activeGroup = groups.find(([, items]) => items.some(([id]) => id === (LEDGER_ALIAS[ledgerSubTab] || ledgerSubTab))) || groups[0];
            const [activeLabel, activeItems] = activeGroup;

            // Switching page is a real function, called by both rows.
            // The group buttons previously synthesised a DOM click on the
            // target page button - which only exists while its group is
            // already active, so every inactive group tab did nothing.
            // A statement opens on its single-period view; "By month" is one
            // click away on the page itself.
            const openPage = (id) => openLedgerPage({
              pnlmonthly: 'pnl', bsmonthly: 'balance',
              // Where the work is, for those who can do it; the report otherwise.
              arreport: canRecordPayments ? 'ar' : 'arreport',
              apreport: canPayBills ? 'bills' : 'apreport',
            }[id] || id);

            return (
              <div className="bg-surface border border-white/10 rounded-2xl p-1.5">
                <div className="flex gap-0.5 overflow-x-auto custom-scrollbar">
                  {groups.map(([groupLabel, items]) => {
                    const isActive = groupLabel === activeLabel;
                    return (
                      <button
                        key={groupLabel}
                        onClick={() => { if (!isActive) openPage(items[0][0]); }}
                        className={`relative shrink-0 px-3.5 py-2 text-[11px] font-black uppercase tracking-widest transition ${
                          isActive ? 'text-fg' : 'text-fg/70'}`}
                      >
                        {groupLabel}
                        {/* Underline, not a filled pill - the group marks where
                            you are; the page below is the thing you act on. */}
                        {isActive && <span className="absolute left-3 right-3 -bottom-0.5 h-0.5 rounded-full bg-brand" />}
                      </button>
                    );
                  })}
                </div>

                <div className="h-px bg-white/8 my-1.5" />

                <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-0.5">
                  {activeItems.map(([id, label, Icon]) => (
                    <button
                      id={`subtab-${id}`}
                      key={id}
                      onClick={() => openPage(id)}
                      className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-[11px] tracking-wide transition min-h-[36px] ${
                        (LEDGER_ALIAS[ledgerSubTab] || ledgerSubTab) === id
                          ? 'bg-brand text-on-brand shadow-elev-1'
                          : 'text-fg/75 hover:text-fg hover:bg-white/[0.06]'}`}
                    >
                      <Icon size={13} className={(LEDGER_ALIAS[ledgerSubTab] || ledgerSubTab) === id ? '' : 'opacity-60'} /> {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Section area. On the merged pages (Accounts & Periods, AR & AP) the
              stacked sections flow into two columns so they fill the width instead
              of leaving a big empty right side; every other page stays single-column. */}
          <div className={(ledgerSubTab === 'accperiods' || ledgerSubTab === 'araap')
            ? 'grid lg:grid-cols-2 gap-4 items-start'
            : 'space-y-4'}>

          {/* One page each for receivables and payables: its views, as this
              person may see them. Recording payments and paying bills need the
              accounting permission; the reports need only Reports. */}
          {['ar', 'arreport', 'collections'].includes(ledgerSubTab) && (
            <StatementViewSwitch value={ledgerSubTab} onChange={openLedgerPage} options={[
              ...(canRecordPayments ? [['ar', 'Open invoices']] : []),
              ...(can('screen.reports.arreport') ? [['arreport', 'Aging report']] : []),
              ...(can('screen.reports.collections') ? [['collections', 'Collections']] : []),
            ]} />
          )}
          {['bills', 'ap', 'apreport'].includes(ledgerSubTab) && (
            <StatementViewSwitch value={ledgerSubTab} onChange={openLedgerPage} options={[
              ...(canPayBills ? [['bills', 'Bills']] : []),
              ...(canRecordPayments ? [['ap', 'Open payables']] : []),
              ...(can('screen.reports.apreport') ? [['apreport', 'A/P report']] : []),
            ]} />
          )}

          {/* ── TRIAL BALANCE ─────────────────────────────────────────────────── */}
          {ledgerSubTab === 'trial' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h3 className="text-lg font-black text-fg">Trial Balance</h3>
                  <p className="text-fg/65 text-xs">All accounts with their net debit / credit balance.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={loadTrial} disabled={tbLoading} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition">
                    <RefreshCw size={12} className={tbLoading ? 'animate-spin' : ''} /> Refresh
                  </button>
                  {tb && !tb.error && <button onClick={exportTrialBalancePDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> PDF</button>}
                </div>
              </div>
              {tb?.error ? (
                <p className="text-danger text-sm font-bold">{tb.error}</p>
              ) : !tb ? (
                <p className="text-fg/70 text-sm">Loading…</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-fg/80 text-[10px] font-black uppercase tracking-wider text-left border-b border-white/10">
                        <th className="py-2">Code</th><th className="py-2">Account</th>
                        <th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="text-fg/75">
                      {tb.rows.map((r) => (
                        <tr key={r.code} className="border-b border-white/5">
                          <td className="py-1.5 font-mono text-fg/80 text-xs">{r.code}</td>
                          <td className="py-1.5 font-bold text-fg/80">{r.name}</td>
                          <td className="py-1.5 text-right text-fg/80 font-mono">{r.debit ? money2(r.debit) : ''}</td>
                          <td className="py-1.5 text-right text-fg/80 font-mono">{r.credit ? money2(r.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-black text-fg border-t-2 border-white/20">
                        <td className="py-2" colSpan={2}>Totals {tb.balanced ? <span className="text-success text-xs ml-1">Balanced</span> : <span className="text-danger text-xs ml-1">Out of balance</span>}</td>
                        <td className="py-2 text-right font-mono">{money2(tb.totalDebit)}</td>
                        <td className="py-2 text-right font-mono">{money2(tb.totalCredit)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── SALES SUMMARY (channel breakdown) ─────────────────────────────── */}
          <SalesByOrderTab
            ledgerSubTab={ledgerSubTab} salesView={salesView} salesViewTabs={salesViewTabs} sssRange={sssRange} setSssRange={setSssRange} fetchSalesSummary={fetchSalesSummary}
            salesSourceSelect={salesSourceSelect} salesSummary={salesSummary} exportSalesSummaryPDF={exportSalesSummaryPDF} exportSssExcel={exportSssExcel} sssRows={sssRows} money2={money2} />

          {/* ── SALES LINE ITEMS (item-level detail) ────────────────────────────── */}
          <SalesDocsTab
            ledgerSubTab={ledgerSubTab} salesView={salesView} sliView={sliView} salesViewTabs={salesViewTabs} sliRange={sliRange} setSliRange={setSliRange}
            loadSli={loadSli} salesSourceSelect={salesSourceSelect} setSliSummary={setSliSummary} salesLineItems={salesLineItems} exportSalesLineItemsPDF={exportSalesLineItemsPDF} sliSummary={sliSummary}
            exportSliSummaryPDF={exportSliSummaryPDF} exportSliExcel={exportSliExcel} fmtD={fmtD} money2={money2} sliPage={sliPage} />

          {/* ── PERCENTAGE TAX ────────────────────────────────────────────────── */}
          {ledgerSubTab === 'percentagetax' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-5 max-w-2xl">
              <h3 className="text-lg font-black text-fg mb-1">Percentage Tax</h3>
              <p className="text-fg/65 text-xs mb-4">Non-VAT percentage tax on net collected sales for a period.</p>
              <div className="flex items-end gap-2 mb-4 flex-wrap">
                <RangePresets value={ptaxRange} onChange={r => setPtaxRange(p => ({ ...p, ...r }))} onRun={loadPtax} />
                <label className="text-xs font-bold text-fg/70">Start
                  <input type="date" value={ptaxRange.start} onChange={(e) => setPtaxRange((r) => ({ ...r, start: e.target.value }))} className="block bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg mt-1" />
                </label>
                <label className="text-xs font-bold text-fg/70">End
                  <input type="date" value={ptaxRange.end} onChange={(e) => setPtaxRange((r) => ({ ...r, end: e.target.value }))} className="block bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg mt-1" />
                </label>
                <button onClick={loadPtax} disabled={ptaxLoading} className="bg-brand hover:bg-brand/90 text-on-brand font-bold text-sm px-4 py-2 rounded-lg transition">{ptaxLoading ? 'Loading…' : 'Compute'}</button>
                {ptax && !ptax.error && <button onClick={exportPercentageTaxPDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> PDF</button>}
              </div>
              {ptax?.error ? (
                <p className="text-danger text-sm font-bold">{ptax.error}</p>
              ) : ptax && !ptax.error ? (
                <div className="space-y-1">
                  <p className="text-fg/70 text-xs mb-2">{ptax.orders} completed order(s) in range.</p>
                  {(ptax.lines || []).map((l, i) => {
                    const isTax = i === (ptax.lines.length - 1);
                    return (
                      <div key={i} className={`flex justify-between text-sm py-2 ${isTax ? 'border-t-2 border-white/20 mt-1 font-black text-fg' : 'border-b border-white/5'}`}>
                        <span className={isTax ? '' : 'text-fg/65'}>{l.label}</span>
                        <span className={`font-mono font-bold ${isTax ? 'text-brand-text' : l.amount < 0 ? 'text-danger' : 'text-fg/85'}`}>{money2(l.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-fg/70 text-sm">Pick a date range and press Compute.</p>
              )}
            </div>
          )}

          {ledgerSubTab === 'vatreturn' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-5 max-w-2xl">
              <h3 className="text-lg font-black text-fg mb-1">VAT Return</h3>
              <p className="text-fg/65 text-xs mb-4">Output VAT collected on sales, less creditable input VAT on purchases.</p>
              <div className="flex items-end gap-2 mb-4 flex-wrap">
                <RangePresets value={vatRange} onChange={r => setVatRange(p => ({ ...p, ...r }))} onRun={loadVatReturn} />
                <label className="text-xs font-bold text-fg/70" htmlFor="vat-start">Start
                  <input id="vat-start" type="date" value={vatRange.start} onChange={(e) => setVatRange((r) => ({ ...r, start: e.target.value }))} className="block bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg mt-1" />
                </label>
                <label className="text-xs font-bold text-fg/70" htmlFor="vat-end">End
                  <input id="vat-end" type="date" value={vatRange.end} onChange={(e) => setVatRange((r) => ({ ...r, end: e.target.value }))} className="block bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg mt-1" />
                </label>
                <button onClick={loadVatReturn} disabled={vatLoading} className="bg-brand hover:bg-brand/90 text-on-brand font-bold text-sm px-4 py-2 rounded-lg transition">{vatLoading ? 'Loading…' : 'Compute'}</button>
              </div>
              {vatRet?.error ? (
                <p className="text-danger text-sm font-bold">{vatRet.error}</p>
              ) : vatRet?.notApplicable ? (
                <p className="text-fg/75 text-sm leading-snug bg-white/[0.03] border border-white/10 rounded-lg p-3">{vatRet.reason}</p>
              ) : vatRet ? (
                <div className="space-y-1">
                  <p className="text-fg/70 text-xs mb-2">{vatRet.orders} completed order(s) in range.</p>
                  {(vatRet.lines || []).map((l, i) => {
                    const isNet = i === (vatRet.lines.length - 1);
                    return (
                      <div key={i} className={`flex justify-between text-sm py-2 ${isNet ? 'border-t-2 border-white/20 mt-1 font-black text-fg' : 'border-b border-white/5'}`}>
                        <span className={isNet ? '' : 'text-fg/65'}>{l.label}</span>
                        <span className={`font-mono font-bold ${isNet ? 'text-brand-text' : l.amount < 0 ? 'text-danger' : 'text-fg/85'}`}>{money2(l.amount)}</span>
                      </div>
                    );
                  })}
                  <p className="text-[11px] text-fg/65 pt-2 leading-snug">
                    Read from the ledger: 230300 Output VAT Payable and 170300 Input VAT (Creditable). Input VAT only appears for purchases marked as charged VAT by a VAT-registered supplier.
                  </p>
                </div>
              ) : (
                <p className="text-fg/70 text-sm">Pick a date range and press Compute.</p>
              )}
              {/* Only where the tax applies, and only for someone who may post. */}
              {!ptax?.notApplicable && auth.can('accounting.manage') && (
                <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap items-end gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-fg/70">Book into the ledger</label>
                    <input type="month" value={ptaxMonth} onChange={(e) => setPtaxMonth(e.target.value)}
                      className="block bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-fg mt-1" />
                  </div>
                  <button onClick={accruePtax} disabled={ptaxAccruing || !ptaxMonth}
                    className="bg-brand hover:bg-brand-dark text-on-brand font-bold text-sm px-4 py-2 rounded-lg transition disabled:opacity-50">
                    {ptaxAccruing ? 'Posting…' : 'Accrue month'}
                  </button>
                  <p className="text-xs text-fg/70 max-w-md">
                    Posts the month's 3% as Percentage Tax Expense / Payable. Re-run after a void to correct it.
                  </p>
                </div>
              )}
            </div>
          )}

          <ChartOfAccountsTab
            ledgerSubTab={ledgerSubTab} downloadAccountBalances={downloadAccountBalances} exportBusy={exportBusy} obEntry={obEntry} fetchOpeningBalances={fetchOpeningBalances} peso={peso}
            obRows={obRows} setObRows={setObRows} balanceSheetAccounts={balanceSheetAccounts} obMeta={obMeta} setObMeta={setObMeta} submitOpeningBalances={submitOpeningBalances}
            obBusy={obBusy} isSuperAdmin={isSuperAdmin} seedPaymentSubaccounts={seedPaymentSubaccounts} coaParent={coaParent} setCoaParent={setCoaParent} coaParents={coaParents}
            coaNewName={coaNewName} setCoaNewName={setCoaNewName} addCoaChild={addCoaChild} coaBusy={coaBusy} coaChildrenOf={coaChildrenOf} coaEditId={coaEditId}
            coaEditName={coaEditName} setCoaEditName={setCoaEditName} renameCoaChild={renameCoaChild} setCoaEditId={setCoaEditId} deleteCoaChild={deleteCoaChild} />

          {ledgerSubTab === 'journal' && (
        <div className="flex flex-col xl:flex-row gap-8">

          {/* LEFT COLUMN: Balances & New Entry Form */}
          <div className="w-full xl:w-1/3 space-y-6">
            
            {/* --- LIVE CASH ON HAND --- */}
            {/* Cash on hand below zero is not a balance, it is an error in the
                books (more paid out of the drawer than was ever put in), so it
                is shown as one - red, sign first - not in the same green as a
                healthy drawer. */}
            <div className={`${cashOnHand < 0 ? 'bg-red-700 border-red-800' : 'bg-accent border-accent/30'} border rounded-xl p-6 shadow-lg shadow-accent/5`}>
              <p className={`${cashOnHand < 0 ? 'text-white' : 'text-on-brand'} text-xs font-bold uppercase tracking-wider mb-1`}>Live Cash on Hand</p>
              <p className={`text-4xl font-black ${cashOnHand < 0 ? 'text-white' : 'text-on-brand'}`}>
                {cashOnHand < 0 ? '−' : ''}₱{Math.abs(cashOnHand).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              {cashOnHand < 0 && (
                <p className="text-white/90 text-xs font-bold mt-2">More has been paid out of cash than was recorded coming in. Check the journal for a missing receipt or opening balance.</p>
              )}
            </div>

            <ManualJournalApprovals apiFetch={apiFetch} can={can} peso={peso} onPosted={fetchERPData}
              refreshKey={jeDraftsKey} activeAdmin={activeAdmin} isSuperAdmin={isSuperAdmin} />
            <div className="bg-surface border border-white/10 rounded-xl p-6 h-fit">
              <h3 className="text-xl font-bold mb-4 text-brand-text border-b border-white/10 pb-2">New Journal Entry</h3>
              {!can('journal.approve') && <p className="text-[11px] text-fg/70 -mt-2 mb-3">Your entries are held for an approver before they reach the ledger.</p>}
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-fg/80 font-bold uppercase block mb-1">Entry date</label>
                  <input type="date" value={jeForm.date || ''} onChange={e => setJeForm({...jeForm, date: e.target.value})}
                    className="w-full bg-page-bg border border-white/10 rounded p-2 text-fg outline-none" />
                  <p className="text-[9px] text-fg/70 mt-1">The period this entry belongs to. A closed month will refuse it.</p>
                </div>
                <input type="text" placeholder="Description / Memo" value={jeForm.description} onChange={e => setJeForm({...jeForm, description: e.target.value})} className="w-full bg-page-bg border border-white/10 rounded p-2 text-fg outline-none" />
                {jeForm.lines.map((line, idx) => (
                  <div key={idx} className="bg-accent p-3 rounded border border-gray-700 space-y-2 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-on-brand">Line {idx + 1}</span>
                      <button
                        type="button"
                        aria-label={`Remove line ${idx + 1}`}
                        disabled={jeForm.lines.length <= 2}
                        title={jeForm.lines.length <= 2 ? 'A journal entry needs at least 2 lines' : 'Remove this line'}
                        onClick={() => setJeForm({ ...jeForm, lines: jeForm.lines.filter((_, i) => i !== idx) })}
                        className="text-white hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <select value={line.accountCode} onChange={(e) => {
                      const acc = jeAccounts.find(a => a.accountCode === e.target.value);
                      const newLines = [...jeForm.lines];
                      newLines[idx] = { ...line, accountCode: acc.accountCode, accountName: acc.accountName };
                      setJeForm({...jeForm, lines: newLines});
                    }} className="w-full bg-page-bg border border-gray-600 rounded p-2 text-sm text-fg">
                      <option value="">Select Account...</option>
                      {jeAccounts.map(acc => <option key={acc.accountCode} value={acc.accountCode}>{acc.accountCode} - {acc.accountName}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <input type="number" placeholder="Debit" value={line.debit} onChange={e => { const nl = [...jeForm.lines]; nl[idx].debit = e.target.value; nl[idx].credit = ''; setJeForm({...jeForm, lines: nl}); }} className="w-1/2 bg-page-bg border border-gray-600 rounded p-2 text-sm text-fg placeholder-fg/70" />
                      <input type="number" placeholder="Credit" value={line.credit} onChange={e => { const nl = [...jeForm.lines]; nl[idx].credit = e.target.value; nl[idx].debit = ''; setJeForm({...jeForm, lines: nl}); }} className="w-1/2 bg-page-bg border border-gray-600 rounded p-2 text-sm text-fg placeholder-fg/70" />
                    </div>
                  </div>
                ))}
                <button onClick={() => setJeForm({...jeForm, lines: [...jeForm.lines, {accountCode:'', accountName:'', debit:'', credit:''}]})} className="text-xs text-brand-text hover:text-fg">+ Add Line</button>
                <div className="border-t border-white/10 pt-4 mt-4 flex justify-between items-center">
                  <div className="text-xs text-fg/70">
                    Debits: {jeForm.lines.reduce((s, l) => s + Number(l.debit||0), 0)} <br/>
                    Credits: {jeForm.lines.reduce((s, l) => s + Number(l.credit||0), 0)}
                  </div>
                  <button onClick={async () => {
                    // The reply was being thrown away: an entry the server
                    // refused - unbalanced, or dated into a closed month -
                    // cleared the form and said nothing, so it looked posted
                    // when nothing had been written at all.
                    try {
                      const res = await apiFetch(`/api/journal`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(jeForm) });
                      const d = await res.json();
                      if (!d.success) { ui.alert(d.error || 'The entry was not posted.'); return; }
                      if (d.pending) {
                        ui.toast(`Saved as ${d.draft?.draftNumber} - it posts once an approver signs off.`, { tone: 'success' });
                        setJeDraftsKey(k => k + 1);
                      }
                      setJeForm({
                        date: todayStr(),
                        description: '',
                        lines: [{accountCode:'', accountName:'', debit:'', credit:''}, {accountCode:'', accountName:'', debit:'', credit:''}],
                      });
                      if (!d.pending) { ui.toast('Entry posted.', { tone: 'success' }); fetchERPData(); }
                    } catch { ui.alert('Network error - nothing was posted.'); }
                  }} className="bg-accent text-on-brand font-bold py-2 px-4 rounded hover:bg-page-bg hover:text-brand-text transition shadow-lg shadow-accent/20">Post Entry</button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: General Ledger */}
          <div className="flex-1 bg-surface border border-white/10 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
              <h3 className="text-xl font-bold text-fg">General Ledger</h3>
              <button onClick={exportLedgerToPDF} className="text-[10px] bg-accent border border-gray-600 text-on-brand px-3 py-1.5 rounded hover:bg-page-bg hover:text-brand-text transition font-bold uppercase tracking-wider">
                Export Ledger
              </button>
            </div>
            {/* Sorted by transaction date, not entry order - a backdated entry
                sorts below everything more recent and can be hard to spot by
                scrolling. Search by reference or description finds it directly. */}
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/70" />
              <input type="text" placeholder="Search by reference or description (e.g. BACKDATE, order #)…"
                value={journalSearch} onChange={e => { setJournalSearch(e.target.value); setAccountingPage(1); }}
                className="w-full bg-page-bg border border-white/10 rounded-lg pl-9 pr-9 py-2 text-sm text-fg placeholder-fg/70 outline-none focus:border-accent" />
              {journalSearch && (
                <button onClick={() => setJournalSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg/70 hover:text-fg transition">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="space-y-4">
              {currentEntries.length === 0 && (
                <div className="py-14 px-6 text-center border border-dashed border-white/10 rounded-xl">
                  <FileText size={26} className="mx-auto mb-3 text-brand-text" />
                  <p className="text-fg/70 font-black uppercase tracking-widest text-xs mb-1">
                    {journalSearch ? 'No matching entries' : 'No journal entries yet'}
                  </p>
                  <p className="text-fg/70 text-xs">
                    {journalSearch ? 'Try a different reference or description.' : 'Every sale, expense, and restock posts here automatically; you can also post one manually on the left.'}
                  </p>
                </div>
              )}
              {currentEntries.map(entry => (
                <div key={entry._id} className={`bg-page-bg border border-white/10 rounded-lg p-4 ${entry.reversed ? 'opacity-60' : ''}`}>
                  <div className="flex justify-between items-center mb-3 border-b border-white/10 pb-2 gap-2 flex-wrap">
                    <span className="text-brand-text font-bold">
                      {entry.reference}
                      {entry.reversed && <span className="ml-2 text-[10px] uppercase tracking-wider text-danger">Changed</span>}
                      {entry.reverses && <span className="ml-2 text-[10px] uppercase tracking-wider text-fg/70">Reversal</span>}
                      {entry.correctionOf && <span className="ml-2 text-[10px] uppercase tracking-wider text-fg/70">Correction</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      {isSuperAdmin && !entry.reversed && !entry.reverses && editingEntryId !== entry._id && (
                        <button type="button" onClick={() => setEditingEntryId(entry._id)}
                          className="text-[10px] font-bold uppercase tracking-wider text-brand-text hover:text-fg">Edit</button>
                      )}
                      <span className="text-fg text-sm">{new Date(entry.date).toLocaleDateString()}</span>
                    </span>
                  </div>
                  {entry.changeReason && <p className="text-[11px] text-fg/70 mb-2">Reason: {entry.changeReason}</p>}
                  <p className="text-sm text-fg mb-3 font-semibold">{entry.description}</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-fg text-left"><th className="pb-2">Account</th><th className="pb-2 text-right">Debit</th><th className="pb-2 text-right">Credit</th></tr></thead>
                    <tbody>
                      {entry.lines.map((line, idx) => (
                        <tr key={idx} className="border-t border-gray-800/50">
                          <td className={`py-1 ${line.credit > 0 ? 'pl-6 text-fg' : 'text-fg/70'}`}>{line.accountCode} - {line.accountName}</td>
                          <td className="py-1 text-right text-fg/70">{line.debit > 0 ? line.debit.toFixed(2) : ''}</td>
                          <td className="py-1 text-right text-fg/70">{line.credit > 0 ? line.credit.toFixed(2) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {editingEntryId === entry._id && (
                    <LedgerEntryEditor entry={entry} accounts={jeAccounts} apiFetch={apiFetch}
                      onClose={() => setEditingEntryId(null)} onDone={() => { setEditingEntryId(null); fetchERPData(); }} />
                  )}
                </div>
              ))}
              {/* --- ACCOUNTING PAGINATION CONTROLS --- */}
              {totalAccountingPages > 1 && (
                <div className="flex justify-between items-center bg-page-bg p-3 rounded-lg border border-white/10 mt-4">
                  <button 
                    onClick={() => setAccountingPage(prev => Math.max(prev - 1, 1))}
                    disabled={accountingPage === 1}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${accountingPage === 1 ? 'bg-white/5 text-fg/70 cursor-not-allowed' : 'bg-surface border border-gray-700 text-fg hover:border-accent hover:text-brand-text'}`}
                  >
                    <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                  </button>
                  <span className="text-fg/70 text-xs font-bold tracking-widest">
                    PAGE <span className="text-brand-text text-sm">{accountingPage}</span> OF {totalAccountingPages}
                  </span>
                  <button 
                    onClick={() => setAccountingPage(prev => Math.min(prev + 1, totalAccountingPages))}
                    disabled={accountingPage === totalAccountingPages}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${accountingPage === totalAccountingPages ? 'bg-white/5 text-fg/70 cursor-not-allowed' : 'bg-surface border border-gray-700 text-fg hover:border-accent hover:text-brand-text'}`}
                  >
                    <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
          )}

          {/* ===== PROFIT & LOSS: one page, two views ===== */}
          {(ledgerSubTab === 'pnl' || ledgerSubTab === 'pnlmonthly') && (
            <StatementViewSwitch value={ledgerSubTab} onChange={openLedgerPage}
              options={[['pnl', 'This period'], ['pnlmonthly', 'By month']]} />
          )}
          <ProfitAndLossTab
            ledgerSubTab={ledgerSubTab} pnlRange={pnlRange} setPnlRange={setPnlRange} fetchPnl={fetchPnl} exportPnlPDF={exportPnlPDF} pnlData={pnlData} />

          {/* ===== MONTHLY P&L (period + matrix views, common-size & share-of-parent ratios) ===== */}
          {ledgerSubTab === 'pnlmonthly' && (() => {
            const SECTIONS = [['revenue','Revenue'],['contra','Less: Discounts / Returns'],['cogs','Cost of Sales'],['opex','Operating Expenses'],['otherincome','Other Income'],['otherexpense','Other Expenses']];
            const m = pnlMonthly;
            const nr = m?.grandTotals?.netRevenue || 0;
            const parentTotals = {};
            (m?.accounts || []).forEach(a => { parentTotals[a.parentCode] = (parentTotals[a.parentCode] || 0) + a.total; });
            const peso = (n) => `₱${(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            return (
            <div className="space-y-4 animate-fade-in">
              <div className="flex flex-wrap gap-3 items-center">
                <RangePresets value={pnlmRange} onChange={r => setPnlmRange(p => ({ ...p, ...r }))} onRun={fetchPnlMonthly} />
                <input type="date" value={pnlmRange.start} onChange={e => setPnlmRange(p => ({ ...p, start: e.target.value }))} className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <span className="text-fg/65 font-bold text-sm">→</span>
                <input type="date" value={pnlmRange.end} onChange={e => setPnlmRange(p => ({ ...p, end: e.target.value }))} className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <button onClick={fetchPnlMonthly} className="px-5 py-2 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition">Load</button>
                <div className="flex rounded-xl overflow-hidden border border-white/10">
                  {[['period','Period'],['matrix','Monthly']].map(([v,lbl]) => (
                    <button key={v} onClick={() => setPnlmView(v)} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${pnlmView === v ? 'bg-brand text-on-brand' : 'bg-surface text-fg/75 hover:text-fg'}`}>{lbl}</button>
                  ))}
                </div>
                {m && <button onClick={exportPnlMonthlyPDF} className="ml-auto bg-white/5 text-fg/70 hover:text-fg hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition flex items-center gap-1.5"><Download size={13}/> PDF</button>}
              </div>

              {!m ? <p className="text-fg/65 text-sm text-center p-6 font-bold">Pick a range and click Load.</p> : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead className="text-white bg-accent text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <tr>
                          <th className="px-3 py-2.5">Account</th>
                          {pnlmView === 'matrix'
                            ? <>{m.months.map(mm => <th key={mm} className="px-3 py-2.5 text-right">{mm}</th>)}<th className="px-3 py-2.5 text-right">Total</th></>
                            : <><th className="px-3 py-2.5 text-right">Amount</th><th className="px-3 py-2.5 text-right">% Rev</th><th className="px-3 py-2.5 text-right">% Parent</th></>}
                        </tr>
                      </thead>
                      <tbody>
                        {SECTIONS.map(([sec, label]) => {
                          const rows = m.accounts.filter(a => a.section === sec);
                          if (!rows.length) return null;
                          const span = pnlmView === 'matrix' ? m.months.length + 2 : 4;
                          return (
                            <React.Fragment key={sec}>
                              <tr className="bg-white/[0.03]"><td colSpan={span} className="px-3 py-2 font-black text-brand-text uppercase text-[10px] tracking-wider">{label}</td></tr>
                              {rows.map(a => (
                                <tr key={a.code} className="border-b border-white/5 hover:bg-white/[0.02]">
                                  <td className="px-3 py-2 text-fg/80 pl-6">{a.code} · {a.name}</td>
                                  {pnlmView === 'matrix'
                                    ? <>{m.months.map(mm => <td key={mm} className="px-3 py-2 text-right tabular-nums text-fg/70">{a.byMonth[mm] ? peso(a.byMonth[mm]) : '-'}</td>)}<td className="px-3 py-2 text-right tabular-nums font-bold text-fg">{peso(a.total)}</td></>
                                    : <><td className="px-3 py-2 text-right tabular-nums font-bold text-fg">{peso(a.total)}</td><td className="px-3 py-2 text-right tabular-nums text-fg/75">{nr ? `${(a.total/nr*100).toFixed(1)}%` : '-'}</td><td className="px-3 py-2 text-right tabular-nums text-fg/75">{parentTotals[a.parentCode] ? `${(a.total/parentTotals[a.parentCode]*100).toFixed(1)}%` : '-'}</td></>}
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-white/10 bg-accent font-black text-on-brand">
                          <td className="px-3 py-3 uppercase text-[10px] tracking-wider">Net Income</td>
                          {pnlmView === 'matrix'
                            ? <>{m.months.map(mm => <td key={mm} className="px-3 py-3 text-right tabular-nums">{peso(m.monthTotals.netIncome[mm])}</td>)}<td className="px-3 py-3 text-right tabular-nums text-white">{peso(m.grandTotals.netIncome)}</td></>
                            : <><td className="px-3 py-3 text-right tabular-nums text-white">{peso(m.grandTotals.netIncome)}</td><td className="px-3 py-3 text-right tabular-nums">{nr ? `${(m.grandTotals.netIncome/nr*100).toFixed(1)}%` : '-'}</td><td className="px-3 py-3"></td></>}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </div>
            );
          })()}

          {/* ===== BALANCE SHEET: one page, two views ===== */}
          {(ledgerSubTab === 'balance' || ledgerSubTab === 'bsmonthly') && (
            <StatementViewSwitch value={ledgerSubTab} onChange={openLedgerPage}
              options={[['balance', 'As of a date'], ['bsmonthly', 'By month']]} />
          )}
          <BalanceSheetTab
            ledgerSubTab={ledgerSubTab} bsData={bsData} reconcileInventory={reconcileInventory} exportBalanceSheetPDF={exportBalanceSheetPDF} fetchBalanceSheet={fetchBalanceSheet} arOutstanding={arOutstanding} />

          {/* ===== MONTHLY BALANCE SHEET (period + matrix, % of assets & % of parent) ===== */}
          {ledgerSubTab === 'bsmonthly' && (() => {
            const SECTIONS = [['assets','Assets'],['liabilities','Liabilities'],['equity','Equity']];
            const b = bsMonthly;
            const peso = (n) => `₱${(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const totalAssets = b?.monthTotals?.assets?.[b?.asOf] || 0;
            const parentTotals = {};
            if (b) [...b.assets, ...b.liabilities, ...b.equity].forEach(a => { parentTotals[a.parentCode] = (parentTotals[a.parentCode] || 0) + a.total; });
            return (
            <div className="space-y-4 animate-fade-in">
              <div className="flex flex-wrap gap-3 items-center">
                <RangePresets value={bsmRange} onChange={r => setBsmRange(p => ({ ...p, ...r }))} onRun={fetchBsMonthly} />
                <input type="date" value={bsmRange.start} onChange={e => setBsmRange(p => ({ ...p, start: e.target.value }))} className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <span className="text-fg/65 font-bold text-sm">→</span>
                <input type="date" value={bsmRange.end} onChange={e => setBsmRange(p => ({ ...p, end: e.target.value }))} className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <button onClick={fetchBsMonthly} className="px-5 py-2 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition">Load</button>
                <div className="flex rounded-xl overflow-hidden border border-white/10">
                  {[['period','As-of'],['matrix','Monthly']].map(([v,lbl]) => (
                    <button key={v} onClick={() => setBsmView(v)} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${bsmView === v ? 'bg-brand text-on-brand' : 'bg-surface text-fg/75 hover:text-fg'}`}>{lbl}</button>
                  ))}
                </div>
                {b && <button onClick={exportBsMonthlyPDF} className="ml-auto bg-white/5 text-fg/70 hover:text-fg hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition flex items-center gap-1.5"><Download size={13}/> PDF</button>}
              </div>
              {!b ? <p className="text-fg/65 text-sm text-center p-6 font-bold">Pick a range and click Load.</p> : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead className="text-white bg-accent text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <tr>
                          <th className="px-3 py-2.5">Account</th>
                          {bsmView === 'matrix'
                            ? b.months.map(mm => <th key={mm} className="px-3 py-2.5 text-right">{mm}</th>)
                            : <><th className="px-3 py-2.5 text-right">As of {b.asOf}</th><th className="px-3 py-2.5 text-right">% Assets</th><th className="px-3 py-2.5 text-right">% Parent</th></>}
                        </tr>
                      </thead>
                      <tbody>
                        {SECTIONS.map(([sec, label]) => (
                          <React.Fragment key={sec}>
                            <tr className="bg-white/[0.03]"><td colSpan={bsmView === 'matrix' ? b.months.length + 1 : 4} className="px-3 py-2 font-black text-brand-text uppercase text-[10px] tracking-wider">{label}</td></tr>
                            {b[sec].map(a => (
                              <tr key={a.code} className="border-b border-white/5 hover:bg-white/[0.02]">
                                <td className="px-3 py-2 text-fg/80 pl-6">{a.code} · {a.name}</td>
                                {bsmView === 'matrix'
                                  ? b.months.map(mm => <td key={mm} className="px-3 py-2 text-right tabular-nums text-fg/70">{a.byMonth[mm] ? peso(a.byMonth[mm]) : '-'}</td>)
                                  : <><td className="px-3 py-2 text-right tabular-nums font-bold text-fg">{peso(a.total)}</td><td className="px-3 py-2 text-right tabular-nums text-fg/75">{totalAssets ? `${(a.total/totalAssets*100).toFixed(1)}%` : '-'}</td><td className="px-3 py-2 text-right tabular-nums text-fg/75">{parentTotals[a.parentCode] ? `${(a.total/parentTotals[a.parentCode]*100).toFixed(1)}%` : '-'}</td></>}
                              </tr>
                            ))}
                            <tr className="border-b border-white/10 font-bold text-fg/90">
                              <td className="px-3 py-2 pl-6 uppercase text-[10px] tracking-wider">Total {label}</td>
                              {bsmView === 'matrix'
                                ? b.months.map(mm => <td key={mm} className="px-3 py-2 text-right tabular-nums">{peso(b.monthTotals[sec][mm])}</td>)
                                : <><td className="px-3 py-2 text-right tabular-nums">{peso(b.monthTotals[sec][b.asOf])}</td><td></td><td></td></>}
                            </tr>
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            );
          })()}

          {/* ===== PRICE CHANGES SUB-TAB ===== */}
          {/* Two halves: what is waiting on someone (the approval queue), and
              what has already been applied across the whole catalogue. The
              per-product view lives behind Pricing Control's History button;
              this is the "what did anyone change last month" view. */}
          <PriceLogTab
            ledgerSubTab={ledgerSubTab} changeRequests={changeRequests} canApprovePricing={canApprovePricing} CR_ENTITY={CR_ENTITY} crValue={crValue} MONEY_FIELDS={MONEY_FIELDS}
            actOnChangeRequest={actOnChangeRequest} priceLogRange={priceLogRange} setPriceLogRange={setPriceLogRange} fetchPriceChangeLog={fetchPriceChangeLog} priceChangeLog={priceChangeLog} />

          {/* ===== A/R REPORT SUB-TAB ===== */}
          {/* The printable receivables schedule: one line per open invoice.
              Read as-of a date, so re-running last month's report reproduces
              last month's numbers instead of restating them with collections
              that have happened since. */}
          <ReceivablesReportTab
            ledgerSubTab={ledgerSubTab} arReportAsOf={arReportAsOf} setArReportAsOf={setArReportAsOf} fetchArReport={fetchArReport} arReport={arReport} />

          {/* ===== COLLECTIONS SUB-TAB ===== */}
          {/* Two halves of one question. The check register is what has been
              taken in but is not yet money; the collection report is what
              actually came in over a period. */}
          <CollectionsTab
            ledgerSubTab={ledgerSubTab} checkFilter={checkFilter} setCheckFilter={setCheckFilter} fetchChecks={fetchChecks} checkRegister={checkRegister} actOnCheck={actOnCheck}
            collRange={collRange} setCollRange={setCollRange} fetchCollectionReport={fetchCollectionReport} collectionReport={collectionReport} />

          {/* ===== A/P REPORT SUB-TAB ===== */}
          {/* The mirror of the A/R report. Aged on the DUE date, not the bill
              date: nobody cares how long ago a bill was raised, only how far
              past its payment date it is. */}
          <PayablesReportTab
            ledgerSubTab={ledgerSubTab} apReportAsOf={apReportAsOf} setApReportAsOf={setApReportAsOf} fetchApReport={fetchApReport} apReport={apReport} />

          {/* ===== SUPPLIER PAYMENTS SUB-TAB ===== */}
          {/* The exact counterpart of the collection report: that one is what
              came in, this is what went out. */}
          <SupplierPaymentsTab
            ledgerSubTab={ledgerSubTab} supPayRange={supPayRange} setSupPayRange={setSupPayRange} fetchSupplierPayments={fetchSupplierPayments} supplierPayments={supplierPayments} />

          {/* ===== CHECK VOUCHERS SUB-TAB ===== */}
          {/* The disbursement paper trail. Vouchers are raised automatically by
              a bill payment or a client-credit refund - none are created by hand
              here, so this is read + void only. Voiding marks the voucher and
              nothing else: the journal entry stays posted and the bill stays
              paid, because a real check may already be in someone's hands. */}
          <CheckVouchersTab
            ledgerSubTab={ledgerSubTab} peso={peso} cvTotal={cvTotal} cvFilter={cvFilter} setCvFilter={setCvFilter} fetchCheckVouchers={fetchCheckVouchers}
            exportCvPDF={exportCvPDF} exportCvExcel={exportCvExcel} can={can} cvNewOpen={cvNewOpen} setCvNewOpen={setCvNewOpen} coaAccounts={coaAccounts}
            fetchCoa={fetchCoa} apiFetch={apiFetch} cashAndBankAccounts={cashAndBankAccounts} fetchERPData={fetchERPData} checkVouchers={checkVouchers} setCvDocs={setCvDocs}
            printCheckVoucher={printCheckVoucher} setCvVoidModal={setCvVoidModal} cvDocs={cvDocs} activeAdmin={activeAdmin} isSuperAdmin={isSuperAdmin} cvVoidModal={cvVoidModal}
            submitVoidVoucher={submitVoidVoucher} />

          {/* ===== ADVANCES SUB-TAB ===== */}
          <AdvancesTab
            ledgerSubTab={ledgerSubTab} setAdvIssueModal={setAdvIssueModal} ADV_ISSUE_BLANK={ADV_ISSUE_BLANK} peso={peso} advTotals={advTotals} advFilter={advFilter}
            setAdvFilter={setAdvFilter} fetchAdvances={fetchAdvances} advances={advances} openAdvLiquidate={openAdvLiquidate} setAdvCancelModal={setAdvCancelModal} advIssueModal={advIssueModal}
            suppliers={suppliers} fetchSuppliers={fetchSuppliers} clientAccounts={clientAccounts} cashAndBankAccounts={cashAndBankAccounts} advBusy={advBusy} submitIssueAdvance={submitIssueAdvance}
            advLiqModal={advLiqModal} setAdvLiqModal={setAdvLiqModal} expenseAccounts={expenseAccounts} bills={bills} arOutstanding={arOutstanding} submitLiquidateAdvance={submitLiquidateAdvance}
            advCancelModal={advCancelModal} submitCancelAdvance={submitCancelAdvance} />

          {/* ===== A/R OUTSTANDING SUB-TAB ===== */}
          <ReceivablesTab
            ledgerSubTab={ledgerSubTab} arOutstanding={arOutstanding} exportArPDF={exportArPDF} agingBuckets={agingBuckets} arAgeing={arAgeing} can={can}
            apiFetch={apiFetch} fetchArOutstanding={fetchArOutstanding} fetchArAgeing={fetchArAgeing} fetchERPData={fetchERPData} arPage={arPage} openArHistory={openArHistory}
            setSettleModal={setSettleModal} setSettleForm={setSettleForm} todayLocal={todayLocal} openClientCredit={openClientCredit} clientCreditModal={clientCreditModal} setClientCreditModal={setClientCreditModal}
            peso={peso} submitClientCredit={submitClientCredit} />

          {/* ===== ACCOUNTS PAYABLE SUB-TAB ===== */}
          <PayablesTab
            ledgerSubTab={ledgerSubTab} apData={apData} exportApPDF={exportApPDF} setApPayModal={setApPayModal} apPayModal={apPayModal} apPayForm={apPayForm}
            setApPayForm={setApPayForm} cashAndBankAccounts={cashAndBankAccounts} suppliers={suppliers} submitApPayment={submitApPayment} apPaySubmitting={apPaySubmitting} apCreditEntries={apCreditEntries}
            agingBuckets={agingBuckets} apPage={apPage} />

          {/* ===== SALES BY PAYMENT METHOD ===== */}
          {ledgerSubTab === 'payments' && (
            <div className="space-y-4 animate-fade-in">
              {/* Date range picker */}
              <div className="flex flex-wrap gap-3 items-center">
                <RangePresets value={sbpRange} onChange={r => setSbpRange(p => ({ ...p, ...r }))} onRun={fetchSalesByPayment} />
                <input type="date" value={sbpRange.start} onChange={e => setSbpRange(p=>({...p,start:e.target.value}))}
                  className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <span className="text-fg/65 font-bold text-sm">→</span>
                <input type="date" value={sbpRange.end} onChange={e => setSbpRange(p=>({...p,end:e.target.value}))}
                  className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                {salesSourceSelect(fetchSalesByPayment)}
                <button onClick={fetchSalesByPayment} className="px-5 py-2 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition">Load</button>
                {salesByPayment && <button onClick={exportPaymentsPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
              </div>
              {!salesByPayment ? (
                <p className="text-fg/65 text-sm text-center p-6 font-bold">Select a date range and click Load.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-surface border border-white/10 rounded-xl p-5">
                      <p className="text-[10px] text-fg/65 font-bold uppercase">Total Revenue</p>
                      <p className="text-2xl font-black text-brand-text tabular-nums">₱{(salesByPayment.grandTotal||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</p>
                    </div>
                    <div className="bg-surface border border-white/10 rounded-xl p-5">
                      <p className="text-[10px] text-fg/65 font-bold uppercase">Payment Channels</p>
                      <p className="text-2xl font-black text-fg">{(salesByPayment.breakdown||[]).length}</p>
                    </div>
                  </div>
                  <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[400px]">
                      <thead className="text-white bg-accent text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <tr>
                          <th className="px-5 py-3">Payment Method</th>
                          <th className="px-5 py-3 text-right">Orders</th>
                          <th className="px-5 py-3 text-right">Amount</th>
                          <th className="px-5 py-3 text-right">% Share</th>
                          <th className="px-5 py-3">Bar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sbpPage.pageItems.map((r,i) => (
                          <tr key={r.method||i} className={`border-b border-white/5 ${i%2===0?'':'bg-white/[0.015]'}`}>
                            <td className="px-5 py-3 font-bold text-fg">{r.method||'Unknown'}</td>
                            <td className="px-5 py-3 text-right text-fg/70 tabular-nums">{r.count}</td>
                            <td className="px-5 py-3 text-right font-black text-brand-text tabular-nums">₱{(r.total||0).toFixed(2)}</td>
                            <td className="px-5 py-3 text-right text-fg/75 tabular-nums">{(r.pct||0).toFixed(1)}%</td>
                            <td className="px-5 py-3 w-32">
                              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-brand rounded-full" style={{width:`${Math.min(100,r.pct||0)}%`}} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pager {...sbpPage} label="methods" />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== PROFIT BY CATEGORY ===== */}
          {ledgerSubTab === 'profitcat' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-end gap-2">
                {profitByCategory && <button onClick={exportProfitByCategoryPDF} className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                <button onClick={fetchProfitByCategory} className="flex items-center gap-2 px-5 py-2.5 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition">
                  <RefreshCw size={14}/> Refresh
                </button>
              </div>
              {!profitByCategory ? (
                <p className="text-fg/65 text-sm text-center p-6 font-bold">Click Refresh to compute gross profit by menu category.</p>
              ) : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[500px]">
                    <thead className="text-white bg-accent text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3 text-right">Revenue</th>
                        <th className="px-5 py-3 text-right">Est. COGS</th>
                        <th className="px-5 py-3 text-right">Gross Profit</th>
                        <th className="px-5 py-3 text-right">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pbcPage.pageItems.map((c,i) => (
                        <tr key={c.category||i} className={`border-b border-white/5 ${i%2===0?'':'bg-white/[0.015]'}`}>
                          <td className="px-5 py-3 font-bold text-fg">{c.category}</td>
                          <td className="px-5 py-3 text-right text-fg/80 tabular-nums font-mono">₱{c.revenue.toFixed(2)}</td>
                          <td className="px-5 py-3 text-right text-caution tabular-nums font-mono">₱{c.estimatedCOGS.toFixed(2)}</td>
                          <td className="px-5 py-3 text-right font-black tabular-nums font-mono text-success">₱{c.grossProfit.toFixed(2)}</td>
                          <td className="px-5 py-3 text-right">
                            <span className={`font-black text-sm ${c.margin>=60?'text-success':c.margin>=35?'text-warning':'text-danger'}`}>
                              {c.margin.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...pbcPage} label="categories" /></div>
                  <p className="text-[10px] text-fg/65 p-3 text-center">
                    COGS is estimated using <span className="text-fg/80 font-bold">today's</span> ingredient costs, not the cost at the time each sale happened - a negative
                    margin here usually means a recipe's ingredient cost has risen since past sales, or a recipe cost was only just set. That's why this can
                    disagree with Pricing Control, which compares today's price against today's cost. Items without a recipe show ₱0 COGS.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ===== MENU ENGINEERING ===== */}
          {ledgerSubTab === 'menueng' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-between items-center">
                <p className="text-xs text-fg/65">Stars (sell + profit), Plowhorses (sell, low margin), Puzzles (high margin, low sell), Dogs (neither).</p>
                <div className="flex gap-2">
                  {menuEngineering && <button onClick={exportMenuEngineeringPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                  <button onClick={fetchMenuEngineering} className="flex items-center gap-2 px-4 py-2 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
                </div>
              </div>
              {!menuEngineering ? (
                <p className="text-fg/65 text-sm text-center p-6 font-bold">Click Refresh to analyse {BUSINESS_TYPE === 'log' ? 'the products' : 'the menu'}.</p>
              ) : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[520px]">
                    <thead className="text-white bg-accent text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr><th className="px-5 py-3">Item</th><th className="px-5 py-3 text-right">Qty</th><th className="px-5 py-3 text-right">Revenue</th><th className="px-5 py-3 text-right">Margin</th><th className="px-5 py-3 text-center">Class</th></tr>
                    </thead>
                    <tbody>
                      {mePage.pageItems.map((r,i) => {
                        const cls = { Star:'bg-green-500/20 text-success', Plowhorse:'bg-yellow-500/20 text-warning', Puzzle:'bg-blue-500/20 text-info', Dog:'bg-red-500/20 text-danger' }[r.quadrant];
                        return (
                          <tr key={i} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                            <td className="px-5 py-2.5 font-bold text-fg">{r.name}</td>
                            <td className="px-5 py-2.5 text-right text-fg/70 tabular-nums">{r.qty}</td>
                            <td className="px-5 py-2.5 text-right text-brand-text font-black tabular-nums">₱{r.revenue.toFixed(2)}</td>
                            <td className="px-5 py-2.5 text-right tabular-nums font-bold text-fg/70">{r.margin.toFixed(1)}%</td>
                            <td className="px-5 py-2.5 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${cls}`}>{r.quadrant}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...mePage} label="items" /></div>
                </div>
              )}
            </div>
          )}

          {/* ===== CASHIER VARIANCE ===== */}
          {ledgerSubTab === 'variance' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-between items-center">
                <p className="text-xs text-fg/65">Average cash drawer variance per cashier across closed shifts. Negative = consistently short.</p>
                <div className="flex gap-2">
                  {cashierVariance && <button onClick={exportVariancePDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                  <button onClick={fetchCashierVariance} className="flex items-center gap-2 px-4 py-2 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
                </div>
              </div>
              {!cashierVariance ? (
                <p className="text-fg/65 text-sm text-center p-6 font-bold">Click Refresh to load cashier variance.</p>
              ) : (cashierVariance.cashiers||[]).length === 0 ? (
                <p className="text-fg/65 text-sm text-center p-6 font-bold">No closed shifts with variance data yet.</p>
              ) : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[480px]">
                    <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr><th className="px-5 py-3">Cashier</th><th className="px-5 py-3 text-right">Shifts</th><th className="px-5 py-3 text-right">Avg Variance</th><th className="px-5 py-3 text-right">Times Short</th><th className="px-5 py-3 text-right">Worst</th></tr>
                    </thead>
                    <tbody>
                      {cvPage.pageItems.map((c,i) => (
                        <tr key={i} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                          <td className="px-5 py-2.5 font-bold text-fg">{c.cashierName}</td>
                          <td className="px-5 py-2.5 text-right text-fg/70 tabular-nums">{c.shifts}</td>
                          <td className={`px-5 py-2.5 text-right tabular-nums font-black ${c.avgVariance < 0 ? 'text-danger' : 'text-success'}`}>{c.avgVariance >= 0 ? '+' : ''}₱{c.avgVariance.toFixed(2)}</td>
                          <td className="px-5 py-2.5 text-right text-fg/70 tabular-nums">{c.shortCount}</td>
                          <td className="px-5 py-2.5 text-right text-danger tabular-nums">₱{(c.worstShort||0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...cvPage} label="cashiers" /></div>
                </div>
              )}
            </div>
          )}

          {ledgerSubTab === 'cashflow' && <CashFlowReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'saleschannel' && <SalesByChannelReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'salescustomer' && <SalesByCustomerReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'budget' && <BudgetReport apiFetch={apiFetch} can={can} />}
          {ledgerSubTab === 'exceptions' && <ExceptionsReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'waste' && <WasteReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'saleshours' && <SalesByHourReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'cashierperf' && <CashierPerformanceReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'cashforecast' && <CashForecastReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'supplierprices' && <SupplierPricesReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'salestargets' && <SalesTargetsReport apiFetch={apiFetch} can={can} />}
          {ledgerSubTab === 'deliverysheet' && <DeliverySheetReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'supplierstatement' && <SupplierStatementReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'preplist' && <PrepListReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'feedback' && <FeedbackReport apiFetch={apiFetch} />}
          {ledgerSubTab === 'closing' && <ClosingChecklist apiFetch={apiFetch} can={can} />}

          {/* ===== COMMISSIONS ===== */}
          {ledgerSubTab === 'commissions' && (
            <div className="space-y-4 animate-fade-in">
              <CommissionRules apiFetch={apiFetch} canEdit={isSuperAdmin || can('users.manage')} onSaved={fetchCommissions} />
              <div className="flex justify-between items-center">
                <p className="text-xs text-fg/65">Sales by seller, at the rates below and each person's own % (on their account). Complimentary and unattributed sales earn no commission.</p>
                <div className="flex gap-2">
                  {commissions && <button onClick={exportCommissionsPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                  <button onClick={fetchCommissions} className="flex items-center gap-2 px-4 py-2 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
                </div>
              </div>
              {!commissions ? (
                <p className="text-fg/65 text-sm text-center p-6 font-bold">Click Refresh to compute commissions.</p>
              ) : (commissions.sellers||[]).length === 0 ? (
                <p className="text-fg/65 text-sm text-center p-6 font-bold">No attributed sales yet.</p>
              ) : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[520px]">
                    <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr><th className="px-5 py-3">Cashier</th><th className="px-5 py-3 text-right">Orders</th><th className="px-5 py-3 text-right">Sales</th><th className="px-5 py-3 text-right">Own rate</th><th className="px-5 py-3 text-right">Effective</th><th className="px-5 py-3 text-right">Commission</th></tr>
                    </thead>
                    <tbody>
                      {cmPage.pageItems.map((c,i) => (
                        <tr key={c.userCode||i} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                          <td className="px-5 py-2.5 font-bold text-fg">{c.name}</td>
                          <td className="px-5 py-2.5 text-right text-fg/70 tabular-nums">{c.orderCount}</td>
                          <td className="px-5 py-2.5 text-right text-fg/80 tabular-nums font-mono">₱{c.salesTotal.toFixed(2)}</td>
                          <td className="px-5 py-2.5 text-right text-fg/75 tabular-nums">{c.rateSource === 'tiers' ? 'Tiers' : `${c.commissionRate}%`}</td>
                          <td className="px-5 py-2.5 text-right text-fg/75 tabular-nums">{c.effectiveRate ?? c.commissionRate}%</td>
                          <td className="px-5 py-2.5 text-right font-black tabular-nums font-mono text-success">₱{c.commissionEarned.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-white/10">
                        <td colSpan={5} className="px-5 py-3 text-right font-bold text-fg/65 uppercase text-[10px] tracking-wider">Total</td>
                        <td className="px-5 py-3 text-right font-black tabular-nums font-mono text-success">₱{(commissions.totalCommission||0).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  <div className="px-3"><Pager {...cmPage} label="sellers" /></div>
                  <p className="text-[10px] text-fg/65 p-3 text-center">A person's own rate is on their account (Admin Panel), or set it for everyone above. Effective is what all the rates came to on their sales.</p>
                </div>
              )}
            </div>
          )}

          {/* ===== BILLS (AP approval workflow) ===== */}
          {ledgerSubTab === 'bills' && (
            <div className="space-y-4 animate-fade-in">
              <RecurringBills apiFetch={apiFetch} suppliers={suppliers || []} accounts={coaAccounts || []}
                canManage={can('accounting.manage')} onRaised={() => fetchBills()} />
              <div className="flex justify-between items-center flex-wrap gap-2">
                <div className="flex gap-1.5 flex-wrap">
                  {['Pending','Approved','Paid','Rejected','All'].map(s => (
                    <button key={s}
                      onClick={() => { setBillsFilter(s); fetchBills(s); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${billsFilter === s ? 'bg-brand text-on-brand' : 'bg-white/5 text-fg/75 hover:text-fg'}`}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setBillCreate(c => ({ ...c, open: !c.open }))} className="flex items-center gap-2 px-4 py-2 bg-white/5 text-fg/70 rounded-xl font-bold text-sm hover:bg-white/10 transition"><Plus size={14}/> Manual bill</button>
                  {bills && bills.length > 0 && <button onClick={exportBillsPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                  <button onClick={() => fetchBills()} className="flex items-center gap-2 px-4 py-2 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
                </div>
              </div>

              {billCreate.open && (
                <div className="bg-surface border border-white/10 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-fg/75">A manual bill (rent, utilities, one-off supplier charge) - it books nothing until you Approve it, which posts DR expense / CR Accounts Payable.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1">Supplier</label>
                      <SearchSelect value={billCreate.supplierId} onChange={e => setBillCreate(c => ({ ...c, supplierId: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand"
                        placeholder="Type to find a supplier"
                        options={(suppliers || []).map(s => ({ value: s._id, label: s.name }))} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1">Expense account (debited on approval)</label>
                      <select value={billCreate.expenseAccountCode} onChange={e => setBillCreate(c => ({ ...c, expenseAccountCode: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg">
                        {(expenseAccounts||[]).map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1">Amount (₱)</label>
                      <input type="number" min="0" step="0.01" value={billCreate.amount} onChange={e => setBillCreate(c => ({ ...c, amount: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1">Due date (optional)</label>
                      <input type="date" value={billCreate.dueDate} onChange={e => setBillCreate(c => ({ ...c, dueDate: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1">Supplier invoice no. (optional)</label>
                      <input value={billCreate.supplierInvoiceNo || ''} onChange={e => setBillCreate(c => ({ ...c, supplierInvoiceNo: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg" placeholder="e.g. INV-88120" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1">Description</label>
                      <input value={billCreate.description} onChange={e => setBillCreate(c => ({ ...c, description: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg" placeholder="e.g. October warehouse rent" />
                    </div>
                    {systemSettings.vatEnabled === true && (
                      <div className="sm:col-span-2">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input type="checkbox" checked={billCreate.claimInputVat === true}
                            onChange={e => setBillCreate(c => ({ ...c, claimInputVat: e.target.checked }))}
                            className="mt-0.5 accent-brand" />
                          <span>
                            <span className="text-[11px] text-fg font-bold block">Supplier charged VAT (claim input VAT)</span>
                            <span className="text-[10px] text-fg/65 leading-snug block">Splits the VAT out of this amount into Input VAT (Creditable) when the bill is approved. Tick only for a VAT-registered supplier with an official receipt.</span>
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button onClick={submitCreateBill} disabled={billBusy} className="px-5 py-2 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition disabled:opacity-50">{billBusy ? 'Saving…' : 'Create bill'}</button>
                  </div>
                </div>
              )}

              {!bills ? (
                <p className="text-fg/65 text-sm text-center p-6 font-bold">Loading bills…</p>
              ) : bills.length === 0 ? (
                <p className="text-fg/65 text-sm text-center p-6 font-bold">No {billsFilter !== 'All' ? billsFilter.toLowerCase() : ''} bills.</p>
              ) : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[720px]">
                    <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr>
                        <th className="px-4 py-3">Bill #</th><th className="px-4 py-3">Supplier</th>
                        <th className="px-4 py-3">Source</th><th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Invoice match</th><th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billsPage.pageItems.map((b, i) => {
                        const stCls = { Pending:'bg-yellow-500/20 text-warning', Approved:'bg-blue-500/20 text-info', 'Partially Paid':'bg-orange-500/20 text-warning', Paid:'bg-green-500/20 text-success', Rejected:'bg-red-500/20 text-danger' }[b.status] || 'bg-white/10 text-fg/75';
                        const billOutstanding = +(b.amount - (b.paidAmount || 0)).toFixed(2);
                        return (
                          <tr key={b._id} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                            <td className="px-4 py-3 font-mono text-fg/70">{b.billNumber}</td>
                            <td className="px-4 py-3 font-bold text-fg">{b.supplierName || '-'}</td>
                            <td className="px-4 py-3"><span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-fg/75 font-bold">{b.source}</span></td>
                            <td className="px-4 py-3 text-fg/65 max-w-[220px]">
                              <span className="block truncate" title={b.description || ''}>{b.description || '-'}</span>
                              {billPoEdit?.id === b._id ? (
                                <form className="flex gap-1 mt-1" onSubmit={e => { e.preventDefault(); saveBillPo(); }}>
                                  <input autoFocus value={billPoEdit.value} onChange={e => setBillPoEdit({ id: b._id, value: e.target.value })}
                                    placeholder="PO number" aria-label="PO number" maxLength={60}
                                    className="w-28 bg-page-bg border border-white/20 rounded-lg px-2 py-1 text-fg text-[11px]" />
                                  <button type="submit" className="px-2 rounded-lg bg-brand text-on-brand text-[11px] font-bold">Save</button>
                                  <button type="button" onClick={() => setBillPoEdit(null)} className="px-2 rounded-lg bg-white/5 text-fg/80 text-[11px] font-bold">Cancel</button>
                                </form>
                              ) : (
                                <span className="block text-[11px] mt-0.5">
                                  {b.poNumber && <span className="font-mono text-fg/80" title={b.purchaseOrderId ? 'Linked to this purchase order in Procurement' : 'A reference only - no purchase order with this number in the app'}>PO: {b.poNumber}{b.purchaseOrderId ? ' (linked) ' : ' '}</span>}
                                  {b.source !== 'PO' && (b.imported || b.source === 'Opening') && can('accounting.manage') && (
                                    <button onClick={() => setBillPoEdit({ id: b._id, value: b.poNumber || '' })} className="text-brand-text font-bold hover:underline">{b.poNumber ? 'Change' : '+ Add PO no.'}</button>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-black tabular-nums font-mono text-fg">
                              {peso(b.amount)}
                              {b.status === 'Partially Paid' && <div className="text-[10px] font-normal text-warning mt-0.5">{peso(billOutstanding)} left</div>}
                            </td>
                            <td className="px-4 py-3">
                              {(() => {
                                const ms = b.match?.status || (b.source === 'PO' ? 'Unmatched' : null);
                                if (!ms) return <span className="text-[10px] text-fg/65">{b.supplierInvoiceNo || '-'}</span>;
                                const cls = { Matched: 'bg-green-500/15 text-success', Accepted: 'bg-blue-500/15 text-info', Exception: 'bg-red-500/15 text-danger', Unmatched: 'bg-white/5 text-fg/70' }[ms];
                                return (
                                  <div title={(b.match?.issues || []).map(x => x.text).join(' ') || undefined}>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${cls}`}>{ms === 'Unmatched' ? 'Needs invoice' : ms}</span>
                                    {b.supplierInvoiceNo && <div className="text-[10px] text-fg/65 mt-1 font-mono">{b.supplierInvoiceNo}</div>}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${stCls}`}>{b.status}</span>
                              {b.scheduledPaymentDate && b.status === 'Approved' && <div className="text-[10px] text-fg/70 mt-1">pay {String(b.scheduledPaymentDate).slice(0,10)}</div>}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {b.status === 'Pending' && (
                                <div className="flex gap-1.5 justify-end">
                                  <button disabled={billBusy} onClick={() => openBillInvoice(b)} className="px-2.5 py-1 rounded-lg bg-white/5 text-fg/80 hover:bg-white/10 text-[11px] font-bold transition disabled:opacity-50">{b.supplierInvoiceNo ? 'Invoice' : 'Record invoice'}</button>
                                  <button disabled={billBusy} onClick={() => approveBill(b)} className="px-2.5 py-1 rounded-lg bg-green-500/15 text-success hover:bg-green-500/25 text-[11px] font-bold transition disabled:opacity-50">Approve</button>
                                  <button disabled={billBusy} onClick={() => rejectBill(b)} className="px-2.5 py-1 rounded-lg bg-red-500/10 text-danger hover:bg-red-500/20 text-[11px] font-bold transition disabled:opacity-50">Reject</button>
                                </div>
                              )}
                              {(b.status === 'Approved' || b.status === 'Partially Paid') && (
                                <div className="flex gap-1.5 justify-end">
                                  {b.status === 'Approved' && <button disabled={billBusy} onClick={() => scheduleBill(b)} className="px-2.5 py-1 rounded-lg bg-white/5 text-fg/65 hover:bg-white/10 text-[11px] font-bold transition disabled:opacity-50">Schedule</button>}
                                  <button disabled={billBusy} onClick={() => { setBillPayModal(b); setBillPayFrom('111000'); setBillPayReference(''); setBillPayAmount(String(billOutstanding)); }} className="px-2.5 py-1 rounded-lg bg-brand/20 text-brand-text hover:bg-brand/30 text-[11px] font-bold transition disabled:opacity-50">Pay</button>
                                </div>
                              )}
                              {(b.status === 'Paid' || b.status === 'Rejected') && (
                                <span className="text-[10px] text-fg/65">{b.journalEntryRef || (b.rejectionReason ? 'rejected' : '-')}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...billsPage} label="bills" /></div>
                  <p className="text-[10px] text-fg/65 p-3 text-center">PO-sourced bills already posted their liability at goods receipt - approving one is a sign-off, not a new posting. Manual bills post on approval.</p>
                </div>
              )}

              {/* Pay modal */}
              {billInvoiceModal && (
                <div className="fixed inset-0 z-50 flex justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => setBillInvoiceModal(null)}>
                  <div role="dialog" aria-label="Supplier invoice" className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6 my-auto" onClick={e => e.stopPropagation()}>
                    <h2 className="font-black text-fg mb-1">Supplier invoice - {billInvoiceModal.billNumber}</h2>
                    <p className="text-fg/75 text-sm mb-3">{billInvoiceModal.supplierName} · received {peso(billInvoiceModal.amount)}{billInvoiceModal.poNumber ? ` on ${billInvoiceModal.poNumber}` : ''}</p>
                    <p className="text-[11px] text-fg/70 mb-3">{billInvoiceModal.source === 'PO' ? 'Compared with the PO price of what arrived and with what receiving booked. It must match (within ₱1) before this bill can be approved.' : 'Compared with this bill\'s amount.'}</p>
                    <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5">Invoice number</label>
                    <input value={billInvoiceForm.no} onChange={e => setBillInvoiceForm(f => ({ ...f, no: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-3" placeholder="As printed on the invoice" />
                    <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5">Invoice total</label>
                    <input type="number" min="0" step="0.01" value={billInvoiceForm.amount} onChange={e => setBillInvoiceForm(f => ({ ...f, amount: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-3" />
                    <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5">Invoice date (optional)</label>
                    <input type="date" value={billInvoiceForm.date} onChange={e => setBillInvoiceForm(f => ({ ...f, date: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-1" />
                    <Attachments entity="Bill" entityId={billInvoiceModal._id} apiFetch={apiFetch} canAttach={can('accounting.manage')}
                      currentUserId={activeAdmin?._id} isSuperAdmin={isSuperAdmin} title="Invoice & delivery documents" />
                    <div className="mb-4" />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setBillInvoiceModal(null)} className="px-4 py-2 rounded-xl bg-white/5 text-fg/80 text-sm font-bold">Cancel</button>
                      <button onClick={submitBillInvoice} disabled={billBusy} className="px-4 py-2 rounded-xl bg-brand text-on-brand text-sm font-bold disabled:opacity-50">{billBusy ? 'Checking…' : 'Record & match'}</button>
                    </div>
                  </div>
                </div>
              )}

              {billPayModal && (() => {
                const outstanding = +(billPayModal.amount - (billPayModal.paidAmount || 0)).toFixed(2);
                const enteredAmt = parseFloat(billPayAmount) || 0;
                const willOverpay = enteredAmt > outstanding + 0.01;
                const supplier = (suppliers || []).find(s => String(s._id) === String(billPayModal.supplierId));
                const availableCredit = supplier?.creditBalance || 0;
                return (
                <div className="fixed inset-0 z-50 flex justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => setBillPayModal(null)}>
                  <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6 my-auto" onClick={e => e.stopPropagation()}>
                    <h2 className="font-black text-fg mb-1">Pay bill {billPayModal.billNumber}</h2>
                    <p className="text-fg/75 text-sm mb-1">{billPayModal.supplierName} · {peso(billPayModal.amount)} total</p>
                    {billPayModal.paidAmount > 0 && <p className="text-warning text-xs mb-2">{peso(billPayModal.paidAmount)} already paid · {peso(outstanding)} remaining</p>}

                    {availableCredit > 0 && (
                      <div className="bg-brand/10 border border-brand/20 rounded-lg px-3 py-2 mb-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-fg/70">Supplier has <span className="text-brand-text font-bold">{peso(availableCredit)}</span> credit available</span>
                        <button
                          onClick={async () => { const ok = await applySupplierCredit(billPayModal.supplierId, billPayModal._id, Math.min(availableCredit, outstanding), billPayReference); if (ok) setBillPayModal(null); }}
                          disabled={billBusy}
                          className="shrink-0 bg-brand/20 hover:bg-brand/30 text-brand-text text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition disabled:opacity-50"
                        >Apply Credit</button>
                      </div>
                    )}

                    <p className="text-[11px] text-fg/70 mb-3">Posts DR Accounts Payable / CR the account you pay from.</p>
                    <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5">Amount</label>
                    <input type="number" min="0" step="0.01" value={billPayAmount} onChange={e => setBillPayAmount(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-1" />
                    {willOverpay && (
                      <p className="text-[10px] text-warning mb-2">
                        Exceeds the {peso(outstanding)} owed - the extra {peso(+(enteredAmt - outstanding).toFixed(2))} becomes this supplier's credit balance, applicable to a future bill.
                      </p>
                    )}
                    <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5 mt-2">Pay from</label>
                    <select value={billPayFrom} onChange={e => setBillPayFrom(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-3">
                      {(cashAndBankAccounts||[]).map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                    </select>
                    <label className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5">Reference No. (optional)</label>
                    <input type="text" placeholder="Bank txn ID, check no., GCash ref..." value={billPayReference} onChange={e => setBillPayReference(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-5" />
                    <div className="flex gap-3">
                      <button onClick={() => setBillPayModal(null)} className="flex-1 bg-white/5 hover:bg-white/10 text-fg/75 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">Cancel</button>
                      <button onClick={submitBillPay} disabled={billBusy} className="flex-1 bg-brand hover:bg-brand-dark text-on-brand font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50">{billBusy ? 'Recording…' : 'Record payment'}</button>
                    </div>
                  </div>
                </div>
                );
              })()}
            </div>
          )}

          {/* ===== PURCHASE ORDER SUGGESTION ===== */}

          {/* ===== REVOLVING FUNDS SUB-TAB ===== */}
          {ledgerSubTab === 'expenses' && <ExpensesPage />}

          {/* ===== APPROVALS SUB-TAB (Requisition Slips) ===== */}
          {soloApprovals && ledgerSubTab === 'approvals' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-xl font-black text-fg flex items-center gap-2"><ShieldCheck size={18} className="text-brand-text"/> Approvals</h3>
                  <p className="text-fg/70 text-xs font-bold uppercase tracking-widest mt-1">Requisition slips and revolving fund spends wait here until approved</p>
                </div>
                <div className="flex bg-page-bg p-1 rounded-lg shadow-inner">
                  <button onClick={() => { setReqSlipView('pending'); fetchRequisitionSlips('Pending'); }}
                    className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition ${reqSlipView === 'pending' ? 'bg-brand text-on-brand shadow-md' : 'text-fg/70 hover:text-fg'}`}>
                    Pending
                  </button>
                  <button onClick={() => { setReqSlipView('all'); fetchRequisitionSlips(''); }}
                    className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition ${reqSlipView === 'all' ? 'bg-brand text-on-brand shadow-md' : 'text-fg/70 hover:text-fg'}`}>
                    Slips
                  </button>
                </div>
                <button onClick={exportRequisitionSlipsPDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition min-h-[44px]">
                  Export PDF
                </button>
              </div>

              {can('accounting.view') && <FundSpendsToCheck apiFetch={apiFetch} onChanged={fetchERPData} />}

              <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
                {reqSlipsLoading && reqSlips.length === 0 ? (
                  <p className="text-fg/70 text-sm p-8 text-center font-bold">Loading…</p>
                ) : reqSlips.length === 0 ? (
                  <p className="text-fg/65 text-sm p-10 text-center font-bold">
                    {reqSlipView === 'pending' ? 'Nothing waiting on approval.' : 'No requisition slips yet.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[720px]">
                      <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <tr>
                          <th className="px-5 py-2.5">Slip #</th>
                          <th className="px-5 py-2.5">Type</th>
                          <th className="px-5 py-2.5">Summary</th>
                          <th className="px-5 py-2.5">Prepared By</th>
                          <th className="px-5 py-2.5">Status</th>
                          <th className="px-5 py-2.5 text-right">Amount</th>
                          <th className="px-5 py-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reqSlips.map((s, i) => (
                          <tr key={s._id} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                            <td className="px-5 py-2.5 font-mono text-fg/70 whitespace-nowrap">
                              <button onClick={() => setReqSlipPreview(s)} className="hover:text-brand-text hover:underline">{s.slipNumber}</button>
                            </td>
                            <td className="px-5 py-2.5 text-fg/65 whitespace-nowrap">{reqTypeLabel(s.type)}</td>
                            <td className="px-5 py-2.5 text-fg/70 truncate max-w-[260px]">{(s.budgetCheck || []).some(c => c.over) && <span className="mr-1.5 px-1.5 py-0.5 rounded bg-red-500/15 text-danger text-[9px] font-black uppercase" title={s.overBudgetReason ? `Accepted by ${s.overBudgetAcceptedBy}: ${s.overBudgetReason}` : "Over this month's budget"}>Over budget</span>}{reqSummary(s)}</td>
                            <td className="px-5 py-2.5 text-fg/65 whitespace-nowrap">{s.preparedBy || '-'}</td>
                            <td className="px-5 py-2.5">
                              <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full ${s.status === 'Pending' ? 'bg-amber-500/20 text-warning' : s.status === 'Approved' ? 'bg-brand/20 text-brand-text' : 'bg-red-500/20 text-danger'}`}>{s.status}</span>
                            </td>
                            <td className="px-5 py-2.5 text-right font-mono tabular-nums font-bold text-fg">{reqAmount(s) === null ? 'To full' : peso(reqAmount(s))}</td>
                            <td className="px-5 py-2.5 text-right whitespace-nowrap">
                              {s.status === 'Pending' && can('requisitions.approve') ? (
                                <div className="flex items-center justify-end gap-3">
                                  <button onClick={() => approveReqSlip(s)} disabled={reqSlipBusy} className="text-[10px] font-black uppercase tracking-wider text-brand-text hover:underline disabled:opacity-40">Approve</button>
                                  <button onClick={() => { setReqSlipRejecting(s); setReqSlipRejectReason(''); }} disabled={reqSlipBusy} className="text-[10px] font-black uppercase tracking-wider text-danger hover:underline disabled:opacity-40">Reject</button>
                                </div>
                              ) : s.status === 'Pending' ? (
                                <span className="text-[10px] font-black uppercase tracking-wider text-fg/65">Awaiting approval</span>
                              ) : (
                                <button onClick={() => setReqSlipPreview(s)} className="text-[10px] font-black uppercase tracking-wider text-fg/70 hover:text-fg hover:underline">View</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          <RevolvingFundTab
            ledgerSubTab={ledgerSubTab} exportRevolvingFundsPDF={exportRevolvingFundsPDF} setRfNewModal={setRfNewModal} rfLoading={rfLoading} rfFunds={rfFunds} rfActiveFund={rfActiveFund}
            closeRfFund={closeRfFund} setRfActiveFund={setRfActiveFund} setRfDisbForm={setRfDisbForm} setRfDisbModal={setRfDisbModal} setRfReplForm={setRfReplForm} setRfReplModal={setRfReplModal}
            setRfTxs={setRfTxs} fetchRfTxs={fetchRfTxs} rfTxTotal={rfTxTotal} rfTxs={rfTxs} rfTxPage={rfTxPage} rfTxPages={rfTxPages}
            apiFetch={apiFetch} fetchRfFunds={fetchRfFunds} />

          {/* ── PERIOD LOCK ─────────────────────────────────────────────── */}
          {(ledgerSubTab === 'periods' || ledgerSubTab === 'accperiods') && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-6">
              <div>
                <h3 className="text-xl font-black text-fg flex items-center gap-2"><Lock size={18} className="text-brand-text"/> Closed Accounting Periods</h3>
                <p className="text-fg/70 text-xs font-bold uppercase tracking-widest mt-1">Lock a month to prevent back-dated journal entries</p>
              </div>

              <div className="bg-page-bg border border-white/10 rounded-xl p-4">
                <h4 className="text-sm font-black text-fg uppercase tracking-wider mb-3">Close a Period</h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Year</label>
                    <input type="number" min="2000" max="2100" value={periodCloseForm.year}
                      onChange={e => setPeriodCloseForm({...periodCloseForm, year: e.target.value})}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg font-bold outline-none focus:border-brand/60"/>
                  </div>
                  <div>
                    <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Month</label>
                    <select value={periodCloseForm.month}
                      onChange={e => setPeriodCloseForm({...periodCloseForm, month: e.target.value})}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg font-bold outline-none focus:border-brand/60">
                      {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                        <option key={m} value={m}>{new Date(2000, m-1, 1).toLocaleString(undefined, { month: 'long' })}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Notes (optional)</label>
                    <input type="text" placeholder="e.g. Q2 books closed by finance" value={periodCloseForm.notes}
                      onChange={e => setPeriodCloseForm({...periodCloseForm, notes: e.target.value})}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg outline-none focus:border-brand/60"/>
                  </div>
                </div>
                <button onClick={closePeriod} className="mt-3 w-full bg-brand text-on-brand font-black py-3 rounded-lg uppercase tracking-widest text-sm hover:bg-brand/90 transition">
                  Lock Period
                </button>
                <p className="text-[10px] text-fg/70 mt-2">Once locked, journal entries dated in this month are rejected. Superadmin can reopen below.</p>
              </div>

              <div>
                <h4 className="text-sm font-black text-fg uppercase tracking-wider mb-3">History</h4>
                {(closedPeriods || []).length === 0 ? (
                  <p className="text-fg/70 text-sm italic">No periods locked yet.</p>
                ) : (
                  <div className="space-y-2">
                    {closedPeriods.map(p => {
                      const label = `${p.year}-${String(p.month).padStart(2,'0')}`;
                      const isLocked = !p.isOpen;
                      return (
                        <div key={p._id} className={`flex items-center justify-between rounded-xl p-3 border ${isLocked ? 'bg-red-500/5 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            {isLocked ? <Lock size={14} className="text-danger"/> : <Unlock size={14} className="text-fg/70"/>}
                            <div className="min-w-0">
                              <p className="text-fg font-black text-sm">{label} <span className={`text-[10px] ml-1 font-black uppercase tracking-widest ${isLocked ? 'text-danger' : 'text-fg/70'}`}>{isLocked ? 'Locked' : 'Reopened'}</span></p>
                              <p className="text-[10px] text-fg/70 truncate">{isLocked ? `Closed by ${p.closedBy} · ${new Date(p.closedAt).toLocaleString()}` : `Reopened by ${p.reopenedBy} · ${new Date(p.reopenedAt).toLocaleString()}`}{p.notes ? ` · ${p.notes}` : ''}</p>
                            </div>
                          </div>
                          {isLocked && (
                            <button onClick={() => reopenPeriod(p._id)} className="text-[10px] uppercase tracking-widest font-black bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg px-3 py-1.5 rounded-lg transition">
                              Reopen
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── PAYMENT ROUTING ───────────────────────────────────────────── */}
          <PaymentRoutingTab
            ledgerSubTab={ledgerSubTab} paymentMap={paymentMap} cashAndBankAccounts={cashAndBankAccounts} arAccounts={arAccounts} apAccounts={apAccounts} isSuperAdmin={isSuperAdmin}
            setLedgerSubTab={setLedgerSubTab} coaAccounts={coaAccounts} savePaymentMapping={savePaymentMapping} resetPaymentMapping={resetPaymentMapping} expandedPayRouteGroups={expandedPayRouteGroups} togglePayRouteGroup={togglePayRouteGroup}
            toggleAccountActive={toggleAccountActive} />

          {/* ── AUDIT LOG ──────────────────────────────────────────────────── */}

          {/* ── TENANCY HEALTH + MY PERMISSIONS ───────────────────────────── */}
          {/* ── BACKDATE SALES (superadmin only) ──────────────────────────── */}
          {ledgerSubTab === 'backdate' && !can('sales.backdate') && (
            <p className="text-fg/70 text-sm font-bold p-8 text-center">Entering backdated sales needs the "Enter backdated sales and import past orders" permission.</p>
          )}
          {ledgerSubTab === 'backdate' && can('sales.backdate') && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-xl font-black text-fg flex items-center gap-2"><Clock size={18} className="text-brand-text"/> Backdate Sale</h3>
                  <p className="text-fg/70 text-xs font-bold uppercase tracking-widest mt-1">Ring up a historical sale like the register, then post it to a past date. Books a real, balanced journal entry.</p>
                </div>
                {isSuperAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={downloadBackdateTemplate} title="Download a blank template with the expected headers" className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg font-bold text-sm px-4 py-2.5 rounded-xl transition">
                      <FileText size={15} /> Template
                    </button>
                    <label className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg font-bold text-sm px-4 py-2.5 rounded-xl transition cursor-pointer">
                      <Download size={15} className="rotate-180" /> {bdImporting ? 'Reading…' : 'Import Excel'}
                      <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={bdImporting}
                        onChange={e => { parseBackdateExcel(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <p className="text-xs text-fg/80 flex-1 min-w-[220px]">
                  <b className="text-fg">Cost of goods sold.</b> Backdated sales that have their products but took no stock carry no cost, so profit reads too high. This books each one's cost from what its stock items cost now. Stock counts are not changed - the next stock count settles them.
                </p>
                <button type="button" disabled={bdCosting} onClick={bookBackdatedCosts}
                  className="bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-40">
                  {bdCosting ? 'Working…' : 'Book cost of goods sold'}
                </button>
              </div>
              {(
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* LEFT: product picker + cart */}
                  <div className="bg-page-bg border border-white/10 rounded-xl p-4 flex flex-col min-h-[420px]">
                    <div className="relative mb-3">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/65" />
                      <input type="text" placeholder="Search products to add…" value={bdSearch}
                        onChange={e => setBdSearch(e.target.value)}
                        className="w-full bg-surface border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-fg text-sm outline-none focus:border-brand/60" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 overflow-y-auto max-h-56 mb-3 custom-scrollbar content-start">
                      {(products || []).filter(p => !bdSearch || p.name.toLowerCase().includes(bdSearch.toLowerCase())).slice(0, 60).map(p => (
                        <button key={p._id} onClick={() => bdAddProduct(p)}
                          className="text-left bg-surface border border-white/10 rounded-lg p-2.5 hover:border-brand/60 hover:bg-brand/5 transition active-press min-h-[56px]">
                          <p className="text-[11px] font-bold text-fg leading-tight line-clamp-2">{p.name}</p>
                          <p className="text-brand-text font-black text-sm mt-1 tabular-nums">{peso(Number(p.basePrice || p.price || 0))}</p>
                        </button>
                      ))}
                      {(products || []).length === 0 && <p className="col-span-full text-fg/65 text-xs text-center py-8">No products yet - add them in Menu Setup.</p>}
                    </div>
                    <div className="border-t border-white/10 pt-3 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                      <p className="text-[10px] text-fg/70 font-bold uppercase tracking-widest mb-2">Cart ({bdCart.length})</p>
                      {bdCart.length === 0 ? (
                        <p className="text-fg/65 text-xs py-6 text-center">Tap products above to build the sale.</p>
                      ) : bdCart.map(x => (
                        <div key={x.productId} className="flex items-center gap-2 py-2 border-b border-white/5">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-fg truncate" title={String((x.name) ?? '')}>{x.name}</p>
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-[10px] text-fg/70">₱</span>
                              <input type="number" min="0" step="0.01" value={x.price} onChange={e => bdSetPrice(x.productId, e.target.value)}
                                aria-label={`Price of ${x.name}`}
                                className="w-16 bg-surface border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-fg tabular-nums outline-none focus:border-brand/60" />
                              {!bd.isComplimentary && (<>
                                <span className="text-[10px] text-fg/70 ml-2">Disc</span>
                                <input type="number" min="0" max="100" step="0.01" placeholder="0" value={x.discountPercent ?? ''}
                                  onChange={e => bdSetLineDisc(x.productId, e.target.value)}
                                  aria-label={`Discount percent on ${x.name}`}
                                  className="w-12 bg-surface border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-fg tabular-nums outline-none focus:border-brand/60" />
                                <span className="text-[10px] text-fg/70">%</span>
                              </>)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => bdSetQty(x.productId, x.quantity - 1)} className="w-7 h-7 rounded-lg bg-white/5 text-fg/65 hover:bg-white/10 font-black">−</button>
                            <input type="number" min="1" value={x.quantity} onChange={e => bdSetQty(x.productId, parseInt(e.target.value) || 1)}
                              className="w-11 bg-surface border border-white/10 rounded px-1 py-1 text-center text-xs text-fg tabular-nums outline-none focus:border-brand/60" />
                            <button onClick={() => bdSetQty(x.productId, x.quantity + 1)} className="w-7 h-7 rounded-lg bg-white/5 text-fg/65 hover:bg-white/10 font-black">+</button>
                          </div>
                          <span className="w-20 text-right shrink-0 tabular-nums">
                            {bdLinePct(x) > 0 && !bd.isComplimentary && <span className="block text-[10px] text-fg/65 line-through">{peso(x.price * x.quantity)}</span>}
                            <span className="text-xs font-black text-fg">{peso(bd.isComplimentary ? x.price * x.quantity : x.price * x.quantity - r2(x.price * x.quantity * bdLinePct(x) / 100))}</span>
                          </span>
                          <button onClick={() => bdRemove(x.productId)} className="text-danger shrink-0"><Trash2 size={14}/></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* RIGHT: sale details */}
                  <div className="bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Sale Date *</label>
                        <input type="date" value={bd.date} max={todayStr()}
                          onChange={e => setBd({ ...bd, date: e.target.value })}
                          className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Payment Method</label>
                        <PaymentMethodPicker value={bd.paymentMethod} disabled={bd.isComplimentary} saleDate={bd.date}
                          onChange={m => setBd({ ...bd, paymentMethod: m, ...(m === 'Split' ? { payments: newSplit(bdTotal) } : {}) })}
                          details={bd} onDetails={patch => setBd({ ...bd, ...patch })}
                          more={<>
                            <option value="Maribank">Maribank / Seabank</option>
                            <option value="Other E-Wallet">Other E-Wallet</option>
                            <option value="QR">QR / Scan to Pay</option>
                            <option value="Grab Delivery">Grab Delivery</option>
                            {BUSINESS_TYPE === 'log' ? <option value="Lalamove">Lalamove</option> : <option value="Foodpanda">Foodpanda</option>}
                            <option value="Manual Delivery">Manual/Direct delivery</option>
                          </>} />
                      </div>
                      {bd.paymentMethod === 'Split' && !bd.isComplimentary && (
                        <div className="sm:col-span-2">
                          <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Split payment</label>
                          <SplitPayEditor total={bdTotal} parts={bd.payments || newSplit(bdTotal)} onChange={parts => setBd({ ...bd, payments: parts })} />
                        </div>
                      )}
                    </div>

                    {/* Toggles: reduce inventory (default off) + complimentary */}
                    <div className="space-y-2">
                      <button onClick={() => setBd({ ...bd, affectInventory: !bd.affectInventory })}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition ${bd.affectInventory ? 'bg-amber-500/10 border-amber-500/40' : 'bg-surface border-white/10'}`}>
                        <span className="text-left">
                          <span className="text-xs font-bold text-fg block">Reduce current inventory</span>
                          <span className="text-[10px] text-fg/70">{bd.affectInventory ? 'Stock WILL be deducted + COGS booked' : 'Off - old sale won’t touch today’s stock (default)'}</span>
                        </span>
                        <span className={`w-10 h-5 rounded-full shrink-0 relative transition ${bd.affectInventory ? 'bg-amber-500' : 'bg-white/15'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bd.affectInventory ? 'left-[22px]' : 'left-0.5'}`}/>
                        </span>
                      </button>
                      <button onClick={() => setBd({ ...bd, isComplimentary: !bd.isComplimentary })}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition ${bd.isComplimentary ? 'bg-brand/10 border-brand/40' : 'bg-surface border-white/10'}`}>
                        <span className="text-left">
                          <span className="text-xs font-bold text-fg block">Complimentary (free)</span>
                          <span className="text-[10px] text-fg/70">{bd.isComplimentary ? 'Books Comp Expense / Revenue, collects ₱0' : 'Off - a normal paid sale'}</span>
                        </span>
                        <span className={`w-10 h-5 rounded-full shrink-0 relative transition ${bd.isComplimentary ? 'bg-brand' : 'bg-white/15'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bd.isComplimentary ? 'left-[22px]' : 'left-0.5'}`}/>
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Customer (optional)</label>
                        <input type="text" placeholder="Walk-in" value={bd.customerName}
                          onChange={e => setBd({ ...bd, customerName: e.target.value })}
                          className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg outline-none focus:border-brand/60" />
                      </div>
                      <div>
                        <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Discount %</label>
                        <input type="number" min="0" max="100" step="any" value={bd.discountPercent} disabled={bd.isComplimentary}
                          onChange={e => setBd({ ...bd, discountPercent: e.target.value })}
                          className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg font-bold tabular-nums outline-none focus:border-brand/60 disabled:opacity-40" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Notes</label>
                      <input type="text" placeholder="e.g. Paper receipt #4521, 2024 carry-over" value={bd.notes}
                        onChange={e => setBd({ ...bd, notes: e.target.value })}
                        className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg outline-none focus:border-brand/60" />
                    </div>

                    {/* Totals */}
                    <div className="bg-surface border border-white/10 rounded-lg p-3 space-y-1 text-sm">
                      <div className="flex justify-between text-fg/65"><span>Gross</span><span className="tabular-nums">{peso(bdGross)}</span></div>
                      {bdLineDiscount > 0 && <div className="flex justify-between text-fg/65"><span>Item discounts</span><span className="tabular-nums">−{peso(bdLineDiscount)}</span></div>}
                      {bdDiscount - bdLineDiscount > 0.004 && <div className="flex justify-between text-fg/65"><span>Discount ({bdPct}%)</span><span className="tabular-nums">−{peso(r2(bdDiscount - bdLineDiscount))}</span></div>}
                      <div className="flex justify-between text-base font-black text-fg border-t border-white/10 pt-1 mt-1"><span>{bd.isComplimentary ? 'Complimentary' : 'Total'}</span><span className="tabular-nums text-brand-text">{peso(bdTotal)}</span></div>
                    </div>

                    <button onClick={submitBackdateCart} disabled={bdBusy || bdCart.length === 0}
                      className="w-full bg-brand text-on-brand font-black py-3 rounded-lg uppercase tracking-widest text-sm hover:bg-brand/90 transition disabled:opacity-50">
                      {bdBusy ? 'Posting…' : 'Record Backdated Sale'}
                    </button>
                    <p className="text-[10px] text-fg/70">Period locks are enforced - a closed month is rejected. Always audited.</p>

                    <div className="border-t border-white/10 pt-3">
                      <button onClick={runBackfillLedger} disabled={backfillBusy}
                        className="w-full bg-surface border border-white/10 text-fg/70 font-bold py-2 rounded-lg uppercase tracking-widest text-[11px] hover:border-brand/60 transition disabled:opacity-50">
                        {backfillBusy ? 'Scanning…' : 'Repair Missing Ledger Entries'}
                      </button>
                      <p className="text-[10px] text-fg/70 mt-1.5">One-time fix for older backdated sales missing a journal entry. Safe to run repeatedly.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── BACKDATE SALE QUEUE ── rows a bulk import couldn't post blind (no Terms of Payment on the sheet) */}
              {can('sales.backdate') && bdQueue?.total > 0 && (
                <div className="bg-surface border border-amber-500/30 rounded-xl overflow-hidden mt-2">
                  <div className="px-5 py-3 border-b border-amber-500/20 bg-amber-500/5 flex items-center gap-2 flex-wrap">
                    <AlertTriangle size={14} className="text-warning" />
                    <h3 className="text-sm font-black text-fg uppercase tracking-wider">Backdate Queue</h3>
                    <span className="text-[10px] text-warning font-bold">{bdQueue.total} needs a payment method</span>
                    <button onClick={() => fetchBdQueue(bdQueuePage)} disabled={bdQueueLoading}
                      className="ml-auto flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition disabled:opacity-50">
                      <RefreshCw size={11} className={bdQueueLoading ? 'animate-spin' : ''}/> Refresh
                    </button>
                  </div>
                  <p className="text-fg/70 text-[11px] px-5 pt-3">
                    These sheets left "Terms of Payment" blank, so we didn't guess how they were paid. Supply it and Save to post them as backdated sales.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[560px]">
                      <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <tr>
                          <th className="px-5 py-2.5">Date</th>
                          <th className="px-5 py-2.5">Sheet</th>
                          <th className="px-5 py-2.5">Client</th>
                          <th className="px-5 py-2.5">Items</th>
                          <th className="px-5 py-2.5 text-right">Total</th>
                          <th className="px-5 py-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bdQueue.rows.map((row, i) => {
                          const total = (row.items || []).reduce((s, it) => s + (it.price || 0) * (it.quantity || 0), 0);
                          return (
                            <tr key={row._id} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                              <td className="px-5 py-2.5 text-fg/70 whitespace-nowrap font-bold">{row.date || <span className="text-danger">no date</span>}</td>
                              <td className="px-5 py-2.5 text-fg/70 truncate max-w-[140px]">{row.sheet || '-'}</td>
                              <td className="px-5 py-2.5 text-fg/80 font-bold truncate max-w-[160px]">{row.client || 'Walk-in'}</td>
                              <td className="px-5 py-2.5 text-fg/65 truncate max-w-[220px]" title={String(((row.items || []).map(it => it.name).join(', ')) ?? '')}>{(row.items || []).map(it => it.name).join(', ')}</td>
                              <td className="px-5 py-2.5 text-right text-fg font-mono tabular-nums font-bold">{peso(total)}</td>
                              <td className="px-5 py-2.5 text-right whitespace-nowrap">
                                <button onClick={() => setBdQueueResolve({ row, paymentMethod: 'Cash', affectInventory: false })}
                                  className="text-[10px] font-black uppercase tracking-wider text-brand-text hover:underline mr-3">Complete</button>
                                <button onClick={() => discardBdQueueItem(row)}
                                  className="text-[10px] font-black uppercase tracking-wider text-danger hover:underline">Discard</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {bdQueue.pages > 1 && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
                      <button onClick={() => fetchBdQueue(bdQueuePage - 1)} disabled={bdQueuePage <= 1 || bdQueueLoading}
                        className="text-[10px] font-black uppercase tracking-widest text-fg/75 hover:text-fg disabled:opacity-30 transition">← Prev</button>
                      <span className="text-[10px] text-fg/70 font-bold">Page {bdQueue.page} of {bdQueue.pages}</span>
                      <button onClick={() => fetchBdQueue(bdQueuePage + 1)} disabled={bdQueuePage >= bdQueue.pages || bdQueueLoading}
                        className="text-[10px] font-black uppercase tracking-widest text-fg/75 hover:text-fg disabled:opacity-30 transition">Next →</button>
                    </div>
                  )}
                </div>
              )}

              {/* ── BACKDATE SALE HISTORY ── every entry made through this tool, manual or bulk-imported */}
              {isSuperAdmin && (
                <div className="bg-surface border border-white/10 rounded-xl overflow-hidden mt-2">
                  <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2 flex-wrap">
                    <History size={14} className="text-fg/75" />
                    <h3 className="text-sm font-black text-fg uppercase tracking-wider">Backdate History</h3>
                    {bdHistory?.total > 0 && <span className="text-[10px] text-fg/70 font-bold">{bdHistory.total} total</span>}
                    <button onClick={exportBackdateHistoryPDF} disabled={bdExporting || !bdHistory?.total}
                      className="ml-auto flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition disabled:opacity-50">
                      <Download size={11}/> {bdExporting ? 'Exporting…' : 'Export PDF'}
                    </button>
                    <button onClick={() => fetchBdHistory(bdHistoryPage)} disabled={bdHistoryLoading}
                      className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition disabled:opacity-50">
                      <RefreshCw size={11} className={bdHistoryLoading ? 'animate-spin' : ''}/> Refresh
                    </button>
                  </div>
                  {bdHistoryLoading && !bdHistory ? (
                    <p className="text-fg/70 text-sm p-6 text-center font-bold">Loading…</p>
                  ) : !bdHistory || bdHistory.orders.length === 0 ? (
                    <p className="text-fg/65 text-sm p-8 text-center font-bold">No backdated sales recorded yet.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs min-w-[560px]">
                          <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                            <tr>
                              <th className="px-5 py-2.5">Date</th>
                              <th className="px-5 py-2.5">Order No.</th>
                              <th className="px-5 py-2.5">Customer</th>
                              <th className="px-5 py-2.5">Payment</th>
                              <th className="px-5 py-2.5">Notes</th>
                              <th className="px-5 py-2.5 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bdHistory.orders.map((o, i) => (
                              <tr key={o._id} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                                <td className="px-5 py-2.5 text-fg/70 whitespace-nowrap font-bold">
                                  {new Date(o.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </td>
                                <td className="px-5 py-2.5 font-mono text-fg/65 whitespace-nowrap">{o.orderNumber}</td>
                                <td className="px-5 py-2.5 text-fg/80 font-bold truncate max-w-[160px]" title={String((o.customerName || 'Walk-in') ?? '')}>{o.customerName || 'Walk-in'}</td>
                                <td className="px-5 py-2.5 text-fg/65 whitespace-nowrap">{o.paymentMethod}</td>
                                <td className="px-5 py-2.5 text-fg/70 truncate max-w-[220px]">{o.orderNotes || '-'}</td>
                                <td className="px-5 py-2.5 text-right text-fg font-mono tabular-nums font-bold">{peso(o.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {bdHistory.pages > 1 && (
                        <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
                          <button onClick={() => fetchBdHistory(bdHistoryPage - 1)} disabled={bdHistoryPage <= 1 || bdHistoryLoading}
                            className="text-[10px] font-black uppercase tracking-widest text-fg/75 hover:text-fg disabled:opacity-30 transition">← Prev</button>
                          <span className="text-[10px] text-fg/70 font-bold">Page {bdHistory.page} of {bdHistory.pages}</span>
                          <button onClick={() => fetchBdHistory(bdHistoryPage + 1)} disabled={bdHistoryPage >= bdHistory.pages || bdHistoryLoading}
                            className="text-[10px] font-black uppercase tracking-widest text-fg/75 hover:text-fg disabled:opacity-30 transition">Next →</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── BACKDATE QUEUE - COMPLETE ── supply the missing payment method, then post */}
          {bdQueueResolve && !bdSheetPicker && !bdImportPreview && (
            <div className="fixed inset-0 z-50 flex justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => !bdQueueSaving && setBdQueueResolve(null)}>
              <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl my-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div>
                    <h2 className="font-black text-fg text-base">Complete Queued Sale</h2>
                    <p className="text-fg/70 text-xs mt-0.5">{bdQueueResolve.row.client || 'Walk-in'} · {bdQueueResolve.row.date || 'no date'}</p>
                  </div>
                  <button onClick={() => !bdQueueSaving && setBdQueueResolve(null)} className="text-fg/70 hover:text-fg transition"><X size={18} /></button>
                </div>
                <div className="px-5 py-4 space-y-2 max-h-[30vh] overflow-y-auto border-b border-white/10">
                  {(bdQueueResolve.row.items || []).map((it, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-fg/70">
                      <span className="truncate pr-2">{it.code ? `${it.code} · ` : ''}{it.name}</span>
                      <span className="whitespace-nowrap font-mono">{it.quantity} × {peso(it.price)}</span>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div>
                    <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Payment Method *</label>
                    <PaymentMethodPicker value={bdQueueResolve.paymentMethod} methods={['Cash', 'Bank Transfer', 'GCash', 'Maya', 'Check', 'On Account']}
                      onChange={m => setBdQueueResolve(st => ({ ...st, paymentMethod: m }))}
                      details={bdQueueResolve} onDetails={patch => setBdQueueResolve(st => ({ ...st, ...patch }))} />
                  </div>
                  <button onClick={() => setBdQueueResolve(s => ({ ...s, affectInventory: !s.affectInventory }))}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition ${bdQueueResolve.affectInventory ? 'bg-amber-500/10 border-amber-500/40' : 'bg-page-bg border-white/10'}`}>
                    <span className="text-left">
                      <span className="text-xs font-bold text-fg block">Reduce current inventory</span>
                      <span className="text-[10px] text-fg/70">{bdQueueResolve.affectInventory ? 'Stock WILL be deducted' : 'Off - won’t touch today’s stock (default)'}</span>
                    </span>
                    <span className={`w-10 h-5 rounded-full shrink-0 relative transition ${bdQueueResolve.affectInventory ? 'bg-amber-500' : 'bg-white/15'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bdQueueResolve.affectInventory ? 'left-[22px]' : 'left-0.5'}`}/>
                    </span>
                  </button>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
                  <button onClick={() => !bdQueueSaving && setBdQueueResolve(null)} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/75 hover:text-fg transition">Cancel</button>
                  <button onClick={saveBdQueueItem} disabled={bdQueueSaving} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-on-brand font-bold text-sm px-5 py-2 rounded-xl transition">
                    {bdQueueSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── BACKDATE IMPORT - OPTIONS (sheet selection + the same settings the manual entry form asks for) ── */}
          {bdSheetPicker && !bdImportPreview && (
            <div className="fixed inset-0 z-50 flex justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => !bdImporting && setBdSheetPicker(null)}>
              <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl my-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div>
                    <h2 className="font-black text-fg text-base">Import Options</h2>
                    <p className="text-fg/70 text-xs mt-0.5">
                      {bdSheetPicker.sheetNames.length > 1
                        ? `This file has ${bdSheetPicker.sheetNames.length} tabs. Pick which to import.`
                        : 'Set how this sale should post before previewing it.'}
                    </p>
                  </div>
                  <button onClick={() => !bdImporting && setBdSheetPicker(null)} className="text-fg/70 hover:text-fg transition"><X size={18} /></button>
                </div>

                {bdSheetPicker.sheetNames.length > 1 && (
                  <>
                    <div className="px-5 py-3 flex items-center gap-2 border-b border-white/10">
                      <button onClick={() => setBdSheetPicker(s => ({ ...s, selected: new Set(s.sheetNames) }))}
                        className="text-[10px] font-black uppercase tracking-widest text-brand-text hover:underline">Select All</button>
                      <span className="text-fg/65">·</span>
                      <button onClick={() => setBdSheetPicker(s => ({ ...s, selected: new Set() }))}
                        className="text-[10px] font-black uppercase tracking-widest text-fg/70 hover:underline">Select None</button>
                    </div>
                    <div className="px-5 py-3 space-y-1.5 max-h-[35vh] overflow-y-auto border-b border-white/10">
                      {bdSheetPicker.sheetNames.map(name => {
                        const checked = bdSheetPicker.selected.has(name);
                        return (
                          <label key={name} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition ${checked ? 'bg-brand/10 border-brand/40' : 'bg-page-bg border-white/10'}`}>
                            <input type="checkbox" checked={checked} onChange={() => setBdSheetPicker(s => {
                              const next = new Set(s.selected);
                              next.has(name) ? next.delete(name) : next.add(name);
                              return { ...s, selected: next };
                            })} className="accent-brand w-4 h-4" />
                            <span className="text-sm font-bold text-fg truncate" title={String((name) ?? '')}>{name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}

                <div className="px-5 py-4 space-y-3">
                  <div>
                    <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Payment Method (applies to all)</label>
                    <PaymentMethodPicker value={bdImportSettings.paymentMethod} methods={['Cash', 'Bank Transfer', 'GCash', 'Maya', 'Check', 'On Account']} showDetails={false}
                      onChange={m => setBdImportSettings(st => ({ ...st, paymentMethod: m }))} />
                  </div>
                  <button onClick={() => setBdImportSettings(s => ({ ...s, affectInventory: !s.affectInventory }))}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition ${bdImportSettings.affectInventory ? 'bg-amber-500/10 border-amber-500/40' : 'bg-page-bg border-white/10'}`}>
                    <span className="text-left">
                      <span className="text-xs font-bold text-fg block">Reduce current inventory</span>
                      <span className="text-[10px] text-fg/70">{bdImportSettings.affectInventory ? 'Stock WILL be deducted for every item matched' : 'Off - these sales won’t touch today’s stock (default)'}</span>
                    </span>
                    <span className={`w-10 h-5 rounded-full shrink-0 relative transition ${bdImportSettings.affectInventory ? 'bg-amber-500' : 'bg-white/15'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bdImportSettings.affectInventory ? 'left-[22px]' : 'left-0.5'}`}/>
                    </span>
                  </button>
                </div>

                {bdParseProgress && (
                  <div className="px-5 pt-4">
                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-fg/75 mb-1.5">
                      <span>Reading sheets…</span>
                      <span className="tabular-nums">{bdParseProgress.done} / {bdParseProgress.total}</span>
                    </div>
                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-brand transition-all duration-200 ease-out rounded-full"
                        style={{ width: `${Math.round((bdParseProgress.done / (bdParseProgress.total || 1)) * 100)}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
                  <button onClick={() => !bdImporting && setBdSheetPicker(null)} disabled={bdImporting} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/75 hover:text-fg transition disabled:opacity-30">Cancel</button>
                  <button onClick={confirmBdSheetPicker} disabled={bdImporting || bdSheetPicker.selected.size === 0} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-on-brand font-bold text-sm px-5 py-2 rounded-xl transition">
                    {bdImporting ? (bdParseProgress ? `Reading ${bdParseProgress.done}/${bdParseProgress.total}` : 'Reading…') : bdSheetPicker.sheetNames.length > 1 ? `Continue (${bdSheetPicker.selected.size} sheet${bdSheetPicker.selected.size === 1 ? '' : 's'})` : 'Continue'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── BACKDATE IMPORT PREVIEW ── */}
          {bdImportPreview && (
            <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => !bdImporting && setBdImportPreview(null)}>
              <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-3xl my-8 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div>
                    <h2 className="font-black text-fg text-lg">Import Backdated Sales</h2>
                    <p className="text-fg/70 text-xs mt-0.5">
                      {bdImportPreview.groups.length} sale(s) · {bdImportPreview.groups.reduce((s, g) => s + g.items.length, 0)} line item(s)
                      {bdImportPreview.skipped > 0 && ` · ${bdImportPreview.skipped} row(s) skipped`}
                    </p>
                  </div>
                  <button onClick={() => !bdImporting && setBdImportPreview(null)} className="text-fg/70 hover:text-fg transition"><X size={20} /></button>
                </div>
                <div className="px-5 py-4 border-b border-white/10 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Payment Method (default - override any sale below)</label>
                    <PaymentMethodPicker value={bdImportSettings.paymentMethod} methods={['Cash', 'Bank Transfer', 'GCash', 'Maya', 'Check', 'On Account']} showDetails={false}
                      onChange={m => setBdImportSettings(st => ({ ...st, paymentMethod: m }))} />
                  </div>
                  <div className="flex items-end">
                    <button onClick={() => setBdImportSettings(s => ({ ...s, affectInventory: !s.affectInventory }))}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border transition ${bdImportSettings.affectInventory ? 'bg-amber-500/10 border-amber-500/40' : 'bg-page-bg border-white/10'}`}>
                      <span className="text-xs font-bold text-fg">Reduce current inventory</span>
                      <span className={`w-9 h-5 rounded-full shrink-0 relative transition ${bdImportSettings.affectInventory ? 'bg-amber-500' : 'bg-white/15'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bdImportSettings.affectInventory ? 'left-[18px]' : 'left-0.5'}`}/>
                      </span>
                    </button>
                  </div>
                  {/* A sheet imported before - say at its subtotal instead of its
                      grand total - is reversed and recorded again, instead of
                      skipped as a duplicate. */}
                  <div className="col-span-2">
                    <button onClick={() => setBdImportSettings(s => ({ ...s, replaceExisting: !s.replaceExisting }))} aria-pressed={bdImportSettings.replaceExisting}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition text-left ${bdImportSettings.replaceExisting ? 'bg-amber-500/10 border-amber-500/40' : 'bg-page-bg border-white/10'}`}>
                      <span>
                        <span className="text-xs font-bold text-fg block">Replace sales already imported</span>
                        <span className="text-[10px] text-fg/70 block">A sale with the same transaction no. is reversed (its entries, and any stock it took) and recorded again from this sheet. Off: it is skipped.</span>
                      </span>
                      <span className={`w-9 h-5 rounded-full shrink-0 relative transition ${bdImportSettings.replaceExisting ? 'bg-amber-500' : 'bg-white/15'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bdImportSettings.replaceExisting ? 'left-[18px]' : 'left-0.5'}`}/>
                      </span>
                    </button>
                  </div>
                </div>
                <div className="p-5 space-y-3 max-h-[50vh] overflow-y-auto">
                  {bdImportPreview.groups.map((g, gi) => (
                    <div key={gi} className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                        <span className="font-black text-fg text-sm">{g.client || 'Walk-in'}</span>
                        <div className="flex items-center gap-2 text-[11px] text-fg/70 font-bold">
                          {bdImportPreview.multiSheet && g.sheet && <span className="text-[9px] bg-white/10 text-fg/75 px-1.5 py-0.5 rounded uppercase tracking-wider">{g.sheet}</span>}
                          {g.transNo && <span>{g.transNo}</span>}
                          <span>{g.date || <span className="text-danger">no date</span>}</span>
                          {g.discountAmount > 0 && <span title="The sheet's discount - its grand total is below the item lines">less {peso(g.discountAmount)}</span>}
                          <span className="text-brand-text">{peso(g.total)}</span>
                          {g.sheetTotal != null && Math.abs(g.sheetTotal - g.total) > 0.005 && (
                            <span className="text-danger" title="The sheet's grand total is higher than its items plus delivery - check the sheet">sheet says {peso(g.sheetTotal)}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <select value={g.paymentMethod || bdImportSettings.paymentMethod}
                          onChange={e => { const v = e.target.value; setBdImportPreview(p => ({ ...p, groups: p.groups.map((x, i) => i === gi ? { ...x, paymentMethod: v, ...(v === 'Split' ? { payments: newSplit(x.total) } : {}) } : x) })); }}
                          className={`text-[10px] font-bold uppercase tracking-wider rounded-lg px-2 py-1 outline-none border ${g.paymentMethod ? 'bg-brand/10 border-brand/40 text-brand-text' : 'bg-page-bg border-white/10 text-fg/65'}`}>
                          <option value="Cash">Cash</option>
                          <option value="Bank Transfer">Bank Transfer</option>
                          <option value="GCash">GCash</option>
                          <option value="Maya">Maya</option>
                          <option value="Check">Check / Dated Check</option>
                          <option value="On Account">On Account (A/R) - pays later</option>
                          <option value="Split">Split payment</option>
                        </select>
                        {g.paymentMethod && (
                          <button onClick={() => setBdImportPreview(p => ({ ...p, groups: p.groups.map((x, i) => i === gi ? { ...x, paymentMethod: null } : x) }))}
                            className="text-[9px] font-bold uppercase tracking-wider text-fg/65 transition">reset to default</button>
                        )}
                      </div>
                      {(g.paymentMethod || bdImportSettings.paymentMethod) === 'Check' && (
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <input value={g.checkNumber || ''} placeholder="Check number *" aria-label="Check number" maxLength={60}
                            onChange={e => { const v = e.target.value; setBdImportPreview(p => ({ ...p, groups: p.groups.map((x, i) => i === gi ? { ...x, checkNumber: v } : x) })); }}
                            className={`w-40 bg-page-bg border rounded-lg px-2 py-1 text-fg text-xs outline-none ${(g.checkNumber || '').trim() ? 'border-white/10' : 'border-red-500/60'}`} />
                          <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-fg/70">Check date
                            <input type="date" value={g.checkDate || ''} aria-label="Check date"
                              onChange={e => { const v = e.target.value; setBdImportPreview(p => ({ ...p, groups: p.groups.map((x, i) => i === gi ? { ...x, checkDate: v } : x) })); }}
                              className="bg-page-bg border border-white/10 rounded-lg px-2 py-1 text-fg text-xs outline-none" />
                          </label>
                          <input value={g.checkBank || ''} placeholder="Bank" aria-label="Bank" maxLength={20}
                            onChange={e => { const v = e.target.value; setBdImportPreview(p => ({ ...p, groups: p.groups.map((x, i) => i === gi ? { ...x, checkBank: v } : x) })); }}
                            className="w-28 bg-page-bg border border-white/10 rounded-lg px-2 py-1 text-fg text-xs outline-none" />
                          {g.checkDate && g.checkDate > g.date && <span className="text-[10px] font-bold text-warning">Post-dated</span>}
                        </div>
                      )}
                      {NEEDS_REFERENCE.includes(g.paymentMethod || bdImportSettings.paymentMethod) && (
                        <div className="mb-2">
                          <input value={g.reference || ''} placeholder="Reference number" aria-label="Reference number" maxLength={60}
                            onChange={e => { const v = e.target.value; setBdImportPreview(p => ({ ...p, groups: p.groups.map((x, i) => i === gi ? { ...x, reference: v } : x) })); }}
                            className="w-56 bg-page-bg border border-white/10 rounded-lg px-2 py-1 text-fg text-xs outline-none" />
                        </div>
                      )}
                      {g.paymentMethod === 'Split' && (
                        <div className="mb-2 max-w-md">
                          <SplitPayEditor compact total={g.total} parts={g.payments || newSplit(g.total)}
                            onChange={parts => setBdImportPreview(p => ({ ...p, groups: p.groups.map((x, i) => i === gi ? { ...x, payments: parts } : x) }))} />
                        </div>
                      )}
                      <div className="space-y-0.5">
                        {g.items.map((it, li) => (
                          <div key={li} className="flex items-center justify-between text-xs text-fg/65">
                            <span className="truncate pr-2">
                              {it.code ? `${it.code} · ` : ''}{it.name}
                              {!it.matched && <span className="ml-1.5 text-[9px] font-black bg-amber-500/20 text-warning border border-amber-500/40 px-1 py-0.5 rounded uppercase align-middle">No product match</span>}
                            </span>
                            <span className="whitespace-nowrap font-mono">{it.quantity} × {peso(it.price)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {bdImportProgress && (
                  <div className="px-5 pt-4">
                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-fg/75 mb-1.5">
                      <span>Importing…</span>
                      <span className="tabular-nums">{bdImportProgress.done} / {bdImportProgress.total}</span>
                    </div>
                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-brand transition-all duration-200 ease-out rounded-full"
                        style={{ width: `${Math.round((bdImportProgress.done / (bdImportProgress.total || 1)) * 100)}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
                  <button onClick={() => !bdImporting && setBdImportPreview(null)} disabled={bdImporting} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/75 hover:text-fg transition disabled:opacity-30">Cancel</button>
                  <button onClick={confirmBdImport} disabled={bdImporting} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-on-brand font-bold text-sm px-5 py-2 rounded-xl transition">
                    {bdImporting ? `Importing ${bdImportProgress ? `${bdImportProgress.done}/${bdImportProgress.total}` : '…'}` : `Import ${bdImportPreview.groups.length} Sale(s)`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── REQUISITION SLIP - REJECT REASON ── */}
          {reqSlipRejecting && (
            <div className="fixed inset-0 z-50 flex justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => !reqSlipBusy && setReqSlipRejecting(null)}>
              <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl my-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <h2 className="font-black text-fg text-base">Reject {reqSlipRejecting.slipNumber}</h2>
                  <button onClick={() => !reqSlipBusy && setReqSlipRejecting(null)} className="text-fg/70 hover:text-fg transition"><X size={18} /></button>
                </div>
                <div className="p-5 space-y-3">
                  <label className="text-[10px] text-fg/70 font-bold uppercase block mb-1">Reason *</label>
                  <textarea autoFocus rows={3} value={reqSlipRejectReason} onChange={e => setReqSlipRejectReason(e.target.value)}
                    placeholder="Why is this being rejected?"
                    className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-red-500/60 resize-none" />
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
                  <button onClick={() => setReqSlipRejecting(null)} disabled={reqSlipBusy} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/75 hover:text-fg transition disabled:opacity-40">Cancel</button>
                  <button onClick={submitRejectReqSlip} disabled={reqSlipBusy || !reqSlipRejectReason.trim()} className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-bold text-sm px-5 py-2 rounded-xl transition">
                    {reqSlipBusy ? 'Rejecting…' : 'Reject Slip'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── REQUISITION SLIP PREVIEW ── every slip: Prepared By, then Approved By below it once set ── */}
          {reqSlipPreview && (
            <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => setReqSlipPreview(null)}>
              <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-lg my-8 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div>
                    <h2 className="font-black text-fg text-lg">{reqSlipPreview.slipNumber}</h2>
                    <p className="text-fg/70 text-xs mt-0.5">{reqSlipPreview.type === 'petty-cash' ? 'Petty Cash / Revolving Fund Requisition' : reqSlipPreview.type === 'new-fund' ? 'New Revolving Fund Requisition' : reqSlipPreview.type === 'fund-replenish' ? 'Revolving Fund Replenishment' : 'Procurement Requisition'}</p>
                  </div>
                  <button onClick={() => setReqSlipPreview(null)} className="text-fg/70 hover:text-fg transition"><X size={20} /></button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${reqSlipPreview.status === 'Pending' ? 'bg-amber-500/20 text-warning' : reqSlipPreview.status === 'Approved' ? 'bg-brand/20 text-brand-text' : 'bg-red-500/20 text-danger'}`}>{reqSlipPreview.status}</span>
                    <span className="text-fg/70 text-[10px] font-bold">{new Date(reqSlipPreview.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>

                  {reqSlipPreview.type === 'petty-cash' ? (
                    <div className="bg-page-bg border border-white/10 rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-fg/75">Fund</span><span className="text-fg font-bold">{reqSlipPreview.fundName}</span></div>
                      <div className="flex justify-between"><span className="text-fg/75">Description</span><span className="text-fg font-bold text-right max-w-[60%]">{reqSlipPreview.description}</span></div>
                      <div className="flex justify-between border-t border-white/10 pt-2 mt-1"><span className="text-fg/75">Amount</span><span className="text-brand-text font-black text-lg tabular-nums">{peso(reqSlipPreview.amount)}</span></div>
                      {/* Live balance preview - what approving this actually
                          does to the fund, so the reviewer isn't approving
                          blind. Money going OUT of a fund, so subtracted. */}
                      {reqSlipFundBalance !== null && (
                        <div className="flex justify-between border-t border-white/10 pt-2 mt-1 text-xs">
                          <span className="text-fg/70">Current Balance → After</span>
                          <span className="font-mono tabular-nums">
                            <span className="text-fg/65">{peso(reqSlipFundBalance)}</span>
                            <span className="text-fg/65 mx-1">→</span>
                            <span className={reqSlipFundBalance - reqSlipPreview.amount < 0 ? 'text-danger font-bold' : 'text-fg font-bold'}>
                              {peso(reqSlipFundBalance - reqSlipPreview.amount)}
                            </span>
                          </span>
                        </div>
                      )}
                      {reqSlipFundBalance !== null && reqSlipFundBalance < reqSlipPreview.amount && (
                        <p className="text-danger text-[11px] font-bold">⚠ Exceeds the fund's current balance - approving this will fail.</p>
                      )}
                    </div>
                  ) : reqSlipPreview.type === 'new-fund' ? (
                    <div className="bg-page-bg border border-white/10 rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-fg/75">New Fund Name</span><span className="text-fg font-bold">{reqSlipPreview.fundName}</span></div>
                      {reqSlipPreview.description && <div className="flex justify-between"><span className="text-fg/75">Note</span><span className="text-fg font-bold text-right max-w-[60%]">{reqSlipPreview.description}</span></div>}
                      <div className="flex justify-between border-t border-white/10 pt-2 mt-1"><span className="text-fg/75">Opening Amount</span><span className="text-brand-text font-black text-lg tabular-nums">{peso(reqSlipPreview.amount)}</span></div>
                    </div>
                  ) : reqSlipPreview.type === 'fund-replenish' ? (() => {
                    // "Top up to full" resolves to the fund's own initialAmount
                    // at approval time, not now - the preview below computes
                    // it from the live balance we just fetched so the reviewer
                    // sees the real number, not a placeholder.
                    const willBe = reqSlipPreview.amount > 0
                      ? (reqSlipFundBalance !== null ? reqSlipFundBalance + reqSlipPreview.amount : null)
                      : (rfFunds.find(f => String(f._id) === String(reqSlipPreview.fundId))?.initialAmount ?? null);
                    return (
                      <div className="bg-page-bg border border-white/10 rounded-lg p-4 space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-fg/75">Fund</span><span className="text-fg font-bold">{reqSlipPreview.fundName}</span></div>
                        {reqSlipPreview.description && <div className="flex justify-between"><span className="text-fg/75">Note</span><span className="text-fg font-bold text-right max-w-[60%]">{reqSlipPreview.description}</span></div>}
                        <div className="flex justify-between border-t border-white/10 pt-2 mt-1">
                          <span className="text-fg/75">Amount</span>
                          <span className="text-brand-text font-black text-lg tabular-nums">{reqSlipPreview.amount > 0 ? peso(reqSlipPreview.amount) : 'Top up to full'}</span>
                        </div>
                        {/* Live balance preview - money coming IN this time, so added. */}
                        {reqSlipFundBalance !== null && (
                          <div className="flex justify-between border-t border-white/10 pt-2 mt-1 text-xs">
                            <span className="text-fg/70">Current Balance → After</span>
                            <span className="font-mono tabular-nums">
                              <span className="text-fg/65">{peso(reqSlipFundBalance)}</span>
                              <span className="text-fg/65 mx-1">→</span>
                              <span className="text-fg font-bold">{willBe !== null ? peso(willBe) : '-'}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })() : (
                    <div className="bg-page-bg border border-white/10 rounded-lg p-4 space-y-3 text-sm">
                      <div className="flex justify-between"><span className="text-fg/75">Supplier</span><span className="text-fg font-bold">{reqSlipPreview.supplier || 'Unassigned'}</span></div>
                      <div className="space-y-1">
                        {(reqSlipPreview.lines || []).map((l, i) => (
                          <div key={i} className="flex items-center justify-between text-xs text-fg/70">
                            <span className="truncate pr-2">{l.itemCode ? `${l.itemCode} · ` : ''}{l.itemName}</span>
                            <span className="whitespace-nowrap font-mono">{l.orderedQty} × {peso(l.unitCost)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between border-t border-white/10 pt-2"><span className="text-fg/75">Est. Total</span><span className="text-brand-text font-black text-lg tabular-nums">{peso(reqSlipPreview.estTotal)}</span></div>
                      {reqSlipPreview.notes && <p className="text-fg/70 text-xs italic">{reqSlipPreview.notes}</p>}
                    </div>
                  )}

                  {reqSlipPreview.status === 'Rejected' && reqSlipPreview.rejectionReason && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <p className="text-[10px] text-danger font-black uppercase tracking-widest mb-1">Rejection Reason</p>
                      <p className="text-fg/70 text-xs">{reqSlipPreview.rejectionReason}</p>
                    </div>
                  )}

                  {reqSlipPreview.status === 'Approved' && reqSlipPreview.resultRefLabel && (
                    <p className="text-fg/70 text-xs">Posted as <span className="text-fg font-bold font-mono">{reqSlipPreview.resultRefLabel}</span></p>
                  )}

                  {/* Signature block - Prepared By, then Approved By beneath it once set */}
                  <div className="border-t border-white/10 pt-4 space-y-4">
                    <div>
                      <p className="text-[10px] text-fg/70 font-bold uppercase tracking-widest mb-1">Prepared By</p>
                      <p className="text-fg font-black text-sm border-b border-white/20 pb-1.5">{reqSlipPreview.preparedBy || '-'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-fg/70 font-bold uppercase tracking-widest mb-1">Approved By</p>
                      {reqSlipPreview.approvedBy ? (
                        <p className="text-fg font-black text-sm border-b border-white/20 pb-1.5">
                          {reqSlipPreview.approvedBy}
                          <span className="text-fg/70 font-bold text-[10px] ml-2">{new Date(reqSlipPreview.approvedAt).toLocaleDateString()}</span>
                        </p>
                      ) : reqSlipPreview.status === 'Rejected' ? (
                        <p className="text-danger font-bold text-sm border-b border-white/20 pb-1.5">Rejected by {reqSlipPreview.rejectedBy}</p>
                      ) : (
                        <p className="text-fg/65 font-bold text-sm border-b border-white/10 pb-1.5 italic">Pending approval</p>
                      )}
                    </div>
                  </div>
                </div>
                {reqSlipPreview.status === 'Pending' && (
                  <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
                    <button onClick={() => { setReqSlipRejecting(reqSlipPreview); setReqSlipRejectReason(''); setReqSlipPreview(null); }} disabled={reqSlipBusy}
                      className="text-sm font-bold px-4 py-2 rounded-xl text-danger transition disabled:opacity-40">Reject</button>
                    <button onClick={() => { approveReqSlip(reqSlipPreview); setReqSlipPreview(null); }} disabled={reqSlipBusy}
                      className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-on-brand font-bold text-sm px-5 py-2 rounded-xl transition">Approve</button>
                  </div>
                )}
              </div>
            </div>
          )}

          <ExportAllTab
            ledgerSubTab={ledgerSubTab} exportDatasets={exportDatasets} exportPicked={exportPicked} EXPORT_REPORTS={EXPORT_REPORTS} setExportPicked={setExportPicked} apiFetch={apiFetch}
            can={can} isSuperAdmin={isSuperAdmin} BUSINESS_TYPE={BUSINESS_TYPE} parseImportFile={parseImportFile} fetchSuppliers={fetchSuppliers} fetchBills={fetchBills}
            fetchExpenses={fetchExpenses} fetchERPData={fetchERPData} downloadFullBackup={downloadFullBackup} backupBusy={backupBusy} restoreFullBackup={restoreFullBackup} backupProgress={backupProgress}
            exportAllBusy={exportAllBusy} exportAllRange={exportAllRange} setExportAllRange={setExportAllRange} exportProgress={exportProgress} renderProgress={renderProgress} downloadAllExports={downloadAllExports} />

          {ledgerSubTab === 'bookshealth' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-5 max-w-3xl">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
                <div>
                  <h3 className="text-lg font-black text-fg">Books Health</h3>
                  <p className="text-fg/65 text-xs mt-0.5 max-w-prose">
                    Every screen is a subledger - open invoices, unpaid bills, stock, deposits - and each one has an account behind it that should match. A red line means the two disagree.
                  </p>
                </div>
                <button onClick={loadBooksHealth} disabled={bookshealthLoading}
                  className="bg-brand hover:bg-brand/90 text-on-brand font-bold text-sm px-4 py-2 rounded-lg transition disabled:opacity-50">
                  {bookshealthLoading ? 'Checking…' : 'Run checks'}
                </button>
              </div>

              {bookshealth?.error ? (
                <p className="text-danger text-sm font-bold mt-4">{bookshealth.error}</p>
              ) : bookshealth ? (
                <div className="mt-4">
                  <div className={`rounded-xl px-4 py-3 mb-4 border ${bookshealth.failing === 0
                    ? 'bg-green-500/10 border-green-500/25 text-success'
                    : 'bg-red-500/10 border-red-500/25 text-danger'}`}>
                    <p className="font-black text-sm">
                      {bookshealth.failing === 0
                        ? 'Everything ties out.'
                        : `${bookshealth.failing} check${bookshealth.failing === 1 ? '' : 's'} need attention.`}
                    </p>
                    <p className="text-[11px] text-fg/70 mt-0.5">Checked {new Date(bookshealth.checkedAt).toLocaleString()}</p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-fg/65 border-b border-white/10">
                          <th className="text-left font-bold py-2">Check</th>
                          <th className="text-right font-bold py-2">Documents</th>
                          <th className="text-right font-bold py-2">Ledger</th>
                          <th className="text-right font-bold py-2">Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(bookshealth.checks || []).map(c => (
                          <tr key={c.key} className={`border-b border-white/5 ${c.ok ? '' : 'bg-red-500/[0.06]'}`}>
                            <td className="py-2.5 pr-3">
                              <span className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.ok ? 'bg-success' : 'bg-danger'}`} />
                                <span className="text-fg font-semibold">{c.label}</span>
                              </span>
                              {!c.ok && <span className="block text-[11px] text-fg/65 mt-1 pl-3.5 leading-snug">{c.fix}</span>}
                              {/* A count check (the stock card) names the items that do not agree. */}
                              {!c.ok && c.count && (c.detail || []).length > 0 && (
                                <ul className="mt-1.5 pl-3.5 space-y-0.5 text-[11px] text-fg/80">
                                  {c.detail.slice(0, 10).map(d => (
                                    <li key={d.itemName} className="tabular-nums">{d.itemName}: on hand {d.onHand} {d.unit}, stock card {d.cardTotal} {d.unit} (off by {d.difference})</li>
                                  ))}
                                  {c.detail.length > 10 && <li>…and {c.detail.length - 10} more</li>}
                                </ul>
                              )}
                            </td>
                            <td className="py-2.5 text-right font-mono tabular-nums text-fg/85">{c.count ? `${c.documents} items` : money2(c.documents)}</td>
                            <td className="py-2.5 text-right font-mono tabular-nums text-fg/85">{c.count ? `${c.ledger} agree` : money2(c.ledger)}</td>
                            <td className={`py-2.5 text-right font-mono tabular-nums font-bold ${c.ok ? 'text-fg/65' : 'text-danger'}`}>{c.count ? `${c.difference} off` : money2(c.difference)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {(bookshealth.vat?.outputVat > 0 || bookshealth.vat?.inputVat > 0) && (
                    <p className="text-[11px] text-fg/65 mt-3 leading-snug">
                      VAT held: {money2(bookshealth.vat.outputVat)} collected, {money2(bookshealth.vat.inputVat)} creditable, {money2(bookshealth.vat.netPayable)} owed. See the VAT Return report.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-fg/70 text-sm mt-4">Press Run checks.</p>
              )}
            </div>
          )}

          {ledgerSubTab === 'tenancy' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-6">
              <div>
                <h3 className="text-xl font-black text-fg flex items-center gap-2"><ShieldCheck size={18} className="text-brand-text"/> Tenancy Health</h3>
                <p className="text-fg/70 text-xs font-bold uppercase tracking-widest mt-1">Verify every doc is stamped with this server's business type</p>
              </div>

              {tenancyError && !tenancyReport ? (
                <div className="bg-page-bg border border-danger/40 rounded-xl p-4">
                  <p className="text-danger text-sm font-bold">{tenancyError}</p>
                  <button onClick={fetchTenancyReport}
                    className="mt-3 bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg font-bold px-4 py-2 rounded-lg uppercase tracking-widest text-xs transition">
                    Try Again
                  </button>
                </div>
              ) : !tenancyReport ? (
                tenancyProgress
                  ? renderProgress(
                      { ...tenancyProgress, label: tenancyProgress.current ? `Checked ${tenancyProgress.current}` : 'Starting...' },
                      'Checking collections...')
                  : <p className="text-fg/70 text-sm italic">Starting the check...</p>
              ) : (
                <>
                  <div className="bg-page-bg border border-white/10 rounded-xl p-4">
                    <p className="text-[10px] uppercase tracking-widest text-fg/70 font-bold mb-1">Current Business Type</p>
                    <p className="text-2xl font-black text-brand-text">{tenancyReport.currentBusinessType}</p>
                    <p className={`mt-2 text-[10px] uppercase tracking-widest font-black ${tenancyReport.isClean ? 'text-success' : 'text-warning'}`}>
                      {tenancyReport.isClean
                        ? `✓ Clean - all docs stamped across ${tenancyReport.scannedCollections} collections`
                        : `⚠ ${(tenancyReport.flagged || []).length} of ${tenancyReport.scannedCollections} collections need attention`}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-fg/70 border-b border-white/10 text-[10px] uppercase tracking-widest">
                          <th className="pb-2">Collection</th>
                          <th className="pb-2 text-right">Missing businessType</th>
                          <th className="pb-2 text-right">Other businessType</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(tenancyShowAll ? tenancyReport.rows : (tenancyReport.flagged || [])).map(r => (
                          <tr key={r.collection} className="border-b border-white/5">
                            <td className="py-2 text-fg font-bold">{r.collection}</td>
                            <td className={`py-2 text-right font-mono tabular-nums ${r.timedOut ? 'text-warning' : r.missingBusinessType > 0 ? 'text-warning font-black' : 'text-fg/70'}`}>{r.timedOut ? 'timed out' : r.missingBusinessType.toLocaleString()}</td>
                            <td className={`py-2 text-right font-mono tabular-nums ${r.timedOut ? 'text-warning' : r.otherBusinessType > 0 ? 'text-danger font-black' : 'text-fg/70'}`}>{r.timedOut ? '-' : r.otherBusinessType.toLocaleString()}</td>
                          </tr>
                        ))}
                        {!tenancyShowAll && (tenancyReport.flagged || []).length === 0 && (
                          <tr><td colSpan={3} className="py-3 text-fg/70 italic">No mis-stamped or unstamped docs in any scanned collection.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={fetchTenancyReport} className="bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg font-bold px-4 py-2 rounded-lg uppercase tracking-widest text-xs transition">
                      Refresh
                    </button>
                    <button onClick={() => setTenancyShowAll(v => !v)} className="bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg font-bold px-4 py-2 rounded-lg uppercase tracking-widest text-xs transition">
                      {tenancyShowAll ? 'Show Only Issues' : `Show All ${tenancyReport.scannedCollections} Collections`}
                    </button>
                    <button onClick={runTenancyRebackfill} disabled={tenancyBusy}
                      className="bg-brand text-on-brand font-black px-4 py-2 rounded-lg uppercase tracking-widest text-xs hover:bg-brand/90 transition disabled:opacity-50">
                      {tenancyBusy ? 'Running…' : 'Run Re-Backfill'}
                    </button>
                  </div>
                  <p className="text-[10px] text-fg/70">Scans every collection carrying a business type. "Other businessType" means the doc is stamped for the other deployment (fb vs log) - hub partners are separate databases and never write here, so a foreign stamp is a mis-stamp. Re-backfill only stamps docs missing the field - it never overwrites an existing different value.</p>
                </>
              )}
            </div>
          )}

          </div>
        </div>
  );
}
