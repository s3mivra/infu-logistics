import React, { useState, useEffect } from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag, MoreVertical } from 'lucide-react';
import * as ui from '../../shared/ui';
import StockTaxonomyPanel from './StockTaxonomyPanel';
import StockTransferPanel from './StockTransferPanel';

const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();

// ── InventoryTab - extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
export default function InventoryTab({ ctx }) {
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
    exportStockTransfersPDF, exportProductionHistoryPDF, loadPdfLibs, addLogoToPDF, pdfMoney,
    fetchBalanceSheet, fetchData, fetchEODData, fetchERPData, fetchExpenseCategories,
    fetchOrders, fetchPnl, fetchRfFunds, fetchRfTxs, fetchShiftHistory,
    fetchStockHistory, filteredOrders, formData, getEstimatedStock, globalAddOns,
    groupedArchives, handleImageUpload, handleInlinePriceUpdate, handleRestockSubmit, handleSaveAddOn,
    handleSaveCategory, handleSaveProduct, handleVoidOrder, historyItemName, historyModalOpen,
    historyPage, historySubTab, importModal, importRows, importSubmitting, importProgress,
    invBadgeCount, invForm, invItemsPerPage, invPage, invSubTab,
    invSearch, setInvSearch, invSort, setInvSort, invCategoryFilter, setInvCategoryFilter,
    inventory, isPosOpen, isStatusMenuOpen, isSuperAdmin, itemDisplay, packInfo,
    procurementCreditAccounts,
    stockLocations, stockCategories, saveStockLocation, deleteStockLocation, saveStockCategory, deleteStockCategory,
    stockTransfers, locationAnalytics, fetchStockTransfers, requestStockTransfer, actOnStockTransfer,
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
    submitRfNew, submitRfRepl, toggleDay, toggleOrderList,
    totalAccountingPages, totalInvPages, totalOrdersPages, totalPages, totalPricingPages,
    updateItemStatus, updateMaterialQty, updateSize, updateStatus, updatingOrders,
    users, varianceNoteMode, varianceReasons, historyLoading,
  } = ctx;

  // Which row's action menu is open (by item._id), null = all closed
  const [openActionMenu, setOpenActionMenu] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });

  // ── EOD Variance report (locked days) ──────────────────────────────────────
  // EODRecord itself only ever stored the lock flag, never the variance
  // detail - reconstructed from the StockCard 'Adjustment' entries that
  // locking creates for every item that had a variance (see the
  // /api/inventory/eod-history* routes for how).
  const [eodHistory, setEodHistory] = useState(null); // [{dateString, lockedAt, lockedBy}]
  const [eodHistoryOpen, setEodHistoryOpen] = useState(false);
  const [eodExporting, setEodExporting] = useState(false);
  const loadEodHistory = async () => {
    setEodHistoryOpen(o => !o);
    if (eodHistory) return;
    try { const r = await apiFetch('/api/inventory/eod-history'); const d = await r.json(); if (d.success) setEodHistory(d.records); }
    catch { setEodHistory([]); }
  };
  const exportEodVariancePDF = async (dateString) => {
    setEodExporting(true);
    try {
      const r = await apiFetch(`/api/inventory/eod-history/${dateString}/variance`);
      const d = await r.json();
      if (!d.success) return ui.alert(d.error || 'Could not load that day\'s variance.');
      const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
      await addLogoToPDF(doc);
      doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
      doc.setFontSize(10); doc.text('EOD VARIANCE REPORT', 105, 22, { align: 'center' });
      doc.setFontSize(9); doc.text(`Locked day: ${dateString}`, 105, 28, { align: 'center' });
      if (d.rows.length === 0) {
        doc.setFontSize(10); doc.text('No variance that day - every item counted matched system stock.', 105, 40, { align: 'center' });
      } else {
        autoTable(doc, {
          startY: 34,
          head: [['Item', 'Qty Change', 'Balance After', 'Unit Cost', 'Value Impact', 'Reason']],
          body: d.rows.map(r => [r.itemName, r.qtyChange > 0 ? `+${r.qtyChange}` : r.qtyChange, r.balanceAfter, pdfMoney(r.unitCost), pdfMoney(r.valueImpact), r.reason]),
          foot: [[{ content: 'Total Value Impact', colSpan: 4 }, pdfMoney(d.totalValueImpact), '']],
          styles: { fontSize: 8 }, headStyles: { fillColor: [111, 135, 77] }, footStyles: { fillColor: [61, 74, 42], fontStyle: 'bold' },
          columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
        });
      }
      doc.save(`EOD-Variance-${dateString}.pdf`);
    } catch { ui.alert('Network error.'); }
    finally { setEodExporting(false); }
  };
  useEffect(() => {
    if (!openActionMenu) return;
    const close = () => setOpenActionMenu(null);
    document.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [openActionMenu]);

  // Physical count: default each item's count input to the current SYSTEM ending value
  // (in display units), so EOD starts from "matches system" and the counter only edits
  // discrepancies. Full precision (toFixed 6) keeps the default at exactly 0 variance.
  React.useEffect(() => {
    if (!Array.isArray(inventory) || inventory.length === 0) return;
    setPhysicalCounts(prev => {
      let changed = false;
      const next = { ...prev };
      for (const item of inventory) {
        if (next[item._id] === undefined) {
          const mult = itemDisplay(item).packBase || 1;
          next[item._id] = Number(((item.stockQty || 0) / (mult || 1)).toFixed(6));
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory]);

  return (
        <div className="flex flex-col gap-6">

          {/* FULL-WIDTH: Main Tables */}
          <div className="bg-accent border border-accentShadow rounded-xl p-6 flex flex-col h-fit">
            
            {/* Header & Sub-Tabs */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 border-b border-white/10 pb-4">
              <h3 className="text-xl font-bold text-white">Inventory Hub</h3>
              
              {/* --- NEW: THE SUB-TAB TOGGLE --- */}
              <div className="flex bg-page-bg p-1 rounded-lg shadow-inner">
                <button 
                  onClick={() => setInvSubTab('live')}
                  className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition ${invSubTab === 'live' ? 'bg-accent text-white shadow-md' : 'text-gray-400 hover:text-accent'}`}
                >
                  Live Stock
                </button>
                <button 
                  onClick={() => { setInvSubTab('eod'); fetchEODData(); }}
                  className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition flex items-center gap-2 ${invSubTab === 'eod' ? 'bg-red-600 text-white shadow-md shadow-red-500/20' : 'text-gray-400 hover:text-red-400'}`}
                >
                  <span className={`w-2 h-2 rounded-full ${invSubTab === 'eod' ? 'bg-white animate-pulse' : 'bg-red-500'}`}></span>
                  EOD Audit
                </button>
                <button
                  onClick={() => setInvSubTab('places')}
                  className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition ${invSubTab === 'places' ? 'bg-accent text-white shadow-md' : 'text-gray-400 hover:text-accent'}`}
                >
                  Places &amp; Categories
                </button>
                <button
                  onClick={() => { setInvSubTab('transfers'); fetchStockTransfers(); }}
                  className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition ${invSubTab === 'transfers' ? 'bg-accent text-white shadow-md' : 'text-gray-400 hover:text-accent'}`}
                >
                  Transfers
                </button>
              </div>
              
              <div className="flex items-center gap-1.5">
                {/* Direct stock import - posts straight to inventory (distinct from the
                    Procurement "Import Excel", which creates a PO record instead). */}
                <label className="text-[10px] bg-white border hover:bg-accent hover:border-white hover:text-white text-black px-3 py-1.5 rounded font-bold uppercase tracking-wider transition cursor-pointer min-h-[32px] flex items-center gap-1">
                  <Download size={11} className="rotate-180" /> Import
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={e => { parseImportFile(e.target.files?.[0]); e.target.value = ''; }} className="hidden" />
                </label>
                <button onClick={downloadImportTemplate} title="Download CSV template" className="text-[10px] bg-accent border border-white hover:bg-brand-dark text-white px-2.5 py-1.5 rounded font-bold uppercase tracking-wider transition min-h-[32px]">
                  Template
                </button>
                <button onClick={exportInventoryToPDF} className="text-[10px] bg-accent border border-white text-white px-3 py-1.5 rounded hover:bg-brand-dark transition font-bold uppercase tracking-wider min-h-[32px]">
                  Export PDF
                </button>
                <button onClick={exportProductionHistoryPDF} title="Every batch dated by production instead of expiry (beans, etc.), across the whole catalogue" className="text-[10px] bg-accent border border-white text-white px-3 py-1.5 rounded hover:bg-brand-dark transition font-bold uppercase tracking-wider min-h-[32px]">
                  Production History
                </button>
              </div>
            </div>

            {invSubTab === 'places' && (
              <StockTaxonomyPanel
                stockLocations={stockLocations}
                stockCategories={stockCategories}
                saveStockLocation={saveStockLocation}
                deleteStockLocation={deleteStockLocation}
                saveStockCategory={saveStockCategory}
                deleteStockCategory={deleteStockCategory}
              />
            )}

            {invSubTab === 'transfers' && (
              <StockTransferPanel
                inventory={inventory}
                stockTransfers={stockTransfers}
                locationAnalytics={locationAnalytics}
                requestStockTransfer={requestStockTransfer}
                actOnStockTransfer={actOnStockTransfer}
                isSuperAdmin={isSuperAdmin}
                peso={peso}
                apiFetch={apiFetch}
                exportStockTransfersPDF={exportStockTransfersPDF}
              />
            )}

            {/* --- SEARCH / FILTER / SORT BAR --- */}
            {invSubTab === 'live' && (() => {
              const codeToCategory = {};
              for (const p of products) { if (p.productCode && p.category) codeToCategory[p.productCode] = p.category; }
              const getInvCat = (i) => i.category || codeToCategory[i.itemCode] || '';
              const invCategories = [...new Set(inventory.map(i => getInvCat(i)).filter(Boolean))].sort();
              return (
                <div className="flex flex-wrap gap-2 mb-4">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[160px]">
                    <Search size={13} className="absolute left-2.5 top-1/3 -translate-y-1/2 text-white pointer-events-none" />
                    <input
                      type="text"
                      value={invSearch}
                      onChange={e => { setInvSearch(e.target.value); }}
                      placeholder="Search items…"
                      className="w-full bg-white/5 border border-white rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-white focus:outline-none focus:border-brand"
                    />
                    {invSearch && (
                      <button onClick={() => setInvSearch('')} className="absolute right-2 top-1/3 -translate-y-1/2 text-white hover:text-white">
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* Category filter */}
                  {invCategories.length > 0 && (
                    <select
                      value={invCategoryFilter}
                      onChange={e => { setInvCategoryFilter(e.target.value); }}
                      className="bg-white/5 border border-white rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand"
                    >
                      <option value="">All Categories</option>
                      {invCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}

                  {/* Sort */}
                  <select
                    value={invSort}
                    onChange={e => { setInvSort(e.target.value); }}
                    className="bg-white/5 border border-white rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand"
                  >
                    <option value="name-asc">Name A → Z</option>
                    <option value="name-desc">Name Z → A</option>
                    <option value="qty-asc">Qty Low → High</option>
                    <option value="qty-desc">Qty High → Low</option>
                    <option value="price-asc">Cost Low → High</option>
                    <option value="price-desc">Cost High → Low</option>
                  </select>

                  {/* Active filter chips */}
                  {(invSearch || invCategoryFilter || invSort !== 'name-asc') && (
                    <button
                      onClick={() => { setInvSearch(''); setInvCategoryFilter(''); setInvSort('name-asc'); }}
                      className="px-3 py-2 rounded-lg bg-white hover:bg-accent border hover:border-white text-accent hover:text-white text-xs font-bold transition flex items-center gap-1"
                    >
                      <X size={11} /> Reset
                    </button>
                  )}
                </div>
              );
            })()}

            {/* --- TAB 1: LIVE STOCK (Clean & Read-Only) --- */}
            {invSubTab === 'live' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-white border-b border-white/20">
                      <th className="pb-3">Item Name</th>
                      <th className="pb-3 text-right">Live Qty</th>
                      <th className="pb-3 text-right">Threshold</th>
                      <th className="pb-3">Unit</th>
                      <th className="pb-3 text-right">Unit Cost</th>
                      <th className="pb-3 text-right">Total Value</th>
                      <th className="pb-3 text-center">Expiry</th>
                      <th className="pb-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentInventory.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-14 text-center">
                          <Package size={26} className="mx-auto mb-3 text-brand/50" />
                          <p className="text-white font-black uppercase tracking-widest text-xs mb-1">No stock items yet</p>
                          <p className="text-white text-xs">Receive your first delivery with the Procurement form to start tracking inventory.</p>
                        </td>
                      </tr>
                    )}
                    {currentInventory.map(item => {
                      const effThreshold = item.effectiveThreshold != null ? item.effectiveThreshold : (item.lowStockThreshold || 0);
                      const isLow = effThreshold > 0 && item.stockQty <= effThreshold;
                      // Phase Out: out of stock AND no longer worth restocking (it costs more
                      // than its SRP). Compares like-for-like - cost per display unit vs SRP,
                      // which is also stored per display unit. Guarded on srp > 0: a raw
                      // material (no SRP) has nothing to compare against, so it never qualifies.
                      const costPerDisplay = (item.unitCost || 0) * (effectiveDisplay(item).mult || 1);
                      const isPhaseOut = (item.stockQty || 0) <= 0 && (item.srp || 0) > 0 && costPerDisplay > item.srp;
                      // Expiry classification
                      let expBadge = null;
                      let rowExpiredTint = '';
                      if (item.expiryDate) {
                        const exp = new Date(item.expiryDate);
                        const today = new Date(); today.setHours(0,0,0,0);
                        const diffDays = Math.ceil((exp - today) / 86400000);
                        const warn = item.expiryWarnDays || 7;
                        if (diffDays < 0) {
                          expBadge = { text: `EXPIRED ${Math.abs(diffDays)}d`, cls: 'bg-red-500 text-white animate-pulse' };
                          rowExpiredTint = 'bg-red-900/15';
                        } else if (diffDays === 0) {
                          expBadge = { text: 'TODAY', cls: 'bg-red-500 text-white animate-pulse' };
                          rowExpiredTint = 'bg-red-900/10';
                        } else if (diffDays <= warn) {
                          expBadge = { text: `${diffDays}d`, cls: 'bg-yellow-500 text-black' };
                        } else if (diffDays <= 30) {
                          expBadge = { text: `${diffDays}d`, cls: 'bg-orange-400/30 text-orange-300 border border-orange-400/40' };
                        } else {
                          expBadge = { text: exp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: 'bg-white/10 text-gray-300' };
                        }
                      }
                      return (
                      <React.Fragment key={item._id}>
                      {/* data-notif-id is the jump target for the notification
                          bell - clicking a low-stock/expiry alert scrolls here. */}
                      <tr data-notif-id={item._id} className={`border-b border-white/30 hover:bg-page-bg/30 transition ${rowExpiredTint || (isLow ? 'bg-red-900/10' : '')}`}>
                        <td className="py-3 font-bold text-white uppercase">
                          {item.itemName}
                          {isLow && <span className="ml-2 text-[9px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded uppercase animate-pulse">LOW</span>}
                          {isPhaseOut && <span title="Out of stock and costs more than its SRP - not worth restocking" className="ml-2 text-[9px] font-black bg-gray-500 text-white px-1.5 py-0.5 rounded uppercase">PHASE OUT</span>}
                          {!itemDisplay(item).isPacked && (
                            <span title="No pack size in the name - add e.g. 250G / 1L / 500ML so cost shows per package" className="ml-2 text-[9px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/40 px-1.5 py-0.5 rounded uppercase">SET SIZE</span>
                          )}
                        </td>
                        {(() => { const d = itemDisplay(item); return (<>
                        <td className={`py-3 text-right font-bold tabular-nums ${isLow ? 'text-red-400' : 'text-white'}`}>{d.packQty.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                        <td className="py-3 text-right text-white text-xs font-mono tabular-nums">{effThreshold > 0 ? (<>{(effThreshold / (d.packBase || 1)).toLocaleString(undefined, { maximumFractionDigits: 3 })}{item.thresholdIsAuto && <span title="Auto-suggested from sales velocity - set your own to override" className="ml-1 text-[8px] font-black text-accent/70 align-top">AUTO</span>}</>) : '-'}</td>
                        <td className="py-3 text-white pl-2 font-bold">{d.isPacked ? 'pcs' : d.unit}</td>
                        <td className="py-3 text-right text-white font-bold font-mono text-xs tabular-nums"><>{peso(d.packCost)}<span className="text-white/60">/{d.packLabel}</span></></td>
                        <td className="py-3 text-right text-white font-bold font-mono text-xs tabular-nums">{peso(item.stockQty * (item.unitCost || 0))}</td>
                        </>); })()}
                        <td className="py-3 text-center">
                          {expBadge ? (
                            <div className="inline-flex items-center gap-1.5">
                              <span title={item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : ''} className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide ${expBadge.cls}`}>{expBadge.text}</span>
                              {(item.expiryBatches?.length || 0) > 1 && (
                                <button onClick={() => setExpandedBatchRows(s => ({ ...s, [item._id]: !s[item._id] }))}
                                  title={`${item.expiryBatches.length} batches`}
                                  className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide bg-white/10 text-white hover:bg-white/20 transition flex items-center gap-0.5">
                                  {expandedBatchRows[item._id] ? <ChevronUp size={10}/> : <ChevronDown size={10}/>} {item.expiryBatches.length}
                                </button>
                              )}
                            </div>
                          ) : <span className="text-white text-xs">-</span>}
                        </td>
                        <td className="py-3">
                          {/* Single ⋮ hamburger button → dropdown for all screen sizes */}
                          <div className="flex justify-center">
                            <div className="relative">
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  if (openActionMenu === item._id) { setOpenActionMenu(null); return; }
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                                  setOpenActionMenu(item._id);
                                }}
                                className="p-2 rounded-lg bg-white/5 hover:bg-white/15 text-white hover:text-fg transition min-h-[36px] min-w-[36px] flex items-center justify-center"
                              >
                                <MoreVertical size={16} />
                              </button>
                              {openActionMenu === item._id && (
                                <div
                                  onClick={e => e.stopPropagation()}
                                  style={{ top: menuPosition.top, right: menuPosition.right }}
                                  className="fixed z-[9999] bg-sidebar-bg border border-white/15 rounded-xl shadow-2xl min-w-[150px] py-1 animate-scale-in origin-top-right"
                                >
                                  <button onClick={() => { fetchStockHistory(item); setOpenActionMenu(null); }} disabled={historyLoading} className="w-full text-left px-4 py-2.5 text-xs font-bold text-fg/70 hover:bg-white/8 hover:text-accent transition disabled:opacity-50 disabled:cursor-wait">
                                    {historyLoading ? 'Loading…' : 'History'}
                                  </button>
                                  <button onClick={() => { openEditInventory(item); setOpenActionMenu(null); }} className="w-full text-left px-4 py-2.5 text-xs font-bold text-fg/70 hover:bg-white/8 hover:text-blue-400 transition">
                                    Edit
                                  </button>
                                  <button onClick={() => {
                                    const isExpired = expBadge && (expBadge.text.startsWith('EXPIRED') || expBadge.text === 'TODAY');
                                    setSpoilageModal({ item });
                                    setSpoilageForm({ qty: isExpired ? itemDisplay(item).packQty.toString() : '', reason: isExpired ? 'Spoilage' : '', note: isExpired ? `Auto-flagged expired (${new Date(item.expiryDate).toLocaleDateString()})` : '' });
                                    setOpenActionMenu(null);
                                  }} className="w-full text-left px-4 py-2.5 text-xs font-bold text-fg/70 hover:bg-white/8 hover:text-orange-400 transition">
                                    Waste
                                  </button>
                                  <div className="border-t border-white/8 mx-2 my-1" />
                                  <button onClick={() => { deleteInventory(item._id); setOpenActionMenu(null); }} className="w-full text-left px-4 py-2.5 text-xs font-bold text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition">
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                      {/* Expanded batches sub-row */}
                      {expandedBatchRows[item._id] && (item.expiryBatches?.length || 0) > 0 && (
                        <tr className="bg-white/5">
                          <td colSpan={8} className="px-6 py-3">
                            <p className="text-[10px] uppercase tracking-widest font-black text-white mb-2">Batches (FEFO - oldest used first)</p>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-white text-[10px] uppercase tracking-widest">
                                    <th className="text-left pb-1.5">#</th>
                                    <th className="text-right pb-1.5">Qty</th>
                                    <th className="text-left pb-1.5 pl-3">Expiry / Prod</th>
                                    <th className="text-left pb-1.5 pl-3">Received</th>
                                    <th className="text-right pb-1.5 pl-3">Unit Cost</th>
                                    <th className="text-left pb-1.5 pl-3">Ref</th>
                                    <th className="text-right pb-1.5">Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...item.expiryBatches]
                                    .map((b, originalIdx) => ({ ...b, _originalIdx: originalIdx }))
                                    .sort((a, b) => {
                                      // Rotation date: expiryDate when known, else productionDate (goods
                                      // with no real expiry - beans, etc. - date freshness by roast/production date).
                                      const ad = a.expiryDate || a.productionDate;
                                      const bd = b.expiryDate || b.productionDate;
                                      return (ad ? new Date(ad) : Infinity) - (bd ? new Date(bd) : Infinity);
                                    })
                                    .map((b, displayIdx) => {
                                      const bPackBase = packInfo(item).packBase || 1;
                                      const dispQty = (b.qty || 0) / bPackBase;
                                      const bUnit = itemDisplay(item).isPacked ? 'pcs' : itemDisplay(item).unit;
                                      const exp = b.expiryDate ? new Date(b.expiryDate) : null;
                                      const prod = !exp && b.productionDate ? new Date(b.productionDate) : null;
                                      const today = new Date(); today.setHours(0,0,0,0);
                                      const diffDays = exp ? Math.ceil((exp - today) / 86400000) : null;
                                      let badge = '';
                                      if (diffDays !== null) {
                                        if (diffDays < 0) badge = 'text-red-400 font-black';
                                        else if (diffDays === 0) badge = 'text-red-400 font-black';
                                        else if (diffDays <= (item.expiryWarnDays || 7)) badge = 'text-yellow-300 font-bold';
                                        else badge = 'text-white';
                                      }
                                      const isOldest = displayIdx === 0;
                                      return (
                                        <tr key={b._originalIdx} className="border-t border-white/5">
                                          <td className="py-1.5 text-white font-bold">
                                            {isOldest ? <span className="text-[9px] bg-brand text-white px-1.5 py-0.5 rounded font-black uppercase tracking-wider shadow-sm">NEXT</span> : `#${displayIdx + 1}`}
                                          </td>
                                          <td className="py-1.5 text-right text-white font-bold tabular-nums">{dispQty.toLocaleString(undefined, { maximumFractionDigits: 3 })} {bUnit}</td>
                                          <td className={`py-1.5 pl-3 tabular-nums ${badge}`}>
                                            {exp ? (
                                              <>{exp.toLocaleDateString()}
                                                {diffDays !== null && <span className="ml-1.5 text-[10px] opacity-70">({diffDays < 0 ? `${Math.abs(diffDays)}d ago` : diffDays === 0 ? 'today' : `in ${diffDays}d`})</span>}
                                              </>
                                            ) : prod ? (
                                              <><span className="text-white text-[9px] uppercase font-bold mr-1">Prod</span>{prod.toLocaleDateString()}</>
                                            ) : '-'}
                                          </td>
                                          <td className="py-1.5 pl-3 text-white text-[10px] tabular-nums">{b.receivedAt ? new Date(b.receivedAt).toLocaleDateString() : '-'}</td>
                                          <td className="py-1.5 pl-3 text-right text-white text-[10px] tabular-nums">{b.unitCost ? peso(b.unitCost * bPackBase) : '-'}<span className="text-white">/{bUnit}</span></td>
                                          <td className="py-1.5 pl-3 text-white text-[10px]">{b.reference || '-'}</td>
                                          <td className="py-1.5 text-right">
                                            <button onClick={async () => {
                                              if (!(await ui.confirm(`Remove this batch (${dispQty} ${bUnit}, expires ${exp ? exp.toLocaleDateString() : 'n/a'})? This will NOT change stockQty - only the batch record.`))) return;
                                              await apiFetch(`/api/inventory/${item._id}/batches/${b._originalIdx}`, { method: 'DELETE' });
                                              fetchERPData();
                                            }} className="text-red-400 hover:text-red-400 hover:bg-red-500/10 px-2 py-0.5 rounded transition text-[10px] font-black uppercase tracking-wider">
                                              Remove
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })
                                  }
                                </tbody>
                              </table>
                            </div>
                            <p className="text-[10px] text-white mt-2">
                              Item unit cost <span className="text-white font-bold tabular-nums">{peso((item.unitCost || 0) * (packInfo(item).packBase || 1))}/{itemDisplay(item).isPacked ? 'pcs' : itemDisplay(item).unit}</span> is the weighted average across all batches (updated on each restock).
                            </p>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {/* --- INVENTORY PAGINATION CONTROLS --- */}
              {totalInvPages > 1 && (
                <div className="flex justify-between items-center bg-page-bg p-3 rounded-lg border border-white/10 mt-4">
                  <button 
                    onClick={() => setInvPage(prev => Math.max(prev - 1, 1))}
                    disabled={invPage === 1}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${invPage === 1 ? 'bg-white/10 text-gray-600 cursor-not-allowed' : 'bg-surface border border-white/10 text-fg hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                  </button>
                  <span className="text-gray-400 text-xs font-bold tracking-widest">
                    PAGE <span className="text-accent text-sm">{invPage}</span> OF {totalInvPages}
                  </span>
                  <button 
                    onClick={() => setInvPage(prev => Math.min(prev + 1, totalInvPages))}
                    disabled={invPage === totalInvPages}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${invPage === totalInvPages ? 'bg-white/10 text-gray-600 cursor-not-allowed' : 'bg-surface border border-white/10 text-fg hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                  </button>
                </div>
              )}
              </div>
            )}

            {/* --- TAB 2: EOD AUDIT (Enterprise Financial Control) --- */}
            {invSubTab === 'eod' && (() => {
              // physicalCounts[id] is in DISPLAY units; convert to base for variance math.
              const countBase = (id) => {
                const v = physicalCounts[id];
                if (v === '' || v === undefined || v === null) return null;
                const item = inventory.find(i => i._id === id);
                const m = item ? effectiveDisplay(item).mult : 1;
                return Number(v) * m;
              };
              const itemsCounted = inventory.filter(i => physicalCounts[i._id] !== undefined && physicalCounts[i._id] !== '').length;
              const isComplete = itemsCounted === inventory.length;
              const itemsWithVariance = inventory.filter(i => {
                const cb = countBase(i._id);
                return cb !== null && cb !== i.stockQty;
              });
              const netVarianceQty = itemsWithVariance.length; // count of items off
              const netImpact = itemsWithVariance.reduce((sum, i) => {
                const cb = countBase(i._id);
                return sum + ((cb - i.stockQty) * (i.unitCost || 0));
              }, 0);

              const isLocked = eodStatus === 'LOCKED';

              return (
                <div className="overflow-x-auto flex flex-col h-full animate-in fade-in duration-300 relative pb-24">

                  {/* --- LOCKED DAY VARIANCE EXPORT --- reconstructed from StockCard, since
                      EODRecord itself never stored the detail (see loadEodHistory above) --- */}
                  <div className="mb-4 relative">
                    <button onClick={loadEodHistory} className="text-[10px] bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition flex items-center gap-1.5">
                      Export Variance for a Locked Day {eodHistoryOpen ? '▲' : '▼'}
                    </button>
                    {eodHistoryOpen && (
                      <div className="absolute z-20 mt-1 bg-surface border border-white/10 rounded-lg shadow-2xl w-72 max-h-64 overflow-y-auto">
                        {eodHistory === null ? (
                          <p className="text-fg/40 text-xs p-4 text-center">Loading…</p>
                        ) : eodHistory.length === 0 ? (
                          <p className="text-fg/40 text-xs p-4 text-center">No locked days yet.</p>
                        ) : eodHistory.map(r => (
                          <button key={r.dateString} disabled={eodExporting} onClick={() => exportEodVariancePDF(r.dateString)}
                            className="w-full text-left px-4 py-2.5 text-xs font-bold text-fg/80 hover:bg-white/5 hover:text-accent transition disabled:opacity-40 border-b border-white/5 last:border-0">
                            {r.dateString} <span className="text-fg/30 font-normal">· locked by {r.lockedBy || '-'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* --- INTELLIGENT EOD HEADER --- */}
                  <div className={`flex justify-between items-center p-4 rounded-lg border mb-4 shadow-inner ${isLocked ? 'bg-green-900/10 border-green-900/30' : 'bg-page-bg border-accent'}`}>
                    <div>
                      <h4 className="text-fg font-black uppercase tracking-wider text-sm flex items-center gap-2">
                        {isLocked ? (
                          <>EOD Locked</>
                        ) : (
                          <><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> EOD Audit (Open)</>
                        )}
                      </h4>
                      <p className={`text-xs mt-1 ${isLocked ? 'text-fg font-bold' : 'text-fg'}`}>
                        {isLocked 
                          ? `Daily inventory was securely locked on ${new Date(eodLockedAt).toLocaleTimeString()}`
                          : `Audit physical stock, assign variance reasons, and lock daily financial impact.`}
                      </p>
                    </div>

                    {/* NEW REOPEN BUTTON */}
                    {isLocked && (
                      <button
                        onClick={async () => {
                          if(await ui.confirm("WARNING: Reopening the day allows new sales, which will alter your ending inventory. Are you sure?")) {
                            await apiFetch(`/api/inventory/eod/reopen`, { method: 'POST' });
                            fetchEODData(); // Refresh the tab
                          }
                        }}
                        className="bg-page-bg border border-gray-600 text-accent hover:text-fg hover:border-red-500 px-4 py-2 rounded text-xs font-bold uppercase transition"
                      >
                        Reopen Register
                      </button>
                    )}
                  </div>

                  <table className="w-full text-left text-sm mb-4">
                    <thead>
                      <tr className="text-white border-b border-white text-xs uppercase tracking-wider">
                        <th className="pb-3 w-1/4">Item & Context</th>
                        <th className="pb-3 text-right">System End</th>
                        <th className="pb-3 text-center">Physical Count</th>
                        <th className="pb-3 text-right">Variance</th>
                        <th className="pb-3 text-right pr-2">Impact (₱)</th>
                      </tr>
                    </thead>
                    <tbody className={isLocked ? 'opacity-50 pointer-events-none' : ''}>
                      {currentInventory.map(item => {
                        // LOG: count in whole packages (pcs); FB: count in kg/L/pcs.
                        const di = itemDisplay(item);
                        const eff = { mult: di.packBase || 1, unit: di.isPacked ? 'pcs' : di.unit };
                        const actualInputDisplay = physicalCounts[item._id]; // entered in display units
                        const hasInput = actualInputDisplay !== undefined && actualInputDisplay !== '';
                        // Convert input → base for variance math; everything financial stays in base.
                        const actualBase = hasInput ? Number(actualInputDisplay) * eff.mult : null;
                        const variance = hasInput ? actualBase - item.stockQty : 0;
                        const varianceDisplay = variance / eff.mult;
                        const financialImpact = variance * (item.unitCost || 0);
                        const formattedImpact = financialImpact < 0 ? `-₱${Math.abs(financialImpact).toFixed(2)}` : `₱${financialImpact.toFixed(2)}`;

                        // --- REAL MOVEMENT MATH (in base units, display-converted) ---
                        const realIn  = dailyMovement[item._id]?.in  || 0;
                        const realOut = dailyMovement[item._id]?.out || 0;
                        const calculatedStartDisplay = (item.stockQty - realIn + realOut) / eff.mult;
                        const realInDisplay  = realIn  / eff.mult;
                        const realOutDisplay = realOut / eff.mult;
                        const systemEndDisplay = item.stockQty / eff.mult;
                        const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

                        return (
                          <tr key={item._id} className={`border-b border-white/30 hover:bg-page-bg/30 transition ${hasInput && variance !== 0 ? 'bg-red-900/5' : ''}`}>

                            <td className="py-4 w-[40%]">
                              <p className="font-bold text-white">{item.itemName}</p>
                              <p className="text-[15px] text-white font-mono mt-1 tabular-nums">
                                Start: {fmt(calculatedStartDisplay)} {eff.unit}  <span className="p-1 font-bold rounded text-green-600 bg-white">In: +{fmt(realInDisplay)}</span> <span className="p-1 font-bold rounded bg-white font-bold text-red-600">Out: −{fmt(realOutDisplay)}</span>
                              </p>
                              
                              {hasInput && variance !== 0 && !isLocked && (
                                <div className="mt-2 space-y-1.5">
                                  {varianceNoteMode[item._id] ? (
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-1">
                                        <span className="text-[9px] text-white uppercase font-bold tracking-wider">Note</span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setVarianceNoteMode({...varianceNoteMode, [item._id]: false});
                                            setVarianceReasons({...varianceReasons, [item._id]: ''});
                                          }}
                                          className="text-[9px] text-white hover:text-fg ml-auto"
                                        >← back</button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        placeholder="Describe reason..."
                                        value={varianceReasons[item._id] || ''}
                                        onChange={(e) => setVarianceReasons({...varianceReasons, [item._id]: e.target.value})}
                                        className="w-full max-w-[220px] bg-page-bg border border-gray-600 text-fg text-[10px] rounded p-1.5 outline-none focus:border-accent resize-none"
                                      />
                                    </div>
                                  ) : (
                                    <select
                                      value={varianceReasons[item._id] || ''}
                                      onChange={(e) => {
                                        if (e.target.value === '__note__') {
                                          setVarianceNoteMode({...varianceNoteMode, [item._id]: true});
                                          setVarianceReasons({...varianceReasons, [item._id]: ''});
                                        } else {
                                          setVarianceReasons({...varianceReasons, [item._id]: e.target.value});
                                        }
                                      }}
                                      className={`w-full max-w-[200px] bg-page-bg border text-[10px] rounded p-1 outline-none ${variance > 0 ? 'border-green-700/60 text-green-700 focus:border-green-500' : 'border-red-900/60 text-red-500 focus:border-red-500'}`}
                                    >
                                      <option value="" disabled>Select Reason...</option>
                                      {variance > 0 ? (
                                        <>
                                          <option value="Previous Miscount">Previous Miscount</option>
                                          <option value="__note__">Add Note...</option>
                                        </>
                                      ) : (
                                        <>
                                          <option value="Damaged/Spoiled">Damaged / Spoiled</option>
                                          <option value="Prep Waste">Preparation Waste</option>
                                          <option value="Previous Miscount">Previous Miscount</option>
                                          <option value="Unaccounted Loss">Unaccounted / Suspected Theft</option>
                                          <option value="__note__">Add Note...</option>
                                        </>
                                      )}
                                    </select>
                                  )}
                                </div>
                              )}
                            </td>

                            <td className="py-4 text-right text-white font-mono text-sm tabular-nums w-[15%]">
                              {fmt(systemEndDisplay)} <span className="text-[11px] text-white">{eff.unit}</span>
                            </td>

                            <td className="py-4 text-center align-top pt-5 w-[20%]">
                              <div className="inline-flex items-center gap-1.5">
                                <input
                                  type="number"
                                  step="0.001"
                                  placeholder={isLocked ? "LOCKED" : "Count…"}
                                  disabled={isLocked}
                                  className={`w-24 bg-page-bg border rounded p-1.5 outline-none text-center text-sm font-mono tabular-nums transition
                                    ${isLocked ? 'border-white/10 text-gray-600 bg-gray-900/20' :
                                      hasInput && variance < 0 ? 'border-red-500 text-fg shadow-[0_0_10px_rgba(239,68,68,0.1)]' :
                                      hasInput && variance > 0 ? 'border-green-500 text-fg' :
                                      hasInput && variance === 0 ? 'border-gray-600 text-fg' :
                                      'border-white/10 text-fg focus:border-accent'}`
                                  }
                                  value={hasInput ? actualInputDisplay : ''}
                                  onChange={(e) => setPhysicalCounts({...physicalCounts, [item._id]: e.target.value})}
                                />
                                <span className="text-[10px] text-white font-bold">{eff.unit}</span>
                              </div>
                            </td>

                            <td className={`py-4 text-right font-black font-mono text-sm w-[12.5%] align-top pt-6 tabular-nums ${variance < 0 ? 'text-red-300' : variance > 0 ? 'text-green-500' : 'text-white'}`}>
                              {hasInput ? `${varianceDisplay > 0 ? '+' : ''}${fmt(varianceDisplay)} ${eff.unit}` : '-'}
                            </td>

                            <td className={`py-4 text-right font-mono text-xs pr-2 font-bold w-[12.5%] align-top pt-6 ${financialImpact < 0 ? 'text-red-300' : financialImpact > 0 ? 'text-green-400' : 'text-white'}`}>
                              {hasInput ? formattedImpact : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {/* --- INVENTORY PAGINATION CONTROLS --- */}
                  {totalInvPages > 1 && (
                    <div className="flex justify-between items-center bg-page-bg p-3 rounded-lg border border-white/10 mt-4">
                      <button 
                        onClick={() => setInvPage(prev => Math.max(prev - 1, 1))}
                        disabled={invPage === 1}
                        className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${invPage === 1 ? 'bg-white/10 text-gray-600 cursor-not-allowed' : 'bg-surface border border-white/10 text-fg hover:border-accent hover:text-accent'}`}
                      >
                        <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                      </button>
                      <span className="text-gray-400 text-xs font-bold tracking-widest">
                        PAGE <span className="text-accent text-sm">{invPage}</span> OF {totalInvPages}
                      </span>
                      <button 
                        onClick={() => setInvPage(prev => Math.min(prev + 1, totalInvPages))}
                        disabled={invPage === totalInvPages}
                        className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${invPage === totalInvPages ? 'bg-white/10 text-gray-600 cursor-not-allowed' : 'bg-surface border border-white/10 text-fg hover:border-accent hover:text-accent'}`}
                      >
                        <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                      </button>
                    </div>
                  )}

                  {/* SUMMARY FOOTER */}
                  {!isLocked && (
                    <div className="absolute bottom-0 left-0 right-0 bg-surface border-t border-white/10 p-4 flex justify-between items-center rounded-b-xl">
                      <div className="flex gap-6">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Audit Status</p>
                          <p className={`text-sm font-black flex items-center gap-1 ${isComplete ? 'text-green-400' : 'text-yellow-500'}`}>
                            {isComplete ? <><CheckCircle size={13} /> All Items Counted</> : <><AlertTriangle size={13} /> {itemsCounted} / {inventory.length} Counted</>}
                          </p>
                        </div>
                        <div className="border-l borderwhite/10 pl-6">
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Items With Variance</p>
                          <p className="text-sm font-black text-gray-400 tabular-nums">
                            {netVarianceQty} {netVarianceQty === 1 ? 'item' : 'items'}
                          </p>
                        </div>
                        <div className="border-l border-white/10 pl-6">
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Total Financial Impact</p>
                          <p className={`text-sm font-black ${netImpact < 0 ? 'text-red-500' : netImpact > 0 ? 'text-green-500' : 'text-gray-300'}`}>
                            {netImpact < 0 ? `-₱${Math.abs(netImpact).toFixed(2)}` : `₱${netImpact.toFixed(2)}`}
                          </p>
                        </div>
                      </div>
                      
                      <button 
                        disabled={!isComplete}
                        onClick={async () => {
                          const missingReasons = itemsWithVariance.filter(i => !varianceReasons[i._id]);
                          if (missingReasons.length > 0) return ui.alert("Please assign a reason for all items with variances before submitting.");
                          const ok = await ui.confirm({
                            title: 'Lock end of day?',
                            message: `Items with variance: ${itemsWithVariance.length}\nTotal financial impact: ${netImpact < 0 ? '-' : ''}₱${Math.abs(netImpact).toFixed(2)}`,
                            detail: 'This will update your permanent system stock to match your physical counts.',
                            confirmLabel: 'Lock EOD',
                            tone: 'danger',
                          });
                          if (ok) submitPhysicalCounts();
                        }}
                        className={`px-8 py-3 rounded font-black uppercase tracking-wider text-xs shadow-lg transition
                          ${!isComplete ? 'bg-white/10 text-gray-500 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-500 shadow-red-500/20'}`}
                      >
                        {isComplete ? 'Submit & Lock EOD' : 'Incomplete Audit'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          {invSubTab === 'live' && (<>
          {/* ALERTS ROW — full width, only shown when items exist */}
          {(() => {
            const lowItems = inventory.filter(i => { const t = i.effectiveThreshold != null ? i.effectiveThreshold : (i.lowStockThreshold || 0); return t > 0 && i.stockQty <= t; });
            const today = new Date(); today.setHours(0,0,0,0);
            const watch = inventory.filter(i => i.expiryDate && i.stockQty > 0).map(i => ({ ...i, _days: Math.ceil((new Date(i.expiryDate) - today) / 86400000) })).filter(i => i._days <= 30).sort((a, b) => a._days - b._days);
            if (lowItems.length === 0 && watch.length === 0) return null;
            return (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {lowItems.length > 0 && (
                  <div className="bg-red-900/5 border border-red-500/30 rounded-xl p-4">
                    <h4 className="text-red-400 font-black uppercase tracking-wider text-xs mb-2 flex items-center gap-1.5"><AlertTriangle size={13} /> Low Stock Alerts</h4>
                    <div className="space-y-1">
                      {lowItems.map(i => {
                        const d = itemDisplay(i);
                        const mult = effectiveDisplay(i).mult;
                        const eff = i.effectiveThreshold != null ? i.effectiveThreshold : (i.lowStockThreshold || 0);
                        const minDisp = (eff / mult).toLocaleString(undefined, { maximumFractionDigits: 3 });
                        return (
                          <div key={i._id} className="flex justify-between text-xs">
                            <span className="text-red-300 font-bold">{i.itemName}</span>
                            <span className="text-red-400 font-mono tabular-nums">{d.packQty.toLocaleString(undefined, { maximumFractionDigits: 3 })} {d.isPacked ? 'pcs' : d.unit} (min: {minDisp})</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {watch.length > 0 && (
                  <div className="bg-orange-900/5 border border-orange-500/30 rounded-xl p-4 space-y-2">
                    <h4 className="text-orange-300 font-black uppercase tracking-wider text-xs flex items-center gap-1.5">
                      <Clock size={13} /> Expiry Watch
                      <span className="ml-auto text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded">{watch.length}</span>
                    </h4>
                    {watch.filter(i => i._days < 0).length > 0 && <p className="text-[10px] text-red-300 font-black uppercase tracking-wider">{watch.filter(i => i._days < 0).length} Expired - log spoilage</p>}
                    <div className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
                      {watch.map(i => {
                        const txt = i._days < 0 ? `${Math.abs(i._days)}d ago` : i._days === 0 ? 'today' : `in ${i._days}d`;
                        const color = i._days < 0 ? 'text-red-300' : i._days <= (i.expiryWarnDays || 7) ? 'text-yellow-300' : 'text-orange-300/80';
                        const d = itemDisplay(i);
                        return (
                          <div key={i._id} className="flex justify-between text-xs items-center">
                            <span className={`font-bold ${color}`}>{i.itemName}</span>
                            <span className={`tabular-nums ${color}`}>{d.packQty.toLocaleString(undefined, { maximumFractionDigits: 3 })} {d.isPacked ? 'pcs' : d.unit} · <span className="font-black">{txt}</span></span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* RECEIVE INVENTORY — full width, bento grid inside */}
          <div className="bg-surface border border-white/10 rounded-2xl overflow-hidden">

            {/* Header */}
            <div className="border-b border-white/8 px-4 py-3 flex items-center gap-2">
              <Package size={14} className="text-accent flex-shrink-0" />
              <h3 className="font-black text-fg tracking-widest text-xs uppercase">Receive Inventory</h3>
            </div>

            <div className="p-3">
              {/* ── BENTO GRID ── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-2">

                {/* ══ TILE 1 · ITEM ══ */}
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-[3px] h-4 rounded-full bg-accent" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-fg/40">Item</span>
                  </div>

                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">Item Name</label>
                    <input
                      type="text"
                      list="inventory-names"
                      placeholder="e.g., Condensed Milk"
                      value={invForm.itemName}
                      onChange={e => {
                        const typed = e.target.value.toUpperCase();
                        const match = inventory.find(i => i.itemName.toLowerCase() === typed.toLowerCase());
                        setInvForm({...invForm, itemName: typed, unit: match ? match.unit : invForm.unit});
                      }}
                      className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm uppercase outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/15 transition placeholder:text-fg/15"
                    />
                    <datalist id="inventory-names">
                      {inventory.map(inv => <option key={inv._id} value={inv.itemName} />)}
                    </datalist>
                    {inventory.some(i => i.itemName.toLowerCase() === invForm.itemName.toLowerCase().trim()) && (
                      <div className="mt-1.5 flex items-center gap-1.5 bg-accent/10 border border-accent/20 rounded-md px-2 py-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
                        <p className="text-[10px] text-accent font-black uppercase tracking-wide">Restock — existing item</p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    <div className="col-span-2">
                      <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">Qty</label>
                      <input type="number" placeholder="0" value={invForm.packQty} onChange={e => setInvForm({...invForm, packQty: e.target.value})} className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/15 transition placeholder:text-fg/15" />
                    </div>
                    <div className="col-span-3">
                      <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">Unit</label>
                      <select value={invForm.unit} onChange={e => setInvForm({...invForm, unit: e.target.value})} className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm outline-none focus:border-accent/50 transition">
                        <option value="" disabled>Select…</option>
                        <option value="L">Liters (L)</option>
                        <option value="kg">Kilograms (kg)</option>
                        <option value="pcs">Pieces (pcs)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">
                      Per-Pack Size <span className="text-fg/25 normal-case font-normal">· {invForm.unit || 'unit'}/pack</span>
                    </label>
                    <input type="number" placeholder="e.g., 1" value={invForm.unitPerPack} onChange={e => setInvForm({...invForm, unitPerPack: e.target.value})} className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/15 transition placeholder:text-fg/15" />
                    <p className="text-[9px] text-fg/25 mt-1">{BUSINESS_TYPE === 'log' ? 'Appended to item name, e.g. "Milk 1L".' : 'How much one pack holds in the selected unit.'}</p>
                  </div>
                </div>

                {/* ══ TILE 2 · PRICING ══ */}
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-[3px] h-4 rounded-full bg-yellow-400/70" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-fg/40">Pricing</span>
                  </div>
                  {(() => {
                    const totalPurchaseCost = (parseFloat(invForm.packQty) || 0) * (parseFloat(invForm.costPerPack) || 0);
                    const isOverBudget = cashOnHand < totalPurchaseCost;
                    return (
                      <>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${isOverBudget ? 'text-red-400' : 'text-fg/40'}`}>Price / Pack (₱)</label>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums ${isOverBudget ? 'bg-red-500/15 text-red-400 animate-pulse' : 'bg-green-500/10 text-green-400'}`}>
                              Cash ₱{cashOnHand.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <input
                            type="number"
                            placeholder="e.g., 45.00"
                            value={invForm.costPerPack}
                            onChange={e => setInvForm({...invForm, costPerPack: e.target.value})}
                            className={`w-full bg-page-bg border rounded-lg px-3 py-2.5 text-sm outline-none transition-all ${isOverBudget ? 'border-red-500/50 text-red-400 focus:border-red-400 shadow-[0_0_10px_rgba(239,68,68,0.12)]' : 'border-white/10 text-fg focus:border-accent/50 focus:ring-1 focus:ring-accent/15'}`}
                          />
                          {(() => {
                            const existingItem = inventory.find(i => i.itemName.toLowerCase() === invForm.itemName.toLowerCase().trim());
                            if (!existingItem || !invForm.costPerPack) return null;
                            const pack = packInfo(existingItem);
                            const packBase = pack.packBase || 1;
                            const oldCostPerPack = (existingItem.unitCost || 0) * packBase;
                            const newCostPerPack = parseFloat(invForm.costPerPack);
                            if (!oldCostPerPack && !newCostPerPack) return null;
                            const isUp = newCostPerPack > oldCostPerPack;
                            const isSame = Math.abs(newCostPerPack - oldCostPerPack) < 0.005;
                            const addedStockBase = (parseFloat(invForm.packQty) || 0) * packBase;
                            const addedCost = (parseFloat(invForm.packQty) || 0) * newCostPerPack;
                            const wacBase = (existingItem.stockQty + addedStockBase) > 0 ? (existingItem.stockQty * existingItem.unitCost + addedCost) / (existingItem.stockQty + addedStockBase) : 0;
                            const wacPerPack = wacBase * packBase;
                            return (
                              <div className={`mt-2 rounded-lg px-3 py-2 text-[10px] font-bold flex flex-col gap-1 ${isSame ? 'bg-white/5 border border-white/8' : isUp ? 'bg-red-500/8 border border-red-500/15' : 'bg-green-500/8 border border-green-500/15'}`}>
                                <div className="flex justify-between text-fg/50"><span>Prev cost/pack</span><span className="font-mono">₱{oldCostPerPack.toFixed(2)}</span></div>
                                {!isSame && <div className="flex justify-between"><span className={isUp ? 'text-red-400' : 'text-green-400'}>{isUp ? '▲ Up' : '▼ Down'}</span><span className={`font-mono ${isUp ? 'text-red-400' : 'text-green-400'}`}>{isUp ? '+' : ''}{(newCostPerPack - oldCostPerPack).toFixed(2)}</span></div>}
                                {invForm.packQty && <div className="flex justify-between border-t border-white/8 pt-1 mt-0.5 text-accent"><span>New WAC/pack</span><span className="font-mono">₱{wacPerPack.toFixed(2)}</span></div>}
                              </div>
                            );
                          })()}
                        </div>
                        {(invForm.packQty && invForm.unitPerPack && invForm.costPerPack && invForm.unit) && (
                          <div className="bg-accent/8 border border-accent/15 rounded-lg px-4 py-3 space-y-1.5">
                            <p className="text-[9px] font-black uppercase tracking-widest text-accent/50 mb-2">Summary</p>
                            <div className="flex justify-between text-[11px]"><span className="text-fg/50">Stock added</span><span className="font-bold text-fg tabular-nums">{(invForm.packQty * invForm.unitPerPack).toLocaleString()} {invForm.unit}</span></div>
                            <div className="flex justify-between text-[11px]"><span className="text-fg/50">Cost per {invForm.unit}</span><span className="font-bold text-fg tabular-nums">₱{(invForm.costPerPack / invForm.unitPerPack).toFixed(4)}</span></div>
                            <div className="flex justify-between text-[13px] font-black border-t border-accent/15 pt-2 mt-1">
                              <span className="text-fg/60">Total cost</span>
                              <span className={`tabular-nums ${cashOnHand < (invForm.packQty * invForm.costPerPack) ? 'text-red-400' : 'text-accent'}`}>₱{(invForm.packQty * invForm.costPerPack).toFixed(2)}</span>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* ══ TILE 3 · STORAGE & EXPIRY ══ */}
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-[3px] h-4 rounded-full bg-blue-400/70" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-fg/40">Storage & Expiry</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">Location</label>
                      <select value={invForm.stockLocation || ''} onChange={e => setInvForm({ ...invForm, stockLocation: e.target.value })} className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm outline-none focus:border-accent/50 transition">
                        <option value="">None</option>
                        {(stockLocations || []).filter(l => l.isActive !== false).map(l => <option key={l._id} value={l.name}>{l.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">Category</label>
                      <select value={invForm.stockCategory || ''} onChange={e => setInvForm({ ...invForm, stockCategory: e.target.value })} className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm outline-none focus:border-accent/50 transition">
                        <option value="">None</option>
                        {(stockCategories || []).filter(c => c.isActive !== false).map(c => <option key={c._id} value={c.name}>{c.name}{c.prefix ? ` (${c.prefix})` : ''}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">Low Stock Alert <span className="text-fg/25 font-normal normal-case">({invForm.unit || 'unit'})</span></label>
                      <input type="number" min="0" placeholder="0 = off" value={invForm.lowStockThreshold || ''} onChange={e => setInvForm({...invForm, lowStockThreshold: e.target.value})} className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/15 transition placeholder:text-fg/15" />
                    </div>
                    <div>
                      <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">Expiry Date</label>
                      <input type="date" value={invForm.expiryDate || ''} onChange={e => setInvForm({...invForm, expiryDate: e.target.value})} className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm outline-none focus:border-accent/50 transition" />
                    </div>
                  </div>
                  {invForm.expiryDate ? (
                    <div>
                      <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">Warn days before expiry</label>
                      <input type="number" min="1" max="365" value={invForm.expiryWarnDays} onChange={e => setInvForm({...invForm, expiryWarnDays: e.target.value})} className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm outline-none focus:border-accent/50 transition" />
                      <p className="text-[9px] text-fg/25 mt-1">FEFO: oldest expiry consumed first.</p>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">Production Date <span className="text-fg/25 font-normal normal-case">(goods with no real expiry, e.g. beans)</span></label>
                      <input type="date" value={invForm.productionDate || ''} onChange={e => setInvForm({...invForm, productionDate: e.target.value})} className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm outline-none focus:border-accent/50 transition" />
                      <p className="text-[9px] text-fg/25 mt-1">FPFO: oldest produced consumed first.</p>
                    </div>
                  )}
                </div>

                {/* ══ TILE 4 · PAYMENT ══ */}
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-[3px] h-4 rounded-full bg-green-400/70" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-fg/40">Payment</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-fg/40 font-bold uppercase tracking-wider block mb-1">Paid From / Charge To</label>
                    <select
                      value={invForm.creditAccount || ''}
                      onChange={e => setInvForm({...invForm, creditAccount: e.target.value})}
                      className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-fg text-sm outline-none focus:border-accent/50 transition"
                    >
                      <option value="" disabled>Select payment source</option>
                      {(procurementCreditAccounts || []).map(a => (
                        <option key={a.code} value={a.code}>{a.name} ({a.code}){String(a.code).startsWith('220') ? ' · On Credit' : ''}</option>
                      ))}
                    </select>
                    {String(invForm.creditAccount || '').startsWith('220') && (
                      <p className="text-[9px] text-yellow-400/70 mt-1.5 bg-yellow-500/8 border border-yellow-500/15 rounded-md px-2 py-1">
                        Goods on credit — settle later via AP payment.
                      </p>
                    )}
                  </div>
                </div>

              </div>{/* end bento grid */}

              {/* ══ SUBMIT ══ */}
              {(() => {
                const isApAccount = String(invForm.creditAccount || '').startsWith('220');
                const totalCost = (parseFloat(invForm.packQty) || 0) * (parseFloat(invForm.costPerPack) || 0);
                const blocked = !isApAccount && cashOnHand < totalCost;
                return (
                  <button
                    onClick={addInventory}
                    disabled={blocked}
                    className={`w-full font-black py-4 rounded-xl transition-all text-sm tracking-widest uppercase ${blocked ? 'bg-white/5 text-fg/25 cursor-not-allowed border border-white/8' : 'bg-accent text-white hover:brightness-110 active:scale-[0.99] shadow-xl shadow-accent/25'}`}
                  >
                    {blocked ? 'Insufficient Funds' : 'Add to Stock'}
                  </button>
                );
              })()}
            </div>
          </div>
          </>)}
        </div>
  );
}
