import React, { useState, useEffect, useRef } from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag, Receipt } from 'lucide-react';
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
    activeAdmin, activeInventoryItem, activeTab, addInventory, addMaterialToRecipe,
    addOnForm, addSize, analyticsData, analyticsLoading, apiFetch,
    applyComplimentary, applyDiscount, applyItemDiscount, arOutstanding, arAgeing, fetchArAgeing, archiveDay, fetchExpenses,
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
    fetchBalanceSheet, fetchData, fetchEODData, fetchERPData, fetchExpenseCategories,
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
    billPayModal, setBillPayModal, billPayFrom, setBillPayFrom, submitBillPay, expenseAccounts,
    profitByCategory, fetchProfitByCategory,
    salesByPayment, sbpRange, setSbpRange, fetchSalesByPayment,
    salesSummary, sssRange, setSssRange, sssGroup, setSssGroup, sssRows, fetchSalesSummary, exportSalesSummaryPDF,
    salesLineItems, sliRange, setSliRange, fetchSalesLineItems, exportSalesLineItemsPDF,
    menuEngineering, fetchMenuEngineering, cashierVariance, fetchCashierVariance, purchaseOrder, fetchPurchaseOrder,
    commissions, fetchCommissions,
    exportPnlPDF, exportBalanceSheetPDF, exportPurchaseOrderPDF, reconcileInventory,
    coaAccounts, fetchCoa, coaParent, setCoaParent, coaNewName, setCoaNewName,
    coaEditId, setCoaEditId, coaEditName, setCoaEditName, coaBusy,
    addCoaChild, renameCoaChild, deleteCoaChild, seedPaymentSubaccounts,
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
      } else ui.alert(d.error || 'Failed to record backdated sale.');
    } catch { ui.alert('Network error.'); }
    finally { setBdBusy(false); }
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
  // Auto-load the active view's data on entry (nav landing or sub-tab click).
  useEffect(() => {
    if (ledgerSubTab === 'trial') loadTrial();
    if (ledgerSubTab === 'salessummary' && !salesSummary) fetchSalesSummary();
    if (ledgerSubTab === 'salesline' && !salesLineItems) fetchSalesLineItems();
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

  return (
        <div className="space-y-4">

          {/* SUB-TAB NAV. The group shown depends on the top-level tab: Reports vs
              Ledger (both render from this component). Merged pages (AR & AP, and
              Accounts & Periods) stack several sections on one page. */}
          <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1 bg-surface border border-white/10 rounded-2xl p-2">
            {(activeTab === 'reports'
              ? [
                  ['salessummary',  'Sales Summary',          BarChart3],
                  ['salesline',     'Sales Line Items',       FileText],
                  ['payments',      'By Payment',             Banknote],
                  ['profitcat',     'By Category',            BarChart2],
                  ['pnlmonthly',    'Monthly P&L',            BarChart3],
                  ['bsmonthly',     'Monthly Balance Sheet',  BarChart3],
                  ['percentagetax', 'Percentage Tax',         FileText],
                  ['menueng',       'Menu Engineering',       TrendingUp],
                  ['variance',      'Cashier Variance',       Users],
                  ['commissions',   'Commissions',            Users],
                ]
              : [
                  ['journal',    'General Ledger',      FileText],
                  ['trial',      'Trial Balance',       BarChart2],
                  ['pnl',        'P&L',                 TrendingUp],
                  ['balance',    'Balance Sheet',       BarChart2],
                  ['araap',      'AR & AP',             Truck],
                  ['bills',      'Bills (AP)',          Receipt],
                  ['accperiods', 'Accounts & Periods',  Settings],
                  ['backdate',   'Backdate Sale',       Clock],
                  ['revolving',  'Revolving Funds',     RefreshCw],
                  ['expenses',   'Expenses',            Receipt],
                ]
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => {
                  setLedgerSubTab(id);
                  // Merged "Accounts & Periods" page: load all its sections.
                  if (id === 'accperiods') { fetchCoa(); fetchClosedPeriods(); fetchPaymentMap(); }
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
                  if (id === 'profitcat') fetchProfitByCategory();
                  if (id === 'menueng') fetchMenuEngineering();
                  if (id === 'variance') fetchCashierVariance();
                  if (id === 'commissions') fetchCommissions();
                  if (id === 'revolving') { fetchRfFunds(); setRfActiveFund(null); setRfTxs([]); }
                  if (id === 'expenses') { fetchExpenseCategories(); fetchExpenses(); }
                }}
                className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition min-h-[44px] ${ledgerSubTab === id ? 'bg-brand text-white shadow-elev-1' : 'bg-transparent text-fg/50 hover:text-fg hover:bg-white/5'}`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {/* Section area. On the merged pages (Accounts & Periods, AR & AP) the
              stacked sections flow into two columns so they fill the width instead
              of leaving a big empty right side; every other page stays single-column. */}
          <div className={(ledgerSubTab === 'accperiods' || ledgerSubTab === 'araap')
            ? 'lg:columns-2 lg:gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid [&>*]:max-w-none'
            : 'space-y-4'}>

          {/* ── TRIAL BALANCE ─────────────────────────────────────────────────── */}
          {ledgerSubTab === 'trial' && (
            <div className="bg-surface border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h3 className="text-lg font-black text-fg">Trial Balance</h3>
                  <p className="text-fg/60 text-xs">All accounts with their net debit / credit balance.</p>
                </div>
                <button onClick={loadTrial} disabled={tbLoading} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition">
                  <RefreshCw size={12} className={tbLoading ? 'animate-spin' : ''} /> Refresh
                </button>
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
            <div className="max-w-3xl space-y-5">
              {/* Add child account */}
              <div className="bg-surface border border-white/10 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <h3 className="text-lg font-black text-fg">Add Sub-Account</h3>
                  {isSuperAdmin && (
                    <button onClick={seedPaymentSubaccounts}
                      title="Auto-create standard payment-method sub-accounts (GCash, Maya, Foodpanda, Lalamove, etc.). Idempotent - existing accounts are skipped."
                      className="text-[10px] uppercase tracking-widest font-black bg-accent hover:bg-brand/60 text-white border border-brand/30 px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 shrink-0">
                      <Zap size={11}/> Seed payment methods
                    </button>
                  )}
                </div>
                <p className="text-xs text-fg/60 mb-4">Create a custom child account under any parent. It inherits the parent's classification and becomes usable in journal entries and reports.</p>
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
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Revenue */}
                  <div className="space-y-3">
                    <h4 className="text-brand font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2">Revenue</h4>
                    {pnlData.revenue.length === 0 ? <p className="text-fg/60 text-sm">No revenue entries.</p> :
                      <table className="w-full text-sm">
                        <tbody>
                          {pnlData.revenue.map(r => (
                            <tr key={r.code} className="border-b border-white/5">
                              <td className="py-2 text-fg/80 text-xs"><span className="text-fg/60 mr-2">{r.code}</span>{r.name}</td>
                              <td className="py-2 text-right text-fg tabular-nums font-bold">{r.amount >= 0 ? '' : '(' }₱{Math.abs(r.amount).toFixed(2)}{r.amount < 0 ? ')' : ''}</td>
                            </tr>
                          ))}
                          <tr><td className="pt-3 font-black text-fg uppercase text-xs">Net Revenue</td><td className="pt-3 text-right text-brand tabular-nums font-black text-lg">₱{pnlData.totals.netRevenue.toFixed(2)}</td></tr>
                        </tbody>
                      </table>
                    }
                    <h4 className="text-orange-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mt-6">Cost of Goods Sold</h4>
                    {pnlData.cogs.length === 0 ? <p className="text-fg/60 text-sm">No COGS entries.</p> :
                      <table className="w-full text-sm">
                        <tbody>
                          {pnlData.cogs.map(r => (
                            <tr key={r.code} className="border-b border-white/5">
                              <td className="py-2 text-fg/80 text-xs"><span className="text-fg/60 mr-2">{r.code}</span>{r.name}</td>
                              <td className="py-2 text-right text-fg tabular-nums font-bold">₱{r.amount.toFixed(2)}</td>
                            </tr>
                          ))}
                          <tr><td className="pt-3 font-black text-fg uppercase text-xs">Total COGS</td><td className="pt-3 text-right text-orange-400 tabular-nums font-black">₱{pnlData.totals.cogs.toFixed(2)}</td></tr>
                          <tr className="border-t border-white/10"><td className="pt-3 font-black text-fg uppercase text-sm">Gross Profit</td><td className="pt-3 text-right text-green-400 tabular-nums font-black text-lg">₱{pnlData.totals.grossProfit.toFixed(2)}</td></tr>
                          <tr><td className="font-bold text-fg/50 uppercase text-xs">Gross Margin</td><td className="text-right text-fg/70 tabular-nums font-black text-sm">{pnlData.totals.grossMargin.toFixed(2)}%</td></tr>
                        </tbody>
                      </table>
                    }
                  </div>

                  {/* Operating Expenses */}
                  <div className="space-y-3">
                    <h4 className="text-red-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2">Operating Expenses</h4>
                    {pnlData.opex.length === 0 ? <p className="text-fg/60 text-sm">No expense entries in this period.</p> :
                      <table className="w-full text-sm">
                        <tbody>
                          {pnlData.opex.map(r => (
                            <tr key={r.code} className="border-b border-white/5">
                              <td className="py-2 text-fg/80 text-xs"><span className="text-fg/60 mr-2">{r.code}</span>{r.name}</td>
                              <td className="py-2 text-right text-fg tabular-nums font-bold">₱{r.amount.toFixed(2)}</td>
                            </tr>
                          ))}
                          <tr><td className="pt-3 font-black text-fg uppercase text-xs">Total OpEx</td><td className="pt-3 text-right text-red-400 tabular-nums font-black">₱{pnlData.totals.opex.toFixed(2)}</td></tr>
                        </tbody>
                      </table>
                    }

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
              )}
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
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Assets */}
                  <div>
                    <h4 className="text-brand font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Assets</h4>
                    <table className="w-full text-sm">
                      <tbody>
                        {bsData.assets.map(r => (
                          <tr key={r.code} className="border-b border-white/5">
                            <td className="py-2 text-fg/80 text-xs"><span className="text-fg/60 mr-2">{r.code}</span>{r.name}</td>
                            <td className="py-2 text-right text-fg tabular-nums font-bold">₱{r.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr><td className="pt-3 font-black text-fg uppercase text-xs">Total Assets</td><td className="pt-3 text-right text-brand tabular-nums font-black text-lg">₱{bsData.totals.assets.toFixed(2)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  {/* Liabilities */}
                  <div>
                    <h4 className="text-red-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Liabilities</h4>
                    <table className="w-full text-sm">
                      <tbody>
                        {bsData.liabilities.length === 0 ? <tr><td className="py-2 text-fg/60 text-xs italic">No liabilities recorded</td></tr> :
                          bsData.liabilities.map(r => (
                          <tr key={r.code} className="border-b border-white/5">
                            <td className="py-2 text-fg/80 text-xs"><span className="text-fg/60 mr-2">{r.code}</span>{r.name}</td>
                            <td className="py-2 text-right text-fg tabular-nums font-bold">₱{r.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr><td className="pt-3 font-black text-fg uppercase text-xs">Total Liabilities</td><td className="pt-3 text-right text-red-400 tabular-nums font-black">₱{bsData.totals.liabilities.toFixed(2)}</td></tr>
                      </tbody>
                    </table>
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
              )}

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

          {/* ===== A/R OUTSTANDING SUB-TAB ===== */}
          {(ledgerSubTab === 'ar' || ledgerSubTab === 'araap') && (
            <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex justify-between items-end border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-fg">Accounts Receivable</h3>
                  <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-1">Non-Cash sales awaiting settlement (E-Wallet · Bank · Delivery)</p>
                </div>
                <div className="text-right">
                  <p className="text-fg/60 text-[10px] font-bold uppercase">Total Outstanding</p>
                  <p className="text-3xl text-brand font-black tabular-nums">₱{arOutstanding.totalOutstanding.toFixed(2)}</p>
                </div>
              </div>

              {/* AR Aging Summary */}
              {arOutstanding.orders.length > 0 && (() => {
                const ab = agingBuckets(arOutstanding.orders, o => o.createdAt, o => o.total);
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
                        <th className="text-right py-3">Amount</th>
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
                            <td className="py-3 text-right text-fg tabular-nums font-bold">₱{o.total.toFixed(2)}</td>
                            <td className="py-3 text-right">
                              <button onClick={() => {
                                let defaultMethod = 'Cash on Hand';
                                if (o.paymentMethod === 'Bank Transfer') defaultMethod = 'Bank Transfer';
                                else if (['GCash','Maya','Maribank','E-Wallet','Other E-Wallet'].includes(o.paymentMethod)) defaultMethod = o.paymentMethod === 'Other E-Wallet' ? 'GCash' : o.paymentMethod;
                                else if (['Grab Delivery','Foodpanda','Manual Delivery'].includes(o.paymentMethod)) defaultMethod = 'Bank Transfer';
                                setSettleModal({ order: o });
                                setSettleForm({ amount: o.total.toFixed(2), paymentMethod: defaultMethod, note: '' });
                              }}
                                className="bg-brand text-white px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
                                Settle
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <Pager {...arPage} label="orders" />
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
              {apData?.outstandingBalance > 0 && (
                <div className="flex justify-end">
                  <button onClick={() => setApPayModal(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition shadow-elev-1">
                    <CreditCard size={15}/> Record Supplier Payment
                  </button>
                </div>
              )}

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
              <div className="flex justify-end">
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
                  <p className="text-[10px] text-fg/60 p-3 text-center">COGS is estimated from recipe ingredient costs. Items without recipes show ₱0 COGS.</p>
                </div>
              )}
            </div>
          )}

          {/* ===== MENU ENGINEERING ===== */}
          {ledgerSubTab === 'menueng' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-between items-center">
                <p className="text-xs text-fg/60">Stars (sell + profit), Plowhorses (sell, low margin), Puzzles (high margin, low sell), Dogs (neither).</p>
                <button onClick={fetchMenuEngineering} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
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
                <button onClick={fetchCashierVariance} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
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
                <button onClick={fetchCommissions} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
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
                        const stCls = { Pending:'bg-yellow-500/20 text-yellow-400', Approved:'bg-blue-500/20 text-blue-400', Paid:'bg-green-500/20 text-green-400', Rejected:'bg-red-500/20 text-red-400' }[b.status] || 'bg-white/10 text-fg/50';
                        return (
                          <tr key={b._id} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                            <td className="px-4 py-3 font-mono text-fg/70">{b.billNumber}</td>
                            <td className="px-4 py-3 font-bold text-fg">{b.supplierName || '-'}</td>
                            <td className="px-4 py-3"><span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-fg/50 font-bold">{b.source}</span></td>
                            <td className="px-4 py-3 text-fg/60 max-w-[200px] truncate" title={b.description || b.poNumber}>{b.description || b.poNumber || '-'}</td>
                            <td className="px-4 py-3 text-right font-black tabular-nums font-mono text-fg">{peso(b.amount)}</td>
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
                              {b.status === 'Approved' && (
                                <div className="flex gap-1.5 justify-end">
                                  <button disabled={billBusy} onClick={() => scheduleBill(b)} className="px-2.5 py-1 rounded-lg bg-white/5 text-fg/60 hover:bg-white/10 text-[11px] font-bold transition disabled:opacity-50">Schedule</button>
                                  <button disabled={billBusy} onClick={() => { setBillPayModal(b); setBillPayFrom('111000'); }} className="px-2.5 py-1 rounded-lg bg-brand/20 text-brand hover:bg-brand/30 text-[11px] font-bold transition disabled:opacity-50">Pay</button>
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
              {billPayModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setBillPayModal(null)}>
                  <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                    <h2 className="font-black text-fg mb-1">Pay bill {billPayModal.billNumber}</h2>
                    <p className="text-fg/50 text-sm mb-4">{billPayModal.supplierName} · {peso(billPayModal.amount)}</p>
                    <p className="text-[11px] text-fg/40 mb-3">Posts DR Accounts Payable / CR the account you pay from.</p>
                    <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">Pay from</label>
                    <select value={billPayFrom} onChange={e => setBillPayFrom(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg mb-5">
                      {(cashAndBankAccounts||[]).map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                    </select>
                    <div className="flex gap-3">
                      <button onClick={() => setBillPayModal(null)} className="flex-1 bg-white/5 hover:bg-white/10 text-fg/50 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">Cancel</button>
                      <button onClick={submitBillPay} disabled={billBusy} className="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50">{billBusy ? 'Recording…' : 'Record payment'}</button>
                    </div>
                  </div>
                </div>
              )}
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

          {ledgerSubTab === 'revolving' && (
            <div className="space-y-6 animate-fade-in">

              {/* HEADER + NEW FUND BUTTON */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-fg">Revolving Funds</h3>
                  <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-1">Petty cash pools - track disbursements and replenishments</p>
                </div>
                <button
                  onClick={() => setRfNewModal(true)}
                  className="flex items-center gap-2 bg-brand text-white px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[44px] shrink-0"
                >
                  <Plus size={14}/> New Fund
                </button>
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
                                        <span className="font-bold">{sa.name}</span>
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
                                      <td className="py-2 pr-3 text-right text-[10px] uppercase tracking-widest font-black text-fg/60">
                                        Sub-account
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
              <div>
                <h3 className="text-xl font-black text-fg flex items-center gap-2"><Clock size={18} className="text-brand"/> Backdate Sale</h3>
                <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-1">Ring up a historical sale like the register, then post it to a past date. Books a real, balanced journal entry.</p>
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
