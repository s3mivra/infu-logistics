import React, { useState, useEffect, useRef } from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag, Receipt, History, HandCoins, Wallet } from 'lucide-react';
import { usePagination } from '../../shared/usePagination';
import Pager from '../../shared/Pager';
import ExpensesPage from './ExpensesPage';
import * as ui from '../../shared/ui';

const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();

// ── LedgerTab - extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
export default function LedgerTab({ ctx }) {
  // Destructure everything from ctx
  // ── Auto-generated from ctx - do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  // ── Auto-generated from ctx - do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  // ── Auto-generated from ctx - do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  const {
    API_URL, AUDIT_PAGE_SIZE, BIZ_NAME, COMP_REASON_LABELS, FRONTEND_URL,
    HIST_PAGE_SIZE, POS_PER_PAGE, SHIFT_HIST_PAGE_SIZE, accountingItemsPerPage, accountingPage,
    journalSearch, setJournalSearch,
    activeAdmin, activeInventoryItem, activeTab, addInventory, addMaterialToRecipe, can,
    addOnForm, addSize, analyticsData, analyticsLoading, apiFetch,
    applyComplimentary, applyDiscount, applyItemDiscount, arOutstanding, arAgeing, fetchArAgeing, archiveDay, fetchExpenses,
    openArHistory, todayLocal,
    arReport, arReportAsOf, setArReportAsOf, fetchArReport,
    apReport, apReportAsOf, setApReportAsOf, fetchApReport,
    supplierPayments, supPayRange, setSupPayRange, fetchSupplierPayments,
    collectionReport, collRange, setCollRange, fetchCollectionReport,
    checkRegister, checkFilter, setCheckFilter, fetchChecks, actOnCheck,
    changeRequests, canApprovePricing, fetchChangeRequests, actOnChangeRequest,
    priceChangeLog, priceLogRange, setPriceLogRange, fetchPriceChangeLog,
    archivedOrders, auditCancelPage, auditCompPage, auditDiscPage, auditFilter,
    auditStaffPage, bsData, calcRecipeCost, cashOnHand, cashTendered,
    catForm, categories, closeRfFund, collapsedOrders, compOverride,
    compReasonNotes, compReasonTypes, compSelections, confirmPosItem, currentEntries,
    currentInventory, currentOrders, currentPage, currentPricingProducts, currentProducts,
    dailyMovement, deleteAddOn, deleteCategory, deleteInventory, deleteProduct,
    departmentFilter, discountForm, discountInputs, discountList, discounts,
    displayOrders, downloadImportTemplate, downloadJournalCsv, editInvForm, editInvModal,
    editInvSubmitting, editPriceId, editPriceVal, editingCategory, editingProduct,
    effectiveDisplay, eodLockedAt, eodStatus, expandedBatchRows, expandedDays,
    expandedOrderLists, expenseCategories, expenseModal, exportAllToPDF, exportAnalyticsToPDF,
    exportDayToPDF, exportInventoryToPDF, exportLedgerToPDF, fetchAnalytics, fetchArOutstanding,
    fetchBalanceSheet, fetchData, fetchEODData, fetchERPData, fetchExpenseCategories, setBulkOpInProgress,
    exportRevolvingFundsPDF,
    fetchOrders, fetchPnl, fetchRfFunds, fetchRfTxs, fetchShiftHistory,
    fetchStockHistory, filteredOrders, formData, getEstimatedStock, globalAddOns,
    groupedArchives, handleImageUpload, handleInlinePriceUpdate, handleRestockSubmit, handleSaveAddOn,
    handleSaveCategory, handleSaveProduct, handleVoidOrder, historyItemName, historyModalOpen,
    historyPage, historySubTab, importModal, importRows, importSubmitting,
    invBadgeCount, invForm, invItemsPerPage, invPage, invSubTab,
    inventory, isPosOpen, isStatusMenuOpen, isSuperAdmin, itemDisplay,
    itemsPerPage, jeForm, journalEntries, ledgerSubTab, navMode,
    newDiscount, openEditInventory, openProductModal, orderFilter, orders,
    ordersItemsPerPage, ordersPage, parseImportFile, paymentSelections, peso,
    physicalCounts, pnlData, pnlRange, pnlMonthly, pnlmRange, setPnlmRange, pnlmView, setPnlmView, fetchPnlMonthly, exportPnlMonthlyPDF, bsMonthly, bsmRange, setBsmRange, bsmView, setBsmView, fetchBsMonthly, exportBsMonthlyPDF, posActiveAddOns, posActiveSize,
    posCart, posCashTendered, posCategory, posCheckoutModal, posCustomerName,
    posCustomerPhone, posDeliveryAddress, posDeliveryFee, posDeliveryFeeNum, posDiscountAmt,
    posDiscountType, posDiscountValue, posGrandTotal, posPage, posPayment,
    posScheduledTime, posSearch, posSelectedProduct, posSubtotal, posTable,
    pricingItemsPerPage, pricingPage, printOrderSlip, printXReading, products,
    removeAddOnFromOrder, removeComplimentary, removeMaterial, removeSize, restockData,
    rfActiveFund, rfDisbForm, rfDisbModal, rfDisbSubmitting, rfFunds,
    rfLoading, rfNewForm, rfNewModal, rfNewSubmitting, rfReplForm,
    rfReplModal, rfReplSubmitting, rfTxPage, rfTxPages, rfTxTotal,
    rfTxs, scpwdOpen, setAccountingPage, setActiveInventoryItem, setActiveTab,
    setAddOnForm, setAuditCancelPage, setAuditCompPage, setAuditDiscPage, setAuditFilter,
    setAuditStaffPage, setCashTendered, setCatForm, setCollapsedOrders, setCompOverride,
    setCompReasonNotes, setCompReasonTypes, setCompSelections, setCurrentPage, setDepartmentFilter,
    setDiscountForm, setDiscountInputs, setEditInvForm, setEditInvModal, setEditPriceId,
    setEditPriceVal, setEditingCategory, setEditingProduct, setExpandedBatchRows, setExpenseModal,
    setFormData, setHistoryItemName, setHistoryModalOpen, setHistoryPage, setHistorySubTab,
    setImportModal, setImportRows, setInvForm, setInvPage, setInvSubTab,
    setIsPosOpen, setIsStatusMenuOpen, setJeForm, setJournalEntries, setLedgerSubTab,
    setNewDiscount, setOrderFilter, setOrdersPage, setPaymentSelections, setPhysicalCounts,
    setPnlRange, setPosActiveAddOns, setPosActiveSize, setPosCart, setPosCashTendered,
    setPosCategory, setPosCheckoutModal, setPosCustomerName, setPosCustomerPhone, setPosDeliveryAddress,
    setPosDeliveryFee, setPosDiscountType, setPosDiscountValue, setPosPage, setPosPayment,
    setPosScheduledTime, setPosSearch, setPosSelectedProduct, setPosTable, setPricingPage,
    setRestockData, setRfActiveFund, setRfDisbForm, setRfDisbModal, setRfNewForm,
    setRfNewModal, setRfReplForm, setRfReplModal, setRfTxs, setScpwdOpen,
    setSettleForm, setSettleModal, setSettleSubmitting, setShiftFilter, setShiftHistoryPage,
    setSpoilageForm, setSpoilageModal, setStockHistory, setVarianceNoteMode, setVarianceReasons,
    settleForm, settleModal, settleSubmitting, shiftFilter, shiftHistory,
    shiftHistoryPage, shiftHistoryTotal, spoilageForm, spoilageLoading, spoilageModal,
    standardAccounts, stockHistory, submitManualOrder, submitPhysicalCounts, submitRfDisb,
    submitRfNew, submitRfRepl, toggleDay, toggleOrderList,
    totalAccountingPages, totalInvPages, totalOrdersPages, totalPages, totalPricingPages,
    updateItemStatus, updateMaterialQty, updateSize, updateStatus, updatingOrders,
    users, varianceNoteMode, varianceReasons,
    apData, fetchApData, apPayModal, setApPayModal, apPayForm, setApPayForm, apPaySubmitting, submitApPayment, suppliers, fetchSuppliers,
    bills, billsFilter, setBillsFilter, fetchBills, billBusy,
    billCreate, setBillCreate, submitCreateBill,
    approveBill, rejectBill, scheduleBill,
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
    profitByCategory, fetchProfitByCategory,
    salesByPayment, sbpRange, setSbpRange, fetchSalesByPayment,
    salesSummary, sssRange, setSssRange, sssGroup, setSssGroup, sssRows, fetchSalesSummary, exportSalesSummaryPDF,
    salesLineItems, sliRange, setSliRange, fetchSalesLineItems, exportSalesLineItemsPDF,
    menuEngineering, fetchMenuEngineering, cashierVariance, fetchCashierVariance, purchaseOrder, fetchPurchaseOrder,
    commissions, fetchCommissions,
    exportPnlPDF, exportBalanceSheetPDF, exportPurchaseOrderPDF, reconcileInventory,
    exportArPDF, exportApPDF, exportPaymentsPDF,
    exportProfitByCategoryPDF, exportMenuEngineeringPDF, exportVariancePDF, exportCommissionsPDF,
    exportBillsPDF, exportAuditLogPDF, loadPdfLibs, addLogoToPDF, pdfMoney,
    coaAccounts, fetchCoa, coaParent, setCoaParent, coaNewName, setCoaNewName,
    coaEditId, setCoaEditId, coaEditName, setCoaEditName, coaBusy,
    addCoaChild, renameCoaChild, deleteCoaChild, toggleAccountActive, seedPaymentSubaccounts,
    cashAndBankAccounts, apAccounts, arAccounts,
    closedPeriods, fetchClosedPeriods, closePeriod, reopenPeriod,
    periodCloseForm, setPeriodCloseForm,
    auditLogEntries, auditLogPage, auditLogPages, auditLogFilter, setAuditLogFilter, fetchAuditLog,
    paymentMap, fetchPaymentMap, savePaymentMapping, resetPaymentMapping,
    tenancyReport, tenancyBusy, fetchTenancyReport, runTenancyRebackfill,
    backdateForm, setBackdateForm, backdateBusy, submitBackdateSale,
  } = ctx;

  // ── Stage 2 report views: self-contained fetches via ctx.apiFetch ──────────
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
    date: new Date().toISOString().slice(0, 10),
    customerName: '', paymentMethod: 'Cash', notes: '',
    discountPercent: 0, affectInventory: false, isComplimentary: false,
  });
  const [bdCart, setBdCart] = useState([]); // [{ productId, productCode, name, price, quantity }]
  const [bdSearch, setBdSearch] = useState('');
  const [bdBusy, setBdBusy] = useState(false);

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
  const bdRemove = (id) => setBdCart(prev => prev.filter(x => x.productId !== id));

  const bdGross = bdCart.reduce((s, x) => s + x.price * x.quantity, 0);
  const bdPct = bd.isComplimentary ? 0 : Math.max(0, Math.min(100, Number(bd.discountPercent) || 0));
  const bdDiscount = +(bdGross * bdPct / 100).toFixed(2);
  const bdTotal = bd.isComplimentary ? 0 : +(bdGross - bdDiscount).toFixed(2);

  const submitBackdateCart = async () => {
    if (!bd.date) return ui.alert('Pick the sale date.');
    if (bdCart.length === 0) return ui.alert('Add at least one product to the sale.');
    const label = bd.isComplimentary ? 'complimentary (₱0)' : `₱${bdTotal.toFixed(2)}`;
    const stockNote = bd.affectInventory ? '\n\nThis WILL reduce current inventory.' : '';
    if (!(await ui.confirm(`Record a backdated sale of ${label} on ${bd.date}?${stockNote}`))) return;
    setBdBusy(true);
    try {
      const r = await apiFetch('/api/admin/backdate-sale', { method: 'POST', body: JSON.stringify({
        date: bd.date, customerName: bd.customerName, paymentMethod: bd.paymentMethod, notes: bd.notes,
        discountPercent: bdPct, affectInventory: bd.affectInventory, isComplimentary: bd.isComplimentary,
        items: bdCart.map(x => ({ name: x.name, price: x.price, quantity: x.quantity, productId: x.productId, productCode: x.productCode })),
      }) });
      const d = await r.json();
      if (d.success) {
        ui.alert(`Backdated sale recorded: ${d.order.orderNumber}\nJournal ref: ${d.journalReference}`);
        setBdCart([]);
        setBd(b => ({ ...b, customerName: '', notes: '', discountPercent: 0, isComplimentary: false }));
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
  const [bdImportSettings, setBdImportSettings] = useState({ paymentMethod: 'Cash', affectInventory: false });
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

    // Transaction/client/date usually only repeat on the FIRST row of a sale
    // (exactly how a flat-columns import lays them out) - carry the
    // last-seen value forward onto the item-only rows that follow. Sheet-level
    // label values (above) seed the default so the label/value template works
    // even though nothing repeats per-row there.
    const byTrans = new Map();
    let skipped = 0;
    let curTrans = sheetTrans, curClient = sheetClient, curDate = sheetDate;
    for (let i = hIdx + 1; i < grid.length; i++) {
      const row = grid[i] || [];
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
      const itemsTotal = items.reduce((s, x) => s + x.price * x.quantity, 0);
      return { ...g, items, deliveryFee: sheetDeliveryFee, total: itemsTotal + sheetDeliveryFee, needsPaymentMethod };
    });
    return { groups, skipped, noHeader: false };
  };

  // Runs the parser across every selected sheet and merges the results into
  // one preview. Sheets are kept independent (no cross-sheet grouping) so a
  // repeated transaction no. across two tabs never silently merges. Any group
  // whose sheet left "Terms of Payment" blank is routed to the review queue
  // instead of the ready-to-import preview - we don't know how it was paid.
  const finishBackdateImport = async (wb, sheetNames) => {
    let allGroups = [], totalSkipped = 0, anyHeaderFound = false;
    setBdParseProgress({ done: 0, total: sheetNames.length });
    let i = 0;
    for (const name of sheetNames) {
      const sheet = wb.Sheets[name];
      if (sheet) {
        const grid = XLSX_sheetToGrid(wb, name);
        const { groups, skipped, noHeader } = parseBackdateGrid(grid, name);
        if (!noHeader) anyHeaderFound = true;
        allGroups = allGroups.concat(groups);
        totalSkipped += skipped;
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
    if (allGroups.length === 0) { ui.alert('No sale rows found under the header in the selected sheet(s).'); return; }

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
                notes: g.transNo ? `Imported - ${g.transNo}` : 'Imported from Excel',
                // The sheet's own transaction/invoice number - lets the server skip
                // this row as a duplicate if it (or an overlapping file) was already
                // imported under the same reference, instead of posting it twice.
                importRef: g.transNo || undefined,
                affectInventory: bdImportSettings.affectInventory, isComplimentary: false, discountPercent: 0,
                deliveryFee: g.deliveryFee || undefined,
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
      doc.save(`Backdate-Sale-History-${new Date().toISOString().slice(0, 10)}.pdf`);
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
    setBdQueueSaving(true);
    try {
      const row = bdQueueResolve.row;
      const r = await apiFetch(`/api/admin/backdate-sale/queue/${row._id}/save`, {
        method: 'POST',
        body: JSON.stringify({ paymentMethod: bdQueueResolve.paymentMethod, affectInventory: !!bdQueueResolve.affectInventory }),
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
    if (!(await ui.confirm(`Discard the queued sale for "${row.client || 'this row'}"? It will not be posted.`))) return;
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
  const [ptaxRange, setPtaxRange] = useState({ start: '', end: '' });
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
    doc.save(`Trial-Balance-${new Date().toISOString().slice(0, 10)}.pdf`);
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
  const [reqSlipStatusFilter, setReqSlipStatusFilter] = useState('Pending');
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
      const r = await apiFetch(`/api/requisition-slips/${slip._id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json();
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
  const reqSummary = (s) => s.type === 'petty-cash' ? `${s.fundName} — ${s.description}`
    : s.type === 'new-fund' ? `Open "${s.fundName}"${s.description ? ` — ${s.description}` : ''}`
    : s.type === 'fund-replenish' ? `Top up ${s.fundName}${s.description ? ` — ${s.description}` : ''}`
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
    doc.save(`Requisition-Slips-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // Auto-load the active view's data on entry (nav landing or sub-tab click).
  useEffect(() => {
    if (ledgerSubTab === 'trial') loadTrial();
    if (ledgerSubTab === 'salessummary' && !salesSummary) fetchSalesSummary();
    if (ledgerSubTab === 'salesline' && !salesLineItems) fetchSalesLineItems();
    if (ledgerSubTab === 'backdate' && !bdHistory) fetchBdHistory(1);
    if (ledgerSubTab === 'backdate' && !bdQueue) fetchBdQueue(1);
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
  const sssPage  = usePagination(sssRows, 15);
  const sliPage  = usePagination(salesLineItems?.rows, 15);
  const pbcPage  = usePagination(profitByCategory?.categories, 10);
  const mePage   = usePagination(menuEngineering?.items, 10);
  const cvPage   = usePagination(cashierVariance?.cashiers, 10);
  const cmPage   = usePagination(commissions?.sellers, 10);
  const billsPage = usePagination(bills, 12);
  const poPage   = usePagination(purchaseOrder?.lines, 10);

  // Sub-tab nav, grouped. These used to be one long horizontally-scrolling
  // strip of 17 (reports) / 12 (ledger) buttons, which meant scrolling blind to
  // find anything. Grouping by what the page is FOR lets the whole set wrap and
  // stay visible at once.
  const REPORT_TAB_GROUPS = [
    ['Sales', [
      ['salessummary',  'Sales Summary',          BarChart3],
      ['salesline',     'Sales Line Items',       FileText],
      ['payments',      'By Payment',             Banknote],
      ['profitcat',     'By Category',            BarChart2],
      ['menueng',       'Menu Engineering',       TrendingUp],
    ]],
    ['Receivable', [
      ['arreport',      'A/R Report',             Truck],
      ['collections',   'Collections',            Banknote],
    ]],
    ['Payable', [
      ['apreport',      'A/P Report',             Receipt],
      ['supplierpay',   'Supplier Payments',      Banknote],
      ['checkvouchers', 'Check Vouchers',         Receipt],
      ['advances',      'Advances',               HandCoins],
    ]],
    ['Financials', [
      ['pnlmonthly',    'Monthly P&L',            BarChart3],
      ['bsmonthly',     'Monthly Balance Sheet',  BarChart3],
      ['percentagetax', 'Percentage Tax',         FileText],
    ]],
    ['Operations', [
      ['pricelog',      'Price Changes',          TrendingUp],
      ['variance',      'Cashier Variance',       Users],
      ['commissions',   'Commissions',            Users],
    ]],
  ];
  const LEDGER_TAB_GROUPS = [
    ['Books', [
      ['journal',    'General Ledger',      FileText],
      ['trial',      'Trial Balance',       BarChart2],
      ['pnl',        'P&L',                 TrendingUp],
      ['balance',    'Balance Sheet',       BarChart2],
    ]],
    ['AR & AP', [
      ['araap',      'AR & AP',             Truck],
      ['bills',      'Bills (AP)',          Receipt],
    ]],
    ['Cash Out', [
      ['revolving',  'Revolving Funds',     RefreshCw],
      ['expenses',   'Expenses',            Receipt],
    ]],
    ['Setup', [
      ['accperiods', 'Accounts & Periods',  Settings],
      ['backdate',   'Backdate Sale',       Clock],
      // Always visible to any staff - the server itself scopes what comes back:
      // without requisitions.view you only ever see your OWN filed slips (so you
      // can check "is my request still pending"), not anyone else's. Approve or
      // Reject still require requisitions.approve regardless.
      ['approvals',  'Approvals',           ShieldCheck],
    ]],
  ];

  return (
        <div className="space-y-4">

          {/* SUB-TAB NAV. The group shown depends on the top-level tab: Reports vs
              Ledger (both render from this component). Merged pages (AR & AP, and
              Accounts & Periods) stack several sections on one page. */}
          <div className="bg-surface border border-white/10 rounded-2xl p-3 space-y-1.5">
            {(activeTab === 'reports' ? REPORT_TAB_GROUPS : LEDGER_TAB_GROUPS).map(([groupLabel, items]) => (
              <div key={groupLabel} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
                <span className="text-[9px] font-black uppercase tracking-widest text-fg/25 sm:w-20 sm:text-right shrink-0 sm:pt-3">
                  {groupLabel}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {items.map(([id, label, Icon]) => (
                    <button
                      key={id}
                      onClick={() => {
                  setLedgerSubTab(id);
                  // Merged "Accounts & Periods" page: load all its sections.
                  if (id === 'accperiods') { fetchCoa(); fetchClosedPeriods(); fetchPaymentMap(); fetchOpeningBalances(); }
                  // Merged "AR & AP" page.
                  if (id === 'araap') { fetchArOutstanding(); fetchArAgeing(); fetchApData(); fetchSuppliers(); }
                  if (id === 'bills') { fetchBills(); fetchSuppliers(); fetchCoa(); }
                  if (id === 'pnl' && !pnlData) fetchPnl();
                  if (id === 'trial') loadTrial();
                  if (id === 'percentagetax') loadPtax();
                  if (id === 'pnlmonthly' && !pnlMonthly) fetchPnlMonthly();
                  if (id === 'balance' && !bsData) fetchBalanceSheet();
                  if (id === 'bsmonthly' && !bsMonthly) fetchBsMonthly();
                  if (id === 'salessummary') fetchSalesSummary();
                  if (id === 'salesline') fetchSalesLineItems();
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
                      }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-[11px] uppercase tracking-wider transition min-h-[38px] ${ledgerSubTab === id ? 'bg-brand text-white shadow-elev-1' : 'bg-white/[0.03] text-fg/50 hover:text-fg hover:bg-white/8'}`}
                    >
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Section area. On the merged pages (Accounts & Periods, AR & AP) the
              stacked sections flow into two columns so they fill the width instead
              of leaving a big empty right side; every other page stays single-column. */}
          <div className={(ledgerSubTab === 'accperiods' || ledgerSubTab === 'araap')
            ? 'grid lg:grid-cols-2 gap-4 items-start'
            : 'space-y-4'}>

          {/* ── TRIAL BALANCE ─────────────────────────────────────────────────── */}
          {ledgerSubTab === 'trial' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h3 className="text-lg font-black text-fg">Trial Balance</h3>
                  <p className="text-fg/60 text-xs">All accounts with their net debit / credit balance.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={loadTrial} disabled={tbLoading} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition">
                    <RefreshCw size={12} className={tbLoading ? 'animate-spin' : ''} /> Refresh
                  </button>
                  {tb && !tb.error && <button onClick={exportTrialBalancePDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> PDF</button>}
                </div>
              </div>
              {tb?.error ? (
                <p className="text-red-300 text-sm font-bold">{tb.error}</p>
              ) : !tb ? (
                <p className="text-fg/40 text-sm">Loading…</p>
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
                        <td className="py-2" colSpan={2}>Totals {tb.balanced ? <span className="text-green-400 text-xs ml-1">Balanced</span> : <span className="text-red-400 text-xs ml-1">Out of balance</span>}</td>
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
          {ledgerSubTab === 'salessummary' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h3 className="text-lg font-black text-fg">Sales Summary</h3>
                  <p className="text-fg/60 text-xs">Completed sales broken down by payment channel.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="date" value={sssRange.start} max={sssRange.end || undefined}
                    onChange={e => setSssRange(r => ({ ...r, start: e.target.value }))}
                    className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-2 text-fg text-xs font-bold outline-none focus:border-brand" />
                  <span className="text-fg/40 text-xs font-bold">to</span>
                  <input type="date" value={sssRange.end} min={sssRange.start || undefined}
                    onChange={e => setSssRange(r => ({ ...r, end: e.target.value }))}
                    className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-2 text-fg text-xs font-bold outline-none focus:border-brand" />
                  <button onClick={fetchSalesSummary} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/80 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><RefreshCw size={12} /> Refresh</button>
                  {salesSummary && <button onClick={exportSalesSummaryPDF} className="flex items-center gap-1.5 bg-white/5 text-fg/70 hover:text-fg hover:bg-white/10 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> PDF</button>}
                </div>
              </div>
              {!sssRows || sssRows.length === 0 ? (
                <p className="text-fg/80 text-sm">No completed sales in range. Press Refresh.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-fg/80 text-[10px] font-black uppercase tracking-wider text-left border-b border-white/10">
                        <th className="py-2">Date</th>
                        <th className="py-2">Customer ID</th><th className="py-2">Customer Name</th>
                        <th className="py-2">Order</th>
                        <th className="py-2 text-right">Cash</th><th className="py-2 text-right">E-Wallet</th>
                        <th className="py-2 text-right">Bank</th><th className="py-2 text-right">Delivery</th><th className="py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="text-fg/75">
                      {sssRows.map((row, i) => {
                        const isDayRow = row.orderNumber == null;
                        return (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1.5 text-fg/70 text-xs">{row.date ? new Date(row.date).toLocaleDateString() : ''}</td>
                          <td className="py-1.5 font-mono text-xs text-fg/70">{isDayRow ? '-' : (row.customerId || '-')}</td>
                          <td className="py-1.5 text-xs text-fg/70">{isDayRow ? '-' : (row.customerName || 'Guest')}</td>
                          <td className="py-1.5 font-mono text-xs text-fg/70">{isDayRow ? row.count : row.orderNumber}</td>
                          <td className="py-1.5 text-right font-mono">{row.cash ? money2(row.cash) : ''}</td>
                          <td className="py-1.5 text-right font-mono">{row.ewallet ? money2(row.ewallet) : ''}</td>
                          <td className="py-1.5 text-right font-mono">{row.bank ? money2(row.bank) : ''}</td>
                          <td className="py-1.5 text-right font-mono">{row.delivery ? money2(row.delivery) : ''}</td>
                          <td className="py-1.5 text-right font-mono font-bold text-fg/90">{money2(row.total)}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                    {salesSummary?.totals && (
                      <tfoot>
                        <tr className="font-black text-fg border-t-2 border-white/20">
                          <td className="py-2" colSpan={4}>Totals</td>
                          <td className="py-2 text-right font-mono">{money2(salesSummary.totals.cash)}</td>
                          <td className="py-2 text-right font-mono">{money2(salesSummary.totals.ewallet)}</td>
                          <td className="py-2 text-right font-mono">{money2(salesSummary.totals.bank)}</td>
                          <td className="py-2 text-right font-mono">{money2(salesSummary.totals.delivery)}</td>
                          <td className="py-2 text-right font-mono text-brand">{money2(salesSummary.totals.total)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── SALES LINE ITEMS (item-level detail) ────────────────────────────── */}
          {ledgerSubTab === 'salesline' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h3 className="text-lg font-black text-fg">Sales Line Items</h3>
                  <p className="text-fg/60 text-xs">One row per item ordered - item code, item, quantity, per line.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="date" value={sliRange.start} onChange={e => setSliRange(p => ({ ...p, start: e.target.value }))}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                  <span className="text-fg/60 font-bold text-sm">→</span>
                  <input type="date" value={sliRange.end} onChange={e => setSliRange(p => ({ ...p, end: e.target.value }))}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                  <button onClick={fetchSalesLineItems} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/80 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><RefreshCw size={12} /> Load</button>
                  {salesLineItems && <button onClick={exportSalesLineItemsPDF} className="flex items-center gap-1.5 bg-white/5 text-fg/80 hover:text-fg hover:bg-white/10 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> PDF</button>}
                </div>
              </div>
              {!salesLineItems ? (
                <p className="text-fg/60 text-sm">Pick a range and press Load.</p>
              ) : sliPage.pageItems.length === 0 ? (
                <p className="text-fg/60 text-sm">No completed sales in range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-fg/80 text-[10px] font-black uppercase tracking-wider text-left border-b border-white/10">
                        <th className="py-2">Date</th>
                        <th className="py-2">Customer ID</th><th className="py-2">Customer Name</th>
                        <th className="py-2">Order</th>
                        <th className="py-2">Item Code</th><th className="py-2">Item</th>
                        <th className="py-2 text-right">Qty</th>
                        <th className="py-2 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="text-fg/75">
                      {sliPage.pageItems.map((row, i) => (
                        <tr key={i} className={`border-b border-white/5 ${row.isComponent ? 'bg-white/[0.02]' : ''}`}>
                          <td className="py-1.5 text-fg/70 text-xs">{row.isComponent ? '' : (row.date ? new Date(row.date).toLocaleDateString() : '')}</td>
                          <td className="py-1.5 font-mono text-xs text-fg/70">{row.isComponent ? '' : (row.customerId || '-')}</td>
                          <td className="py-1.5 text-xs text-fg/70">{row.isComponent ? '' : (row.customerName || 'Guest')}</td>
                          <td className="py-1.5 font-mono text-xs text-fg/70">{row.isComponent ? '' : row.orderNumber}</td>
                          <td className="py-1.5 font-mono text-xs text-fg/70">{row.itemCode || (row.isComponent ? '' : '-')}</td>
                          <td className={`py-1.5 text-xs ${row.isComponent ? 'text-fg/45 pl-4' : 'text-fg/70'} ${row.isCombo ? 'font-bold' : ''}`}>
                            {row.isComponent ? `↳ ${row.itemName}` : row.itemName}{row.isCombo ? ' (promo)' : ''}
                          </td>
                          <td className="py-1.5 text-right font-mono">{row.quantity}</td>
                          <td className="py-1.5 text-right font-mono font-bold text-fg/90">{row.isComponent ? <span className="text-fg/30 font-normal not-italic">included</span> : money2(row.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-black text-fg border-t-2 border-white/20">
                        <td className="py-2" colSpan={7}>Total</td>
                        <td className="py-2 text-right font-mono text-brand">{money2(salesLineItems.grandTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  <div className="px-3 pt-2"><Pager {...sliPage} label="lines" /></div>
                </div>
              )}
            </div>
          )}

          {/* ── PERCENTAGE TAX ────────────────────────────────────────────────── */}
          {ledgerSubTab === 'percentagetax' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-5 max-w-2xl">
              <h3 className="text-lg font-black text-fg mb-1">Percentage Tax</h3>
              <p className="text-fg/60 text-xs mb-4">Non-VAT percentage tax on net collected sales for a period.</p>
              <div className="flex items-end gap-2 mb-4 flex-wrap">
                <label className="text-xs font-bold text-fg/40">Start
                  <input type="date" value={ptaxRange.start} onChange={(e) => setPtaxRange((r) => ({ ...r, start: e.target.value }))} className="block bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg mt-1" />
                </label>
                <label className="text-xs font-bold text-fg/40">End
                  <input type="date" value={ptaxRange.end} onChange={(e) => setPtaxRange((r) => ({ ...r, end: e.target.value }))} className="block bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg mt-1" />
                </label>
                <button onClick={loadPtax} disabled={ptaxLoading} className="bg-brand hover:bg-brand/90 text-white font-bold text-sm px-4 py-2 rounded-lg transition">{ptaxLoading ? 'Loading…' : 'Compute'}</button>
                {ptax && !ptax.error && <button onClick={exportPercentageTaxPDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition"><Download size={12} /> PDF</button>}
              </div>
              {ptax?.error ? (
                <p className="text-red-300 text-sm font-bold">{ptax.error}</p>
              ) : ptax && !ptax.error ? (
                <div className="space-y-1">
                  <p className="text-fg/40 text-xs mb-2">{ptax.orders} completed order(s) in range.</p>
                  {(ptax.lines || []).map((l, i) => {
                    const isTax = i === (ptax.lines.length - 1);
                    return (
                      <div key={i} className={`flex justify-between text-sm py-2 ${isTax ? 'border-t-2 border-white/20 mt-1 font-black text-fg' : 'border-b border-white/5'}`}>
                        <span className={isTax ? '' : 'text-fg/60'}>{l.label}</span>
                        <span className={`font-mono font-bold ${isTax ? 'text-brand' : l.amount < 0 ? 'text-red-300' : 'text-fg/85'}`}>{money2(l.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-fg/40 text-sm">Pick a date range and press Compute.</p>
              )}
            </div>
          )}

          {(ledgerSubTab === 'coa' || ledgerSubTab === 'accperiods') && (
            <div className={`space-y-4${ledgerSubTab === 'accperiods' ? ' lg:row-span-2' : ''}`}>
            {/* ── OPENING BALANCES ──────────────────────────────────────────
                Onboarding a business that already has a history. Each row is an
                account's natural balance as a positive number; the server picks
                the debit/credit side and plugs the difference to Owner's
                Capital, so nobody hand-balances a multi-line entry. */}
            <div className="bg-surface border border-white/10 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
                <div>
                  <h3 className="text-fg font-black uppercase tracking-wider text-sm flex items-center gap-2">
                    <Wallet size={15} className="text-brand" /> Opening Balances
                  </h3>
                  <p className="text-[11px] text-fg/40 mt-1">
                    Carry an existing balance sheet into the books. Balance-sheet accounts only.
                  </p>
                </div>
                {obEntry === undefined && (
                  <button onClick={fetchOpeningBalances}
                    className="border border-white/15 text-fg px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-white/5 transition">
                    Load
                  </button>
                )}
              </div>

              {obEntry && (
                <div className="mt-3 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5">
                  Already posted as <span className="font-black">{obEntry.reference}</span> on{' '}
                  {new Date(obEntry.date).toLocaleDateString()} ({peso(obEntry.totalDebit)}).
                  Posting again adds a second full set and doubles every carried-in balance.
                </div>
              )}

              <div className="mt-4 space-y-2">
                {obRows.map((r, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <select value={r.accountCode}
                      onChange={e => setObRows(rows => rows.map((x, j) => j === i ? { ...x, accountCode: e.target.value } : x))}
                      className="flex-1 min-w-0 bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-brand">
                      <option value="">Select an account…</option>
                      {(balanceSheetAccounts || []).map(a => (
                        <option key={a.code} value={a.code}>{a.code} - {a.name}</option>
                      ))}
                    </select>
                    <input type="number" step="0.01" value={r.amount} placeholder="0.00"
                      onChange={e => setObRows(rows => rows.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                      className="w-32 shrink-0 bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs text-right tabular-nums outline-none focus:border-brand" />
                    <button onClick={() => setObRows(rows => rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}
                      disabled={obRows.length === 1}
                      className="shrink-0 text-fg/30 hover:text-red-400 disabled:opacity-20 transition p-2" title="Remove row">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button onClick={() => setObRows(rows => [...rows, { accountCode: '', amount: '' }])}
                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-brand hover:text-brand/80 transition pt-1">
                  <Plus size={12} /> Add account
                </button>
              </div>

              {/* Live preview of what the server will do, so the plug is not a
                  surprise after posting. */}
              {(() => {
                const rows = obRows.filter(r => r.accountCode && parseFloat(r.amount));
                if (rows.length === 0) return null;
                const byCode = new Map((balanceSheetAccounts || []).map(a => [a.code, a]));
                let dr = 0, cr = 0;
                for (const r of rows) {
                  const t = byCode.get(r.accountCode)?.type;
                  const amt = parseFloat(r.amount) || 0;
                  if (t === 'asset') { dr += Math.max(0, amt); cr += Math.max(0, -amt); }
                  else { cr += Math.max(0, amt); dr += Math.max(0, -amt); }
                }
                const diff = Math.round((dr - cr) * 100) / 100;
                return (
                  <div className="mt-3 bg-page-bg border border-white/10 rounded-lg p-3 text-[11px] space-y-1">
                    <div className="flex justify-between"><span className="text-fg/50">Total debits</span><span className="tabular-nums text-fg/80">{peso(dr)}</span></div>
                    <div className="flex justify-between"><span className="text-fg/50">Total credits</span><span className="tabular-nums text-fg/80">{peso(cr)}</span></div>
                    <div className="flex justify-between border-t border-white/10 pt-1 mt-1">
                      <span className="text-fg/70 font-bold">{diff === 0 ? 'Balanced' : "To Owner's Capital"}</span>
                      <span className={`tabular-nums font-black ${diff === 0 ? 'text-green-400' : 'text-brand'}`}>
                        {diff === 0 ? '—' : peso(Math.abs(diff))}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
                <div>
                  <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">As of date</label>
                  <input type="date" value={obMeta.date}
                    onChange={e => setObMeta(m => ({ ...m, date: e.target.value }))}
                    className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-brand" />
                </div>
                <div>
                  <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">Reference No.</label>
                  <input type="text" value={obMeta.referenceNumber} placeholder="Prior-books ref, audit ref..."
                    onChange={e => setObMeta(m => ({ ...m, referenceNumber: e.target.value }))}
                    className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-brand" />
                </div>
              </div>
              <div className="mt-2">
                <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">Remarks</label>
                <textarea value={obMeta.note} rows={2} placeholder="Where these figures came from"
                  onChange={e => setObMeta(m => ({ ...m, note: e.target.value }))}
                  className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-brand" />
              </div>

              <button onClick={() => submitOpeningBalances(!!obEntry)} disabled={obBusy}
                className={`w-full mt-4 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition disabled:opacity-50 ${
                  obEntry ? 'bg-amber-500 hover:bg-amber-400 text-page-bg' : 'bg-brand hover:bg-brand-dark text-white'}`}>
                {obBusy ? 'Posting…' : obEntry ? 'Post Again (doubles balances)' : 'Post Opening Balances'}
              </button>
            </div>

              {/* Add child account */}
              <div className="bg-surface border border-white/10 rounded-2xl p-5">
                <h3 className="text-lg font-black text-fg mb-1">Add Sub-Account</h3>
                <p className="text-xs text-fg/60 mb-4">Create a custom child account under any parent. It inherits the parent's classification and becomes usable in journal entries and reports.</p>
                {isSuperAdmin && (
                  <button onClick={seedPaymentSubaccounts}
                    title="Auto-create standard payment-method sub-accounts (GCash, Maya, Foodpanda, Lalamove, etc.). Idempotent - existing accounts are skipped."
                    className="w-full sm:w-auto text-[10px] uppercase tracking-widest font-black bg-white/5 hover:bg-white/10 text-brand border border-brand/20 px-3 py-2 rounded-lg transition flex items-center justify-center gap-1.5 mb-4">
                    <Zap size={11}/> Seed payment methods
                  </button>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <select value={coaParent} onChange={e => setCoaParent(e.target.value)}
                    className="flex-1 bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm font-bold outline-none focus:border-brand/60">
                    <option value="">Select parent account…</option>
                    {coaParents.map(p => (
                      <option key={p.code} value={p.code}>{p.code} · {p.name}{p.isParent ? ' (header)' : ''}</option>
                    ))}
                  </select>
                  <input type="text" placeholder="New account name" value={coaNewName}
                    onChange={e => setCoaNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addCoaChild(); }}
                    className="flex-1 bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm font-bold outline-none focus:border-brand/60 placeholder-white/25" />
                  <button onClick={addCoaChild} disabled={coaBusy}
                    className="bg-brand text-white font-black text-xs uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-brand-dark transition disabled:opacity-50">
                    <Plus size={14} className="inline -mt-0.5" /> Add
                  </button>
                </div>
              </div>

              {/* Existing custom accounts grouped by parent */}
              <div className="bg-surface border border-white/10 rounded-2xl p-5">
                <h3 className="text-lg font-black text-fg mb-4">Custom Sub-Accounts</h3>
                {coaParents.filter(p => coaChildrenOf(p.code).length > 0).length === 0 ? (
                  <p className="text-sm text-fg/60 italic">No custom accounts yet. Add one above.</p>
                ) : coaParents.filter(p => coaChildrenOf(p.code).length > 0).map(p => (
                  <div key={p.code} className="mb-4 last:mb-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-fg/40 mb-1.5">{p.code} · {p.name}</p>
                    <div className="space-y-1.5">
                      {coaChildrenOf(p.code).map(c => (
                        <div key={c._id} className="flex items-center gap-2 bg-page-bg border border-white/10 rounded-xl px-3 py-2">
                          <span className="font-mono text-xs text-brand/80 w-16 shrink-0">{c.code}</span>
                          {coaEditId === c._id ? (
                            <>
                              <input autoFocus value={coaEditName} onChange={e => setCoaEditName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') renameCoaChild(c._id); if (e.key === 'Escape') setCoaEditId(null); }}
                                className="flex-1 bg-surface border border-brand/40 rounded-lg px-2 py-1 text-fg text-sm outline-none" />
                              <button onClick={() => renameCoaChild(c._id)} className="text-green-400 hover:text-green-300 text-xs font-black uppercase">Save</button>
                              <button onClick={() => setCoaEditId(null)} className="text-fg/40 hover:text-fg text-xs">Cancel</button>
                            </>
                          ) : (
                            <>
                              <span className="flex-1 text-sm font-bold text-fg">{c.name}</span>
                              <button onClick={() => { setCoaEditId(c._id); setCoaEditName(c.name); }} title="Rename"
                                className="text-blue-300/70 hover:text-blue-300 p-1"><Edit size={13} /></button>
                              <button onClick={() => deleteCoaChild(c._id)} title="Delete"
                                className="text-red-400/70 hover:text-red-400 p-1"><Trash2 size={13} /></button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ledgerSubTab === 'journal' && (
        <div className="flex flex-col xl:flex-row gap-8">

          {/* LEFT COLUMN: Balances & New Entry Form */}
          <div className="w-full xl:w-1/3 space-y-6">
            
            {/* --- LIVE CASH ON HAND --- */}
            <div className="bg-accent border border-accent/30 rounded-xl p-6 shadow-lg shadow-accent/5">
              <p className="text-white text-xs font-bold uppercase tracking-wider mb-1">Live Cash on Hand</p>
              <p className="text-4xl font-black text-white">P{cashOnHand.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>

            <div className="bg-surface border border-white/10 rounded-xl p-6 h-fit">
              <h3 className="text-xl font-bold mb-4 text-accent border-b border-white/10 pb-2">New Journal Entry</h3>
              <div className="space-y-4">
                <input type="text" placeholder="Description / Memo" value={jeForm.description} onChange={e => setJeForm({...jeForm, description: e.target.value})} className="w-full bg-page-bg border border-white/10 rounded p-2 text-fg outline-none" />
                {jeForm.lines.map((line, idx) => (
                  <div key={idx} className="bg-accent p-3 rounded border border-gray-700 space-y-2 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-white">Line {idx + 1}</span>
                      <button
                        type="button"
                        aria-label={`Remove line ${idx + 1}`}
                        disabled={jeForm.lines.length <= 2}
                        title={jeForm.lines.length <= 2 ? 'A journal entry needs at least 2 lines' : 'Remove this line'}
                        onClick={() => setJeForm({ ...jeForm, lines: jeForm.lines.filter((_, i) => i !== idx) })}
                        className="text-white hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
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
                      <input type="number" placeholder="Debit" value={line.debit} onChange={e => { const nl = [...jeForm.lines]; nl[idx].debit = e.target.value; nl[idx].credit = ''; setJeForm({...jeForm, lines: nl}); }} className="w-1/2 bg-page-bg border border-gray-600 rounded p-2 text-sm text-fg placeholder-gray-500" />
                      <input type="number" placeholder="Credit" value={line.credit} onChange={e => { const nl = [...jeForm.lines]; nl[idx].credit = e.target.value; nl[idx].debit = ''; setJeForm({...jeForm, lines: nl}); }} className="w-1/2 bg-page-bg border border-gray-600 rounded p-2 text-sm text-fg placeholder-gray-500" />
                    </div>
                  </div>
                ))}
                <button onClick={() => setJeForm({...jeForm, lines: [...jeForm.lines, {accountCode:'', accountName:'', debit:'', credit:''}]})} className="text-xs text-accent hover:text-fg">+ Add Line</button>
                <div className="border-t border-white/10 pt-4 mt-4 flex justify-between items-center">
                  <div className="text-xs text-gray-400">
                    Debits: {jeForm.lines.reduce((s, l) => s + Number(l.debit||0), 0)} <br/>
                    Credits: {jeForm.lines.reduce((s, l) => s + Number(l.credit||0), 0)}
                  </div>
                  <button onClick={async () => {
                    await apiFetch(`/api/journal`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(jeForm) });
                    setJeForm({ description: '', lines: [{accountCode:'', accountName:'', debit:'', credit:''}, {accountCode:'', accountName:'', debit:'', credit:''}] });
                    fetchERPData();
                  }} className="bg-accent text-white font-bold py-2 px-4 rounded hover:bg-page-bg hover:text-accent transition shadow-lg shadow-accent/20">Post Entry</button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: General Ledger */}
          <div className="flex-1 bg-surface border border-white/10 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
              <h3 className="text-xl font-bold text-fg">General Ledger</h3>
              <button onClick={exportLedgerToPDF} className="text-[10px] bg-accent border border-gray-600 text-white px-3 py-1.5 rounded hover:bg-page-bg hover:text-accent transition font-bold uppercase tracking-wider">
                Export Ledger
              </button>
            </div>
            {/* Sorted by transaction date, not entry order - a backdated entry
                sorts below everything more recent and can be hard to spot by
                scrolling. Search by reference or description finds it directly. */}
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input type="text" placeholder="Search by reference or description (e.g. BACKDATE, order #)…"
                value={journalSearch} onChange={e => { setJournalSearch(e.target.value); setAccountingPage(1); }}
                className="w-full bg-page-bg border border-white/10 rounded-lg pl-9 pr-9 py-2 text-sm text-fg placeholder-gray-500 outline-none focus:border-accent" />
              {journalSearch && (
                <button onClick={() => setJournalSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-fg transition">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="space-y-4">
              {currentEntries.length === 0 && (
                <div className="py-14 px-6 text-center border border-dashed border-white/10 rounded-xl">
                  <FileText size={26} className="mx-auto mb-3 text-brand/50" />
                  <p className="text-fg/70 font-black uppercase tracking-widest text-xs mb-1">
                    {journalSearch ? 'No matching entries' : 'No journal entries yet'}
                  </p>
                  <p className="text-fg/35 text-xs">
                    {journalSearch ? 'Try a different reference or description.' : 'Every sale, expense, and restock posts here automatically; you can also post one manually on the left.'}
                  </p>
                </div>
              )}
              {currentEntries.map(entry => (
                <div key={entry._id} className="bg-page-bg border border-white/10 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-3 border-b border-white/10 pb-2">
                    <span className="text-accent font-bold">{entry.reference}</span>
                    <span className="text-fg text-sm">{new Date(entry.date).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-fg mb-3 font-semibold">{entry.description}</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-fg text-left"><th className="pb-2">Account</th><th className="pb-2 text-right">Debit</th><th className="pb-2 text-right">Credit</th></tr></thead>
                    <tbody>
                      {entry.lines.map((line, idx) => (
                        <tr key={idx} className="border-t border-gray-800/50">
                          <td className={`py-1 ${line.credit > 0 ? 'pl-6 text-fg' : 'text-gray-600'}`}>{line.accountCode} - {line.accountName}</td>
                          <td className="py-1 text-right text-gray-600">{line.debit > 0 ? line.debit.toFixed(2) : ''}</td>
                          <td className="py-1 text-right text-gray-600">{line.credit > 0 ? line.credit.toFixed(2) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {/* --- ACCOUNTING PAGINATION CONTROLS --- */}
              {totalAccountingPages > 1 && (
                <div className="flex justify-between items-center bg-page-bg p-3 rounded-lg border border-white/10 mt-4">
                  <button 
                    onClick={() => setAccountingPage(prev => Math.max(prev - 1, 1))}
                    disabled={accountingPage === 1}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${accountingPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-fg hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                  </button>
                  <span className="text-gray-400 text-xs font-bold tracking-widest">
                    PAGE <span className="text-accent text-sm">{accountingPage}</span> OF {totalAccountingPages}
                  </span>
                  <button 
                    onClick={() => setAccountingPage(prev => Math.min(prev + 1, totalAccountingPages))}
                    disabled={accountingPage === totalAccountingPages}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${accountingPage === totalAccountingPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-fg hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
          )}

          {/* ===== PROFIT & LOSS SUB-TAB ===== */}
          {ledgerSubTab === 'pnl' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:justify-between border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-fg">Profit &amp; Loss Statement</h3>
                  <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">Non-VAT Registered</p>
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Start</label>
                    <input type="date" value={pnlRange.start} onChange={e => setPnlRange({...pnlRange, start: e.target.value})} className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm font-bold outline-none focus:border-brand/60" />
                  </div>
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">End</label>
                    <input type="date" value={pnlRange.end} onChange={e => setPnlRange({...pnlRange, end: e.target.value})} className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm font-bold outline-none focus:border-brand/60" />
                  </div>
                  <button onClick={fetchPnl} className="bg-brand text-white px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[44px]">Run</button>
                  <button onClick={exportPnlPDF} className="bg-white/5 text-fg/70 hover:text-fg hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition min-h-[44px] flex items-center gap-1.5"><Download size={13}/> PDF</button>
                </div>
              </div>

              {!pnlData ? (
                <div className="py-16 text-center text-fg/60 font-bold uppercase tracking-widest text-sm">Click "Run" to generate report</div>
              ) : (() => {
                // Renders one bucket (Revenue, OpEx, ...) as a stack of NAMED
                // sections with their own subtotal - e.g. "Salaries & Wages",
                // "Repairs & Maintenance" - each a bolded header + its line
                // items + a subtotal row, instead of one flat undifferentiated
                // list. Falls back to the flat list when the server sent no
                // section breakdown (older cached response) or there's
                // nothing to show for this bucket.
                const Sections = ({ sections, flat, emptyLabel }) => {
                  if (!flat || flat.length === 0) return <p className="text-fg/60 text-sm">{emptyLabel}</p>;
                  if (!sections || sections.length === 0) sections = [{ code: '_flat', name: '', items: flat, total: flat.reduce((s, r) => s + r.amount, 0) }];
                  return (
                    <div className="space-y-3">
                      {sections.map(sec => (
                        <table key={sec.code} className="w-full text-sm">
                          <tbody>
                            {sec.name && sec.items.length > 1 && (
                              <tr><td colSpan={2} className="pb-1 text-[10px] font-black uppercase tracking-widest text-fg/40">{sec.name}</td></tr>
                            )}
                            {sec.items.map(r => (
                              <tr key={r.code} className="border-b border-white/5">
                                <td className="py-2 text-fg/80 text-xs"><span className="text-fg/60 mr-2">{r.code}</span>{r.name}</td>
                                <td className="py-2 text-right text-fg tabular-nums font-bold">{r.amount >= 0 ? '' : '('}₱{Math.abs(r.amount).toFixed(2)}{r.amount < 0 ? ')' : ''}</td>
                              </tr>
                            ))}
                            {sec.items.length > 1 && (
                              <tr><td className="pt-1 text-fg/50 text-[11px] font-bold uppercase">{sec.name || 'Subtotal'}</td><td className="pt-1 text-right text-fg/70 tabular-nums font-bold text-xs">₱{sec.total.toFixed(2)}</td></tr>
                            )}
                          </tbody>
                        </table>
                      ))}
                    </div>
                  );
                };

                return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Revenue */}
                  <div className="space-y-3">
                    <h4 className="text-brand font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2">Revenue</h4>
                    <Sections sections={pnlData.sections?.revenue} flat={pnlData.revenue} emptyLabel="No revenue entries." />
                    {pnlData.revenue.length > 0 && (
                      <table className="w-full text-sm"><tbody>
                        <tr><td className="pt-2 font-black text-fg uppercase text-xs">Net Revenue</td><td className="pt-2 text-right text-brand tabular-nums font-black text-lg">₱{pnlData.totals.netRevenue.toFixed(2)}</td></tr>
                      </tbody></table>
                    )}

                    <h4 className="text-orange-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mt-6">Cost of Goods Sold</h4>
                    <Sections sections={pnlData.sections?.cogs} flat={pnlData.cogs} emptyLabel="No COGS entries." />
                    {pnlData.cogs.length > 0 && (
                      <table className="w-full text-sm"><tbody>
                        <tr><td className="pt-2 font-black text-fg uppercase text-xs">Total COGS</td><td className="pt-2 text-right text-orange-400 tabular-nums font-black">₱{pnlData.totals.cogs.toFixed(2)}</td></tr>
                      </tbody></table>
                    )}
                    <table className="w-full text-sm"><tbody>
                      <tr className="border-t border-white/10"><td className="pt-3 font-black text-fg uppercase text-sm">Gross Profit</td><td className="pt-3 text-right text-green-400 tabular-nums font-black text-lg">₱{pnlData.totals.grossProfit.toFixed(2)}</td></tr>
                      <tr><td className="font-bold text-fg/50 uppercase text-xs">Gross Margin</td><td className="text-right text-fg/70 tabular-nums font-black text-sm">{pnlData.totals.grossMargin.toFixed(2)}%</td></tr>
                    </tbody></table>

                    {/* Other Income - kept separate from Revenue (interest
                        earned, gains, etc. aren't sales) so the top line
                        isn't inflated by non-operating income. */}
                    {pnlData.otherIncome?.length > 0 && (<>
                      <h4 className="text-blue-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mt-6">Other Income</h4>
                      <Sections sections={pnlData.sections?.otherIncome} flat={pnlData.otherIncome} emptyLabel="" />
                      <table className="w-full text-sm"><tbody>
                        <tr><td className="pt-2 font-black text-fg uppercase text-xs">Total Other Income</td><td className="pt-2 text-right text-blue-400 tabular-nums font-black">₱{pnlData.totals.otherIncome.toFixed(2)}</td></tr>
                      </tbody></table>
                    </>)}
                  </div>

                  {/* Operating Expenses */}
                  <div className="space-y-3">
                    <h4 className="text-red-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2">Operating Expenses</h4>
                    <Sections sections={pnlData.sections?.opex} flat={pnlData.opex} emptyLabel="No expense entries in this period." />
                    {pnlData.opex.length > 0 && (
                      <table className="w-full text-sm"><tbody>
                        <tr><td className="pt-2 font-black text-fg uppercase text-xs">Total OpEx</td><td className="pt-2 text-right text-red-400 tabular-nums font-black">₱{pnlData.totals.opex.toFixed(2)}</td></tr>
                      </tbody></table>
                    )}

                    {/* Other (Non-Operating) Expenses - the same distinction
                        as Other Income above; interest paid, disposal losses,
                        etc. sit below regular OpEx, not mixed into it. */}
                    {pnlData.otherExpense?.length > 0 && (<>
                      <h4 className="text-fg/50 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mt-6">Other Expenses</h4>
                      <Sections sections={pnlData.sections?.otherExpense} flat={pnlData.otherExpense} emptyLabel="" />
                      <table className="w-full text-sm"><tbody>
                        <tr><td className="pt-2 font-black text-fg uppercase text-xs">Total Other Expenses</td><td className="pt-2 text-right text-fg/70 tabular-nums font-black">₱{pnlData.totals.otherExpense.toFixed(2)}</td></tr>
                      </tbody></table>
                    </>)}

                    {/* Net Income Summary */}
                    <div className={`mt-6 rounded-xl p-5 border ${pnlData.totals.netIncome >= 0 ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                      <p className="text-fg/80 text-xs font-black uppercase tracking-widest mb-2">Net Income</p>
                      <p className={`text-4xl font-black tabular-nums ${pnlData.totals.netIncome >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pnlData.totals.netIncome < 0 ? '−' : ''}₱{Math.abs(pnlData.totals.netIncome).toFixed(2)}
                      </p>
                      <p className="text-fg/80 text-xs font-bold mt-2">Net Margin: <span className="tabular-nums">{pnlData.totals.netMargin.toFixed(2)}%</span></p>
                      <p className="text-fg/60 text-[10px] font-bold uppercase tracking-widest mt-3 border-t border-white/10 pt-2">
                        Period: {new Date(pnlData.period.start).toLocaleDateString()} → {new Date(pnlData.period.end).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
                );
              })()}
            </div>
          )}

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
                <input type="date" value={pnlmRange.start} onChange={e => setPnlmRange(p => ({ ...p, start: e.target.value }))} className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <span className="text-fg/60 font-bold text-sm">→</span>
                <input type="date" value={pnlmRange.end} onChange={e => setPnlmRange(p => ({ ...p, end: e.target.value }))} className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <button onClick={fetchPnlMonthly} className="px-5 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition">Load</button>
                <div className="flex rounded-xl overflow-hidden border border-white/10">
                  {[['period','Period'],['matrix','Monthly']].map(([v,lbl]) => (
                    <button key={v} onClick={() => setPnlmView(v)} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${pnlmView === v ? 'bg-brand text-white' : 'bg-surface text-fg/50 hover:text-fg'}`}>{lbl}</button>
                  ))}
                </div>
                {m && <button onClick={exportPnlMonthlyPDF} className="ml-auto bg-white/5 text-fg/70 hover:text-fg hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition flex items-center gap-1.5"><Download size={13}/> PDF</button>}
              </div>

              {!m ? <p className="text-fg/60 text-sm text-center p-6 font-bold">Pick a range and click Load.</p> : (
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
                              <tr className="bg-white/[0.03]"><td colSpan={span} className="px-3 py-2 font-black text-brand uppercase text-[10px] tracking-wider">{label}</td></tr>
                              {rows.map(a => (
                                <tr key={a.code} className="border-b border-white/5 hover:bg-white/[0.02]">
                                  <td className="px-3 py-2 text-fg/80 pl-6">{a.code} · {a.name}</td>
                                  {pnlmView === 'matrix'
                                    ? <>{m.months.map(mm => <td key={mm} className="px-3 py-2 text-right tabular-nums text-fg/70">{a.byMonth[mm] ? peso(a.byMonth[mm]) : '-'}</td>)}<td className="px-3 py-2 text-right tabular-nums font-bold text-fg">{peso(a.total)}</td></>
                                    : <><td className="px-3 py-2 text-right tabular-nums font-bold text-fg">{peso(a.total)}</td><td className="px-3 py-2 text-right tabular-nums text-fg/50">{nr ? `${(a.total/nr*100).toFixed(1)}%` : '-'}</td><td className="px-3 py-2 text-right tabular-nums text-fg/50">{parentTotals[a.parentCode] ? `${(a.total/parentTotals[a.parentCode]*100).toFixed(1)}%` : '-'}</td></>}
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-white/10 bg-accent font-black text-white">
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

          {/* ===== BALANCE SHEET SUB-TAB ===== */}
          {ledgerSubTab === 'balance' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex justify-between items-end border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-fg">Balance Sheet</h3>
                  <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">Snapshot as of {bsData ? new Date(bsData.asOf).toLocaleDateString() : 'today'}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={reconcileInventory} title="Set book Inventory = actual on-hand value (fixes negative/opening inventory)" className="bg-amber-500 text-white border border-amber-500 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-amber-500/60 transition min-h-[44px] flex items-center gap-1.5"><Package size={13}/> Reconcile Inventory</button>
                  {bsData && <button onClick={exportBalanceSheetPDF} className="bg-white/5 text-fg/70 hover:text-fg hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition min-h-[44px] flex items-center gap-1.5"><Download size={13}/> PDF</button>}
                  <button onClick={fetchBalanceSheet} className="bg-brand text-white px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[44px] flex items-center gap-1.5"><RefreshCw size={13}/> Refresh</button>
                </div>
              </div>

              {!bsData ? (
                <div className="py-16 text-center text-fg/60 font-bold uppercase tracking-widest text-sm">Click "Refresh" to load</div>
              ) : (() => {
                // Same named-section-with-subtotal pattern as the P&L above -
                // "Current Assets", "Accounts Payable", etc. as their own
                // bolded header + subtotal, instead of one flat list per side.
                const BsSections = ({ sections, flat, emptyLabel }) => {
                  if (!flat || flat.length === 0) return <p className="text-fg/60 text-xs italic py-2">{emptyLabel}</p>;
                  if (!sections || sections.length === 0) sections = [{ code: '_flat', name: '', items: flat, total: flat.reduce((s, r) => s + r.amount, 0) }];
                  return (
                    <div className="space-y-3">
                      {sections.map(sec => (
                        <table key={sec.code} className="w-full text-sm">
                          <tbody>
                            {sec.name && sec.items.length > 1 && (
                              <tr><td colSpan={2} className="pb-1 text-[10px] font-black uppercase tracking-widest text-fg/40">{sec.name}</td></tr>
                            )}
                            {sec.items.map(r => (
                              <tr key={r.code} className="border-b border-white/5">
                                <td className="py-2 text-fg/80 text-xs"><span className="text-fg/60 mr-2">{r.code}</span>{r.name}</td>
                                <td className="py-2 text-right text-fg tabular-nums font-bold">{r.amount < 0 ? '−' : ''}₱{Math.abs(r.amount).toFixed(2)}</td>
                              </tr>
                            ))}
                            {sec.items.length > 1 && (
                              <tr><td className="pt-1 text-fg/50 text-[11px] font-bold uppercase">{sec.name || 'Subtotal'}</td><td className="pt-1 text-right text-fg/70 tabular-nums font-bold text-xs">₱{sec.total.toFixed(2)}</td></tr>
                            )}
                          </tbody>
                        </table>
                      ))}
                    </div>
                  );
                };
                return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Assets */}
                  <div>
                    <h4 className="text-brand font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Assets</h4>
                    <BsSections sections={bsData.sections?.assets} flat={bsData.assets} emptyLabel="No assets recorded" />
                    <table className="w-full text-sm"><tbody>
                      <tr><td className="pt-3 font-black text-fg uppercase text-xs">Total Assets</td><td className="pt-3 text-right text-brand tabular-nums font-black text-lg">₱{bsData.totals.assets.toFixed(2)}</td></tr>
                    </tbody></table>
                  </div>
                  {/* Liabilities */}
                  <div>
                    <h4 className="text-red-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Liabilities</h4>
                    <BsSections sections={bsData.sections?.liabilities} flat={bsData.liabilities} emptyLabel="No liabilities recorded" />
                    <table className="w-full text-sm"><tbody>
                      <tr><td className="pt-3 font-black text-fg uppercase text-xs">Total Liabilities</td><td className="pt-3 text-right text-red-400 tabular-nums font-black">₱{bsData.totals.liabilities.toFixed(2)}</td></tr>
                    </tbody></table>
                  </div>
                  {/* Equity */}
                  <div>
                    <h4 className="text-green-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Equity</h4>
                    <table className="w-full text-sm">
                      <tbody>
                        {bsData.equity.map(r => (
                          <tr key={r.code} className="border-b border-white/5">
                            <td className="py-2 text-fg/80 text-xs"><span className="text-fg/60 mr-2">{r.code}</span>{r.name}</td>
                            <td className="py-2 text-right text-fg tabular-nums font-bold">{r.amount < 0 ? '−' : ''}₱{Math.abs(r.amount).toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr><td className="pt-3 font-black text-fg uppercase text-xs">Total Equity</td><td className="pt-3 text-right text-green-400 tabular-nums font-black">₱{bsData.totals.equity.toFixed(2)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                );
              })()}

              {bsData && (
                <div className={`mt-4 rounded-xl p-4 flex justify-between items-center border ${bsData.totals.balanced ? 'bg-accent border-accent' : 'bg-red-500 border-red-500'}`}>
                  <div>
                    <p className="text-white text-xs font-black uppercase tracking-widest">Accounting Equation Check</p>
                    <p className="text-white text-xs mt-1">Assets = Liabilities + Equity</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white tabular-nums font-black text-lg">₱{bsData.totals.assets.toFixed(2)} = ₱{bsData.totals.liabilitiesAndEquity.toFixed(2)}</p>
                    <p className={`text-xs font-black uppercase mt-1 ${bsData.totals.balanced ? 'text-white' : 'text-white'}`}>{bsData.totals.balanced ? '✓ Balanced' : '✗ Out of Balance'}</p>
                  </div>
                </div>
              )}
            </div>
          )}

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
                <input type="date" value={bsmRange.start} onChange={e => setBsmRange(p => ({ ...p, start: e.target.value }))} className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <span className="text-fg/60 font-bold text-sm">→</span>
                <input type="date" value={bsmRange.end} onChange={e => setBsmRange(p => ({ ...p, end: e.target.value }))} className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <button onClick={fetchBsMonthly} className="px-5 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition">Load</button>
                <div className="flex rounded-xl overflow-hidden border border-white/10">
                  {[['period','As-of'],['matrix','Monthly']].map(([v,lbl]) => (
                    <button key={v} onClick={() => setBsmView(v)} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${bsmView === v ? 'bg-brand text-white' : 'bg-surface text-fg/50 hover:text-fg'}`}>{lbl}</button>
                  ))}
                </div>
                {b && <button onClick={exportBsMonthlyPDF} className="ml-auto bg-white/5 text-fg/70 hover:text-fg hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition flex items-center gap-1.5"><Download size={13}/> PDF</button>}
              </div>
              {!b ? <p className="text-fg/60 text-sm text-center p-6 font-bold">Pick a range and click Load.</p> : (
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
                            <tr className="bg-white/[0.03]"><td colSpan={bsmView === 'matrix' ? b.months.length + 1 : 4} className="px-3 py-2 font-black text-brand uppercase text-[10px] tracking-wider">{label}</td></tr>
                            {b[sec].map(a => (
                              <tr key={a.code} className="border-b border-white/5 hover:bg-white/[0.02]">
                                <td className="px-3 py-2 text-fg/80 pl-6">{a.code} · {a.name}</td>
                                {bsmView === 'matrix'
                                  ? b.months.map(mm => <td key={mm} className="px-3 py-2 text-right tabular-nums text-fg/70">{a.byMonth[mm] ? peso(a.byMonth[mm]) : '-'}</td>)
                                  : <><td className="px-3 py-2 text-right tabular-nums font-bold text-fg">{peso(a.total)}</td><td className="px-3 py-2 text-right tabular-nums text-fg/50">{totalAssets ? `${(a.total/totalAssets*100).toFixed(1)}%` : '-'}</td><td className="px-3 py-2 text-right tabular-nums text-fg/50">{parentTotals[a.parentCode] ? `${(a.total/parentTotals[a.parentCode]*100).toFixed(1)}%` : '-'}</td></>}
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
          {ledgerSubTab === 'pricelog' && (
            <div className="space-y-4 animate-fade-in">

              {/* ── Awaiting approval ── */}
              {changeRequests?.length > 0 && (
                <div className="bg-surface border border-yellow-500/25 rounded-2xl p-6 space-y-3">
                  <div>
                    <h3 className="text-xl font-black text-fg flex items-center gap-2">
                      <ShieldCheck size={18} className="text-yellow-400" />
                      {changeRequests.length} Price Change{changeRequests.length === 1 ? '' : 's'} Awaiting Approval
                    </h3>
                    <p className="text-fg/40 text-[11px] mt-0.5">
                      {canApprovePricing
                        ? 'These are not in effect yet. Approving applies the new value immediately.'
                        : 'Your requests. Someone with approval rights has to sign these off.'}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {changeRequests.map(r => (
                      <div key={r._id} className="bg-page-bg/50 border border-white/10 rounded-xl p-3">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-fg font-bold text-sm">{r.entityName || r.entityId}</p>
                            {r.changes.map((c, i) => (
                              <div key={i} className="flex items-center gap-2 font-mono text-xs mt-0.5">
                                <span className="text-fg/50">{c.label}</span>
                                <span className="text-fg/40 line-through">₱{Number(c.oldValue || 0).toFixed(2)}</span>
                                <span className="text-fg/30">→</span>
                                <span className={`font-black ${Number(c.newValue) > Number(c.oldValue) ? 'text-red-400' : 'text-green-400'}`}>
                                  ₱{Number(c.newValue || 0).toFixed(2)}
                                </span>
                              </div>
                            ))}
                            <p className="text-[10px] text-fg/40 mt-1">
                              by {r.requestedBy || 'someone'} · {new Date(r.createdAt).toLocaleDateString()}
                              {r.reason && <span className="italic"> · "{r.reason}"</span>}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {canApprovePricing ? (
                              <>
                                <button onClick={() => actOnChangeRequest(r._id, 'approve')}
                                  className="bg-brand text-white px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition min-h-[36px]">
                                  Approve
                                </button>
                                <button onClick={async () => {
                                  const reason = await ui.confirm({
                                    title: 'Reject this price change?',
                                    message: `${r.entityName}: ${r.changes.map(c => `${c.label} → ₱${Number(c.newValue || 0).toFixed(2)}`).join(', ')}. The price stays as it is.`,
                                    confirmLabel: 'Reject', tone: 'danger',
                                  });
                                  if (reason) actOnChangeRequest(r._id, 'reject', 'Rejected by approver');
                                }}
                                  className="bg-red-500/10 text-red-400 px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-red-500/20 transition min-h-[36px]">
                                  Reject
                                </button>
                              </>
                            ) : (
                              <button onClick={() => actOnChangeRequest(r._id, 'withdraw')}
                                className="bg-white/5 text-fg/50 px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-white/10 transition min-h-[36px]">
                                Withdraw
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Applied changes ── */}
              <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
                  <div>
                    <h3 className="text-2xl font-black text-fg">Price Change Log</h3>
                    <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">Every price &amp; cost change, and who signed it off</p>
                  </div>
                  <div className="flex items-end gap-2">
                    <div>
                      <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">From</label>
                      <input type="date" value={priceLogRange.start} onChange={e => setPriceLogRange({ ...priceLogRange, start: e.target.value })}
                        className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
                    </div>
                    <div>
                      <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">To</label>
                      <input type="date" value={priceLogRange.end} onChange={e => setPriceLogRange({ ...priceLogRange, end: e.target.value })}
                        className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
                    </div>
                    <button onClick={fetchPriceChangeLog}
                      className="bg-brand text-white px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
                      Run
                    </button>
                  </div>
                </div>

                {!priceChangeLog ? (
                  <div className="py-16 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">Pick a range and run the log</div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Changes</p>
                        <p className="text-xl font-black tabular-nums text-fg">{priceChangeLog.summary.total}</p>
                        <p className="text-[9px] text-fg/40 mt-0.5">{priceChangeLog.summary.priceChanges} price · {priceChangeLog.summary.costChanges} cost</p>
                      </div>
                      <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Increases</p>
                        <p className="text-xl font-black tabular-nums text-red-400">{priceChangeLog.summary.increases}</p>
                        {priceChangeLog.summary.largestIncrease && (
                          <p className="text-[9px] text-fg/40 mt-0.5 truncate">
                            max +{priceChangeLog.summary.largestIncrease.percent}% · {priceChangeLog.summary.largestIncrease.productName}
                          </p>
                        )}
                      </div>
                      <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Decreases</p>
                        <p className="text-xl font-black tabular-nums text-green-400">{priceChangeLog.summary.decreases}</p>
                        {priceChangeLog.summary.largestDecrease && (
                          <p className="text-[9px] text-fg/40 mt-0.5 truncate">
                            max {priceChangeLog.summary.largestDecrease.percent}% · {priceChangeLog.summary.largestDecrease.productName}
                          </p>
                        )}
                      </div>
                      {/* How many went through review rather than straight in -
                          the number that says whether the gate is doing anything. */}
                      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Reviewed</p>
                        <p className="text-xl font-black tabular-nums text-fg/70">{priceChangeLog.summary.viaApproval}</p>
                        <p className="text-[9px] text-fg/40 mt-0.5">{priceChangeLog.summary.pendingCount} still pending</p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                            <th className="text-left py-2.5">When</th>
                            <th className="text-left py-2.5">Product</th>
                            <th className="text-left py-2.5">Type</th>
                            <th className="text-right py-2.5">From</th>
                            <th className="text-right py-2.5">To</th>
                            <th className="text-right py-2.5">Move</th>
                            <th className="text-left py-2.5 pl-3">Who</th>
                            <th className="text-left py-2.5">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {priceChangeLog.changes.map((c, i) => (
                            <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition">
                              <td className="py-2.5 text-fg/50 text-xs">{new Date(c.date).toLocaleDateString()}</td>
                              <td className="py-2.5 text-fg font-bold text-xs">
                                {c.productName}
                                {c.productCode && <span className="block text-[9px] text-fg/30">{c.productCode}</span>}
                              </td>
                              <td className="py-2.5">
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${c.type === 'price' ? 'bg-brand/20 text-brand' : 'bg-orange-500/20 text-orange-400'}`}>
                                  {c.type === 'price' ? 'Price' : 'Cost'}
                                </span>
                              </td>
                              <td className="py-2.5 text-right tabular-nums text-fg/40">₱{Number(c.oldValue || 0).toFixed(2)}</td>
                              <td className="py-2.5 text-right tabular-nums font-black text-fg">₱{Number(c.newValue || 0).toFixed(2)}</td>
                              <td className={`py-2.5 text-right tabular-nums font-bold ${c.delta > 0 ? 'text-red-400' : c.delta < 0 ? 'text-green-400' : 'text-fg/30'}`}>
                                {c.percent === null ? '—' : `${c.percent > 0 ? '+' : ''}${c.percent}%`}
                              </td>
                              <td className="py-2.5 pl-3 text-xs">
                                {c.viaApproval ? (
                                  <>
                                    <span className="text-fg/70">{c.requestedBy || '—'}</span>
                                    <span className="block text-[9px] text-green-500">approved by {c.approvedBy || '—'}</span>
                                  </>
                                ) : (
                                  <span className="text-fg/70">{c.changedBy || '—'}</span>
                                )}
                              </td>
                              <td className="py-2.5 text-fg/40 text-xs italic max-w-[200px] truncate" title={c.reason}>{c.reason || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!priceChangeLog.changes.length && (
                        <div className="py-16 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">No price changes in this range</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ===== A/R REPORT SUB-TAB ===== */}
          {/* The printable receivables schedule: one line per open invoice.
              Read as-of a date, so re-running last month's report reproduces
              last month's numbers instead of restating them with collections
              that have happened since. */}
          {ledgerSubTab === 'arreport' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-fg">A/R Report</h3>
                  <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">Aged receivables schedule · invoice level</p>
                </div>
                <div className="flex items-end gap-2">
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">As Of</label>
                    <input type="date" value={arReportAsOf} onChange={e => setArReportAsOf(e.target.value)}
                      className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
                  </div>
                  <button onClick={fetchArReport}
                    className="bg-brand text-white px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
                    Run
                  </button>
                </div>
              </div>

              {!arReport ? (
                <div className="py-16 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">Pick a date and run the report</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {[
                      { label: 'Current', sub: '0–30d', amt: arReport.totals.current, cls: 'text-green-400 bg-green-500/10 border-green-500/20' },
                      { label: '31–60',   sub: 'days',  amt: arReport.totals.d31_60,  cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
                      { label: '61–90',   sub: 'days',  amt: arReport.totals.d61_90,  cls: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
                      { label: '91+',     sub: 'days',  amt: arReport.totals.d90_plus,cls: 'text-red-400 bg-red-500/10 border-red-500/20' },
                      { label: 'Total',   sub: `${arReport.totals.count} invoice(s)`, amt: arReport.totals.total, cls: 'text-brand bg-brand/10 border-brand/25' },
                    ].map(b => (
                      <div key={b.label} className={`rounded-xl border px-4 py-3 ${b.cls.split(' ').slice(1).join(' ')}`}>
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">{b.label} <span className="normal-case font-normal">{b.sub}</span></p>
                        <p className={`text-xl font-black tabular-nums mt-1 ${b.amt > 0 ? b.cls.split(' ')[0] : 'text-fg/20'}`}>₱{b.amt.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                      </div>
                    ))}
                  </div>

                  {arReport.overdueTotal > 0 && (
                    <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-red-400">Past Their Agreed Due Date</p>
                      <p className="text-xl font-black tabular-nums text-red-400">₱{arReport.overdueTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                    </div>
                  )}

                  {/* Per-client roll-up first - the question is almost always
                      "who owes me" before "which invoice". */}
                  <div className="bg-page-bg/40 border border-white/10 rounded-xl overflow-x-auto">
                    <p className="text-[11px] font-black uppercase tracking-widest text-fg/60 px-4 py-3 border-b border-white/10">By Client</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                          <th className="text-left py-2.5 px-4">Client</th>
                          <th className="text-right py-2.5">Current</th>
                          <th className="text-right py-2.5">31–60</th>
                          <th className="text-right py-2.5">61–90</th>
                          <th className="text-right py-2.5">91+</th>
                          <th className="text-right py-2.5 px-4">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {arReport.byClient.map(c => (
                          <tr key={c.client} className="border-b border-white/5">
                            <td className="py-2.5 px-4 font-bold text-fg">{c.client}{c.clientCode && <span className="ml-2 text-[9px] text-fg/30">{c.clientCode}</span>}</td>
                            <td className="py-2.5 text-right tabular-nums text-fg/70">{c.current ? `₱${c.current.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="py-2.5 text-right tabular-nums text-yellow-500/80">{c.d31_60 ? `₱${c.d31_60.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="py-2.5 text-right tabular-nums text-orange-500/80">{c.d61_90 ? `₱${c.d61_90.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="py-2.5 text-right tabular-nums text-red-500/80">{c.d90_plus ? `₱${c.d90_plus.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums font-black text-fg">₱{c.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="overflow-x-auto">
                    <p className="text-[11px] font-black uppercase tracking-widest text-fg/60 mb-2">Open Invoices</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                          <th className="text-left py-2.5">Invoice</th>
                          <th className="text-left py-2.5">Client</th>
                          <th className="text-left py-2.5">Date</th>
                          <th className="text-left py-2.5">Due</th>
                          <th className="text-left py-2.5">Age</th>
                          <th className="text-right py-2.5">Invoiced</th>
                          <th className="text-right py-2.5">Collected</th>
                          <th className="text-right py-2.5">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {arReport.invoices.map(i => (
                          <tr key={i._id} className={`border-b border-white/5 ${i.overdue ? 'bg-red-500/5' : ''}`}>
                            <td className="py-2.5 font-bold text-fg">{i.orderNumber}</td>
                            <td className="py-2.5 text-fg/70">{i.client}</td>
                            <td className="py-2.5 text-fg/50 text-xs">{new Date(i.invoiceDate).toLocaleDateString()}</td>
                            <td className="py-2.5 text-xs">{i.dueDate ? <span className={i.overdue ? 'text-red-400 font-bold' : 'text-fg/60'}>{new Date(i.dueDate).toLocaleDateString()}</span> : <span className="text-fg/20">-</span>}</td>
                            <td className="py-2.5"><span className={`text-[10px] font-black px-2 py-1 rounded ${i.bucket === 'current' ? 'bg-green-400/15 text-green-500' : i.bucket === 'd31_60' ? 'bg-yellow-500/15 text-yellow-400' : i.bucket === 'd61_90' ? 'bg-orange-500/15 text-orange-400' : 'bg-red-500/15 text-red-400'}`}>{i.ageDays}d</span></td>
                            <td className="py-2.5 text-right tabular-nums text-fg/50">₱{i.faceTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                            <td className="py-2.5 text-right tabular-nums text-green-400">{i.paid ? `₱${i.paid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : <span className="text-fg/20">-</span>}</td>
                            <td className="py-2.5 text-right tabular-nums font-black text-fg">₱{i.balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!arReport.invoices.length && <div className="py-16 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">Nothing outstanding as of this date</div>}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== COLLECTIONS SUB-TAB ===== */}
          {/* Two halves of one question. The check register is what has been
              taken in but is not yet money; the collection report is what
              actually came in over a period. */}
          {ledgerSubTab === 'collections' && (
            <div className="space-y-4 animate-fade-in">
              {/* ── CHECK REGISTER ──────────────────────────────────────────
                  A check is a promise of money, and the gap between taking one
                  in and the bank honouring it is where receivables go wrong.
                  Every check lives here through On Hand → Deposited → Cleared,
                  or Bounced - which reverses the collection and reopens the
                  invoice. */}
              <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
                  <div>
                    <h3 className="text-xl font-black text-fg">Check Register</h3>
                    <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">Checks received against receivables</p>
                  </div>
                  <div className="flex items-end gap-2">
                    <select value={checkFilter} onChange={e => { setCheckFilter(e.target.value); fetchChecks(e.target.value); }}
                      className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60">
                      <option value="">All statuses</option>
                      <option value="On Hand">On Hand</option>
                      <option value="Deposited">Deposited</option>
                      <option value="Cleared">Cleared</option>
                      <option value="Bounced">Bounced</option>
                    </select>
                    <button onClick={() => fetchChecks(checkFilter)}
                      className="bg-white/5 hover:bg-white/10 text-fg/60 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition min-h-[40px]">
                      Refresh
                    </button>
                  </div>
                </div>

                {!checkRegister ? (
                  <div className="py-12 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">Loading check register…</div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {/* On-hand checks whose date has arrived: money sitting in
                          a drawer that could be in the bank today. */}
                      <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Ready to Deposit</p>
                        <p className="text-xl font-black tabular-nums text-green-400">₱{checkRegister.summary.readyToDepositTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                        <p className="text-[9px] text-fg/40 mt-0.5">{checkRegister.summary.readyToDepositCount} check(s)</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Post-Dated</p>
                        <p className="text-xl font-black tabular-nums text-fg/70">₱{checkRegister.summary.postDatedTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                        <p className="text-[9px] text-fg/40 mt-0.5">Not bankable yet</p>
                      </div>
                      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">In Clearing</p>
                        <p className="text-xl font-black tabular-nums text-yellow-400">₱{checkRegister.summary.inClearingTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                        <p className="text-[9px] text-fg/40 mt-0.5">{checkRegister.summary.inClearingCount} with the bank</p>
                      </div>
                      <div className={`rounded-xl border px-4 py-3 ${checkRegister.summary.bouncedCount > 0 ? 'border-red-500/25 bg-red-500/10' : 'border-white/10 bg-white/5'}`}>
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Bounced</p>
                        <p className={`text-xl font-black tabular-nums ${checkRegister.summary.bouncedCount > 0 ? 'text-red-400' : 'text-fg/20'}`}>₱{checkRegister.summary.bouncedTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                        <p className="text-[9px] text-fg/40 mt-0.5">{checkRegister.summary.bouncedCount} reversed</p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                            <th className="text-left py-2.5">Check No.</th>
                            <th className="text-left py-2.5">Bank / Drawer</th>
                            <th className="text-left py-2.5">Client</th>
                            <th className="text-left py-2.5">Invoice</th>
                            <th className="text-left py-2.5">Check Date</th>
                            <th className="text-right py-2.5">Amount</th>
                            <th className="text-left py-2.5 pl-3">Status</th>
                            <th className="text-right py-2.5">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {checkRegister.checks.map(c => (
                            <tr key={c.paymentId} className={`border-b border-white/5 hover:bg-white/5 transition ${c.status === 'Bounced' ? 'bg-red-500/5' : ''}`}>
                              <td className="py-2.5 font-black text-fg tabular-nums">{c.checkNumber}</td>
                              <td className="py-2.5 text-fg/60 text-xs">
                                {c.checkBank || <span className="text-fg/20">—</span>}
                                {c.checkDrawer && <span className="block text-[9px] text-fg/35">{c.checkDrawer}</span>}
                              </td>
                              <td className="py-2.5 text-fg/70 text-xs">{c.client}</td>
                              <td className="py-2.5 text-fg/50 text-xs">{c.orderNumber}</td>
                              <td className="py-2.5 text-xs">
                                {c.checkDate ? (
                                  <span className={c.postDated ? 'text-yellow-400 font-bold' : 'text-fg/60'}>
                                    {new Date(c.checkDate).toLocaleDateString()}
                                  </span>
                                ) : <span className="text-fg/20">—</span>}
                                {c.postDated && <span className="block text-[9px] text-yellow-500/70">post-dated</span>}
                                {/* A check sitting with the bank for a week+ is
                                    worth chasing. */}
                                {c.daysInClearing > 6 && <span className="block text-[9px] text-orange-400">{c.daysInClearing}d in clearing</span>}
                              </td>
                              <td className="py-2.5 text-right tabular-nums font-black text-fg">₱{c.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                              <td className="py-2.5 pl-3">
                                <span className={`text-[10px] font-black px-2 py-1 rounded ${
                                  c.status === 'Cleared' ? 'bg-green-500/15 text-green-500'
                                  : c.status === 'Bounced' ? 'bg-red-500/15 text-red-400'
                                  : c.status === 'Deposited' ? 'bg-yellow-500/15 text-yellow-400'
                                  : 'bg-white/10 text-fg/60'}`}>{c.status}</span>
                                {c.status === 'Bounced' && c.bounceReason && (
                                  <span className="block text-[9px] text-red-400/70 italic mt-0.5 max-w-[160px]">{c.bounceReason}</span>
                                )}
                              </td>
                              <td className="py-2.5 text-right">
                                <div className="flex gap-1 justify-end">
                                  {c.status === 'On Hand' && (
                                    <button
                                      onClick={() => actOnCheck(c, 'deposit')}
                                      disabled={c.postDated}
                                      title={c.postDated ? `Cannot be deposited before ${new Date(c.checkDate).toLocaleDateString()}` : 'Mark as handed to the bank'}
                                      className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-white/8 text-fg/60 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed min-h-[28px]">
                                      Deposit
                                    </button>
                                  )}
                                  {['On Hand', 'Deposited'].includes(c.status) && (
                                    <>
                                      <button onClick={() => actOnCheck(c, 'clear')} title="The bank honoured it"
                                        className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-green-500/15 text-green-400 hover:bg-green-500/25 min-h-[28px]">
                                        Clear
                                      </button>
                                      <button onClick={() => actOnCheck(c, 'bounce')} title="Reverses the collection - the invoice reopens"
                                        className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 min-h-[28px]">
                                        Bounce
                                      </button>
                                    </>
                                  )}
                                  {c.status === 'Cleared' && (
                                    <button onClick={() => actOnCheck(c, 'bounce')} title="Bank reversed a cleared check"
                                      className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-white/5 text-fg/40 hover:bg-red-500/15 hover:text-red-400 min-h-[28px]">
                                      Reverse
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!checkRegister.checks.length && (
                        <div className="py-12 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">
                          {checkFilter ? `No ${checkFilter.toLowerCase()} checks` : 'No checks received yet'}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>


            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-fg">Collection Report</h3>
                  <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">Payments received against receivables</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">From</label>
                    <input type="date" value={collRange.start} onChange={e => setCollRange({ ...collRange, start: e.target.value })}
                      className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
                  </div>
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">To</label>
                    <input type="date" value={collRange.end} onChange={e => setCollRange({ ...collRange, end: e.target.value })}
                      className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
                  </div>
                  {/* Which date the range is read on. Collection basis = what
                      the collectors took in; deposit basis = what reached the
                      bank, i.e. the figure that ties to a bank statement. */}
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Date Basis</label>
                    <select value={collRange.basis} onChange={e => setCollRange({ ...collRange, basis: e.target.value })}
                      className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60">
                      <option value="collection">Collection date</option>
                      <option value="deposit">Deposit date</option>
                    </select>
                  </div>
                  <button onClick={fetchCollectionReport}
                    className="bg-brand text-white px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
                    Run
                  </button>
                </div>
              </div>

              {!collectionReport ? (
                <div className="py-16 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">Pick a range and run the report</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Total Collected</p>
                      <p className="text-2xl font-black tabular-nums text-green-400">₱{collectionReport.totalCollected.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Collections</p>
                      <p className="text-2xl font-black tabular-nums text-fg">{collectionReport.count}</p>
                    </div>
                    {/* Money taken in but not yet banked. This gap is exactly
                        where cash goes missing, so it gets its own tile. */}
                    <div className={`rounded-xl px-4 py-3 border ${collectionReport.undepositedTotal > 0 ? 'bg-yellow-500/10 border-yellow-500/25' : 'bg-white/5 border-white/10'}`}>
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Not Yet Deposited</p>
                      <p className={`text-2xl font-black tabular-nums ${collectionReport.undepositedTotal > 0 ? 'text-yellow-400' : 'text-fg/20'}`}>₱{collectionReport.undepositedTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-3">
                    {[
                      ['By Client', collectionReport.byClient, 'client'],
                      ['By Account', collectionReport.byMethod, 'method'],
                      ['By Collector', collectionReport.byCollector, 'collector'],
                    ].map(([label, list, key]) => (
                      <div key={label} className="bg-page-bg/40 border border-white/10 rounded-xl overflow-hidden">
                        <p className="text-[11px] font-black uppercase tracking-widest text-fg/60 px-4 py-2.5 border-b border-white/10">{label}</p>
                        <table className="w-full text-sm">
                          <tbody>
                            {list.slice(0, 8).map(r => (
                              <tr key={r[key]} className="border-b border-white/5">
                                <td className="py-2 px-4 text-fg/70 truncate max-w-[140px]">{r[key]}</td>
                                <td className="py-2 px-4 text-right tabular-nums font-bold text-fg">₱{r.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                              </tr>
                            ))}
                            {!list.length && <tr><td className="py-4 px-4 text-fg/30 text-xs">None</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                          <th className="text-left py-2.5">Collected</th>
                          <th className="text-left py-2.5">Deposited</th>
                          <th className="text-left py-2.5">Invoice</th>
                          <th className="text-left py-2.5">Client</th>
                          <th className="text-left py-2.5">To</th>
                          <th className="text-left py-2.5">Reference</th>
                          <th className="text-right py-2.5">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {collectionReport.collections.map((r, idx) => (
                          <tr key={`${r.orderId}-${idx}`} className="border-b border-white/5 hover:bg-white/5 transition">
                            <td className="py-2.5 text-fg/70 text-xs">
                              {new Date(r.collectionDate).toLocaleDateString()}
                              {r.collectedBy && <span className="block text-[9px] text-fg/35">by {r.collectedBy}</span>}
                            </td>
                            <td className="py-2.5 text-xs">
                              {r.depositDate
                                ? <span className="text-fg/70">{new Date(r.depositDate).toLocaleDateString()}</span>
                                : <span className="text-[10px] font-black px-2 py-1 rounded bg-yellow-500/15 text-yellow-400">IN TRANSIT</span>}
                              {r.floatDays > 0 && <span className="block text-[9px] text-yellow-500/70">+{r.floatDays}d float</span>}
                            </td>
                            <td className="py-2.5 text-fg font-bold">{r.orderNumber}</td>
                            <td className="py-2.5 text-fg/70">{r.client}</td>
                            <td className="py-2.5"><span className="text-[10px] font-black uppercase tracking-wider bg-brand/15 text-brand px-2 py-1 rounded">{r.depositedTo || '—'}</span></td>
                            <td className="py-2.5 text-fg/50 text-xs">
                              {r.referenceNumber || <span className="text-fg/20">—</span>}
                              {r.note && <span className="block text-[9px] text-fg/30 italic">{r.note}</span>}
                            </td>
                            <td className="py-2.5 text-right tabular-nums font-black text-green-400">₱{r.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!collectionReport.collections.length && <div className="py-16 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">No collections in this range</div>}
                  </div>
                </>
              )}
            </div>
            </div>
          )}

          {/* ===== A/P REPORT SUB-TAB ===== */}
          {/* The mirror of the A/R report. Aged on the DUE date, not the bill
              date: nobody cares how long ago a bill was raised, only how far
              past its payment date it is. */}
          {ledgerSubTab === 'apreport' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-fg">A/P Report</h3>
                  <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">Aged payables · what we owe, and when it's due</p>
                </div>
                <div className="flex items-end gap-2">
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">As Of</label>
                    <input type="date" value={apReportAsOf} onChange={e => setApReportAsOf(e.target.value)}
                      className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
                  </div>
                  <button onClick={fetchApReport}
                    className="bg-brand text-white px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
                    Run
                  </button>
                </div>
              </div>

              {!apReport ? (
                <div className="py-16 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">Pick a date and run the report</div>
              ) : (
                <>
                  {/* Buckets are DAYS PAST DUE here, not invoice age. */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {[
                      { label: 'Not Yet Due', sub: '', amt: apReport.totals.current, color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20' },
                      { label: '1–30', sub: 'days late', amt: apReport.totals.d31_60, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
                      { label: '31–60', sub: 'days late', amt: apReport.totals.d61_90, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
                      { label: '61+', sub: 'days late', amt: apReport.totals.d90_plus, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
                      { label: 'Total', sub: `${apReport.totals.count} bill(s)`, amt: apReport.totals.total, color: 'text-brand', bg: 'bg-brand/10 border-brand/25' },
                    ].map(b => (
                      <div key={b.label} className={`rounded-xl border px-4 py-3 ${b.bg}`}>
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">{b.label} <span className="normal-case font-normal">{b.sub}</span></p>
                        <p className={`text-xl font-black tabular-nums mt-1 ${b.amt > 0 ? b.color : 'text-fg/20'}`}>₱{b.amt.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className={`rounded-xl border px-4 py-3 ${apReport.overdueTotal > 0 ? 'border-red-500/25 bg-red-500/10' : 'border-white/10 bg-white/5'}`}>
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Overdue</p>
                      <p className={`text-xl font-black tabular-nums ${apReport.overdueTotal > 0 ? 'text-red-400' : 'text-fg/20'}`}>₱{apReport.overdueTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                      <p className="text-[9px] text-fg/40 mt-0.5">{apReport.overdueCount} bill(s) past their date</p>
                    </div>
                    {/* An aged bucket never answers "do we have the cash this
                        week" - this does. */}
                    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Due Within 7 Days</p>
                      <p className="text-xl font-black tabular-nums text-fg">₱{apReport.dueSoonTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                      <p className="text-[9px] text-fg/40 mt-0.5">{apReport.dueSoonCount} bill(s) coming up</p>
                    </div>
                    {/* Owed regardless, but can't be scheduled until someone
                        signs it off - an approval problem, not a cash one. */}
                    <div className={`rounded-xl border px-4 py-3 ${apReport.awaitingApprovalTotal > 0 ? 'border-yellow-500/25 bg-yellow-500/10' : 'border-white/10 bg-white/5'}`}>
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Awaiting Approval</p>
                      <p className={`text-xl font-black tabular-nums ${apReport.awaitingApprovalTotal > 0 ? 'text-yellow-400' : 'text-fg/20'}`}>₱{apReport.awaitingApprovalTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                      <p className="text-[9px] text-fg/40 mt-0.5">{apReport.awaitingApprovalCount} bill(s) not yet authorised</p>
                    </div>
                  </div>

                  {apReport.totals.undated > 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">No Due Date Set</p>
                      <p className="text-lg font-black tabular-nums text-fg/70">₱{apReport.totals.undated.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                      <p className="text-[9px] text-fg/40 mt-0.5">Can't be aged — set terms on these bills so they stop hiding from the buckets.</p>
                    </div>
                  )}

                  <div className="bg-page-bg/40 border border-white/10 rounded-xl overflow-x-auto">
                    <p className="text-[11px] font-black uppercase tracking-widest text-fg/60 px-4 py-3 border-b border-white/10">By Supplier</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                          <th className="text-left py-2.5 px-4">Supplier</th>
                          <th className="text-right py-2.5">Not Due</th>
                          <th className="text-right py-2.5">1–30</th>
                          <th className="text-right py-2.5">31–60</th>
                          <th className="text-right py-2.5">61+</th>
                          <th className="text-right py-2.5 px-4">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apReport.bySupplier.map(g => (
                          <tr key={g.supplier} className="border-b border-white/5">
                            <td className="py-2.5 px-4 font-bold text-fg">{g.supplier}</td>
                            <td className="py-2.5 text-right tabular-nums text-fg/70">{g.current ? `₱${g.current.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="py-2.5 text-right tabular-nums text-yellow-500/80">{g.d31_60 ? `₱${g.d31_60.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="py-2.5 text-right tabular-nums text-orange-500/80">{g.d61_90 ? `₱${g.d61_90.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="py-2.5 text-right tabular-nums text-red-500/80">{g.d90_plus ? `₱${g.d90_plus.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums font-black text-fg">₱{g.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="overflow-x-auto">
                    <p className="text-[11px] font-black uppercase tracking-widest text-fg/60 mb-2">Open Bills</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                          <th className="text-left py-2.5">Bill</th>
                          <th className="text-left py-2.5">Supplier</th>
                          <th className="text-left py-2.5">Description</th>
                          <th className="text-left py-2.5">Due</th>
                          <th className="text-left py-2.5">Status</th>
                          <th className="text-right py-2.5">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apReport.bills.map(b => (
                          <tr key={b._id} className={`border-b border-white/5 ${b.overdue ? 'bg-red-500/5' : ''}`}>
                            <td className="py-2.5 font-bold text-fg text-xs">
                              {b.billNumber}
                              {b.poNumber && <span className="block text-[9px] text-fg/30">{b.poNumber}</span>}
                            </td>
                            <td className="py-2.5 text-fg/70 text-xs">{b.supplier}</td>
                            <td className="py-2.5 text-fg/50 text-xs max-w-[220px] truncate" title={b.description}>{b.description || '—'}</td>
                            <td className="py-2.5 text-xs">
                              {b.dueDate ? (
                                b.overdue
                                  ? <span className="text-[10px] font-black px-2 py-1 rounded bg-red-500/15 text-red-400">{b.daysPastDue}d LATE</span>
                                  : <span className="text-fg/60">{new Date(b.dueDate).toLocaleDateString()}</span>
                              ) : <span className="text-[10px] font-black px-2 py-1 rounded bg-white/10 text-fg/40">NO DATE</span>}
                            </td>
                            <td className="py-2.5">
                              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded ${b.awaitingApproval ? 'bg-yellow-500/15 text-yellow-400' : 'bg-white/10 text-fg/60'}`}>
                                {b.status}
                              </span>
                            </td>
                            <td className="py-2.5 text-right tabular-nums font-black text-fg">₱{b.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!apReport.bills.length && <div className="py-16 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">Nothing owed as of this date</div>}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== SUPPLIER PAYMENTS SUB-TAB ===== */}
          {/* The exact counterpart of the collection report: that one is what
              came in, this is what went out. */}
          {ledgerSubTab === 'supplierpay' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-fg">Supplier Payments</h3>
                  <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">What we actually paid out, and from which account</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">From</label>
                    <input type="date" value={supPayRange.start} onChange={e => setSupPayRange({ ...supPayRange, start: e.target.value })}
                      className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
                  </div>
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">To</label>
                    <input type="date" value={supPayRange.end} onChange={e => setSupPayRange({ ...supPayRange, end: e.target.value })}
                      className="bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
                  </div>
                  <button onClick={fetchSupplierPayments}
                    className="bg-brand text-white px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
                    Run
                  </button>
                </div>
              </div>

              {!supplierPayments ? (
                <div className="py-16 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">Pick a range and run the report</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Total Paid Out</p>
                      <p className="text-2xl font-black tabular-nums text-red-400">₱{supplierPayments.totalPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">Payments</p>
                      <p className="text-2xl font-black tabular-nums text-fg">{supplierPayments.count}</p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-3">
                    {[
                      ['By Supplier', supplierPayments.bySupplier, 'supplier'],
                      ['By Account Paid From', supplierPayments.byAccount, 'account'],
                    ].map(([label, list, key]) => (
                      <div key={label} className="bg-page-bg/40 border border-white/10 rounded-xl overflow-hidden">
                        <p className="text-[11px] font-black uppercase tracking-widest text-fg/60 px-4 py-2.5 border-b border-white/10">{label}</p>
                        <table className="w-full text-sm">
                          <tbody>
                            {list.slice(0, 10).map(r => (
                              <tr key={r[key]} className="border-b border-white/5">
                                <td className="py-2 px-4 text-fg/70 truncate max-w-[180px]">{r[key]}</td>
                                <td className="py-2 px-4 text-right tabular-nums font-bold text-fg">₱{r.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                              </tr>
                            ))}
                            {!list.length && <tr><td className="py-4 px-4 text-fg/30 text-xs">None</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                          <th className="text-left py-2.5">Date</th>
                          <th className="text-left py-2.5">Supplier</th>
                          <th className="text-left py-2.5">Reference</th>
                          <th className="text-left py-2.5">Paid From</th>
                          <th className="text-right py-2.5">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierPayments.payments.map((p, i) => (
                          <tr key={`${p.reference}-${i}`} className="border-b border-white/5 hover:bg-white/5 transition">
                            <td className="py-2.5 text-fg/50 text-xs">{new Date(p.date).toLocaleDateString()}</td>
                            <td className="py-2.5 text-fg/70 text-xs">{p.supplier}</td>
                            <td className="py-2.5 text-fg/50 text-xs">
                              {p.reference || '—'}
                              {p.description && <span className="block text-[9px] text-fg/30 italic max-w-[240px] truncate" title={p.description}>{p.description}</span>}
                            </td>
                            <td className="py-2.5"><span className="text-[10px] font-black uppercase tracking-wider bg-brand/15 text-brand px-2 py-1 rounded">{p.paidFrom || '—'}</span></td>
                            <td className="py-2.5 text-right tabular-nums font-black text-red-400">₱{p.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!supplierPayments.payments.length && <div className="py-16 text-center text-fg/50 font-bold uppercase tracking-widest text-sm">No supplier payments in this range</div>}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== CHECK VOUCHERS SUB-TAB ===== */}
          {/* The disbursement paper trail. Vouchers are raised automatically by
              a bill payment or a client-credit refund - none are created by hand
              here, so this is read + void only. Voiding marks the voucher and
              nothing else: the journal entry stays posted and the bill stays
              paid, because a real check may already be in someone's hands. */}
          {ledgerSubTab === 'checkvouchers' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
                <div className="min-w-0">
                  <h3 className="text-xl sm:text-2xl font-black text-fg">Check Vouchers</h3>
                  <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">
                    The disbursement paper trail
                  </p>
                  <p className="text-[11px] text-fg/40 mt-1">
                    Issued automatically on every bill payment, credit refund and cash advance - never by hand.
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-fg/40 font-bold uppercase tracking-widest">Total Issued</p>
                  <p className="text-2xl text-brand font-black tabular-nums">{peso(cvTotal || 0)}</p>
                  <p className="text-[10px] text-fg/40 mt-0.5">Voided excluded</p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">Payee</label>
                  <select value={cvFilter.payeeType} onChange={e => setCvFilter(f => ({ ...f, payeeType: e.target.value }))}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs">
                    <option value="">All</option>
                    <option value="supplier">Supplier</option>
                    <option value="client">Client</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">Status</label>
                  <select value={cvFilter.status} onChange={e => setCvFilter(f => ({ ...f, status: e.target.value }))}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs">
                    <option value="">All</option>
                    <option value="Issued">Issued</option>
                    <option value="Voided">Voided</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">From</label>
                  <input type="date" value={cvFilter.start} onChange={e => setCvFilter(f => ({ ...f, start: e.target.value }))}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">To</label>
                  <input type="date" value={cvFilter.end} onChange={e => setCvFilter(f => ({ ...f, end: e.target.value }))}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs" />
                </div>
                <button onClick={fetchCheckVouchers}
                  className="bg-brand text-white px-4 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition min-h-[38px]">
                  Apply
                </button>
              </div>

              {!checkVouchers ? (
                <div className="py-16 text-center text-fg/40 font-bold uppercase tracking-widest text-sm">Loading…</div>
              ) : checkVouchers.length === 0 ? (
                <div className="py-16 text-center">
                  <Receipt size={28} className="mx-auto text-fg/20 mb-3" />
                  <p className="text-fg/50 font-bold uppercase tracking-widest text-sm">No vouchers found</p>
                  <p className="text-fg/30 text-xs mt-1">Pay a bill, refund a credit or issue an advance and it lands here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                        <th className="text-left py-2.5">Voucher #</th>
                        <th className="text-left py-2.5">Date</th>
                        <th className="text-left py-2.5">Payee</th>
                        <th className="text-left py-2.5">Purpose</th>
                        <th className="text-left py-2.5">Paid From</th>
                        <th className="text-left py-2.5">Reference</th>
                        <th className="text-right py-2.5">Amount</th>
                        <th className="text-right py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkVouchers.map(v => (
                        <tr key={v._id} className={`border-b border-white/5 hover:bg-white/5 transition ${v.status === 'Voided' ? 'opacity-50' : ''}`}>
                          <td className="py-2.5 text-fg font-bold text-xs">
                            {v.voucherNumber || '—'}
                            {/* Voucher numbers restart per branch, so the number
                                alone is ambiguous once a business runs more than
                                one inventory. */}
                            {v.branchCode && <span className="block text-[9px] text-fg/30 font-normal font-mono">{v.branchCode}</span>}
                          </td>
                          <td className="py-2.5 text-fg/50 text-xs">{new Date(v.date).toLocaleDateString()}</td>
                          <td className="py-2.5 text-xs">
                            <span className="text-fg/70">{v.payeeName}</span>
                            <span className="ml-1.5 text-[9px] font-black uppercase text-fg/30">{v.payeeType}</span>
                          </td>
                          <td className="py-2.5 text-fg/50 text-xs">{v.purpose}</td>
                          <td className="py-2.5 text-fg/50 text-xs">{v.sourceAccountName || v.sourceAccount || '—'}</td>
                          <td className="py-2.5 text-fg/50 text-xs">{v.referenceNumber || '—'}</td>
                          <td className={`py-2.5 text-right tabular-nums font-black ${v.status === 'Voided' ? 'text-fg/40 line-through' : 'text-fg'}`}>
                            {peso(v.amount)}
                          </td>
                          <td className="py-2.5 text-right">
                            {v.status === 'Issued' ? (
                              <button onClick={() => setCvVoidModal({ voucher: v, reason: '', busy: false })}
                                className="border border-red-500/40 text-red-400 px-2.5 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-red-500/10 transition">
                                Void
                              </button>
                            ) : (
                              <span className="text-[10px] font-black uppercase bg-red-500/15 text-red-400 px-2 py-1 rounded" title={v.voidReason || ''}>
                                Voided
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Void modal - the server requires a reason, so this cannot be a
                  plain confirm. Lives inside this sub-tab because that is the
                  only place a void can be started from. */}
              {cvVoidModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setCvVoidModal(null)}>
                  <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                    <h2 className="font-black text-fg mb-1">Void voucher {cvVoidModal.voucher.voucherNumber}</h2>
                    <p className="text-xs text-fg/50 mb-3">
                      {peso(cvVoidModal.voucher.amount)} to {cvVoidModal.voucher.payeeName}
                    </p>
                    <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 mb-3">
                      This marks the voucher only. The journal entry stays posted and the bill stays paid -
                      correcting those is a separate, deliberate entry.
                    </div>
                    <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">Reason (required)</label>
                    <textarea
                      value={cvVoidModal.reason} rows={3}
                      onChange={e => setCvVoidModal(m => ({ ...m, reason: e.target.value }))}
                      placeholder="e.g. printed with the wrong payee"
                      className="w-full bg-page-bg border border-white/10 rounded-lg p-2.5 text-fg text-sm outline-none focus:border-brand" />
                    <div className="flex gap-2 mt-4">
                      <button onClick={() => setCvVoidModal(null)} disabled={cvVoidModal.busy}
                        className="flex-1 border border-white/15 text-fg/70 px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-white/5 transition">
                        Cancel
                      </button>
                      <button onClick={submitVoidVoucher} disabled={cvVoidModal.busy || !cvVoidModal.reason.trim()}
                        className="flex-1 bg-red-500 text-white px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-red-500/90 transition disabled:opacity-40">
                        {cvVoidModal.busy ? 'Voiding…' : 'Void Voucher'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== ADVANCES SUB-TAB ===== */}
          {ledgerSubTab === 'advances' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-5 animate-fade-in">
              <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
                <div className="min-w-0">
                  <h3 className="text-xl sm:text-2xl font-black text-fg">Advances</h3>
                  <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">
                    Money moved before the transaction it belongs to
                  </p>
                </div>
                <button onClick={() => setAdvIssueModal({ ...ADV_ISSUE_BLANK })}
                  className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition min-h-[40px]">
                  <Plus size={14} /> New Advance
                </button>
              </div>

              {/* Issued vs still-open, the two numbers that actually matter */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-page-bg border border-white/10 rounded-xl p-4">
                  <p className="text-[10px] text-fg/40 font-bold uppercase tracking-widest mb-1">Total Issued</p>
                  <p className="text-2xl font-black tabular-nums text-fg">{peso(advTotals.totalIssued)}</p>
                  <p className="text-[10px] text-fg/40 mt-1">Excludes cancelled</p>
                </div>
                <div className="bg-page-bg border border-white/10 rounded-xl p-4">
                  <p className="text-[10px] text-fg/40 font-bold uppercase tracking-widest mb-1">Still Outstanding</p>
                  <p className={`text-2xl font-black tabular-nums ${advTotals.totalOutstanding > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                    {peso(advTotals.totalOutstanding)}
                  </p>
                  <p className="text-[10px] text-fg/40 mt-1">Not yet liquidated</p>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">Type</label>
                  <select value={advFilter.type} onChange={e => setAdvFilter(f => ({ ...f, type: e.target.value }))}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand">
                    <option value="">All</option>
                    <option value="employee">Employee</option>
                    <option value="supplier">Supplier</option>
                    <option value="customer">Customer deposit</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">Status</label>
                  <select value={advFilter.status} onChange={e => setAdvFilter(f => ({ ...f, status: e.target.value }))}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand">
                    <option value="">All</option>
                    <option value="Open">Open</option>
                    <option value="Partially Liquidated">Partially Liquidated</option>
                    <option value="Liquidated">Liquidated</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">From</label>
                  <input type="date" value={advFilter.start} onChange={e => setAdvFilter(f => ({ ...f, start: e.target.value }))}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
                </div>
                <div>
                  <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">To</label>
                  <input type="date" value={advFilter.end} onChange={e => setAdvFilter(f => ({ ...f, end: e.target.value }))}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
                </div>
                <button onClick={fetchAdvances}
                  className="border border-white/15 text-fg px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-white/5 transition min-h-[38px]">
                  Apply
                </button>
              </div>

              {!advances ? (
                <div className="py-16 text-center text-fg/40 font-bold uppercase tracking-widest text-sm">Loading…</div>
              ) : advances.length === 0 ? (
                <div className="py-16 text-center">
                  <HandCoins size={28} className="mx-auto text-fg/20 mb-3" />
                  <p className="text-fg/50 font-bold uppercase tracking-widest text-sm">No advances yet</p>
                  <p className="text-fg/30 text-xs mt-1">Cash floats, supplier prepayments and customer deposits show up here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                        <th className="text-left py-2.5">Number</th>
                        <th className="text-left py-2.5">Type</th>
                        <th className="text-left py-2.5">Payee</th>
                        <th className="text-left py-2.5">Purpose</th>
                        <th className="text-left py-2.5">Date</th>
                        <th className="text-right py-2.5">Amount</th>
                        <th className="text-right py-2.5">Outstanding</th>
                        <th className="text-left py-2.5 pl-3">Status</th>
                        <th className="text-right py-2.5">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {advances.map(a => {
                        const typeCls = {
                          employee: 'bg-blue-500/15 text-blue-400',
                          supplier: 'bg-purple-500/15 text-purple-400',
                          customer: 'bg-teal-500/15 text-teal-400',
                        }[a.type];
                        const stCls = {
                          'Open': 'bg-amber-500/15 text-amber-400',
                          'Partially Liquidated': 'bg-orange-500/15 text-orange-400',
                          'Liquidated': 'bg-green-500/15 text-green-500',
                          'Cancelled': 'bg-white/10 text-fg/40',
                        }[a.status];
                        const done = a.status === 'Liquidated' || a.status === 'Cancelled';
                        return (
                          <tr key={a._id} className={`border-b border-white/5 hover:bg-white/5 transition ${a.status === 'Cancelled' ? 'opacity-50' : ''}`}>
                            <td className="py-2.5 font-bold text-fg text-xs">
                              {a.advanceNumber}
                              {a.branchCode && <span className="block text-[9px] text-fg/30 font-normal font-mono">{a.branchCode}</span>}
                              {a.checkVoucherRef && <span className="block text-[9px] text-fg/30 font-normal">CV {a.checkVoucherRef}</span>}
                            </td>
                            <td className="py-2.5">
                              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded ${typeCls}`}>{a.type}</span>
                            </td>
                            <td className="py-2.5 text-fg/70 text-xs">{a.payeeName}</td>
                            <td className="py-2.5 text-fg/40 text-xs max-w-[180px] truncate" title={a.purpose || ''}>{a.purpose || '—'}</td>
                            <td className="py-2.5 text-fg/50 text-xs">{new Date(a.date).toLocaleDateString()}</td>
                            <td className="py-2.5 text-right tabular-nums text-fg/70">{peso(a.amount)}</td>
                            <td className={`py-2.5 text-right tabular-nums font-black ${a.outstanding > 0 ? 'text-amber-400' : 'text-fg/25'}`}>
                              {a.outstanding > 0 ? peso(a.outstanding) : '—'}
                            </td>
                            <td className="py-2.5 pl-3">
                              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded whitespace-nowrap ${stCls}`}
                                title={a.status === 'Cancelled' ? (a.cancelReason || '') : ''}>
                                {a.status}
                              </span>
                            </td>
                            <td className="py-2.5 text-right">
                              {!done && (
                                <div className="flex flex-col items-end gap-1">
                                  <button onClick={() => openAdvLiquidate(a)}
                                    className="bg-brand text-white px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition whitespace-nowrap">
                                    Liquidate
                                  </button>
                                  {/* Cancelling is only honest while nothing has
                                      been cleared - after that the server sends
                                      you to a cash return instead. */}
                                  {a.status === 'Open' && (
                                    <button onClick={() => setAdvCancelModal({ advance: a, reason: '' })}
                                      className="border border-red-500/30 text-red-400 px-3 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-red-500/10 transition">
                                      Cancel
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Issue modal ── */}
              {advIssueModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setAdvIssueModal(null)}>
                  <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                    <h2 className="font-black text-fg text-lg mb-1">New Advance</h2>
                    <p className="text-xs text-fg/50 mb-4">
                      {advIssueModal.type === 'customer'
                        ? 'A deposit received from a customer. Cash comes in and we owe them goods or services.'
                        : 'Cash goes out now against something that has not been billed yet. A Check Voucher is issued automatically.'}
                    </p>

                    <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Type</label>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {[['employee', 'Employee'], ['supplier', 'Supplier'], ['customer', 'Customer']].map(([v, label]) => (
                        <button key={v} onClick={() => setAdvIssueModal(f => ({ ...f, type: v }))}
                          className={`px-2 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition ${
                            advIssueModal.type === v ? 'bg-brand text-white' : 'bg-white/5 text-fg/50 hover:text-fg'}`}>
                          {label}
                        </button>
                      ))}
                    </div>

                    <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">
                      {advIssueModal.type === 'customer' ? 'Customer' : advIssueModal.type === 'supplier' ? 'Supplier' : 'Employee'} name
                    </label>
                    <input type="text" value={advIssueModal.payeeName} autoFocus
                      onChange={e => setAdvIssueModal(f => ({ ...f, payeeName: e.target.value }))}
                      placeholder="Who is this for?"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

                    <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Amount</label>
                    <input type="number" step="0.01" min="0" value={advIssueModal.amount}
                      onChange={e => setAdvIssueModal(f => ({ ...f, amount: e.target.value }))}
                      placeholder="0.00"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

                    <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">
                      {advIssueModal.type === 'customer' ? 'Deposit into' : 'Pay from'}
                    </label>
                    <select value={advIssueModal.sourceAccount}
                      onChange={e => setAdvIssueModal(f => ({ ...f, sourceAccount: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand">
                      {(cashAndBankAccounts || []).map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                    </select>

                    <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Reference No.</label>
                    <input type="text" value={advIssueModal.referenceNumber}
                      onChange={e => setAdvIssueModal(f => ({ ...f, referenceNumber: e.target.value }))}
                      placeholder="OR no., check no., deposit slip..."
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

                    <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Purpose / Remarks</label>
                    <textarea value={advIssueModal.purpose} rows={2}
                      onChange={e => setAdvIssueModal(f => ({ ...f, purpose: e.target.value }))}
                      placeholder="e.g. fuel float for the week"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-5 outline-none focus:border-brand" />

                    <div className="flex gap-3">
                      <button onClick={() => setAdvIssueModal(null)} disabled={advBusy}
                        className="flex-1 bg-white/5 hover:bg-white/10 text-fg/50 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">
                        Cancel
                      </button>
                      <button onClick={submitIssueAdvance} disabled={advBusy}
                        className="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50">
                        {advBusy ? 'Recording…' : 'Issue Advance'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Liquidate modal ── */}
              {advLiqModal && (() => {
                const a = advLiqModal.advance;
                const methods = a.type === 'customer'
                  ? [['order', 'Apply to an order'], ['cash-return', 'Refund the cash']]
                  : [['expense', 'Spent on an expense'], ['bill', 'Apply to a bill'], ['cash-return', 'Cash returned']];
                const entered = parseFloat(advLiqModal.amount) || 0;
                const over = entered > a.outstanding + 0.01;
                return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setAdvLiqModal(null)}>
                    <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                      <h2 className="font-black text-fg text-lg mb-1">Liquidate {a.advanceNumber}</h2>
                      <p className="text-xs text-fg/50 mb-4">
                        {a.payeeName} · {peso(a.outstanding)} of {peso(a.amount)} still open
                      </p>

                      <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">How was it cleared?</label>
                      <div className="space-y-1.5 mb-4">
                        {methods.map(([v, label]) => (
                          <button key={v} onClick={() => setAdvLiqModal(f => ({ ...f, method: v }))}
                            className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold transition border ${
                              advLiqModal.method === v
                                ? 'bg-brand/15 border-brand/50 text-fg'
                                : 'bg-white/5 border-white/10 text-fg/50 hover:text-fg'}`}>
                            {label}
                          </button>
                        ))}
                      </div>

                      <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Amount</label>
                      <input type="number" step="0.01" min="0" value={advLiqModal.amount}
                        onChange={e => setAdvLiqModal(f => ({ ...f, amount: e.target.value }))}
                        className={`w-full bg-white/5 border rounded-lg px-3 py-2.5 text-sm text-fg mb-1 outline-none ${
                          over ? 'border-red-500/60' : 'border-white/10 focus:border-brand'}`} />
                      {over
                        ? <p className="text-[11px] text-red-400 mb-3">Exceeds the {peso(a.outstanding)} still open on this advance.</p>
                        : <p className="text-[11px] text-fg/30 mb-3">Leave as-is to clear the full remaining balance.</p>}

                      {advLiqModal.method === 'expense' && (
                        <>
                          <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Expense account</label>
                          <select value={advLiqModal.expenseAccount}
                            onChange={e => setAdvLiqModal(f => ({ ...f, expenseAccount: e.target.value }))}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand">
                            <option value="">Select what it was spent on…</option>
                            {(expenseAccounts || []).map(x => <option key={x.code} value={x.code}>{x.code} - {x.name}</option>)}
                          </select>
                        </>
                      )}

                      {advLiqModal.method === 'cash-return' && (
                        <>
                          <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Returned into</label>
                          <select value={advLiqModal.returnToAccount}
                            onChange={e => setAdvLiqModal(f => ({ ...f, returnToAccount: e.target.value }))}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand">
                            {(cashAndBankAccounts || []).map(x => <option key={x.code} value={x.code}>{x.code} - {x.name}</option>)}
                          </select>
                        </>
                      )}

                      {advLiqModal.method === 'bill' && (() => {
                        // Only a bill that can still take money is a valid
                        // target; anything Paid or Rejected would just error.
                        const payable = (bills || []).filter(b => ['Approved', 'Partially Paid'].includes(b.status));
                        return (
                          <>
                            <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Bill to settle</label>
                            {payable.length === 0 ? (
                              <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 mb-4">
                                No approved or partially paid bills to apply this against.
                              </p>
                            ) : (
                              <select value={advLiqModal.billId}
                                onChange={e => setAdvLiqModal(f => ({ ...f, billId: e.target.value }))}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand">
                                <option value="">Select a bill…</option>
                                {payable.map(b => (
                                  <option key={b._id} value={b._id}>
                                    {b.billNumber} · {b.supplierName} · {peso(b.amount - (b.paidAmount || 0))} left
                                  </option>
                                ))}
                              </select>
                            )}
                          </>
                        );
                      })()}

                      {advLiqModal.method === 'order' && (() => {
                        const open = arOutstanding?.orders || [];
                        return (
                          <>
                            <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Order to apply to</label>
                            {open.length === 0 ? (
                              <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 mb-4">
                                No outstanding receivables to apply this deposit against.
                              </p>
                            ) : (
                              <select value={advLiqModal.orderId}
                                onChange={e => setAdvLiqModal(f => ({ ...f, orderId: e.target.value }))}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand">
                                <option value="">Select an order…</option>
                                {open.map(o => (
                                  <option key={o._id} value={o._id}>
                                    {o.orderNumber} · {o.customerName} · {peso(o.balance ?? o.total)} due
                                  </option>
                                ))}
                              </select>
                            )}
                          </>
                        );
                      })()}

                      <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Reference No.</label>
                      <input type="text" value={advLiqModal.referenceNumber}
                        onChange={e => setAdvLiqModal(f => ({ ...f, referenceNumber: e.target.value }))}
                        placeholder="Receipt no., OR no., txn ref..."
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

                      <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Remarks</label>
                      <textarea value={advLiqModal.note} rows={2}
                        onChange={e => setAdvLiqModal(f => ({ ...f, note: e.target.value }))}
                        placeholder="What this covers"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-5 outline-none focus:border-brand" />

                      <div className="flex gap-3">
                        <button onClick={() => setAdvLiqModal(null)} disabled={advBusy}
                          className="flex-1 bg-white/5 hover:bg-white/10 text-fg/50 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">
                          Cancel
                        </button>
                        <button onClick={submitLiquidateAdvance} disabled={advBusy || over}
                          className="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50">
                          {advBusy ? 'Posting…' : 'Liquidate'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Cancel modal ── */}
              {advCancelModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setAdvCancelModal(null)}>
                  <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                    <h2 className="font-black text-fg mb-1">Cancel {advCancelModal.advance.advanceNumber}</h2>
                    <p className="text-xs text-fg/50 mb-3">
                      {peso(advCancelModal.advance.amount)} · {advCancelModal.advance.payeeName}
                    </p>
                    <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 mb-3">
                      This posts a reversal of the original entry. Only possible because nothing has been
                      liquidated yet.
                    </div>
                    <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1">Reason (required)</label>
                    <textarea value={advCancelModal.reason} rows={3}
                      onChange={e => setAdvCancelModal(m => ({ ...m, reason: e.target.value }))}
                      placeholder="e.g. issued twice by mistake"
                      className="w-full bg-page-bg border border-white/10 rounded-lg p-2.5 text-fg text-sm outline-none focus:border-brand" />
                    <div className="flex gap-2 mt-4">
                      <button onClick={() => setAdvCancelModal(null)} disabled={advBusy}
                        className="flex-1 border border-white/15 text-fg/70 px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-white/5 transition">
                        Keep
                      </button>
                      <button onClick={submitCancelAdvance} disabled={advBusy || !advCancelModal.reason.trim()}
                        className="flex-1 bg-red-500 text-white px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-red-500/90 transition disabled:opacity-40">
                        {advBusy ? 'Cancelling…' : 'Cancel Advance'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== A/R OUTSTANDING SUB-TAB ===== */}
          {(ledgerSubTab === 'ar' || ledgerSubTab === 'araap') && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex flex-wrap justify-between items-end gap-3 border-b border-white/10 pb-4">
                <div className="min-w-0">
                  <h3 className="text-xl sm:text-2xl font-black text-fg">Accounts Receivable</h3>
                  <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">Non-Cash sales awaiting settlement (E-Wallet · Bank · Delivery)</p>
                </div>
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="text-right">
                    <p className="text-fg/60 text-[10px] font-bold uppercase whitespace-nowrap">Total Outstanding</p>
                    <p className="text-2xl sm:text-3xl text-brand font-black tabular-nums whitespace-nowrap">₱{arOutstanding.totalOutstanding.toFixed(2)}</p>
                  </div>
                  {arOutstanding.orders.length > 0 && <button onClick={exportArPDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition shrink-0"><Download size={12} /> PDF</button>}
                </div>
              </div>

              {/* AR Aging Summary */}
              {arOutstanding.orders.length > 0 && (() => {
                // Age on the unpaid remainder - a partly collected invoice
                // must not keep sitting in a bucket at its original value.
                const ab = agingBuckets(arOutstanding.orders, o => o.createdAt, o => (o.balance ?? o.total));
                const buckets = [
                  { label: 'Current', sub: '0–30 days', amt: ab.c,    color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20' },
                  { label: '31–60',   sub: 'days',       amt: ab.d60,  color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
                  { label: '61–90',   sub: 'days',       amt: ab.d90,  color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
                  { label: '91+',     sub: 'days',       amt: ab.over, color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
                ];
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {buckets.map(b => (
                      <div key={b.label} className={`rounded-xl border px-4 py-3 ${b.bg}`}>
                        <p className="text-[10px] font-black uppercase tracking-widest text-fg/60">{b.label} <span className="normal-case font-normal">{b.sub}</span></p>
                        <p className={`text-xl font-black tabular-nums mt-1 ${b.amt > 0 ? b.color : 'text-fg/20'}`}>₱{b.amt.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Per-client ageing - answers "who owes me, how old is it, and are
                  they over their limit?" without leaving the tab. Server-computed
                  so these buckets and the order-time credit gate share one rule set. */}
              {arAgeing?.clients?.length > 0 && (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <p className="text-[11px] font-black uppercase tracking-widest text-fg/60">Ageing by Client</p>
                    {arAgeing.mode !== 'off' && (
                      <span className="text-[9px] font-black uppercase tracking-widest bg-brand/15 border border-brand/30 text-brand px-2 py-1 rounded-full">
                        Limits: {arAgeing.mode.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-fg/60 text-[10px] uppercase tracking-widest border-b border-white/10">
                        <th className="text-left py-2.5 px-4">Client</th>
                        <th className="text-right py-2.5">Current</th>
                        <th className="text-right py-2.5">31–60</th>
                        <th className="text-right py-2.5">61–90</th>
                        <th className="text-right py-2.5">91+</th>
                        <th className="text-right py-2.5">Total</th>
                        <th className="text-right py-2.5" title="Everything on account including orders still in flight - this is what the credit limit spends">Committed</th>
                        <th className="text-right py-2.5 px-4">Limit / Left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arAgeing.clients.map(row => (
                        <tr key={row.client} className={`border-b border-white/5 ${row.overLimit ? 'bg-red-500/5' : ''}`}>
                          <td className="py-2.5 px-4 font-bold text-fg">
                            {row.client}
                            {row.overLimit && <span className="ml-2 text-[8px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded uppercase">Over</span>}
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-fg/70">{row.current ? `₱${row.current.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                          <td className="py-2.5 text-right tabular-nums text-yellow-500/80">{row.d31_60 ? `₱${row.d31_60.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                          <td className="py-2.5 text-right tabular-nums text-orange-500/80">{row.d61_90 ? `₱${row.d61_90.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                          <td className="py-2.5 text-right tabular-nums text-red-500/80">{row.d90_plus ? `₱${row.d90_plus.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}</td>
                          <td className="py-2.5 text-right tabular-nums font-black text-fg">₱{row.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                          <td className="py-2.5 text-right tabular-nums text-brand/80">
                            {row.exposure ? `₱${row.exposure.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '-'}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums text-xs">
                            {row.creditLimit === null || row.creditLimit === undefined ? (
                              <span className="text-fg/25">No limit</span>
                            ) : (
                              <span className={row.overLimit ? 'text-red-400 font-bold' : 'text-fg/60'}>
                                ₱{row.creditLimit.toLocaleString('en-PH')} <span className="text-fg/60">/</span> ₱{(row.available ?? 0).toLocaleString('en-PH')}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {arOutstanding.orders.length === 0 ? (
                <div className="py-16 text-center text-fg/60 font-bold uppercase tracking-widest text-sm">No outstanding A/R </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-fg/60 text-xs uppercase tracking-widest border-b border-white/10">
                        <th className="text-left py-3">Order #</th>
                        <th className="text-left py-3">Customer</th>
                        <th className="text-left py-3">Channel</th>
                        <th className="text-left py-3">Date</th>
                        <th className="text-left py-3">Age</th>
                        <th className="text-left py-3">Due</th>
                        <th className="text-right py-3">Invoiced</th>
                        <th className="text-right py-3">Collected</th>
                        <th className="text-right py-3">Balance</th>
                        <th className="text-right py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arPage.pageItems.map(o => {
                        const days = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 86400000);
                        const ageBadge = days <= 30
                          ? 'bg-green-400/15 text-green-500'
                          : days <= 60 ? 'bg-yellow-500/15 text-yellow-400'
                          : days <= 90 ? 'bg-orange-500/15 text-orange-400'
                          : 'bg-red-500/15 text-red-400';
                        return (
                          <tr key={o._id} className="border-b border-white/5 hover:bg-white/5 transition">
                            <td className="py-3 text-fg font-bold">{o.orderNumber}</td>
                            <td className="py-3 text-fg/70">{o.customerName}</td>
                            <td className="py-3"><span className="text-[10px] font-black uppercase tracking-wider bg-brand/20 text-brand px-2 py-1 rounded">{o.paymentMethod}</span></td>
                            <td className="py-3 text-fg/50 text-xs">{new Date(o.createdAt).toLocaleDateString()}</td>
                            <td className="py-3"><span className={`text-[10px] font-black px-2 py-1 rounded ${ageBadge}`}>{days}d</span></td>
                            <td className="py-3 text-xs">
                              {o.arDueDate ? (
                                o.overdue
                                  ? <span className="text-[10px] font-black px-2 py-1 rounded bg-red-500/15 text-red-400">OVERDUE · {new Date(o.arDueDate).toLocaleDateString()}</span>
                                  : <span className="text-fg/60">{new Date(o.arDueDate).toLocaleDateString()}</span>
                              ) : <span className="text-fg/25">-</span>}
                            </td>
                            {/* Invoiced is the face value and never moves;
                                balance is what is still owed after any partial
                                collections. Both are shown because a client
                                asking "what do I owe on invoice X" needs the
                                second, and reconciling against the sale needs
                                the first. */}
                            <td className="py-3 text-right text-fg/50 tabular-nums">₱{o.total.toFixed(2)}</td>
                            <td className="py-3 text-right tabular-nums">
                              {o.paid > 0
                                ? <button onClick={() => openArHistory(o)} className="text-green-400 font-bold hover:underline" title="View payment history">₱{o.paid.toFixed(2)}{o.paymentCount > 1 ? ` (${o.paymentCount})` : ''}</button>
                                : <span className="text-fg/20">-</span>}
                            </td>
                            <td className="py-3 text-right text-fg tabular-nums font-black">₱{(o.balance ?? o.total).toFixed(2)}</td>
                            <td className="py-3 text-right">
                              <button onClick={() => {
                                let defaultMethod = 'Cash on Hand';
                                if (o.paymentMethod === 'Bank Transfer') defaultMethod = 'Bank Transfer';
                                else if (o.paymentMethod === 'Check') defaultMethod = 'Check';
                                else if (['GCash','Maya','Maribank','E-Wallet','Other E-Wallet','QR'].includes(o.paymentMethod)) defaultMethod = o.paymentMethod === 'Other E-Wallet' ? 'GCash' : o.paymentMethod;
                                else if (['Grab Delivery','Foodpanda','Manual Delivery'].includes(o.paymentMethod)) defaultMethod = 'Bank Transfer';
                                setSettleModal({ order: o });
                                // Default to collecting the REMAINDER, not the
                                // invoice face value - on a partly paid invoice
                                // the face value would be rejected as an overpayment.
                                // A sale tendered by check already captured the
                                // check number and date - carry them into the
                                // register rather than making someone read them
                                // off the paper a second time (and risk a typo
                                // that breaks the match).
                                const wasCheck = o.paymentMethod === 'Check';
                                setSettleForm({
                                  amount: (o.balance ?? o.total).toFixed(2), paymentMethod: defaultMethod,
                                  note: '', referenceNumber: '', collectedBy: '',
                                  collectionDate: todayLocal(), depositDate: todayLocal(),
                                  checkNumber: wasCheck ? (o.paymentReference || '') : '',
                                  checkDate: wasCheck && o.paymentCheckDate ? new Date(o.paymentCheckDate).toISOString().slice(0, 10) : '',
                                  checkBank: '', checkDrawer: '',
                                });
                              }}
                                className="bg-brand text-white px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
                                {o.paid > 0 ? 'Collect' : 'Settle'}
                              </button>
                              {/* Stored credit from a past overpayment draws the
                                  invoice down with no cash collected, so it is a
                                  separate action from Settle/Collect. Only shown
                                  when this client actually has credit sitting on
                                  their account. */}
                              {o.clientCredit > 0 && (
                                <button
                                  onClick={() => openClientCredit(o, Math.min(o.clientCredit, o.balance ?? o.total))}
                                  title={`₱${o.clientCredit.toFixed(2)} credit available`}
                                  className="block w-full mt-1 border border-emerald-500/40 text-emerald-400 px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-emerald-500/10 transition">
                                  Use ₱{Math.min(o.clientCredit, o.balance ?? o.total).toFixed(2)} Credit
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <Pager {...arPage} label="orders" />

                  {/* Applying stored credit posts to the ledger just like a cash
                      collection does, so it collects the same reference and
                      remarks rather than firing on a bare confirm. */}
                  {clientCreditModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setClientCreditModal(null)}>
                      <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                        <h2 className="font-black text-fg text-lg mb-1">Apply client credit</h2>
                        <p className="text-xs text-fg/50 mb-4">
                          {clientCreditModal.order.orderNumber} · {clientCreditModal.order.customerName}
                        </p>
                        <div className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-2.5 mb-4">
                          {peso(clientCreditModal.order.clientCredit)} credit available ·
                          {' '}{peso(clientCreditModal.order.balance ?? clientCreditModal.order.total)} still due.
                          No cash is collected.
                        </div>

                        <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Amount</label>
                        <input type="number" step="0.01" min="0" value={clientCreditModal.amount}
                          onChange={e => setClientCreditModal(m => ({ ...m, amount: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

                        <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Reference No.</label>
                        <input type="text" value={clientCreditModal.referenceNumber}
                          onChange={e => setClientCreditModal(m => ({ ...m, referenceNumber: e.target.value }))}
                          placeholder="Credit memo no., OR no..."
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-4 outline-none focus:border-brand" />

                        <label className="text-[10px] text-fg/40 uppercase tracking-widest font-bold block mb-1.5">Remarks</label>
                        <textarea value={clientCreditModal.note} rows={2}
                          onChange={e => setClientCreditModal(m => ({ ...m, note: e.target.value }))}
                          placeholder="Why this credit is being applied here"
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-5 outline-none focus:border-brand" />

                        <div className="flex gap-3">
                          <button onClick={() => setClientCreditModal(null)} disabled={clientCreditModal.busy}
                            className="flex-1 bg-white/5 hover:bg-white/10 text-fg/50 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">
                            Cancel
                          </button>
                          <button onClick={submitClientCredit} disabled={clientCreditModal.busy}
                            className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50">
                            {clientCreditModal.busy ? 'Applying…' : 'Apply Credit'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===== ACCOUNTS PAYABLE SUB-TAB ===== */}
          {(ledgerSubTab === 'ap' || ledgerSubTab === 'araap') && (
            <div className="space-y-6 animate-fade-in">
              {/* Summary KPI bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-surface border border-white/10 rounded-xl p-5">
                  <p className="text-[10px] text-fg/40 font-bold uppercase tracking-widest mb-1">Outstanding A/P Balance</p>
                  <p className={`text-2xl font-black tabular-nums ${apData?.outstandingBalance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    ₱{(apData?.outstandingBalance || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-[10px] text-fg/60 mt-1">Total owed to suppliers</p>
                </div>
                <div className="bg-surface border border-white/10 rounded-xl p-5">
                  <p className="text-[10px] text-fg/40 font-bold uppercase tracking-widest mb-1">Total Purchased on Credit</p>
                  <p className="text-xl font-black text-fg/80 tabular-nums">₱{(apData?.totalCredit || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-surface border border-white/10 rounded-xl p-5">
                  <p className="text-[10px] text-fg/40 font-bold uppercase tracking-widest mb-1">Total Payments Made</p>
                  <p className="text-xl font-black text-green-400/80 tabular-nums">₱{(apData?.totalDebit || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>

              {/* Pay AP button */}
              <div className="flex justify-end gap-2">
                {apData && <button onClick={exportApPDF} className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                {apData?.outstandingBalance > 0 && (
                  <button onClick={() => setApPayModal(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition shadow-elev-1">
                    <CreditCard size={15}/> Record Supplier Payment
                  </button>
                )}
              </div>

              {/* Pay AP modal */}
              {apPayModal && (
                <div className="fixed inset-0 z-[9998] bg-black/85 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
                  <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-sm shadow-elev-3 flex flex-col max-h-[90vh] overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                      <h2 className="text-fg font-black text-lg">Record A/P Payment</h2>
                      <button onClick={() => setApPayModal(false)} className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition"><X size={14}/></button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                      <div className="bg-brand/10 border border-brand/20 rounded-xl px-4 py-3 text-xs text-brand/80 font-bold">
                        Outstanding: ₱{(apData?.outstandingBalance || 0).toFixed(2)} · Journal: DR 2000 A/P / CR Cash
                      </div>
                      <div>
                        <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Amount (₱) *</label>
                        <input type="number" min="0" step="0.01" value={apPayForm.amount}
                          onChange={e => setApPayForm(p => ({...p, amount: e.target.value}))}
                          className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg text-xl font-black tabular-nums outline-none focus:border-brand/60" />
                      </div>
                      <div>
                        <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Pay From *</label>
                        <select value={apPayForm.payFromAccount} onChange={e => setApPayForm(p => ({...p, payFromAccount: e.target.value}))}
                          className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-brand/60">
                          {(cashAndBankAccounts || []).map(a => (
                            <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Supplier</label>
                        <select value={apPayForm.supplierId || ''}
                          onChange={e => {
                            const id = e.target.value;
                            const owed = (apData?.bySupplier || []).find(s => s.supplierId === id);
                            // Prefill the amount with what this supplier is owed -
                            // paying a balance in full is the common case.
                            setApPayForm(p => ({
                              ...p, supplierId: id,
                              amount: owed ? String(owed.balance) : p.amount,
                            }));
                          }}
                          className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-brand/60">
                          <option value="">- Other / one-off payee -</option>
                          {(suppliers || []).map(s => {
                            const owed = (apData?.bySupplier || []).find(b => b.supplierId === String(s._id));
                            return (
                              <option key={s._id} value={s._id}>
                                {s.name}{owed ? ` - ₱${owed.balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })} owed` : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      {!apPayForm.supplierId && (
                        <div>
                          <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Payee Name</label>
                          <input type="text" placeholder="e.g. one-off hauler" value={apPayForm.vendorName}
                            onChange={e => setApPayForm(p => ({...p, vendorName: e.target.value}))}
                            className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-brand/60 placeholder-white/20" />
                          <p className="text-[10px] text60 mt-1">Payments without a supplier record group under “Unattributed”.</p>
                        </div>
                      )}
                      <div>
                        <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Description</label>
                        <input type="text" placeholder="e.g. Weekly supply payment" value={apPayForm.description}
                          onChange={e => setApPayForm(p => ({...p, description: e.target.value}))}
                          className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-brand/60 placeholder-white/20" />
                      </div>
                      <div>
                        <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Reference No. (optional)</label>
                        <input type="text" placeholder="Bank txn ID, check no., GCash ref..." value={apPayForm.referenceNumber}
                          onChange={e => setApPayForm(p => ({...p, referenceNumber: e.target.value}))}
                          className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg outline-none focus:border-brand/60 placeholder-white/20" />
                      </div>
                    </div>
                    <div className="px-5 py-4 border-t border-white/10 flex gap-3">
                      <button onClick={() => setApPayModal(false)} className="flex-1 bg-white/5 text-fg/60 rounded-xl py-3 font-bold text-sm hover:bg-white/10 transition">Cancel</button>
                      <button onClick={submitApPayment} disabled={apPaySubmitting}
                        className="flex-1 bg-brand text-white rounded-xl py-3 font-bold text-sm hover:bg-brand/90 transition disabled:opacity-50">
                        {apPaySubmitting ? 'Recording…' : 'Record Payment'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* AP Aging */}
              {apCreditEntries.length > 0 && (() => {
                const ab = agingBuckets(apCreditEntries, e => e.date, e => e.outstandingAmt);
                const buckets = [
                  { label: 'Current', sub: '0–30 days', amt: ab.c,    color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20' },
                  { label: '31–60',   sub: 'days',       amt: ab.d60,  color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
                  { label: '61–90',   sub: 'days',       amt: ab.d90,  color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
                  { label: '91+',     sub: 'days',       amt: ab.over, color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
                ];
                return (
                  <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
                      <AlertTriangle size={14} className="text-fg/50"/>
                      <h3 className="text-sm font-black text-fg uppercase tracking-wider">A/P Aging</h3>
                      <span className="ml-auto text-[10px] bg-white/10 text-fg/40 px-2 py-0.5 rounded-full font-bold">FIFO - oldest paid first</span>
                    </div>
                    <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {buckets.map(b => (
                        <div key={b.label} className={`rounded-xl border px-4 py-3 ${b.bg}`}>
                          <p className="text-[10px] font-black uppercase tracking-widest text-fg/40">{b.label} <span className="normal-case font-normal">{b.sub}</span></p>
                          <p className={`text-xl font-black tabular-nums mt-1 ${b.amt > 0 ? b.color : 'text-fg/20'}`}>₱{b.amt.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                        </div>
                      ))}
                    </div>
                    <div className="overflow-x-auto border-t border-white/10">
                      <table className="w-full text-left text-xs min-w-[480px]">
                        <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                          <tr>
                            <th className="px-5 py-2.5">Date</th>
                            <th className="px-5 py-2.5">Reference</th>
                            <th className="px-5 py-2.5">Description</th>
                            <th className="px-5 py-2.5 text-center">Age</th>
                            <th className="px-5 py-2.5 text-right">Outstanding</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apCreditEntries.map((e, i) => {
                            const days = Math.floor((Date.now() - new Date(e.date).getTime()) / 86400000);
                            const ageBadge = days <= 30
                              ? 'bg-green-500/15 text-green-400'
                              : days <= 60 ? 'bg-yellow-500/15 text-yellow-400'
                              : days <= 90 ? 'bg-orange-500/15 text-orange-400'
                              : 'bg-red-500/15 text-red-400';
                            return (
                              <tr key={e._id || i} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                                <td className="px-5 py-2.5 text-fg/40 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                                <td className="px-5 py-2.5 font-mono text-fg/60 whitespace-nowrap">{e.reference}</td>
                                <td className="px-5 py-2.5 text-fg/70 truncate max-w-[200px]">{e.description}</td>
                                <td className="px-5 py-2.5 text-center"><span className={`text-[10px] font-black px-2 py-0.5 rounded ${ageBadge}`}>{days}d</span></td>
                                <td className="px-5 py-2.5 text-right text-red-400 font-mono tabular-nums font-bold">₱{e.outstandingAmt.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* Who we owe - per-supplier payable balances. Answers "how much do
                  we owe Best Beans?" without reading journal descriptions. */}
              {(apData?.bySupplier || []).length > 0 && (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
                    <Truck size={14} className="text-fg/50"/>
                    <h3 className="text-sm font-black text-fg uppercase tracking-wider">Payables by Supplier</h3>
                    <span className="ml-auto text-[10px] bg-white/10 text-fg/40 px-2 py-0.5 rounded-full font-bold">{apData.bySupplier.length}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-fg/40 text-[10px] uppercase tracking-widest border-b border-white/10">
                        <th className="text-left py-2.5 px-4">Supplier</th>
                        <th className="text-right py-2.5">Purchased</th>
                        <th className="text-right py-2.5">Paid</th>
                        <th className="text-right py-2.5">Balance</th>
                        <th className="text-right py-2.5 px-4">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apData.bySupplier.map(s => (
                        <tr key={s.supplierId || 'unattributed'} className="border-b border-white/5">
                          <td className="py-2.5 px-4 font-bold text-fg">
                            {s.supplier}
                            {!s.supplierId && (
                              <span className="ml-2 text-[8px] font-black bg-white/10 text-fg/40 px-1.5 py-0.5 rounded uppercase" title="Entries recorded without a supplier record">No record</span>
                            )}
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-fg/60">₱{s.incurred.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                          <td className="py-2.5 text-right tabular-nums text-green-400/70">₱{s.paid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                          <td className={`py-2.5 text-right tabular-nums font-black ${s.balance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                            ₱{s.balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            {s.supplierId && s.balance > 0 && (
                              <button
                                onClick={() => { setApPayForm(p => ({ ...p, supplierId: s.supplierId, amount: String(s.balance) })); setApPayModal(true); }}
                                className="text-[10px] font-black uppercase tracking-wider bg-brand/15 border border-brand/30 text-brand px-3 py-1.5 rounded-lg hover:bg-brand hover:text-white transition">
                                Pay
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Recent AP Journal Entries */}
              <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
                  <FileText size={14} className="text-fg/50"/>
                  <h3 className="text-sm font-black text-fg uppercase tracking-wider">A/P Journal History</h3>
                  <span className="ml-auto text-[10px] bg-white/10 text-fg/40 px-2 py-0.5 rounded-full font-bold">{(apData?.recent || []).length} entries</span>
                </div>
                {!apData ? (
                  <p className="text-fg/60 text-sm p-6 text-center font-bold">Loading…</p>
                ) : (apData.recent || []).length === 0 ? (
                  <p className="text-fg/60 text-sm p-6 text-center font-bold">No A/P transactions yet. Procure inventory on credit to see entries here.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[480px]">
                      <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <tr>
                          <th className="px-5 py-2.5">Date</th>
                          <th className="px-5 py-2.5">Reference</th>
                          <th className="px-5 py-2.5">Supplier</th>
                          <th className="px-5 py-2.5">Description</th>
                          <th className="px-5 py-2.5 text-right">Incurred (CR)</th>
                          <th className="px-5 py-2.5 text-right">Paid (DR)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apPage.pageItems.map((e, i) => (
                          <tr key={e._id || i} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                            <td className="px-5 py-2.5 text-fg/40 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                            <td className="px-5 py-2.5 font-mono text-fg/60 whitespace-nowrap">{e.reference}</td>
                            <td className="px-5 py-2.5 text-fg/70 whitespace-nowrap">{e.supplierName || <span className="text-fg/20">-</span>}</td>
                            <td className="px-5 py-2.5 text-fg/70 truncate max-w-[200px]">{e.description}</td>
                            <td className="px-5 py-2.5 text-right text-red-400 font-mono tabular-nums font-bold">{e.credit > 0 ? `₱${e.credit.toFixed(2)}` : '-'}</td>
                            <td className="px-5 py-2.5 text-right text-green-400 font-mono tabular-nums font-bold">{e.debit > 0 ? `₱${e.debit.toFixed(2)}` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pager {...apPage} label="entries" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== SALES BY PAYMENT METHOD ===== */}
          {ledgerSubTab === 'payments' && (
            <div className="space-y-4 animate-fade-in">
              {/* Date range picker */}
              <div className="flex flex-wrap gap-3 items-center">
                <input type="date" value={sbpRange.start} onChange={e => setSbpRange(p=>({...p,start:e.target.value}))}
                  className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <span className="text-fg/60 font-bold text-sm">→</span>
                <input type="date" value={sbpRange.end} onChange={e => setSbpRange(p=>({...p,end:e.target.value}))}
                  className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50" />
                <button onClick={fetchSalesByPayment} className="px-5 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition">Load</button>
                {salesByPayment && <button onClick={exportPaymentsPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
              </div>
              {!salesByPayment ? (
                <p className="text-fg/60 text-sm text-center p-6 font-bold">Select a date range and click Load.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-surface border border-white/10 rounded-xl p-5">
                      <p className="text-[10px] text-fg/60 font-bold uppercase">Total Revenue</p>
                      <p className="text-2xl font-black text-brand tabular-nums">₱{(salesByPayment.grandTotal||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</p>
                    </div>
                    <div className="bg-surface border border-white/10 rounded-xl p-5">
                      <p className="text-[10px] text-fg/60 font-bold uppercase">Payment Channels</p>
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
                            <td className="px-5 py-3 text-right font-black text-brand tabular-nums">₱{(r.total||0).toFixed(2)}</td>
                            <td className="px-5 py-3 text-right text-fg/50 tabular-nums">{(r.pct||0).toFixed(1)}%</td>
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
                {profitByCategory && <button onClick={exportProfitByCategoryPDF} className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                <button onClick={fetchProfitByCategory} className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition">
                  <RefreshCw size={14}/> Refresh
                </button>
              </div>
              {!profitByCategory ? (
                <p className="text-fg/60 text-sm text-center p-6 font-bold">Click Refresh to compute gross profit by menu category.</p>
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
                          <td className="px-5 py-3 text-right text-orange-400/70 tabular-nums font-mono">₱{c.estimatedCOGS.toFixed(2)}</td>
                          <td className="px-5 py-3 text-right font-black tabular-nums font-mono text-green-400">₱{c.grossProfit.toFixed(2)}</td>
                          <td className="px-5 py-3 text-right">
                            <span className={`font-black text-sm ${c.margin>=60?'text-green-400':c.margin>=35?'text-yellow-400':'text-red-400'}`}>
                              {c.margin.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...pbcPage} label="categories" /></div>
                  <p className="text-[10px] text-fg/60 p-3 text-center">
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
                <p className="text-xs text-fg/60">Stars (sell + profit), Plowhorses (sell, low margin), Puzzles (high margin, low sell), Dogs (neither).</p>
                <div className="flex gap-2">
                  {menuEngineering && <button onClick={exportMenuEngineeringPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                  <button onClick={fetchMenuEngineering} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
                </div>
              </div>
              {!menuEngineering ? (
                <p className="text-fg/60 text-sm text-center p-6 font-bold">Click Refresh to analyse the menu.</p>
              ) : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[520px]">
                    <thead className="text-white bg-accent text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr><th className="px-5 py-3">Item</th><th className="px-5 py-3 text-right">Qty</th><th className="px-5 py-3 text-right">Revenue</th><th className="px-5 py-3 text-right">Margin</th><th className="px-5 py-3 text-center">Class</th></tr>
                    </thead>
                    <tbody>
                      {mePage.pageItems.map((r,i) => {
                        const cls = { Star:'bg-green-500/20 text-green-400', Plowhorse:'bg-yellow-500/20 text-yellow-400', Puzzle:'bg-blue-500/20 text-blue-400', Dog:'bg-red-500/20 text-red-400' }[r.quadrant];
                        return (
                          <tr key={i} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                            <td className="px-5 py-2.5 font-bold text-fg">{r.name}</td>
                            <td className="px-5 py-2.5 text-right text-fg/70 tabular-nums">{r.qty}</td>
                            <td className="px-5 py-2.5 text-right text-brand font-black tabular-nums">₱{r.revenue.toFixed(2)}</td>
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
                <p className="text-xs text-fg/60">Average cash drawer variance per cashier across closed shifts. Negative = consistently short.</p>
                <div className="flex gap-2">
                  {cashierVariance && <button onClick={exportVariancePDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                  <button onClick={fetchCashierVariance} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
                </div>
              </div>
              {!cashierVariance ? (
                <p className="text-fg/60 text-sm text-center p-6 font-bold">Click Refresh to load cashier variance.</p>
              ) : (cashierVariance.cashiers||[]).length === 0 ? (
                <p className="text-fg/60 text-sm text-center p-6 font-bold">No closed shifts with variance data yet.</p>
              ) : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[480px]">
                    <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr><th className="px-5 py-3">Cashier</th><th className="px-5 py-3 text-right">Shifts</th><th className="px-5 py-3 text-right">Avg Variance</th><th className="px-5 py-3 text-right">Times Short</th><th className="px-5 py-3 text-right">Worst</th></tr>
                    </thead>
                    <tbody>
                      {cvPage.pageItems.map((c,i) => (
                        <tr key={i} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                          <td className="px-5 py-2.5 font-bold text-fg">{c.cashierName}</td>
                          <td className="px-5 py-2.5 text-right text-fg/70 tabular-nums">{c.shifts}</td>
                          <td className={`px-5 py-2.5 text-right tabular-nums font-black ${c.avgVariance < 0 ? 'text-red-400' : 'text-green-400'}`}>{c.avgVariance >= 0 ? '+' : ''}₱{c.avgVariance.toFixed(2)}</td>
                          <td className="px-5 py-2.5 text-right text-fg/70 tabular-nums">{c.shortCount}</td>
                          <td className="px-5 py-2.5 text-right text-red-400 tabular-nums">₱{(c.worstShort||0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...cvPage} label="cashiers" /></div>
                </div>
              )}
            </div>
          )}

          {/* ===== COMMISSIONS ===== */}
          {ledgerSubTab === 'commissions' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-between items-center">
                <p className="text-xs text-fg/60">Sales attributed by cashier, at each staff member's commission rate (set in User Control). Complimentary and unattributed sales earn no commission.</p>
                <div className="flex gap-2">
                  {commissions && <button onClick={exportCommissionsPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                  <button onClick={fetchCommissions} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
                </div>
              </div>
              {!commissions ? (
                <p className="text-fg/60 text-sm text-center p-6 font-bold">Click Refresh to compute commissions.</p>
              ) : (commissions.sellers||[]).length === 0 ? (
                <p className="text-fg/60 text-sm text-center p-6 font-bold">No attributed sales yet.</p>
              ) : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[520px]">
                    <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr><th className="px-5 py-3">Cashier</th><th className="px-5 py-3 text-right">Orders</th><th className="px-5 py-3 text-right">Sales</th><th className="px-5 py-3 text-right">Rate</th><th className="px-5 py-3 text-right">Commission</th></tr>
                    </thead>
                    <tbody>
                      {cmPage.pageItems.map((c,i) => (
                        <tr key={c.userCode||i} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                          <td className="px-5 py-2.5 font-bold text-fg">{c.name}</td>
                          <td className="px-5 py-2.5 text-right text-fg/70 tabular-nums">{c.orderCount}</td>
                          <td className="px-5 py-2.5 text-right text-fg/80 tabular-nums font-mono">₱{c.salesTotal.toFixed(2)}</td>
                          <td className="px-5 py-2.5 text-right text-fg/50 tabular-nums">{c.commissionRate}%</td>
                          <td className="px-5 py-2.5 text-right font-black tabular-nums font-mono text-green-400">₱{c.commissionEarned.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-white/10">
                        <td colSpan={4} className="px-5 py-3 text-right font-bold text-fg/60 uppercase text-[10px] tracking-wider">Total</td>
                        <td className="px-5 py-3 text-right font-black tabular-nums font-mono text-green-400">₱{(commissions.totalCommission||0).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  <div className="px-3"><Pager {...cmPage} label="sellers" /></div>
                  <p className="text-[10px] text-fg/60 p-3 text-center">A cashier's rate is set on their user profile in User Control. 0% shows if none is set.</p>
                </div>
              )}
            </div>
          )}

          {/* ===== BILLS (AP approval workflow) ===== */}
          {ledgerSubTab === 'bills' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <div className="flex gap-1.5 flex-wrap">
                  {['Pending','Approved','Paid','Rejected','All'].map(s => (
                    <button key={s}
                      onClick={() => { setBillsFilter(s); fetchBills(s); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${billsFilter === s ? 'bg-brand text-white' : 'bg-white/5 text-fg/50 hover:text-fg'}`}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setBillCreate(c => ({ ...c, open: !c.open }))} className="flex items-center gap-2 px-4 py-2 bg-white/5 text-fg/70 rounded-xl font-bold text-sm hover:bg-white/10 transition"><Plus size={14}/> Manual bill</button>
                  {bills && bills.length > 0 && <button onClick={exportBillsPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg rounded-xl font-bold text-sm transition"><Download size={14}/> PDF</button>}
                  <button onClick={() => fetchBills()} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
                </div>
              </div>

              {billCreate.open && (
                <div className="bg-surface border border-white/10 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-fg/50">A manual bill (rent, utilities, one-off supplier charge) - it books nothing until you Approve it, which posts DR expense / CR Accounts Payable.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1">Supplier</label>
                      <select value={billCreate.supplierId} onChange={e => setBillCreate(c => ({ ...c, supplierId: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg">
                        <option value="">Select supplier…</option>
                        {(suppliers||[]).map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1">Expense account (debited on approval)</label>
                      <select value={billCreate.expenseAccountCode} onChange={e => setBillCreate(c => ({ ...c, expenseAccountCode: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg">
                        {(expenseAccounts||[]).map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1">Amount (₱)</label>
                      <input type="number" min="0" step="0.01" value={billCreate.amount} onChange={e => setBillCreate(c => ({ ...c, amount: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1">Due date (optional)</label>
                      <input type="date" value={billCreate.dueDate} onChange={e => setBillCreate(c => ({ ...c, dueDate: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1">Description</label>
                      <input value={billCreate.description} onChange={e => setBillCreate(c => ({ ...c, description: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg" placeholder="e.g. October warehouse rent" />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button onClick={submitCreateBill} disabled={billBusy} className="px-5 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition disabled:opacity-50">{billBusy ? 'Saving…' : 'Create bill'}</button>
                  </div>
                </div>
              )}

              {!bills ? (
                <p className="text-fg/60 text-sm text-center p-6 font-bold">Loading bills…</p>
              ) : bills.length === 0 ? (
                <p className="text-fg/60 text-sm text-center p-6 font-bold">No {billsFilter !== 'All' ? billsFilter.toLowerCase() : ''} bills.</p>
              ) : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[720px]">
                    <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr>
                        <th className="px-4 py-3">Bill #</th><th className="px-4 py-3">Supplier</th>
                        <th className="px-4 py-3">Source</th><th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billsPage.pageItems.map((b, i) => {
                        const stCls = { Pending:'bg-yellow-500/20 text-yellow-400', Approved:'bg-blue-500/20 text-blue-400', 'Partially Paid':'bg-orange-500/20 text-orange-400', Paid:'bg-green-500/20 text-green-400', Rejected:'bg-red-500/20 text-red-400' }[b.status] || 'bg-white/10 text-fg/50';
                        const billOutstanding = +(b.amount - (b.paidAmount || 0)).toFixed(2);
                        return (
                          <tr key={b._id} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                            <td className="px-4 py-3 font-mono text-fg/70">{b.billNumber}</td>
                            <td className="px-4 py-3 font-bold text-fg">{b.supplierName || '-'}</td>
                            <td className="px-4 py-3"><span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-fg/50 font-bold">{b.source}</span></td>
                            <td className="px-4 py-3 text-fg/60 max-w-[200px] truncate" title={b.description || b.poNumber}>{b.description || b.poNumber || '-'}</td>
                            <td className="px-4 py-3 text-right font-black tabular-nums font-mono text-fg">
                              {peso(b.amount)}
                              {b.status === 'Partially Paid' && <div className="text-[10px] font-normal text-orange-400 mt-0.5">{peso(billOutstanding)} left</div>}
                            </td>
                            <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${stCls}`}>{b.status}</span>
                              {b.scheduledPaymentDate && b.status === 'Approved' && <div className="text-[10px] text-fg/40 mt-1">pay {String(b.scheduledPaymentDate).slice(0,10)}</div>}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {b.status === 'Pending' && (
                                <div className="flex gap-1.5 justify-end">
                                  <button disabled={billBusy} onClick={() => approveBill(b)} className="px-2.5 py-1 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 text-[11px] font-bold transition disabled:opacity-50">Approve</button>
                                  <button disabled={billBusy} onClick={() => rejectBill(b)} className="px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400/80 hover:bg-red-500/20 text-[11px] font-bold transition disabled:opacity-50">Reject</button>
                                </div>
                              )}
                              {(b.status === 'Approved' || b.status === 'Partially Paid') && (
                                <div className="flex gap-1.5 justify-end">
                                  {b.status === 'Approved' && <button disabled={billBusy} onClick={() => scheduleBill(b)} className="px-2.5 py-1 rounded-lg bg-white/5 text-fg/60 hover:bg-white/10 text-[11px] font-bold transition disabled:opacity-50">Schedule</button>}
                                  <button disabled={billBusy} onClick={() => { setBillPayModal(b); setBillPayFrom('111000'); setBillPayReference(''); setBillPayAmount(String(billOutstanding)); }} className="px-2.5 py-1 rounded-lg bg-brand/20 text-brand hover:bg-brand/30 text-[11px] font-bold transition disabled:opacity-50">Pay</button>
                                </div>
                              )}
                              {(b.status === 'Paid' || b.status === 'Rejected') && (
                                <span className="text-[10px] text-fg/30">{b.journalEntryRef || (b.rejectionReason ? 'rejected' : '-')}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...billsPage} label="bills" /></div>
                  <p className="text-[10px] text-fg/60 p-3 text-center">PO-sourced bills already posted their liability at goods receipt - approving one is a sign-off, not a new posting. Manual bills post on approval.</p>
                </div>
              )}

              {/* Pay modal */}
              {billPayModal && (() => {
                const outstanding = +(billPayModal.amount - (billPayModal.paidAmount || 0)).toFixed(2);
                const enteredAmt = parseFloat(billPayAmount) || 0;
                const willOverpay = enteredAmt > outstanding + 0.01;
                const supplier = (suppliers || []).find(s => String(s._id) === String(billPayModal.supplierId));
                const availableCredit = supplier?.creditBalance || 0;
                return (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setBillPayModal(null)}>
                  <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                    <h2 className="font-black text-fg mb-1">Pay bill {billPayModal.billNumber}</h2>
                    <p className="text-fg/50 text-sm mb-1">{billPayModal.supplierName} · {peso(billPayModal.amount)} total</p>
                    {billPayModal.paidAmount > 0 && <p className="text-orange-400 text-xs mb-2">{peso(billPayModal.paidAmount)} already paid · {peso(outstanding)} remaining</p>}

                    {availableCredit > 0 && (
                      <div className="bg-brand/10 border border-brand/20 rounded-lg px-3 py-2 mb-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-fg/70">Supplier has <span className="text-brand font-bold">{peso(availableCredit)}</span> credit available</span>
                        <button
                          onClick={async () => { const ok = await applySupplierCredit(billPayModal.supplierId, billPayModal._id, Math.min(availableCredit, outstanding), billPayReference); if (ok) setBillPayModal(null); }}
                          disabled={billBusy}
                          className="shrink-0 bg-brand/20 hover:bg-brand/30 text-brand text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition disabled:opacity-50"
                        >Apply Credit</button>
                      </div>
                    )}

                    <p className="text-[11px] text-fg/40 mb-3">Posts DR Accounts Payable / CR the account you pay from.</p>
                    <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">Amount</label>
                    <input type="number" min="0" step="0.01" value={billPayAmount} onChange={e => setBillPayAmount(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-1" />
                    {willOverpay && (
                      <p className="text-[10px] text-amber-400 mb-2">
                        Exceeds the {peso(outstanding)} owed - the extra {peso(+(enteredAmt - outstanding).toFixed(2))} becomes this supplier's credit balance, applicable to a future bill.
                      </p>
                    )}
                    <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5 mt-2">Pay from</label>
                    <select value={billPayFrom} onChange={e => setBillPayFrom(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-3">
                      {(cashAndBankAccounts||[]).map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                    </select>
                    <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">Reference No. (optional)</label>
                    <input type="text" placeholder="Bank txn ID, check no., GCash ref..." value={billPayReference} onChange={e => setBillPayReference(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-5" />
                    <div className="flex gap-3">
                      <button onClick={() => setBillPayModal(null)} className="flex-1 bg-white/5 hover:bg-white/10 text-fg/50 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">Cancel</button>
                      <button onClick={submitBillPay} disabled={billBusy} className="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50">{billBusy ? 'Recording…' : 'Record payment'}</button>
                    </div>
                  </div>
                </div>
                );
              })()}
            </div>
          )}

          {/* ===== PURCHASE ORDER SUGGESTION ===== */}
          {ledgerSubTab === 'po' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <p className="text-xs text-fg/40">Suggested reorder quantities to cover ~7 days, based on 30-day usage + low-stock flags.</p>
                <div className="flex gap-2">
                  {purchaseOrder && (purchaseOrder.lines||[]).length > 0 && <button onClick={exportPurchaseOrderPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 text-fg/60 rounded-xl font-bold text-sm hover:bg-white/10 transition"><Download size={14}/> PDF</button>}
                  <button onClick={fetchPurchaseOrder} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Generate</button>
                </div>
              </div>
              {!purchaseOrder ? (
                <p className="text-fg/60 text-sm text-center p-6 font-bold">Click Generate to build a purchase order.</p>
              ) : (purchaseOrder.lines||[]).length === 0 ? (
                <p className="text-green-400/70 text-sm text-center p-6 font-bold">✓ Stock levels are healthy - nothing to reorder.</p>
              ) : (
                <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
                  <div className="px-5 py-3 border-b border-white/10 flex justify-between items-center">
                    <h3 className="text-sm font-black text-fg uppercase tracking-wider">Suggested Purchase Order</h3>
                    <span className="text-sm font-black text-brand tabular-nums">Est. ₱{(purchaseOrder.totalEstCost||0).toFixed(2)}</span>
                  </div>
                  <table className="w-full text-left text-xs min-w-[520px]">
                    <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr><th className="px-5 py-3">Item</th><th className="px-5 py-3 text-right">On Hand</th><th className="px-5 py-3 text-right">Daily Use</th><th className="px-5 py-3 text-right">Order Qty</th><th className="px-5 py-3 text-right">Est. Cost</th></tr>
                    </thead>
                    <tbody>
                      {poPage.pageItems.map((l,i) => (
                        <tr key={i} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                          <td className="px-5 py-2.5 font-bold text-fg">{l.itemName} {l.lowStock && <span className="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded uppercase ml-1">Low</span>}</td>
                          <td className="px-5 py-2.5 text-right text-fg/70 tabular-nums">{l.currentStock} {l.displayUnit}</td>
                          <td className="px-5 py-2.5 text-right text-fg/50 tabular-nums">{l.avgDailyUse} {l.displayUnit}</td>
                          <td className="px-5 py-2.5 text-right text-brand font-black tabular-nums">{l.suggestedOrder} {l.displayUnit}</td>
                          <td className="px-5 py-2.5 text-right text-fg/70 tabular-nums">₱{l.estCost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...poPage} label="items" /></div>
                </div>
              )}
            </div>
          )}

          {/* ===== REVOLVING FUNDS SUB-TAB ===== */}
          {ledgerSubTab === 'expenses' && <ExpensesPage />}

          {/* ===== APPROVALS SUB-TAB (Requisition Slips) ===== */}
          {ledgerSubTab === 'approvals' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-xl font-black text-fg flex items-center gap-2"><ShieldCheck size={18} className="text-brand"/> Approvals</h3>
                  <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-1">Requisition slips - petty cash disbursements and new purchase orders wait here until approved</p>
                </div>
                <div className="flex bg-page-bg p-1 rounded-lg shadow-inner">
                  <button onClick={() => { setReqSlipView('pending'); fetchRequisitionSlips('Pending'); }}
                    className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition ${reqSlipView === 'pending' ? 'bg-brand text-white shadow-md' : 'text-fg/40 hover:text-fg'}`}>
                    Pending
                  </button>
                  <button onClick={() => { setReqSlipView('all'); fetchRequisitionSlips(''); }}
                    className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition ${reqSlipView === 'all' ? 'bg-brand text-white shadow-md' : 'text-fg/40 hover:text-fg'}`}>
                    Slips
                  </button>
                </div>
                <button onClick={exportRequisitionSlipsPDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition min-h-[44px]">
                  Export PDF
                </button>
              </div>

              <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
                {reqSlipsLoading && reqSlips.length === 0 ? (
                  <p className="text-fg/40 text-sm p-8 text-center font-bold">Loading…</p>
                ) : reqSlips.length === 0 ? (
                  <p className="text-fg/60 text-sm p-10 text-center font-bold">
                    {reqSlipView === 'pending' ? 'Nothing waiting on approval.' : 'No requisition slips yet.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[720px]">
                      <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
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
                              <button onClick={() => setReqSlipPreview(s)} className="hover:text-brand hover:underline">{s.slipNumber}</button>
                            </td>
                            <td className="px-5 py-2.5 text-fg/60 whitespace-nowrap">{reqTypeLabel(s.type)}</td>
                            <td className="px-5 py-2.5 text-fg/70 truncate max-w-[260px]">{reqSummary(s)}</td>
                            <td className="px-5 py-2.5 text-fg/60 whitespace-nowrap">{s.preparedBy || '-'}</td>
                            <td className="px-5 py-2.5">
                              <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full ${s.status === 'Pending' ? 'bg-amber-500/20 text-amber-400' : s.status === 'Approved' ? 'bg-brand/20 text-brand' : 'bg-red-500/20 text-red-400'}`}>{s.status}</span>
                            </td>
                            <td className="px-5 py-2.5 text-right font-mono tabular-nums font-bold text-fg">{reqAmount(s) === null ? 'To full' : peso(reqAmount(s))}</td>
                            <td className="px-5 py-2.5 text-right whitespace-nowrap">
                              {s.status === 'Pending' && can('requisitions.approve') ? (
                                <div className="flex items-center justify-end gap-3">
                                  <button onClick={() => approveReqSlip(s)} disabled={reqSlipBusy} className="text-[10px] font-black uppercase tracking-wider text-brand hover:underline disabled:opacity-40">Approve</button>
                                  <button onClick={() => { setReqSlipRejecting(s); setReqSlipRejectReason(''); }} disabled={reqSlipBusy} className="text-[10px] font-black uppercase tracking-wider text-red-400/70 hover:text-red-400 hover:underline disabled:opacity-40">Reject</button>
                                </div>
                              ) : s.status === 'Pending' ? (
                                <span className="text-[10px] font-black uppercase tracking-wider text-fg/30">Awaiting approval</span>
                              ) : (
                                <button onClick={() => setReqSlipPreview(s)} className="text-[10px] font-black uppercase tracking-wider text-fg/40 hover:text-fg hover:underline">View</button>
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

          {ledgerSubTab === 'revolving' && (
            <div className="space-y-6 animate-fade-in">

              {/* HEADER + NEW FUND BUTTON */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-fg">Revolving Funds</h3>
                  <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-1">Petty cash pools - track disbursements and replenishments</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={exportRevolvingFundsPDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition min-h-[44px]">
                    Export PDF
                  </button>
                  <button
                    onClick={() => setRfNewModal(true)}
                    className="flex items-center gap-2 bg-brand text-white px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[44px]"
                  >
                    <Plus size={14}/> New Fund
                  </button>
                </div>
              </div>

              {rfLoading && <div className="py-12 text-center text-fg/60 font-bold uppercase text-sm tracking-widest">Loading…</div>}

              {!rfLoading && rfFunds.length === 0 && (
                <div className="py-16 text-center space-y-3">
                  <RefreshCw size={32} className="mx-auto text-fg/20"/>
                  <p className="text-fg/60 font-bold uppercase tracking-widest text-sm">No revolving funds yet</p>
                  <p className="text-fg/60 text-xs">Create a fund to track petty cash and small operational expenses.</p>
                </div>
              )}

              {!rfLoading && rfFunds.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {rfFunds.map(fund => {
                    const pct      = fund.initialAmount > 0 ? (fund.currentBalance / fund.initialAmount) * 100 : 0;
                    const low      = pct <= 25;
                    const isActive = rfActiveFund?._id === fund._id;
                    return (
                      <div key={fund._id}
                        className={`bg-surface border rounded-2xl p-5 space-y-4 transition ${isActive ? 'border-brand shadow-lg shadow-brand/10' : 'border-white/10'}`}
                      >
                        {/* Fund name + close button */}
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-fg font-black text-base leading-tight">{fund.name}</p>
                            {fund.description && <p className="text-fg/40 text-xs mt-0.5 line-clamp-1">{fund.description}</p>}
                          </div>
                          <button
                            onClick={() => closeRfFund(fund._id)}
                            className="text-fg/20 hover:text-danger transition p-1 shrink-0"
                            title="Close fund"
                          ><X size={13}/></button>
                        </div>

                        {/* Balance display */}
                        <div>
                          <p className="text-fg/40 text-[10px] font-bold uppercase tracking-widest mb-0.5">Current Balance</p>
                          <p className={`text-3xl font-black tabular-nums ${low ? 'text-danger' : 'text-brand'}`}>
                            ₱{fund.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </p>
                          <p className="text-fg/60 text-xs">of ₱{fund.initialAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} initial</p>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1">
                          <div className="w-full bg-white/10 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all ${low ? 'bg-danger' : 'bg-brand'}`}
                              style={{ width: `${Math.min(100, pct).toFixed(1)}%` }}
                            />
                          </div>
                          <p className={`text-[10px] font-bold ${low ? 'text-danger' : 'text-fg/60'}`}>
                            {pct.toFixed(0)}% remaining{low ? ' - LOW' : ''}
                          </p>
                        </div>

                        {/* Action buttons */}
                        <div className="grid grid-cols-3 gap-1.5 pt-1">
                          <button
                            onClick={() => { setRfActiveFund(fund); setRfDisbForm({ amount: '', description: '', categoryCode: '760000' }); setRfDisbModal(true); }}
                            className="bg-danger/10 text-danger border border-danger/20 rounded-xl py-2 font-bold text-[10px] uppercase tracking-wider hover:bg-danger/20 transition min-h-[40px]"
                          >
                            <Minus size={11} className="inline mr-1"/>Out
                          </button>
                          <button
                            onClick={() => { setRfActiveFund(fund); setRfReplForm({ amount: (fund.initialAmount - fund.currentBalance).toFixed(2), note: '', sourceAccount: '111000' }); setRfReplModal(true); }}
                            className="bg-brand/10 text-brand border border-brand/20 rounded-xl py-2 font-bold text-[10px] uppercase tracking-wider hover:bg-brand/20 transition min-h-[40px]"
                          >
                            <Plus size={11} className="inline mr-1"/>In
                          </button>
                          <button
                            onClick={() => {
                              if (isActive) {
                                // clicking again collapses the history
                                setRfActiveFund(null);
                                setRfTxs([]);
                              } else {
                                setRfActiveFund(fund);
                                setRfTxs([]);
                                fetchRfTxs(fund._id, 1);
                              }
                            }}
                            className={`rounded-xl py-2 font-bold text-[10px] uppercase tracking-wider transition min-h-[40px] border ${isActive ? 'bg-white/10 text-fg border-white/20' : 'bg-white/5 text-fg/40 border-white/10 hover:bg-white/10 hover:text-fg'}`}
                          >
                            <FileText size={11} className="inline mr-1"/>{isActive ? 'Hide' : 'History'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* TRANSACTION HISTORY - only shown when a fund is explicitly selected */}
              {rfActiveFund && (
                <div className="bg-surface border border-brand/30 rounded-2xl overflow-hidden animate-fade-in">
                  {/* Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-brand/5">
                    <div>
                      <h4 className="text-fg font-black text-lg">Transaction History</h4>
                      <p className="text-brand text-xs font-bold uppercase tracking-widest mt-0.5">{rfActiveFund.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-fg/60 text-xs tabular-nums">{rfTxTotal} {rfTxTotal === 1 ? 'entry' : 'entries'}</span>
                      <button
                        onClick={() => { setRfActiveFund(null); setRfTxs([]); }}
                        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 text-fg/40 hover:text-fg flex items-center justify-center transition"
                        title="Close history"
                      ><X size={14}/></button>
                    </div>
                  </div>

                  {/* Table */}
                  {rfTxs.length === 0 ? (
                    <div className="py-14 text-center">
                      <FileText size={28} className="mx-auto text-fg/15 mb-3"/>
                      <p className="text-fg/60 text-sm font-bold uppercase tracking-widest">No transactions yet</p>
                      <p className="text-fg/20 text-xs mt-1">Disbursements and replenishments will appear here.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-fg/40 text-[10px] font-bold uppercase tracking-widest border-b border-white/10 bg-white/2">
                            <th className="text-left px-6 py-3">Date</th>
                            <th className="text-left px-3 py-3">Type</th>
                            <th className="text-left px-3 py-3">Description</th>
                            <th className="text-left px-3 py-3 hidden sm:table-cell">By</th>
                            <th className="text-right px-3 py-3">Amount</th>
                            <th className="text-right px-6 py-3">Balance After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rfTxs.map((tx, idx) => (
                            <tr key={tx._id} className={`border-b border-white/5 transition hover:bg-white/3 ${idx % 2 === 0 ? '' : 'bg-white/1'}`}>
                              <td className="py-3 px-6 text-fg/50 text-xs tabular-nums whitespace-nowrap">
                                {new Date(tx.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </td>
                              <td className="py-3 px-3">
                                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full whitespace-nowrap ${tx.type === 'disbursement' ? 'bg-danger/20 text-danger' : 'bg-brand/20 text-brand'}`}>
                                  {tx.type === 'disbursement' ? '▼ Out' : '▲ In'}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-fg/80 max-w-[200px] truncate">{tx.description}</td>
                              <td className="py-3 px-3 text-fg/40 text-xs hidden sm:table-cell">{tx.performedBy || '-'}</td>
                              <td className={`py-3 px-3 text-right font-black tabular-nums ${tx.type === 'disbursement' ? 'text-danger' : 'text-brand'}`}>
                                {tx.type === 'disbursement' ? '−' : '+'}₱{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-3 px-6 text-right text-fg/50 tabular-nums text-xs">
                                ₱{(tx.balanceAfter ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Pagination - always visible when there are entries */}
                  {rfTxTotal > 0 && (
                    <div className="flex items-center justify-between px-6 py-3 border-t border-white/10 bg-white/1">
                      <button
                        disabled={rfTxPage <= 1}
                        onClick={() => fetchRfTxs(rfActiveFund._id, rfTxPage - 1)}
                        className="px-4 py-2 rounded-lg bg-white/5 text-fg/50 font-bold text-xs disabled:opacity-25 hover:bg-white/10 hover:text-fg transition"
                      >← Prev</button>
                      <span className="text-fg/60 text-xs font-bold">
                        Page {rfTxPage} of {rfTxPages} &nbsp;·&nbsp; {rfTxTotal} {rfTxTotal === 1 ? 'entry' : 'entries'}
                      </span>
                      <button
                        disabled={rfTxPage >= rfTxPages}
                        onClick={() => fetchRfTxs(rfActiveFund._id, rfTxPage + 1)}
                        className="px-4 py-2 rounded-lg bg-white/5 text-fg/50 font-bold text-xs disabled:opacity-25 hover:bg-white/10 hover:text-fg transition"
                      >Next →</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── PERIOD LOCK ─────────────────────────────────────────────── */}
          {(ledgerSubTab === 'periods' || ledgerSubTab === 'accperiods') && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-6">
              <div>
                <h3 className="text-xl font-black text-fg flex items-center gap-2"><Lock size={18} className="text-brand"/> Closed Accounting Periods</h3>
                <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-1">Lock a month to prevent back-dated journal entries</p>
              </div>

              <div className="bg-page-bg border border-white/10 rounded-xl p-4">
                <h4 className="text-sm font-black text-fg uppercase tracking-wider mb-3">Close a Period</h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Year</label>
                    <input type="number" min="2000" max="2100" value={periodCloseForm.year}
                      onChange={e => setPeriodCloseForm({...periodCloseForm, year: e.target.value})}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg font-bold outline-none focus:border-brand/60"/>
                  </div>
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Month</label>
                    <select value={periodCloseForm.month}
                      onChange={e => setPeriodCloseForm({...periodCloseForm, month: e.target.value})}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg font-bold outline-none focus:border-brand/60">
                      {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                        <option key={m} value={m}>{new Date(2000, m-1, 1).toLocaleString(undefined, { month: 'long' })}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Notes (optional)</label>
                    <input type="text" placeholder="e.g. Q2 books closed by finance" value={periodCloseForm.notes}
                      onChange={e => setPeriodCloseForm({...periodCloseForm, notes: e.target.value})}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg outline-none focus:border-brand/60"/>
                  </div>
                </div>
                <button onClick={closePeriod} className="mt-3 w-full bg-brand text-white font-black py-3 rounded-lg uppercase tracking-widest text-sm hover:bg-brand/90 transition">
                  Lock Period
                </button>
                <p className="text-[10px] text-fg/40 mt-2">Once locked, journal entries dated in this month are rejected. Superadmin can reopen below.</p>
              </div>

              <div>
                <h4 className="text-sm font-black text-fg uppercase tracking-wider mb-3">History</h4>
                {(closedPeriods || []).length === 0 ? (
                  <p className="text-fg/40 text-sm italic">No periods locked yet.</p>
                ) : (
                  <div className="space-y-2">
                    {closedPeriods.map(p => {
                      const label = `${p.year}-${String(p.month).padStart(2,'0')}`;
                      const isLocked = !p.isOpen;
                      return (
                        <div key={p._id} className={`flex items-center justify-between rounded-xl p-3 border ${isLocked ? 'bg-red-500/5 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            {isLocked ? <Lock size={14} className="text-red-400"/> : <Unlock size={14} className="text-fg/40"/>}
                            <div className="min-w-0">
                              <p className="text-fg font-black text-sm">{label} <span className={`text-[10px] ml-1 font-black uppercase tracking-widest ${isLocked ? 'text-red-400' : 'text-fg/40'}`}>{isLocked ? 'Locked' : 'Reopened'}</span></p>
                              <p className="text-[10px] text-fg/40 truncate">{isLocked ? `Closed by ${p.closedBy} · ${new Date(p.closedAt).toLocaleString()}` : `Reopened by ${p.reopenedBy} · ${new Date(p.reopenedAt).toLocaleString()}`}{p.notes ? ` · ${p.notes}` : ''}</p>
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
          {(ledgerSubTab === 'payroute' || ledgerSubTab === 'accperiods') && (() => {
            const methods = Array.from(new Set([
              ...Object.keys(paymentMap?.defaults || {}),
              ...Object.keys(paymentMap?.effective || {}),
            ])).sort();
            // Group eligible target accounts by parent (cash, bank, e-wallet, AR, AP)
            const allEligible = [
              ...(cashAndBankAccounts || []),
              ...(arAccounts || []),
              ...(apAccounts || []),
            ];
            // Superadmin-only edit gate. Server enforces this on PUT/DELETE
            // (returns 403 to non-superadmins) - mirror it in the UI so the
            // controls don't tease the user. Everyone else gets a read-only view.
            const canEdit = !!isSuperAdmin;
            const customSubsAvailable = allEligible.filter(a => a.code && /\d{3,}\d{3}/.test(a.code) && !['111000','112000','113000','120000','220000'].includes(a.code)).length;
            return (
              <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-black text-fg flex items-center gap-2"><CreditCard size={18} className="text-brand"/> Payment Method Routing</h3>
                    <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-1">
                      Map each POS payment method to a specific account
                      {customSubsAvailable > 0 && <span className="ml-2 text-emerald-400 normal-case tracking-normal">· {customSubsAvailable} custom sub-account{customSubsAvailable === 1 ? '' : 's'} available</span>}
                    </p>
                    {!canEdit && (
                      <p className="mt-2 text-[10px] uppercase tracking-widest font-black text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5 inline-flex items-center gap-1.5">
                        <Lock size={11}/> Superadmin only - sign in as superadmin to change routes
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <button onClick={() => setLedgerSubTab('coa')}
                      className="shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 text-fg/70 hover:text-fg text-[10px] uppercase tracking-widest font-black px-3 py-2 rounded-lg transition flex items-center gap-1.5"
                      title="Rename / delete custom sub-accounts in the Chart of Accounts view">
                      <Settings size={11}/> Manage in COA
                    </button>
                  )}
                </div>


                {(() => {
                  // Group payment methods by the canonical PARENT account (first
                  // 3 digits of the default → "<3digits>000"). The parent row is
                  // always visible; children only render when expanded.
                  const PARENT_ORDER = ['111000','112000','113000','120000','220000'];
                  const PARENT_LABEL = {
                    '111000': 'Cash on Hand',
                    '112000': 'Cash in Bank',
                    '113000': 'E-Wallet',
                    '120000': 'Accounts Receivable',
                    '220000': 'Accounts Payable',
                  };
                  // Seed a group for every canonical parent so headers render even
                  // when no payment method currently routes through it.
                  const groups = {};
                  for (const pc of PARENT_ORDER) {
                    groups[pc] = { parentMethods: [], childMethods: [], subAccounts: [] };
                  }
                  // All custom sub-accounts under each parent - drives the [N SUB]
                  // count and the "available sub-accounts" list inside the group.
                  for (const a of (coaAccounts || [])) {
                    if (!a.custom || !a.parent) continue;
                    if (groups[a.parent]) groups[a.parent].subAccounts.push(a);
                  }
                  // Map: account code → payment methods routing to it. So when we
                  // list Metrobank we can show which methods (if any) currently
                  // book to it.
                  const codeToMethods = {};
                  for (const m of methods) {
                    const eff = paymentMap?.effective?.[m] || paymentMap?.defaults?.[m] || '111000';
                    (codeToMethods[eff] ||= []).push(m);
                  }
                  for (const m of methods) {
                    const def = paymentMap?.defaults?.[m] || '111000';
                    const parentCode = String(def).slice(0, 3) + '000';
                    if (!groups[parentCode]) groups[parentCode] = { parentMethods: [], childMethods: [], subAccounts: [] };
                    if (def === parentCode) groups[parentCode].parentMethods.push(m);
                    else groups[parentCode].childMethods.push(m);
                  }
                  for (const k of Object.keys(groups)) {
                    groups[k].parentMethods.sort();
                    groups[k].childMethods.sort();
                    groups[k].subAccounts.sort((a, b) => a.code.localeCompare(b.code));
                  }
                  const renderRow = (m, indent = false) => {
                    const def = paymentMap?.defaults?.[m] || '111000';
                    const eff = paymentMap?.effective?.[m] || def;
                    const isOverride = paymentMap?.overrides?.[m];
                    const effName = (allEligible.find(a => a.code === eff)?.name) || (coaAccounts.find(a => a.code === eff)?.name) || eff;
                    return (
                      <tr key={m} className="border-b border-white/5 hover:bg-page-bg/30">
                        <td className={`py-2 text-fg font-bold text-sm ${indent ? 'pl-10' : 'pl-3'}`}>
                          {indent && <span className="text-fg/20 mr-2">↳</span>}{m}
                        </td>
                        <td className="py-2 text-fg/40 text-xs font-mono">{def}</td>
                        <td className="py-2">
                          {canEdit ? (
                            <select value={eff} onChange={e => savePaymentMapping(m, e.target.value)}
                              className="bg-page-bg border border-white/10 rounded-lg px-2 py-1 text-fg text-xs font-bold outline-none focus:border-brand/60">
                              {allEligible.map(a => (
                                <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-fg text-xs font-bold font-mono">{effName} <span className="text-fg/60">({eff})</span></span>
                          )}
                          {canEdit && <span className="ml-2 text-[10px] text-fg/60">{effName}</span>}
                          {isOverride && <span className="ml-2 text-[9px] uppercase tracking-widest font-black text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">Override</span>}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {canEdit && isOverride && (
                            <button onClick={() => resetPaymentMapping(m)} className="text-[10px] uppercase tracking-widest font-black bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-1 rounded-lg transition">Reset</button>
                          )}
                        </td>
                      </tr>
                    );
                  };
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="text-fg/80 border-b border-white/10 text-[10px] uppercase tracking-widest">
                            <th className="pb-2 pl-3">Payment Method</th>
                            <th className="pb-2">Default</th>
                            <th className="pb-2">Currently Routes To</th>
                            <th className="pb-2 pr-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {PARENT_ORDER.filter(pc => groups[pc]).map(parentCode => {
                            const { parentMethods, childMethods, subAccounts } = groups[parentCode];
                            const isExpanded = expandedPayRouteGroups.has(parentCode);
                            // Count sub-accounts (real children of the parent in the COA),
                            // not just methods. Adding Metrobank under Cash in Bank should
                            // increment this immediately.
                            const childCount = subAccounts.length;
                            return (
                              <React.Fragment key={parentCode}>
                                {/* Group header - clickable to expand/collapse. */}
                                <tr className="bg-white/[0.03] border-b border-white/10 cursor-pointer hover:bg-white/[0.06] transition"
                                    onClick={() => childCount > 0 && togglePayRouteGroup(parentCode)}>
                                  <td colSpan={4} className="py-2.5 pl-3 pr-3">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        {childCount > 0 ? (
                                          isExpanded
                                            ? <ChevronDown size={14} className="text-brand"/>
                                            : <ChevronRight size={14} className="text-fg/40"/>
                                        ) : <span className="w-[14px]" />}
                                        <span className="text-[10px] uppercase tracking-widest font-black text-fg/40">{parentCode}</span>
                                        <span className="text-fg font-black text-sm">{PARENT_LABEL[parentCode] || parentCode}</span>
                                        {childCount > 0 && (
                                          <span className="text-[9px] uppercase tracking-widest font-black bg-brand/15 text-brand border border-brand/30 px-1.5 py-0.5 rounded">
                                            {childCount} sub
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[10px] uppercase tracking-widest font-black text-fg/60">
                                        {parentMethods.length === 1 ? parentMethods[0] : parentMethods.length > 1 ? `${parentMethods.length} methods` : ''}
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                                {/* Parent-account row is intentionally omitted - the header
                                    already displays the same info, and parent-account routing
                                    is locked (parents cannot be remapped from a child UI). */}
                                {/* Expanded: list every sub-account under this parent (custom
                                    children from the COA), with the payment method(s) routing
                                    to it (if any). Lets the user see Metrobank/BPI/etc. even
                                    when no payment method targets them yet. */}
                                {isExpanded && subAccounts.map(sa => {
                                  const methodsHere = codeToMethods[sa.code] || [];
                                  return (
                                    <tr key={`${parentCode}-sa-${sa.code}`} className="border-b border-white/5 hover:bg-page-bg/30">
                                      <td className="py-2 pl-10 text-fg/80 text-sm">
                                        <span className="text-fg/20 mr-2">↳</span>
                                        <span className={`font-bold ${sa.isActive === false ? 'line-through text-fg/30' : ''}`}>{sa.name}</span>
                                        {sa.isActive === false && (
                                          <span className="ml-2 text-[9px] uppercase tracking-widest font-black bg-white/10 text-fg/40 px-1.5 py-0.5 rounded">Inactive</span>
                                        )}
                                      </td>
                                      <td className="py-2 text-fg/40 text-xs font-mono">{sa.code}</td>
                                      <td className="py-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          {/* Existing method chips - click ✕ to detach (resets that method back to its default). */}
                                          {methodsHere.map(m => (
                                            <span key={m} className="text-[10px] uppercase tracking-widest font-black bg-brand/15 text-brand border border-brand/30 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                              {m}
                                              {canEdit && (
                                                <button onClick={() => resetPaymentMapping(m)}
                                                  title={`Detach ${m} from this account (resets to default)`}
                                                  className="text-brand/60 hover:text-brand transition">
                                                  <X size={10}/>
                                                </button>
                                              )}
                                            </span>
                                          ))}
                                          {/* Inline picker: route a POS payment method to THIS sub-account.
                                              Filter to methods whose canonical default lives under the
                                              SAME parent - keeps classification clean (no GCash under
                                              Cash on Hand, no Lalamove under E-Wallet). */}
                                          {canEdit && (() => {
                                            const eligibleMethods = methods.filter(m => {
                                              if (methodsHere.includes(m)) return false; // already routed here
                                              const methodDefault = paymentMap?.defaults?.[m] || '111000';
                                              const methodParent = String(methodDefault).slice(0, 3) + '000';
                                              return methodParent === parentCode;
                                            });
                                            if (eligibleMethods.length === 0) {
                                              return (
                                                <span className="text-[10px] uppercase tracking-widest font-black text-fg/60 italic">
                                                  All matching methods already routed
                                                </span>
                                              );
                                            }
                                            return (
                                              <select
                                                value=""
                                                onChange={e => { if (e.target.value) savePaymentMapping(e.target.value, sa.code); }}
                                                className="bg-page-bg border border-white/10 rounded-lg px-2 py-1 text-fg/60 text-[10px] font-bold outline-none focus:border-brand/60 hover:text-fg"
                                                title={`Route a ${PARENT_LABEL[parentCode] || ''} payment method to this sub-account`}>
                                                <option value="">+ Route a method here…</option>
                                                {eligibleMethods.map(m => (
                                                  <option key={m} value={m}>{m}</option>
                                                ))}
                                              </select>
                                            );
                                          })()}
                                          {!canEdit && methodsHere.length === 0 && (
                                            <span className="text-[10px] uppercase tracking-widest font-black text-fg/60 italic">No method routes here yet</span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-2 pr-3 text-right">
                                        {canEdit ? (
                                          <button onClick={() => toggleAccountActive(sa._id, sa.isActive === false)}
                                            title={sa.isActive === false
                                              ? 'Bring back as a selectable payment method'
                                              : 'Remove from POS/portal picker without deleting - history stays intact'}
                                            className={`text-[9px] uppercase tracking-widest font-black px-2 py-1 rounded transition ${
                                              sa.isActive === false
                                                ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                                                : 'bg-white/5 text-fg/50 hover:bg-white/10 hover:text-fg'
                                            }`}>
                                            {sa.isActive === false ? 'Reactivate' : 'Deactivate'}
                                          </button>
                                        ) : (
                                          <span className="text-[10px] uppercase tracking-widest font-black text-fg/60">Sub-account</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
                <p className="text-[10px] text-fg/60">
                  Changes take effect immediately for new orders and settlements. Past journal entries are not modified.
                  Need a sub-account for a specific bank (e.g. Metrobank 112001)? Add it in <span className="text-brand font-bold">Chart of Accounts</span> under the parent (Cash in Bank), then it appears here automatically.
                </p>
              </div>
            );
          })()}

          {/* ── AUDIT LOG ──────────────────────────────────────────────────── */}
          {ledgerSubTab === 'audit' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black text-fg flex items-center gap-2"><ShieldCheck size={18} className="text-brand"/> Audit Log</h3>
                  <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-1">Forensic trail of edits, voids, deletes</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <select value={auditLogFilter.entity}
                    onChange={e => setAuditLogFilter({...auditLogFilter, entity: e.target.value})}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs font-bold outline-none focus:border-brand/60">
                    <option value="">All Entities</option>
                    <option value="PRODUCT">Product</option>
                    <option value="ORDER">Order</option>
                    <option value="INVENTORY">Inventory</option>
                    <option value="ACCOUNT">Account</option>
                    <option value="PERIOD">Period</option>
                    <option value="JOURNALENTRY">Journal Entry</option>
                  </select>
                  <input type="text" placeholder="Actor name" value={auditLogFilter.actor}
                    onChange={e => setAuditLogFilter({...auditLogFilter, actor: e.target.value})}
                    className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-brand/60"/>
                  <button onClick={() => fetchAuditLog(1)} className="bg-brand text-white font-black px-4 py-2 rounded-lg uppercase tracking-widest text-xs hover:bg-brand/90 transition">
                    Query
                  </button>
                  {auditLogEntries && auditLogEntries.length > 0 && (
                    <button onClick={exportAuditLogPDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-4 py-2 rounded-lg font-black uppercase tracking-widest text-xs transition"><Download size={12}/> PDF</button>
                  )}
                </div>
              </div>

              {(auditLogEntries || []).length === 0 ? (
                <p className="text-fg/40 text-sm italic text-center py-8">No audit entries match. Click Query to load.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-fg/40 border-b border-white/10 text-[10px] uppercase tracking-widest">
                        <th className="pb-2">When</th>
                        <th className="pb-2">Actor</th>
                        <th className="pb-2">Action</th>
                        <th className="pb-2">Reference</th>
                        <th className="pb-2">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogEntries.map((e, idx) => (
                        <tr key={e._id || idx} className="border-b border-white/5 hover:bg-page-bg/30">
                          <td className="py-2 text-fg/60 text-xs whitespace-nowrap">{new Date(e.timestamp).toLocaleString()}</td>
                          <td className="py-2 text-fg font-bold text-xs">{e.userId}</td>
                          <td className="py-2 text-brand font-bold text-xs">{e.action}</td>
                          <td className="py-2 text-fg/60 text-xs font-mono">{e.targetReference}</td>
                          <td className="py-2 text-fg/40 text-[10px] max-w-md truncate" title={JSON.stringify(e.details)}>
                            {e.details ? JSON.stringify(e.details).slice(0, 80) + (JSON.stringify(e.details).length > 80 ? '…' : '') : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {auditLogPages > 1 && (
                <div className="flex justify-between items-center border-t border-white/10 pt-3">
                  <button onClick={() => fetchAuditLog(Math.max(1, auditLogPage - 1))} disabled={auditLogPage === 1}
                    className="px-4 py-1.5 rounded-lg bg-white/5 text-fg/60 text-xs font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-white/10 transition">← Prev</button>
                  <span className="text-fg/40 text-xs font-bold tracking-widest">PAGE {auditLogPage} / {auditLogPages}</span>
                  <button onClick={() => fetchAuditLog(Math.min(auditLogPages, auditLogPage + 1))} disabled={auditLogPage === auditLogPages}
                    className="px-4 py-1.5 rounded-lg bg-white/5 text-fg/60 text-xs font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-white/10 transition">Next →</button>
                </div>
              )}
            </div>
          )}

          {/* ── TENANCY HEALTH + MY PERMISSIONS ───────────────────────────── */}
          {/* ── BACKDATE SALES (superadmin only) ──────────────────────────── */}
          {ledgerSubTab === 'backdate' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-xl font-black text-fg flex items-center gap-2"><Clock size={18} className="text-brand"/> Backdate Sale</h3>
                  <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-1">Ring up a historical sale like the register, then post it to a past date. Books a real, balanced journal entry.</p>
                </div>
                {isSuperAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={downloadBackdateTemplate} title="Download a blank template with the expected headers" className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg font-bold text-sm px-4 py-2.5 rounded-xl transition">
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
              {!isSuperAdmin ? (
                <p className="mt-2 text-[10px] uppercase tracking-widest font-black text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5 inline-flex items-center gap-1.5">
                  <Lock size={11}/> Superadmin only
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* LEFT: product picker + cart */}
                  <div className="bg-page-bg border border-white/10 rounded-xl p-4 flex flex-col min-h-[420px]">
                    <div className="relative mb-3">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/30" />
                      <input type="text" placeholder="Search products to add…" value={bdSearch}
                        onChange={e => setBdSearch(e.target.value)}
                        className="w-full bg-surface border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-fg text-sm outline-none focus:border-brand/60" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 overflow-y-auto max-h-56 mb-3 custom-scrollbar content-start">
                      {(products || []).filter(p => !bdSearch || p.name.toLowerCase().includes(bdSearch.toLowerCase())).slice(0, 60).map(p => (
                        <button key={p._id} onClick={() => bdAddProduct(p)}
                          className="text-left bg-surface border border-white/10 rounded-lg p-2.5 hover:border-brand/60 hover:bg-brand/5 transition active-press min-h-[56px]">
                          <p className="text-[11px] font-bold text-fg leading-tight line-clamp-2">{p.name}</p>
                          <p className="text-brand font-black text-sm mt-1 tabular-nums">{peso(Number(p.basePrice || p.price || 0))}</p>
                        </button>
                      ))}
                      {(products || []).length === 0 && <p className="col-span-full text-fg/30 text-xs text-center py-8">No products yet - add them in Menu Setup.</p>}
                    </div>
                    <div className="border-t border-white/10 pt-3 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                      <p className="text-[10px] text-fg/40 font-bold uppercase tracking-widest mb-2">Cart ({bdCart.length})</p>
                      {bdCart.length === 0 ? (
                        <p className="text-fg/30 text-xs py-6 text-center">Tap products above to build the sale.</p>
                      ) : bdCart.map(x => (
                        <div key={x.productId} className="flex items-center gap-2 py-2 border-b border-white/5">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-fg truncate">{x.name}</p>
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-[10px] text-fg/40">₱</span>
                              <input type="number" min="0" step="0.01" value={x.price} onChange={e => bdSetPrice(x.productId, e.target.value)}
                                className="w-16 bg-surface border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-fg tabular-nums outline-none focus:border-brand/60" />
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => bdSetQty(x.productId, x.quantity - 1)} className="w-7 h-7 rounded-lg bg-white/5 text-fg/60 hover:bg-white/10 font-black">−</button>
                            <input type="number" min="1" value={x.quantity} onChange={e => bdSetQty(x.productId, parseInt(e.target.value) || 1)}
                              className="w-11 bg-surface border border-white/10 rounded px-1 py-1 text-center text-xs text-fg tabular-nums outline-none focus:border-brand/60" />
                            <button onClick={() => bdSetQty(x.productId, x.quantity + 1)} className="w-7 h-7 rounded-lg bg-white/5 text-fg/60 hover:bg-white/10 font-black">+</button>
                          </div>
                          <span className="w-20 text-right text-xs font-black text-fg tabular-nums shrink-0">{peso(x.price * x.quantity)}</span>
                          <button onClick={() => bdRemove(x.productId)} className="text-red-400/60 hover:text-red-400 shrink-0"><Trash2 size={14}/></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* RIGHT: sale details */}
                  <div className="bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Sale Date *</label>
                        <input type="date" value={bd.date} max={new Date().toISOString().slice(0,10)}
                          onChange={e => setBd({ ...bd, date: e.target.value })}
                          className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg font-bold outline-none focus:border-brand/60" />
                      </div>
                      <div>
                        <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Payment Method</label>
                        <select value={bd.paymentMethod} onChange={e => setBd({ ...bd, paymentMethod: e.target.value })}
                          disabled={bd.isComplimentary}
                          className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg font-bold outline-none focus:border-brand/60 disabled:opacity-40">
                          <optgroup label="In-Store Payments">
                            <option value="Cash">Cash</option>
                            <option value="Bank Transfer">Bank Transfer</option>
                          </optgroup>
                          <optgroup label="E-Wallets">
                            <option value="GCash">GCash</option>
                            <option value="Maya">Maya</option>
                            <option value="Maribank">Maribank / Seabank</option>
                            <option value="Other E-Wallet">Other E-Wallet</option>
                            <option value="QR">QR / Scan to Pay</option>
                          </optgroup>
                          <optgroup label="Delivery Partners">
                            <option value="Grab Delivery">Grab Delivery</option>
                            {BUSINESS_TYPE === 'log' ? <option value="Lalamove">Lalamove</option> : <option value="Foodpanda">Foodpanda</option>}
                            <option value="Manual Delivery">Manual/Direct</option>
                          </optgroup>
                          <optgroup label="Credit"><option value="On Account">On Account (A/R)</option></optgroup>
                        </select>
                      </div>
                    </div>

                    {/* Toggles: reduce inventory (default off) + complimentary */}
                    <div className="space-y-2">
                      <button onClick={() => setBd({ ...bd, affectInventory: !bd.affectInventory })}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition ${bd.affectInventory ? 'bg-amber-500/10 border-amber-500/40' : 'bg-surface border-white/10'}`}>
                        <span className="text-left">
                          <span className="text-xs font-bold text-fg block">Reduce current inventory</span>
                          <span className="text-[10px] text-fg/40">{bd.affectInventory ? 'Stock WILL be deducted + COGS booked' : 'Off - old sale won’t touch today’s stock (default)'}</span>
                        </span>
                        <span className={`w-10 h-5 rounded-full shrink-0 relative transition ${bd.affectInventory ? 'bg-amber-500' : 'bg-white/15'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bd.affectInventory ? 'left-[22px]' : 'left-0.5'}`}/>
                        </span>
                      </button>
                      <button onClick={() => setBd({ ...bd, isComplimentary: !bd.isComplimentary })}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition ${bd.isComplimentary ? 'bg-brand/10 border-brand/40' : 'bg-surface border-white/10'}`}>
                        <span className="text-left">
                          <span className="text-xs font-bold text-fg block">Complimentary (free)</span>
                          <span className="text-[10px] text-fg/40">{bd.isComplimentary ? 'Books Comp Expense / Revenue, collects ₱0' : 'Off - a normal paid sale'}</span>
                        </span>
                        <span className={`w-10 h-5 rounded-full shrink-0 relative transition ${bd.isComplimentary ? 'bg-brand' : 'bg-white/15'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bd.isComplimentary ? 'left-[22px]' : 'left-0.5'}`}/>
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Customer (optional)</label>
                        <input type="text" placeholder="Walk-in" value={bd.customerName}
                          onChange={e => setBd({ ...bd, customerName: e.target.value })}
                          className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg outline-none focus:border-brand/60" />
                      </div>
                      <div>
                        <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Discount %</label>
                        <input type="number" min="0" max="100" step="0.5" value={bd.discountPercent} disabled={bd.isComplimentary}
                          onChange={e => setBd({ ...bd, discountPercent: e.target.value })}
                          className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg font-bold tabular-nums outline-none focus:border-brand/60 disabled:opacity-40" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Notes</label>
                      <input type="text" placeholder="e.g. Paper receipt #4521, 2024 carry-over" value={bd.notes}
                        onChange={e => setBd({ ...bd, notes: e.target.value })}
                        className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg outline-none focus:border-brand/60" />
                    </div>

                    {/* Totals */}
                    <div className="bg-surface border border-white/10 rounded-lg p-3 space-y-1 text-sm">
                      <div className="flex justify-between text-fg/60"><span>Gross</span><span className="tabular-nums">{peso(bdGross)}</span></div>
                      {bdDiscount > 0 && <div className="flex justify-between text-fg/60"><span>Discount ({bdPct}%)</span><span className="tabular-nums">−{peso(bdDiscount)}</span></div>}
                      <div className="flex justify-between text-base font-black text-fg border-t border-white/10 pt-1 mt-1"><span>{bd.isComplimentary ? 'Complimentary' : 'Total'}</span><span className="tabular-nums text-brand">{peso(bdTotal)}</span></div>
                    </div>

                    <button onClick={submitBackdateCart} disabled={bdBusy || bdCart.length === 0}
                      className="w-full bg-brand text-white font-black py-3 rounded-lg uppercase tracking-widest text-sm hover:bg-brand/90 transition disabled:opacity-50">
                      {bdBusy ? 'Posting…' : 'Record Backdated Sale'}
                    </button>
                    <p className="text-[10px] text-fg/40">Period locks are enforced - a closed month is rejected. Always audited.</p>

                    <div className="border-t border-white/10 pt-3">
                      <button onClick={runBackfillLedger} disabled={backfillBusy}
                        className="w-full bg-surface border border-white/10 text-fg/70 font-bold py-2 rounded-lg uppercase tracking-widest text-[11px] hover:border-brand/60 transition disabled:opacity-50">
                        {backfillBusy ? 'Scanning…' : 'Repair Missing Ledger Entries'}
                      </button>
                      <p className="text-[10px] text-fg/40 mt-1.5">One-time fix for older backdated sales missing a journal entry. Safe to run repeatedly.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── BACKDATE SALE QUEUE ── rows a bulk import couldn't post blind (no Terms of Payment on the sheet) */}
              {isSuperAdmin && bdQueue?.total > 0 && (
                <div className="bg-surface border border-amber-500/30 rounded-xl overflow-hidden mt-2">
                  <div className="px-5 py-3 border-b border-amber-500/20 bg-amber-500/5 flex items-center gap-2 flex-wrap">
                    <AlertTriangle size={14} className="text-amber-400" />
                    <h3 className="text-sm font-black text-fg uppercase tracking-wider">Backdate Queue</h3>
                    <span className="text-[10px] text-amber-400 font-bold">{bdQueue.total} needs a payment method</span>
                    <button onClick={() => fetchBdQueue(bdQueuePage)} disabled={bdQueueLoading}
                      className="ml-auto flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition disabled:opacity-50">
                      <RefreshCw size={11} className={bdQueueLoading ? 'animate-spin' : ''}/> Refresh
                    </button>
                  </div>
                  <p className="text-fg/40 text-[11px] px-5 pt-3">
                    These sheets left "Terms of Payment" blank, so we didn't guess how they were paid. Supply it and Save to post them as backdated sales.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[560px]">
                      <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
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
                              <td className="px-5 py-2.5 text-fg/70 whitespace-nowrap font-bold">{row.date || <span className="text-red-400">no date</span>}</td>
                              <td className="px-5 py-2.5 text-fg/40 truncate max-w-[140px]">{row.sheet || '-'}</td>
                              <td className="px-5 py-2.5 text-fg/80 font-bold truncate max-w-[160px]">{row.client || 'Walk-in'}</td>
                              <td className="px-5 py-2.5 text-fg/60 truncate max-w-[220px]">{(row.items || []).map(it => it.name).join(', ')}</td>
                              <td className="px-5 py-2.5 text-right text-fg font-mono tabular-nums font-bold">{peso(total)}</td>
                              <td className="px-5 py-2.5 text-right whitespace-nowrap">
                                <button onClick={() => setBdQueueResolve({ row, paymentMethod: 'Cash', affectInventory: false })}
                                  className="text-[10px] font-black uppercase tracking-wider text-brand hover:underline mr-3">Complete</button>
                                <button onClick={() => discardBdQueueItem(row)}
                                  className="text-[10px] font-black uppercase tracking-wider text-red-400/70 hover:text-red-400 hover:underline">Discard</button>
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
                        className="text-[10px] font-black uppercase tracking-widest text-fg/50 hover:text-fg disabled:opacity-30 transition">← Prev</button>
                      <span className="text-[10px] text-fg/40 font-bold">Page {bdQueue.page} of {bdQueue.pages}</span>
                      <button onClick={() => fetchBdQueue(bdQueuePage + 1)} disabled={bdQueuePage >= bdQueue.pages || bdQueueLoading}
                        className="text-[10px] font-black uppercase tracking-widest text-fg/50 hover:text-fg disabled:opacity-30 transition">Next →</button>
                    </div>
                  )}
                </div>
              )}

              {/* ── BACKDATE SALE HISTORY ── every entry made through this tool, manual or bulk-imported */}
              {isSuperAdmin && (
                <div className="bg-surface border border-white/10 rounded-xl overflow-hidden mt-2">
                  <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2 flex-wrap">
                    <History size={14} className="text-fg/50" />
                    <h3 className="text-sm font-black text-fg uppercase tracking-wider">Backdate History</h3>
                    {bdHistory?.total > 0 && <span className="text-[10px] text-fg/40 font-bold">{bdHistory.total} total</span>}
                    <button onClick={exportBackdateHistoryPDF} disabled={bdExporting || !bdHistory?.total}
                      className="ml-auto flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition disabled:opacity-50">
                      <Download size={11}/> {bdExporting ? 'Exporting…' : 'Export PDF'}
                    </button>
                    <button onClick={() => fetchBdHistory(bdHistoryPage)} disabled={bdHistoryLoading}
                      className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition disabled:opacity-50">
                      <RefreshCw size={11} className={bdHistoryLoading ? 'animate-spin' : ''}/> Refresh
                    </button>
                  </div>
                  {bdHistoryLoading && !bdHistory ? (
                    <p className="text-fg/40 text-sm p-6 text-center font-bold">Loading…</p>
                  ) : !bdHistory || bdHistory.orders.length === 0 ? (
                    <p className="text-fg/60 text-sm p-8 text-center font-bold">No backdated sales recorded yet.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs min-w-[560px]">
                          <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
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
                                <td className="px-5 py-2.5 font-mono text-fg/60 whitespace-nowrap">{o.orderNumber}</td>
                                <td className="px-5 py-2.5 text-fg/80 font-bold truncate max-w-[160px]">{o.customerName || 'Walk-in'}</td>
                                <td className="px-5 py-2.5 text-fg/60 whitespace-nowrap">{o.paymentMethod}</td>
                                <td className="px-5 py-2.5 text-fg/40 truncate max-w-[220px]">{o.orderNotes || '-'}</td>
                                <td className="px-5 py-2.5 text-right text-fg font-mono tabular-nums font-bold">{peso(o.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {bdHistory.pages > 1 && (
                        <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
                          <button onClick={() => fetchBdHistory(bdHistoryPage - 1)} disabled={bdHistoryPage <= 1 || bdHistoryLoading}
                            className="text-[10px] font-black uppercase tracking-widest text-fg/50 hover:text-fg disabled:opacity-30 transition">← Prev</button>
                          <span className="text-[10px] text-fg/40 font-bold">Page {bdHistory.page} of {bdHistory.pages}</span>
                          <button onClick={() => fetchBdHistory(bdHistoryPage + 1)} disabled={bdHistoryPage >= bdHistory.pages || bdHistoryLoading}
                            className="text-[10px] font-black uppercase tracking-widest text-fg/50 hover:text-fg disabled:opacity-30 transition">Next →</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── BACKDATE QUEUE — COMPLETE ── supply the missing payment method, then post */}
          {bdQueueResolve && !bdSheetPicker && !bdImportPreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !bdQueueSaving && setBdQueueResolve(null)}>
              <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div>
                    <h2 className="font-black text-fg text-base">Complete Queued Sale</h2>
                    <p className="text-fg/40 text-xs mt-0.5">{bdQueueResolve.row.client || 'Walk-in'} · {bdQueueResolve.row.date || 'no date'}</p>
                  </div>
                  <button onClick={() => !bdQueueSaving && setBdQueueResolve(null)} className="text-fg/40 hover:text-fg transition"><X size={18} /></button>
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
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Payment Method *</label>
                    <select value={bdQueueResolve.paymentMethod} onChange={e => setBdQueueResolve(s => ({ ...s, paymentMethod: e.target.value }))}
                      className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg font-bold outline-none focus:border-brand/60">
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="GCash">GCash</option>
                      <option value="Maya">Maya</option>
                      <option value="On Account">On Account (A/R)</option>
                    </select>
                  </div>
                  <button onClick={() => setBdQueueResolve(s => ({ ...s, affectInventory: !s.affectInventory }))}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition ${bdQueueResolve.affectInventory ? 'bg-amber-500/10 border-amber-500/40' : 'bg-page-bg border-white/10'}`}>
                    <span className="text-left">
                      <span className="text-xs font-bold text-fg block">Reduce current inventory</span>
                      <span className="text-[10px] text-fg/40">{bdQueueResolve.affectInventory ? 'Stock WILL be deducted' : 'Off - won’t touch today’s stock (default)'}</span>
                    </span>
                    <span className={`w-10 h-5 rounded-full shrink-0 relative transition ${bdQueueResolve.affectInventory ? 'bg-amber-500' : 'bg-white/15'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bdQueueResolve.affectInventory ? 'left-[22px]' : 'left-0.5'}`}/>
                    </span>
                  </button>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
                  <button onClick={() => !bdQueueSaving && setBdQueueResolve(null)} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/50 hover:text-fg transition">Cancel</button>
                  <button onClick={saveBdQueueItem} disabled={bdQueueSaving} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-sm px-5 py-2 rounded-xl transition">
                    {bdQueueSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── BACKDATE IMPORT — OPTIONS (sheet selection + the same settings the manual entry form asks for) ── */}
          {bdSheetPicker && !bdImportPreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !bdImporting && setBdSheetPicker(null)}>
              <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div>
                    <h2 className="font-black text-fg text-base">Import Options</h2>
                    <p className="text-fg/40 text-xs mt-0.5">
                      {bdSheetPicker.sheetNames.length > 1
                        ? `This file has ${bdSheetPicker.sheetNames.length} tabs. Pick which to import.`
                        : 'Set how this sale should post before previewing it.'}
                    </p>
                  </div>
                  <button onClick={() => !bdImporting && setBdSheetPicker(null)} className="text-fg/40 hover:text-fg transition"><X size={18} /></button>
                </div>

                {bdSheetPicker.sheetNames.length > 1 && (
                  <>
                    <div className="px-5 py-3 flex items-center gap-2 border-b border-white/10">
                      <button onClick={() => setBdSheetPicker(s => ({ ...s, selected: new Set(s.sheetNames) }))}
                        className="text-[10px] font-black uppercase tracking-widest text-brand hover:underline">Select All</button>
                      <span className="text-fg/20">·</span>
                      <button onClick={() => setBdSheetPicker(s => ({ ...s, selected: new Set() }))}
                        className="text-[10px] font-black uppercase tracking-widest text-fg/40 hover:underline">Select None</button>
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
                            <span className="text-sm font-bold text-fg truncate">{name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}

                <div className="px-5 py-4 space-y-3">
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Payment Method (applies to all)</label>
                    <select value={bdImportSettings.paymentMethod} onChange={e => setBdImportSettings(s => ({ ...s, paymentMethod: e.target.value }))}
                      className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg font-bold outline-none focus:border-brand/60">
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="GCash">GCash</option>
                      <option value="Maya">Maya</option>
                      <option value="On Account">On Account (A/R)</option>
                    </select>
                  </div>
                  <button onClick={() => setBdImportSettings(s => ({ ...s, affectInventory: !s.affectInventory }))}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition ${bdImportSettings.affectInventory ? 'bg-amber-500/10 border-amber-500/40' : 'bg-page-bg border-white/10'}`}>
                    <span className="text-left">
                      <span className="text-xs font-bold text-fg block">Reduce current inventory</span>
                      <span className="text-[10px] text-fg/40">{bdImportSettings.affectInventory ? 'Stock WILL be deducted for every item matched' : 'Off - these sales won’t touch today’s stock (default)'}</span>
                    </span>
                    <span className={`w-10 h-5 rounded-full shrink-0 relative transition ${bdImportSettings.affectInventory ? 'bg-amber-500' : 'bg-white/15'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${bdImportSettings.affectInventory ? 'left-[22px]' : 'left-0.5'}`}/>
                    </span>
                  </button>
                </div>

                {bdParseProgress && (
                  <div className="px-5 pt-4">
                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-fg/50 mb-1.5">
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
                  <button onClick={() => !bdImporting && setBdSheetPicker(null)} disabled={bdImporting} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/50 hover:text-fg transition disabled:opacity-30">Cancel</button>
                  <button onClick={confirmBdSheetPicker} disabled={bdImporting || bdSheetPicker.selected.size === 0} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-sm px-5 py-2 rounded-xl transition">
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
                    <p className="text-fg/40 text-xs mt-0.5">
                      {bdImportPreview.groups.length} sale(s) · {bdImportPreview.groups.reduce((s, g) => s + g.items.length, 0)} line item(s)
                      {bdImportPreview.skipped > 0 && ` · ${bdImportPreview.skipped} row(s) skipped`}
                    </p>
                  </div>
                  <button onClick={() => !bdImporting && setBdImportPreview(null)} className="text-fg/40 hover:text-fg transition"><X size={20} /></button>
                </div>
                <div className="px-5 py-4 border-b border-white/10 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Payment Method (default - override any sale below)</label>
                    <select value={bdImportSettings.paymentMethod} onChange={e => setBdImportSettings(s => ({ ...s, paymentMethod: e.target.value }))}
                      className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg font-bold outline-none focus:border-brand/60">
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="GCash">GCash</option>
                      <option value="Maya">Maya</option>
                      <option value="On Account">On Account (A/R)</option>
                    </select>
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
                </div>
                <div className="p-5 space-y-3 max-h-[50vh] overflow-y-auto">
                  {bdImportPreview.groups.map((g, gi) => (
                    <div key={gi} className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                        <span className="font-black text-fg text-sm">{g.client || 'Walk-in'}</span>
                        <div className="flex items-center gap-2 text-[11px] text-fg/40 font-bold">
                          {bdImportPreview.multiSheet && g.sheet && <span className="text-[9px] bg-white/10 text-fg/50 px-1.5 py-0.5 rounded uppercase tracking-wider">{g.sheet}</span>}
                          {g.transNo && <span>{g.transNo}</span>}
                          <span>{g.date || <span className="text-red-400">no date</span>}</span>
                          <span className="text-brand">{peso(g.total)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <select value={g.paymentMethod || bdImportSettings.paymentMethod}
                          onChange={e => { const v = e.target.value; setBdImportPreview(p => ({ ...p, groups: p.groups.map((x, i) => i === gi ? { ...x, paymentMethod: v } : x) })); }}
                          className={`text-[10px] font-bold uppercase tracking-wider rounded-lg px-2 py-1 outline-none border ${g.paymentMethod ? 'bg-brand/10 border-brand/40 text-brand' : 'bg-page-bg border-white/10 text-fg/60'}`}>
                          <option value="Cash">Cash</option>
                          <option value="Bank Transfer">Bank Transfer</option>
                          <option value="GCash">GCash</option>
                          <option value="Maya">Maya</option>
                          <option value="On Account">On Account (A/R)</option>
                        </select>
                        {g.paymentMethod && (
                          <button onClick={() => setBdImportPreview(p => ({ ...p, groups: p.groups.map((x, i) => i === gi ? { ...x, paymentMethod: null } : x) }))}
                            className="text-[9px] font-bold uppercase tracking-wider text-fg/30 hover:text-fg/60 transition">reset to default</button>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {g.items.map((it, li) => (
                          <div key={li} className="flex items-center justify-between text-xs text-fg/60">
                            <span className="truncate pr-2">
                              {it.code ? `${it.code} · ` : ''}{it.name}
                              {!it.matched && <span className="ml-1.5 text-[9px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/40 px-1 py-0.5 rounded uppercase align-middle">No product match</span>}
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
                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-fg/50 mb-1.5">
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
                  <button onClick={() => !bdImporting && setBdImportPreview(null)} disabled={bdImporting} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/50 hover:text-fg transition disabled:opacity-30">Cancel</button>
                  <button onClick={confirmBdImport} disabled={bdImporting} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-sm px-5 py-2 rounded-xl transition">
                    {bdImporting ? `Importing ${bdImportProgress ? `${bdImportProgress.done}/${bdImportProgress.total}` : '…'}` : `Import ${bdImportPreview.groups.length} Sale(s)`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── REQUISITION SLIP - REJECT REASON ── */}
          {reqSlipRejecting && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !reqSlipBusy && setReqSlipRejecting(null)}>
              <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <h2 className="font-black text-fg text-base">Reject {reqSlipRejecting.slipNumber}</h2>
                  <button onClick={() => !reqSlipBusy && setReqSlipRejecting(null)} className="text-fg/40 hover:text-fg transition"><X size={18} /></button>
                </div>
                <div className="p-5 space-y-3">
                  <label className="text-[10px] text-fg/40 font-bold uppercase block mb-1">Reason *</label>
                  <textarea autoFocus rows={3} value={reqSlipRejectReason} onChange={e => setReqSlipRejectReason(e.target.value)}
                    placeholder="Why is this being rejected?"
                    className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-red-500/60 resize-none" />
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
                  <button onClick={() => setReqSlipRejecting(null)} disabled={reqSlipBusy} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/50 hover:text-fg transition disabled:opacity-40">Cancel</button>
                  <button onClick={submitRejectReqSlip} disabled={reqSlipBusy || !reqSlipRejectReason.trim()} className="flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold text-sm px-5 py-2 rounded-xl transition">
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
                    <p className="text-fg/40 text-xs mt-0.5">{reqSlipPreview.type === 'petty-cash' ? 'Petty Cash / Revolving Fund Requisition' : reqSlipPreview.type === 'new-fund' ? 'New Revolving Fund Requisition' : reqSlipPreview.type === 'fund-replenish' ? 'Revolving Fund Replenishment' : 'Procurement Requisition'}</p>
                  </div>
                  <button onClick={() => setReqSlipPreview(null)} className="text-fg/40 hover:text-fg transition"><X size={20} /></button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${reqSlipPreview.status === 'Pending' ? 'bg-amber-500/20 text-amber-400' : reqSlipPreview.status === 'Approved' ? 'bg-brand/20 text-brand' : 'bg-red-500/20 text-red-400'}`}>{reqSlipPreview.status}</span>
                    <span className="text-fg/40 text-[10px] font-bold">{new Date(reqSlipPreview.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>

                  {reqSlipPreview.type === 'petty-cash' ? (
                    <div className="bg-page-bg border border-white/10 rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-fg/50">Fund</span><span className="text-fg font-bold">{reqSlipPreview.fundName}</span></div>
                      <div className="flex justify-between"><span className="text-fg/50">Description</span><span className="text-fg font-bold text-right max-w-[60%]">{reqSlipPreview.description}</span></div>
                      <div className="flex justify-between border-t border-white/10 pt-2 mt-1"><span className="text-fg/50">Amount</span><span className="text-brand font-black text-lg tabular-nums">{peso(reqSlipPreview.amount)}</span></div>
                      {/* Live balance preview - what approving this actually
                          does to the fund, so the reviewer isn't approving
                          blind. Money going OUT of a fund, so subtracted. */}
                      {reqSlipFundBalance !== null && (
                        <div className="flex justify-between border-t border-white/10 pt-2 mt-1 text-xs">
                          <span className="text-fg/40">Current Balance → After</span>
                          <span className="font-mono tabular-nums">
                            <span className="text-fg/60">{peso(reqSlipFundBalance)}</span>
                            <span className="text-fg/30 mx-1">→</span>
                            <span className={reqSlipFundBalance - reqSlipPreview.amount < 0 ? 'text-red-400 font-bold' : 'text-fg font-bold'}>
                              {peso(reqSlipFundBalance - reqSlipPreview.amount)}
                            </span>
                          </span>
                        </div>
                      )}
                      {reqSlipFundBalance !== null && reqSlipFundBalance < reqSlipPreview.amount && (
                        <p className="text-red-400 text-[11px] font-bold">⚠ Exceeds the fund's current balance - approving this will fail.</p>
                      )}
                    </div>
                  ) : reqSlipPreview.type === 'new-fund' ? (
                    <div className="bg-page-bg border border-white/10 rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-fg/50">New Fund Name</span><span className="text-fg font-bold">{reqSlipPreview.fundName}</span></div>
                      {reqSlipPreview.description && <div className="flex justify-between"><span className="text-fg/50">Note</span><span className="text-fg font-bold text-right max-w-[60%]">{reqSlipPreview.description}</span></div>}
                      <div className="flex justify-between border-t border-white/10 pt-2 mt-1"><span className="text-fg/50">Opening Amount</span><span className="text-brand font-black text-lg tabular-nums">{peso(reqSlipPreview.amount)}</span></div>
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
                        <div className="flex justify-between"><span className="text-fg/50">Fund</span><span className="text-fg font-bold">{reqSlipPreview.fundName}</span></div>
                        {reqSlipPreview.description && <div className="flex justify-between"><span className="text-fg/50">Note</span><span className="text-fg font-bold text-right max-w-[60%]">{reqSlipPreview.description}</span></div>}
                        <div className="flex justify-between border-t border-white/10 pt-2 mt-1">
                          <span className="text-fg/50">Amount</span>
                          <span className="text-brand font-black text-lg tabular-nums">{reqSlipPreview.amount > 0 ? peso(reqSlipPreview.amount) : 'Top up to full'}</span>
                        </div>
                        {/* Live balance preview - money coming IN this time, so added. */}
                        {reqSlipFundBalance !== null && (
                          <div className="flex justify-between border-t border-white/10 pt-2 mt-1 text-xs">
                            <span className="text-fg/40">Current Balance → After</span>
                            <span className="font-mono tabular-nums">
                              <span className="text-fg/60">{peso(reqSlipFundBalance)}</span>
                              <span className="text-fg/30 mx-1">→</span>
                              <span className="text-fg font-bold">{willBe !== null ? peso(willBe) : '—'}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })() : (
                    <div className="bg-page-bg border border-white/10 rounded-lg p-4 space-y-3 text-sm">
                      <div className="flex justify-between"><span className="text-fg/50">Supplier</span><span className="text-fg font-bold">{reqSlipPreview.supplier || 'Unassigned'}</span></div>
                      <div className="space-y-1">
                        {(reqSlipPreview.lines || []).map((l, i) => (
                          <div key={i} className="flex items-center justify-between text-xs text-fg/70">
                            <span className="truncate pr-2">{l.itemCode ? `${l.itemCode} · ` : ''}{l.itemName}</span>
                            <span className="whitespace-nowrap font-mono">{l.orderedQty} × {peso(l.unitCost)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between border-t border-white/10 pt-2"><span className="text-fg/50">Est. Total</span><span className="text-brand font-black text-lg tabular-nums">{peso(reqSlipPreview.estTotal)}</span></div>
                      {reqSlipPreview.notes && <p className="text-fg/40 text-xs italic">{reqSlipPreview.notes}</p>}
                    </div>
                  )}

                  {reqSlipPreview.status === 'Rejected' && reqSlipPreview.rejectionReason && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <p className="text-[10px] text-red-400 font-black uppercase tracking-widest mb-1">Rejection Reason</p>
                      <p className="text-fg/70 text-xs">{reqSlipPreview.rejectionReason}</p>
                    </div>
                  )}

                  {reqSlipPreview.status === 'Approved' && reqSlipPreview.resultRefLabel && (
                    <p className="text-fg/40 text-xs">Posted as <span className="text-fg font-bold font-mono">{reqSlipPreview.resultRefLabel}</span></p>
                  )}

                  {/* Signature block - Prepared By, then Approved By beneath it once set */}
                  <div className="border-t border-white/10 pt-4 space-y-4">
                    <div>
                      <p className="text-[10px] text-fg/40 font-bold uppercase tracking-widest mb-1">Prepared By</p>
                      <p className="text-fg font-black text-sm border-b border-white/20 pb-1.5">{reqSlipPreview.preparedBy || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-fg/40 font-bold uppercase tracking-widest mb-1">Approved By</p>
                      {reqSlipPreview.approvedBy ? (
                        <p className="text-fg font-black text-sm border-b border-white/20 pb-1.5">
                          {reqSlipPreview.approvedBy}
                          <span className="text-fg/40 font-bold text-[10px] ml-2">{new Date(reqSlipPreview.approvedAt).toLocaleDateString()}</span>
                        </p>
                      ) : reqSlipPreview.status === 'Rejected' ? (
                        <p className="text-red-400/70 font-bold text-sm border-b border-white/20 pb-1.5">Rejected by {reqSlipPreview.rejectedBy}</p>
                      ) : (
                        <p className="text-fg/25 font-bold text-sm border-b border-white/10 pb-1.5 italic">Pending approval</p>
                      )}
                    </div>
                  </div>
                </div>
                {reqSlipPreview.status === 'Pending' && (
                  <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
                    <button onClick={() => { setReqSlipRejecting(reqSlipPreview); setReqSlipRejectReason(''); setReqSlipPreview(null); }} disabled={reqSlipBusy}
                      className="text-sm font-bold px-4 py-2 rounded-xl text-red-400/70 hover:text-red-400 transition disabled:opacity-40">Reject</button>
                    <button onClick={() => { approveReqSlip(reqSlipPreview); setReqSlipPreview(null); }} disabled={reqSlipBusy}
                      className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-sm px-5 py-2 rounded-xl transition">Approve</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {ledgerSubTab === 'tenancy' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-6">
              <div>
                <h3 className="text-xl font-black text-fg flex items-center gap-2"><ShieldCheck size={18} className="text-brand"/> Tenancy Health</h3>
                <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-1">Verify every doc is stamped with this server's business type</p>
              </div>

              {!tenancyReport ? (
                <p className="text-fg/40 text-sm italic">Loading report…</p>
              ) : (
                <>
                  <div className="bg-page-bg border border-white/10 rounded-xl p-4">
                    <p className="text-[10px] uppercase tracking-widest text-fg/40 font-bold mb-1">Current Business Type</p>
                    <p className="text-2xl font-black text-brand">{tenancyReport.currentBusinessType}</p>
                    <p className={`mt-2 text-[10px] uppercase tracking-widest font-black ${tenancyReport.isClean ? 'text-green-400' : 'text-amber-400'}`}>
                      {tenancyReport.isClean ? '✓ Clean - all docs stamped' : '⚠ Some docs need attention'}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-fg/40 border-b border-white/10 text-[10px] uppercase tracking-widest">
                          <th className="pb-2">Collection</th>
                          <th className="pb-2 text-right">Missing businessType</th>
                          <th className="pb-2 text-right">Other businessType</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tenancyReport.rows.map(r => (
                          <tr key={r.collection} className="border-b border-white/5">
                            <td className="py-2 text-fg font-bold">{r.collection}</td>
                            <td className={`py-2 text-right font-mono tabular-nums ${r.missingBusinessType > 0 ? 'text-amber-400 font-black' : 'text-fg/40'}`}>{r.missingBusinessType.toLocaleString()}</td>
                            <td className={`py-2 text-right font-mono tabular-nums ${r.otherBusinessType > 0 ? 'text-red-400 font-black' : 'text-fg/40'}`}>{r.otherBusinessType.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={fetchTenancyReport} className="bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg font-bold px-4 py-2 rounded-lg uppercase tracking-widest text-xs transition">
                      Refresh
                    </button>
                    <button onClick={runTenancyRebackfill} disabled={tenancyBusy}
                      className="bg-brand text-white font-black px-4 py-2 rounded-lg uppercase tracking-widest text-xs hover:bg-brand/90 transition disabled:opacity-50">
                      {tenancyBusy ? 'Running…' : 'Run Re-Backfill'}
                    </button>
                  </div>
                  <p className="text-[10px] text-fg/40">"Other businessType" docs belong to another tenant on the same database. Re-backfill only stamps docs missing the field - it never overwrites an existing different value.</p>
                </>
              )}
            </div>
          )}

          </div>
        </div>
  );
}
