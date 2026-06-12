import React from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag } from 'lucide-react';

// ── AuditTab — extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
export default function AuditTab({ ctx }) {
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
    auditLogs, auditLogsPage, auditLogsTotal, AUDIT_LOGS_PAGE_SIZE, fetchAuditLogs,
  } = ctx;

  const now    = new Date();
  const cutoff = auditFilter === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
               : auditFilter === '7d'  ? new Date(now - 7 * 86400000)
               : auditFilter === '30d' ? new Date(now - 30 * 86400000)
               : new Date(0);

  const allOrdersPool    = [...orders, ...archivedOrders];
  const inRange          = allOrdersPool.filter(o => new Date(o.createdAt) >= cutoff);
  const cancelled        = inRange.filter(o => o.status === 'Cancelled' || o.status === 'Voided');
  const comps            = inRange.filter(o => o.isComplimentary && o.status === 'Completed');
  const discounted       = inRange.filter(o => !o.isComplimentary && o.status === 'Completed' && (o.discount || 0) > 0);
  const staffList        = [...new Set(inRange.filter(o => o.cashier && o.cashier !== 'System').map(o => o.cashier))].sort();
  const totalCancelledValue  = cancelled.reduce((s, o) => s + (o.subtotal || 0), 0);
  const totalCompValue       = comps.reduce((s, o) => s + (o.subtotal || 0), 0);
  const totalDiscountValue   = discounted.reduce((s, o) => s + (o.discount || 0), 0);
  const fmtDate = (d) => { const dt = new Date(d); return dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' ' + dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }); };
  const cancelTotalPages = Math.ceil(cancelled.length / AUDIT_PAGE_SIZE);
  const compTotalPages   = Math.ceil(comps.length   / AUDIT_PAGE_SIZE);
  const discTotalPages   = Math.ceil(discounted.length / AUDIT_PAGE_SIZE);
  const staffTotalPages  = Math.ceil(staffList.length  / AUDIT_PAGE_SIZE);
  const pagedCancelled   = cancelled.slice((auditCancelPage - 1) * AUDIT_PAGE_SIZE, auditCancelPage * AUDIT_PAGE_SIZE);
  const pagedComps       = comps.slice((auditCompPage - 1) * AUDIT_PAGE_SIZE, auditCompPage * AUDIT_PAGE_SIZE);
  const pagedDiscounted  = discounted.slice((auditDiscPage - 1) * AUDIT_PAGE_SIZE, auditDiscPage * AUDIT_PAGE_SIZE);
  const pagedStaff       = staffList.slice((auditStaffPage - 1) * AUDIT_PAGE_SIZE, auditStaffPage * AUDIT_PAGE_SIZE);

  const PagBar = ({ page, total, prev, next }) => total <= 1 ? null : (
    <div className="flex justify-between items-center border-t border-white/5 px-5 py-3 flex-shrink-0">
      <button onClick={prev} disabled={page === 1} className={`px-3 py-1 rounded text-[10px] font-black uppercase tracking-wider transition ${page === 1 ? 'text-white/15 cursor-not-allowed' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>← Prev</button>
      <span className="text-[10px] text-white/30 font-bold tracking-widest">PAGE {page} OF {total}</span>
      <button onClick={next} disabled={page === total} className={`px-3 py-1 rounded text-[10px] font-black uppercase tracking-wider transition ${page === total ? 'text-white/15 cursor-not-allowed' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>Next →</button>
    </div>
  );

  return (
          <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">

            {/* Header + Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                  <ShieldCheck size={20} className="text-brand" /> Audit Report
                </h2>
                <p className="text-white/30 text-xs font-medium mt-0.5">Exception log — cancelled orders, complimentaries, and discounts</p>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {[['today','Today'],['7d','7 Days'],['30d','30 Days'],['all','All Time']].map(([val, lbl]) => (
                  <button key={val}
                    onClick={() => { setAuditFilter(val); setAuditCancelPage(1); setAuditCompPage(1); setAuditDiscPage(1); setAuditStaffPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition ${auditFilter === val ? 'bg-brand text-white' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-surface border border-white/8 rounded-xl p-4">
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider mb-1">Cancelled / Voided</p>
                <p className="text-2xl font-black text-red-400">{cancelled.length}</p>
                <p className="text-[10px] text-red-400/60 font-bold mt-0.5">₱{totalCancelledValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lost</p>
              </div>
              <div className="bg-surface border border-white/8 rounded-xl p-4">
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider mb-1">Complimentary</p>
                <p className="text-2xl font-black text-yellow-400">{comps.length}</p>
                <p className="text-[10px] text-yellow-400/60 font-bold mt-0.5">₱{totalCompValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} waived</p>
              </div>
              <div className="bg-surface border border-white/8 rounded-xl p-4">
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider mb-1">Discounts Given</p>
                <p className="text-2xl font-black text-brand">{discounted.length}</p>
                <p className="text-[10px] text-brand/60 font-bold mt-0.5">₱{totalDiscountValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} off</p>
              </div>
              <div className="bg-surface border border-white/8 rounded-xl p-4">
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider mb-1">Active Staff</p>
                <p className="text-2xl font-black text-white">{staffList.length}</p>
                <p className="text-[10px] text-white/30 font-bold mt-0.5">in period</p>
              </div>
            </div>

            {/* Cancelled / Voided Table */}
            <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2">
                <XCircle size={14} className="text-red-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Cancelled &amp; Voided Orders</h3>
                <span className="ml-auto text-[10px] bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-bold">{cancelled.length}</span>
              </div>
              {cancelled.length === 0 ? (
                <p className="text-white/20 text-sm p-6 text-center font-bold">No cancelled or voided orders in this period.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[540px]">
                      <thead>
                        <tr className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                          <th className="px-5 py-2.5">Date / Time</th>
                          <th className="px-5 py-2.5">Customer</th>
                          <th className="px-5 py-2.5">Cashier</th>
                          <th className="px-5 py-2.5 text-right">Amount</th>
                          <th className="px-5 py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedCancelled.map(o => (
                          <tr key={o._id} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition">
                            <td className="px-5 py-2.5 text-xs text-white/40 font-mono">{fmtDate(o.createdAt)}</td>
                            <td className="px-5 py-2.5 text-xs text-white/70 font-bold">{o.customerName || '—'}</td>
                            <td className="px-5 py-2.5 text-xs text-white/40">{o.cashier || '—'}</td>
                            <td className="px-5 py-2.5 text-xs text-right font-mono text-red-400">₱{(o.subtotal || 0).toFixed(2)}</td>
                            <td className="px-5 py-2.5">
                              <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${o.status === 'Voided' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>{o.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PagBar page={auditCancelPage} total={cancelTotalPages}
                    prev={() => setAuditCancelPage(p => Math.max(p - 1, 1))}
                    next={() => setAuditCancelPage(p => Math.min(p + 1, cancelTotalPages))} />
                </>
              )}
            </div>

            {/* Complimentary Orders Table */}
            <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2">
                <Gift size={14} className="text-yellow-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Complimentary Orders</h3>
                <span className="ml-auto text-[10px] bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded-full font-bold">{comps.length}</span>
              </div>
              {comps.length === 0 ? (
                <p className="text-white/20 text-sm p-6 text-center font-bold">No complimentary orders in this period.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[560px]">
                      <thead>
                        <tr className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                          <th className="px-5 py-2.5">Date / Time</th>
                          <th className="px-5 py-2.5">Customer</th>
                          <th className="px-5 py-2.5">Reason</th>
                          <th className="px-5 py-2.5">Cashier</th>
                          <th className="px-5 py-2.5 text-right">Value Waived</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedComps.map(o => (
                          <tr key={o._id} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition">
                            <td className="px-5 py-2.5 text-xs text-white/40 font-mono">{fmtDate(o.createdAt)}</td>
                            <td className="px-5 py-2.5 text-xs text-white/70 font-bold">{o.customerName || '—'}</td>
                            <td className="px-5 py-2.5 text-xs text-yellow-400/80">{COMP_REASON_LABELS[o.reasonType] || o.reasonType || o.reasonNote || '—'}</td>
                            <td className="px-5 py-2.5 text-xs text-white/40">{o.cashier || '—'}</td>
                            <td className="px-5 py-2.5 text-xs text-right font-mono text-yellow-400">₱{(o.subtotal || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PagBar page={auditCompPage} total={compTotalPages}
                    prev={() => setAuditCompPage(p => Math.max(p - 1, 1))}
                    next={() => setAuditCompPage(p => Math.min(p + 1, compTotalPages))} />
                </>
              )}
            </div>

            {/* Discount Activity Table */}
            <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2">
                <DollarSign size={14} className="text-brand" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Discount Activity</h3>
                <span className="ml-auto text-[10px] bg-brand/15 text-brand px-2 py-0.5 rounded-full font-bold">{discounted.length}</span>
              </div>
              {discounted.length === 0 ? (
                <p className="text-white/20 text-sm p-6 text-center font-bold">No discounted orders in this period.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[560px]">
                      <thead>
                        <tr className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                          <th className="px-5 py-2.5">Date / Time</th>
                          <th className="px-5 py-2.5">Customer</th>
                          <th className="px-5 py-2.5">Type</th>
                          <th className="px-5 py-2.5">Applied By</th>
                          <th className="px-5 py-2.5 text-right">Discount Amt</th>
                          <th className="px-5 py-2.5 text-right">Net Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedDiscounted.map(o => (
                          <tr key={o._id} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition">
                            <td className="px-5 py-2.5 text-xs text-white/40 font-mono">{fmtDate(o.createdAt)}</td>
                            <td className="px-5 py-2.5 text-xs text-white/70 font-bold">{o.customerName || '—'}</td>
                            <td className="px-5 py-2.5 text-xs text-brand/80 font-bold">{o.discountType || 'Promo'}</td>
                            <td className="px-5 py-2.5 text-xs text-white/40">{o.discountBy || o.cashier || '—'}</td>
                            <td className="px-5 py-2.5 text-xs text-right font-mono text-brand">-₱{(o.discount || 0).toFixed(2)}</td>
                            <td className="px-5 py-2.5 text-xs text-right font-mono text-white/70">₱{(o.total || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PagBar page={auditDiscPage} total={discTotalPages}
                    prev={() => setAuditDiscPage(p => Math.max(p - 1, 1))}
                    next={() => setAuditDiscPage(p => Math.min(p + 1, discTotalPages))} />
                </>
              )}
            </div>

            {/* Staff Activity Summary */}
            <div className="bg-surface border border-white/8 rounded-xl overflow-hidden mb-6">
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2">
                <Users size={14} className="text-white/50" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Staff Activity</h3>
                <span className="ml-auto text-[10px] bg-white/8 text-white/40 px-2 py-0.5 rounded-full font-bold">{staffList.length}</span>
              </div>
              {staffList.length === 0 ? (
                <p className="text-white/20 text-sm p-6 text-center font-bold">No staff activity in this period.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[440px]">
                      <thead>
                        <tr className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                          <th className="px-5 py-2.5">Staff Name</th>
                          <th className="px-5 py-2.5 text-right">Orders</th>
                          <th className="px-5 py-2.5 text-right">Cancelled</th>
                          <th className="px-5 py-2.5 text-right">Comps</th>
                          <th className="px-5 py-2.5 text-right">Net Sales</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedStaff.map(name => {
                          const myOrders = inRange.filter(o => o.cashier === name);
                          const myCompleted = myOrders.filter(o => o.status === 'Completed' && !o.isComplimentary);
                          const myCancelled = myOrders.filter(o => o.status === 'Cancelled' || o.status === 'Voided');
                          const myComps = myOrders.filter(o => o.isComplimentary);
                          const myNet = myCompleted.reduce((s, o) => s + (o.total || 0), 0);
                          return (
                            <tr key={name} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition">
                              <td className="px-5 py-2.5 text-xs text-white/80 font-black">{name}</td>
                              <td className="px-5 py-2.5 text-xs text-right text-white/50 font-mono">{myOrders.length}</td>
                              <td className="px-5 py-2.5 text-xs text-right font-mono">
                                <span className={myCancelled.length > 0 ? 'text-red-400' : 'text-white/20'}>{myCancelled.length}</span>
                              </td>
                              <td className="px-5 py-2.5 text-xs text-right font-mono">
                                <span className={myComps.length > 0 ? 'text-yellow-400' : 'text-white/20'}>{myComps.length}</span>
                              </td>
                              <td className="px-5 py-2.5 text-xs text-right font-mono text-brand font-bold">₱{myNet.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <PagBar page={auditStaffPage} total={staffTotalPages}
                    prev={() => setAuditStaffPage(p => Math.max(p - 1, 1))}
                    next={() => setAuditStaffPage(p => Math.min(p + 1, staffTotalPages))} />
                </>
              )}
            </div>

            {/* ── System Activity Log (real AuditLog collection) ─────────────── */}
            <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2 flex-wrap">
                <ShieldCheck size={14} className="text-brand/70" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">System Activity Log</h3>
                <span className="ml-auto text-[10px] bg-white/8 text-white/40 px-2 py-0.5 rounded-full font-bold">{auditLogsTotal} total</span>
                <button
                  onClick={() => fetchAuditLogs(1)}
                  className="flex items-center gap-1 px-3 py-1 rounded-lg bg-white/5 text-white/50 hover:text-white hover:bg-white/10 text-xs font-bold transition"
                >
                  <RefreshCw size={11} /> Load
                </button>
              </div>
              {auditLogs.length === 0 ? (
                <p className="text-white/20 text-sm p-6 text-center font-bold">Click Load to fetch system activity — price changes, 86 toggles, password changes, AP payments.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[520px]">
                      <thead>
                        <tr className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                          <th className="px-5 py-2.5">Time</th>
                          <th className="px-5 py-2.5">Action</th>
                          <th className="px-5 py-2.5">Reference</th>
                          <th className="px-5 py-2.5">By</th>
                          <th className="px-5 py-2.5">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log, i) => {
                          const actionColors = {
                            PRODUCT_PRICE_CHANGED: 'text-yellow-400',
                            PRODUCT_86D: 'text-red-400',
                            PRODUCT_RESTORED: 'text-green-400',
                            PRODUCT_ARCHIVED: 'text-red-500',
                            PASSWORD_CHANGED: 'text-blue-400',
                            AP_PAYMENT: 'text-brand',
                            ORDER_COMPLETED: 'text-green-400/70',
                            ORDER_VOIDED: 'text-red-400/70',
                            ORDER_CANCELLED: 'text-gray-400',
                          };
                          const actionColor = actionColors[log.action] || 'text-white/50';
                          const detail = log.details
                            ? log.action === 'PRODUCT_PRICE_CHANGED'
                              ? `₱${log.details.oldPrice} → ₱${log.details.newPrice}`
                              : log.action === 'AP_PAYMENT'
                              ? `₱${log.details.amount?.toFixed?.(2)} from ${log.details.payFromAccount === '1010' ? 'Bank' : 'Cash'}`
                              : log.details.name || log.details.changedBy || ''
                            : '';
                          return (
                            <tr key={log._id || i} className={`border-b border-white/5 hover:bg-white/3 text-xs ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
                              <td className="px-5 py-2.5 text-white/40 font-mono whitespace-nowrap">
                                {new Date(log.timestamp).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} {new Date(log.timestamp).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className={`px-5 py-2.5 font-black uppercase tracking-wider text-[10px] ${actionColor}`}>{log.action.replace(/_/g,' ')}</td>
                              <td className="px-5 py-2.5 font-mono text-white/60">{log.targetReference}</td>
                              <td className="px-5 py-2.5 text-white/70 font-bold">{log.userId || '—'}</td>
                              <td className="px-5 py-2.5 text-white/40 truncate max-w-[180px]">{detail}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination */}
                  {Math.ceil(auditLogsTotal / AUDIT_LOGS_PAGE_SIZE) > 1 && (
                    <PagBar
                      page={auditLogsPage}
                      total={Math.ceil(auditLogsTotal / AUDIT_LOGS_PAGE_SIZE)}
                      prev={() => fetchAuditLogs(auditLogsPage - 1)}
                      next={() => fetchAuditLogs(auditLogsPage + 1)}
                    />
                  )}
                </>
              )}
            </div>

          </div>
  );
}
