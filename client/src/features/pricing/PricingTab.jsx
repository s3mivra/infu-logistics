import React, { useState, useMemo } from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag } from 'lucide-react';

// ── PricingTab — extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
export default function PricingTab({ ctx }) {
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
    editInvSubmitting, editPriceId, editPriceVal, editCostId, setEditCostId, editCostVal, setEditCostVal, editingCategory, editingProduct,
    effectiveDisplay, eodLockedAt, eodStatus, expandedBatchRows, expandedDays,
    expandedOrderLists, expenseCategories, expenseModal, exportAllToPDF, exportAnalyticsToPDF,
    exportDayToPDF, exportInventoryToPDF, exportLedgerToPDF, fetchAnalytics, fetchArOutstanding,
    fetchBalanceSheet, fetchData, fetchEODData, fetchERPData, fetchExpenseCategories,
    fetchOrders, fetchPnl, fetchRfFunds, fetchRfTxs, fetchShiftHistory,
    fetchStockHistory, filteredOrders, formData, getEstimatedStock, globalAddOns,
    groupedArchives, handleImageUpload, handleInlinePriceUpdate, handleInlineCostUpdate, handleRestockSubmit, handleSaveAddOn,
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
    toggleProductAvailability, toggleProductOOS,
    submitRfNew, submitRfRepl, toggleDay, toggleOrderList, toggleVat,
    totalAccountingPages, totalInvPages, totalOrdersPages, totalPages, totalPricingPages,
    updateItemStatus, updateMaterialQty, updateSize, updateStatus, updatingOrders,
    users, varianceNoteMode, varianceReasons,
  } = ctx;

  const [pricingSort, setPricingSort] = useState('az');
  const [pricingCatFilter, setPricingCatFilter] = useState('');
  const [pricingSearch, setPricingSearch] = useState('');
  const [localPage, setLocalPage] = useState(1);

  const categoryOptions = useMemo(() => {
    const seen = new Set();
    (products || []).forEach(p => { if (p.category) seen.add(p.category); });
    return [...seen].sort();
  }, [products]);

  const filteredSortedProducts = useMemo(() => {
    let list = [...(products || [])];
    if (pricingCatFilter) list = list.filter(p => p.category === pricingCatFilter);
    const q = pricingSearch.trim().toLowerCase();
    if (q) list = list.filter(p => (p.name || '').toLowerCase().includes(q));
    if (pricingSort === 'az') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (pricingSort === 'za') list.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    return list;
  }, [products, pricingSort, pricingCatFilter, pricingSearch]);

  const localItemsPerPage = pricingItemsPerPage;
  const localTotalPages = Math.ceil(filteredSortedProducts.length / localItemsPerPage);
  const localProducts = filteredSortedProducts.slice((localPage - 1) * localItemsPerPage, localPage * localItemsPerPage);

  const handleSortChange = (val) => { setPricingSort(val); setLocalPage(1); };
  const handleCatChange = (val) => { setPricingCatFilter(val); setLocalPage(1); };
  const handleSearchChange = (val) => { setPricingSearch(val); setLocalPage(1); };

  return (
        <div className="flex flex-col lg:flex-row gap-6 h-auto lg:h-[calc(100vh-180px)]">

          {/* LEFT COLUMN: Read-Only Pricing Table */}
          <div className="flex-1 bg-surface border border-gray-800 rounded-xl p-6 overflow-y-auto custom-scrollbar min-h-[400px] lg:min-h-0 lg:h-full">
            <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">Product Pricing Masterlist</h3>

            {/* Filter bar */}
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="relative shrink-0">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search product name…"
                  value={pricingSearch}
                  onChange={e => handleSearchChange(e.target.value)}
                  className="bg-page-bg border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white outline-none focus:border-accent w-full sm:w-56"
                />
              </div>
              <div className="flex rounded-lg overflow-hidden border border-gray-700 shrink-0">
                <button onClick={() => handleSortChange('az')} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${pricingSort === 'az' ? 'bg-accent text-white' : 'bg-page-bg text-gray-400 hover:text-white'}`}>A→Z</button>
                <button onClick={() => handleSortChange('za')} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition border-l border-gray-700 ${pricingSort === 'za' ? 'bg-accent text-white' : 'bg-page-bg text-gray-400 hover:text-white'}`}>Z→A</button>
              </div>
              <select value={pricingCatFilter} onChange={e => handleCatChange(e.target.value)}
                className="bg-page-bg border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white font-bold outline-none focus:border-accent min-w-[140px]">
                <option value="">All Categories</option>
                {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {pricingCatFilter && (
                <button onClick={() => handleCatChange('')} className="text-xs text-gray-400 hover:text-white px-2">✕ Clear</button>
              )}
            </div>

            {/* Added overflow-x wrapper so it scrolls sideways on small screens instead of breaking the layout */}
            <div className="overflow-x-auto pr-2">
              <table className="w-full text-left text-sm min-w-[700px]">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="pb-3 uppercase tracking-wider text-xs">Product Name</th>
                    <th className="pb-3 uppercase tracking-wider text-xs">Category</th>
                    <th className="pb-3 text-right uppercase tracking-wider text-xs">Size / Option</th>
                    <th className="pb-3 text-right uppercase tracking-wider text-xs">Selling Price</th>
                    <th className="pb-3 text-right uppercase tracking-wider text-xs">Recipe Cost</th>
                    <th className="pb-3 text-right uppercase tracking-wider text-xs">Margin</th>
                    {isSuperAdmin && <th className="pb-3 text-center uppercase tracking-wider text-xs">Removed</th>}
                    {isSuperAdmin && <th className="pb-3 text-center uppercase tracking-wider text-xs">OOS</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredSortedProducts.length === 0 ? (
                    <tr><td colSpan={isSuperAdmin ? 8 : 6} className="py-4 text-center text-gray-500">No products found.</td></tr>
                  ) : localProducts.flatMap(p => {
                    // Recipe cost first; if absent, fall back to the 1:1 logistics cost
                    // (linked inventory unitCost × pack base units from the name).
                    const PACK_RE = /(\d+(?:\.\d+)?)\s*(mg|kg|g|ml|cl|l|pcs|pc|pack|unit)\b/i;
                    const UNIT = { mg: 0.001, g: 1, kg: 1000, ml: 1, cl: 10, l: 1000, pcs: 1, pc: 1, pack: 1, unit: 1 };
                    const linkedCost = (prod) => {
                      const inv = (inventory || []).find(i => i.itemCode === prod.productCode) || (inventory || []).find(i => i.itemName === prod.name);
                      if (!inv) return 0;
                      const m = (prod.name || '').match(PACK_RE);
                      const bf = UNIT[(inv.unit || '').toLowerCase()] || 1;
                      const packBase = m ? parseFloat(m[1]) * ((UNIT[m[2].toLowerCase()] || 1) / bf) : (inv.unitMultiplier || 1);
                      return (inv.unitCost || 0) * packBase;
                    };
                    const baseCostCalc = calcRecipeCost(p.baseRecipe) || linkedCost(p);
                    const baseCost = p.costOverride != null ? p.costOverride : baseCostCalc;
                    // We now track the exact productId and sizeIndex so the backend knows what to update
                    const rows = [{ id: `${p._id}-base`, productId: p._id, sizeIndex: null, name: p.name, cat: p.category, size: p.baseSize || 'Regular', price: p.basePrice || p.price || 0, cost: baseCost, hasOverride: p.costOverride != null, isBase: true, product: p }];
                    if (p.sizes) {
                      p.sizes.forEach((s, idx) => {
                        const szCostCalc = calcRecipeCost(s.recipe?.length ? s.recipe : p.baseRecipe) || baseCostCalc;
                        const szCost = s.costOverride != null ? s.costOverride : szCostCalc;
                        rows.push({ id: `${p._id}-size-${idx}`, productId: p._id, sizeIndex: idx, name: '', cat: '', size: s.name, price: s.price, cost: szCost, hasOverride: s.costOverride != null, isBase: false, product: p });
                      });
                    }
                    return rows;
                  }).map((row) => {
                    // Margin shows even when there's no recipe — cost falls back to 0,
                    // so margin = 100% for items priced without a cost layer (e.g. logistics
                    // 1:1 SKUs whose cost lives on the inventory item, not a recipe).
                    const margin = row.price > 0 ? ((row.price - (row.cost || 0)) / row.price) * 100 : null;
                    const isUnavailable = row.isBase && row.product.isAvailable === false;
                    return (
                    <tr key={row.id} className={`border-gray-800/50 hover:bg-page-bg/30 transition ${row.name !== '' ? 'border-t' : ''} ${isUnavailable ? 'opacity-50' : ''}`}>
                      <td className={`py-2 font-bold ${row.name !== '' ? 'text-gray-200 pt-4' : ''}`}>
                        {row.name}
                        {isUnavailable && <span className="ml-2 text-[9px] bg-red-900/60 text-red-400 border border-red-700/40 rounded px-1 py-0.5 font-black uppercase tracking-wider">Removed</span>}
                        {row.isBase && row.product.isOutOfStock && <span className="ml-2 text-[9px] bg-amber-900/60 text-amber-400 border border-amber-700/40 rounded px-1 py-0.5 font-black uppercase tracking-wider">OOS</span>}
                      </td>
                      <td className={`py-2 text-xs text-gray-500 ${row.name !== '' ? 'pt-4' : ''}`}>{row.cat}</td>
                      <td className={`py-2 text-right text-gray-400 ${row.name !== '' ? 'pt-4' : ''}`}>{row.size}</td>

                      {/* --- INLINE EDITING UI --- */}
                      <td className={`py-2 text-right font-mono font-bold text-accent ${row.name !== '' ? 'pt-4' : ''}`}>
                        {editPriceId === row.id ? (
                          <div className="flex justify-end items-center gap-2">
                            <input
                              type="number"
                              step="0.01"
                              className="w-20 bg-page-bg border border-accent rounded px-2 py-1 text-white outline-none text-right"
                              value={editPriceVal}
                              onChange={(e) => setEditPriceVal(e.target.value)}
                              autoFocus
                              onKeyDown={(e) => { if (e.key === 'Enter') handleInlinePriceUpdate(row.productId, row.sizeIndex); }}
                            />
                            <button onClick={() => handleInlinePriceUpdate(row.productId, row.sizeIndex)} className="text-green-400 hover:text-green-300 flex items-center"><Check size={14} /></button>
                            <button onClick={() => setEditPriceId(null)} className="text-red-400 hover:text-red-300">✕</button>
                          </div>
                        ) : (
                          <div
                            className="cursor-pointer hover:bg-white/10 px-2 py-1 rounded inline-flex items-center gap-2 transition group"
                            onClick={() => { setEditPriceId(row.id); setEditPriceVal(row.price); }}
                          >
                            P{Number(row.price).toFixed(2)}
                            <span className="text-[10px] text-gray-500 group-hover:text-accent">✎</span>
                          </div>
                        )}
                      </td>

                      {/* Recipe Cost - inline editable */}
                      <td className={`py-2 text-right font-mono text-xs ${row.name !== '' ? 'pt-4' : ''}`}>
                        {editCostId === row.id ? (
                          <div className="flex justify-end items-center gap-1">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              className="w-20 bg-page-bg border border-orange-500/60 rounded px-2 py-1 text-white outline-none text-right text-xs"
                              value={editCostVal}
                              onChange={(e) => setEditCostVal(e.target.value)}
                              autoFocus
                              onKeyDown={(e) => { if (e.key === 'Enter') handleInlineCostUpdate(row.productId, row.sizeIndex); if (e.key === 'Escape') setEditCostId(null); }}
                            />
                            <button onClick={() => handleInlineCostUpdate(row.productId, row.sizeIndex)} className="text-green-400 hover:text-green-300"><Check size={12} /></button>
                            <button onClick={() => setEditCostId(null)} className="text-red-400 hover:text-red-300 text-[10px]">✕</button>
                          </div>
                        ) : (
                          <div
                            className="cursor-pointer hover:bg-white/10 px-2 py-1 rounded inline-flex items-center gap-1.5 transition group"
                            onClick={() => { setEditCostId(row.id); setEditCostVal(row.cost > 0 ? row.cost.toFixed(2) : ''); }}
                          >
                            {row.cost > 0 ? (
                              <span className={row.hasOverride ? 'text-yellow-400' : 'text-orange-400'}>
                                ₱{row.cost.toFixed(2)}
                                {row.hasOverride && <span className="ml-1 text-[9px] text-yellow-600 font-bold">✎</span>}
                              </span>
                            ) : (
                              <span className="text-gray-600 text-[10px]">set cost</span>
                            )}
                            {!row.hasOverride && <span className="text-[10px] text-gray-700 group-hover:text-orange-400">✎</span>}
                          </div>
                        )}
                      </td>

                      {/* Gross Margin */}
                      <td className={`py-2 text-right font-mono text-xs ${row.name !== '' ? 'pt-4' : ''}`}>
                        {margin !== null ? (
                          <span className={`font-bold ${margin >= 60 ? 'text-green-400' : margin >= 35 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {margin.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-gray-700 text-[10px]">-</span>
                        )}
                      </td>

                      {/* Removed toggle (superadmin only, base-product rows only). Permanently hides from menu - reports keep showing it while stock remains. */}
                      {isSuperAdmin && (
                        <td className={`py-2 text-center ${row.name !== '' ? 'pt-4' : ''}`}>
                          {row.isBase ? (
                            <button
                              onClick={() => toggleProductAvailability(row.product)}
                              title={isUnavailable ? 'Click to restore (un-remove)' : 'Click to REMOVE from menu (kept in reporting until stock is zero)'}
                              className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition border ${
                                isUnavailable
                                  ? 'bg-red-900/50 text-red-400 border-red-700/40 hover:bg-green-900/50 hover:text-green-400 hover:border-green-700/40'
                                  : 'bg-transparent text-gray-600 border-gray-700 hover:bg-red-900/40 hover:text-red-400 hover:border-red-700/40'
                              }`}
                            >
                              {isUnavailable ? 'REMOVED' : 'LIVE'}
                            </button>
                          ) : <span />}
                        </td>
                      )}
                      {/* OOS toggle. Stays on menu (with a badge) and in all reports - for temporary stockouts. */}
                      {isSuperAdmin && (
                        <td className={`py-2 text-center ${row.name !== '' ? 'pt-4' : ''}`}>
                          {row.isBase ? (
                            <button
                              onClick={() => toggleProductOOS && toggleProductOOS(row.product)}
                              title={row.product.isOutOfStock ? 'Click to mark back in stock' : 'Click to mark OUT OF STOCK (still on menu, badged)'}
                              className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition border ${
                                row.product.isOutOfStock
                                  ? 'bg-amber-900/50 text-amber-400 border-amber-700/40 hover:bg-emerald-900/50 hover:text-emerald-400 hover:border-emerald-700/40'
                                  : 'bg-transparent text-gray-600 border-gray-700 hover:bg-amber-900/40 hover:text-amber-400 hover:border-amber-700/40'
                              }`}
                            >
                              {row.product.isOutOfStock ? 'OOS' : 'OK'}
                            </button>
                          ) : <span />}
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* --- PRICING PAGINATION CONTROLS --- */}
            {localTotalPages > 1 && (
              <div className="flex justify-between items-center bg-page-bg p-3 rounded-lg border border-gray-800 mt-4 shrink-0">
                <button
                  onClick={() => setLocalPage(prev => Math.max(prev - 1, 1))}
                  disabled={localPage === 1}
                  className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${localPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                </button>
                <span className="text-gray-400 text-xs font-bold tracking-widest">
                  PAGE <span className="text-accent text-sm">{localPage}</span> OF {localTotalPages}
                </span>
                <button
                  onClick={() => setLocalPage(prev => Math.min(prev + 1, localTotalPages))}
                  disabled={localPage === localTotalPages}
                  className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${localPage === localTotalPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                </button>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Discount CRUD */}
          {/* Changed width breaks to lg:w-80 so it perfectly fits beside the table on tablets */}
          <div className="w-full lg:w-80 xl:w-96 bg-surface border border-gray-800 rounded-xl p-6 min-h-[400px] lg:min-h-0 lg:h-full overflow-y-auto custom-scrollbar flex flex-col">
            <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">Discount Rules</h3>
            
            <div className="flex-1 overflow-y-auto mb-6 pr-2 scrollbar-thin scrollbar-thumb-gray-700">
              <div className="space-y-3">
                {discounts.length === 0 ? (
                  <p className="text-sm text-gray-500 italic text-center py-4">No custom discounts set.</p>
                ) : discounts.map(d => (
                  <div key={d._id} className="bg-page-bg p-3 rounded-lg border border-gray-700 flex justify-between items-center">
                    <div>
                      {/* Fixed black text bug here! */}
                      <p className="font-bold text-accent text-sm">{d.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{d.percentage}% OFF</p>
                    </div>
                    <button 
                      onClick={async () => {
                        if (window.confirm(`Delete ${d.name} discount?`)) {
                          await apiFetch(`/api/discounts/${d._id}`, { method: 'DELETE' });
                          fetchData(); // Refresh the list
                        }
                      }} 
                      className="text-red-500 hover:text-red-400 font-bold px-2 py-1 bg-red-900/20 rounded transition"
                    >
                      Del
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-800 pt-4 mt-auto shrink-0">
              <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-3">Add New Discount</h4>
              <form 
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!discountForm.name || !discountForm.percentage) return;
                  await apiFetch(`/api/discounts`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: discountForm.name, percentage: Number(discountForm.percentage) })
                  });
                  setDiscountForm({ name: '', percentage: '' });
                  fetchData(); // Refresh the list
                }} 
                className="space-y-3"
              >
                <div>
                  <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 block">Discount Name</label>
                  <input type="text" placeholder="e.g., PWD, Senior Citizen" value={discountForm.name} onChange={(e) => setDiscountForm({...discountForm, name: e.target.value})} className="w-full bg-page-bg border border-gray-700 rounded p-2 text-sm text-white outline-none focus:border-accent" required />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 block">Percentage (%)</label>
                  <input type="number" placeholder="e.g., 20" max="100" min="1" value={discountForm.percentage} onChange={(e) => setDiscountForm({...discountForm, percentage: e.target.value})} className="w-full bg-page-bg border border-gray-700 rounded p-2 text-sm text-white outline-none focus:border-accent" required />
                </div>
                <button type="submit" className="w-full bg-accent text-white font-black py-3 rounded hover:bg-brand-dark transition shadow-lg shadow-accent/20 uppercase tracking-wider text-xs">
                  Save Rule
                </button>
              </form>
            </div>
          </div>
        </div>
  );
}
