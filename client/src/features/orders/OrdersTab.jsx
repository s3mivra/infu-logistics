import React from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag, Footprints, Utensils, ShoppingBag, Bike, Car, UserX, UserCheck, Flame } from 'lucide-react';
import * as ui from '../../shared/ui';

// Icon-based replacement for a native <select> - browsers can't render custom
// icons inside native <option> popups, so this is a real dropdown (button +
// floating panel) instead.
function IconSelect({ value, onChange, options, className = '' }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find(o => o.value === value) || options[0];
  return (
    <div className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg/80 font-bold text-sm outline-none focus:border-brand/60 transition">
        {selected?.Icon && <selected.Icon size={16} className="text-brand shrink-0" />}
        <span className="flex-1 text-left truncate">{selected?.label}</span>
        <ChevronDown size={14} className={`text-fg/40 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full bg-surface border border-white/10 rounded-xl overflow-hidden shadow-xl py-1 max-h-64 overflow-y-auto">
            {options.map(o => (
              <button key={o.value} type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-left transition ${o.value === value ? 'bg-brand text-white' : 'text-fg/80 hover:bg-white/10'}`}>
                <o.Icon size={16} className={o.value === value ? 'text-fg' : 'text-fg/50'} />
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();
// Logistics dispatches to the storage/logistics team; food & bev sends to the kitchen.
const SEND_TARGET = BUSINESS_TYPE === 'log' ? 'Logistics' : 'Kitchen';

// ── OrdersTab - extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
export default function OrdersTab({ ctx }) {
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
    fetchBalanceSheet, fetchData, fetchEODData, fetchERPData, fetchExpenseCategories,
    fetchOrders, fetchPnl, fetchRfFunds, fetchRfTxs, fetchShiftHistory,
    fetchStockHistory, filteredOrders, formData, getEstimatedStock, globalAddOns,
    groupedArchives, handleImageUpload, handleInlinePriceUpdate, handleRestockSubmit, handleSaveAddOn,
    handleSaveCategory, handleSaveProduct, handleVoidOrder, historyItemName, historyModalOpen,
    historyPage, historySubTab, importModal, importRows, importSubmitting,
    invBadgeCount, invForm, invItemsPerPage, invPage, invSubTab,
    inventory, isPosOpen, isStatusMenuOpen, isSuperAdmin, canVoidRefund, itemDisplay,
    itemsPerPage, jeForm, journalEntries, ledgerSubTab, navMode,
    newDiscount, openEditInventory, openProductModal, orderFilter, orders,
    ordersItemsPerPage, ordersPage, parseImportFile, paymentSelections, peso,
    physicalCounts, pnlData, pnlRange, posActiveAddOns, posActiveSize, posItemQty, setPosItemQty,
    posCart, posCashTendered, posCategory, posCheckoutModal, posCustomerName,
    posClientId, setPosClientId, posBuyerDiscounts, clientAccounts, coaAccounts,
    posReserveOnly, setPosReserveOnly,
    posCustomerPhone, posDeliveryAddress, posDeliveryFee, posDeliveryFeeNum, posDiscountAmt,
    posDiscountType, posDiscountValue, posItemDiscountAmt, posGrandTotal, posSubmitting, posPage, posPayment,
    posScheduledTime, posSearch, posSelectedProduct, posSubtotal, posTable, saleThresholds,
    pricingItemsPerPage, pricingPage, printOrderSlip, printBillingStatement, printDeliveryReceipt, printXReading, products,
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
    setNewDiscount, setOrderFilter, setOrderSearch, orderSearch, setOrdersPage, setPaymentSelections, setPhysicalCounts,
    posNotes, setPosNotes, posGuestCount, setPosGuestCount,
    posPayments, setPosPayments,
    modifierGroups, printKitchenTicket,
    refundModal, setRefundModal, handleRefund, openPartial, dropRemaining,
    combos, addComboToPosCart,
    parkedOrders, parkedModalOpen, setParkedModalOpen, fetchParked, parkCurrentOrder, resumeParked,
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
    systemSettings = {},
  } = ctx;

  // The POS VAT row follows the business's registration in Settings. A non-VAT
  // business has no VAT line to show at all - printing "VAT (0%)" on screen just
  // invites someone to try switching it on here, which is not where that lives.
  const vatOn = systemSettings.vatEnabled === true;

  // UI-only hint for the walk-in picker below - not persisted; the real
  // guest-vs-regular classification comes from whether a customer name is entered.
  const [walkInMode, setWalkInMode] = React.useState('guest');
  // Payment-QR display (set in Settings > Branding). Shown full-screen for the
  // customer to scan; they/staff dismiss it once paid.
  const [payQrOpen, setPayQrOpen] = React.useState(false);
  const payQrImage = systemSettings.paymentQrImage || '';

  return (
          <div className="w-full">
            {isPosOpen ? (
              /* ========================================== */
              /* 🛒 INLINE MANUAL CASHIER POS 🛒            */
              /* ========================================== */
              <div className="flex flex-col lg:flex-row gap-4 h-auto lg:h-[calc(100vh-172px)] w-full animate-fade-in">

                {/* LEFT COLUMN: Product Browser */}
                <div className="flex-1 flex flex-col min-h-[520px] lg:min-h-0 bg-surface border border-white/10 rounded-2xl overflow-hidden shadow-xl">

                  {/* Header */}
                  <div className="px-4 py-3 border-b border-white/10 bg-page-bg/60 shrink-0 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <ShoppingCart size={18} className="text-brand" />
                      <span className="font-black text-fg tracking-widest uppercase text-sm">POS Register</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {payQrImage && (
                        <button onClick={() => setPayQrOpen(true)} title="Show the payment QR for the customer to scan" className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand/15 text-brand hover:bg-brand/25 font-bold text-xs uppercase tracking-wider transition min-h-[40px]">
                          <QrCode size={13} /> Pay QR
                        </button>
                      )}
                      <button onClick={() => setIsPosOpen(false)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-fg/40 hover:text-red-400 font-bold text-xs uppercase tracking-wider transition min-h-[40px]">
                        <ChevronLeft size={13} /> Orders
                      </button>
                    </div>
                  </div>

                  {/* Search + Category pills */}
                  <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/30" />
                      <input
                        type="text"
                        placeholder="Search menu items…"
                        value={posSearch}
                        onChange={e => { setPosSearch(e.target.value); setPosPage(1); }}
                        className="w-full bg-page-bg border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-fg text-sm font-medium placeholder-white/25 outline-none focus:border-brand/60 transition"
                      />
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                      {/* A category with nothing sellable in it (e.g. raw materials
                          only - no SRP) never gets its own pill, same rule as the
                          product grid below - there'd be nothing to show anyway. */}
                      {[{ _id: '__all', name: 'All' }, ...(products.some(p => p.isBulk) ? [{ _id: '__bulk', name: 'Bulk' }] : []), ...categories.filter(c => products.some(p => p.category === c.name && p.isAvailable !== false && (p.basePrice || 0) > 0))].map(c => (
                        <button
                          key={c._id}
                          onClick={() => { setPosCategory(c.name === 'All' ? 'All' : c.name); setPosPage(1); }}
                          className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap text-xs uppercase tracking-wider transition min-h-[40px] shrink-0 ${posCategory === (c.name === 'All' ? 'All' : c.name) ? 'bg-brand text-white shadow-md' : 'bg-white/5 text-fg/50 hover:text-fg hover:bg-white/10'}`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Product grid */}
                  {(() => {
                    const posFiltered = products.filter(p =>
                      p.isAvailable !== false &&
                      (p.basePrice || 0) > 0 && // raw material, no SRP - not sellable
                      (posCategory === 'All' || (posCategory === 'Bulk' ? p.isBulk : p.category === posCategory)) &&
                      (!posSearch || p.name.toLowerCase().includes(posSearch.toLowerCase()))
                    );
                    const posTotalPages = Math.ceil(posFiltered.length / POS_PER_PAGE);
                    const posPaged = posFiltered.slice((posPage - 1) * POS_PER_PAGE, posPage * POS_PER_PAGE);
                    const activeCombos = (combos || []).filter(c => c.isActive !== false);
                    return (
                      <div className="flex-1 flex flex-col min-h-0">
                        {/* Combo / Promo strip */}
                        {activeCombos.length > 0 && (posCategory === 'All' || posCategory === 'Combos') && (
                          <div className="px-3 pt-1 pb-2 shrink-0">
                            <p className="text-[10px] font-black uppercase tracking-widest text-brand/70 mb-1.5">Combos &amp; Promos</p>
                            <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                              {activeCombos.map(c => (
                                <button key={c._id} onClick={() => addComboToPosCart(c)}
                                  className="shrink-0 w-28 bg-brand/10 border border-brand/30 rounded-xl p-2.5 text-left hover:bg-brand/20 active-press transition">
                                  <p className="text-[11px] font-black text-fg leading-tight line-clamp-2">{c.name}</p>
                                  <p className="text-brand font-black text-sm mt-1 tabular-nums">₱{Number(c.price).toFixed(2)}</p>
                                  <p className="text-[8px] text-fg/40 uppercase tracking-wide mt-0.5">{(c.items||[]).length} items</p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="flex-1 overflow-y-auto px-3 pb-3 grid grid-cols-3 sm:grid-cols-3 xl:grid-cols-4 gap-3 content-start custom-scrollbar">
                          {posPaged.length === 0 && (
                            <div className="col-span-full flex flex-col items-center justify-center py-16 text-fg/20">
                              <ShoppingCart size={32} className="mb-3 opacity-30" />
                              <p className="font-bold text-sm uppercase tracking-widest">No items found</p>
                            </div>
                          )}
                          {posPaged.map(p => {
                            const is86      = p.isAvailable === false;
                            const outOfStock = p.stockAvailable === false;
                            const unavailable = is86 || outOfStock;
                            return (
                            <button
                              key={p._id}
                              onClick={() => { if (!unavailable) openProductModal(p); }}
                              aria-label={`${p.name} - ₱${Number(p.basePrice || p.price || 0).toFixed(2)}${unavailable ? ' (unavailable)' : ''}`}
                              className={`relative bg-page-bg/60 border rounded-2xl p-3 flex flex-col items-center text-center shadow-elev-1 group min-h-[120px] transition-colors duration-180
                                ${unavailable
                                  ? 'border-white/5 opacity-50 cursor-not-allowed'
                                  : 'border-white/10 hover:border-brand/60 hover:bg-brand/5 active-press hover:shadow-elev-2 focus-visible:border-brand cursor-pointer'
                                }`}
                            >
                              {unavailable && (
                                <span className="absolute top-1.5 right-1.5 z-10 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-lg
                                  bg-red-600 text-white">
                                  {is86 ? '86' : 'Out'}
                                </span>
                              )}
                              {!unavailable && p.activeSalePrice != null && (
                                <span className="absolute top-1.5 left-1.5 z-10 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-lg bg-orange-500 text-white">SALE</span>
                              )}
                              {p.image && systemSettings.imagesEnabled !== false ? (
                                <img src={p.image} alt="" loading="lazy" decoding="async" className="w-14 h-14 object-contain rounded-xl mb-2 group-hover:scale-105 transition-transform duration-240" style={{ filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.45))' }} />
                              ) : (
                                <div className="w-14 h-14 rounded-xl mb-2 flex items-center justify-center shrink-0"
                                  style={{ background: `hsl(${(p.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 55%, 28%)` }}
                                  aria-hidden="true">
                                  <span className="text-xl font-black text-white/80 select-none leading-none">
                                    {(p.name || '?')[0].toUpperCase()}
                                  </span>
                                </div>
                              )}
                              <span className="font-bold text-xs text-fg/80 line-clamp-2 leading-tight w-full">{p.name}</span>
                              {p.activeSalePrice != null ? (
                                <div className="mt-auto pt-1 flex flex-col items-center gap-0.5">
                                  <span className="text-orange-400 font-black text-sm tabular-nums">₱{Number(p.activeSalePrice).toFixed(2)}</span>
                                  <span className="text-fg/30 font-bold text-[10px] tabular-nums line-through">₱{Number(p.basePrice || 0).toFixed(2)}</span>
                                </div>
                              ) : (
                                <span className="text-brand font-black mt-auto pt-1 text-sm tabular-nums">₱{Number(p.basePrice || p.price || 0).toFixed(2)}</span>
                              )}
                            </button>
                            );
                          })}
                        </div>
                        {posTotalPages > 1 && (
                          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t white/10 bg-page-bg/40">
                            <button onClick={() => setPosPage(p => Math.max(1, p - 1))} disabled={posPage === 1}
                              className="px-4 py-2 rounded-xl font-bold text-xs uppercase bg-white/5 text-fg/50 hover:text-fg hover:bg-white/10 disabled:opacity-25 transition flex items-center gap-1 min-h-[40px]">
                              <ChevronLeft size={13}/> Prev
                            </button>
                            <span className="text-xs text-fg/30 font-bold">{posPage} / {posTotalPages}</span>
                            <button onClick={() => setPosPage(p => Math.min(posTotalPages, p + 1))} disabled={posPage === posTotalPages}
                              className="px-4 py-2 rounded-xl font-bold text-xs uppercase bg-white/5 text-fg/50 hover:text-fg hover:bg-white/10 disabled:opacity-25 transition flex items-center gap-1 min-h-[40px]">
                              Next <ChevronRight size={13}/>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* RIGHT COLUMN: Cart Dock */}
                <div className="w-full lg:w-[380px] flex flex-col shrink-0 h-[560px] lg:h-full bg-surface border border-white/10 rounded-2xl overflow-hidden shadow-xl min-h-0">

                  {/* Customer info */}
                  <div className="px-4 pt-4 pb-3 border-b border-white/10 bg-page-bg/60 shrink-0 space-y-2">
                    {/* Client account picker - when set, server applies that client's per-product discount overrides.
                       "Guest"/"Regular" walk-in are UI hints only, not stored state - the actual
                       guest-vs-regular classification is driven by whether a customer name is
                       entered (see the name field below); a regular walk-in who racks up 3
                       Completed orders gets auto-promoted to their own CUS-1000-Axxxx client code. */}
                    <IconSelect
                      value={posClientId ? posClientId : (walkInMode === 'regular' ? '__regular__' : '')}
                      onChange={id => {
                        if (id === '__regular__') {
                          setWalkInMode('regular');
                          setPosClientId('');
                        } else if (!id) {
                          setWalkInMode('guest');
                          setPosClientId('');
                          setPosCustomerName('');
                        } else {
                          setWalkInMode('guest');
                          setPosClientId(id);
                          // Auto-fill the customer name from the chosen client (admin can still edit).
                          const c = clientAccounts.find(a => String(a._id) === id);
                          if (c && !posCustomerName) setPosCustomerName(c.name || c.username || '');
                        }
                      }}
                      options={[
                        { value: '', label: 'Guest Walk-In', Icon: UserX },
                        { value: '__regular__', label: 'Regular Walk-In', Icon: UserCheck },
                        ...(clientAccounts || []).map(c => ({ value: String(c._id), label: `${c.name || c.username} (${c.clientCode})`, Icon: Users })),
                      ]}
                    />
                    {/* Live pricing preview for the selected client - resolved via the
                        SAME server logic checkout uses, so this is the real price, not
                        a guess. Empty once the picker fetch lands = this client has no
                        discount on anything currently in view. */}
                    {posClientId && (() => {
                      const pcts = Object.values(posBuyerDiscounts || {});
                      const best = pcts.length ? Math.max(...pcts) : 0;
                      return best > 0 ? (
                        <div className="flex items-center gap-1.5 bg-accent/10 border border-accent/20 rounded-lg px-2.5 py-1.5">
                          <Tag size={11} className="text-accent flex-shrink-0" />
                          <span className="text-[10px] text-accent font-bold">Pricing applied - up to {best}% off for this client</span>
                        </div>
                      ) : null;
                    })()}
                    <input type="text" placeholder="Customer / Driver Name *" value={posCustomerName} onChange={e => setPosCustomerName(e.target.value)}
                      className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold placeholder-white/25 outline-none focus:border-brand/60 text-sm transition" />
                    <IconSelect value={posTable} onChange={setPosTable} options={BUSINESS_TYPE === 'log' ? [
                      { value: 'Walk In', label: 'Walk In', Icon: Footprints },
                      { value: 'Pickup', label: 'Pickup', Icon: Package },
                      { value: 'Manual Delivery', label: 'Manual Delivery', Icon: Bike },
                      { value: 'Grab Delivery', label: 'Grab Delivery', Icon: Car },
                      { value: 'Lalamove', label: 'Lalamove', Icon: Truck },
                    ] : [
                      { value: 'Walk In', label: 'Walk In', Icon: Footprints },
                      { value: 'Dine-In', label: 'Dine-In', Icon: Utensils },
                      { value: 'Takeout', label: 'Takeout', Icon: ShoppingBag },
                      { value: 'Pickup', label: 'Pickup', Icon: Package },
                      { value: 'Manual Delivery', label: 'Manual Delivery', Icon: Bike },
                      { value: 'Grab Delivery', label: 'Grab Delivery', Icon: Car },
                      { value: 'Foodpanda', label: 'Foodpanda', Icon: Smartphone },
                    ]} />
                    {(posTable === 'Manual Delivery' || posTable === 'Pickup' || posTable === 'Lalamove') && (
                      <div className="space-y-2 border border-brand/20 rounded-xl p-2.5 bg-brand/5">
                        <input type="tel" placeholder="Phone Number *" value={posCustomerPhone} onChange={e => setPosCustomerPhone(e.target.value)}
                          className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs font-bold placeholder-white/25 outline-none focus:border-brand/50" />
                        {(posTable === 'Manual Delivery' || posTable === 'Lalamove') && (
                          <input type="text" placeholder="Delivery Address *" value={posDeliveryAddress} onChange={e => setPosDeliveryAddress(e.target.value)}
                            className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs font-bold placeholder-white/25 outline-none focus:border-brand/50" />
                        )}
                        <div className="flex gap-2">
                          <input type="number" min="0" step="0.01" placeholder="Fee (₱)" value={posDeliveryFee} onChange={e => setPosDeliveryFee(e.target.value)}
                            className="w-1/2 bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs font-bold placeholder-white/25 outline-none focus:border-brand/50" />
                          <input type="time" value={posScheduledTime} onChange={e => setPosScheduledTime(e.target.value)}
                            className="w-1/2 bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs font-bold outline-none focus:border-brand/50" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Threshold sale banners */}
                  {(saleThresholds || []).map((rule, i) => {
                    const met = posSubtotal >= rule.thresholdAmount;
                    const remain = rule.thresholdAmount - posSubtotal;
                    return (
                      <div key={i} className={`mx-3 mt-2 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${met ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' : 'bg-white/5 text-fg/40 border border-white/8'}`}>
                        <Flame size={12} className={met ? 'text-orange-400' : 'text-fg/20'} />
                        {met
                          ? <span>🎉 Deal unlocked! <span className="font-black">{rule.productName}</span> gets <span className="font-black">{rule.discountPercent}%</span> off</span>
                          : <span>Spend <span className="font-black">₱{remain.toFixed(2)}</span> more → <span className="font-black">{rule.productName}</span> gets {rule.discountPercent}% off</span>
                        }
                      </div>
                    );
                  })}

                  {/* Cart items */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar min-h-0">
                    {posCart.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center gap-2 text-fg/15">
                        <ShoppingCart size={36} className="opacity-40" />
                        <p className="font-black uppercase tracking-widest text-xs">Cart is Empty</p>
                        <p className="text-[10px] text-fg/10">Tap a menu item to add</p>
                      </div>
                    ) : posCart.map((item, idx) => {
                      const addOnTotal = item.selectedAddOns.reduce((s, a) => s + Number(a.price), 0);
                      const lineBase = (item.price + addOnTotal) * item.quantity;
                      const lineDisc = lineBase * ((item.discountPercent || 0) / 100);
                      const lineTotal = lineBase - lineDisc;
                      return (
                        <div key={idx} className="bg-page-bg/50 p-3 rounded-xl border border-white/10 flex justify-between items-start">
                          <div className="flex-1 pr-2 min-w-0">
                            <p className="font-bold text-fg/90 text-sm truncate leading-tight">{item.name}</p>
                            {item.selectedAddOns.map((a, i) => (
                              <p key={i} className="text-[10px] text-fg/35 truncate">+ {a.name} ₱{a.price}</p>
                            ))}
                            <div className="flex items-center gap-2 mt-2">
                              <button onClick={() => setPosCart(posCart.map((c, i) => i === idx ? {...c, quantity: Math.max(1, c.quantity - 1)} : c))}
                                className="w-8 h-8 bg-white/10 hover:bg-white/15 rounded-lg text-fg font-black flex items-center justify-center transition text-base active:scale-90">−</button>
                              <span className="font-black text-sm text-fg w-6 text-center">{item.quantity}</span>
                              <button onClick={() => setPosCart(posCart.map((c, i) => i === idx ? {...c, quantity: c.quantity + 1} : c))}
                                className="w-8 h-8 bg-white/10 hover:bg-brand/30 rounded-lg text-fg font-black flex items-center justify-center transition text-base active:scale-90">+</button>
                              <div className="relative ml-1">
                                <input
                                  type="number" min="0" max="100" step="1"
                                  placeholder="0"
                                  value={item.discountPercent || ''}
                                  onChange={e => setPosCart(posCart.map((c, i) => i === idx ? {...c, discountPercent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0))} : c))}
                                  className="w-14 bg-white/5 border border-white/10 rounded-lg pl-2 pr-5 py-1 text-fg text-xs font-bold outline-none focus:border-brand/60 placeholder-white/20 tabular-nums"
                                />
                                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg/30 text-[10px] font-bold pointer-events-none">%</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {lineDisc > 0 && <p className="text-[10px] text-green-400 font-bold tabular-nums">-₱{lineDisc.toFixed(2)}</p>}
                            <p className="font-black text-brand text-sm tabular-nums">₱{lineTotal.toFixed(2)}</p>
                            <button onClick={() => setPosCart(posCart.filter((_, i) => i !== idx))}
                              className="w-8 h-8 flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition active:scale-90">
                              <Trash2 size={13}/>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Totals + CTA */}
                  <div className="px-4 pb-4 pt-2 border-t border-white/10 bg-page-bg/60 shrink-0">
                    <div className="space-y-1 mb-3">
                      <div className="flex justify-between text-xs text-fg/40 font-bold">
                        <span>Subtotal</span><span>₱{posSubtotal.toFixed(2)}</span>
                      </div>
                      {posItemDiscountAmt > 0 && (
                        <div className="flex justify-between text-xs text-green-400 font-bold">
                          <span>Item Discounts</span><span>−₱{posItemDiscountAmt.toFixed(2)}</span>
                        </div>
                      )}
                      {posDiscountAmt > 0 && (
                        <div className="flex justify-between text-xs text-green-400 font-bold">
                          <span>Order Discount</span><span>−₱{posDiscountAmt.toFixed(2)}</span>
                        </div>
                      )}
                      {posDeliveryFeeNum > 0 && (
                        <div className="flex justify-between text-xs text-fg/40 font-bold">
                          <span>Delivery Fee</span><span>₱{posDeliveryFeeNum.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-baseline pt-1.5 border-t border-white/10">
                        <span className="text-xs text-fg/50 font-bold uppercase tracking-widest">Total</span>
                        <span className="text-3xl font-black text-fg">₱<span className="tabular-nums">{posGrandTotal.toFixed(2)}</span></span>
                      </div>
                    </div>
                    <p className="text-center text-[9px] text-fg/15 font-black uppercase tracking-[0.2em] mb-2">NON-VAT TRANSACTION</p>
                    {/* Reserve-only: skip payment now. Order is held with status Reserved
                        and the cashier promotes it later (Pending → Preparing). */}
                    <label className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10 transition">
                      <input type="checkbox" checked={!!posReserveOnly} onChange={e => setPosReserveOnly(e.target.checked)}
                        className="w-4 h-4 accent-brand" />
                      <span className="text-[11px] font-bold text-fg/70">Reserve only (pay later)</span>
                      <span className="ml-auto text-[9px] uppercase tracking-widest font-black text-fg/30">Status: {posReserveOnly ? 'Reserved' : 'Pending'}</span>
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={parkCurrentOrder}
                        className="px-4 py-4 bg-white/5 border border-white/10 text-fg/60 font-black rounded-xl uppercase tracking-wider text-xs hover:bg-white/10 hover:text-fg active:scale-98 transition flex items-center justify-center gap-1.5 min-h-[56px]"
                        title="Hold this order as an open tab">
                        <Clock size={16}/> Park
                      </button>
                      <button
                        onClick={submitManualOrder}
                        disabled={posSubmitting}
                        className="flex-1 py-4 bg-brand text-white font-black rounded-xl uppercase tracking-widest text-sm hover:bg-brand/90 active:scale-98 transition shadow-lg shadow-brand/20 flex items-center justify-center gap-2 min-h-[56px] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                      >
                        <ShoppingCart size={18}/>
                        {posSubmitting ? (
                          'Placing…'
                        ) : (() => {
                          const itemCount = posCart.reduce((s, c) => s + (c.quantity || 0), 0);
                          if (itemCount === 0) return 'Cart Empty';
                          const label = itemCount === 1 ? '1 Item' : `${itemCount} Items`;
                          return (<>Place Order · {label} · ₱<span className="tabular-nums">{posGrandTotal.toFixed(2)}</span></>);
                        })()}
                      </button>
                    </div>
                  </div>
                </div>

                {/* OPTIONS MODAL (Still an overlay so it dims the screen) */}
                {posSelectedProduct && (
                  <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-surface p-6 rounded-xl border border-gray-700 max-w-sm w-full shadow-2xl flex flex-col max-h-[90vh]">
                      
                      <div className="shrink-0 mb-4 border-b border-gray-800 pb-4">
                        <h3 className="text-2xl font-black text-fg leading-tight">{posSelectedProduct.name}</h3>
                        <p className="text-xs text-fg uppercase tracking-widest mt-1">Configure Options</p>
                      </div>
                      
                      <div className="overflow-y-auto custom-scrollbar flex-1 pr-2 pb-2">
                        
                        {/* --- SIZES (Now ALWAYS shows, even if only 1 size exists) --- */}
                        <div className="mb-6">
                          <label className="text-xs font-bold text-fg mb-2 block uppercase tracking-wider">Size Selection</label>
                          <div className="grid grid-cols-2 gap-3">
                            {/* FIX: Now correctly displays the Base Price instead of +P0 */}
                            <button onClick={() => setPosActiveSize(null)} className={`py-3 rounded-lg font-bold text-sm border transition ${posActiveSize === null ? 'bg-accent/20 border-accent text-accent' : 'bg-page-bg border-gray-700 text-fg hover:border-gray-500'}`}>
                              {posSelectedProduct.baseSize || 'Regular'} <span className="block text-xs mt-1 opacity-70">₱{Number(posSelectedProduct.basePrice || posSelectedProduct.price || 0).toFixed(2)}</span>
                            </button>
                            {(posSelectedProduct.sizes || []).map((s, idx) => (
                              <button key={idx} onClick={() => setPosActiveSize(idx)} className={`py-3 rounded-lg font-bold text-sm border transition ${posActiveSize === idx ? 'bg-accent/20 border-accent text-accent' : 'bg-page-bg border-gray-700 text-fg hover:border-gray-500'}`}>
                                {s.name} <span className="block text-xs mt-1 opacity-70">₱{Number(s.price).toFixed(2)}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* --- EXTRAS --- */}
                        {(posSelectedProduct.addOns?.length > 0) && (
                          <div>
                            <label className="text-xs font-bold text-gray-400 mb-2 block uppercase tracking-wider">Add Extras</label>
                            <div className="space-y-3">
                              {(posSelectedProduct.addOns || []).map((addon, idx) => {
                                const isSelected = posActiveAddOns.some(a => a.name === addon.name);
                                return (
                                  <label key={idx} className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border transition ${isSelected ? 'bg-accent/10 border-accent/50' : 'bg-page-bg border-gray-700 hover:bg-gray-800'}`}>
                                    <div className="flex items-center gap-3">
                                      <input type="checkbox" checked={isSelected} onChange={(e) => {
                                        if (e.target.checked) setPosActiveAddOns([...posActiveAddOns, { name: addon.name, price: addon.price }]);
                                        else setPosActiveAddOns(posActiveAddOns.filter(a => a.name !== addon.name));
                                      }} className="w-5 h-5 accent-accent rounded" />
                                      <span className={`text-sm font-bold ${isSelected ? 'text-fg' : 'text-fg'}`}>{addon.name}</span>
                                    </div>
                                    <span className="text-xs text-accent font-black">+₱{addon.price}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800 shrink-0">
                        <span className="text-xs font-bold text-fg uppercase tracking-wider">Quantity</span>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setPosItemQty(q => Math.max(1, q - 1))} className="w-9 h-9 rounded-lg bg-page-bg border border-gray-700 text-fg text-lg font-black hover:border-accent hover:text-accent transition flex items-center justify-center">−</button>
                          <span className="w-8 text-center text-fg font-black text-lg">{posItemQty}</span>
                          <button onClick={() => setPosItemQty(q => q + 1)} className="w-9 h-9 rounded-lg bg-page-bg border border-gray-700 text-fg text-lg font-black hover:border-accent hover:text-accent transition flex items-center justify-center">+</button>
                        </div>
                      </div>

                      <div className="flex gap-3 mt-3 shrink-0">
                        <button onClick={() => setPosSelectedProduct(null)} className="flex-1 py-4 bg-page-bg border border-gray-700 text-fg hover:text-accent font-bold rounded-xl uppercase tracking-wider text-xs transition">Cancel</button>
                        <button onClick={confirmPosItem} className="flex-1 py-4 bg-accent text-white hover:bg-brand-dark font-black rounded-xl uppercase tracking-wider text-xs shadow-lg shadow-accent/20 transition">Add to Cart</button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            ) : (
              /* ========================================== */
              /* 📋 STANDARD ORDERS GRID 📋                 */
              /* ========================================== */
              <>
                <div className="flex justify-between items-center mb-6 bg-surface-2 p-3 rounded-xl border border-white/10 shadow-sm relative flex-wrap gap-3">
                  {/* Search bar */}
                  <div className="relative w-full sm:flex-1 sm:max-w-md order-last sm:order-none">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/30 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search name or #order…"
                      value={orderSearch}
                      onChange={e => { setOrderSearch(e.target.value); setOrdersPage(1); }}
                      className="w-full pl-8 pr-3 py-2 bg-page-bg border border-white/10 rounded-lg text-fg text-xs font-bold placeholder-white/25 outline-none focus:border-brand/50 transition"
                    />
                    {orderSearch && (
                      <button onClick={() => setOrderSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/70 transition">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1 overflow-x-auto bg-page-bg border border-white/10 rounded-xl p-1">
                    {(BUSINESS_TYPE === 'log' ? ['All', 'Logistics', 'Warehouse'] : ['All', 'Kitchen', 'Bar']).map(dept => (
                      <button
                        key={dept}
                        onClick={() => setDepartmentFilter(dept)}
                        className={`px-5 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition whitespace-nowrap ${departmentFilter === dept ? 'bg-brand text-white shadow-md shadow-brand/20' : 'bg-transparent text-fg/50 hover:text-fg/80 hover:bg-white/5'}`}
                      >
                        {dept} View
                      </button>
                    ))}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <button 
                        onClick={() => setIsStatusMenuOpen(!isStatusMenuOpen)}
                        className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg font-bold uppercase tracking-wider text-xs hover:bg-transparent hover:text-brand transition shadow-md"
                      >
                        <Menu size={16} /> {orderFilter}
                      </button>
                      
                      {isStatusMenuOpen && (
                        <div className="absolute right-0 top-full mt-2 w-48 bg-surface-2 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col">
                          {['All', 'Reserved', 'Pending', 'Preparing', 'Completed', 'Cancelled', 'Parked'].map(filter => {
                            // Live counts for the two states with an actionable workflow (Reserved/Parked).
                            const reservedCount = orders.filter(o => o.status === 'Reserved').length;
                            const showBadge = (filter === 'Parked' && parkedOrders.length > 0) || (filter === 'Reserved' && reservedCount > 0);
                            const badge = filter === 'Parked' ? parkedOrders.length : reservedCount;
                            const badgeCls = filter === 'Parked'
                              ? 'bg-amber-500 text-black'
                              : 'bg-purple-500 text-white';
                            return (
                              <button
                                key={filter}
                                onClick={() => { setOrderFilter(filter); setIsStatusMenuOpen(false); if (filter === 'Parked') fetchParked(); }}
                                className={`px-4 py-3 text-left text-sm font-bold transition hover:bg-white/5 ${orderFilter === filter ? 'bg-brand/10 text-brand border-l-4 border-brand' : 'text-fg/70 border-l-4 border-transparent'} ${showBadge ? 'flex items-center justify-between' : ''}`}
                              >
                                {filter}
                                {showBadge && <span className={`text-[10px] ${badgeCls} px-1.5 py-0.5 rounded-full`}>{badge}</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setIsPosOpen(true)}
                      className="px-6 py-2 bg-transparent text-brand border border-brand/40 rounded-lg text-sm font-black uppercase tracking-widest hover:bg-brand hover:text-page-bg transition shadow-md whitespace-nowrap flex items-center gap-2"
                    >
                      <Plus size={16} /> Manual Order
                    </button>
                  </div>
                </div>

                {/* ── Active Table Occupancy Strip ── */}
                {(() => {
                  // Reserved orders live alongside Pending in the active list - they're held
                  // commitments waiting on payment / promotion to Preparing.
                  const activeOrders = orders.filter(o => ['Reserved','Pending','Preparing','Ready','Partially Delivered'].includes(o.status));
                  if (activeOrders.length === 0) return null;
                  const tableMap = {};
                  activeOrders.forEach(o => {
                    const t = o.table || 'Unknown';
                    if (!tableMap[t]) tableMap[t] = { table: t, count: 0, status: o.status };
                    tableMap[t].count++;
                    // Worst/most active status wins
                    const rank = { Pending: 4, Preparing: 3, Ready: 2, 'Partially Delivered': 1 };
                    if ((rank[o.status] || 0) > (rank[tableMap[t].status] || 0)) tableMap[t].status = o.status;
                  });
                  const tables = Object.values(tableMap).sort((a,b) => a.table.localeCompare(b.table));
                  return (
                    <div className="mb-4 flex flex-wrap gap-2 items-center">
                      <span className="text-[10px] text-fg/30 font-black uppercase tracking-widest shrink-0">Active Tables:</span>
                      {tables.map(({ table, count, status }) => (
                        <button key={table}
                          onClick={() => { setOrderFilter('All'); setOrderSearch(table); }}
                          title={`${count} order${count !== 1 ? 's' : ''} - click to filter`}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider border transition hover:opacity-90
                            ${status === 'Ready'     ? 'bg-blue-500 text-white border-blue-500' :
                              status === 'Preparing'  ? 'bg-yellow-500 text-white border-yellow-500' :
                              status === 'Pending'    ? 'bg-red-500 text-white border-red-500' :
                              status === 'Reserved'   ? 'bg-purple-500 text-white border-purple-500' :
                                                        'bg-orange-500 text-white border-orange-500'}`}>
                          {table}
                          {count > 1 && <span className="bg-white/20 rounded px-1">{count}</span>}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {displayOrders.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center py-20 px-6 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-white/5 flex items-center justify-center mb-5">
                        <ShoppingCart size={28} className="text-brand/60" />
                      </div>
                      <p className="text-fg/80 font-black uppercase tracking-widest text-sm mb-1.5">
                        No orders in {departmentFilter === 'All' ? 'any' : departmentFilter} queue
                      </p>
                      <p className="text-fg/35 text-xs mb-6 max-w-xs">
                        New orders appear here instantly, whether staff ring them up or customers order by QR.
                      </p>
                      <button
                        onClick={() => setIsPosOpen(true)}
                        className="px-6 py-2.5 bg-brand text-page-bg rounded-lg text-xs font-black uppercase tracking-widest hover:bg-brand-dark transition shadow-md flex items-center gap-2"
                      >
                        <Plus size={15} /> Start a Manual Order
                      </button>
                    </div>
                  ) : displayOrders.map(order => {
                    // Items scoped to current department view (or all items when in All view)
                    const viewItems      = departmentFilter !== 'All'
                      ? order.items.filter(i => (i.department || SEND_TARGET) === departmentFilter)
                      : order.items;
                    const allDelivered   = order.items.length > 0 && order.items.every(i => i.itemStatus === 'Delivered');
                    const deliveredCount = viewItems.filter(i => i.itemStatus === 'Delivered').length;
                    const allDeptDone    = viewItems.length > 0 && viewItems.every(i => i.itemStatus === 'Finished' || i.itemStatus === 'Delivered');
                    const deptDoneCount  = viewItems.filter(i => i.itemStatus === 'Finished' || i.itemStatus === 'Delivered').length;
                    const isUpdating = !!updatingOrders[order._id];
                    const compEntry = compOverride[order._id];
                    const isComp = compEntry !== undefined ? compEntry.isComplimentary : order.isComplimentary;
                    const compEmpName = compEntry !== undefined ? compEntry.employeeName : (order.employeeName || '');
                    const displayDiscount = isComp ? order.subtotal : (order.discount || 0);
                    const displayTotal = isComp ? 0 : order.total;
                    const statusBorderColor =
                      order.status === 'Completed'           ? 'border-l-green-600' :
                      order.status === 'Ready'               ? 'border-l-blue-500' :
                      order.status === 'Partially Delivered' ? 'border-l-orange-500' :
                      order.status === 'Preparing'           ? 'border-l-yellow-500' :
                      order.status === 'Refunded'            ? 'border-l-purple-500' :
                      (order.status === 'Cancelled' || order.status === 'Voided') ? 'border-l-gray-600' :
                      'border-l-red-500';
                    return (
                      <div key={order._id} className={`bg-surface rounded-xl border border-l-4 flex flex-col shadow-lg transition-all
                        ${allDeptDone && order.status !== 'Completed' ? 'border-green-500/40 border-l-green-500' : `border-white/5 ${statusBorderColor}`}
                        ${(order.status === 'Cancelled' || order.status === 'Voided' || order.status === 'Refunded') ? 'opacity-60' : ''}`}>

                        {/* HEADER - only chevron collapses */}
                        <div className="flex justify-between items-center px-4 pt-4 pb-3 gap-2">
                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-fg font-black text-sm">{order.orderNumber}</span>
                              {order.customerName && (
                                <span className="text-[11px] bg-white/10 text-fg px-2 py-0.5 rounded font-semibold">{order.customerName}</span>
                              )}
                              {order.table && <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">({order.table})</span>}
                              {allDeptDone && order.status !== 'Completed' && (
                                <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500 text-white border border-green-500 flex items-center gap-1">
                                  <CheckCircle size={9}/> All Done
                                </span>
                              )}
                            </div>
                            {order.orderNotes && (
                              <p className="text-[10px] text-yellow-white mt-1 bg-yellow-500 border border-yellow-500 rounded px-2 py-1 flex items-start gap-1">
                                <span className="shrink-0 mt-0.5">📝</span>
                                <span className="italic">{order.orderNotes}</span>
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                order.status === 'Reserved'            ? 'bg-purple-500 text-white' :
                                order.status === 'Pending'             ? 'bg-red-500 text-white' :
                                order.status === 'Preparing'           ? 'bg-yellow-500 text-white' :
                                order.status === 'Ready'               ? 'bg-blue-500 text-white' :
                                order.status === 'Partially Delivered' ? 'bg-orange-500 text-white' :
                                order.status === 'Completed'           ? 'bg-green-500 text-white' :
                                order.status === 'Refunded'            ? 'bg-purple-500 text-white' :
                                'bg-gray-500 text-white'
                              }`}>{order.status}</span>
                              <span className="text-gray-600 text-[9px]">{new Date(order.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {order.isParked && (
                              <button onClick={() => resumeParked(order._id)} className="px-3 py-1.5 bg-brand text-white rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-brand/90 transition flex items-center gap-1">
                                <ShoppingCart size={12} /> Resume
                              </button>
                            )}
                            <button onClick={() => printKitchenTicket(order)} className="p-1.5 bg-white/5 text-orange-400/60 rounded-lg hover:bg-orange-500/10 hover:text-orange-400 transition" title={`${SEND_TARGET} Ticket (no prices)`}>
                              <ChefHat size={13} />
                            </button>
                            {BUSINESS_TYPE !== 'log' && (
                              <button onClick={() => printOrderSlip(order)} className="p-1.5 bg-white/5 text-gray-400 rounded-lg hover:bg-white/10 hover:text-fg transition" title="Print Receipt">
                                <Printer size={13} />
                              </button>
                            )}
                            {BUSINESS_TYPE === 'log' && (
                              <button onClick={() => printBillingStatement(order)} className="p-1.5 bg-white/5 text-blue-400/70 rounded-lg hover:bg-blue-500/10 hover:text-blue-300 transition" title="Print Billing Statement">
                                <FileText size={13} />
                              </button>
                            )}
                            {BUSINESS_TYPE === 'log' && (
                              <button onClick={() => printDeliveryReceipt(order)} className="p-1.5 bg-white/5 text-brand/70 rounded-lg hover:bg-brand/10 hover:text-brand transition" title="Print Delivery Receipt (2 copies: original + duplicate)">
                                <Truck size={13} />
                              </button>
                            )}
                            <button
                              onClick={() => setCollapsedOrders(prev => ({ ...prev, [order._id]: !prev[order._id] }))}
                              className="p-1.5 bg-white/5 text-gray-400 rounded-lg hover:bg-white/10 hover:text-fg transition"
                            >
                              {collapsedOrders[order._id] ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                            </button>
                          </div>
                        </div>

                        {/* DELIVERY/PICKUP INFO STRIP - only when there's actually
                            something to show, else it renders as an empty gray bar. */}
                        {['Manual Delivery','Pickup','Grab Delivery','Foodpanda'].includes(order.table)
                          && (order.customerPhone || order.deliveryAddress || order.deliveryFee > 0 || order.scheduledTime || order.dispatchStatus) && (
                          <div className="mx-4 mb-2 bg-black/30 rounded-lg px-3 py-2 border border-white/5 text-[10px] space-y-1">
                            {order.customerPhone && <div className="flex items-center gap-1.5 text-gray-400"><span className="font-black text-fg/40 uppercase tracking-widest">Phone</span> {order.customerPhone}</div>}
                            {order.deliveryAddress && <div className="flex items-center gap-1.5 text-gray-400"><span className="font-black text-fg/40 uppercase tracking-widest">Address</span> {order.deliveryAddress}</div>}
                            {order.deliveryFee > 0 && <div className="flex items-center gap-1.5 text-gray-400"><span className="font-black text-fg/40 uppercase tracking-widest">Delivery Fee</span> ₱{order.deliveryFee.toFixed(2)}</div>}
                            {order.scheduledTime && <div className="flex items-center gap-1.5 text-gray-400"><span className="font-black text-fg/40 uppercase tracking-widest">Scheduled</span> {order.scheduledTime}</div>}
                            {/* DISPATCH PIPELINE */}
                            {order.dispatchStatus && (
                              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-white/30 mt-1">
                                <span className="font-black text-fg/40 uppercase tracking-widest">Dispatch</span>
                                {(['Preparing','Out for Delivery','Awaiting Pickup','Delivered','Picked Up']).map(s => {
                                  const isActive = order.dispatchStatus === s;
                                  return (
                                    <button key={s} onClick={async () => {
                                      const res = await apiFetch(`/api/orders/${order._id}/dispatch`, { method: 'PATCH', body: JSON.stringify({ dispatchStatus: s }) });
                                      if (res.ok) fetchOrders();
                                    }} className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider transition ${isActive ? 'bg-brand text-white' : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-fg'}`}>
                                      {s}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {!collapsedOrders[order._id] && (
                          <div className="px-4 pb-4 flex flex-col gap-3 border-t border-white/30 pt-3">
                            <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                              {(BUSINESS_TYPE === 'log' ? ['Logistics', 'Warehouse'] : ['Kitchen', 'Bar']).map(dept => {
                                const deptItems = order.items
                                  .map((item, idx) => ({ ...item, originalIdx: idx }))
                                  .filter(i => (i.department || SEND_TARGET) === dept);
                                if (deptItems.length === 0) return null;
                                if (departmentFilter !== 'All' && departmentFilter !== dept) return null;
                                return (
                                  <div key={dept} className="bg-white rounded-lg p-2.5 border border-white/5">
                                    <h4 className="text-[9px] uppercase text-accent font-black mb-2 tracking-widest">{dept}</h4>
                                    {deptItems.map(item => (
                                      <div key={item.originalIdx} className="mb-2 last:mb-0">
                                        <div className="flex justify-between items-start gap-2">
                                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                            <span className={`font-semibold text-sm leading-tight ${item.itemStatus === 'Delivered' ? 'text-gray-600 line-through' : 'text-black'}`}>
                                              {item.quantity}x {item.name}
                                            </span>
                                            {(item.fulfilledQty || 0) > 0 && (item.fulfilledQty || 0) < (item.quantity || 0) && (
                                              <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600">
                                                {item.fulfilledQty} fulfilled · {Math.max(0, (item.quantity || 0) - (item.fulfilledQty || 0))} remaining
                                              </span>
                                            )}
                                            {(item.fulfilledQty || 0) >= (item.quantity || 0) && (item.quantity || 0) > 0 && order.status === 'Partially Fulfilled' && (
                                              <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600 flex items-center gap-0.5"><Check size={9} /> Fully fulfilled</span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1 flex-shrink-0">
                                            {(order.status === 'Preparing' || order.status === 'Ready') ? (
                                              <>
                                                {item.itemStatus === 'Received' && (
                                                  <button onClick={() => updateItemStatus(order, item.originalIdx, 'Preparing')} className="bg-yellow-500 text-white border border-yellow-500 hover:bg-yellow-400 hover:text-black px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition">Prep</button>
                                                )}
                                                {item.itemStatus === 'Preparing' && (
                                                  <button onClick={() => updateItemStatus(order, item.originalIdx, 'Finished')} className="bg-accent text-white border border-accent hover:bg-accent hover:text-white/20 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition">Finish</button>
                                                )}
                                                {item.itemStatus === 'Finished' && departmentFilter === 'All' && (
                                                  <button onClick={() => updateItemStatus(order, item.originalIdx, 'Delivered')} className="bg-green-500 text-white border border-green-500 hover:bg-green-400 hover:text-black px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition flex items-center gap-1">
                                                    <Truck size={9} /> Give
                                                  </button>
                                                )}
                                                {item.itemStatus === 'Finished' && departmentFilter !== 'All' && (
                                                  <span className="text-accent text-[10px] font-black uppercase flex items-center gap-0.5"><CheckCircle size={10} /> Done</span>
                                                )}
                                                {item.itemStatus === 'Delivered' && (
                                                  <span className="text-green-500/50 text-[10px] font-black uppercase flex items-center gap-0.5"><Check size={9} /> Given</span>
                                                )}
                                              </>
                                            ) : (
                                              (() => {
                                                // Effective discount = MAX of per-product/per-client discount
                                                // (server-resolved, saved as productDiscountPercent) and the
                                                // per-item cashier override (discountPercent). We show the
                                                // higher one so the customer always gets the better rate.
                                                const lineGross = (item.price + (item.selectedAddOns?.reduce((s, a) => s + Number(a.price), 0) || 0)) * item.quantity;
                                                const prodPct  = Number(item.productDiscountPercent || 0);
                                                const itemPct  = Number(item.discountPercent || 0);
                                                const effPct   = Math.max(prodPct, itemPct);
                                                const isClientRate = prodPct > 0 && prodPct >= itemPct;
                                                return (
                                                  <div className="flex flex-col items-end gap-0.5">
                                                    {effPct > 0 ? (
                                                      <>
                                                        <span className="text-accent line-through text-[10px] font-mono">
                                                          P{lineGross.toFixed(2)}
                                                        </span>
                                                        <span className="text-accent font-mono font-bold text-xs">
                                                          P{(lineGross * (1 - effPct / 100)).toFixed(2)}
                                                        </span>
                                                        <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${isClientRate ? 'bg-emerald-500 text-white border border-emerald-500' : 'bg-amber-500 text-white border border-amber-500'}`}>
                                                          {isClientRate ? `Client −${effPct}%` : `−${effPct}%`}
                                                        </span>
                                                      </>
                                                    ) : (
                                                      <span className="text-black font-mono text-xs">
                                                        P{lineGross.toFixed(2)}
                                                      </span>
                                                    )}
                                                    {order.status === 'Pending' && (
                                                      <div className="relative mt-0.5">
                                                        <input
                                                          type="number" min="0" max="100" step="1"
                                                          placeholder="0"
                                                          value={item.discountPercent || ''}
                                                          onChange={e => applyItemDiscount(order._id, item.originalIdx, e.target.value)}
                                                          className="w-14 bg-white border border-black rounded pl-1.5 pr-5 py-0.5 text-black text-[10px] font-bold outline-none focus:border-brand/60 placeholder-black tabular-nums"
                                                        />
                                                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-black text-[9px] font-bold pointer-events-none">%</span>
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              })()
                                            )}
                                          </div>
                                        </div>
                                        {item.isCombo && (item.comboItems || []).length > 0 && (
                                          <div className="pl-5 mt-1 space-y-0.5">
                                            {item.comboItems.map((c, cIdx) => (
                                              <div key={cIdx} className="flex items-center gap-1 text-[10px] text-brand">
                                                <ChevronRight size={8} className="flex-shrink-0" /> {c.quantity > 1 ? `${c.quantity}× ` : ''}{c.name}{c.sizeName ? ` (${c.sizeName})` : ''}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                                          <div className="pl-5 mt-1 space-y-0.5">
                                            {item.selectedAddOns.map((addon, aIdx) => (
                                              <div key={aIdx} className="flex justify-between items-center text-[10px] text-gray-600">
                                                <span className="flex items-center gap-1">
                                                  <ChevronRight size={8} className="flex-shrink-0" /> {addon.name} <span className="opacity-70">(+P{addon.price})</span>
                                                </span>
                                                {order.status === 'Pending' && (
                                                  <button onClick={() => removeAddOnFromOrder(order, item.originalIdx, aIdx)} className="text-gray-600 hover:text-red-400 transition p-0.5 rounded">
                                                    <X size={10} />
                                                  </button>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>

                            {order.status === 'Pending' && departmentFilter === 'All' && (
                              <div className="flex flex-col gap-1.5 border-t border-white/30 pt-2.5">
                                {isComp ? (
                                  /* ── APPLIED STATE: audit badge ── */
                                  <div className="flex items-start gap-2 bg-white/3 border border-white/10 rounded-lg p-2">
                                    <Gift size={11} className="text-gray-500 flex-shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0 space-y-0.5">
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">Complimentary</span>
                                        {order.complimentaryReferenceNumber && (
                                          <span className="text-gray-600 text-[9px] font-mono">{order.complimentaryReferenceNumber}</span>
                                        )}
                                      </div>
                                      <div className="text-gray-500 text-[9px]">
                                        <span className="text-gray-600">Reason:</span> {COMP_REASON_LABELS[order.complimentaryReasonType] || '-'}
                                      </div>
                                      {order.complimentaryReasonNote && (
                                        <div className="text-gray-600 text-[9px] italic truncate">&ldquo;{order.complimentaryReasonNote}&rdquo;</div>
                                      )}
                                      <div className="text-gray-600 text-[9px]">
                                        <span className="text-gray-700">For:</span> {compEmpName} &nbsp;·&nbsp; <span className="text-gray-700">By:</span> {order.complimentaryApprovedBy || activeAdmin?.name || '-'}
                                      </div>
                                      {order.complimentaryApprovedAt && (
                                        <div className="text-gray-700 text-[9px]">{new Date(order.complimentaryApprovedAt).toLocaleString()}</div>
                                      )}
                                    </div>
                                    <button onClick={() => removeComplimentary(order._id)} className="flex-shrink-0 bg-red-500 hover:bg-red-600 text-white p-1 rounded font-black transition" title="Remove Complimentary">
                                      <X size={11} />
                                    </button>
                                  </div>
                                ) : (
                                  /* ── PENDING STATE: input form ── */
                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <Gift size={10} className="text-gray-500 flex-shrink-0" />
                                      <span className="text-fg text-[9px] font-bold uppercase tracking-wider">Mark Complimentary</span>
                                    </div>
                                    {/* Reason type - REQUIRED */}
                                    <select
                                      className="w-full bg-surface-2 border border-white/10 text-fg text-[10px] rounded p-1.5 outline-none font-semibold"
                                      value={compReasonTypes[order._id] || ''}
                                      onChange={(e) => setCompReasonTypes(prev => ({ ...prev, [order._id]: e.target.value }))}
                                    >
                                      <option value="">- Select Reason Type (required) -</option>
                                      {Object.entries(COMP_REASON_LABELS).map(([key, label]) => (
                                        <option key={key} value={key}>{label}</option>
                                      ))}
                                    </select>
                                    {/* Optional note */}
                                    <input
                                      type="text"
                                      placeholder="Additional note (optional)..."
                                      className="w-full bg-surface-2 border border-white/10 text-fg text-[10px] rounded p-1.5 outline-none"
                                      value={compReasonNotes[order._id] || ''}
                                      onChange={(e) => setCompReasonNotes(prev => ({ ...prev, [order._id]: e.target.value }))}
                                    />
                                    {/* Beneficiary override + apply button */}
                                    <div className="flex items-center gap-1.5">
                                      <select
                                        className="flex-1 min-w-0 bg-surface-2 border border-white/10 text-fg text-[9px] rounded p-1.5 outline-none"
                                        value={compSelections[order._id] || ''}
                                        onChange={(e) => setCompSelections({ ...compSelections, [order._id]: e.target.value })}
                                      >
                                        <option value="">For: {activeAdmin?.name || 'You'} (default)</option>
                                        {users.map(u => <option key={u._id} value={u.name}>For: {u.name}</option>)}
                                      </select>
                                      <button
                                        onClick={() => applyComplimentary(order._id)}
                                        className="flex-shrink-0 bg-yellow-500 hover:bg-yellow-400 text-white px-2.5 py-1.5 rounded font-black text-[10px] uppercase tracking-wider transition flex items-center gap-1"
                                      >
                                        <Check size={11} /> Apply
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {departmentFilter === 'All' && (<div className="bg-white rounded-lg p-3 space-y-1.5">
                              {order.status === 'Completed' && order.paymentMethod && (
                                <div className="flex justify-between text-[11px] text-black">
                                  <span>Payment</span>
                                  <span className="font-mono text-brand/80 font-bold">{order.paymentMethod}</span>
                                </div>
                              )}
                              <div className="flex justify-between text-[11px] text-black">
                                <span>Gross</span><span className="font-mono">P{order.subtotal.toFixed(2)}</span>
                              </div>
                              {vatOn && (
                                <div className="flex justify-between items-center text-[11px] text-black">
                                  <div className="flex items-center gap-2">
                                    {/* Rate comes from the ORDER, not from settings - an order rung
                                        up before VAT was switched on genuinely carries 0%. */}
                                    <span>VAT ({order.vatRate > 0 ? (order.vatRate * 100).toFixed(0) : 0}%)</span>
                                    {/* Read-only. VAT is configured in Settings and exemption comes
                                        from the SC/PWD control below - there is no per-order VAT
                                        switch, because a cashier silently zeroing output VAT on one
                                        sale is exactly what a tax audit looks for. */}
                                    {order.isVatExempt && (
                                      <span className="bg-amber-400/15 border border-amber-400/30 text-amber-500 px-1.5 py-0.5 rounded text-[9px] uppercase font-black">
                                        SC/PWD Exempt
                                      </span>
                                    )}
                                  </div>
                                  <span className="font-mono">P{order.vatAmount.toFixed(2)}</span>
                                </div>
                              )}
                              {(() => {
                                const promoDiscounts = discounts.filter(d => !d.name.toLowerCase().match(/pwd|senior/));
                                const scpwdDiscounts = discounts.filter(d => d.name.toLowerCase().match(/pwd|senior/));
                                const hasScpwd = order.items.some(i => i.discountPercent > 0);
                                const hasPromo = order.discountPercent > 0 && order.discountType !== 'SC/PWD';
                                return (
                                  <>
                                    <div className="flex justify-between items-center text-[11px] text-black border-b border-white/5 pb-1.5">
                                      <div className="flex items-center gap-2 flex-1 pr-2">
                                        <span className="whitespace-nowrap uppercase tracking-wider text-[9px]">Promo</span>
                                        {order.status === 'Pending' && (
                                          hasScpwd ? (
                                            <span className="text-[9px] text-black italic ml-auto">SC/PWD active</span>
                                          ) : (
                                            <div className="flex gap-1 items-center flex-1 justify-end">
                                              <select
                                                className="w-full max-w-[110px] bg-white border border-black rounded px-1 text-[10px] text-black outline-none h-6"
                                                value={discountInputs[order._id] || ''}
                                                onChange={(e) => setDiscountInputs(prev => ({ ...prev, [order._id]: e.target.value }))}
                                              >
                                                <option value="">No promo</option>
                                                {promoDiscounts.map(d => <option key={d._id} value={d.percentage}>{d.name} ({d.percentage}%)</option>)}
                                              </select>
                                              <button onClick={() => applyDiscount(order._id)} className="bg-accent hover:bg-accent/80 text-white hover:text-fg px-2 rounded font-black transition h-6 flex items-center border border-accent/20"><Check size={12} /></button>
                                              {order.discountPercent > 0 && order.discountType !== 'SC/PWD' && (
                                                <button onClick={() => applyDiscount(order._id, true)} className="bg-red-500 text-white px-2 rounded font-black h-6 border border-red-500 flex items-center"><X size={12} /></button>
                                              )}
                                            </div>
                                          )
                                        )}
                                      </div>
                                      <span className="text-red-500 whitespace-nowrap font-mono">-P{displayDiscount.toFixed(2)}</span>
                                    </div>
                                    {scpwdDiscounts.length > 0 && order.status === 'Pending' && (
                                      <div className="border-b border-white/5 pb-1.5 space-y-1">
                                        {hasPromo ? (
                                          <span className="text-[9px] uppercase tracking-wider text-black italic">SC/PWD - Promo active</span>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() => setScpwdOpen(prev => ({ ...prev, [order._id]: !prev[order._id] }))}
                                              className="text-[9px] uppercase tracking-wider text-accent font-black flex items-center gap-1 hover:opacity-80 transition"
                                            >
                                              SC/PWD (per item) {scpwdOpen[order._id] ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                            </button>
                                            {scpwdOpen[order._id] && (
                                              <div className="max-h-[130px] overflow-y-auto custom-scrollbar space-y-1.5 pt-0.5 pr-1">
                                                {order.items.map((item, idx) => (
                                                  <div key={idx} className="flex items-center gap-2">
                                                    <span className="text-[11px] text-black font-semibold flex-1 truncate min-w-0">{item.quantity}x {item.name}</span>
                                                    <select
                                                      className="bg-white border border-black rounded text-[10px] text-black outline-none px-1 py-0.5 h-6 cursor-pointer flex-shrink-0"
                                                      value={item.discountPercent || ''}
                                                      onChange={(e) => applyItemDiscount(order._id, idx, e.target.value)}
                                                    >
                                                      <option value="">No disc</option>
                                                      {scpwdDiscounts.map(d => (
                                                        <option key={d._id} value={d.percentage}>{d.name} ({d.percentage}%)</option>
                                                      ))}
                                                    </select>
                                                    {item.discountPercent > 0 && (
                                                      <span className="text-accent font-mono text-[10px] whitespace-nowrap flex-shrink-0">-{item.discountPercent}%</span>
                                                    )}
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                              <div className="flex justify-between font-black text-base pt-1 border-t border-gray">
                                <span className="text-black">Total</span>
                                <span className="text-accent font-mono tracking-wider">P{displayTotal.toFixed(2)}</span>
                              </div>
                            </div>)}

                            <div className={`flex flex-col gap-2 ${isUpdating ? 'opacity-50 pointer-events-none' : ''}`}>
                              {/* Reserved orders are held with no payment. Unlock promotes them to Pending,
                                  which surfaces the normal Pay & Send / Drop controls below. */}
                              {order.status === 'Reserved' && departmentFilter === 'All' && (
                                <div className="flex flex-col w-full gap-2">
                                  <div className="flex items-center justify-center gap-2 bg-purple-500/10 border border-purple-500/30 rounded-lg py-2.5 px-3">
                                    <Lock size={12} className="text-purple-300" />
                                    <span className="text-purple-300 text-[10px] font-black uppercase tracking-widest">Reserved - Payment Locked</span>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => updateStatus(order._id, 'Pending')}
                                      className="flex-1 bg-purple-500 text-fg py-2.5 rounded-lg hover:bg-purple-400 font-black text-xs uppercase tracking-widest transition flex items-center justify-center gap-1.5"
                                      title="Unlock - promote to Pending so payment can be collected"
                                    >
                                      <Unlock size={12} /> Unlock & Take Payment
                                    </button>
                                    <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500/10 text-red-400 py-2.5 px-4 rounded-lg hover:bg-red-500 hover:text-fg font-black text-xs transition uppercase border border-red-500/20">Drop</button>
                                  </div>
                                </div>
                              )}
                              {order.status === 'Pending' && departmentFilter === 'All' && (() => {
                                const isDelivery = ['Grab Delivery', 'Foodpanda', 'Manual Delivery', 'Lalamove'].includes(order.table);
                                // Payment is always changeable. Default to the order's natural
                                // method (delivery channel for delivery orders, else its set method).
                                const displayPayment = paymentSelections[order._id] || (isDelivery ? order.table : (order.paymentMethod || 'Cash'));
                                if (isComp) {
                                  return (
                                    <div className="flex flex-col w-full gap-2">
                                      <div className="flex items-center justify-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg py-2.5 px-3">
                                        <Gift size={12} className="text-yellow-400" />
                                        <span className="text-yellow-400 text-[10px] font-black uppercase tracking-widest">No Payment - Complimentary</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => updateStatus(order._id, 'Preparing')}
                                          className="flex-1 bg-yellow-500 text-black py-2.5 rounded-lg hover:bg-yellow-400 font-black text-xs uppercase tracking-widest transition"
                                        >
                                          Send to {SEND_TARGET}
                                        </button>
                                        <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500/10 text-red-400 py-2.5 px-4 rounded-lg hover:bg-red-500 hover:text-fg font-black text-xs transition uppercase border border-red-500/20">Drop</button>
                                      </div>
                                    </div>
                                  );
                                }
                                return (() => {
                                  const isCash = displayPayment === 'Cash';
                                  const tendered = parseFloat(cashTendered[order._id] || '0') || 0;
                                  const changeDue = isCash && tendered > 0 ? tendered - displayTotal : null;
                                  const isUnderpaid = isCash && tendered > 0 && tendered < displayTotal;
                                  return (
                                    <div className="flex flex-col w-full gap-2">
                                      <select
                                        value={displayPayment}
                                        onChange={(e) => setPaymentSelections(prev => ({ ...prev, [order._id]: e.target.value }))}
                                        className="w-full border rounded-lg p-2 text-sm font-bold outline-none transition bg-page-bg text-fg border-white/10 focus:border-accent/50"
                                      >
                                        {/* Canonical payment methods - these stay even when no
                                            sub-accounts have been added so the cashier always has
                                            the standard options. */}
                                        <optgroup label="In-Store Payments">
                                          <option value="Cash">Cash</option>
                                          <option value="Bank Transfer">Bank Transfer</option>
                                          <option value="Credit">Credit</option>
                                        </optgroup>
                                        <optgroup label="E-Wallets">
                                          <option value="GCash">GCash</option>
                                          <option value="Maya">Maya</option>
                                          <option value="Maribank">Maribank / Seabank</option>
                                          <option value="Other E-Wallet">Other E-Wallet</option>
                                        </optgroup>
                                        <optgroup label="Delivery Partners">
                                          <option value="Grab Delivery">Grab Delivery</option>
                                          {BUSINESS_TYPE === 'log'
                                            ? <option value="Lalamove">Lalamove</option>
                                            : <option value="Foodpanda">Foodpanda</option>
                                          }
                                          <option value="Manual Delivery">Manual/Direct</option>
                                        </optgroup>
                                        {/* Custom sub-accounts the admin added in COA (Metrobank,
                                            Gotyme, etc.). Grouped by their parent account so the
                                            cashier sees which bucket each one belongs to. */}
                                        {(() => {
                                          const PARENT_LABEL = {
                                            '111000': 'Custom Cash Accounts',
                                            '112000': 'Custom Bank Accounts',
                                            '113000': 'Custom E-Wallets',
                                            '120000': 'Custom Delivery Partners',
                                            '220000': 'Custom On-Account Vendors',
                                          };
                                          const STANDARD_NAMES = new Set(['Cash','Bank Transfer','GCash','Maya','Maribank','Other E-Wallet','Grab Delivery','Lalamove','Foodpanda','Manual Delivery','Pickup','On Account','Cash in Bank','E-Wallet']);
                                          const groups = {};
                                          for (const a of (coaAccounts || [])) {
                                            if (!a.custom || !a.parent) continue;
                                            if (!PARENT_LABEL[a.parent]) continue;
                                            if (STANDARD_NAMES.has(a.name)) continue; // already in the canonical optgroups
                                            (groups[a.parent] ||= []).push(a);
                                          }
                                          return Object.keys(PARENT_LABEL).filter(p => groups[p]).map(p => (
                                            <optgroup key={p} label={PARENT_LABEL[p]}>
                                              {groups[p].sort((a,b)=>a.code.localeCompare(b.code)).map(a => (
                                                <option key={a.code} value={a.name}>{a.name}</option>
                                              ))}
                                            </optgroup>
                                          ));
                                        })()}
                                      </select>
                                      {isCash && (
                                        <div className="flex flex-col gap-1">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest whitespace-nowrap">Cash In</span>
                                            <input
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              placeholder={`≥ P${displayTotal.toFixed(2)}`}
                                              value={cashTendered[order._id] || ''}
                                              onChange={(e) => setCashTendered(prev => ({ ...prev, [order._id]: e.target.value }))}
                                              className="flex-1 bg-white/5 border border-white/10 focus:border-accent/50 rounded-lg px-2 py-1.5 text-sm font-mono text-fg outline-none"
                                              aria-label="Cash tendered"
                                            />
                                          </div>
                                          {changeDue !== null && (
                                            <div className={`flex justify-between text-xs font-black px-1 ${isUnderpaid ? 'text-red-400' : 'text-green-400'}`}>
                                              <span>{isUnderpaid ? 'SHORT' : 'CHANGE'}</span>
                                              <span className="font-mono">P{Math.abs(changeDue).toFixed(2)}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      <div className="flex gap-2">
                                        <button
                                          disabled={isUnderpaid}
                                          onClick={() => {
                                            // Seed the selection with the default so it persists even if untouched.
                                            if (paymentSelections[order._id] === undefined) {
                                              setPaymentSelections(prev => ({ ...prev, [order._id]: displayPayment }));
                                            }
                                            setTimeout(() => updateStatus(order._id, 'Preparing'), 0);
                                          }}
                                          className={`flex-1 py-2.5 rounded-lg font-black text-xs uppercase tracking-widest transition ${isUnderpaid ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-accent text-white hover:bg-accentShadow'}`}
                                        >
                                          Pay & Send to {SEND_TARGET}
                                        </button>
                                        <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500 text-white py-2.5 px-4 rounded-lg hover:bg-red-400 hover:text-fg font-black text-xs transition uppercase border border-red-500/20">Drop</button>
                                      </div>
                                      {BUSINESS_TYPE === 'log' && (order.items?.length > 0) && (
                                        <button onClick={() => openPartial(order)} className="w-full bg-amber-500 text-white py-2 rounded-lg hover:bg-amber-400 hover:text-fg font-black text-[11px] transition uppercase tracking-widest border border-amber-500/20">
                                          Partial Fulfill
                                        </button>
                                      )}
                                    </div>
                                  );
                                })();
                              })()}

                              {order.status === 'Partially Fulfilled' && departmentFilter === 'All' && (() => {
                                const totalQty = (order.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
                                const doneQty = (order.items || []).reduce((s, it) => s + (it.fulfilledQty || 0), 0);
                                // Value of what's still outstanding (line price × units not yet fulfilled).
                                const remainingValue = (order.items || []).reduce((s, it) => {
                                  const rem = Math.max(0, (it.quantity || 0) - (it.fulfilledQty || 0));
                                  const addOn = (it.selectedAddOns || []).reduce((a, x) => a + Number(x.price || 0), 0);
                                  return s + rem * ((it.price || 0) + addOn);
                                }, 0);
                                return (
                                  <div className="flex flex-col gap-2">
                                    <div className="flex flex-col gap-1 bg-amber-500 border border-amber-500 rounded-lg px-3 py-2">
                                      <span className="flex items-center gap-2 text-white text-[10px] font-black uppercase tracking-widest">
                                        <Package size={12} className="flex-shrink-0" />
                                        Partially fulfilled · {doneQty}/{totalQty} units{order.depositRemaining > 0 ? ' · prepaid' : ''}
                                      </span>
                                      {remainingValue > 0 && (
                                        <span className="text-white/90 text-[10px] font-bold tracking-wide">Remaining to fulfill: ₱{remainingValue.toFixed(2)}</span>
                                      )}
                                    </div>
                                    <button onClick={() => openPartial(order)} className="w-full bg-accent text-white py-2.5 rounded-lg hover:bg-accentShadow font-black text-xs uppercase tracking-widest transition">
                                      Fulfill Remaining
                                    </button>
                                    <button onClick={() => dropRemaining(order)} className="bg-red-500 text-white py-2 px-4 rounded-lg hover:bg-red-500 hover:text-fg font-black text-[11px] transition uppercase border border-red-500/20">Drop Remaining</button>
                                  </div>
                                );
                              })()}

                              {order.status === 'Preparing' && (
                                <div className="flex flex-col gap-2">
                                  {deliveredCount > 0 && (
                                    <div className="flex items-center gap-2 bg-green-500 border border-green-500 rounded-lg px-3 py-2">
                                      <Truck size={12} className="text-green-400 flex-shrink-0" />
                                      <span className="text-white text-[10px] font-black uppercase tracking-widest">{deliveredCount}/{viewItems.length} Given to Customer</span>
                                    </div>
                                  )}
                                  {departmentFilter !== 'All' ? (
                                    // Kitchen / Bar view: scope progress to this dept only
                                    allDeptDone ? (
                                      <div className="flex items-center justify-center gap-2 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg text-[10px] font-bold uppercase tracking-widest py-2.5">
                                        <CheckCircle size={11} /> All {departmentFilter === 'All' ? '' : departmentFilter + ' '}Items Done
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-center bg-black/20 border border-white/5 text-gray-500 rounded-lg text-[10px] font-bold uppercase tracking-widest py-2.5">
                                        In Preparation... ({deptDoneCount}/{viewItems.length})
                                      </div>
                                    )
                                  ) : allDelivered ? (
                                    <button onClick={() => updateStatus(order._id, 'Completed')} className="w-full bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-500 font-black uppercase tracking-widest text-xs transition flex items-center justify-center gap-2">
                                      <CheckCircle size={13} /> Complete Order
                                    </button>
                                  ) : order.items.every(i => i.itemStatus === 'Finished' || i.itemStatus === 'Delivered') ? (
                                    <div className="flex items-center justify-center gap-2 bg-blue-500 border border-blue-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest py-2.5">
                                      <Truck size={11} /> Give items above to complete
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-center bg-black/20 border border-white/5 text-gray-500 rounded-lg text-[10px] font-bold uppercase tracking-widest py-2.5">
                                      In Preparation...
                                    </div>
                                  )}
                                  {departmentFilter === 'All' && !allDelivered && (
                                    <button onClick={() => updateStatus(order._id, 'Cancelled')} className="w-full bg-red-500 text-white py-2 rounded-lg hover:bg-red-400 hover:text-fg font-black text-xs transition uppercase border border-red-500">Drop Order</button>
                                  )}
                                </div>
                              )}

                              {order.status === 'Ready' && departmentFilter === 'All' && (
                                <div className="flex flex-col gap-2">
                                  {deliveredCount > 0 && (
                                    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                                      <Truck size={12} className="text-green-400 flex-shrink-0" />
                                      <span className="text-green-400 text-[10px] font-black uppercase tracking-widest">{deliveredCount}/{order.items.length} Given</span>
                                    </div>
                                  )}
                                  <div className="flex gap-2">
                                    <button onClick={() => updateStatus(order._id, 'Completed')} className="flex-1 bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-500 font-black uppercase tracking-widest text-xs transition">Mark All Delivered</button>
                                    <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500/10 text-red-400 py-2.5 px-3 rounded-lg hover:bg-red-500 hover:text-fg font-black text-xs transition uppercase border border-red-500/20">Drop</button>
                                  </div>
                                  <button
                                    onClick={async () => {
                                      try {
                                        const res = await apiFetch(`/api/orders/${order._id}/partial-delivery`, { method: 'POST' });
                                        const data = await res.json();
                                        if (!data.success) ui.alert(data.error);
                                      } catch (err) { console.error(err); }
                                    }}
                                    className="w-full bg-yellow-500 text-white border border-yellow-500 py-2 rounded-lg hover:bg-yellow-500/20 font-bold text-xs uppercase tracking-widest transition"
                                  >
                                    Give Partial - More Items Coming
                                  </button>
                                </div>
                              )}

                              {order.status === 'Partially Delivered' && departmentFilter === 'All' && (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center justify-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-lg py-2">
                                    <Clock size={13} className="text-orange-400" />
                                    <span className="text-orange-400 text-[10px] font-black uppercase tracking-widest">Partially Delivered</span>
                                  </div>
                                  <button onClick={() => updateStatus(order._id, 'Completed')} className="w-full bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-500 font-black uppercase tracking-widest text-xs transition">
                                    Deliver Remaining Items
                                  </button>
                                </div>
                              )}

                              {order.status === 'Completed' && departmentFilter === 'All' && canVoidRefund && (
                                <div className="flex gap-2">
                                  <button onClick={() => handleVoidOrder(order._id)} className="flex-1 bg-red-500 border border-red-500 text-white py-2 rounded-lg hover:bg-red-500 hover:text-fg font-bold text-xs uppercase tracking-widest transition">
                                    Void
                                  </button>
                                  <button onClick={() => { setRefundModal(order); }} className="flex-1 bg-orange-500 border border-orange-500 text-white py-2 rounded-lg hover:bg-orange-500 hover:text-fg font-bold text-xs uppercase tracking-widest transition">
                                    Refund
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Payment QR - full-screen for the customer to scan; dismissed once paid. */}
            {payQrOpen && payQrImage && (
              <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-6" onClick={() => setPayQrOpen(false)}>
                <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center shadow-2xl" onClick={e => e.stopPropagation()}>
                  <p className="text-black font-black text-lg uppercase tracking-wider mb-1">Scan to Pay</p>
                  <p className="text-gray-500 text-xs mb-4">Open your e-wallet or bank app and scan</p>
                  <img src={payQrImage} alt="Payment QR" className="w-full max-w-[300px] mx-auto rounded-xl" />
                  <button onClick={() => setPayQrOpen(false)} className="mt-5 w-full bg-brand text-white font-black py-3.5 rounded-2xl uppercase tracking-widest text-sm hover:bg-brand-dark transition">
                    Done - Paid
                  </button>
                  <p className="text-gray-400 text-[11px] mt-2">Tap when payment is confirmed</p>
                </div>
              </div>
            )}
          </div>
  );
}
