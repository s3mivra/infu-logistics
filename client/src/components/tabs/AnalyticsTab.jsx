import React from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag } from 'lucide-react';

// ── AnalyticsTab — extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
export default function AnalyticsTab({ ctx }) {
  // Destructure everything from ctx
  // ── Auto-generated from ctx — do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  // ── Auto-generated from ctx — do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  // ── Auto-generated from ctx — do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  const {
    API_URL, AUDIT_PAGE_SIZE, BIZ_NAME, COMP_REASON_LABELS, FRONTEND_URL,
    HIST_PAGE_SIZE, POS_PER_PAGE, SHIFT_HIST_PAGE_SIZE, accountingItemsPerPage, accountingPage,
    activeAdmin, activeInventoryItem, activeTab, addInventory, addMaterialToRecipe,
    addOnForm, addSize, analyticsData, analyticsLoading, apiFetch,
    applyComplimentary, applyDiscount, applyItemDiscount, arOutstanding, archiveDay,
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
    physicalCounts, pnlData, pnlRange, posActiveAddOns, posActiveSize,
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
    submitRfNew, submitRfRepl, toggleDay, toggleOrderList, toggleVat,
    totalAccountingPages, totalInvPages, totalOrdersPages, totalPages, totalPricingPages,
    updateItemStatus, updateMaterialQty, updateSize, updateStatus, updatingOrders,
    users, varianceNoteMode, varianceReasons,
  } = ctx;

  // Compute local values before rendering
  const ad = analyticsData;
  const totalInvValue = inventory.reduce((s, i) => s + i.stockQty * (i.unitCost || 0), 0);
  const totalSkus     = inventory.length;
  const zeroStock     = inventory.filter(i => i.stockQty <= 0).length;

  if (analyticsLoading || !ad) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in">
        <div className="py-20 text-center">
          <RefreshCw size={28} className="mx-auto text-brand animate-spin mb-3"/>
          <p className="text-white/40 font-bold uppercase tracking-widest text-sm">
            {analyticsLoading ? 'Computing analytics on server…' : 'Click Analytics to load data.'}
          </p>
          {!analyticsLoading && <button onClick={fetchAnalytics} className="mt-4 bg-brand text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-brand/90 transition">Load Analytics</button>}
        </div>
      </div>
    );
  }

  const { today, allTime, dailyRevenue, bestDay, topProducts: tp, mostUsedStock: mus, lowestStock: ls, highestStock: hs } = ad;

  return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto animate-fade-in">

          {/* Refresh button */}
          <div className="flex justify-end">
            <button onClick={fetchAnalytics} disabled={analyticsLoading}
              className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition disabled:opacity-40">
              <RefreshCw size={12} className={analyticsLoading ? 'animate-spin' : ''}/> Refresh
            </button>
          </div>

          {/* TOP ROW: High-Level Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-brand-dark border border-brand/20 rounded-xl p-6 shadow-lg shadow-brand/5 flex flex-col justify-center">
              <p className="text-white/70 text-xs font-bold uppercase tracking-wider mb-1">Net Revenue (All-Time)</p>
              <p className="text-4xl font-black text-white mb-1">₱{allTime.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <p className="text-sm text-white/80 font-medium">{allTime.orders} completed orders</p>
              {allTime.comp > 0 && <p className="text-xs text-white/50 font-semibold mt-1">+₱{allTime.comp.toLocaleString(undefined, { minimumFractionDigits: 2 })} complimentary (excluded)</p>}
            </div>

            <div className="bg-surface border border-gray-800 rounded-xl p-6 flex flex-col justify-center">
              <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Best Sales Day</p>
              <p className="text-3xl font-black text-white mb-2">{bestDay.date}</p>
              <p className="text-sm text-green-400 font-bold uppercase tracking-widest">₱{bestDay.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })} Earned</p>
            </div>

            <div className="bg-surface border border-gray-800 rounded-xl p-6 overflow-hidden relative">
              <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-4">Top 5 Best Sellers</h3>
              <div className="space-y-3 relative z-10">
                {tp.length === 0 ? (
                  <p className="text-gray-600 text-sm italic">No sales data yet.</p>
                ) : tp.map((p, i) => (
                  <div key={i} className="flex justify-between items-center text-sm">
                    <span className="font-bold text-gray-200 truncate pr-4">#{i+1} {p.name}</span>
                    <span className="text-accent font-black bg-accent/10 px-2 py-0.5 rounded">{p.qty}x</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* INVENTORY VALUE CARD */}
          <div className="bg-surface border border-white/8 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-10">
            <div className="flex-1">
              <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Total Inventory Value</p>
              <p className="text-3xl font-black text-white">₱{totalInvValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <p className="text-white/30 text-xs font-medium mt-1">Cost of all stock on hand</p>
            </div>
            <div className="flex gap-6 sm:gap-10 shrink-0">
              <div className="flex flex-col items-center">
                <p className="text-2xl font-black text-white">{totalSkus}</p>
                <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mt-0.5">SKUs Tracked</p>
              </div>
              <div className="flex flex-col items-center">
                <p className={`text-2xl font-black ${zeroStock > 0 ? 'text-red-400' : 'text-green-400'}`}>{zeroStock}</p>
                <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mt-0.5">Out of Stock</p>
              </div>
              <div className="flex flex-col items-center">
                <p className="text-2xl font-black text-white">₱{totalSkus > 0 ? (totalInvValue / totalSkus).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}</p>
                <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mt-0.5">Avg / SKU</p>
              </div>
            </div>
          </div>

          {/* BOTTOM ROW: Daily Trend & Stock Movement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <div className="bg-surface border border-gray-800 rounded-xl p-6 flex flex-col max-h-96">
              <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
                <h3 className="text-white font-bold">Daily Revenue Trend</h3>
                <button onClick={exportAnalyticsToPDF} className="text-[10px] bg-brand/10 border border-brand/30 text-brand px-3 py-1.5 rounded hover:bg-brand hover:text-page-bg transition font-bold uppercase tracking-wider">
                  Export Analytics PDF
                </button>
              </div>
              <div className="overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-700 flex-1 space-y-2">
                {dailyRevenue.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-4">No daily data available.</p>
                ) : [...dailyRevenue].reverse().map((day, i) => {
                  const pct = bestDay.revenue > 0 ? (day.revenue / bestDay.revenue) * 100 : 0;
                  return (
                    <div key={i} className="flex flex-col mb-3">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-300 font-semibold">{day.date}</span>
                        <span className="text-white font-bold">₱{day.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="w-full bg-page-bg rounded-full h-2">
                        <div className={`h-2 rounded-full ${day.revenue === bestDay.revenue ? 'bg-accent' : 'bg-gray-600'}`} style={{ width: `${pct}%` }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="bg-surface border border-accent/30 rounded-xl p-5 flex flex-col shadow-lg shadow-accent/5">
                <h3 className="text-accent text-sm font-bold uppercase tracking-wider mb-4 border-b border-accent/20 pb-2 flex items-center gap-2">
                  <Zap size={14} className="text-accent" /> High Velocity & Forecast
                </h3>
                <div className="space-y-4">
                  {mus.length === 0 ? (
                    <p className="text-gray-600 text-xs">No sales data yet — complete orders to populate.</p>
                  ) : mus.map((item, idx) => { const d = effectiveDisplay(item); return (
                    <div key={idx} className="flex flex-col border-b border-accent/10 pb-3 last:border-0 last:pb-0">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-gray-200 font-bold text-sm truncate pr-2">{item.name}</span>
                        <span className={`flex items-center gap-0.5 text-[10px] font-black px-2 py-0.5 rounded ${item.trend > 0.1 ? 'bg-red-900/40 text-red-400' : item.trend < -0.1 ? 'bg-green-900/30 text-green-400' : 'bg-accent/10 text-accent'}`}>
                          {item.trend > 0.1 ? <ArrowUp size={10}/> : item.trend < -0.1 ? <ArrowDown size={10}/> : null}
                          {Math.abs(item.trend * 100).toFixed(0)}% {item.trend > 0.1 ? 'rising' : item.trend < -0.1 ? 'easing' : 'stable'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        {[['Daily Burn', `${((item.dailyAvg||0)/d.mult).toFixed(2)} ${d.unit}`], ['Lasts', item.daysLeft === Infinity || !isFinite(item.daysLeft) ? '∞' : `${item.daysLeft}d`], ['Buy 1wk', `${((item.weeklyNeed||0)/d.mult).toFixed(2)} ${d.unit}`], ['Buy 1mo', `${((item.monthlyNeed||0)/d.mult).toFixed(2)} ${d.unit}`]].map(([lbl, val]) => (
                          <div key={lbl} className="bg-page-bg p-2 rounded flex flex-col items-center border border-gray-800/50">
                            <p className="text-[8px] text-gray-500 uppercase font-bold tracking-widest mb-1 text-center leading-tight">{lbl}</p>
                            <p className="text-xs font-black text-white">{val}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ); })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-surface border border-red-900/30 rounded-xl p-5 flex flex-col">
                  <h3 className="text-red-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-red-900/30 pb-2 flex items-center gap-2">
                    <AlertTriangle size={13} className="text-red-400" /> Low Stock (Risk)
                  </h3>
                  <div className="space-y-3">
                    {ls.length === 0 ? <p className="text-gray-600 text-xs">All items have adequate supply.</p>
                    : ls.map(item => (
                      <div key={item._id} className="flex justify-between items-center text-sm">
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-gray-300 truncate font-semibold">{item.itemName}</span>
                          <span className="text-gray-600 text-[10px]">{(Number(item.stockQty)/effectiveDisplay(item).mult).toFixed(2)} {effectiveDisplay(item).unit} left</span>
                        </div>
                        <span className={`font-black text-xs whitespace-nowrap px-2 py-1 rounded ${item.daysOfSupply <= 3 ? 'bg-red-900/40 text-red-400 animate-pulse' : item.daysOfSupply <= 7 ? 'bg-yellow-900/30 text-yellow-400' : 'bg-orange-900/20 text-orange-400'}`}>
                          {item.daysOfSupply <= 0 ? 'OUT' : `~${Math.floor(item.daysOfSupply)}d left`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-surface border border-gray-800 rounded-xl p-5 flex flex-col">
                  <h3 className="text-gray-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-gray-800 pb-2 flex items-center gap-2">
                    <BarChart2 size={13}/> Overstock Watch
                  </h3>
                  <div className="space-y-3">
                    {hs.length === 0 ? <p className="text-gray-600 text-xs">No items exceed 30 days of supply.</p>
                    : hs.map(item => (
                      <div key={item._id} className="flex justify-between items-center text-sm">
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-gray-300 truncate font-semibold">{item.itemName}</span>
                          <span className="text-gray-600 text-[10px]">{(Number(item.stockQty)/effectiveDisplay(item).mult).toFixed(2)} {effectiveDisplay(item).unit}</span>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-gray-400 font-bold text-xs">{isFinite(item.daysOfSupply) ? `~${Math.floor(item.daysOfSupply)}d supply` : '∞ supply'}</span>
                          {item.tiedUpCapital > 0 && <span className="text-orange-400 text-[10px] font-mono">₱{Number(item.tiedUpCapital).toFixed(0)} tied</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
  );
}
