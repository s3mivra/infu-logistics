import React from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag } from 'lucide-react';
import { usePagination } from '../../lib/usePagination';
import Pager from '../Pager';

const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();

// ── HistoryTab — extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
export default function HistoryTab({ ctx }) {
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
    pricingItemsPerPage, pricingPage, printOrderSlip, printXReading, printZReading, products,
    archiveSearch, setArchiveSearch, archiveDateRange, setArchiveDateRange, archiveTotal,
    clockEntries, clockEntriesTotal, clockEntriesPage, fetchClockEntries,
    salesSummary, sssRange, setSssRange, sssGroup, setSssGroup, sssRows, fetchSalesSummary, exportSalesSummaryPDF,
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

  const sssPage = usePagination(sssRows, 15);
  // Fixed Summary-Sales columns (always shown), each summing one or more raw methods.
  const SSS_COLS = [
    ['Cash',             ['Cash']],
    ['Bank',             ['Bank Transfer']],
    ['GCash',            ['GCash']],
    ['Maya',             ['Maya']],
    ['Maribank/SeaBank', ['Maribank']],
    ['Other E-Wallet',   ['E-Wallet', 'Other E-Wallet']],
    ['GrabFood',         ['Grab Delivery']],
    ...(BUSINESS_TYPE === 'log' ? [['Lalamove', ['Lalamove']]] : [['Foodpanda', ['Foodpanda']]]),
    ['Manual/Direct',    ['Manual Delivery']],
  ];
  const sssColVal = (row, methods) => methods.reduce((s, m) => s + (row?.methods?.[m] || 0), 0);
  const sssColTotal = (methods) => methods.reduce((s, m) => s + (salesSummary?.totals?.methods?.[m] || 0), 0);

  // todayCompleted comes from today's live orders
  const todayCompleted     = orders.filter(o => o.status === 'Completed');
  const todayShiftOrders   = todayCompleted.filter(o => shiftFilter === 'All' || o.cashier === shiftFilter);
  const shiftPaid          = todayShiftOrders.filter(o => !o.isComplimentary);
  const shiftComp          = todayShiftOrders.filter(o =>  o.isComplimentary);
  const shiftGross         = todayShiftOrders.reduce((sum, o) => sum + o.subtotal, 0);
  const shiftDisc          = todayShiftOrders.reduce((sum, o) => o.isComplimentary ? sum + o.subtotal : sum + (o.discount || 0), 0);
  const shiftRevenue       = shiftGross - shiftDisc;
  const shiftCompAmount    = shiftComp.reduce((sum, o) => sum + o.subtotal, 0);
  const shiftVat           = shiftPaid.reduce((sum, o) => sum + o.vatAmount, 0);

  const histSubTabUI = (
    <div className="flex items-center gap-2 mb-6">
      {[['daily','Daily Register'],['shifts','Shift History'],['hours','Staff Hours'],['sales','Summary Sales']].map(([id, label]) => (
        <button key={id}
          onClick={() => { setHistorySubTab(id); if (id === 'shifts') fetchShiftHistory(1); if (id === 'hours') fetchClockEntries(1); if (id === 'sales') fetchSalesSummary(); }}
          className={`px-5 py-2.5 rounded-xl font-black text-sm uppercase tracking-wider transition ${historySubTab === id ? 'bg-brand text-white shadow-md' : 'bg-surface-2 text-white/50 hover:text-white'}`}
        >{label}</button>
      ))}
    </div>
  );

  return (
        <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
          {histSubTabUI}

          {/* ===== SUMMARY SALES (channel breakdown) ===== */}
          {historySubTab === 'sales' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex flex-wrap gap-3 items-center">
                <input type="date" value={sssRange.start} onChange={e => setSssRange(p => ({ ...p, start: e.target.value }))}
                  className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-brand/50" />
                <span className="text-white/30 font-bold text-sm">→</span>
                <input type="date" value={sssRange.end} onChange={e => setSssRange(p => ({ ...p, end: e.target.value }))}
                  className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-brand/50" />
                <button onClick={fetchSalesSummary} className="px-5 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition">Load</button>
                <div className="flex rounded-xl overflow-hidden border border-white/10">
                  {[['order', 'Per Order'], ['day', 'Per Day']].map(([g, lbl]) => (
                    <button key={g} onClick={() => setSssGroup(g)}
                      className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${sssGroup === g ? 'bg-brand text-white' : 'bg-surface text-white/50 hover:text-white'}`}>{lbl}</button>
                  ))}
                </div>
                {salesSummary && <button onClick={exportSalesSummaryPDF} className="ml-auto bg-white/5 text-white/70 hover:text-white hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition flex items-center gap-1.5"><Download size={13} /> PDF</button>}
              </div>

              {!salesSummary ? (
                <p className="text-white/30 text-sm text-center p-6 font-bold">Pick a range and click Load.</p>
              ) : sssRows.length === 0 ? (
                <p className="text-white/30 text-sm text-center p-6 font-bold">No completed sales in this range.</p>
              ) : (
                <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <tr>
                          <th className="px-3 py-2.5">Date</th>
                          <th className="px-3 py-2.5">{sssGroup === 'day' ? 'Orders' : 'Order ID'}</th>
                          {SSS_COLS.map(([label]) => (
                            <th key={label} className="px-3 py-2.5 text-right">{label}</th>
                          ))}
                          <th className="px-3 py-2.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sssPage.pageItems.map((r, i) => (
                          <tr key={i} className={`border-b border-white/5 ${i % 2 ? 'bg-white/[0.015]' : ''}`}>
                            <td className="px-3 py-2.5 text-white/70">{new Date(r.date).toLocaleDateString()}</td>
                            <td className="px-3 py-2.5 font-bold text-white">{sssGroup === 'day' ? r.count : r.orderNumber}</td>
                            {SSS_COLS.map(([label, methods]) => { const v = sssColVal(r, methods); return (
                              <td key={label} className="px-3 py-2.5 text-right tabular-nums text-white/80">{v ? `₱${v.toFixed(2)}` : '-'}</td>
                            ); })}
                            <td className="px-3 py-2.5 text-right tabular-nums font-black text-brand">₱{r.total.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-white/10 bg-brand/5 font-black text-white">
                          <td className="px-3 py-3 uppercase text-[10px] tracking-wider">Totals</td>
                          <td className="px-3 py-3"></td>
                          {SSS_COLS.map(([label, methods]) => (
                            <td key={label} className="px-3 py-3 text-right tabular-nums">₱{sssColTotal(methods).toFixed(2)}</td>
                          ))}
                          <td className="px-3 py-3 text-right tabular-nums text-brand">₱{(salesSummary.totals?.total || 0).toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="px-3"><Pager {...sssPage} label="rows" /></div>
                </div>
              )}
            </div>
          )}

          {historySubTab === 'hours' && (
            <div className="bg-surface border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
                <h3 className="text-white font-black uppercase tracking-wider text-sm">Staff Hours</h3>
                <span className="text-[10px] text-gray-500 font-bold">{clockEntriesTotal} records</span>
                <button onClick={() => fetchClockEntries(1)} className="ml-auto flex items-center gap-1.5 text-[10px] bg-white/5 text-white/50 hover:text-white px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider transition">
                  <RefreshCw size={11} /> Load
                </button>
              </div>
              {clockEntries.length === 0 ? (
                <p className="text-white/20 text-sm p-6 text-center font-bold">Click Load to view staff clock-in/out records.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[480px]">
                    <thead className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr>
                        <th className="px-5 py-2.5">Date</th>
                        <th className="px-5 py-2.5">Staff</th>
                        <th className="px-5 py-2.5">Clock In</th>
                        <th className="px-5 py-2.5">Clock Out</th>
                        <th className="px-5 py-2.5 text-right">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clockEntries.map((e, i) => (
                        <tr key={e._id||i} className={`border-b border-white/5 hover:bg-white/3 ${i%2===0?'':'bg-white/[0.015]'}`}>
                          <td className="px-5 py-2.5 text-white/50">{e.date}</td>
                          <td className="px-5 py-2.5 text-white font-bold">{e.staffName}</td>
                          <td className="px-5 py-2.5 text-white/70">{e.clockIn ? new Date(e.clockIn).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '-'}</td>
                          <td className={`px-5 py-2.5 ${e.clockOut ? 'text-white/70' : 'text-yellow-400/70 italic'}`}>
                            {e.clockOut ? new Date(e.clockOut).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : 'Still in'}
                          </td>
                          <td className="px-5 py-2.5 text-right font-bold text-brand/80 tabular-nums">
                            {e.durationMinutes != null ? `${Math.floor(e.durationMinutes/60)}h ${e.durationMinutes%60}m` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {historySubTab === 'shifts' && (
            <div className="bg-surface border border-gray-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                <h3 className="text-white font-black uppercase tracking-wider text-sm">Shift History Archive</h3>
                <div className="flex gap-2 text-[10px] text-gray-500 font-bold uppercase">{shiftHistoryTotal} records</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800 text-xs uppercase tracking-wider bg-black/20">
                      <th className="p-3">Cashier</th>
                      <th className="p-3">Shift Start</th>
                      <th className="p-3">Shift End</th>
                      <th className="p-3 text-right">Opening</th>
                      <th className="p-3 text-right">Cash Sales</th>
                      <th className="p-3 text-right">Expected</th>
                      <th className="p-3 text-right">Actual</th>
                      <th className="p-3 text-right">Variance</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftHistory.length === 0 ? (
                      <tr><td colSpan="9" className="py-8 text-center text-gray-600 font-bold uppercase tracking-widest text-xs">No shift records found.</td></tr>
                    ) : shiftHistory.map(sh => (
                      <tr key={sh._id} className={`border-b border-gray-800/50 hover:bg-white/2 transition ${sh.isLive || sh.status === 'Open' ? 'bg-yellow-500/5 border-l-2 border-l-yellow-500' : ''}`}>
                        <td className="p-3 font-bold text-white">{sh.cashierName}</td>
                        <td className="p-3 text-gray-400 text-xs">{new Date(sh.shiftStart).toLocaleString()}</td>
                        <td className="p-3 text-gray-400 text-xs">{sh.shiftEnd ? new Date(sh.shiftEnd).toLocaleString() : '- (ongoing)'}</td>
                        <td className="p-3 text-right font-mono text-sm text-white">₱{(sh.startingCash||0).toFixed(2)}</td>
                        <td className="p-3 text-right font-mono text-sm text-brand">₱{(sh.salesTotal||0).toFixed(2)}{(sh.isLive || sh.status === 'Open') && <span className="text-[8px] text-yellow-400 font-black ml-1 align-top">LIVE</span>}</td>
                        <td className="p-3 text-right font-mono text-sm text-white">₱{(sh.expectedCash||0).toFixed(2)}</td>
                        <td className="p-3 text-right font-mono text-sm text-white">₱{(sh.actualCash||0).toFixed(2)}</td>
                        <td className={`p-3 text-right font-black text-sm ${(sh.variance||0) < 0 ? 'text-red-400' : (sh.variance||0) > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                          {(sh.variance||0) >= 0 ? '+' : ''}₱{(sh.variance||0).toFixed(2)}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${sh.status === 'Reconciled' ? 'bg-green-500/15 text-green-400' : sh.status === 'Closed' ? 'bg-blue-500/15 text-blue-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{sh.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {Math.ceil(shiftHistoryTotal / SHIFT_HIST_PAGE_SIZE) > 1 && (
                <div className="flex justify-between items-center p-3 border-t border-gray-800">
                  <button onClick={() => fetchShiftHistory(shiftHistoryPage - 1)} disabled={shiftHistoryPage === 1} className="px-4 py-1.5 rounded font-bold text-xs bg-surface-2 border border-gray-700 text-white disabled:opacity-30 transition">← Prev</button>
                  <span className="text-gray-500 text-xs font-bold">Page {shiftHistoryPage} / {Math.ceil(shiftHistoryTotal / SHIFT_HIST_PAGE_SIZE)}</span>
                  <button onClick={() => fetchShiftHistory(shiftHistoryPage + 1)} disabled={shiftHistoryPage >= Math.ceil(shiftHistoryTotal / SHIFT_HIST_PAGE_SIZE)} className="px-4 py-1.5 rounded font-bold text-xs bg-surface-2 border border-gray-700 text-white disabled:opacity-30 transition">Next →</button>
                </div>
              )}
            </div>
          )}

          {historySubTab === 'daily' && (<>
          <div className="bg-accent border border-accentShadow rounded-xl p-6 shadow-xl shadow-accent/5">
            <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
              <h3 className="text-white font-black tracking-widest uppercase text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-page-bg animate-pulse"></span> Active Register
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={printXReading} className="flex items-center gap-1.5 bg-page-bg border border-gray-700 text-gray-300 hover:text-white hover:border-brand px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition">
                  <Printer size={12} /> X-Reading
                </button>
                <button onClick={printZReading} className="flex items-center gap-1.5 bg-green-900/30 border border-green-600/30 text-green-400 hover:bg-green-900/50 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition">
                  <FileText size={12} /> Z-Reading
                </button>
                <select className="bg-page-bg text-white p-2 rounded text-xs font-bold outline-none border border-gray-700 shadow-sm" value={shiftFilter} onChange={e => setShiftFilter(e.target.value)}>
                  <option value="All">All Shifts (Store Total)</option>
                  {users.map(u => <option key={u._id} value={u.name}>{u.name}'s Shift</option>)}
                </select>
              </div>
            </div>
            
            <div className="space-y-4 mb-6">
              <div>
                <p className="text-white text-xs font-bold uppercase tracking-wider mb-1">Net Sales</p>
                <p className="text-4xl font-black text-white">P{shiftRevenue.toFixed(2)}</p>
                <p className="text-white text-[10px] font-semibold mt-1">Gross P{shiftGross.toFixed(2)} &minus; Discounts P{shiftDisc.toFixed(2)}</p>
                {shiftCompAmount > 0 && (
                  <p className="text-gray-300 text-[10px] font-bold mt-0.5">+P{shiftCompAmount.toFixed(2)} complimentary (not collected)</p>
                )}
              </div>
              <div className="flex justify-between border-t border-white/10 pt-4">
                <div>
                  <p className="text-white text-[10px] font-bold uppercase tracking-wider">Completed Orders</p>
                  <p className="text-lg font-bold text-white">{todayShiftOrders.length}</p>
                  {shiftComp.length > 0 && <p className="text-[9px] text-gray-300 font-bold">{shiftComp.length} complimentary</p>}
                </div>
                <div className="text-right">
                  <p className="text-white text-[10px] font-bold uppercase tracking-wider">Avg Ticket</p>
                  <p className="text-lg font-bold text-gray-300">P{todayShiftOrders.length > 0 ? (shiftRevenue / todayShiftOrders.length).toFixed(2) : '0.00'}</p>
                </div>
              </div>
            </div>
            <button onClick={archiveDay} className="w-full bg-red-600 border border-red-600 text-white hover:bg-page-bg hover:text-red-600 font-bold py-3 rounded-lg transition text-sm">
              Close Register & Archive Day
            </button>
          </div>

          <div className="bg-surface border border-gray-800 rounded-xl p-1 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-page-bg/20 rounded-t-xl">
              <h3 className="text-gray-300 font-bold text-sm tracking-wider uppercase">Sales History</h3>
              <button onClick={exportAllToPDF} className="text-[10px] bg-accent border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-page-bg hover:text-accent transition font-bold uppercase tracking-wider">
                Export All
              </button>
            </div>

            {/* Archive search + date filter */}
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                <input type="text" placeholder="Search name, order #, cashier…"
                  value={archiveSearch}
                  onChange={e => { setArchiveSearch(e.target.value); }}
                  onKeyDown={e => { if (e.key === 'Enter') fetchOrders(); }}
                  className="w-full pl-8 pr-3 py-2 bg-page-bg border border-gray-700 rounded-xl text-white text-xs font-bold placeholder-white/20 outline-none focus:border-brand/50"
                />
              </div>
              <input type="date" value={archiveDateRange.start}
                onChange={e => setArchiveDateRange(p => ({...p, start: e.target.value}))}
                className="bg-page-bg border border-gray-700 rounded-xl px-3 py-2 text-white text-xs font-bold outline-none focus:border-brand/50"
              />
              <input type="date" value={archiveDateRange.end}
                onChange={e => setArchiveDateRange(p => ({...p, end: e.target.value}))}
                className="bg-page-bg border border-gray-700 rounded-xl px-3 py-2 text-white text-xs font-bold outline-none focus:border-brand/50"
              />
              <button onClick={() => fetchOrders()}
                className="px-4 py-2 bg-brand text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-brand/90 transition">
                Search
              </button>
              {(archiveSearch || archiveDateRange.start || archiveDateRange.end) && (
                <button onClick={() => { setArchiveSearch(''); setArchiveDateRange({start:'',end:''}); fetchOrders(); }}
                  className="px-4 py-2 bg-white/5 text-white/50 rounded-xl text-xs font-bold hover:bg-white/10 transition">
                  Clear
                </button>
              )}
              {archiveTotal > 0 && <span className="text-[10px] text-white/30 font-bold self-center">{archiveTotal} results</span>}
            </div>

            <div className="max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
              {Object.keys(groupedArchives).length === 0 ? (
                <p className="text-gray-600 text-sm p-6 text-center">No past days archived.</p>
              ) : (
                Object.entries(groupedArchives).map(([date, data]) => (
                  <div key={date} className="border-b border-gray-800/50 last:border-0">
                    <button onClick={() => toggleDay(date)} className="w-full flex justify-between items-center p-4 hover:bg-page-bg/50 transition text-left">
                      <span className="font-bold text-sm text-gray-200">{date}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-accent font-bold">P{data.revenue.toFixed(2)}</span>
                        {expandedDays[date] ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                      </div>
                    </button>
                    
                    {expandedDays[date] && (
                      <div className="p-4 bg-page-bg/30 border-t border-gray-800/30 flex flex-col gap-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div><p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Orders</p><p className="text-sm font-semibold">{data.orders.filter(o => o.status === 'Completed').length}</p></div>
                          <div><p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">VAT</p><p className="text-sm font-semibold">P{data.vat.toFixed(2)}</p></div>
                          <div className="col-span-2"><p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Discounts</p><p className="text-sm font-semibold text-red-400">-P{data.discounts.toFixed(2)}</p></div>
                        </div>

                        <div className="border-t border-gray-800/30 pt-3 mt-1">
                          <div className="flex justify-between items-center">
                            <button onClick={() => toggleOrderList(date)} className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-white transition">
                              <span>{expandedOrderLists[date] ? 'Hide Orders' : 'View All Orders'}</span>
                              {expandedOrderLists[date] ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                            <button onClick={() => exportDayToPDF(date, data.orders)} className="text-[10px] bg-surface-2 border border-white/10 text-white/60 px-2 py-1 rounded hover:bg-white/10 hover:text-white transition font-bold uppercase tracking-wider">
                              Export Day
                            </button>
                          </div>

                          {expandedOrderLists[date] && (
                            <div className="mt-3 space-y-3 max-h-60 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-700">
                              {data.orders.map(order => (
                                <div key={order._id} className="bg-page-bg/50 p-3 rounded border border-gray-800/50">
                                  <div className="flex justify-between items-center mb-2 border-b border-gray-800/50 pb-2">
                                    <span className="font-bold text-sm text-accent">{order.orderNumber}</span>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${order.status === 'Cancelled' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>{order.status}</span>
                                      <span className="text-xs font-bold text-white">P{order.total.toFixed(2)}</span>
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    {order.items.map((item, idx) => (
                                      <div key={idx} className="flex justify-between text-[11px] text-white">
                                        <span>{item.quantity}x {item.name}</span><span>P{(item.price * item.quantity).toFixed(2)}</span>
                                      </div>
                                    ))}
                                  </div>
                                  {(order.discount > 0 || order.vatAmount > 0) && (
                                    <div className="mt-2 pt-2 border-t border-gray-800/50 flex justify-between text-[10px] text-gray-500">
                                      <span>VAT: P{order.vatAmount.toFixed(2)}</span>
                                      {order.discount > 0 && <span className="text-red-400">Disc: -P{order.discount.toFixed(2)}</span>}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          </>)}
        </div>
  );
}
