'use strict';
const fs   = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'client', 'src', 'pages', 'AdminDashboard.jsx');
let src = fs.readFileSync(SRC, 'utf8');
const lines = src.split('\n');

// Tab ranges (1-based from script output, convert to 0-based)
const tabs = [
  { name: 'AnalyticsTab',  start: 3100 - 1, end: 3293 - 1 },
  { name: 'OrdersTab',     start: 3297 - 1, end: 4313 - 1 },
  { name: 'HistoryTab',    start: 4316 - 1, end: 4521 - 1 },
  { name: 'InventoryTab',  start: 4525 - 1, end: 5193 - 1 },
  { name: 'LedgerTab',     start: 5196 - 1, end: 5731 - 1 },
  { name: 'PricingTab',    start: 6009 - 1, end: 6162 - 1 },
  { name: 'AuditTab',      start: 6165 - 1, end: 6448 - 1 },
  { name: 'ProductsTab',   start: 6451 - 1, end: 6801 - 1 },
];

// Process in REVERSE order so line numbers stay valid as we replace
const sorted = [...tabs].sort((a, b) => b.start - a.start);

sorted.forEach(tab => {
  const placeholder = `      {activeTab === '${tabKey(tab.name)}' && <${tab.name} ctx={ctx} />}`;
  lines.splice(tab.start, tab.end - tab.start + 1, placeholder);
  console.log(`Replaced ${tab.name} (${tab.end - tab.start + 1} lines → 1 line)`);
});

function tabKey(name) {
  return name.replace('Tab', '').toLowerCase();
}

// Add imports at the top, after the last existing import
const importBlock = `import AnalyticsTab  from '../components/tabs/AnalyticsTab';
import OrdersTab     from '../components/tabs/OrdersTab';
import HistoryTab    from '../components/tabs/HistoryTab';
import InventoryTab  from '../components/tabs/InventoryTab';
import LedgerTab     from '../components/tabs/LedgerTab';
import PricingTab    from '../components/tabs/PricingTab';
import AuditTab      from '../components/tabs/AuditTab';
import ProductsTab   from '../components/tabs/ProductsTab';`;

// Find the last import line
let lastImport = 0;
lines.forEach((l, i) => { if (l.startsWith('import ') || l.startsWith("import'")) lastImport = i; });
lines.splice(lastImport + 1, 0, importBlock);

// Now insert the ctx object just before the main return statement.
// Find "  return (" in the main body (not inside a function)
let returnIdx = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].trim() === 'return (' && (i === 0 || lines[i - 1].trim() === '')) {
    returnIdx = i;
    break;
  }
}
if (returnIdx === -1) {
  // fallback: find the last `  return (`
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s{2}return \(/.test(lines[i])) { returnIdx = i; break; }
  }
}

