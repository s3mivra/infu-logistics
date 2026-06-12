'use strict';
const fs   = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, '..', 'client', 'src', 'pages', 'AdminDashboard.jsx');
const TABS = path.join(__dirname, '..', 'client', 'src', 'components', 'tabs');

fs.mkdirSync(TABS, { recursive: true });

const lines = fs.readFileSync(SRC, 'utf8').split('\n');
const total = lines.length;

// ──────────────────────────────────────────────────────────────────────────────
// Find the LINE NUMBER (0-based) of each tab's opening conditional
// and find the matching closing brace depth.
// ──────────────────────────────────────────────────────────────────────────────
function findTabRange(startMarker) {
  const startIdx = lines.findIndex(l => l.trimStart().startsWith(startMarker));
  if (startIdx === -1) throw new Error('Marker not found: ' + startMarker);

  // Walk forward until the depth returns to 0
  let depth = 0, foundOpen = false;
  for (let i = startIdx; i < total; i++) {
    const l = lines[i];
    for (const ch of l) {
      if (ch === '{') { depth++; foundOpen = true; }
      if (ch === '}') { depth--; }
    }
    if (foundOpen && depth === 0) return { start: startIdx, end: i };
  }
  throw new Error('No closing brace found for: ' + startMarker);
}

const tabDefs = [
  { key: 'analytics',  marker: "{activeTab === 'analytics' && (() => {",  name: 'AnalyticsTab'  },
  { key: 'orders',     marker: "{activeTab === 'orders' && (() => {",      name: 'OrdersTab'     },
  { key: 'history',    marker: "{activeTab === 'history' && (() => {",     name: 'HistoryTab'    },
  { key: 'inventory',  marker: "{activeTab === 'inventory' && (",          name: 'InventoryTab'  },
  { key: 'ledger',     marker: "{activeTab === 'ledger' && (",             name: 'LedgerTab'     },
  { key: 'pricing',    marker: "{activeTab === 'pricing' && (",            name: 'PricingTab'    },
  { key: 'audit',      marker: "{activeTab === 'audit' && (() => {",       name: 'AuditTab'      },
  { key: 'products',   marker: "{activeTab === 'products' && (",           name: 'ProductsTab'   },
];

const imports = `import React from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
`;

const ranges = [];

tabDefs.forEach(def => {
  try {
    const r = findTabRange(def.marker);
    ranges.push({ ...def, ...r });
    console.log(`${def.name}: lines ${r.start + 1}–${r.end + 1}`);
  } catch (e) {
    console.warn('SKIP', def.name, e.message);
  }
});

// Sort by start line to process in order
ranges.sort((a, b) => a.start - b.start);

// ──────────────────────────────────────────────────────────────────────────────
// Write each tab component file
// ──────────────────────────────────────────────────────────────────────────────
ranges.forEach(r => {
  const body = lines.slice(r.start, r.end + 1).join('\n');

  // Wrap it: the tab is currently an expression like `{activeTab === 'x' && (...)}`.
  // We need to turn the inner content into a component that receives ctx.
  // Strategy: strip the outer conditional wrapper, keep the JSX tree as the return value.

  // Remove the outer conditional opening `{activeTab === '...' && (` or `{activeTab === '...' && (() => {`
  // and the matching closing `)}` or `})()}`.
  let inner = body;

  // Strip outermost `{activeTab === '...' && (() => {` ... `})()}`
  if (inner.trimStart().match(/\{activeTab === '[^']+' && \(\(\) => \{/)) {
    // Remove first line and last 3 lines
    const innerLines = inner.split('\n');
    // Drop first line, drop last 1-2 lines (})();} patterns)
    innerLines.shift(); // remove {activeTab === ... && (() => {
    // find and remove the closing })()}
    while (innerLines.length > 0 && /^\s*\}\)\(\)\}/.test(innerLines[innerLines.length - 1])) innerLines.pop();
    // Also drop a bare `}` if it was the IIFE return
    inner = innerLines.join('\n');
  } else {
    // Strip `{activeTab === '...' && (` ... `)}`
    const innerLines = inner.split('\n');
    innerLines.shift();
    while (innerLines.length > 0 && /^\s*\)\}/.test(innerLines[innerLines.length - 1])) innerLines.pop();
    inner = innerLines.join('\n');
  }

  const fileContent = `${imports}
// ── ${r.name} — extracted from AdminDashboard.jsx ──
// All state and handlers come in via the \`ctx\` prop.
export default function ${r.name}({ ctx }) {
  // Destructure everything from ctx
  const {
    // shared data
    orders, archivedOrders, products, categories, inventory, discounts, globalAddOns,
    users, activeAdmin, isSuperAdmin,
    // shared fetchers / actions
    fetchOrders, fetchData, fetchERPData, fetchERPDataForEOD,
    apiFetch, peso, updateStatus, printOrderSlip, handleVoidOrder,
    // analytics (server-side)
    analyticsData, analyticsLoading, fetchAnalytics, exportAnalyticsToPDF,
    // navigation state
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
    // constants
    BIZ_NAME, COMP_REASON_LABELS, API_URL, FRONTEND_URL,
  } = ctx;

  return (
${inner}
  );
}
`;

  const outPath = path.join(TABS, r.name + '.jsx');
  fs.writeFileSync(outPath, fileContent, 'utf8');
  console.log(`  → wrote ${outPath} (${fileContent.split('\n').length} lines)`);
});

// ──────────────────────────────────────────────────────────────────────────────
// Report what to do next in AdminDashboard.jsx
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n✅ Tab files created. AdminDashboard.jsx needs:');
console.log('  1. Import each tab component');
console.log('  2. Replace each tab block with <XxxTab ctx={ctx} />');
console.log('  3. Build the ctx object from all state + handlers');
console.log('\nLine ranges to replace in AdminDashboard.jsx (1-based):');
ranges.forEach(r => console.log(`  ${r.name}: ${r.start + 1}–${r.end + 1}`));
