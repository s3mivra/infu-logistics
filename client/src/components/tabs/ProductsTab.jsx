import React from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag } from 'lucide-react';

const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();

// ── ProductsTab — extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
export default function ProductsTab({ ctx }) {
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
    catForm, categories, clientAccounts, closeRfFund, collapsedOrders, compOverride,
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
    modifierGroups,
    editingModifier, setEditingModifier, modForm, setModForm, saveModifierGroup, editModifierGroup, deleteModifierGroup,
    combos, editingCombo, setEditingCombo, comboForm, setComboForm, saveCombo, editCombo, deleteCombo,
  } = ctx;

  return (
      <div className="flex flex-col gap-6">
        {/* FIX 1: Changed h-fixed to h-auto on mobile, and added gap-6 */}
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 h-auto lg:h-[calc(100vh-180px)]">
          
          {/* LEFT COLUMN: Menu Items, Categories, and Add-Ons */}
          {/* FIX 2: Added min-h-[500px] so it doesn't get crushed on mobile */}
          <div className="flex-1 bg-surface border border-white/8 shadow-md rounded-xl p-4 sm:p-6 overflow-y-auto custom-scrollbar min-h-[500px] lg:min-h-0">

            {/* 1. Menu Items List */}
            <h3 className="text-xl font-bold mb-4 text-white border-b border-white/8 pb-2">Menu Items</h3>
            <div className="space-y-3">
              {currentProducts.map(p => (
                <div key={p._id} className="flex flex-col sm:flex-row gap-4 p-4 border border-white/8 rounded-xl bg-surface-2 items-start sm:items-center">
                  
                  {/* Top section on mobile: Image + Text */}
                  <div className="flex gap-4 flex-1 w-full">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-16 h-16 object-cover rounded-lg shadow-sm border border-white/10 shrink-0" />
                    ) : (
                      <div className="w-16 h-16 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center text-xs text-white/30 font-bold shrink-0">No Img</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-white truncate w-full sm:w-auto">{p.name} <span className="text-xs text-brand/70 ml-1">({p.category})</span></h4>
                        {(() => {
                          const est = getEstimatedStock(p.baseRecipe);
                          if (est === null) return null;
                          return (
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${est <= 0 ? 'bg-red-500/15 text-red-400' : est <= 5 ? 'bg-yellow-500/15 text-yellow-400' : 'bg-green-500/15 text-green-400'}`}>
                              {est <= 0 ? 'Out of Stock' : `Est: ${est} left`}
                            </span>
                          );
                        })()}
                      </div>
                      {p.description && <p className="text-xs text-white/40 mt-1 line-clamp-2">{p.description}</p>}
                      <p className="text-sm text-white/70 font-bold mt-1">P{Number(p.basePrice || p.price || 0).toFixed(2)} {p.baseSize && <span className="text-xs text-white/30 font-normal">({p.baseSize})</span>} {p.sizes?.length > 0 && <span className="text-brand/70 text-xs ml-1">(+ {p.sizes.length} sizes)</span>}</p>
                    </div>
                  </div>

                  {/* Edit button: Full width on mobile, auto width on desktop */}
                  <div className="w-full sm:w-auto mt-2 sm:mt-0 shrink-0">
                    <button 
                      onClick={() => { 
                        setEditingProduct(p); 
                        setFormData({ 
                          name: p.name || '', category: p.category || '', description: p.description || '',
                          basePrice: Number(p.basePrice || p.price || 0), discountPercent: Number(p.discountPercent || 0),
                          clientDiscounts: (p.clientDiscounts || []).map(d => ({ clientId: String(d.clientId), percent: Number(d.percent || 0) })),
                          baseSize: p.baseSize || '',
                          sizes: p.sizes || [], image: p.image || '', baseRecipe: p.baseRecipe || [], addOns: p.addOns || [],
                          modifierGroups: (p.modifierGroups || []).map(mg => (mg && mg._id) ? mg._id : mg),
                          imageUrl: (p.image || '').startsWith('http') ? p.image : ''
                        }); 
                      }} 
                      className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-white/10 text-white rounded-lg text-sm font-bold hover:bg-brand hover:text-white transition flex items-center justify-center gap-2"
                    >
                      <Edit size={14} /> Edit
                    </button>
                  </div>
                </div>
              ))}
              {/* --- PAGINATION CONTROLS --- */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center bg-page-bg p-4 rounded-xl border border-gray-800 mt-6 shrink-0">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className={`px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-xs transition ${currentPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1"><ChevronLeft size={12} /> Previous</span>
                </button>
                
                <span className="text-gray-400 text-sm font-bold tracking-widest">
                  PAGE <span className="text-accent text-lg">{currentPage}</span> OF {totalPages}
                </span>
                
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className={`px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-xs transition ${currentPage === totalPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                </button>
              </div>
            )}
            </div>
            
            {/* 2. Manage Categories */}
            <div className="mt-8 border-t border-white/8 pt-6">
              <h3 className="text-xl font-bold mb-4 text-white border-b border-white/8 pb-2">Manage Categories & Routing</h3>
              <form onSubmit={handleSaveCategory} className="flex gap-3 mb-6">
                <input
                  type="text"
                  value={catForm.name}
                  onChange={e => setCatForm({...catForm, name: e.target.value})}
                  placeholder="Category Name"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-brand font-semibold placeholder-white/20"
                  required
                />
                <select
                  value={catForm.department}
                  onChange={e => setCatForm({...catForm, department: e.target.value})}
                  className="w-32 bg-white/5 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-brand font-bold"
                >
                  <option value="Kitchen">Kitchen</option>
                  <option value="Bar">Bar</option>
                </select>
                <button type="submit" className="bg-accent text-white font-bold px-6 py-2 rounded-lg hover:bg-opacity-90 transition shadow-md">
                  {editingCategory ? 'Update' : 'Add'}
                </button>
                {editingCategory && (
                  <button type="button" onClick={() => { setEditingCategory(null); setCatForm({ name: '', department: 'Kitchen' }); }} className="bg-white/10 text-white/70 font-bold px-4 py-2 rounded-lg hover:bg-white/20 transition">
                    Cancel
                  </button>
                )}
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {categories.map(c => (
                  <div key={c._id} className="flex justify-between items-center p-3 border border-white/8 rounded-xl bg-surface-2">
                    <div>
                      <span className="font-bold text-sm text-white block">{c.name}</span>
                      <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Routes to: {c.department || 'Kitchen'}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingCategory(c); setCatForm({ name: c.name, department: c.department || 'Kitchen' }); }} className="text-white/40 hover:text-brand p-1.5 rounded"><Edit size={16} /></button>
                      <button onClick={() => deleteCategory(c._id)} className="text-red-400 hover:text-red-300 p-1.5 rounded"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. MANAGE GLOBAL ADD-ONS — fb only */}
            {BUSINESS_TYPE !== 'log' && <div className="mt-8 border-t border-white/8 pt-6">
              <h3 className="text-xl font-bold mb-4 text-white border-b border-white/8 pb-2">Manage Global Add-Ons (Sinkers, Shots)</h3>
              <form onSubmit={handleSaveAddOn} className="flex gap-3 mb-6">
                <input
                  type="text"
                  placeholder="Name (e.g. Popping Boba)"
                  value={addOnForm.name}
                  onChange={e => setAddOnForm({...addOnForm, name: e.target.value})}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-brand font-semibold placeholder-white/20"
                  required
                />
                <input
                  type="number"
                  placeholder="Price"
                  value={addOnForm.price}
                  onChange={e => setAddOnForm({...addOnForm, price: e.target.value})}
                  className="w-24 bg-white/5 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-brand font-bold placeholder-white/20"
                  required
                />
                <select
                  value={addOnForm.category}
                  onChange={e => setAddOnForm({...addOnForm, category: e.target.value})}
                  className="w-32 bg-white/5 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-brand font-bold"
                >
                  <option value="Extras">Extras</option>
                  <option value="Sinkers">Sinkers</option>
                  <option value="Milks">Milks</option>
                </select>
                <button type="submit" className="bg-brand text-white font-bold px-6 py-2 rounded-lg hover:bg-brand-dark transition shadow-md">Add</button>
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {globalAddOns.map(a => (
                  <div key={a._id} className="flex justify-between items-center p-3 border border-white/8 rounded-xl bg-surface-2">
                    <div>
                      <span className="font-bold text-sm text-white block">{a.name}</span>
                      <span className="text-[10px] uppercase font-bold text-brand/70 tracking-wider">{a.category} • +P{a.price}</span>
                    </div>
                    <button onClick={() => deleteAddOn(a._id)} className="text-red-400 hover:text-red-300 bg-red-500/10 p-1.5 rounded"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </div>}
          </div>

          {/* RIGHT COLUMN: Add Product Form */}
          {/* FIX 3: Added min-h-[600px] on mobile so the form has room to breathe */}
          <div className="w-full lg:w-96 bg-surface border border-white/8 rounded-xl p-4 sm:p-6 flex flex-col min-h-[600px] lg:min-h-0 lg:h-full overflow-hidden shadow-md">
            <h3 className="text-xl font-bold text-white mb-4 border-b border-white/8 pb-2 shrink-0">
              {editingProduct ? 'Edit Product' : 'Add Product'}
            </h3>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
              <form onSubmit={handleSaveProduct} className="space-y-4">
                {/* Basic Info */}
                <div>
                  <label className="block text-sm font-bold text-white/60 mb-2">Product Image</label>
                  <div className="flex items-center gap-4">
                    {formData.image ? (
                      <img src={formData.image} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-white/10 shadow-sm" />
                    ) : (
                      <div className="w-16 h-16 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center text-xs text-white/25 font-bold">None</div>
                    )}
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="text-sm text-white/40 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-white/10 file:text-white hover:file:bg-white/20 cursor-pointer transition" />
                  </div>
                </div>
                <div><label className="block text-sm font-bold text-white/60 mb-1">Name</label><input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-brand font-semibold placeholder-white/20" /></div>
                <div>
                  <label className="block text-sm font-bold text-white/60 mb-1">Category</label>
                  <select required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-brand font-semibold">
                    <option value="" disabled>Select Category...</option>
                    {categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div><label className="block text-sm font-bold text-white/60 mb-1">Description</label><textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-brand h-20 placeholder-white/20 font-medium" /></div>
                
                {/* Base Size & Materials */}
                <div className="bg-surface-2 p-4 rounded-xl border border-white/8 mt-6">
                  <label className="block text-sm font-black text-white/80 mb-3 uppercase tracking-wider">Base Size / Standard Recipe</label>
                  <div className="flex gap-2 mb-2">
                    <input type="text" placeholder="Size Name (e.g. Regular)" value={formData.baseSize || ''} onChange={e => setFormData({...formData, baseSize: e.target.value})} className="w-1/2 bg-white/5 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-brand font-bold placeholder-white/20" />
                    <div className="w-1/2 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 font-bold">₱</span>
                      <input type="number" step="0.01" placeholder="Selling Price" value={formData.basePrice} onChange={e => setFormData({...formData, basePrice: parseFloat(e.target.value) || 0})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 pl-8 text-white outline-none focus:border-brand font-bold" />
                    </div>
                  </div>
                  {/* Per-product discount — applies only to this product's line, not the whole order. */}
                  <div className="flex items-center gap-2 mb-1">
                    <div className="relative w-1/2">
                      <input type="number" min="0" max="100" step="0.01" placeholder="Product Discount" value={formData.discountPercent || ''} onChange={e => setFormData({...formData, discountPercent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0))})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 pr-7 text-white outline-none focus:border-brand font-bold placeholder-white/20" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 font-bold">%</span>
                    </div>
                    {formData.discountPercent > 0 && (
                      <span className="text-[11px] text-emerald-400 font-bold">
                        → ₱{((parseFloat(formData.basePrice) || 0) * (1 - formData.discountPercent / 100)).toFixed(2)} after discount
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-white/30 mb-3">Discount applies to this product only, on every order line — not the whole order. Overrides below apply when a specific client buys this product.</p>

                  {/* Per-client overrides — a specific client's special rate on THIS product */}
                  <div className="bg-page-bg/40 border border-white/8 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-black text-white/70 uppercase tracking-wider">Per-Client Overrides</label>
                      <button type="button"
                        disabled={!clientAccounts?.length}
                        onClick={() => setFormData({ ...formData, clientDiscounts: [...(formData.clientDiscounts || []), { clientId: '', percent: 0 }] })}
                        className="text-[11px] font-black text-brand hover:text-white transition disabled:opacity-40">+ Add client</button>
                    </div>
                    {(!clientAccounts || clientAccounts.length === 0) && (
                      <p className="text-[10px] text-white/30 italic">No client accounts yet — create one in the Client Accounts panel to assign a special discount.</p>
                    )}
                    {(formData.clientDiscounts || []).map((cd, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-1.5">
                        <select value={cd.clientId}
                          onChange={e => {
                            const list = [...(formData.clientDiscounts || [])];
                            list[idx] = { ...list[idx], clientId: e.target.value };
                            setFormData({ ...formData, clientDiscounts: list });
                          }}
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:border-brand">
                          <option value="">Select client…</option>
                          {(clientAccounts || []).map(c => (
                            <option key={c._id} value={c._id}>{c.name || c.username} ({c.clientCode})</option>
                          ))}
                        </select>
                        <div className="relative w-28">
                          <input type="number" min="0" max="100" step="0.01" value={cd.percent}
                            onChange={e => {
                              const list = [...(formData.clientDiscounts || [])];
                              list[idx] = { ...list[idx], percent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) };
                              setFormData({ ...formData, clientDiscounts: list });
                            }}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-2 pr-6 py-1.5 text-white text-xs font-bold outline-none focus:border-brand" />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 text-[10px] font-bold">%</span>
                        </div>
                        <button type="button"
                          onClick={() => setFormData({ ...formData, clientDiscounts: (formData.clientDiscounts || []).filter((_, i) => i !== idx) })}
                          className="text-red-400/70 hover:text-red-400 text-sm">✕</button>
                      </div>
                    ))}
                  </div>
                  
                  {(() => {
                    const baseCost = calcRecipeCost(formData.baseRecipe);
                    const basePriceVal = parseFloat(formData.basePrice) || 0;
                    const suggestedBasePrice = baseCost > 0 ? (baseCost / 0.7).toFixed(2) : '0.00';
                    const baseMargin = basePriceVal > 0 ? (((basePriceVal - baseCost) / basePriceVal) * 100).toFixed(1) : '0.0';
                    return baseCost > 0 ? (
                      <div className="flex justify-between text-[10px] px-1 mb-3">
                        <span className={parseFloat(baseMargin) >= 30 ? "text-green-400 font-black" : "text-yellow-400 font-black"}>Margin: {baseMargin}%</span>
                        <button type="button" onClick={() => setFormData({...formData, basePrice: parseFloat(suggestedBasePrice)})} className="text-white/30 hover:text-brand font-bold transition">Set 30% Margin (₱{suggestedBasePrice})</button>
                      </div>
                    ) : <div className="mb-3"></div>;
                  })()}
                  
                  <div className="bg-black/20 p-3 rounded-lg border border-white/8">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs text-white/40 font-black uppercase tracking-wider">Base Materials</span>
                      <span className="text-xs text-white font-black">Cost: ₱{calcRecipeCost(formData.baseRecipe).toFixed(2)}</span>
                    </div>
                    {(formData.baseRecipe || []).map((mat, i) => (
                      <div key={i} className="flex items-center gap-2 mb-2 text-sm">
                        <span className="flex-1 text-white/70 font-semibold truncate">{mat.name}</span>
                        <input type="number" value={mat.qty} onChange={e => updateMaterialQty(e.target.value, i, null)} className="w-16 bg-white/5 border border-white/10 rounded p-1.5 text-center text-white font-bold" />
                        <span className="text-white/40 w-8 text-xs font-bold">{mat.unit}</span>
                        <button type="button" onClick={() => removeMaterial(i, null)} className="text-red-400 hover:text-red-300 ml-2"><X size={16} /></button>
                      </div>
                    ))}
                    <div className="mt-4 pt-3 border-t border-white/5">
                      <div className="text-[10px] text-brand uppercase font-black mb-2 tracking-widest flex items-center gap-1"><Plus size={12}/> Tap to Add Material</div>
                      <div className="max-h-32 overflow-y-auto bg-black/20 border border-white/8 rounded-lg custom-scrollbar p-1">
                        {inventory.length === 0 ? (
                          <p className="p-2 text-xs text-white/30 italic font-medium">No inventory available.</p>
                        ) : (
                          inventory.map(inv => (
                            <button type="button" key={inv._id} onClick={() => addMaterialToRecipe(inv._id, null)} className="w-full text-left px-3 py-2 text-xs text-white/60 font-bold hover:bg-white/10 transition rounded flex justify-between items-center">
                              <span className="truncate pr-2">{inv.itemName}</span>
                              <span className="text-white/30 shrink-0 font-mono">₱{inv.unitCost.toFixed(2)}/{inv.unit}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Extra Sizes */}
                <div className="border-t border-white/8 pt-5 mt-4">
                  <div className="flex justify-between items-center mb-4">
                    <label className="text-sm font-black text-white/80 uppercase tracking-wider">Extra Sizes (Small, Large)</label>
                    <button type="button" onClick={addSize} className="text-xs bg-white/10 px-3 py-1.5 rounded-full font-bold text-white/70 border border-white/10 hover:bg-brand/20 hover:text-brand hover:border-brand/30 transition flex items-center gap-1"><Plus size={14}/> Add Size</button>
                  </div>

                  {(formData.sizes || []).map((size, idx) => (
                    <div key={idx} className="bg-surface-2 p-4 rounded-xl border border-white/8 mb-4">
                      <div className="flex gap-2 mb-2">
                        <input type="text" placeholder="Size Name" value={size.name} onChange={e => updateSize(idx, 'name', e.target.value)} className="w-1/2 bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white font-bold placeholder-white/20" required />
                        <input type="number" step="0.01" placeholder="Price" value={size.price} onChange={e => updateSize(idx, 'price', e.target.value)} className="w-1/3 bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white font-bold placeholder-white/20" required />
                        <button type="button" onClick={() => removeSize(idx)} className="text-white/30 hover:text-red-400 font-bold ml-auto px-2"><X size={20} /></button>
                      </div>

                      <div className="bg-black/20 p-3 rounded-lg border border-white/8 mt-3">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs text-white/40 font-black uppercase tracking-wider">{size.name || 'New Size'} Materials</span>
                          <span className="text-xs text-white font-black">Cost: ₱{calcRecipeCost(size.recipe).toFixed(2)}</span>
                        </div>
                        {(size.recipe || []).map((mat, i) => (
                          <div key={i} className="flex items-center gap-2 mb-2 text-sm">
                            <span className="flex-1 text-white/70 font-semibold truncate">{mat.name}</span>
                            <input type="number" value={mat.qty} onChange={e => updateMaterialQty(e.target.value, i, idx)} className="w-16 bg-white/5 border border-white/10 rounded p-1.5 text-center text-white font-bold" />
                            <span className="text-white/40 w-8 text-xs font-bold">{mat.unit}</span>
                            <button type="button" onClick={() => removeMaterial(i, idx)} className="text-red-400 hover:text-red-300 ml-2"><X size={16} /></button>
                          </div>
                        ))}
                        <div className="mt-4 pt-3 border-t border-white/5">
                          <div className="text-[10px] text-brand uppercase font-black mb-2 tracking-widest flex items-center gap-1"><Plus size={12}/> Tap to Add Material</div>
                          <div className="max-h-28 overflow-y-auto bg-black/20 border border-white/8 rounded-lg custom-scrollbar p-1">
                            {inventory.map(inv => (
                              <button type="button" key={inv._id} onClick={() => addMaterialToRecipe(inv._id, idx)} className="w-full text-left px-3 py-2 text-xs text-white/60 font-bold hover:bg-white/10 transition rounded flex justify-between items-center">
                                <span className="truncate pr-2">{inv.itemName}</span>
                                <span className="text-white/30 shrink-0 font-mono">₱{inv.unitCost.toFixed(2)}/{inv.unit}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* --- OPTIONAL ADD-ONS CHECKBOXES --- */}
                <div className="border-t border-white/8 pt-5 mt-4 mb-4">
                  <label className="text-sm font-black text-white/80 uppercase tracking-wider mb-3 block">Attach Add-Ons</label>
                  <div className="grid grid-cols-2 gap-2">
                    {globalAddOns.map(addon => {
                      const isAttached = (formData.addOns || []).some(a => a.name === addon.name);
                      return (
                        <label key={addon._id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border-2 transition ${isAttached ? 'border-brand bg-brand/10 shadow-sm shadow-brand/10' : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'}`}>
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-accent cursor-pointer"
                            checked={isAttached}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({ ...formData, addOns: [...(formData.addOns || []), { name: addon.name, price: addon.price, recipe: [] }] });
                              } else {
                                setFormData({ ...formData, addOns: (formData.addOns || []).filter(a => a.name !== addon.name) });
                              }
                            }}
                          />
                          <div className="flex flex-col">
                             <span className="text-sm font-bold text-white leading-tight">{addon.name}</span>
                             <span className="text-[10px] text-accent font-black uppercase tracking-widest">+₱{addon.price}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* --- REQUIRED MODIFIER GROUPS — fb only --- */}
                {BUSINESS_TYPE !== 'log' && modifierGroups.length > 0 && (
                  <div className="border-t border-white/8 pt-5 mt-4 mb-4">
                    <label className="text-sm font-black text-white/80 uppercase tracking-wider mb-1 block">Required Modifier Groups</label>
                    <p className="text-[10px] text-white/30 mb-3">Checked groups will be required before adding to cart (e.g. "Choose your milk").</p>
                    <div className="space-y-2">
                      {modifierGroups.map(mg => {
                        const current = (formData.modifierGroups || []).map(id => (id && id._id) ? id._id : id);
                        const isAttached = current.includes(mg._id);
                        return (
                          <label key={mg._id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border-2 transition ${isAttached ? 'border-brand bg-brand/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                            <input type="checkbox" className="w-4 h-4 accent-accent cursor-pointer" checked={isAttached}
                              onChange={e => {
                                if (e.target.checked) setFormData({...formData, modifierGroups: [...current, mg._id]});
                                else setFormData({...formData, modifierGroups: current.filter(id => id !== mg._id)});
                              }}
                            />
                            <div>
                              <p className="text-sm font-bold text-white">{mg.name}</p>
                              <p className="text-[10px] text-white/40">{mg.isRequired ? `Required — pick ${mg.minSelect}${mg.maxSelect>mg.minSelect?`-${mg.maxSelect}`:``}` : 'Optional'} · {mg.options?.length||0} options</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* --- IMAGE URL input --- */}
                <div className="border-t border-white/8 pt-4 mt-2">
                  <label className="text-xs font-bold text-white/50 uppercase tracking-wider block mb-1.5">Image URL (alternative to upload)</label>
                  <input type="url" placeholder="https://example.com/image.jpg"
                    value={formData.imageUrl || ''}
                    onChange={e => setFormData({...formData, imageUrl: e.target.value, image: e.target.value || formData.image})}
                    className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-brand/60 placeholder-white/20"
                  />
                  <p className="text-[10px] text-white/20 mt-1">Leave blank to use uploaded image. Paste URL to override.</p>
                </div>

                {/* Save Buttons */}
                <div className="flex gap-3 mt-6 pt-4 border-t border-white/8">
                  {editingProduct && (
                    <button type="button" onClick={() => deleteProduct(editingProduct._id)} className="bg-red-500/10 text-red-400 font-bold py-3 px-4 rounded-xl hover:bg-red-500/20 transition flex items-center justify-center border border-red-500/20">
                      <Trash2 size={20} />
                    </button>
                  )}
                  <button type="submit" className="flex-1 bg-accent text-white font-black py-4 rounded-xl hover:bg-opacity-90 shadow-lg shadow-accent/20 transition uppercase tracking-wider text-sm">
                    {editingProduct ? 'Update Product' : 'Save Product'}
                  </button>
                </div>
              </form>
            </div>
          </div>
          </div>

          {/* ════════════ MODIFIER GROUPS MANAGEMENT — fb only ════════════ */}
          {BUSINESS_TYPE !== 'log' && <div className="bg-surface border border-white/8 shadow-md rounded-xl p-4 sm:p-6">
            <h3 className="text-xl font-bold mb-1 text-white">Modifier Groups</h3>
            <p className="text-xs text-white/40 mb-4">Required choices on a product (e.g. "Choose your milk"). Attach them to products in the form above.</p>
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Existing groups */}
              <div className="flex-1 space-y-2">
                {modifierGroups.length === 0 ? (
                  <p className="text-sm text-white/30 italic py-4">No modifier groups yet.</p>
                ) : modifierGroups.map(g => (
                  <div key={g._id} className="bg-page-bg border border-white/10 rounded-xl p-3 flex justify-between items-start">
                    <div className="min-w-0">
                      <p className="font-bold text-white text-sm">{g.name} {g.isRequired && <span className="text-[9px] bg-red-900/40 text-red-400 px-1.5 py-0.5 rounded uppercase ml-1">Required</span>}</p>
                      <p className="text-[11px] text-white/40 mt-0.5">Pick {g.minSelect}{g.maxSelect > g.minSelect ? `–${g.maxSelect}` : ''} · {(g.options||[]).map(o => o.name + (o.price ? ` (+₱${o.price})` : '')).join(', ')}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => editModifierGroup(g)} className="text-blue-300 hover:text-white hover:bg-blue-600 text-xs font-bold px-2 py-1 bg-blue-900/30 rounded transition">Edit</button>
                      <button onClick={() => deleteModifierGroup(g._id)} className="text-red-400 hover:text-white hover:bg-red-600 text-xs font-bold px-2 py-1 bg-red-900/30 rounded transition">Del</button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Editor */}
              <div className="w-full lg:w-96 bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
                <p className="text-sm font-black text-white uppercase tracking-wider">{editingModifier ? 'Edit Group' : 'New Group'}</p>
                <input type="text" placeholder="Group name (e.g. Choose your milk)" value={modForm.name}
                  onChange={e => setModForm({ ...modForm, name: e.target.value })}
                  className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-accent placeholder-white/20" />
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-white/60 font-bold">
                    <input type="checkbox" className="accent-accent" checked={modForm.isRequired} onChange={e => setModForm({ ...modForm, isRequired: e.target.checked })} /> Required
                  </label>
                  <label className="flex items-center gap-1 text-xs text-white/60 font-bold">Min
                    <input type="number" min="0" value={modForm.minSelect} onChange={e => setModForm({ ...modForm, minSelect: e.target.value })} className="w-12 bg-surface border border-white/10 rounded px-2 py-1 text-white text-center" />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-white/60 font-bold">Max
                    <input type="number" min="1" value={modForm.maxSelect} onChange={e => setModForm({ ...modForm, maxSelect: e.target.value })} className="w-12 bg-surface border border-white/10 rounded px-2 py-1 text-white text-center" />
                  </label>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] text-white/40 font-bold uppercase">Options</p>
                  {modForm.options.map((o, i) => (
                    <div key={i} className="flex gap-1.5 items-center">
                      <input type="text" placeholder="Option name" value={o.name}
                        onChange={e => { const opts=[...modForm.options]; opts[i]={...opts[i],name:e.target.value}; setModForm({...modForm,options:opts}); }}
                        className="flex-1 bg-surface border border-white/10 rounded px-2 py-1.5 text-white text-xs outline-none focus:border-accent" />
                      <input type="number" placeholder="₱0" value={o.price}
                        onChange={e => { const opts=[...modForm.options]; opts[i]={...opts[i],price:e.target.value}; setModForm({...modForm,options:opts}); }}
                        className="w-16 bg-surface border border-white/10 rounded px-2 py-1.5 text-white text-xs text-right outline-none focus:border-accent" />
                      <button onClick={() => setModForm({...modForm, options: modForm.options.filter((_,j)=>j!==i)})} className="text-red-400 hover:text-red-300 px-1 font-bold">✕</button>
                    </div>
                  ))}
                  <button onClick={() => setModForm({...modForm, options:[...modForm.options,{name:'',price:'',recipe:[]}]})}
                    className="w-full py-1.5 bg-white/5 text-white/50 rounded text-xs font-bold hover:bg-white/10 transition">+ Add option</button>
                </div>
                <div className="flex gap-2 pt-1">
                  {editingModifier && (
                    <button onClick={() => { setEditingModifier(null); setModForm({ name:'', isRequired:true, minSelect:1, maxSelect:1, options:[] }); }}
                      className="px-3 py-2 bg-white/5 text-white/50 rounded-lg text-xs font-bold hover:bg-white/10 transition">Cancel</button>
                  )}
                  <button onClick={saveModifierGroup} className="flex-1 py-2 bg-accent text-white rounded-lg text-xs font-black uppercase tracking-wider hover:bg-opacity-90 transition">
                    {editingModifier ? 'Update Group' : 'Create Group'}
                  </button>
                </div>
              </div>
            </div>
          </div>}

          {/* ════════════ COMBOS / BUNDLES (PRODUCT PROMOS) ════════════ */}
          <div className="bg-surface border border-white/8 shadow-md rounded-xl p-4 sm:p-6">
            <h3 className="text-xl font-bold mb-1 text-white">Product Promos &amp; Combos</h3>
            <p className="text-xs text-white/40 mb-4">Fixed-price bundles of existing products (e.g. "Budget Meal: Americano + Pandesal = ₱99"). Sold as one line; stock is deducted per component.</p>
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Existing combos */}
              <div className="flex-1 space-y-2">
                {combos.length === 0 ? (
                  <p className="text-sm text-white/30 italic py-4">No combos yet.</p>
                ) : combos.map(c => (
                  <div key={c._id} className="bg-page-bg border border-white/10 rounded-xl p-3 flex justify-between items-start">
                    <div className="min-w-0">
                      <p className="font-bold text-white text-sm">{c.name} <span className="text-brand font-black ml-1">₱{Number(c.price).toFixed(2)}</span></p>
                      <p className="text-[11px] text-white/40 mt-0.5">{(c.items||[]).map(i => `${i.quantity>1?i.quantity+'× ':''}${i.name}${i.sizeName?` (${i.sizeName})`:''}`).join(' + ')}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => editCombo(c)} className="text-blue-300 hover:text-white hover:bg-blue-600 text-xs font-bold px-2 py-1 bg-blue-900/30 rounded transition">Edit</button>
                      <button onClick={() => deleteCombo(c._id)} className="text-red-400 hover:text-white hover:bg-red-600 text-xs font-bold px-2 py-1 bg-red-900/30 rounded transition">Del</button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Combo editor */}
              <div className="w-full lg:w-96 bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
                <p className="text-sm font-black text-white uppercase tracking-wider">{editingCombo ? 'Edit Combo' : 'New Combo'}</p>
                <input type="text" placeholder="Combo name" value={comboForm.name}
                  onChange={e => setComboForm({ ...comboForm, name: e.target.value })}
                  className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-accent placeholder-white/20" />
                <div className="flex gap-2">
                  <input type="number" placeholder="Price ₱" value={comboForm.price}
                    onChange={e => setComboForm({ ...comboForm, price: e.target.value })}
                    className="w-28 bg-surface border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-black outline-none focus:border-accent" />
                  <input type="text" placeholder="Description (optional)" value={comboForm.description}
                    onChange={e => setComboForm({ ...comboForm, description: e.target.value })}
                    className="flex-1 bg-surface border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-accent placeholder-white/20" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] text-white/40 font-bold uppercase">Components</p>
                  {comboForm.items.map((it, i) => (
                    <div key={i} className="flex gap-1.5 items-center">
                      <span className="flex-1 text-xs text-white/80 bg-surface border border-white/10 rounded px-2 py-1.5 truncate">{it.quantity>1?it.quantity+'× ':''}{it.name}</span>
                      <input type="number" min="1" value={it.quantity}
                        onChange={e => { const items=[...comboForm.items]; items[i]={...items[i],quantity:e.target.value}; setComboForm({...comboForm,items}); }}
                        className="w-14 bg-surface border border-white/10 rounded px-2 py-1.5 text-white text-xs text-center outline-none" />
                      <button onClick={() => setComboForm({...comboForm, items: comboForm.items.filter((_,j)=>j!==i)})} className="text-red-400 hover:text-red-300 px-1 font-bold">✕</button>
                    </div>
                  ))}
                  <select value="" onChange={e => {
                      if (!e.target.value) return;
                      const p = products.find(pr => pr._id === e.target.value);
                      if (p) setComboForm({...comboForm, items:[...comboForm.items, { productId: p._id, name: p.name, sizeName: '', quantity: 1 }]});
                    }}
                    className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-white/70 text-xs outline-none focus:border-accent">
                    <option value="">+ Add component product…</option>
                    {products.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 pt-1">
                  {editingCombo && (
                    <button onClick={() => { setEditingCombo(null); setComboForm({ name:'', description:'', price:'', image:'', items:[] }); }}
                      className="px-3 py-2 bg-white/5 text-white/50 rounded-lg text-xs font-bold hover:bg-white/10 transition">Cancel</button>
                  )}
                  <button onClick={saveCombo} className="flex-1 py-2 bg-accent text-white rounded-lg text-xs font-black uppercase tracking-wider hover:bg-opacity-90 transition">
                    {editingCombo ? 'Update Combo' : 'Create Combo'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
  );
}