const ctxBlock = `
  // ── CTX: bundle ALL state + handlers so tab components stay decoupled ──────
  const ctx = {
    // shared data
    orders, archivedOrders, products, categories, inventory, discounts, globalAddOns,
    users, activeAdmin, isSuperAdmin,
    // helpers / actions
    fetchOrders, fetchData, fetchERPData,
    apiFetch, updateStatus, printOrderSlip, handleVoidOrder,
    // analytics
    analyticsData, analyticsLoading, fetchAnalytics, exportAnalyticsToPDF,
    // navigation
    activeTab, setActiveTab, navMode,
    // ledger
    ledgerSubTab, setLedgerSubTab, jeForm, setJeForm, cashOnHand, standardAccounts,
    pnlData, pnlRange, setPnlRange, fetchPnl, bsData, fetchBalanceSheet,
    arOutstanding, fetchArOutstanding,
    expenseModal, setExpenseModal, expenseCategories, fetchExpenseCategories,
    settleModal, setSettleModal, settleForm, setSettleForm, settleSubmitting, setSettleSubmitting,
    // revolving funds
    rfFunds, rfLoading, rfActiveFund, setRfActiveFund, rfTxs, rfTxTotal, rfTxPage, rfTxPages,
    rfNewModal, setRfNewModal, rfNewForm, setRfNewForm, rfNewSubmitting,
    rfDisbModal, setRfDisbModal, rfDisbForm, setRfDisbForm, rfDisbSubmitting,
    rfReplModal, setRfReplModal, rfReplForm, setRfReplForm, rfReplSubmitting,
    fetchRfFunds, fetchRfTxs, submitRfNew, submitRfDisb, submitRfRepl, closeRfFund,
    // orders tab
    filteredOrders, displayOrders, orderFilter, setOrderFilter, departmentFilter, setDepartmentFilter,
    collapsedOrders, setCollapsedOrders, updatingOrders, cashTendered, setCashTendered,
    isPosOpen, setIsPosOpen, posCart, setPosCart, posCategory, setPosCategory, posPage, setPosPage,
    posSearch, setPosSearch, posCustomerName, setPosCustomerName, posTable, setPosTable,
    posPayment, setPosPayment, posSelectedProduct, setPosSelectedProduct,
    posActiveSize, setPosActiveSize, posActiveAddOns, setPosActiveAddOns,
    posDiscountType, setPosDiscountType, posDiscountValue, setPosDiscountValue,
    posDiscountAmt, posGrandTotal, posSubtotal,
    posCheckoutModal, setPosCheckoutModal, posCashTendered, setPosCashTendered,
    posDeliveryAddress, setPosDeliveryAddress, posCustomerPhone, setPosCustomerPhone,
    posDeliveryFee, setPosDeliveryFee, posDeliveryFeeNum, posScheduledTime, setPosScheduledTime,
    compSelections, setCompSelections, compOverride, setCompOverride,
    compReasonTypes, setCompReasonTypes, compReasonNotes, setCompReasonNotes,
    paymentSelections, setPaymentSelections,
    submitManualOrder, openProductModal, confirmPosItem,
    ordersPage, setOrdersPage, ordersItemsPerPage,
    // inventory tab
    invSubTab, setInvSubTab, invForm, setInvForm, invPage, setInvPage, invItemsPerPage,
    activeInventoryItem, setActiveInventoryItem, restockData, setRestockData,
    stockHistory, setStockHistory, historyModalOpen, setHistoryModalOpen, historyItemName, setHistoryItemName,
    physicalCounts, setPhysicalCounts, varianceReasons, setVarianceReasons,
    varianceNoteMode, setVarianceNoteMode,
    eodStatus, eodLockedAt, dailyMovement,
    invBadgeCount, expandedBatchRows, setExpandedBatchRows,
    editInvModal, setEditInvModal, editInvForm, setEditInvForm, editInvSubmitting,
    importModal, setImportModal, importRows, setImportRows, importSubmitting,
    spoilageModal, setSpoilageModal, spoilageForm, setSpoilageForm, spoilageLoading,
    fetchEODData, fetchInventory, handleRestockSubmit, handleSaveInventoryEdit,
    handleImportConfirm, handleSpoilageSubmit,
    // history tab
    historySubTab, setHistorySubTab, groupedArchives, expandedDays, toggleDay,
    expandedOrderLists, toggleOrderList, historyPage, setHistoryPage, HIST_PAGE_SIZE,
    shiftHistory, shiftHistoryPage, setShiftHistoryPage, shiftHistoryTotal, SHIFT_HIST_PAGE_SIZE,
    fetchShiftHistory, shiftFilter, setShiftFilter, generateXReading,
    // pricing tab
    editPriceId, setEditPriceId, editPriceVal, setEditPriceVal,
    pricingPage, setPricingPage, pricingItemsPerPage, handleSavePriceInline,
    // audit tab
    auditFilter, setAuditFilter, auditCancelPage, setAuditCancelPage,
    auditCompPage, setAuditCompPage, auditDiscPage, setAuditDiscPage,
    auditStaffPage, setAuditStaffPage, AUDIT_PAGE_SIZE,
    // products tab
    editingProduct, setEditingProduct, formData, setFormData,
    catForm, setCatForm, editingCategory, setEditingCategory,
    discountList, newDiscount, setNewDiscount, addOnForm, setAddOnForm,
    currentPage, setCurrentPage, itemsPerPage,
    handleSaveProduct, handleDeleteProduct, handleSaveCategory, handleDeleteCategory,
    handleAddAddon, handleDeleteAddon, handleSaveDiscount, handleDeleteDiscount,
    // constants (pass so tab files don't need their own env imports)
    BIZ_NAME, COMP_REASON_LABELS, API_URL, FRONTEND_URL,
    peso,
  };
`;

if (returnIdx !== -1) {
  lines.splice(returnIdx, 0, ctxBlock);
  console.log(`\nInserted ctx object before return statement (line ${returnIdx + 1})`);
} else {
  console.warn('Could not find return statement for ctx injection!');
}

fs.writeFileSync(SRC, lines.join('\n'), 'utf8');
console.log(`\nDone. AdminDashboard.jsx is now ${lines.length} lines (was 7109).`);
