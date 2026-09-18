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
        {selected?.Icon && <selected.Icon size={16} className="text-brand-text shrink-0" />}
        <span className="flex-1 text-left truncate">{selected?.label}</span>
        <ChevronDown size={14} className={`text-fg/70 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full bg-surface border border-white/10 rounded-xl overflow-hidden shadow-xl py-1 max-h-64 overflow-y-auto">
            {options.map(o => (
              <button key={o.value} type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-left transition ${o.value === value ? 'bg-brand text-on-brand' : 'text-fg/80 hover:bg-white/10'}`}>
                <o.Icon size={16} className={o.value === value ? 'text-fg' : 'text-fg/75'} />
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
// Soft, tinted status pills - the colour still says the state at a glance
// without every card shouting in solid red or yellow.
const ORDER_STATUS_TONE = {
  Reserved:              'bg-purple-500/15 text-purple-300',
  Pending:               'bg-red-500/15 text-danger',
  Preparing:             'bg-yellow-500/15 text-warning',
  Ready:                 'bg-blue-500/15 text-blue-300',
  'Partially Delivered': 'bg-orange-500/15 text-warning',
  'Partially Fulfilled': 'bg-orange-500/15 text-warning',
  Completed:             'bg-green-500/15 text-success',
  Refunded:              'bg-purple-500/15 text-purple-300',
};

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
    displayOrders, downloadImportTemplate, editInvForm, editInvModal,
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
    posBranch, setPosBranch, stockLocations,
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
    paymentRefs, setPaymentRefs, paymentCheckDates, setPaymentCheckDates,
    scPwdEntry, setScPwdEntry, saveScPwdId,
    paymentMethodGroups, setPayQrOpen,
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
    can,
  } = ctx;

  // The POS VAT row follows the business's registration in Settings. A non-VAT
  // business has no VAT line to show at all - printing "VAT (0%)" on screen just
  // invites someone to try switching it on here, which is not where that lives.
  const vatOn = systemSettings.vatEnabled === true;

  // UI-only hint for the walk-in picker below - not persisted; the real
  // guest-vs-regular classification comes from whether a customer name is entered.
  const [walkInMode, setWalkInMode] = React.useState('guest');
  // Payment-QR display (set in Settings > Branding). The overlay itself lives
  // at dashboard level so it can be opened from anywhere payment is settled -
  // the order card here, and the partial-fulfil modal, which is mounted
  // outside this component and could not otherwise reach it.
  const payQrImage = systemSettings.paymentQrImage || '';
  // "Mark Complimentary" is an edge case, not something every cashier touches
  // on every order - collapsed by default so the card reads as a normal
  // payment panel, and only expands into a form when someone actually needs it.
  const [compFormOpen, setCompFormOpen] = React.useState({});
  // Discounts are the exception, not the rule: most orders are rung up at full
  // price, and the promo picker plus the SC/PWD list were taking about a third
  // of every card to sit unused. Collapsed by default, and opened for you when
  // the order already carries one so an applied discount is never hidden.
  const [discountsOpen, setDiscountsOpen] = React.useState({});

  // Amend: correct an open order's quantities before it is completed. Once it
  // is Completed it is an invoice, and only a refund may change it.
  const [amendModal, setAmendModal] = React.useState(null); // { order, qty: [], reason, busy, error }
  const canAmend = (order) => (isSuperAdmin || can?.('orders.manage'))
    && !order.isParked
    && !['Completed', 'Cancelled', 'Voided', 'Refunded', 'Partially Fulfilled'].includes(order.status)
    && !(order.items || []).some(i => (i.fulfilledQty || 0) > 0)
    && !((order.payments || []).length > 0);
  // Holding an open order's stock keeps it off everyone else's orders until
  // this one completes - the promise a client has usually paid a deposit on.
  const holdStock = async (order) => {
    if (!(await ui.confirm(`Hold this order's stock for ${order.customerName || 'this client'}? Nobody else's order can take it until this one completes.`))) return;
    try {
      const res = await apiFetch('/api/reservations', { method: 'POST', body: JSON.stringify({ orderId: order._id }) });
      const d = await res.json();
      if (!d.success) return ui.alert(d.error || 'Could not hold that stock.');
      ui.alert(`${d.reservation.reservationNumber} holds this order's stock until ${new Date(d.reservation.expiresAt).toLocaleDateString()}. Completing the order releases it.`);
      fetchOrders();
    } catch { ui.alert('Network error.'); }
  };

  const openAmend = (order) => setAmendModal({ order, qty: (order.items || []).map(i => String(i.quantity)), adds: [], search: '', reason: '', busy: false, error: '' });
  // Products that can be added in place: sellable, and not needing a size or
  // option picked (those go through a new order - the server enforces the same).
  const amendableProducts = React.useMemo(() => (products || []).filter(p =>
    p.isAvailable !== false && !p.isArchived && (p.basePrice || 0) > 0 && !(p.modifierGroups || []).length
  ), [products]);
  const submitAmend = async () => {
    const m = amendModal;
    const changes = m.order.items
      .map((it, index) => ({ index, quantity: Number(m.qty[index]) }))
      .filter(c => c.quantity !== Number(m.order.items[c.index].quantity));
    const adds = m.adds.filter(a => Number(a.quantity) > 0).map(a => ({ productId: a.productId, quantity: Number(a.quantity) }));
    if (!changes.length && !adds.length) return setAmendModal({ ...m, error: 'Change a quantity or add a product.' });
    if (!m.reason.trim()) return setAmendModal({ ...m, error: 'Say why the order is changing.' });
    setAmendModal({ ...m, busy: true, error: '' });
    try {
      const res = await apiFetch(`/api/orders/${m.order._id}/amend`, { method: 'POST', body: JSON.stringify({ changes, adds, reason: m.reason.trim() }) });
      const d = await res.json();
      if (!d.success) return setAmendModal({ ...m, busy: false, error: d.error || 'Could not amend the order.' });
      setAmendModal(null);
      fetchOrders();
      ui.alert(`${d.order.orderNumber} amended (Rev ${d.order.revision}). New total ₱${Number(d.order.total).toFixed(2)}.${d.shortBy ? ` Cash tendered is now short by ₱${d.shortBy.toFixed(2)}.` : ''}`);
    } catch {
      setAmendModal({ ...m, busy: false, error: 'Network error - nothing was changed.' });
    }
  };

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
                      <ShoppingCart size={18} className="text-brand-text" />
                      <span className="font-black text-fg tracking-widest uppercase text-sm">POS Register</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* The payment QR used to live here, beside the product
                          browser. Nobody pays while the cashier is still
                          ringing items up - it belongs on the order card,
                          next to the tender picker and the reference box,
                          which is where the money is actually settled. */}
                      <button onClick={() => setIsPosOpen(false)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-fg/70 hover:text-danger font-bold text-xs uppercase tracking-wider transition min-h-[40px]">
                        <ChevronLeft size={13} /> Orders
                      </button>
                    </div>
                  </div>

                  {/* Search + Category pills */}
                  <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/65" />
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
                          className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap text-xs uppercase tracking-wider transition min-h-[40px] shrink-0 ${posCategory === (c.name === 'All' ? 'All' : c.name) ? 'bg-brand text-on-brand shadow-md' : 'bg-white/5 text-fg/75 hover:text-fg hover:bg-white/10'}`}
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
                                  <p className="text-brand-text font-black text-sm mt-1 tabular-nums">₱{Number(c.price).toFixed(2)}</p>
                                  <p className="text-[8px] text-fg/70 uppercase tracking-wide mt-0.5">{(c.items||[]).length} items</p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="flex-1 overflow-y-auto px-3 pb-3 grid grid-cols-3 sm:grid-cols-3 xl:grid-cols-4 gap-3 content-start custom-scrollbar">
                          {posPaged.length === 0 && (
                            <div className="col-span-full flex flex-col items-center justify-center py-16 text-fg/60">
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
                              className={`relative bg-page-bg/60 border rounded-2xl p-3 flex flex-col items-center text-center shadow-elev-1 group min-h-[144px] transition-colors duration-180
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
                              <div className="w-full min-h-[2.4em] flex items-center justify-center">
                                <span className="font-bold text-xs text-fg/80 line-clamp-2 leading-tight">{p.name}</span>
                              </div>
                              {p.activeSalePrice != null ? (
                                <div className="mt-auto pt-1 flex flex-col items-center gap-0.5">
                                  <span className="text-warning font-black text-sm tabular-nums">₱{Number(p.activeSalePrice).toFixed(2)}</span>
                                  <span className="text-fg/65 font-bold text-[10px] tabular-nums line-through">₱{Number(p.basePrice || 0).toFixed(2)}</span>
                                </div>
                              ) : (
                                <span className="text-brand-text font-black mt-auto pt-1 text-sm tabular-nums">₱{Number(p.basePrice || p.price || 0).toFixed(2)}</span>
                              )}
                            </button>
                            );
                          })}
                        </div>
                        {posTotalPages > 1 && (
                          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t white/10 bg-page-bg/40">
                            <button onClick={() => setPosPage(p => Math.max(1, p - 1))} disabled={posPage === 1}
                              className="px-4 py-2 rounded-xl font-bold text-xs uppercase bg-white/5 text-fg/75 hover:text-fg hover:bg-white/10 disabled:opacity-25 transition flex items-center gap-1 min-h-[40px]">
                              <ChevronLeft size={13}/> Prev
                            </button>
                            <span className="text-xs text-fg/65 font-bold">{posPage} / {posTotalPages}</span>
                            <button onClick={() => setPosPage(p => Math.min(posTotalPages, p + 1))} disabled={posPage === posTotalPages}
                              className="px-4 py-2 rounded-xl font-bold text-xs uppercase bg-white/5 text-fg/75 hover:text-fg hover:bg-white/10 disabled:opacity-25 transition flex items-center gap-1 min-h-[40px]">
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
                          <Tag size={11} className="text-brand-text flex-shrink-0" />
                          <span className="text-[10px] text-brand-text font-bold">Pricing applied - up to {best}% off for this client</span>
                        </div>
                      ) : null;
                    })()}
                    {/* Which branch this device is ringing up as - only shown once there's
                        more than one location to choose between (Inventory → Places & Categories). */}
                    {(stockLocations || []).filter(l => l.isActive !== false).length > 1 && (
                      <select value={posBranch} onChange={e => setPosBranch(e.target.value)}
                        title="Which branch is this sale for? (Analytics can compare branches once orders are tagged)"
                        className="w-full bg-brand/10 border border-brand/30 rounded-xl px-3 py-2 text-brand-text font-bold text-xs uppercase tracking-wider outline-none focus:border-brand/60 transition">
                        <option value="">No Branch Set</option>
                        {stockLocations.filter(l => l.isActive !== false).map(l => (
                          <option key={l._id} value={l.name}>{l.name}</option>
                        ))}
                      </select>
                    )}
                    <input type="text"
                      placeholder={BUSINESS_TYPE === 'fb' && posTable === 'Dine-In' && !posClientId
                        ? 'Customer name (blank = Walk-in)'
                        : 'Customer / Driver Name *'}
                      value={posCustomerName} onChange={e => setPosCustomerName(e.target.value)}
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
                      <div key={i} className={`mx-3 mt-2 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${met ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' : 'bg-white/5 text-fg/70 border border-white/8'}`}>
                        <Flame size={12} className={met ? 'text-warning' : 'text-fg/60'} />
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
                              <p key={i} className="text-[10px] text-fg/70 truncate">+ {a.name} ₱{a.price}</p>
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
                                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg/65 text-[10px] font-bold pointer-events-none">%</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {lineDisc > 0 && <p className="text-[10px] text-success font-bold tabular-nums">-₱{lineDisc.toFixed(2)}</p>}
                            <p className="font-black text-brand-text text-sm tabular-nums">₱{lineTotal.toFixed(2)}</p>
                            <button onClick={() => setPosCart(posCart.filter((_, i) => i !== idx))}
                              className="w-8 h-8 flex items-center justify-center text-danger/80 hover:text-danger hover:bg-red-500/10 rounded-lg transition active:scale-90">
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
                      <div className="flex justify-between text-xs text-fg/70 font-bold">
                        <span>Subtotal</span><span>₱{posSubtotal.toFixed(2)}</span>
                      </div>
                      {posItemDiscountAmt > 0 && (
                        <div className="flex justify-between text-xs text-success font-bold">
                          <span>Item Discounts</span><span>−₱{posItemDiscountAmt.toFixed(2)}</span>
                        </div>
                      )}
                      {posDiscountAmt > 0 && (
                        <div className="flex justify-between text-xs text-success font-bold">
                          <span>Order Discount</span><span>−₱{posDiscountAmt.toFixed(2)}</span>
                        </div>
                      )}
                      {posDeliveryFeeNum > 0 && (
                        <div className="flex justify-between text-xs text-fg/70 font-bold">
                          <span>Delivery Fee</span><span>₱{posDeliveryFeeNum.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-baseline pt-1.5 border-t border-white/10">
                        <span className="text-xs text-fg/75 font-bold uppercase tracking-widest">Total</span>
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
                      <span className="ml-auto text-[9px] uppercase tracking-widest font-black text-fg/65">Status: {posReserveOnly ? 'Reserved' : 'Pending'}</span>
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
                        className="flex-1 py-3 bg-brand text-on-brand font-black rounded-xl hover:bg-brand/90 active:scale-98 transition shadow-lg shadow-brand/20 flex items-center justify-center gap-2 min-h-[56px] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                      >
                        <ShoppingCart size={18} className="shrink-0"/>
                        {posSubmitting ? (
                          <span className="uppercase tracking-widest text-sm">Placing…</span>
                        ) : (() => {
                          const itemCount = posCart.reduce((s, c) => s + (c.quantity || 0), 0);
                          if (itemCount === 0) return <span className="uppercase tracking-widest text-sm">Cart Empty</span>;
                          const label = itemCount === 1 ? '1 Item' : `${itemCount} Items`;
                          return (
                            <span className="flex flex-col items-center leading-tight">
                              <span className="text-[10px] uppercase tracking-widest opacity-80">Place Order · {label}</span>
                              <span className="text-lg tabular-nums">₱{posGrandTotal.toFixed(2)}</span>
                            </span>
                          );
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
                            <button onClick={() => setPosActiveSize(null)} className={`py-3 rounded-lg font-bold text-sm border transition ${posActiveSize === null ? 'bg-accent/20 border-accent text-brand-text' : 'bg-page-bg border-gray-700 text-fg hover:border-gray-500'}`}>
                              {posSelectedProduct.baseSize || 'Regular'} <span className="block text-xs mt-1 opacity-70">₱{Number(posSelectedProduct.basePrice || posSelectedProduct.price || 0).toFixed(2)}</span>
                            </button>
                            {(posSelectedProduct.sizes || []).map((s, idx) => (
                              <button key={idx} onClick={() => setPosActiveSize(idx)} className={`py-3 rounded-lg font-bold text-sm border transition ${posActiveSize === idx ? 'bg-accent/20 border-accent text-brand-text' : 'bg-page-bg border-gray-700 text-fg hover:border-gray-500'}`}>
                                {s.name} <span className="block text-xs mt-1 opacity-70">₱{Number(s.price).toFixed(2)}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* --- EXTRAS --- */}
                        {(posSelectedProduct.addOns?.length > 0) && (
                          <div>
                            <label className="text-xs font-bold text-fg/70 mb-2 block uppercase tracking-wider">Add Extras</label>
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
                                    <span className="text-xs text-brand-text font-black">+₱{addon.price}</span>
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
                          <button onClick={() => setPosItemQty(q => Math.max(1, q - 1))} className="w-9 h-9 rounded-lg bg-page-bg border border-gray-700 text-fg text-lg font-black hover:border-accent hover:text-brand-text transition flex items-center justify-center">−</button>
                          <span className="w-8 text-center text-fg font-black text-lg">{posItemQty}</span>
                          <button onClick={() => setPosItemQty(q => q + 1)} className="w-9 h-9 rounded-lg bg-page-bg border border-gray-700 text-fg text-lg font-black hover:border-accent hover:text-brand-text transition flex items-center justify-center">+</button>
                        </div>
                      </div>

                      <div className="flex gap-3 mt-3 shrink-0">
                        <button onClick={() => setPosSelectedProduct(null)} className="flex-1 py-4 bg-page-bg border border-gray-700 text-fg hover:text-brand-text font-bold rounded-xl uppercase tracking-wider text-xs transition">Cancel</button>
                        <button onClick={confirmPosItem} className="flex-1 py-4 bg-accent text-on-brand hover:bg-brand-dark font-black rounded-xl uppercase tracking-wider text-xs shadow-lg shadow-accent/20 transition">Add to Cart</button>
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
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/65 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search name or #order…"
                      value={orderSearch}
                      onChange={e => { setOrderSearch(e.target.value); setOrdersPage(1); }}
                      className="w-full pl-8 pr-3 py-2 bg-page-bg border border-white/10 rounded-lg text-fg text-xs font-bold placeholder-white/25 outline-none focus:border-brand/50 transition"
                    />
                    {orderSearch && (
                      <button onClick={() => setOrderSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/65 hover:text-fg/70 transition">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1 overflow-x-auto bg-page-bg border border-white/10 rounded-xl p-1">
                    {(BUSINESS_TYPE === 'log' ? ['All', 'Logistics', 'Warehouse'] : ['All', 'Kitchen', 'Bar']).map(dept => (
                      <button
                        key={dept}
                        onClick={() => setDepartmentFilter(dept)}
                        className={`px-5 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition whitespace-nowrap ${departmentFilter === dept ? 'bg-brand text-on-brand shadow-md shadow-brand/20' : 'bg-transparent text-fg/75 hover:text-fg/80 hover:bg-white/5'}`}
                      >
                        {dept} View
                      </button>
                    ))}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <button 
                        onClick={() => setIsStatusMenuOpen(!isStatusMenuOpen)}
                        className="flex items-center gap-2 px-4 py-2 bg-brand text-on-brand rounded-lg font-bold uppercase tracking-wider text-xs hover:bg-transparent hover:text-brand-text transition shadow-md"
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
                                className={`px-4 py-3 text-left text-sm font-bold transition hover:bg-white/5 ${orderFilter === filter ? 'bg-brand/10 text-brand-text border-l-4 border-brand' : 'text-fg/70 border-l-4 border-transparent'} ${showBadge ? 'flex items-center justify-between' : ''}`}
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
                      className="px-6 py-2 bg-transparent text-brand-text border border-brand/40 rounded-lg text-sm font-black uppercase tracking-widest hover:bg-brand hover:text-on-brand transition shadow-md whitespace-nowrap flex items-center gap-2"
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
                      <span className="text-[11px] text-fg/55 font-semibold shrink-0">{BUSINESS_TYPE === 'log' ? 'Active' : 'Active tables'}</span>
                      {tables.map(({ table, count, status }) => (
                        <button key={table}
                          onClick={() => { setOrderFilter('All'); setOrderSearch(table); }}
                          title={`${count} order${count !== 1 ? 's' : ''} - click to filter`}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition hover:opacity-90
                            ${ORDER_STATUS_TONE[status] || 'bg-orange-500/15 text-warning'} border-transparent`}>
                          {table}
                          {count > 1 && <span className="bg-white/20 rounded px-1">{count}</span>}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {/* Capped at 3 columns even on the widest screens - a 4th
                    column left each order card too narrow for its item
                    names/discount rows to lay out without squeezing. */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                  {displayOrders.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center py-20 px-6 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-white/5 flex items-center justify-center mb-5">
                        <ShoppingCart size={28} className="text-brand-text/85" />
                      </div>
                      <p className="text-fg/80 font-black uppercase tracking-widest text-sm mb-1.5">
                        No orders in {departmentFilter === 'All' ? 'any' : departmentFilter} queue
                      </p>
                      <p className="text-fg/70 text-xs mb-6 max-w-xs">
                        New orders appear here instantly, whether staff ring them up or customers order by QR.
                      </p>
                      <button
                        onClick={() => setIsPosOpen(true)}
                        className="px-6 py-2.5 bg-brand text-on-brand rounded-lg text-xs font-black uppercase tracking-widest hover:bg-brand-dark transition shadow-md flex items-center gap-2"
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
                      <div key={order._id} className={`bg-surface rounded-xl border border-l-4 flex flex-col shadow-sm transition-all
                        ${allDeptDone && order.status !== 'Completed' ? 'border-green-500/30 border-l-green-500' : `border-white/5 ${statusBorderColor}`}
                        ${(order.status === 'Cancelled' || order.status === 'Voided' || order.status === 'Refunded') ? 'opacity-60' : ''}`}>

                        {/* HEADER - number and actions on one line, then who and
                            how, then status. Only the chevron collapses. */}
                        <div className="px-4 pt-3.5 pb-3 flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-fg font-black text-sm whitespace-nowrap tabular-nums">{order.orderNumber}</span>
                            <div className="flex items-center gap-0.5 flex-shrink-0 text-fg/55">
                              {order.isParked && (
                                <button onClick={() => resumeParked(order._id)} className="mr-1 px-2.5 py-1 bg-brand text-on-brand rounded-md text-[10px] font-black uppercase tracking-wider hover:bg-brand/90 transition flex items-center gap-1">
                                  <ShoppingCart size={11} /> Resume
                                </button>
                              )}
                              {canAmend(order) && (order.clientId || order.clientAccountId) && (
                                <button onClick={() => holdStock(order)} className="p-1.5 rounded-md hover:bg-white/10 hover:text-fg transition" title="Hold this order's stock for the client" aria-label="Hold stock for this order">
                                  <Lock size={14} />
                                </button>
                              )}
                              {canAmend(order) && (
                                <button onClick={() => openAmend(order)} className="p-1.5 rounded-md hover:bg-white/10 hover:text-fg transition" title="Amend order (before completion)" aria-label="Amend order">
                                  <Edit size={14} />
                                </button>
                              )}
                              <button onClick={() => printKitchenTicket(order)} className="p-1.5 rounded-md hover:bg-white/10 hover:text-fg transition" title={`${SEND_TARGET} ticket (no prices)`} aria-label={`Print ${SEND_TARGET} ticket`}>
                                <ChefHat size={14} />
                              </button>
                              {BUSINESS_TYPE !== 'log' ? (
                                <button onClick={() => printOrderSlip(order)} className="p-1.5 rounded-md hover:bg-white/10 hover:text-fg transition" title="Print receipt" aria-label="Print receipt">
                                  <Printer size={14} />
                                </button>
                              ) : (
                                <>
                                  <button onClick={() => printBillingStatement(order)} className="p-1.5 rounded-md hover:bg-white/10 hover:text-fg transition" title="Print billing statement" aria-label="Print billing statement">
                                    <FileText size={14} />
                                  </button>
                                  <button onClick={() => printDeliveryReceipt(order)} className="p-1.5 rounded-md hover:bg-white/10 hover:text-fg transition" title="Print delivery receipt (original + duplicate)" aria-label="Print delivery receipt">
                                    <Truck size={14} />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => setCollapsedOrders(prev => ({ ...prev, [order._id]: !prev[order._id] }))}
                                className="p-1.5 rounded-md hover:bg-white/10 hover:text-fg transition"
                                aria-label={collapsedOrders[order._id] ? 'Expand order' : 'Collapse order'}
                              >
                                {collapsedOrders[order._id] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                              </button>
                            </div>
                          </div>
                          {(order.customerName || order.table) && (
                            <p className="text-[13px] leading-snug min-w-0">
                              {order.customerName && <span className="text-fg font-semibold">{order.customerName}</span>}
                              {order.customerName && order.table && <span className="text-fg/40"> · </span>}
                              {order.table && <span className="text-fg/65">{order.table}</span>}
                            </p>
                          )}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ORDER_STATUS_TONE[order.status] || 'bg-white/10 text-fg/70'}`}>{order.status}</span>
                            {order.revision > 0 && (
                              <span title={(order.amendments || []).map(a => `Rev ${a.revision} · ${a.by}: ${a.reason}`).join('\n')}
                                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400">
                                Rev {order.revision}
                              </span>
                            )}
                            {allDeptDone && order.status !== 'Completed' && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-success flex items-center gap-1">
                                <CheckCircle size={10}/> All done
                              </span>
                            )}
                            <span className="text-fg/50 text-[10px] ml-auto tabular-nums">{new Date(order.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                          </div>
                          {order.orderNotes && (
                            <p className="text-[11px] text-fg/85 bg-yellow-500/10 border-l-2 border-yellow-500/60 rounded-r px-2 py-1 italic">
                              {order.orderNotes}
                            </p>
                          )}
                        </div>

                        {/* DELIVERY / PICKUP DETAILS - only when there is something to show. */}
                        {['Manual Delivery','Pickup','Grab Delivery','Foodpanda','Lalamove'].includes(order.table)
                          && (order.customerPhone || order.deliveryAddress || order.deliveryFee > 0 || order.scheduledTime || order.dispatchStatus) && (
                          <dl className="mx-4 mb-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px]">
                            {order.customerPhone && <><dt className="text-fg/50">Phone</dt><dd className="text-fg/85 tabular-nums">{order.customerPhone}</dd></>}
                            {order.deliveryAddress && <><dt className="text-fg/50">Address</dt><dd className="text-fg/85">{order.deliveryAddress}</dd></>}
                            {order.deliveryFee > 0 && <><dt className="text-fg/50">Delivery fee</dt><dd className="text-fg/85 tabular-nums">₱{order.deliveryFee.toFixed(2)}</dd></>}
                            {order.scheduledTime && <><dt className="text-fg/50">Scheduled</dt><dd className="text-fg/85">{order.scheduledTime}</dd></>}
                            {/* DISPATCH PIPELINE */}
                            {order.dispatchStatus && (
                              <div className="col-span-2 flex items-center gap-1.5 flex-wrap pt-1.5 mt-0.5 border-t border-white/5">
                                <span className="text-fg/50">Dispatch</span>
                                {(['Preparing','Out for Delivery','Awaiting Pickup','Delivered','Picked Up']).map(s => {
                                  const isActive = order.dispatchStatus === s;
                                  return (
                                    <button key={s} onClick={async () => {
                                      const res = await apiFetch(`/api/orders/${order._id}/dispatch`, { method: 'PATCH', body: JSON.stringify({ dispatchStatus: s }) });
                                      if (res.ok) fetchOrders();
                                    }} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition ${isActive ? 'bg-brand text-on-brand' : 'bg-white/5 text-fg/65 hover:bg-white/10 hover:text-fg'}`}>
                                      {s}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </dl>
                        )}

                        {!collapsedOrders[order._id] && (
                          <div className="px-4 pb-4 flex flex-col gap-3 border-t border-white/5 pt-3">
                            <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                              {(BUSINESS_TYPE === 'log' ? ['Logistics', 'Warehouse'] : ['Kitchen', 'Bar']).map(dept => {
                                const deptItems = order.items
                                  .map((item, idx) => ({ ...item, originalIdx: idx }))
                                  .filter(i => (i.department || SEND_TARGET) === dept);
                                if (deptItems.length === 0) return null;
                                if (departmentFilter !== 'All' && departmentFilter !== dept) return null;
                                return (
                                  <div key={dept}>
                                    <h4 className="text-[10px] uppercase text-fg/45 font-bold mb-1 tracking-wider">{dept}</h4>
                                    {deptItems.map(item => (
                                      <div key={item.originalIdx} className="py-1.5 border-b border-white/5 last:border-0">
                                        {/* Name always gets the FULL row width - a long product name
                                            competing side-by-side with the price/discount column was
                                            what squeezed both into an unreadable, overlapping mess on a
                                            narrow (phone-width) POS screen. Price/discount now gets its
                                            own row below instead, same idea as the SC/PWD cards. */}
                                        <span className={`block font-semibold text-sm leading-snug ${item.itemStatus === 'Delivered' ? 'text-fg/70 line-through' : 'text-fg'}`}>
                                          {item.quantity}x {item.name}
                                        </span>
                                        {(item.fulfilledQty || 0) > 0 && (item.fulfilledQty || 0) < (item.quantity || 0) && (
                                          <span className="block text-[9px] font-black uppercase tracking-wider text-emerald-600 mt-0.5">
                                            {item.fulfilledQty} fulfilled · {Math.max(0, (item.quantity || 0) - (item.fulfilledQty || 0))} remaining
                                          </span>
                                        )}
                                        {(item.fulfilledQty || 0) >= (item.quantity || 0) && (item.quantity || 0) > 0 && order.status === 'Partially Fulfilled' && (
                                          <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600 flex items-center gap-0.5 mt-0.5"><Check size={9} /> Fully fulfilled</span>
                                        )}
                                        <div className="flex items-center justify-end gap-1 mt-0.5">
                                            {(order.status === 'Preparing' || order.status === 'Ready') ? (
                                              <>
                                                {item.itemStatus === 'Received' && (
                                                  <button onClick={() => updateItemStatus(order, item.originalIdx, 'Preparing')} className="bg-yellow-500/15 text-warning hover:bg-yellow-500/25 px-2.5 py-0.5 rounded-full text-[10px] font-bold transition">Start prep</button>
                                                )}
                                                {item.itemStatus === 'Preparing' && (
                                                  <button onClick={() => updateItemStatus(order, item.originalIdx, 'Finished')} className="bg-brand/15 text-brand-text hover:bg-brand/25 px-2.5 py-0.5 rounded-full text-[10px] font-bold transition">Mark ready</button>
                                                )}
                                                {item.itemStatus === 'Finished' && departmentFilter === 'All' && (
                                                  <button onClick={() => updateItemStatus(order, item.originalIdx, 'Delivered')} className="bg-green-500/15 text-success hover:bg-green-500/25 px-2.5 py-0.5 rounded-full text-[10px] font-bold transition flex items-center gap-1">
                                                    <Truck size={9} /> Give
                                                  </button>
                                                )}
                                                {item.itemStatus === 'Finished' && departmentFilter !== 'All' && (
                                                  <span className="text-brand-text text-[10px] font-black uppercase flex items-center gap-0.5"><CheckCircle size={10} /> Done</span>
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
                                                // Pricing edits stay in the general "All" queue only - a
                                                // department-filtered fulfillment view (Logistics, Warehouse,
                                                // Kitchen, Bar) is meant to be read-only on price, same as the
                                                // Promo/Complimentary controls elsewhere in this card.
                                                const canEditPct = order.status === 'Pending' && departmentFilter === 'All' && (discountsOpen[order._id] || itemPct > 0);
                                                return (
                                                  <div className="flex flex-col items-end gap-1">
                                                    {/* Discount context sits ABOVE the price, only when one
                                                        actually applies - a card with no discounted items
                                                        reads as a plain, quiet price list instead of every
                                                        row carrying a redundant "0%" edit box. */}
                                                    {effPct > 0 && (
                                                      <div className="flex items-center gap-1.5">
                                                        <span className="text-fg/65 line-through text-[10px] font-mono">₱{lineGross.toFixed(2)}</span>
                                                        <span title={isClientRate ? 'Set by a pricing rule: client rate, customer tier, or bulk quantity break' : 'Discount entered at the register'} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isClientRate ? 'bg-emerald-500/15 text-success' : 'bg-amber-500/15 text-warning'}`}>
                                                          {isClientRate ? `Price rule −${effPct}%` : `Cashier −${effPct}%`}
                                                        </span>
                                                      </div>
                                                    )}
                                                    <div className="flex items-center gap-1.5">
                                                      <span className={`font-mono font-bold text-sm ${effPct > 0 ? 'text-brand-text' : 'text-fg'}`}>
                                                        ₱{(lineGross * (1 - effPct / 100)).toFixed(2)}
                                                      </span>
                                                      {canEditPct && (
                                                        <div className="relative">
                                                          <input
                                                            type="number" min="0" max="100" step="1"
                                                            placeholder="0"
                                                            value={item.discountPercent || ''}
                                                            onChange={e => applyItemDiscount(order._id, item.originalIdx, e.target.value)}
                                                            title="Cashier discount override for this line"
                                                            className="w-12 bg-white/5 border border-white/10 rounded pl-1.5 pr-4 py-0.5 text-fg text-[10px] font-bold outline-none focus:border-brand/60 placeholder:text-fg/30 tabular-nums"
                                                          />
                                                          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-fg/50 text-[9px] font-bold pointer-events-none">%</span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  </div>
                                                );
                                              })()
                                            )}
                                        </div>
                                        {item.isCombo && (item.comboItems || []).length > 0 && (
                                          <div className="pl-5 mt-1 space-y-0.5">
                                            {item.comboItems.map((c, cIdx) => (
                                              <div key={cIdx} className="flex items-center gap-1 text-[10px] text-brand-text">
                                                <ChevronRight size={8} className="flex-shrink-0" /> {c.quantity > 1 ? `${c.quantity}× ` : ''}{c.name}{c.sizeName ? ` (${c.sizeName})` : ''}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                                          <div className="pl-5 mt-1 space-y-0.5">
                                            {item.selectedAddOns.map((addon, aIdx) => (
                                              <div key={aIdx} className="flex justify-between items-center text-[10px] text-fg/70">
                                                <span className="flex items-center gap-1">
                                                  <ChevronRight size={8} className="flex-shrink-0" /> {addon.name} <span className="opacity-70">(+₱{addon.price})</span>
                                                </span>
                                                {order.status === 'Pending' && (
                                                  <button onClick={() => removeAddOnFromOrder(order, item.originalIdx, aIdx)} className="text-fg/70 hover:text-danger transition p-0.5 rounded">
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
                              <div className="flex flex-col gap-1.5 border-t border-white/5 pt-2.5">
                                {isComp ? (
                                  /* ── APPLIED STATE: audit badge ── */
                                  <div className="flex items-start gap-2 bg-white/3 border border-white/10 rounded-lg p-2">
                                    <Gift size={11} className="text-fg/70 flex-shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0 space-y-0.5">
                                      <div className="flex items-center gap-2">
                                        <span className="text-fg/70 text-[10px] font-black uppercase tracking-wider">Complimentary</span>
                                        {order.complimentaryReferenceNumber && (
                                          <span className="text-fg/70 text-[9px] font-mono">{order.complimentaryReferenceNumber}</span>
                                        )}
                                      </div>
                                      <div className="text-fg/70 text-[9px]">
                                        <span className="text-fg/70">Reason:</span> {COMP_REASON_LABELS[order.complimentaryReasonType] || '-'}
                                      </div>
                                      {order.complimentaryReasonNote && (
                                        <div className="text-fg/70 text-[9px] italic truncate">&ldquo;{order.complimentaryReasonNote}&rdquo;</div>
                                      )}
                                      <div className="text-fg/70 text-[9px]">
                                        <span className="text-fg/60">For:</span> {compEmpName} &nbsp;·&nbsp; <span className="text-fg/60">By:</span> {order.complimentaryApprovedBy || activeAdmin?.name || '-'}
                                      </div>
                                      {order.complimentaryApprovedAt && (
                                        <div className="text-fg/60 text-[9px]">{new Date(order.complimentaryApprovedAt).toLocaleString()}</div>
                                      )}
                                    </div>
                                    <button onClick={() => removeComplimentary(order._id)} className="flex-shrink-0 bg-red-500 hover:bg-red-600 text-white p-1 rounded font-black transition" title="Remove Complimentary">
                                      <X size={11} />
                                    </button>
                                  </div>
                                ) : (
                                  /* ── PENDING STATE: collapsed by default - just a toggle
                                      until someone actually needs to comp this order. ── */
                                  <div className="flex flex-col gap-1.5">
                                    <button
                                      onClick={() => setCompFormOpen(prev => ({ ...prev, [order._id]: !prev[order._id] }))}
                                      className="flex items-center gap-1.5 text-left hover:opacity-80 transition"
                                    >
                                      <Gift size={10} className="text-fg/70 flex-shrink-0" />
                                      <span className="text-fg/60 text-[9px] font-bold uppercase tracking-wider">Mark Complimentary</span>
                                      {compFormOpen[order._id] ? <ChevronUp size={11} className="text-fg/70" /> : <ChevronDown size={11} className="text-fg/70" />}
                                    </button>
                                    {!compFormOpen[order._id] ? null : (
                                    <div className="flex flex-col gap-1.5 bg-white/[0.03] border border-white/10 rounded-lg p-2">
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
                              </div>
                            )}

                            {departmentFilter === 'All' && (<div className="border-t border-white/5 pt-3 space-y-1.5">
                              {order.status === 'Completed' && order.paymentMethod && (
                                <div className="flex justify-between text-[11px] text-fg">
                                  <span>Payment</span>
                                  <span className="font-mono text-brand/80 font-bold">{order.paymentMethod}</span>
                                </div>
                              )}
                              {/* Gross earns its own line only when something has
                                  come off. Printing it above an identical Total is
                                  two rows saying one thing. */}
                              {Math.abs(order.subtotal - displayTotal) > 0.005 && (
                                <div className="flex justify-between text-[11px] text-fg/60">
                                  <span>Gross</span><span className="font-mono">₱{order.subtotal.toFixed(2)}</span>
                                </div>
                              )}
                              {vatOn && (
                                <div className="flex justify-between items-center text-[11px] text-fg">
                                  <div className="flex items-center gap-2">
                                    {/* Rate comes from the ORDER, not from settings - an order rung
                                        up before VAT was switched on genuinely carries 0%. */}
                                    <span>VAT ({order.vatRate > 0 ? (order.vatRate * 100).toFixed(0) : 0}%)</span>
                                    {/* Read-only. VAT is configured in Settings and exemption comes
                                        from the SC/PWD control below - there is no per-order VAT
                                        switch, because a cashier silently zeroing output VAT on one
                                        sale is exactly what a tax audit looks for. */}
                                    {order.isVatExempt && (
                                      <span className="bg-amber-400/15 border border-amber-400/30 text-warning px-1.5 py-0.5 rounded text-[9px] uppercase font-black">
                                        SC/PWD Exempt
                                      </span>
                                    )}
                                  </div>
                                  <span className="font-mono">₱{order.vatAmount.toFixed(2)}</span>
                                </div>
                              )}
                              {(() => {
                                const promoDiscounts = discounts.filter(d => !d.name.toLowerCase().match(/pwd|senior/));
                                const scpwdDiscounts = discounts.filter(d => d.name.toLowerCase().match(/pwd|senior/));
                                const hasScpwd = order.items.some(i => i.discountPercent > 0);
                                const hasPromo = order.discountPercent > 0 && order.discountType !== 'SC/PWD';
                                const anyDiscount = hasPromo || hasScpwd || displayDiscount > 0;
                                const open = discountsOpen[order._id] ?? anyDiscount;
                                // Nothing to offer and nothing applied: say so in one
                                // quiet line rather than rendering an empty control.
                                if (order.status !== 'Pending' && !anyDiscount) return null;
                                return (
                                  <>
                                    {order.status === 'Pending' && (
                                      <button
                                        onClick={() => setDiscountsOpen(prev => ({ ...prev, [order._id]: !open }))}
                                        className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-fg/60 hover:text-fg transition py-0.5"
                                      >
                                        <span className="flex items-center gap-1.5">
                                          <Tag size={10} />
                                          {anyDiscount ? 'Discount applied' : 'Add a discount'}
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                          {/* Only while shut - the row below shows the
                                              same figure once it is open. */}
                                          {!open && displayDiscount > 0 && (
                                            <span className="text-danger font-mono">-₱{displayDiscount.toFixed(2)}</span>
                                          )}
                                          {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                        </span>
                                      </button>
                                    )}
                                    {(open || order.status !== 'Pending') && (
                                    <div className="flex justify-between items-center text-[11px] text-fg border-b border-white/5 pb-1.5">
                                      <div className="flex items-center gap-2 flex-1 pr-2">
                                        <span className="whitespace-nowrap uppercase tracking-wider text-[9px]">Promo</span>
                                        {order.status === 'Pending' && (
                                          hasScpwd ? (
                                            <span className="text-[9px] text-fg italic ml-auto">SC/PWD active</span>
                                          ) : (
                                            <div className="flex gap-1 items-center flex-1 justify-end">
                                              <select
                                                className="w-full max-w-[130px] bg-page-bg border border-white/10 rounded px-1 text-[10px] text-fg outline-none h-6"
                                                value={discountInputs[order._id] || ''}
                                                onChange={(e) => setDiscountInputs(prev => ({ ...prev, [order._id]: e.target.value }))}
                                              >
                                                <option value="">No promo</option>
                                                {promoDiscounts.map(d => <option key={d._id} value={d.percentage}>{d.name} ({d.percentage}%)</option>)}
                                              </select>
                                              <button onClick={() => applyDiscount(order._id)} className="bg-accent hover:bg-accent/80 text-on-brand hover:text-fg px-2 rounded font-black transition h-6 flex items-center border border-accent/20"><Check size={12} /></button>
                                              {order.discountPercent > 0 && order.discountType !== 'SC/PWD' && (
                                                <button onClick={() => applyDiscount(order._id, true)} className="bg-red-500 text-white px-2 rounded font-black h-6 border border-red-500 flex items-center"><X size={12} /></button>
                                              )}
                                            </div>
                                          )
                                        )}
                                      </div>
                                      <span className="text-danger whitespace-nowrap font-mono">-₱{displayDiscount.toFixed(2)}</span>
                                    </div>
                                    )}
                                    {open && scpwdDiscounts.length > 0 && order.status === 'Pending' && (
                                      <div className="border-b border-white/5 pb-1.5 space-y-1">
                                        {/* The discount belongs to a named card. Asked for here, while
                                            the customer is still at the counter - the sale will not
                                            complete without it. */}
                                        {hasScpwd && (() => {
                                          const entry = scPwdEntry?.[order._id] || {};
                                          const saved = order.scPwdName && order.scPwdIdNumber;
                                          return (
                                            <div className={`rounded-lg px-2 py-2 mb-1.5 border ${saved ? 'border-green-500/25 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
                                              {saved ? (
                                                <p className="text-[10px] text-fg/85">
                                                  <span className="font-bold">{order.scPwdKind || 'SC/PWD'}:</span> {order.scPwdName} · {order.scPwdIdNumber}
                                                </p>
                                              ) : (
                                                <>
                                                  <p className="text-[10px] font-bold text-warning mb-1.5">Card details required before payment</p>
                                                  <div className="flex flex-wrap gap-1.5">
                                                    <select value={entry.kind || 'Senior Citizen'}
                                                      onChange={e => setScPwdEntry(prev => ({ ...prev, [order._id]: { ...entry, kind: e.target.value } }))}
                                                      aria-label="Card type"
                                                      className="bg-page-bg border border-white/10 rounded px-1.5 py-1 text-[10px] text-fg outline-none">
                                                      <option>Senior Citizen</option>
                                                      <option>PWD</option>
                                                    </select>
                                                    <input type="text" value={entry.name || ''} placeholder="Cardholder name"
                                                      onChange={e => setScPwdEntry(prev => ({ ...prev, [order._id]: { ...entry, name: e.target.value } }))}
                                                      aria-label="Cardholder name"
                                                      className="flex-1 min-w-[110px] bg-page-bg border border-white/10 rounded px-2 py-1 text-[10px] text-fg outline-none focus:border-brand" />
                                                    <input type="text" value={entry.idNumber || ''} placeholder="ID number"
                                                      onChange={e => setScPwdEntry(prev => ({ ...prev, [order._id]: { ...entry, idNumber: e.target.value } }))}
                                                      aria-label="Card ID number"
                                                      className="w-[110px] bg-page-bg border border-white/10 rounded px-2 py-1 text-[10px] text-fg font-mono outline-none focus:border-brand" />
                                                    <button onClick={() => saveScPwdId?.(order._id)}
                                                      className="bg-brand text-on-brand px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider hover:bg-brand/90 transition">
                                                      Save
                                                    </button>
                                                  </div>
                                                </>
                                              )}
                                            </div>
                                          );
                                        })()}
                                        {hasPromo ? (
                                          <span className="text-[9px] uppercase tracking-wider text-fg italic">SC/PWD - Promo active</span>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() => setScpwdOpen(prev => ({ ...prev, [order._id]: !prev[order._id] }))}
                                              className="text-[9px] uppercase tracking-wider text-brand-text font-black flex items-center gap-1 hover:opacity-80 transition"
                                            >
                                              SC/PWD (per item) {scpwdOpen[order._id] ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                            </button>
                                            {scpwdOpen[order._id] && (
                                              // Fully stacked, one item per block - name gets the whole
                                              // row's width on its own line, controls sit on the row below.
                                              // A side-by-side layout (name + select sharing one row) left
                                              // almost no room for a real item name on a phone-width POS
                                              // screen: it either truncated into "1x SPEC…" or, worse, wrapped
                                              // one character per line when the available width collapsed.
                                              <div className="max-h-[180px] overflow-y-auto custom-scrollbar space-y-2 pt-1 pr-1">
                                                {order.items.map((item, idx) => (
                                                  <div key={idx} className="bg-white/[0.03] rounded-lg px-2 py-1.5">
                                                    <span className="block text-[11px] text-fg font-semibold leading-snug">{item.quantity}x {item.name}</span>
                                                    <div className="flex items-center justify-end gap-1.5 mt-1">
                                                      {item.discountPercent > 0 && (
                                                        <span className="text-brand-text font-mono text-[10px] whitespace-nowrap font-bold">-{item.discountPercent}%</span>
                                                      )}
                                                      <select
                                                        className="bg-page-bg border border-white/10 rounded text-[10px] text-fg outline-none px-1.5 py-1 h-7 cursor-pointer w-[110px]"
                                                        value={item.discountPercent || ''}
                                                        onChange={(e) => applyItemDiscount(order._id, idx, e.target.value)}
                                                      >
                                                        <option value="">No disc</option>
                                                        {scpwdDiscounts.map(d => (
                                                          <option key={d._id} value={d.percentage}>{d.name} ({d.percentage}%)</option>
                                                        ))}
                                                      </select>
                                                    </div>
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
                              <div className="flex justify-between items-baseline font-black text-base pt-2 border-t border-white/5">
                                <span className="text-fg">Total</span>
                                <span className="text-fg tabular-nums">₱{displayTotal.toFixed(2)}</span>
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
                                    <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500/10 text-danger py-2.5 px-4 rounded-lg hover:bg-red-500 hover:text-fg font-black text-xs transition uppercase border border-red-500/20">Drop</button>
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
                                        <Gift size={12} className="text-warning" />
                                        <span className="text-warning text-[10px] font-black uppercase tracking-widest">No Payment - Complimentary</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => updateStatus(order._id, 'Preparing')}
                                          className="flex-1 bg-yellow-500 text-fg py-2.5 rounded-lg hover:bg-yellow-400 font-black text-xs uppercase tracking-widest transition"
                                        >
                                          Send to {SEND_TARGET}
                                        </button>
                                        <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500/10 text-danger py-2.5 px-4 rounded-lg hover:bg-red-500 hover:text-fg font-black text-xs transition uppercase border border-red-500/20">Drop</button>
                                      </div>
                                    </div>
                                  );
                                }
                                return (() => {
                                  const isCash = displayPayment === 'Cash';
                                  const isCheck = displayPayment === 'Check';
                                  const isQr = displayPayment === 'QR';
                                  // A check number / QR confirmation number is the only handle on
                                  // that money afterwards, so the sale can't be sent without one.
                                  const ref = (paymentRefs[order._id] || '').trim();
                                  const needsRef = isCheck || isQr;
                                  const missingRef = needsRef && !ref;
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
                                          <option value="Check">Check</option>
                                          <option value="Credit">Credit</option>
                                          {/* Custom sub-accounts under a cash/bank/checks parent -
                                              e.g. "GoTyme" added in Payment Routing - show up here
                                              live via the socket-driven activePaymentMethods list. */}
                                          {(paymentMethodGroups?.['In-Store'] || [])
                                            .filter(m => m.kind === 'custom')
                                            .map(m => <option key={m.code} value={m.name}>{m.name}</option>)}
                                        </optgroup>
                                        <optgroup label="E-Wallets">
                                          <option value="GCash">GCash</option>
                                          <option value="Maya">Maya</option>
                                          <option value="Maribank">Maribank / Seabank</option>
                                          <option value="Other E-Wallet">Other E-Wallet</option>
                                          <option value="QR">QR / Scan to Pay</option>
                                          {(paymentMethodGroups?.['E-Wallets'] || [])
                                            .filter(m => m.kind === 'custom')
                                            .map(m => <option key={m.code} value={m.name}>{m.name}</option>)}
                                        </optgroup>
                                        {(paymentMethodGroups?.['Credit'] || []).some(m => m.kind === 'custom') && (
                                          <optgroup label="On-Account Vendors">
                                            {paymentMethodGroups['Credit'].filter(m => m.kind === 'custom').map(m => (
                                              <option key={m.code} value={m.name}>{m.name}</option>
                                            ))}
                                          </optgroup>
                                        )}
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
                                          // 111000/112000/113000/220000 are already covered above via
                                          // paymentMethodGroups (the live COA-derived list) - only
                                          // Delivery Partners still needs this older per-parent scan.
                                          const PARENT_LABEL = {
                                            '120000': 'Custom Delivery Partners',
                                          };
                                          const STANDARD_NAMES = new Set(['Cash','Bank Transfer','Check','GCash','Maya','Maribank','Other E-Wallet','QR','Grab Delivery','Lalamove','Foodpanda','Manual Delivery','Pickup','On Account','Cash in Bank','E-Wallet']);
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
                                      {/* Scan to pay, at the moment of paying. Offered for the
                                          tenders the customer actually scans for - QR and the
                                          e-wallets - so the cashier turns the screen round, the
                                          customer scans, and the confirmation number goes in the
                                          box directly below. */}
                                      {payQrImage && ['QR', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'].includes(displayPayment) && (
                                        <button
                                          onClick={() => setPayQrOpen(true)}
                                          title="Show the payment QR for the customer to scan"
                                          className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-brand/15 text-brand-text hover:bg-brand/25 font-bold text-xs uppercase tracking-wider transition min-h-[38px]"
                                        >
                                          <QrCode size={13} /> Show Pay QR
                                        </button>
                                      )}
                                      {needsRef && (
                                        <div className="flex flex-col gap-1.5">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-fg/70 font-bold uppercase tracking-widest whitespace-nowrap">
                                              {isCheck ? 'Check No.' : 'Ref No.'}
                                            </span>
                                            <input
                                              type="text"
                                              placeholder={isCheck ? 'Required' : 'Confirmation no.'}
                                              value={paymentRefs[order._id] || ''}
                                              onChange={(e) => setPaymentRefs(prev => ({ ...prev, [order._id]: e.target.value }))}
                                              className={`flex-1 bg-white/5 border rounded-lg px-2 py-1.5 text-sm font-mono text-fg outline-none ${missingRef ? 'border-red-500/60' : 'border-white/10 focus:border-accent/50'}`}
                                              aria-label={isCheck ? 'Check number' : 'Payment reference number'}
                                            />
                                          </div>
                                          {/* Post-dated checks are normal - this is the earliest
                                              the check can actually be banked. */}
                                          {isCheck && (
                                            <div className="flex items-center gap-2">
                                              <span className="text-[10px] text-fg/70 font-bold uppercase tracking-widest whitespace-nowrap">Check Date</span>
                                              <input
                                                type="date"
                                                value={paymentCheckDates[order._id] || ''}
                                                onChange={(e) => setPaymentCheckDates(prev => ({ ...prev, [order._id]: e.target.value }))}
                                                className="flex-1 bg-white/5 border border-white/10 focus:border-accent/50 rounded-lg px-2 py-1.5 text-sm font-mono text-fg outline-none"
                                                aria-label="Check date"
                                              />
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {isCash && (
                                        <div className="flex flex-col gap-1">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-fg/70 font-bold uppercase tracking-widest whitespace-nowrap">Cash In</span>
                                            <input
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              placeholder={`≥ ₱${displayTotal.toFixed(2)}`}
                                              value={cashTendered[order._id] || ''}
                                              onChange={(e) => setCashTendered(prev => ({ ...prev, [order._id]: e.target.value }))}
                                              className="flex-1 bg-white/5 border border-white/10 focus:border-accent/50 rounded-lg px-2 py-1.5 text-sm font-mono text-fg outline-none"
                                              aria-label="Cash tendered"
                                            />
                                          </div>
                                          {changeDue !== null && (
                                            <div className={`flex justify-between text-xs font-black px-1 ${isUnderpaid ? 'text-danger' : 'text-success'}`}>
                                              <span>{isUnderpaid ? 'SHORT' : 'CHANGE'}</span>
                                              <span className="font-mono">₱{Math.abs(changeDue).toFixed(2)}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {/* One thing to press, and two ways out.
                                          Three solid blocks of colour - green, red,
                                          amber - all shouted equally, so the eye had
                                          to read every one to find the ordinary
                                          action. Taking a payment is what happens on
                                          almost every order; dropping it and splitting
                                          it are the exceptions, and now look like it. */}
                                      <button
                                        disabled={isUnderpaid || missingRef}
                                        onClick={() => {
                                          // Seed the selection with the default so it persists even if untouched.
                                          if (paymentSelections[order._id] === undefined) {
                                            setPaymentSelections(prev => ({ ...prev, [order._id]: displayPayment }));
                                          }
                                          setTimeout(() => updateStatus(order._id, 'Preparing'), 0);
                                        }}
                                        className={`w-full py-3 rounded-lg font-black text-sm transition ${(isUnderpaid || missingRef) ? 'bg-white/10 text-fg/50 cursor-not-allowed' : 'bg-accent text-on-brand hover:bg-accentShadow'}`}
                                      >
                                        {missingRef ? `${isCheck ? 'Check No.' : 'Ref No.'} Required` : `Pay & send to ${SEND_TARGET}`}
                                      </button>
                                      <div className="flex gap-2">
                                        {BUSINESS_TYPE === 'log' && (order.items?.length > 0) && (
                                          <button onClick={() => openPartial(order)} className="flex-1 border border-amber-500/30 text-warning py-2 rounded-lg hover:bg-amber-500/10 font-bold text-[11px] transition">
                                            Partial fulfill
                                          </button>
                                        )}
                                        <button onClick={() => updateStatus(order._id, 'Cancelled')} className="flex-1 border border-red-500/30 text-danger py-2 rounded-lg hover:bg-red-500/10 font-bold text-[11px] transition">
                                          Drop
                                        </button>
                                      </div>
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
                                    <div className="flex flex-col gap-1 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                                      <span className="flex items-center gap-2 text-warning text-[11px] font-bold">
                                        <Package size={12} className="flex-shrink-0" />
                                        Partially fulfilled · {doneQty}/{totalQty} units{order.depositRemaining > 0 ? ' · prepaid' : ''}
                                      </span>
                                      {remainingValue > 0 && (
                                        <span className="text-fg/75 text-[11px]">Remaining to fulfill: ₱{remainingValue.toFixed(2)}</span>
                                      )}
                                    </div>
                                    <button onClick={() => openPartial(order)} className="w-full bg-accent text-on-brand py-2.5 rounded-lg hover:bg-accentShadow font-black text-xs uppercase tracking-widest transition">
                                      Fulfill Remaining
                                    </button>
                                    <button onClick={() => dropRemaining(order)} className="w-full border border-red-500/30 text-danger py-2 rounded-lg hover:bg-red-500/10 font-bold text-[11px] transition">Drop remaining</button>
                                  </div>
                                );
                              })()}

                              {order.status === 'Preparing' && (
                                <div className="flex flex-col gap-2">
                                  {deliveredCount > 0 && (
                                    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                                      <Truck size={12} className="text-success flex-shrink-0" />
                                      <span className="text-success text-[11px] font-bold">{deliveredCount}/{viewItems.length} given to customer</span>
                                    </div>
                                  )}
                                  {departmentFilter !== 'All' ? (
                                    // Kitchen / Bar view: scope progress to this dept only
                                    allDeptDone ? (
                                      <div className="flex items-center justify-center gap-2 bg-green-500/10 border border-green-500/20 text-success rounded-lg text-[10px] font-bold uppercase tracking-widest py-2.5">
                                        <CheckCircle size={11} /> All {departmentFilter === 'All' ? '' : departmentFilter + ' '}Items Done
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-center bg-black/20 border border-white/5 text-fg/70 rounded-lg text-[10px] font-bold uppercase tracking-widest py-2.5">
                                        In Preparation... ({deptDoneCount}/{viewItems.length})
                                      </div>
                                    )
                                  ) : allDelivered ? (
                                    <button onClick={() => updateStatus(order._id, 'Completed')} className="w-full bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-500 font-black uppercase tracking-widest text-xs transition flex items-center justify-center gap-2">
                                      <CheckCircle size={13} /> Complete Order
                                    </button>
                                  ) : order.items.every(i => i.itemStatus === 'Finished' || i.itemStatus === 'Delivered') ? (
                                    <div className="flex items-center justify-center gap-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-lg text-[11px] font-bold py-2.5">
                                      <Truck size={11} /> Give items above to complete
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-center bg-white/[0.03] border border-white/5 text-fg/65 rounded-lg text-[11px] font-semibold py-2.5">
                                      In preparation…
                                    </div>
                                  )}
                                  {departmentFilter === 'All' && !allDelivered && (
                                    <button onClick={() => updateStatus(order._id, 'Cancelled')} className="w-full border border-red-500/30 text-danger py-2 rounded-lg hover:bg-red-500/10 font-bold text-[11px] transition">Drop order</button>
                                  )}
                                </div>
                              )}

                              {order.status === 'Ready' && departmentFilter === 'All' && (
                                <div className="flex flex-col gap-2">
                                  {deliveredCount > 0 && (
                                    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                                      <Truck size={12} className="text-success flex-shrink-0" />
                                      <span className="text-success text-[10px] font-black uppercase tracking-widest">{deliveredCount}/{order.items.length} Given</span>
                                    </div>
                                  )}
                                  <div className="flex gap-2">
                                    <button onClick={() => updateStatus(order._id, 'Completed')} className="flex-1 bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-500 font-black uppercase tracking-widest text-xs transition">Mark All Delivered</button>
                                    <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500/10 text-danger py-2.5 px-3 rounded-lg hover:bg-red-500 hover:text-fg font-black text-xs transition uppercase border border-red-500/20">Drop</button>
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
                                    <Clock size={13} className="text-warning" />
                                    <span className="text-warning text-[10px] font-black uppercase tracking-widest">Partially Delivered</span>
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


            {amendModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !amendModal.busy && setAmendModal(null)}>
                <div role="dialog" aria-modal="true" aria-labelledby="amend-title" className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h2 id="amend-title" className="font-black text-fg text-lg">Amend {amendModal.order.orderNumber}</h2>
                  <p className="text-xs text-fg/70 mt-1 mb-4">Correct the order before it is completed. Set 0 to remove a line. Prices are recalculated, so a smaller quantity can lose a bulk discount. The client sees the change and the reason in their portal.</p>
                  <div className="space-y-2 mb-3">
                    {amendModal.order.items.map((it, i) => {
                      const changed = Number(amendModal.qty[i]) !== Number(it.quantity);
                      return (
                        <div key={i} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${changed ? 'border-sky-500/40 bg-sky-500/5' : 'border-white/10'}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-fg font-bold truncate">{it.name}</p>
                            <p className="text-[10px] text-fg/60">Ordered {it.quantity}{changed ? ` → ${amendModal.qty[i] || 0}` : ''}</p>
                          </div>
                          <label htmlFor={`amend-qty-${i}`} className="sr-only">New quantity for {it.name}</label>
                          <input id={`amend-qty-${i}`} type="number" min="0" step={BUSINESS_TYPE === 'log' ? '1' : 'any'} value={amendModal.qty[i]}
                            onChange={e => setAmendModal(m => ({ ...m, qty: m.qty.map((q, j) => (j === i ? e.target.value : q)), error: '' }))}
                            className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-fg text-right tabular-nums outline-none focus:border-brand" />
                        </div>
                      );
                    })}
                    {amendModal.adds.map((a, k) => (
                      <div key={a.productId} className="flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-fg font-bold truncate">{a.name}</p>
                          <p className="text-[10px] text-success">New line · ₱{Number(a.price).toFixed(2)} each</p>
                        </div>
                        <label htmlFor={`amend-add-${k}`} className="sr-only">Quantity for {a.name}</label>
                        <input id={`amend-add-${k}`} type="number" min="1" step={BUSINESS_TYPE === 'log' ? '1' : 'any'} value={a.quantity}
                          onChange={e => setAmendModal(m => ({ ...m, adds: m.adds.map((x, j) => (j === k ? { ...x, quantity: e.target.value } : x)), error: '' }))}
                          className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-fg text-right tabular-nums outline-none focus:border-brand" />
                        <button onClick={() => setAmendModal(m => ({ ...m, adds: m.adds.filter((_, j) => j !== k) }))} className="p-1 text-fg/60 hover:text-danger" aria-label={`Remove ${a.name}`}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="relative mb-4">
                    <label htmlFor="amend-search" className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Add a product</label>
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/50 pointer-events-none" />
                      <input id="amend-search" type="text" value={amendModal.search} autoComplete="off"
                        onChange={e => setAmendModal(m => ({ ...m, search: e.target.value }))}
                        placeholder="Search by name or code…"
                        className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-fg outline-none focus:border-brand" />
                    </div>
                    {amendModal.search.trim().length > 0 && (() => {
                      const q = amendModal.search.trim().toLowerCase();
                      const taken = new Set(amendModal.adds.map(a => a.productId));
                      const hits = amendableProducts
                        .filter(p => !taken.has(String(p._id)) && (p.name.toLowerCase().includes(q) || String(p.productCode || '').toLowerCase().includes(q)))
                        .slice(0, 6);
                      return (
                        <div className="absolute z-10 left-0 right-0 mt-1 bg-sidebar-bg border border-white/10 rounded-lg shadow-xl overflow-hidden">
                          {hits.length === 0 ? (
                            <p className="px-3 py-2.5 text-xs text-fg/60">No matching product. Items that need options picked must go on a new order.</p>
                          ) : hits.map(p => {
                            const onOrder = amendModal.order.items.some(it => String(it.productId) === String(p._id));
                            return (
                              <button key={p._id}
                                onClick={() => setAmendModal(m => ({ ...m, search: '', adds: [...m.adds, { productId: String(p._id), name: p.name, price: p.basePrice, quantity: '1' }] }))}
                                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/5 transition">
                                <span className="text-sm text-fg truncate">{p.name}{onOrder && <span className="text-[10px] text-fg/60"> · adds to the existing line</span>}</span>
                                <span className="text-xs text-fg/70 tabular-nums shrink-0">₱{Number(p.basePrice).toFixed(2)}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  <label htmlFor="amend-reason" className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">Reason *</label>
                  <textarea id="amend-reason" rows={2} value={amendModal.reason}
                    onChange={e => setAmendModal(m => ({ ...m, reason: e.target.value, error: '' }))}
                    placeholder="e.g. Client called - only needs 50 sacks"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand mb-3" />
                  {(amendModal.order.amendments || []).length > 0 && (
                    <div className="mb-3 text-[11px] text-fg/65 space-y-1">
                      {amendModal.order.amendments.map(a => (
                        <p key={a.revision}>Rev {a.revision} · {a.by} · {a.changes.map(c => `${c.name} ${c.from}→${c.to}`).join(', ')} · “{a.reason}”</p>
                      ))}
                    </div>
                  )}
                  {amendModal.error && <p className="text-xs text-danger mb-3" role="alert">{amendModal.error}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => setAmendModal(null)} disabled={amendModal.busy} className="flex-1 border border-white/10 text-fg/80 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-white/5">Cancel</button>
                    <button onClick={submitAmend} disabled={amendModal.busy} className="flex-1 bg-brand text-on-brand py-2.5 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-brand/90 disabled:opacity-50">
                      {amendModal.busy ? 'Saving…' : 'Amend Order'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
  );
}
