import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag, Wifi, WifiOff, CloudOff } from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { usePwa } from '../../shared/usePwa';
import { buildReceiptHTML as buildSharedReceipt, printReceiptHTML, resolveLetterhead } from '../../shared/receiptTemplate';
import { buildEscposReceiptBytes, sleep as escposSleep, readPrinterMode, writePrinterMode } from '../../shared/escpos';
import { buildBillingDocHTML, printBillingDoc } from '../../shared/billingDocument';
import { queueOrder, requestNotificationPermission, notify, queueClock, getQueuedClock, flushClockQueue } from '../../shared/pwa';
import * as auth from '../auth/auth';
import { DashboardProvider } from './DashboardContext';
// Modals extracted out of this file. They read shared state via useDashboard()
// rather than props — see DashboardContext for why.
import EditInventoryModal from '../inventory/modals/EditInventoryModal';
import SpoilageModal from '../inventory/modals/SpoilageModal';
import SettleArModal from '../ledger/modals/SettleArModal';
import RevolvingFundNewModal from '../ledger/modals/RevolvingFundNewModal';
import RevolvingFundDisburseModal from '../ledger/modals/RevolvingFundDisburseModal';
import RevolvingFundReplenishModal from '../ledger/modals/RevolvingFundReplenishModal';
import RefundModal from '../orders/modals/RefundModal';
import NotificationBell from '../notifications/NotificationBell';
import CommandPalette from './CommandPalette';
import ShiftEndModal from '../shifts/modals/ShiftEndModal';
import StockHistoryModal from '../inventory/modals/StockHistoryModal';
import ImportModal from '../inventory/modals/ImportModal';
import PartialFulfillModal from '../orders/modals/PartialFulfillModal';
import ClockModal from './modals/ClockModal';
import ChangePasswordModal from './modals/ChangePasswordModal';
import * as ui from '../../shared/ui';
// Tabs are lazy-loaded so only the active tab's code ships on first dashboard
// paint; the rest load on demand when the operator opens them.
const AnalyticsTab  = lazy(() => import('../analytics/AnalyticsTab'));
const OrdersTab     = lazy(() => import('../orders/OrdersTab'));
const HistoryTab    = lazy(() => import('../orders/HistoryTab'));
const InventoryTab  = lazy(() => import('../inventory/InventoryTab'));
const LedgerTab     = lazy(() => import('../ledger/LedgerTab'));
const PricingTab    = lazy(() => import('../pricing/PricingTab'));
const AuditTab      = lazy(() => import('../audit/AuditTab'));
const ProductsTab   = lazy(() => import('../products/ProductsTab'));
const ProcurementTab = lazy(() => import('../procurement/ProcurementTab'));
const SettingsTab   = lazy(() => import('../settings/SettingsTab'));
const ClientsTab    = lazy(() => import('../clients/ClientsTab'));

// Small fallback shown while a tab chunk loads.
const TabFallback = () => (
  <div className="p-12 flex items-center justify-center text-fg/40 text-sm gap-2">
    <RefreshCw size={16} className="animate-spin" /> Loading…
  </div>
);
// '' is meaningful: it means same-origin (nginx proxies /api), so use ?? not ||
// — an UNSET var still falls back to the dev LAN box.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://192.168.100.2:5002';
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || 'http://192.168.100.2:3000';
const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();
// fb categories route to Kitchen; log categories route to Logistics. Every
// catForm reset/fallback must use this so a new category in log mode isn't
// silently saved as 'Kitchen' (which no log routing station serves).
const DEFAULT_DEPARTMENT = BUSINESS_TYPE === 'log' ? 'Logistics' : 'Kitchen';

// Lazy-load the PDF libraries (jspdf + jspdf-autotable, ~600KB) only when a PDF is
// actually generated — keeps them out of the initial dashboard load. Cached after
// first use. Every export/print fn does: const { jsPDF, autoTable } = await loadPdfLibs();
let _pdfLibsPromise = null;
const loadPdfLibs = () => {
  if (!_pdfLibsPromise) {
    _pdfLibsPromise = Promise.all([import('jspdf'), import('jspdf-autotable')])
      .then(([m1, m2]) => ({ jsPDF: m1.default, autoTable: m2.default }));
  }
  return _pdfLibsPromise;
};

const COMP_REASON_LABELS = {
  VIP_CUSTOMER:         'VIP Customer',
  CUSTOMER_RECOVERY:    'Customer Recovery',
  FOOD_QUALITY_ISSUE:   'Food Quality Issue',
  SERVICE_DELAY:        'Service Delay',
  EMPLOYEE_MEAL:        'Employee Meal',
  OWNER_APPROVAL:       'Owner Approval',
  MARKETING_PROMOTION:  'Marketing Promotion',
  INFLUENCER_PROMO:     'Influencer Promo',
  SYSTEM_ERROR:         'System Error',
  TRAINING_ORDER:       'Training Order',
  LOYALTY_REWARD:       'Loyalty Reward',
  EVENT_SPONSORSHIP:    'Event Sponsorship',
};

// Pass the in-memory access token on the socket handshake so the server can
// verify the user's role and auto-place them in the right room (server-decided,
// not client-declared — see io.use in server.js). The token is re-read on every
// (re)connect, so a fresh token after a refresh is picked up automatically.
const socket = io(API_URL, {
  transports: ['websocket'],
  upgrade: false,
  auth: (cb) => {
    try { cb({ token: auth.getToken?.() || '' }); }
    catch { cb({ token: '' }); }
  },
});

// New order arrives at kitchen — single sharp ding
const playKitchenDing = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.log('Audio ding blocked');
  }
};

// Order marked Ready — two-tone ascending chime (customer call)
const playReadyChime = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playNote = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
      gain.gain.setValueAtTime(0.7, ctx.currentTime + startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
      osc.start(ctx.currentTime + startTime);
      osc.stop(ctx.currentTime + startTime + duration);
    };
    playNote(660, 0,    0.25);
    playNote(880, 0.28, 0.35);
    playNote(1100, 0.56, 0.5);
  } catch (e) {
    console.log('Audio chime blocked');
  }
};

function MidnightCountdown() {
  const calc = () => {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const d = midnight - now;
    const h = Math.floor(d / 3600000).toString().padStart(2, '0');
    const m = Math.floor((d % 3600000) / 60000).toString().padStart(2, '0');
    const s = Math.floor((d % 60000) / 1000).toString().padStart(2, '0');
    return `${h}h ${m}m ${s}s`;
  };
  const [t, setT] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-brand font-black text-xs">{t}</span>;
}

const BIZ_NAME = (import.meta.env.VITE_BUSINESS_NAME || 'Kasa Lokal').toUpperCase();

// Money formatter for jsPDF output. The built-in PDF fonts have no ₱ glyph
// (it renders as "±"), so PDFs use plain comma-grouped numbers with negatives
// in accounting parentheses, e.g. 44,427.00 and (2,666.10).
const pdfMoney = (n) => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

export default function AdminDashboard() {
  // PWA runtime: connectivity, install prompt, offline order queue
  const { isOnline, installable, install, queuedCount, refreshQueue, syncQueue } = usePwa();
  const navigate = useNavigate(); // in-app (SPA) navigation — no full page reload

  const [paymentSelections, setPaymentSelections] = useState({});

  // Restore the last-viewed tab across page refreshes (was resetting to Orders&POS).
  // Falls back to 'orders' for a fresh session or bad/stale storage.
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem('dash.activeTab') || 'orders'; } catch { return 'orders'; }
  });
  const [navMode, setNavMode] = useState(() => {
    try { return localStorage.getItem('dash.navMode') || 'libellus'; } catch { return 'libellus'; }
  }); // 'libellus' (Operations) or 'negotium' (Management)
  useEffect(() => { try { localStorage.setItem('dash.activeTab', activeTab); } catch { /* ignore */ } }, [activeTab]);
  useEffect(() => { try { localStorage.setItem('dash.navMode', navMode); } catch { /* ignore */ } }, [navMode]);
  const [orderFilter, setOrderFilter] = useState('All'); 
  const [departmentFilter, setDepartmentFilter] = useState('All'); // 'All', 'Kitchen', 'Bar'
  const [expandedDays, setExpandedDays] = useState({}); 
  const [expandedOrderLists, setExpandedOrderLists] = useState({});
  
  const [showQR, setShowQR] = useState(false);
  const [orders, setOrders] = useState([]);
  const [archivedOrders, setArchivedOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [discountInputs, setDiscountInputs] = useState({});
  
  const [editingProduct, setEditingProduct] = useState(null);
  // Single source of truth for the empty product form — it used to be spelled out
  // at every reset site, and the copies drifted (some omitted discountPercent /
  // clientDiscounts, leaving stale values in the next product you added).
  const emptyProductForm = () => ({
    name: '', description: '', category: '', basePrice: '', discountPercent: 0, clientDiscounts: [],
    segmentDiscounts: [], bulkBreaks: [],
    baseSize: '', sizes: [], image: '', baseRecipe: [], addOns: [], modifierGroups: [], imageUrl: ''
  });
  const [formData, setFormData] = useState(emptyProductForm);
  const resetProductForm = () => { setEditingProduct(null); setFormData(emptyProductForm()); };
  const [catForm, setCatForm] = useState({ name: '', department: DEFAULT_DEPARTMENT });
  const [editingCategory, setEditingCategory] = useState(null);

  const [autoTableId, setAutoTableId] = useState('');

  const [inventory, setInventory] = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [invForm, setInvForm] = useState({ itemName: '', packQty: '', unitPerPack: '', unit: '', costPerPack: '', lowStockThreshold: '', expiryDate: '', expiryWarnDays: 7, creditAccount: '111000' });
  // --- INVENTORY EDIT MODAL ---
  const [editInvModal, setEditInvModal] = useState(null);   // { item } | null
  const [editInvForm, setEditInvForm] = useState({ itemCode: '', itemName: '', unit: '', unitCost: '', lowStockThreshold: '', expiryDate: '', expiryWarnDays: 7, displayUnit: '', packSize: '' });
  const [editInvSubmitting, setEditInvSubmitting] = useState(false);
  // --- BULK EXCEL IMPORT ---
  const [importModal, setImportModal] = useState(false);
  const [importRows, setImportRows] = useState([]);       // [{ itemName, displayUnit, qty, unitCost, _diff, _newItem, _existing }]
  const [importSubmitting, setImportSubmitting] = useState(false);
  // --- EXPIRY BATCHES EXPAND STATE ---
  const [expandedBatchRows, setExpandedBatchRows] = useState({}); // { [itemId]: bool }

  const [physicalCounts, setPhysicalCounts] = useState({});
  const [restockData, setRestockData] = useState({ addedStock: '', totalCost: '', creditAccount: '111000' });
  // --- ORDER SEARCH ---
  const [orderSearch, setOrderSearch] = useState('');
  // --- ORDER NOTES (POS) ---
  const [posNotes, setPosNotes] = useState('');
  // --- POS GUEST COUNT ---
  const [posGuestCount, setPosGuestCount] = useState(1);
  // --- MODIFIER GROUPS ---
  const [modifierGroups, setModifierGroups] = useState([]);
  // --- MULTI-PAYMENT ---
  const [posPayments, setPosPayments] = useState([]);
  // --- ARCHIVE SEARCH + DATE FILTER ---
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveDateRange, setArchiveDateRange] = useState({ start: '', end: '' });
  const [archiveTotal, setArchiveTotal] = useState(0);
  // --- CASH DENOMINATION BREAKDOWN ---
  const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];
  const [denomCounts, setDenomCounts] = useState({});
  const denomTotal = DENOMS.reduce((s, d) => s + (parseFloat(denomCounts[d]) || 0) * d, 0);
  // --- PROFIT BY CATEGORY ---
  const [profitByCategory, setProfitByCategory] = useState(null);
  // --- SYSTEM SETTINGS (QR toggle, etc.) ---
  const [systemSettings, setSystemSettings] = useState({ isAcceptingQROrders: true, autoCloseEnabled: true, imagesEnabled: true });
  // Registration stamp for every printed document. Derived in one place because
  // it appears on six of them, and a VAT-registered seller printing "NON-VAT
  // REGISTERED" on an official receipt is a compliance problem, not a typo.
  const vatRegistered = systemSettings.vatEnabled === true;
  const vatRegLabel = vatRegistered ? 'VAT REGISTERED' : 'NON-VAT REGISTERED';
  const vatStmtSuffix = vatRegistered ? '(VAT)' : '(Non-VAT)';
  // --- SALES BY PAYMENT ---
  const [salesByPayment, setSalesByPayment] = useState(null);
  const [sbpRange, setSbpRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10),
    end: new Date().toISOString().slice(0,10)
  });
  // --- SUMMARY SALES (by channel: cash / e-wallet / bank / delivery) ---
  const [salesSummary, setSalesSummary] = useState(null);
  const [sssRange, setSssRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10),
    end: new Date().toISOString().slice(0,10)
  });
  const [sssGroup, setSssGroup] = useState('order'); // 'order' | 'day'
  // --- SALES LINE ITEMS (one row per order item — item code + item detail) ---
  const [salesLineItems, setSalesLineItems] = useState(null);
  const [sliRange, setSliRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10),
    end: new Date().toISOString().slice(0,10)
  });
  // --- REFUND ---
  const [refundModal, setRefundModal] = useState(null);
  const [refundForm, setRefundForm] = useState({ reason: '', refundAmount: '', inventoryAction: 'Restock' });
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  // --- CLOCK IN/OUT ---
  const [clockStatus, setClockStatus] = useState({ isClockedIn: false, entry: null, onBreak: false, breakUsedMinutes: 0, breakRemainingMinutes: 60 });
  const [clockStatusLoaded, setClockStatusLoaded] = useState(false); // gates the clock-in screen until status is known
  const [clockModalOpen, setClockModalOpen] = useState(false);
  const [clockEntries, setClockEntries] = useState([]);
  const [clockEntriesTotal, setClockEntriesTotal] = useState(0);
  const [clockEntriesPage, setClockEntriesPage] = useState(1);
  // --- MODIFIER GROUP EDITOR ---
  const [editingModifier, setEditingModifier] = useState(null); // group being edited, or null
  const [modForm, setModForm] = useState({ name: '', isRequired: true, minSelect: 1, maxSelect: 1, options: [] });
  // --- COMBOS / BUNDLES (PRODUCT PROMOS) ---
  const [combos, setCombos] = useState([]);
  const [editingCombo, setEditingCombo] = useState(null);
  const [comboForm, setComboForm] = useState({ name: '', description: '', price: '', image: '', items: [] });
  // --- PARKED ORDERS / OPEN TABS ---
  const [parkedOrders, setParkedOrders] = useState([]);
  const [parkedModalOpen, setParkedModalOpen] = useState(false);
  // --- REPORTS: menu engineering, cashier variance, purchase order ---
  const [menuEngineering, setMenuEngineering] = useState(null);
  const [cashierVariance, setCashierVariance] = useState(null);
  const [purchaseOrder, setPurchaseOrder] = useState(null);
  const [commissions, setCommissions] = useState(null);
  // --- CHANGE PASSWORD MODAL ---
  const [changePwModal, setChangePwModal] = useState(false);
  const [changePwForm, setChangePwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [changePwLoading, setChangePwLoading] = useState(false);
  const [changePwError, setChangePwError] = useState('');
  // --- AUDIT LOGS ---
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLogsPage, setAuditLogsPage] = useState(1);
  const [auditLogsTotal, setAuditLogsTotal] = useState(0);
  const AUDIT_LOGS_PAGE_SIZE = 25;
  // action/actor/start/end — same query params /api/audit-logs and its CSV
  // export sibling both accept, so "Export" always matches what's on screen.
  const [auditLogFilters, setAuditLogFilters] = useState({ action: '', actor: '', start: '', end: '' });
  // --- AP OUTSTANDING ---
  const [apData, setApData] = useState(null);
  const [apPayModal, setApPayModal] = useState(false);
  const [apPayForm, setApPayForm] = useState({ amount: '', payFromAccount: '111000', description: '', vendorName: '', supplierId: '' });
  // Supplier list for the A/P payment picker (the Procurement tab keeps its own).
  const [suppliers, setSuppliers] = useState([]);
  const [apPaySubmitting, setApPaySubmitting] = useState(false);
  const [activeInventoryItem, setActiveInventoryItem] = useState(null); // For the restock modal

  const [stockHistory, setStockHistory] = useState([]);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyItemName, setHistoryItemName] = useState('');
  const [historyItem, setHistoryItem] = useState(null);

  const [cashOnHand, setCashOnHand] = useState(0);
  // --- NEW LOGIN STATES ---
  const [loginForm, setLoginForm] = useState({ name: '', password: '' });

  // Add this near your other state variables
  const [invSubTab, setInvSubTab] = useState('live'); // 'live' or 'eod'
  const [varianceReasons, setVarianceReasons] = useState({});
  const [varianceNoteMode, setVarianceNoteMode] = useState({});
  const [historyPage, setHistoryPage] = useState(1);
  const HIST_PAGE_SIZE = 15;
  const [auditFilter, setAuditFilter] = useState('today');
  const [auditCancelPage, setAuditCancelPage] = useState(1);
  const [auditCompPage, setAuditCompPage] = useState(1);
  const [auditDiscPage, setAuditDiscPage] = useState(1);
  const [auditStaffPage, setAuditStaffPage] = useState(1);
  const AUDIT_PAGE_SIZE = 15;

  // --- EOD STATES ---
  const [eodStatus, setEodStatus] = useState('OPEN');
  const [eodLockedAt, setEodLockedAt] = useState(null);
  const [dailyMovement, setDailyMovement] = useState({});

  const [discountList, setDiscountList] = useState([]);
  const [newDiscount, setNewDiscount] = useState({ name: '', percentage: '' });

  const [discounts, setDiscounts] = useState([]);
  const [discountForm, setDiscountForm] = useState({ name: '', percentage: '' });

  // --- INLINE PRICING STATES ---
  const [editPriceId, setEditPriceId] = useState(null);
  const [editPriceVal, setEditPriceVal] = useState('');
  const [editCostId, setEditCostId] = useState(null);
  const [editCostVal, setEditCostVal] = useState('');

  // --- ITEM-LEVEL DISCOUNT TRACKING ---
  const [discountedItems, setDiscountedItems] = useState({});
  const [scpwdOpen, setScpwdOpen] = useState({});
  const [collapsedOrders, setCollapsedOrders] = useState({}); // true = collapsed
  const [depositAmount, setDepositAmount] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState('');

  // Auth state starts empty (access token lives in memory, not localStorage).
  // On mount we silently call /api/auth/refresh; the httpOnly refresh cookie mints
  // a fresh access token if the session is still valid (see bootstrap effect below).
  const [activeAdmin, setActiveAdmin] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authBootstrapping, setAuthBootstrapping] = useState(true);

  // Silent-refresh bootstrap: restore the session from the refresh cookie on load.
  useEffect(() => {
    let cancelled = false;
    auth.refreshSession(API_URL).then((data) => {
      if (cancelled) return;
      if (data?.user) {
        setActiveAdmin(data.user); setIsAuthenticated(true);
      } else if (!navigator.onLine) {
        // OFFLINE on reload: the refresh cookie can't reach the server. Fall back to
        // the last signed-in user so the installed app keeps working (degraded mode:
        // reads come from cache, writes are queued and synced when back online).
        const u = auth.getUser();
        if (u) { setActiveAdmin(u); setIsAuthenticated(true); }
      }
      setAuthBootstrapping(false);
    });
    return () => { cancelled = true; };
  }, []);

  // --- SHIFT STATES ---
  const [startingCash, setStartingCash] = useState(() => localStorage.getItem('semivra_last_actual_cash') || '');
  const [shiftEndModal, setShiftEndModal] = useState(false);
  const [shiftReconcile, setShiftReconcile] = useState({ actualCash: '', result: null });
  const [shiftEndLoading, setShiftEndLoading] = useState(false);

  const [compSelections, setCompSelections] = useState({});
  const [compOverride, setCompOverride] = useState({});
  const [compReasonTypes, setCompReasonTypes] = useState({});
  const [compReasonNotes, setCompReasonNotes] = useState({});
  const [shiftFilter, setShiftFilter] = useState('All');
  const [dashDrawerOpen, setDashDrawerOpen] = useState(false);
  const [updatingOrders, setUpdatingOrders] = useState({}); // orderId → true while PUT in flight
  const [cashTendered, setCashTendered] = useState({}); // orderId → amount string
  const [loginError, setLoginError] = useState('');
  const [users, setUsers] = useState([]); // Stores the employee list

  const [globalAddOns, setGlobalAddOns] = useState([]);
  const [addOnForm, setAddOnForm] = useState({ name: '', price: '', category: 'Extras' });

  // --- MANUAL POS STATES ---
  const [isPosOpen, setIsPosOpen] = useState(false);
  const [posCart, setPosCart] = useState([]);
  const [posSubmitting, setPosSubmitting] = useState(false); // disables Place Order while in flight
  const posSubmittingRef = useRef(false);                    // synchronous double-tap guard
  const [posCategory, setPosCategory] = useState('All');
  const [posPage, setPosPage] = useState(1);
  const [posSearch, setPosSearch] = useState('');
  const POS_PER_PAGE = 9;
  const [posCustomerName, setPosCustomerName] = useState('');
  // Optional client account link — when set, the order qualifies for that
  // client's per-product discount overrides on the server side.
  const [posClientId, setPosClientId] = useState('');
  // Reserve-only mode: place order with status 'Reserved' (no payment yet).
  // Cashier later promotes Reserved → Pending (pay later) or Preparing (pay now).
  const [posReserveOnly, setPosReserveOnly] = useState(false);
  const [posTable, setPosTable] = useState(BUSINESS_TYPE === 'log' ? 'Pickup' : 'Dine-In');
  const [posPayment, setPosPayment] = useState('Cash');
  const [posSelectedProduct, setPosSelectedProduct] = useState(null);
  const [posActiveSize, setPosActiveSize] = useState(null);
  const [posActiveAddOns, setPosActiveAddOns] = useState([]);
  const [posItemQty, setPosItemQty] = useState(1);
  const [posDiscountType, setPosDiscountType] = useState('flat'); // 'flat' | 'percent'
  const [posDiscountValue, setPosDiscountValue] = useState('');
  const [posCheckoutModal, setPosCheckoutModal] = useState(false);
  const [posCashTendered, setPosCashTendered] = useState('');
  // --- DELIVERY DETAIL STATES ---
  const [posDeliveryAddress, setPosDeliveryAddress] = useState('');
  const [posCustomerPhone, setPosCustomerPhone] = useState('');
  const [posDeliveryFee, setPosDeliveryFee] = useState('');
  const [posScheduledTime, setPosScheduledTime] = useState('');
  // --- SPOILAGE MODAL STATE ---
  const [spoilageModal, setSpoilageModal] = useState(null); // { item }
  const [spoilageForm, setSpoilageForm] = useState({ qty: '', reason: '', note: '' });
  const [spoilageLoading, setSpoilageLoading] = useState(false);
  // --- SHIFT HISTORY STATE ---
  const [shiftHistory, setShiftHistory] = useState([]);
  const [shiftHistoryPage, setShiftHistoryPage] = useState(1);
  const [shiftHistoryTotal, setShiftHistoryTotal] = useState(0);
  const SHIFT_HIST_PAGE_SIZE = 15;
  // --- HISTORY SUB-TAB ---
  const [historySubTab, setHistorySubTab] = useState('daily'); // 'daily' | 'shifts'
  // --- LEDGER SUB-TABS + FINANCE DATA ---
  const [ledgerSubTab, setLedgerSubTab] = useState('journal'); // 'journal' | 'pnl' | 'balance' | 'ar' | 'expenses'
  const [pnlData, setPnlData] = useState(null);
  const [pnlRange, setPnlRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10),
    end: new Date().toISOString().slice(0,10)
  });
  // Monthly P&L (per-month columns + ratios; period & matrix views)
  const [pnlMonthly, setPnlMonthly] = useState(null);
  const [pnlmRange, setPnlmRange] = useState({
    start: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10),
    end: new Date().toISOString().slice(0,10)
  });
  const [pnlmView, setPnlmView] = useState('period'); // 'period' | 'matrix'
  const [bsData, setBsData] = useState(null);
  // Monthly Balance Sheet (per-month-end columns + ratios; period & matrix views)
  const [bsMonthly, setBsMonthly] = useState(null);
  const [bsmRange, setBsmRange] = useState({
    start: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10),
    end: new Date().toISOString().slice(0,10)
  });
  const [bsmView, setBsmView] = useState('period');
  const [arOutstanding, setArOutstanding] = useState({ orders: [], totalOutstanding: 0 });
  // Per-client A/R ageing + each client's credit limit and headroom.
  const [arAgeing, setArAgeing] = useState({ clients: [], totals: null, mode: 'off' });
  const [expenseModal, setExpenseModal] = useState(false);
  // Recent expenses + per-category totals backing the Expenses page.
  const [expenseList, setExpenseList] = useState({ expenses: [], byCategory: [], total: 0 });
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [expenseForm, setExpenseForm] = useState({ amount: '', categoryCode: '', paymentMethod: 'Cash on Hand', description: '', vendor: '', date: new Date().toISOString().slice(0,10) });
  const [expenseSubmitting, setExpenseSubmitting] = useState(false);
  const [settleModal, setSettleModal] = useState(null); // { order }
  const [settleForm, setSettleForm] = useState({ amount: '', paymentMethod: 'Cash on Hand', note: '' });
  const [settleSubmitting, setSettleSubmitting] = useState(false);

  // --- SERVER-SIDE ANALYTICS ---
  const [analyticsData, setAnalyticsData]     = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const fetchAnalytics = async () => {
    if (analyticsLoading) return;
    setAnalyticsLoading(true);
    try {
      const res  = await apiFetch('/api/analytics/dashboard');
      const data = await res.json();
      if (data.success) setAnalyticsData(data);
    } catch (err) { console.error('fetchAnalytics', err); }
    finally { setAnalyticsLoading(false); }
  };

  // Inventory turnover ratio (COGS ÷ avg inventory value) — a 2-point estimate,
  // see the server route's comment for why it isn't an exact historical figure.
  const [turnoverData, setTurnoverData] = useState(null);
  const fetchTurnover = async () => {
    try {
      const res = await apiFetch('/api/reports/inventory-turnover');
      const data = await res.json();
      if (data.success) setTurnoverData(data);
    } catch (err) { console.error('fetchTurnover', err); }
  };

  // Revenue trend: daily buckets + week/month-over-prior-period % change + moving average.
  const [salesTrendData, setSalesTrendData] = useState(null);
  const [salesTrendPeriod, setSalesTrendPeriod] = useState('week');
  const fetchSalesTrend = async (period = salesTrendPeriod) => {
    try {
      const res = await apiFetch(`/api/reports/sales-trend?period=${period}`);
      const data = await res.json();
      if (data.success) setSalesTrendData(data);
    } catch (err) { console.error('fetchSalesTrend', err); }
  };

  // --- REVOLVING FUND STATES ---
  const [rfFunds, setRfFunds] = useState([]);
  const [rfLoading, setRfLoading] = useState(false);
  const [rfActiveFund, setRfActiveFund] = useState(null);      // selected fund for transactions
  const [rfTxs, setRfTxs] = useState([]);
  const [rfTxTotal, setRfTxTotal] = useState(0);
  const [rfTxPage, setRfTxPage] = useState(1);
  const [rfTxPages, setRfTxPages] = useState(1);
  const [rfNewModal, setRfNewModal] = useState(false);
  const [rfNewForm, setRfNewForm] = useState({ name: '', initialAmount: '', description: '', sourceAccount: '111000' });
  const [rfNewSubmitting, setRfNewSubmitting] = useState(false);
  const [rfDisbModal, setRfDisbModal] = useState(false);
  const [rfDisbForm, setRfDisbForm] = useState({ amount: '', description: '', categoryCode: '760000' });
  const [rfDisbSubmitting, setRfDisbSubmitting] = useState(false);
  const [rfReplModal, setRfReplModal] = useState(false);
  const [rfReplForm, setRfReplForm] = useState({ amount: '', note: '', sourceAccount: '111000' });
  const [rfReplSubmitting, setRfReplSubmitting] = useState(false);

  // --- IN-APP ORDER TOAST (no browser popup) ---
  const [orderToasts, setOrderToasts] = useState([]); // [{ id, orderNumber, table, ts }]
  const pushOrderToast = (order) => {
    const id = Date.now();
    setOrderToasts(prev => [...prev.slice(-2), { id, orderNumber: order.orderNumber, table: order.table, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    setTimeout(() => setOrderToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  // Manager alerts (e.g. an unmapped payment tender parked in Unassigned Receipts).
  // Persist until dismissed — these are accounting exceptions the manager must act on.
  const [mgrAlerts, setMgrAlerts] = useState([]); // [{ id, message }]
  const dismissMgrAlert = (id) => setMgrAlerts(prev => prev.filter(a => a.id !== id));

  // --- FULLSCREEN LOGIC ---
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Command palette. Ctrl/Cmd+K is the accelerator; the header button is the
  // discoverable route for touchscreen users, who are most of the staff here.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Collapse the sidebar's utility tools (Fullscreen/QR/Password/toggles/Install)
  // to reclaim space. Persisted so the choice sticks across reloads.
  const [opsToolsOpen, setOpsToolsOpen] = useState(() => {
    try { return localStorage.getItem('semivra_ops_tools_open') === '1'; } catch { return false; }
  });
  const toggleOpsTools = () => setOpsToolsOpen(v => {
    const next = !v;
    try { localStorage.setItem('semivra_ops_tools_open', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);

  // --- PAGINATION STATE ---
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8; // You can change this number! 12 fits nicely on a tablet screen.

  // --- MENU ITEMS SEARCH / FILTER (Products tab left column) ---
  // A shop with 200 SKUs can't page through 8-at-a-time to find one item, so the
  // list is filtered BEFORE the pagination slice below.
  const [prodSearch, setProdSearch] = useState('');
  const [prodFilters, setProdFilters] = useState({
    category: 'all',
    image: 'all',      // all | with | without
    stock: 'all',      // all | in | low | out | untracked
    discount: 'all',   // all | discounted | full
    sizes: 'all',      // all | multi | single
    sort: 'name',      // name | name-desc | price | price-desc | category
  });
  // Any filter change invalidates the current page number (page 5 of a 2-page
  // result renders an empty list with no way back).
  useEffect(() => { setCurrentPage(1); }, [prodSearch, prodFilters]);

  // NEW: Inventory Pagination
  const [invPage, setInvPage] = useState(1);
  const invItemsPerPage = 12; // List items are small, we can fit 15

  // Inventory search + filter + sort
  const [invSearch, setInvSearch] = useState('');
  const [invSort, setInvSort] = useState('name-asc');
  const [invCategoryFilter, setInvCategoryFilter] = useState('');

  // Reset to page 1 when search/filter/sort changes
  useEffect(() => { setInvPage(1); }, [invSearch, invSort, invCategoryFilter]);

  // Import progress (0-100, -1 = idle)
  const [importProgress, setImportProgress] = useState(-1);

  // NEW: Orders Pagination
  const [ordersPage, setOrdersPage] = useState(1);
  const ordersItemsPerPage = 8; // Order cards are tall, 8 is perfect

  // NEW: Accounting Pagination
  const [accountingPage, setAccountingPage] = useState(1);
  const accountingItemsPerPage = 8; // Journal entries are tall, 10 is good
  // Journal is sorted by transaction date (chronological ledger) and only the
  // most recent ~500 are fetched — a backdated entry needs to be findable by
  // reference/description regardless of how far back its date sorts it.
  const [journalSearch, setJournalSearch] = useState('');

  // NEW: Pricing Pagination
  const [pricingPage, setPricingPage] = useState(1);
  const pricingItemsPerPage = 12; // Table rows are small, 15 fits perfectly

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Theme is applied once in App.jsx (saved device choice → VITE_THEME default).
  // This component must NOT re-apply it: mounting the dashboard would stomp the
  // user's saved theme back to the build-time default on every page load.

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };
  // --- JWT API HELPER ---
  // Use this wrapper for ALL fetch requests to the backend API.
  // It automatically attaches the JWT token from memory.
  // Add 'async' right here 👇
  // Delegates to the shared auth helper: attaches the in-memory access token,
  // auto-injects JSON content-type, and silently refreshes + retries once on 401.
  // A persistent 401 (refresh also failed) tears down the local session.
  const apiFetch = async (endpoint, options = {}) => {
    const response = await auth.apiFetch(API_URL, endpoint, options);
    if (response.status === 401) {
      setIsAuthenticated(false);
      setActiveAdmin(null);
      auth.clearToken();
    }
    return response;
  };

  const handleSystemLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_URL}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();

      if (!data.success) {
        // Show the server's reason when it gives one. Flattening every failure to
        // "invalid name or password" tells a rate-limited user their password is
        // wrong, so they retry harder and stay locked out longer.
        setLoginError(res.status === 429
          ? (data.error || 'Too many failed attempts. Please wait and try again.')
          : (data.error || 'Invalid name or password.'));
        return;
      }

      const isSuperAdminLogin = data.user?.role === 'superadmin';
      const cashAmount = parseFloat(startingCash);

      // Non-superadmins must declare their opening cash
      if (!isSuperAdminLogin && (!startingCash || isNaN(cashAmount) || cashAmount < 0)) {
        setLoginError('Please enter a valid Starting Cash amount (₱0 or more).');
        return;
      }

      auth.setToken(data.token);
      auth.setUser(data.user); // persist identity for offline use
      setIsAuthenticated(true);
      setActiveAdmin(data.user);

      // Superadmin with no cash entered → log shift with ₱0
      const finalCash = isSuperAdminLogin ? (isNaN(cashAmount) ? 0 : cashAmount) : cashAmount;
      try {
        const shiftRes = await fetch(`${API_URL}/api/shifts/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
          body: JSON.stringify({ startingCash: finalCash })
        });
        if (!shiftRes.ok) console.warn('Shift record failed to save - check server logs.');
      } catch {
        console.warn('Shift start request failed - shift may not be recorded.');
      }
      setStartingCash('');
      localStorage.removeItem('semivra_last_actual_cash');
    } catch (err) {
      setLoginError('Network error. Please try again.');
      console.error('Login failed', err);
    }
  };

  // Opens the End-of-Shift modal (does NOT clear session yet)
  const handleLogout = () => {
    // Owner/superadmin isn't a tracked cashier — no register count required; log out directly.
    if (activeAdmin?.role === 'superadmin') { performLogout(); return; }
    setShiftReconcile({ actualCash: '', result: null });
    setShiftEndModal(true);
  };

  // Called when cashier confirms End-of-Shift cash count
  const handleEndShift = async () => {
    // Use denomination total if bills were counted; fall back to manual entry
    const actual = denomTotal > 0 ? denomTotal : parseFloat(shiftReconcile.actualCash);
    if (isNaN(actual) || actual < 0) return ui.alert('Please count your bills or enter a cash amount.');
    setShiftEndLoading(true);
    try {
      const res = await apiFetch('/api/shifts/end', {
        method: 'POST',
        body: JSON.stringify({ actualCash: actual })
      });
      const data = await res.json();
      if (data.success) {
        setShiftReconcile(prev => ({ ...prev, result: data.shift }));
        localStorage.setItem('semivra_last_actual_cash', data.shift.actualCash.toString());
      } else {
        // Shift may not exist (e.g., session expired) — still allow logout
        setShiftReconcile(prev => ({ ...prev, result: null }));
        performLogout();
      }
    } catch {
      performLogout();
    } finally {
      setShiftEndLoading(false);
    }
  };

  const handleBankDeposit = async () => {
    if (!shiftReconcile.result) return;
    setDepositError('');
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) { setDepositError('Enter a valid amount.'); return; }
    setDepositLoading(true);
    try {
      const res = await apiFetch('/api/bank-deposits', {
        method: 'POST',
        body: JSON.stringify({ shiftId: shiftReconcile.result._id, amount })
      });
      const data = await res.json();
      if (data.success) {
        setShiftReconcile(prev => ({ ...prev, result: data.shift }));
        setDepositAmount('');
      } else {
        setDepositError(data.error || 'Deposit failed.');
      }
    } catch { setDepositError('Network error.'); }
    finally { setDepositLoading(false); }
  };

  // Final logout — clears all session data
  const performLogout = async () => {
    // Auto clock-out so staff aren't left "clocked in" after ending their shift.
    // Must run BEFORE the session is revoked (apiFetch still has a valid token here).
    if (clockStatus.isClockedIn) {
      try { await apiFetch('/api/clock/out', { method: 'POST', body: '{}' }); } catch { /* non-blocking */ }
    }
    auth.logout(API_URL); // revoke refresh session server-side + clear cookie
    auth.clearToken();
    setIsAuthenticated(false);
    setActiveAdmin(null);
    setLoginForm({ name: '', password: '' });
    setShiftEndModal(false);
    setShiftReconcile({ actualCash: '', result: null });
    setOrders([]);
    setArchivedOrders([]);
  };

  // Token validation handled in state initializer above; this effect is intentionally empty

  const getSelectedItems = (order) => {
    if (discountedItems[order._id] !== undefined) return discountedItems[order._id];
    return order.items.map((_, i) => i); // Default: All items selected
  };

  const toggleItemDiscount = (orderId, idx) => {
    setDiscountedItems(prev => {
      const current = prev[orderId] || [];
      if (current.includes(idx)) return { ...prev, [orderId]: current.filter(i => i !== idx) };
      return { ...prev, [orderId]: [...current, idx] };
    });
  };

  const toggleAllItems = (orderId, itemCount) => {
    setDiscountedItems(prev => {
      const current = prev[orderId] || [];
      if (current.length === itemCount) return { ...prev, [orderId]: [] }; // Deselect all
      return { ...prev, [orderId]: Array.from({length: itemCount}, (_, i) => i) }; // Select all
    });
  };

  const handleInlinePriceUpdate = async (productId, sizeIndex) => {
    const product = products.find(p => p._id === productId);
    if (!product) return;

    // Every price change must carry a reason. Audit log records it; server
    // also writes a memo journal entry so finance can trace it later.
    const newPrice = parseFloat(editPriceVal) || 0;
    const oldPrice = sizeIndex === null ? (product.basePrice || 0) : (product.sizes?.[sizeIndex]?.price || 0);
    if (Math.abs(newPrice - oldPrice) < 0.005) { setEditPriceId(null); return; }
    const reason = window.prompt(`Reason for changing price of "${product.name}" from ₱${oldPrice.toFixed(2)} → ₱${newPrice.toFixed(2)}?`, '');
    if (reason === null) return; // cancelled
    if (!reason.trim()) return ui.alert('A reason is required for every price change.');

    const updatedProduct = { ...product };
    if (sizeIndex === null) updatedProduct.basePrice = newPrice;
    else updatedProduct.sizes[sizeIndex].price = newPrice;

    try {
      await apiFetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Change-Reason': encodeURIComponent(reason.trim()) },
        body: JSON.stringify(updatedProduct)
      });
      setEditPriceId(null);
      fetchData();
    } catch (err) {
      console.error("Failed to update price", err);
    }
  };

  const handleInlineCostUpdate = async (productId, sizeIndex) => {
    const product = products.find(p => p._id === productId);
    if (!product) return;
    const val = parseFloat(editCostVal);
    const newCost = isNaN(val) ? 0 : val;
    const oldCost = sizeIndex === null ? (product.costOverride || 0) : (product.sizes?.[sizeIndex]?.costOverride || 0);
    if (Math.abs(newCost - oldCost) < 0.005) { setEditCostId(null); return; }
    const reason = window.prompt(`Reason for changing recipe cost of "${product.name}" from ₱${oldCost.toFixed(2)} → ₱${newCost.toFixed(2)}?`, '');
    if (reason === null) return;
    if (!reason.trim()) return ui.alert('A reason is required for every recipe cost change.');

    const updatedProduct = { ...product };
    if (sizeIndex === null) {
      updatedProduct.costOverride = isNaN(val) ? undefined : val;
    } else {
      updatedProduct.sizes = updatedProduct.sizes.map((s, i) =>
        i === sizeIndex ? { ...s, costOverride: isNaN(val) ? undefined : val } : s
      );
    }
    try {
      await apiFetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Change-Reason': encodeURIComponent(reason.trim()) },
        body: JSON.stringify(updatedProduct)
      });
      setEditCostId(null);
      fetchData();
    } catch (err) {
      console.error('Failed to update cost', err);
    }
  };

  const MENU_CACHE_KEY = 'semivra_menu_cache';
  const fetchData = async () => {
    // OFFLINE: hydrate the menu from the last cached snapshot so the POS still works.
    if (!navigator.onLine) {
      try {
        const c = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || 'null');
        if (c) {
          setProducts(c.products || []); setCategories(c.categories || []);
          setDiscounts(c.discounts || []); setGlobalAddOns(c.addons || []);
          setModifierGroups(c.modifierGroups || []); setCombos(c.combos || []);
        }
      } catch { /* ignore */ }
      return;
    }
    try {
      const get = async (url, key) => { const r = await apiFetch(url); return r.ok ? ((await r.json())[key] || []) : null; };
      const products       = await get('/api/products', 'products');
      const categories     = await get('/api/categories', 'categories');
      const discounts      = await get('/api/discounts', 'discounts');
      const addons         = await get('/api/addons', 'addons');
      const modifierGroups = await get('/api/modifier-groups', 'groups');
      const combos         = await get('/api/combos?all=1', 'combos');

      if (products)       setProducts(products);
      if (categories)     setCategories(categories);
      if (discounts)      setDiscounts(discounts);
      if (addons)         setGlobalAddOns(addons);
      if (modifierGroups) setModifierGroups(modifierGroups);
      if (combos)         setCombos(combos);

      // Cache a snapshot for offline use (keep prior values for any part that failed).
      try {
        const prev = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || '{}');
        localStorage.setItem(MENU_CACHE_KEY, JSON.stringify({
          products: products ?? prev.products, categories: categories ?? prev.categories,
          discounts: discounts ?? prev.discounts, addons: addons ?? prev.addons,
          modifierGroups: modifierGroups ?? prev.modifierGroups, combos: combos ?? prev.combos,
        }));
      } catch { /* quota / private mode - ignore */ }
    } catch (err) { console.error('Failed to fetch menu data', err); }
  };

  // 3. Add these two handler functions right above your return() statement:
  const handleSaveAddOn = async (e) => {
    e.preventDefault();
    const { _id, ...body } = addOnForm;
    const url = _id ? `/api/addons/${_id}` : '/api/addons';
    await apiFetch(url, { method: _id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setAddOnForm({ name: '', price: '', category: 'Extras' });
    fetchData();
  };
  
  const deleteAddOn = async (id) => {
    if(await ui.confirm('Delete this Add-on?')) await apiFetch(`/api/addons/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const fetchERPData = async (journalSearchTerm) => {
    try {
      const invRes = await apiFetch(`/api/inventory`);
      if (invRes.ok) setInventory((await invRes.json()).items || []);

      const isSuperAdmin = activeAdmin?.role === 'superadmin';
      if (isSuperAdmin) {
        // limit=500 (server max) — the default 50 sorts by transaction date, so
        // an old-dated entry (e.g. a backdated sale) can fall off the page once
        // there are 500+ more-recent entries. When the caller passes a search
        // term, hit the server's own search (unbounded by date sort) instead of
        // relying on whatever happens to be in this recent-500 window — the
        // client-side filter over journalEntries can only ever find entries
        // that were already fetched.
        const q = (journalSearchTerm || '').trim();
        const jeUrl = q ? `/api/journal?limit=500&search=${encodeURIComponent(q)}` : `/api/journal?limit=500`;
        const jeRes = await apiFetch(jeUrl);
        if (jeRes.ok) setJournalEntries((await jeRes.json()).entries || []);

        const balRes = await apiFetch(`/api/finance/balances`);
        if (balRes.ok) setCashOnHand((await balRes.json()).cashOnHand || 0);
      }
    } catch (err) { console.error('Failed to fetch ERP data', err); }
  };

  const fetchEODData = async () => {
    try {
      const res = await apiFetch(`/api/inventory/eod-data`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setEodStatus(data.status);
        setEodLockedAt(data.lockedAt);
        setDailyMovement(data.movement);
      }
    } catch (err) { console.error("Failed to fetch EOD data"); }
  };

  const fetchDiscounts = async () => {
    try {
      const res = await apiFetch(`/api/discounts`);
      if (res.ok) setDiscountList((await res.json()).discounts);
    } catch (err) { console.error("Failed to fetch discounts"); }
  };

  const fetchUsers = async () => {
    try {
      const res = await apiFetch(`/api/users`);
      if (res.ok) {
        const data = await res.json();
        // THE FIX: Filter out the Super Admin so they don't appear in the dropdown!
        const employeesOnly = data.users.filter(u => u.role !== 'superadmin');
        setUsers(employeesOnly);
      }
    } catch (err) { 
      console.error("Failed to fetch users"); 
    }
  };

  const fetchOrders = async () => {
    try {
      const cacheBuster = new Date().getTime();
      const res = await apiFetch(`/api/orders?t=${cacheBuster}`, { cache: 'no-store' });
      if (res.ok) setOrders((await res.json()).orders || []);

      // Archives endpoint requires superadmin — skip for staff to avoid forced logout via 403
      if (activeAdmin?.role === 'superadmin') {
        const archParams = new URLSearchParams({ t: cacheBuster });
        if (archiveSearch) archParams.set('search', archiveSearch);
        if (archiveDateRange.start) archParams.set('start', archiveDateRange.start);
        if (archiveDateRange.end) archParams.set('end', archiveDateRange.end);
        const archRes = await apiFetch(`/api/orders/archives?${archParams.toString()}`, { cache: 'no-store' });
        if (archRes.ok) { const d = await archRes.json(); setArchivedOrders(d.archives || []); setArchiveTotal(d.total || 0); }
      }
    } catch (err) { console.error('Failed to fetch orders', err); }
  };

  // Sends one queued offline order. The stable queue-entry id is the idempotency
  // key, so replaying a half-sent order won't create a duplicate. Returns true on
  // success so the queue drops it; false/throw keeps it for the next attempt.
  const sendQueuedOrder = async (entry) => {
    try {
      const res = await apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': entry.id },
        body: JSON.stringify(entry.payload),
      });
      const data = await res.json();
      return !!data.success;
    } catch { return false; }
  };

  // Replay a queued offline clock event against the server, backdating it to when
  // it actually happened (`at`) so payroll hours stay accurate.
  const sendQueuedClock = async (e) => {
    const path = e.type === 'out' ? '/api/clock/out' : '/api/clock/in';
    try {
      const res = await apiFetch(path, { method: 'POST', body: JSON.stringify({ at: e.at }) });
      const d = await res.json().catch(() => ({}));
      return res.ok && d.success !== false;
    } catch { return false; }
  };

  const flushOfflineQueue = () => {
    if (!navigator.onLine || !isAuthenticated) return;
    syncQueue(sendQueuedOrder).then(({ sent }) => { if (sent > 0) fetchOrders(); });
    if (getQueuedClock().length > 0) {
      flushClockQueue(sendQueuedClock).then(({ sent }) => { if (sent > 0) fetchClockStatus(); });
    }
  };

  // Auto-flush the offline order queue: on reconnect/login, whenever the queue
  // grows (e.g. a mid-request failure while still "online"), and on a periodic
  // safety-net timer so nothing is ever stranded.
  useEffect(() => {
    if (isOnline && isAuthenticated && queuedCount > 0) flushOfflineQueue();
    const id = setInterval(() => { if (queuedCount > 0) flushOfflineQueue(); }, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, isAuthenticated, queuedCount]);

  const injectOwnerCapital = async () => {
    const amountStr = prompt("Enter amount of capital to inject from Owner's Equity:");
    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) return;

    const jePayload = {
      description: 'Owner Capital Injection',
      lines: [
        { accountCode: '111000', accountName: 'Cash on Hand', debit: amount, credit: 0 },
        { accountCode: '310000', accountName: 'Owner Equity', debit: 0, credit: amount }
      ]
    };

    await apiFetch(`/api/journal`, { 
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(jePayload) 
    });
    fetchERPData();
    ui.alert(`₱${amount.toFixed(2)} injected into Cash on Hand.`);
  };

  const fetchStockHistory = async (item) => {
    try {
      const res = await apiFetch(`/api/inventory/history/${item._id}`);
      const data = await res.json();
      if (data.success) {
        setStockHistory(data.history);
        setHistoryItemName(item.itemName);
        setHistoryItem(item);
        setHistoryPage(1);
        setHistoryModalOpen(true);
      }
    } catch (err) { console.error("Failed to fetch history"); }
  };
  
  const [jeForm, setJeForm] = useState({
    description: '',
    lines: [
      { accountCode: '', accountName: '', debit: '', credit: '' },
      { accountCode: '', accountName: '', debit: '', credit: '' }
    ]
  });

  const standardAccounts = [
    { accountCode: '111000', accountName: 'Cash on Hand', type: 'Asset' },
    { accountCode: '112000', accountName: 'Cash in Bank', type: 'Asset' },
    { accountCode: '113000', accountName: 'E-Wallet', type: 'Asset' },
    { accountCode: '120000', accountName: 'Accounts Receivable', type: 'Asset' },
    { accountCode: '130000', accountName: 'Inventory Asset', type: 'Asset' },
    { accountCode: '220000', accountName: 'Accounts Payable', type: 'Liability' },
    { accountCode: '230000', accountName: 'Taxes Payable', type: 'Liability' },
    { accountCode: '310000', accountName: 'Owner Equity', type: 'Equity' },
    { accountCode: '410000', accountName: 'Sales Revenue', type: 'Revenue' },
    { accountCode: '440000', accountName: 'Sales Returns', type: 'Revenue' },
    { accountCode: '510000', accountName: 'Cost of Goods Sold', type: 'Expense' },
    { accountCode: '600000', accountName: 'Operating Expenses', type: 'Expense' },
    { accountCode: '540000', accountName: 'Complimentary Expense', type: 'Expense' }
  ];

  // ── Chart of Accounts (custom child accounts) ──────────────────────────────
  const [coaAccounts, setCoaAccounts] = useState([]);
  const [coaParent, setCoaParent]   = useState('');
  const [coaNewName, setCoaNewName] = useState('');
  const [coaEditId, setCoaEditId]   = useState(null);
  const [coaEditName, setCoaEditName] = useState('');
  const [coaBusy, setCoaBusy]       = useState(false);
  const fetchCoa = useCallback(async () => {
    try { const r = await apiFetch('/api/coa'); const d = await r.json(); if (d.success) setCoaAccounts(d.accounts); } catch { /* ignore */ }
  }, []);
  const addCoaChild = async () => {
    if (!coaParent || !coaNewName.trim()) return ui.alert('Pick a parent account and enter a name.');
    setCoaBusy(true);
    try {
      const r = await apiFetch('/api/accounts', { method: 'POST', body: JSON.stringify({ parentCode: coaParent, name: coaNewName.trim() }) });
      const d = await r.json();
      if (d.success) { setCoaNewName(''); fetchCoa(); } else ui.alert(d.error || 'Failed to add account.');
    } catch { ui.alert('Failed to add account.'); } finally { setCoaBusy(false); }
  };
  const renameCoaChild = async (id) => {
    if (!coaEditName.trim()) return setCoaEditId(null);
    try {
      const r = await apiFetch(`/api/accounts/${id}`, { method: 'PUT', body: JSON.stringify({ name: coaEditName.trim() }) });
      const d = await r.json();
      if (d.success) { setCoaEditId(null); fetchCoa(); } else ui.alert(d.error || 'Rename failed.');
    } catch { ui.alert('Rename failed.'); }
  };
  const deleteCoaChild = async (id) => {
    if (!(await ui.confirm('Delete this custom account? (Blocked if it has posted entries.)'))) return;
    try {
      const r = await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) fetchCoa(); else ui.alert(d.error || 'Delete failed.');
    } catch { ui.alert('Delete failed.'); }
  };

  // Re-run the boot-time seed for payment-method sub-accounts. Safe to invoke
  // repeatedly — idempotent server-side. Surfaces what got created vs skipped.
  const seedPaymentSubaccounts = async () => {
    if (!(await ui.confirm('Create the standard payment-method sub-accounts (GCash, Maya, Foodpanda, etc.)? Existing accounts are skipped.'))) return;
    try {
      const r = await apiFetch('/api/admin/seed-payment-subaccounts', { method: 'POST' });
      const d = await r.json();
      if (d.success) {
        const lines = [
          `✅ Created: ${d.created.length}`,
          ...d.created.map(c => `  • ${c.code} ${c.name} (under ${c.parent})`),
          d.skipped.length ? `\n⚠️ Skipped: ${d.skipped.length}` : '',
          ...d.skipped.map(s => `  • ${s.code} ${s.name} - ${s.reason}`),
        ].filter(Boolean);
        ui.alert(lines.join('\n'));
        fetchCoa(); fetchPaymentMap?.();
      } else ui.alert(d.error || 'Seed failed.');
    } catch (e) { ui.alert('Network error: ' + (e?.message || e)); }
  };

  // ── Closed accounting periods ───────────────────────────────────────────────
  const [closedPeriods, setClosedPeriods] = useState([]);
  const [periodCloseForm, setPeriodCloseForm] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() || 12, notes: '' });
  const fetchClosedPeriods = useCallback(async () => {
    try { const r = await apiFetch('/api/periods'); const d = await r.json(); if (d.success) setClosedPeriods(d.periods || []); } catch { /* ignore */ }
  }, []);
  const closePeriod = async () => {
    const y = Number(periodCloseForm.year), m = Number(periodCloseForm.month);
    if (!y || !m || m < 1 || m > 12) return ui.alert('Pick a valid year and month.');
    if (!(await ui.confirm(`Lock ${y}-${String(m).padStart(2,'0')}? Back-dated journal entries into that month will be blocked.`))) return;
    try {
      const r = await apiFetch('/api/periods/close', { method: 'POST', body: JSON.stringify({ year: y, month: m, notes: periodCloseForm.notes }) });
      const d = await r.json();
      if (d.success) {
        fetchClosedPeriods();
        setPeriodCloseForm({ ...periodCloseForm, notes: '' });
        // Closing takes effect immediately (it must — it's a lock), so this is a
        // real reversal via the existing reopen route, not a deferred write.
        const periodId = d.period?._id;
        if (periodId) {
          await ui.undoable(async () => {
            const rr = await apiFetch(`/api/periods/${periodId}/reopen`, { method: 'POST' });
            const dd = await rr.json();
            if (!dd.success) throw new Error(dd.error || 'reopen failed');
            fetchClosedPeriods();
          }, {
            message: `Locked ${y}-${String(m).padStart(2, '0')}.`,
            undoMessage: `Reopened ${y}-${String(m).padStart(2, '0')}.`,
          });
        }
      }
      else ui.alert(d.error || 'Failed to close period.');
    } catch { ui.alert('Network error closing period.'); }
  };
  const reopenPeriod = async (id) => {
    if (!(await ui.confirm('Reopen this period? Back-dated journal entries will be allowed again.'))) return;
    try {
      const r = await apiFetch(`/api/periods/${id}/reopen`, { method: 'POST' });
      const d = await r.json();
      if (d.success) fetchClosedPeriods();
      else ui.alert(d.error || 'Failed to reopen.');
    } catch { ui.alert('Network error.'); }
  };

  // ── Tenancy backfill report ─────────────────────────────────────────────────
  const [tenancyReport, setTenancyReport] = useState(null);
  const [tenancyBusy, setTenancyBusy] = useState(false);
  const fetchTenancyReport = useCallback(async () => {
    try { const r = await apiFetch('/api/admin/tenancy-report'); const d = await r.json(); if (d.success) setTenancyReport(d); } catch { /* ignore */ }
  }, []);
  const runTenancyRebackfill = async () => {
    if (!(await ui.confirm('Stamp current businessType on every legacy doc that is missing it?'))) return;
    setTenancyBusy(true);
    try {
      const r = await apiFetch('/api/admin/tenancy-rebackfill', { method: 'POST' });
      const d = await r.json();
      if (d.success) { await fetchTenancyReport(); ui.alert(`Stamped: Orders ${d.stamped.Order}, Products ${d.stamped.Product}, Inventory ${d.stamped.Inventory}, Categories ${d.stamped.Category}.`); }
      else ui.alert(d.error || 'Re-backfill failed.');
    } finally { setTenancyBusy(false); }
  };

  // ── Backdated Sales (superadmin only) ──────────────────────────────────────
  const [backdateForm, setBackdateForm] = useState({ date: '', customerName: '', amount: '', paymentMethod: 'Cash', notes: '' });
  const [backdateBusy, setBackdateBusy] = useState(false);
  const submitBackdateSale = async () => {
    if (!backdateForm.date) return ui.alert('Date is required.');
    const amt = parseFloat(backdateForm.amount);
    if (!amt || amt <= 0) return ui.alert('Enter a positive amount.');
    if (!(await ui.confirm(`Record a backdated sale of ₱${amt.toFixed(2)} on ${backdateForm.date}? A balanced journal entry will be posted to the chosen payment account.`))) return;
    setBackdateBusy(true);
    try {
      const r = await apiFetch('/api/admin/backdate-sale', { method: 'POST', body: JSON.stringify(backdateForm) });
      const d = await r.json();
      if (d.success) {
        ui.alert(`Backdated sale recorded: ${d.order.orderNumber}\nJournal ref: ${d.journalReference}`);
        setBackdateForm({ date: '', customerName: '', amount: '', paymentMethod: 'Cash', notes: '' });
      } else ui.alert(d.error || 'Failed to record backdated sale.');
    } catch { ui.alert('Network error.'); }
    finally { setBackdateBusy(false); }
  };

  // ── Payment Method → Account Map ───────────────────────────────────────────
  const [paymentMap, setPaymentMap] = useState({ defaults: {}, overrides: {}, effective: {} });
  const fetchPaymentMap = useCallback(async () => {
    try { const r = await apiFetch('/api/payment-method-map'); const d = await r.json(); if (d.success) setPaymentMap({ defaults: d.defaults || {}, overrides: d.overrides || {}, effective: d.effective || {} }); } catch { /* ignore */ }
  }, []);
  const savePaymentMapping = async (method, accountCode) => {
    try {
      const r = await apiFetch('/api/payment-method-map', { method: 'PUT', body: JSON.stringify({ method, accountCode }) });
      const d = await r.json();
      if (d.success) setPaymentMap(prev => ({ ...prev, effective: d.effective, overrides: { ...prev.overrides, [method]: accountCode } }));
      else ui.alert(d.error || 'Failed to save mapping.');
    } catch { ui.alert('Network error saving mapping.'); }
  };
  const resetPaymentMapping = async (method) => {
    if (!(await ui.confirm(`Reset "${method}" back to its default account?`))) return;
    try {
      const r = await apiFetch(`/api/payment-method-map/${encodeURIComponent(method)}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) setPaymentMap(prev => {
        const ov = { ...prev.overrides }; delete ov[method];
        return { ...prev, effective: d.effective, overrides: ov };
      });
      else ui.alert(d.error || 'Failed to reset.');
    } catch { ui.alert('Network error.'); }
  };

  // ── Audit log fetch ─────────────────────────────────────────────────────────
  const [auditLogEntries, setAuditLogEntries] = useState([]);
  const [auditLogPage, setAuditLogPage] = useState(1);
  const [auditLogPages, setAuditLogPages] = useState(1);
  const [auditLogFilter, setAuditLogFilter] = useState({ entity: '', actor: '' });
  const fetchAuditLog = useCallback(async (page = 1) => {
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (auditLogFilter.entity) qs.set('entity', auditLogFilter.entity);
      if (auditLogFilter.actor)  qs.set('actor', auditLogFilter.actor);
      const r = await apiFetch(`/api/audit-log?${qs.toString()}`);
      const d = await r.json();
      if (d.success) { setAuditLogEntries(d.entries || []); setAuditLogPage(d.page || 1); setAuditLogPages(d.pages || 1); }
    } catch { /* ignore */ }
  }, [auditLogFilter]);

  // ── Derive selectable account lists (canonical + custom children) ───────────
  // Used by every "Paid From / Charge To" dropdown across procurement, expenses,
  // AR settle, and AP vendor payment so that adding a sub-account in the COA UI
  // shows up everywhere automatically.
  const accountsUnder = useCallback((parentCode) => {
    const parentMatch = coaAccounts.find(a => a.code === parentCode);
    const parent = parentMatch ? [{ code: parentMatch.code, name: parentMatch.name }] : [];
    const children = coaAccounts
      .filter(a => a.custom && a.parent === parentCode)
      .map(a => ({ code: a.code, name: a.name }));
    return [...parent, ...children];
  }, [coaAccounts]);
  const cashAndBankAccounts = useMemo(() => [
    ...accountsUnder('111000'), ...accountsUnder('112000'), ...accountsUnder('113000'),
  ], [accountsUnder]);
  const apAccounts = useMemo(() => accountsUnder('220000'), [accountsUnder]);
  const arAccounts = useMemo(() => accountsUnder('120000'), [accountsUnder]);
  const procurementCreditAccounts = useMemo(() => [
    ...cashAndBankAccounts, ...apAccounts,
  ], [cashAndBankAccounts, apAccounts]);

  // ── Client accounts list (for per-product per-client discount picker) ──
  const [clientAccounts, setClientAccounts] = useState([]);
  const fetchClientAccounts = useCallback(async () => {
    try {
      const r = await apiFetch('/api/client-accounts');
      if (!r.ok) return; // non-superadmin gets 403 - silently skip
      const d = await r.json();
      if (d.success) setClientAccounts(d.clients || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (isAuthenticated) { fetchDiscounts(); fetchCoa(); fetchClientAccounts(); fetchClosedPeriods(); fetchPaymentMap(); } }, [isAuthenticated]);

  // ── Partial fulfillment (logistics) ────────────────────────────────────────
  const [partialModal, setPartialModal] = useState(null);  // the order being split
  const [partialQtys, setPartialQtys] = useState({});      // { [itemIndex]: fulfilledQty }
  const [partialMode, setPartialMode] = useState('partial');// 'partial' | 'full'
  const [partialPayment, setPartialPayment] = useState('Cash');
  const [partialBusy, setPartialBusy] = useState(false);
  const openPartial = (order) => {
    setPartialModal(order);
    setPartialMode('partial');
    setPartialPayment(order.paymentMethod || 'Cash');
    // Default: fulfill all that's still outstanding; operator lowers the short lines.
    setPartialQtys(Object.fromEntries((order.items || []).map((it, i) => [i, (it.quantity || 0) - (it.fulfilledQty || 0)])));
  };
  const submitPartialFulfill = async () => {
    if (!partialModal || partialBusy) return;
    const fulfill = (partialModal.items || []).map((it, i) => {
      const remaining = (it.quantity || 0) - (it.fulfilledQty || 0);
      return { index: i, qty: Math.max(0, Math.min(remaining, Number(partialQtys[i] ?? remaining))) };
    });
    if (!fulfill.some(f => f.qty > 0)) return ui.alert('Enter at least one unit to fulfill now.');
    setPartialBusy(true);
    try {
      const res = await apiFetch(`/api/orders/${partialModal._id}/partial-fulfill`, {
        method: 'POST',
        body: JSON.stringify({ fulfill, paymentMode: partialMode, paymentMethod: partialPayment || 'Cash' }),
      });
      const d = await res.json();
      if (d.success) { setPartialModal(null); fetchOrders(); fetchERPData?.(); ui.alert(d.order?.status === 'Completed' ? 'Order fully fulfilled and completed.' : 'Partial fulfillment saved. Remaining stays on the same order.'); }
      else ui.alert(d.error || 'Partial fulfillment failed.');
    } catch { ui.alert('Partial fulfillment failed.'); } finally { setPartialBusy(false); }
  };
  // Drop the un-fulfilled remainder: the order finalizes as Completed at the
  // fulfilled quantity (already in the ledger); the dropped units are recorded
  // but post nothing. This replaces the old "cancel the whole order" behaviour,
  // which wrongly voided the fulfilled portion that was already booked.
  const dropRemaining = async (order) => {
    if (!(await ui.confirm('Drop the remaining un-fulfilled units? The fulfilled units stay Completed and in the ledger; only the undelivered units are dropped.'))) return;
    try {
      const res = await apiFetch(`/api/orders/${order._id}/drop-remaining`, { method: 'POST' });
      const d = await res.json();
      if (d.success) { fetchOrders(); fetchERPData?.(); ui.alert('Remaining dropped. Order completed at the fulfilled quantity.'); }
      else ui.alert(d.error || 'Failed to drop remaining.');
    } catch { ui.alert('Failed to drop remaining.'); }
  };
  useEffect(() => { if (isAuthenticated) { fetchSettings(); fetchClockStatus(); fetchParked(); } }, [isAuthenticated]);

  // --- REAL-TIME AUTO REFRESH ---
  // Effect 1: ERP/EOD sub-tab listeners — uses named callbacks so .off() is scoped
  useEffect(() => {
    const handleERPForEOD = () => {
      fetchERPData();
      if (invSubTab === 'eod') fetchEODData();
    };
    socket.on('erpUpdated', handleERPForEOD);
    socket.on('orderUpdated', handleERPForEOD);
    return () => {
      socket.off('erpUpdated', handleERPForEOD);
      socket.off('orderUpdated', handleERPForEOD);
    };
  }, [invSubTab]);

  // Effect 2: Order list + menu listeners — named callbacks so cleanup doesn't nuke Effect 1's handlers
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchOrders();
    fetchData();
    fetchERPData();
    fetchUsers();
    requestNotificationPermission(); // ask once so new-order alerts can show in the installed app

    // Force a reconnect so the handshake picks up the fresh token from auth.getToken().
    // Room placement is server-decided based on the verified JWT — no more
    // client-declared role (which an attacker could spoof to elevate to manager).
    try { socket.disconnect(); socket.connect(); } catch { /* ignore */ }
    // Back-compat: the server now ignores this payload but we keep emitting it
    // so older server builds during deploy don't drop the event.
    socket.emit('joinRoom', activeAdmin?.role || 'staff');

    const handleNewOrder    = (order) => {
      setOrders(prev => [order, ...prev]); playKitchenDing(); pushOrderToast(order);
      // OS notification (mainly useful when the app is backgrounded/installed)
      if (typeof document !== 'undefined' && document.hidden) {
        notify('New order', `${order.orderNumber || ''} · ${order.table || 'Takeout'}${order.customerName ? ' · ' + order.customerName : ''}`.trim());
      }
    };
    const handleOrderUpdate = (updated) => setOrders(prev => prev.map(o => o._id === updated._id ? updated : o));
    const handleMenuUpdate  = () => fetchData();
    const handleArchived    = () => fetchOrders();
    const handleERPUpdate   = () => fetchERPData();
    const handleMgrAlert    = (a) => {
      const id = Date.now() + Math.random();
      setMgrAlerts(prev => [...prev.slice(-4), { id, message: a?.message || 'Accounting alert' }]);
      if (typeof document !== 'undefined' && document.hidden) notify('Accounting alert', a?.message || '');
    };

    socket.on('newOrder',       handleNewOrder);
    socket.on('orderUpdated',   handleOrderUpdate);
    socket.on('menuUpdated',    handleMenuUpdate);
    socket.on('ordersArchived', handleArchived);
    socket.on('erpUpdated',     handleERPUpdate);
    socket.on('mgrAlert',       handleMgrAlert);

    return () => {
      socket.off('newOrder',       handleNewOrder);
      socket.off('orderUpdated',   handleOrderUpdate);
      socket.off('menuUpdated',    handleMenuUpdate);
      socket.off('ordersArchived', handleArchived);
      socket.off('erpUpdated',     handleERPUpdate);
      socket.off('mgrAlert',       handleMgrAlert);
    };
  }, [isAuthenticated]);

  // --- MANUAL POS LOGIC ---
  const openProductModal = (product) => {
    setPosSelectedProduct(product);
    setPosActiveSize(null);
    setPosActiveAddOns([]);
    setPosItemQty(1);
  };

  const confirmPosItem = () => {
    if (!posSelectedProduct) return;

    // Validate required modifier groups
    const unmetGroups = (posSelectedProduct.modifierGroups || []).filter(mg => {
      const group = typeof mg === 'object' ? mg : modifierGroups.find(g => g._id === mg);
      if (!group || !group.isRequired) return false;
      const selected = posActiveAddOns.filter(a => a.name.startsWith(group.name + ': ')).length;
      return selected < (group.minSelect || 1);
    });
    if (unmetGroups.length > 0) {
      const names = unmetGroups.map(mg => typeof mg === 'object' ? mg.name : modifierGroups.find(g => g._id === mg)?.name || mg).join(', ');
      return ui.alert(`Please make a selection for: ${names}`);
    }

    let finalPrice = posSelectedProduct.basePrice || posSelectedProduct.price || 0;
    let finalName = posSelectedProduct.name;
    
    if (posActiveSize !== null) {
      const sizeObj = posSelectedProduct.sizes[posActiveSize];
      finalPrice = sizeObj.price;
      finalName = `${posSelectedProduct.name} (${sizeObj.name})`;
    }
    
    const productCategory = categories.find(c => c.name === posSelectedProduct.category);
    const department = productCategory?.department || 'Kitchen';

    const newItem = {
      productId: posSelectedProduct._id,
      name: finalName,
      price: finalPrice,
      quantity: Math.max(1, posItemQty),
      department,
      selectedAddOns: [...posActiveAddOns]
    };

    setPosCart([...posCart, newItem]);
    setPosSelectedProduct(null);
  };

  const posSubtotal = posCart.reduce((sum, item) => sum + ((item.price + item.selectedAddOns.reduce((s, a) => s + Number(a.price), 0)) * item.quantity), 0);
  const posItemDiscountAmt = posCart.reduce((sum, item) => {
    const base = (item.price + item.selectedAddOns.reduce((s, a) => s + Number(a.price), 0)) * item.quantity;
    return sum + base * ((item.discountPercent || 0) / 100);
  }, 0);
  const posDeliveryFeeNum = parseFloat(posDeliveryFee) || 0;
  const posDiscountAmt = posDiscountType === 'percent'
    ? (posSubtotal - posItemDiscountAmt) * (Math.min(100, parseFloat(posDiscountValue) || 0) / 100)
    : Math.min(posSubtotal - posItemDiscountAmt, parseFloat(posDiscountValue) || 0);
  const posGrandTotal = Math.max(0, posSubtotal - posItemDiscountAmt - posDiscountAmt + posDeliveryFeeNum);
  const posCashChange = Math.max(0, (parseFloat(posCashTendered) || 0) - posGrandTotal);

  const submitManualOrder = async () => {
    // Synchronous double-tap guard — blocks a second submit before React re-renders.
    if (posSubmittingRef.current) return;
    if (posCart.length === 0) return ui.alert("Cart is empty!");
    if (!posCustomerName) return ui.alert("Please enter Customer / Driver Name.");
    const isDelivery = posTable === 'Manual Delivery';
    const isPickup = posTable === 'Pickup';
    if (isDelivery && !posDeliveryAddress) return ui.alert("Please enter delivery address.");
    if ((isDelivery || isPickup) && !posCustomerPhone) return ui.alert("Please enter customer phone number.");

    posSubmittingRef.current = true;
    setPosSubmitting(true);
    // Idempotency key so even if two requests slip through (retry/proxy), the
    // server returns the same order instead of creating a duplicate.
    const idemKey = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

    // Manual orders are PLACED as Pending — payment/checkout happens later from
    // the Orders "All view" when the order is completed (same as dine-in/QR).
    const payload = {
      items: posCart,
      table: posTable,
      customerName: posCustomerName,
      // Linking to a client account lets the server resolve per-client product
      // discount overrides for this order. Optional — falls back to the
      // product's default discountPercent when blank.
      clientAccountId: posClientId || undefined,
      reserveOnly: posReserveOnly || undefined,
      paymentMethod: ['Grab Delivery', 'Foodpanda', 'Manual Delivery', 'Lalamove'].includes(posTable) ? posTable : 'Cash',
      isComplimentary: false,
      sessionId: null,
      deliveryAddress: posDeliveryAddress,
      customerPhone: posCustomerPhone,
      deliveryFee: posDeliveryFeeNum,
      scheduledTime: posScheduledTime,
      dispatchStatus: (isDelivery || isPickup) ? 'Preparing' : '',
      orderNotes: posNotes.trim(),
      guestCount: Math.max(1, parseInt(posGuestCount) || 1),
    };

    // Reset the POS form back to a clean slate after a successful (or queued) order.
    const resetPosForm = () => {
      setIsPosOpen(false);
      setPosCart([]);
      setPosCustomerName('');
      setPosClientId('');
      setPosReserveOnly(false);
      setPosDeliveryAddress('');
      setPosCustomerPhone('');
      setPosDeliveryFee('');
      setPosScheduledTime('');
      setPosTable(BUSINESS_TYPE === 'log' ? 'Pickup' : 'Dine-In');
      setPosSearch('');
      setPosNotes('');
      setPosGuestCount(1);
    };

    // OFFLINE: if the device is offline, queue the order locally and move on.
    if (!navigator.onLine) {
      queueOrder(payload, idemKey);
      refreshQueue();
      resetPosForm();
      ui.alert('You are offline. Order saved and will sync automatically when the connection returns.');
      posSubmittingRef.current = false; setPosSubmitting(false);
      return;
    }

    try {
      const res = await apiFetch(`/api/orders`, {
        method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        // Apply any manually-set per-item discounts from the POS cart
        const cartWithDisc = posCart.filter(item => (item.discountPercent || 0) > 0);
        if (cartWithDisc.length > 0 && data.order?._id) {
          await apiFetch(`/api/orders/${data.order._id}`, {
            method: 'PUT',
            body: JSON.stringify({ items: posCart.map(item => ({ discountPercent: item.discountPercent || 0 })) }),
          });
        }
        if (BUSINESS_TYPE === 'log') fetchERPData();
        resetPosForm();
        fetchOrders();
      } else {
        ui.alert(data.error);
      }
    } catch (e) {
      // Network died mid-request — queue it under the SAME idempotency key so the
      // replay can't duplicate an order the server may have already received.
      console.error(e);
      queueOrder(payload, idemKey);
      refreshQueue();
      resetPosForm();
      ui.alert('Connection lost. Order saved and will sync automatically when the connection returns.');
    } finally {
      posSubmittingRef.current = false;
      setPosSubmitting(false);
    }
  };

const updateStatus = async (orderId, newStatus) => {
    if (updatingOrders[orderId]) return; // double-tap guard
    setUpdatingOrders(prev => ({ ...prev, [orderId]: true }));

    // 1. Grab the order so we can check if it's a delivery
    const order = orders.find(o => o._id === orderId);

    const payload = { status: newStatus };

    if (newStatus === 'Preparing') {
      // Payment is always operator-changeable. Use the dropdown selection if made,
      // else default to the delivery channel (for delivery orders) or the order's method.
      const isDeliveryTable = order && ['Grab Delivery', 'Foodpanda', 'Manual Delivery', 'Lalamove'].includes(order.table);
      payload.paymentMethod = paymentSelections[orderId]
        || (isDeliveryTable ? order.table : null)
        || (order ? order.paymentMethod : 'Cash') || 'Cash';
      // Include cash tendered for cash payments
      if (payload.paymentMethod === 'Cash' && cashTendered[orderId]) {
        payload.amountTendered = parseFloat(cashTendered[orderId]) || 0;
      }
    }


    // Play ready chime when order is called out to customer
    if (newStatus === 'Ready') playReadyChime();

    // Optimistic UI update
    setOrders(prev => prev.map(o => o._id === orderId ? { ...o, ...payload } : o));
    socket.emit('updateOrderStatus', { orderId, status: newStatus });

    // Backend Sync
    try {
      const res = await apiFetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!data.success) {
        ui.alert(data.error);
        fetchOrders();
      } else if (newStatus === 'Preparing' && BUSINESS_TYPE === 'log') {
        const prepOrder = { ...order, ...payload, ...data.order };
        // Logistics print format is admin-configurable in Settings → Printer
        // Settings: the A4 billing statement, the 80mm thermal receipt, or both.
        const fmt = systemSettings.logReceiptFormat || 'billing';
        if (fmt === 'thermal' || fmt === 'both') printOrderSlip(prepOrder);
        if (fmt === 'billing' || fmt === 'both') printBillingStatement(prepOrder);
      } else if (newStatus === 'Completed' && BUSINESS_TYPE === 'log') {
        fetchERPData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingOrders(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    }
  };

  const updateItemStatus = async (order, itemIndex, newStatus) => {
    const newItems = [...order.items];
    
    // FIX: Deep clone the specific item so we don't directly mutate React state
    newItems[itemIndex] = { ...newItems[itemIndex], itemStatus: newStatus };
    
    // Update UI instantly
    setOrders(prev => prev.map(o => o._id === order._id ? { ...o, items: newItems } : o));
    
    // Send to backend
    await apiFetch(`/api/orders/${order._id}`, {
      method: 'PUT',
      body: JSON.stringify({ items: newItems })
    });
  };

  const removeAddOnFromOrder = async (order, itemIndex, addOnIndex) => {
    if (!(await ui.confirm("Remove this add-on from the customer's order?"))) return;
    
    const newItems = [...order.items];
    newItems[itemIndex].selectedAddOns = newItems[itemIndex].selectedAddOns.filter((_, idx) => idx !== addOnIndex);
    
    // Optimistic UI
    setOrders(prev => prev.map(o => o._id === order._id ? { ...o, items: newItems } : o));
    
    // Backend Sync (which recalculates the total price)
    try {
      const res = await apiFetch(`/api/orders/${order._id}`, {
        method: 'PUT',
        body: JSON.stringify({ items: newItems })
      });
      const data = await res.json();
      if (data.success) {
        fetchOrders(); // Refresh to get the accurate new total
      } else {
        ui.alert(data.error);
        fetchOrders(); // Revert on fail
      }
    } catch (err) {
      console.error(err);
    }
  };

  const applyComplimentary = async (orderId) => {
    const reasonType = compReasonTypes[orderId];
    if (!reasonType) return ui.alert("Select a reason type for the complimentary order.");
    const forEmployee = compSelections[orderId] || activeAdmin?.name || 'Unknown';
    const approvedBy = activeAdmin?.name || 'Manager';
    setCompOverride(prev => ({ ...prev, [orderId]: { isComplimentary: true, employeeName: forEmployee } }));
    try {
      const res = await apiFetch(`/api/orders/${orderId}/complimentary`, {
        method: 'PUT',
        body: JSON.stringify({
          reasonType,
          reasonNote: compReasonNotes[orderId] || '',
          approvedBy,
          forEmployee
        })
      });
      const data = await res.json();
      if (!data.success) {
        setCompOverride(prev => { const n = { ...prev }; delete n[orderId]; return n; });
        ui.alert(data.error || 'Failed to apply complimentary.');
      }
    } catch (err) {
      setCompOverride(prev => { const n = { ...prev }; delete n[orderId]; return n; });
      console.error('Failed to apply complimentary:', err);
      ui.alert('Network error - complimentary not applied.');
    }
  };

  const removeComplimentary = async (orderId) => {
    setCompOverride(prev => ({ ...prev, [orderId]: { isComplimentary: false, employeeName: '' } }));
    setCompReasonTypes(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    setCompReasonNotes(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    setCompSelections(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    await apiFetch(`/api/orders/${orderId}/complimentary`, { method: 'DELETE' });
  };
  // (No per-order VAT handler. The rate is the business's registration and lives
  // in Settings; SC/PWD exemption is applied through the SC/PWD discount control,
  // which sets isVatExempt as a side effect of choosing that discount type.)
  const applyDiscount = async (orderId, isRemoving = false) => {
    const order = orders.find(o => o._id === orderId);
    const percent = isRemoving ? 0 : parseFloat(discountInputs[orderId] || 0);
    if (percent < 0 || percent > 100) return ui.alert('Discount must be between 0% and 100%');
    
    // Grab the ticked checkboxes
    const selectedIndices = isRemoving ? [] : getSelectedItems(order);

    // Auto-detect SC/PWD to trigger isolated VAT Exemption
    let isVatExempt = false;
    let discountType = 'None';
    const selectedVal = discountInputs[orderId];
    const selectedObj = discounts.find(d => d.percentage.toString() === selectedVal);
    
    if (selectedObj && selectedObj.isSCPWD) {
      isVatExempt = true;
      discountType = 'SC/PWD';
    } else if (percent > 0) {
      discountType = 'Promo';
    }

    await apiFetch(`/api/orders/${orderId}`, { 
      method: 'PUT', 
      body: JSON.stringify({ 
        discountPercent: percent,
        isVatExempt,
        discountType,
        discountedIndices: selectedIndices 
      }) 
    });
    if (isRemoving) setDiscountInputs(prev => ({ ...prev, [orderId]: '' }));
  };

  const applyItemDiscount = async (orderId, itemIndex, discountPercent) => {
    try {
      // We send this to your existing order update route, specifically targeting the items array
      const order = orders.find(o => o._id === orderId);
      if (!order) return;

      const updatedItems = [...order.items];
      updatedItems[itemIndex].discountPercent = Number(discountPercent);

      const res = await apiFetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updatedItems })
      });
      
      const data = await res.json();
      if (data.success) fetchOrders();
    } catch (err) {
      console.error(err);
    }
  };
  const fetchShiftHistory = async (page = 1) => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/shifts?page=${page}&limit=${SHIFT_HIST_PAGE_SIZE}`);
      const data = await res.json();
      if (data.success) { setShiftHistory(data.shifts); setShiftHistoryTotal(data.total); setShiftHistoryPage(page); }
    } catch (err) { console.error('fetchShiftHistory', err); }
  };

  // ===== FINANCE FETCHERS =====
  const fetchPnl = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/reports/pnl?start=${pnlRange.start}&end=${pnlRange.end}`);
      const data = await res.json();
      if (data.success) setPnlData(data);
    } catch (err) { console.error('fetchPnl', err); }
  };
  const fetchPnlMonthly = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/reports/pnl-monthly?start=${pnlmRange.start}&end=${pnlmRange.end}`);
      const data = await res.json();
      if (data.success) setPnlMonthly(data);
    } catch (err) { console.error('fetchPnlMonthly', err); }
  };
  const exportPnlMonthlyPDF = async () => {
    if (!pnlMonthly) return ui.alert('Load the Monthly P&L first.');
    const { jsPDF, autoTable } = await loadPdfLibs();
    const m = pnlMonthly;
    const doc = new jsPDF(pnlmView === 'matrix' ? 'landscape' : 'portrait');
    doc.setFontSize(16); doc.text(`${BIZ_NAME} - Profit & Loss`, 14, 14);
    doc.setFontSize(9); doc.text(`${pnlmRange.start} to ${pnlmRange.end}  ·  ${pnlmView === 'matrix' ? 'Monthly' : 'Period'}`, 14, 20);
    const SECTIONS = [['revenue','REVENUE'],['contra','LESS: DISCOUNTS/RETURNS'],['cogs','COST OF SALES'],['opex','OPERATING EXPENSES'],['otherincome','OTHER INCOME'],['otherexpense','OTHER EXPENSES']];
    const nr = m.grandTotals.netRevenue || 0;
    if (pnlmView === 'matrix') {
      const head = ['Account', ...m.months, 'Total'];
      const body = [];
      for (const [sec, label] of SECTIONS) {
        body.push([{ content: label, colSpan: head.length, styles: { fontStyle: 'bold', fillColor: [236,241,227] } }]);
        m.accounts.filter(a => a.section === sec).forEach(a => body.push([`  ${a.code} ${a.name}`, ...m.months.map(mm => pdfMoney(a.byMonth[mm] || 0)), pdfMoney(a.total)]));
      }
      body.push(['NET INCOME', ...m.months.map(mm => pdfMoney(m.monthTotals.netIncome[mm] || 0)), pdfMoney(m.grandTotals.netIncome)]);
      autoTable(doc, { startY: 24, head: [head], body, styles: { fontSize: 6 }, headStyles: { fillColor: [111,135,77] } });
    } else {
      const head = ['Account', 'Amount', '% Rev', '% Parent'];
      const parentTotals = {};
      m.accounts.forEach(a => { parentTotals[a.parentCode] = (parentTotals[a.parentCode] || 0) + a.total; });
      const body = [];
      for (const [sec, label] of SECTIONS) {
        const rows = m.accounts.filter(a => a.section === sec);
        if (!rows.length) continue;
        body.push([{ content: label, colSpan: 4, styles: { fontStyle: 'bold', fillColor: [236,241,227] } }]);
        rows.forEach(a => body.push([`  ${a.code} ${a.name}`, pdfMoney(a.total), nr ? `${(a.total/nr*100).toFixed(1)}%` : '-', parentTotals[a.parentCode] ? `${(a.total/parentTotals[a.parentCode]*100).toFixed(1)}%` : '-']));
      }
      body.push(['NET INCOME', pdfMoney(m.grandTotals.netIncome), nr ? `${(m.grandTotals.netIncome/nr*100).toFixed(1)}%` : '-', '']);
      autoTable(doc, { startY: 24, head: [head], body, styles: { fontSize: 8 }, headStyles: { fillColor: [111,135,77] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } });
    }
    doc.save(`PnL-${pnlmRange.start}_to_${pnlmRange.end}.pdf`);
  };
  const fetchBsMonthly = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/reports/balance-sheet-monthly?start=${bsmRange.start}&end=${bsmRange.end}`);
      const data = await res.json();
      if (data.success) setBsMonthly(data);
    } catch (err) { console.error('fetchBsMonthly', err); }
  };
  const exportBsMonthlyPDF = async () => {
    if (!bsMonthly) return ui.alert('Load the Monthly Balance Sheet first.');
    const { jsPDF, autoTable } = await loadPdfLibs();
    const b = bsMonthly;
    const doc = new jsPDF(bsmView === 'matrix' ? 'landscape' : 'portrait');
    doc.setFontSize(16); doc.text(`${BIZ_NAME} - Balance Sheet`, 14, 14);
    doc.setFontSize(9); doc.text(`${bsmRange.start} to ${bsmRange.end}  ·  ${bsmView === 'matrix' ? 'Monthly' : 'As of ' + b.asOf}`, 14, 20);
    const SECTIONS = [['assets','ASSETS'],['liabilities','LIABILITIES'],['equity','EQUITY']];
    const totalAssets = b.monthTotals.assets[b.asOf] || 0;
    if (bsmView === 'matrix') {
      const head = ['Account', ...b.months];
      const body = [];
      for (const [sec, label] of SECTIONS) {
        body.push([{ content: label, colSpan: head.length, styles: { fontStyle: 'bold', fillColor: [236,241,227] } }]);
        b[sec].forEach(a => body.push([`  ${a.code} ${a.name}`, ...b.months.map(mm => pdfMoney(a.byMonth[mm] || 0))]));
        body.push([`  Total ${label}`, ...b.months.map(mm => pdfMoney(b.monthTotals[sec][mm] || 0))]);
      }
      autoTable(doc, { startY: 24, head: [head], body, styles: { fontSize: 6 }, headStyles: { fillColor: [111,135,77] } });
    } else {
      const head = ['Account', 'Amount', '% Assets', '% Parent'];
      const parentTotals = {};
      [...b.assets, ...b.liabilities, ...b.equity].forEach(a => { parentTotals[a.parentCode] = (parentTotals[a.parentCode] || 0) + a.total; });
      const body = [];
      for (const [sec, label] of SECTIONS) {
        body.push([{ content: label, colSpan: 4, styles: { fontStyle: 'bold', fillColor: [236,241,227] } }]);
        b[sec].forEach(a => body.push([`  ${a.code} ${a.name}`, pdfMoney(a.total), totalAssets ? `${(a.total/totalAssets*100).toFixed(1)}%` : '-', parentTotals[a.parentCode] ? `${(a.total/parentTotals[a.parentCode]*100).toFixed(1)}%` : '-']));
        body.push([`  Total ${label}`, pdfMoney(b.monthTotals[sec][b.asOf] || 0), '', '']);
      }
      autoTable(doc, { startY: 24, head: [head], body, styles: { fontSize: 8 }, headStyles: { fillColor: [111,135,77] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } });
    }
    doc.save(`BalanceSheet-${bsmRange.start}_to_${bsmRange.end}.pdf`);
  };
  const fetchBalanceSheet = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/reports/balance-sheet`);
      const data = await res.json();
      if (data.success) setBsData(data);
    } catch (err) { console.error('fetchBalanceSheet', err); }
  };
  // Resolve negative/incorrect book inventory by reconciling 130000 to actual on-hand value.
  const reconcileInventory = async () => {
    if (!(await ui.confirm('Reconcile book Inventory (130000) to the ACTUAL on-hand value (Σ stock × unit cost)?\n\nThis posts a balancing journal entry offset to Owner\'s Capital - use it to set opening inventory / fix a negative inventory balance.'))) return;
    try {
      const res = await apiFetch('/api/inventory/revalue', { method: 'POST', body: JSON.stringify({ offsetAccount: '310000' }) });
      const d = await res.json();
      if (!d.success) return ui.alert(d.error || 'Reconcile failed.');
      if (d.diff === 0) ui.alert('Inventory already matches on-hand value - nothing to adjust.');
      else ui.alert(`Inventory reconciled.\n\nActual on-hand:  ₱${d.onHand.toFixed(2)}\nWas (book):      ₱${d.book.toFixed(2)}\nAdjustment:      ${d.diff >= 0 ? '+' : ''}₱${d.diff.toFixed(2)}`);
      fetchBalanceSheet(); if (pnlMonthly) fetchPnlMonthly(); if (bsMonthly) fetchBsMonthly(); fetchERPData();
    } catch { ui.alert('Network error.'); }
  };
  const fetchArOutstanding = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/finance/ar-outstanding`);
      const data = await res.json();
      if (data.success) setArOutstanding({ orders: data.orders, totalOutstanding: data.totalOutstanding });
    } catch (err) { console.error('fetchArOutstanding', err); }
  };
  // Per-client ageing is server-computed so the buckets, the credit limits and
  // the order-time enforcement all read from one rule set.
  const fetchExpenses = async () => {
    try {
      const res = await apiFetch('/api/expenses');
      const d = await res.json();
      if (d.success) setExpenseList({ expenses: d.expenses || [], byCategory: d.byCategory || [], total: d.total || 0 });
    } catch (err) { console.error('fetchExpenses', err); }
  };
  const fetchSuppliers = async () => {
    try {
      const res = await apiFetch('/api/suppliers');
      const d = await res.json();
      if (d.success) setSuppliers(d.suppliers || []);
    } catch (err) { console.error('fetchSuppliers', err); }
  };
  const fetchArAgeing = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch('/api/finance/ar-ageing');
      const data = await res.json();
      if (data.success) setArAgeing({ clients: data.clients || [], totals: data.totals, mode: data.mode });
    } catch (err) { console.error('fetchArAgeing', err); }
  };
  // ── REVOLVING FUND FETCHERS ─────────────────────────────────────────────────
  const fetchRfFunds = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    setRfLoading(true);
    try {
      const res = await apiFetch('/api/revolving-funds');
      const data = await res.json();
      if (data.success) setRfFunds(data.funds);
    } catch (err) { console.error('fetchRfFunds', err); }
    finally { setRfLoading(false); }
  };

  const fetchRfTxs = async (fundId, page = 1) => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/revolving-funds/${fundId}/transactions?page=${page}&limit=20`);
      const data = await res.json();
      if (data.success) {
        setRfTxs(data.txs);
        setRfTxTotal(data.total);
        setRfTxPage(data.page);
        setRfTxPages(data.pages);
      }
    } catch (err) { console.error('fetchRfTxs', err); }
  };

  const submitRfNew = async () => {
    if (rfNewSubmitting) return;
    const amt = parseFloat(rfNewForm.initialAmount);
    if (!rfNewForm.name.trim()) return ui.alert('Fund name is required.');
    if (!amt || amt <= 0) return ui.alert('Enter a valid initial amount.');
    setRfNewSubmitting(true);
    try {
      const res = await apiFetch('/api/revolving-funds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rfNewForm.name.trim(), initialAmount: amt, description: rfNewForm.description, sourceAccount: rfNewForm.sourceAccount }),
      });
      const data = await res.json();
      if (!data.success) return ui.alert(data.error || 'Failed to create fund.');
      setRfNewModal(false);
      setRfNewForm({ name: '', initialAmount: '', description: '', sourceAccount: '111000' });
      await fetchRfFunds();
    } catch (err) { ui.alert('Network error.'); }
    finally { setRfNewSubmitting(false); }
  };

  const submitRfDisb = async () => {
    if (rfDisbSubmitting || !rfActiveFund) return;
    const amt = parseFloat(rfDisbForm.amount);
    if (!amt || amt <= 0) return ui.alert('Enter a valid amount.');
    if (!rfDisbForm.description.trim()) return ui.alert('Description is required.');
    setRfDisbSubmitting(true);
    try {
      const res = await apiFetch(`/api/revolving-funds/${rfActiveFund._id}/disburse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, description: rfDisbForm.description.trim(), categoryCode: rfDisbForm.categoryCode }),
      });
      const data = await res.json();
      if (!data.success) return ui.alert(data.error || 'Disbursement failed.');
      setRfDisbModal(false);
      setRfDisbForm({ amount: '', description: '', categoryCode: '760000' });
      // Update local fund balance without full refetch
      setRfFunds(prev => prev.map(f => f._id === data.fund._id ? data.fund : f));
      setRfActiveFund(data.fund);
      await fetchRfTxs(rfActiveFund._id, 1);
    } catch (err) { ui.alert('Network error.'); }
    finally { setRfDisbSubmitting(false); }
  };

  const submitRfRepl = async () => {
    if (rfReplSubmitting || !rfActiveFund) return;
    setRfReplSubmitting(true);
    try {
      const body = { note: rfReplForm.note, sourceAccount: rfReplForm.sourceAccount };
      if (rfReplForm.amount) body.amount = parseFloat(rfReplForm.amount);
      const res = await apiFetch(`/api/revolving-funds/${rfActiveFund._id}/replenish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) return ui.alert(data.error || 'Replenishment failed.');
      setRfReplModal(false);
      setRfReplForm({ amount: '', note: '', sourceAccount: '111000' });
      setRfFunds(prev => prev.map(f => f._id === data.fund._id ? data.fund : f));
      setRfActiveFund(data.fund);
      await fetchRfTxs(rfActiveFund._id, 1);
    } catch (err) { ui.alert('Network error.'); }
    finally { setRfReplSubmitting(false); }
  };

  const closeRfFund = async (fundId) => {
    if (!(await ui.confirm('Close this revolving fund? This cannot be undone.'))) return;
    try {
      const res = await apiFetch(`/api/revolving-funds/${fundId}/close`, { method: 'PATCH' });
      const data = await res.json();
      if (!data.success) return ui.alert(data.error || 'Failed.');
      setRfFunds(prev => prev.filter(f => f._id !== fundId));
      if (rfActiveFund?._id === fundId) { setRfActiveFund(null); setRfTxs([]); }
    } catch (err) { ui.alert('Network error.'); }
  };
  // ────────────────────────────────────────────────────────────────────────────

  const fetchExpenseCategories = async () => {
    if (activeAdmin?.role !== 'superadmin' || expenseCategories.length > 0) return;
    try {
      const res = await apiFetch(`/api/expenses/categories`);
      const data = await res.json();
      if (data.success) setExpenseCategories(data.categories);
    } catch (err) { console.error('fetchExpenseCategories', err); }
  };
  const submitExpense = async () => {
    if (expenseSubmitting) return;
    if (!expenseForm.amount || parseFloat(expenseForm.amount) <= 0) return ui.alert('Enter a valid amount.');
    if (!expenseForm.categoryCode) return ui.alert('Select a category.');
    if (!expenseForm.description?.trim()) return ui.alert('Description is required.');
    setExpenseSubmitting(true);
    try {
      const res = await apiFetch(`/api/expenses`, { method: 'POST', body: JSON.stringify(expenseForm) });
      const data = await res.json();
      if (data.success) {
        setExpenseModal(false);
        setExpenseForm({ amount: '', categoryCode: '', paymentMethod: 'Cash on Hand', description: '', vendor: '', date: new Date().toISOString().slice(0,10) });
        // Refresh the Expenses page list so the new entry appears immediately —
        // on a page (unlike the old popup) the result is visible right there.
        fetchExpenses();
        if (ledgerSubTab === 'pnl') fetchPnl();
        if (ledgerSubTab === 'balance') fetchBalanceSheet();
        ui.alert('Expense recorded.');
      } else {
        ui.alert(data.error || 'Failed to record expense.');
      }
    } catch (err) {
      ui.alert('Network error.');
    } finally {
      setExpenseSubmitting(false);
    }
  };
  const submitArSettlement = async () => {
    if (settleSubmitting || !settleModal?.order) return;
    const amt = parseFloat(settleForm.amount);
    if (!amt || amt <= 0) return ui.alert('Enter a valid amount.');
    setSettleSubmitting(true);
    try {
      const res = await apiFetch(`/api/orders/${settleModal.order._id}/settle-ar`, {
        method: 'POST',
        body: JSON.stringify({ amount: amt, paymentMethod: settleForm.paymentMethod, note: settleForm.note })
      });
      const data = await res.json();
      if (data.success) {
        setSettleModal(null);
        setSettleForm({ amount: '', paymentMethod: 'Cash on Hand', note: '' });
        fetchArOutstanding();
        fetchArAgeing();
        ui.alert('A/R settled successfully.');
      } else {
        ui.alert(data.error || 'Failed to settle A/R.');
      }
    } catch (err) {
      ui.alert('Network error.');
    } finally {
      setSettleSubmitting(false);
    }
  };
  const downloadJournalCsv = async () => {
    if (activeAdmin?.role !== 'superadmin') return;
    try {
      const res = await apiFetch(`/api/journal/export?start=${pnlRange.start}&end=${pnlRange.end}`);
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `journal_${pnlRange.start}_to_${pnlRange.end}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) { ui.alert('CSV export failed.'); }
  };

  const printXReading = async () => {
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    const today = new Date().toLocaleDateString();
    const now = new Date().toLocaleTimeString();
    doc.setFontSize(16); doc.text(`${BIZ_NAME}`, 105, 18, { align: 'center' });
    doc.setFontSize(10); doc.text(vatRegLabel, 105, 24, { align: 'center' });
    doc.text(`X-READING - ${today} ${now}`, 105, 30, { align: 'center' });
    doc.setFontSize(9);
    doc.text('(Mid-Shift Summary - Register NOT Closed)', 105, 36, { align: 'center' });
    const todayOrds = orders.filter(o => o.status === 'Completed');
    const gross = todayOrds.reduce((s, o) => s + o.subtotal, 0);
    const disc = todayOrds.reduce((s, o) => s + (o.discount || 0), 0);
    const net = gross - disc;
    const cashSales = todayOrds.filter(o => o.paymentMethod === 'Cash').reduce((s, o) => s + o.total, 0);
    autoTable(doc, {
      startY: 42,
      head: [['Description', 'Amount']],
      body: [
        ['Gross Sales', `P${gross.toFixed(2)}`],
        ['Less: Discounts', `(P${disc.toFixed(2)})`],
        ['Net Sales', `P${net.toFixed(2)}`],
        ['Cash Sales', `P${cashSales.toFixed(2)}`],
        ['Non-Cash Sales', `P${(net - cashSales).toFixed(2)}`],
        ['Orders Completed', `${todayOrds.length}`],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [111, 135, 77] },
    });
    doc.save(`X-Reading-${today.replace(/\//g, '-')}.pdf`);
  };

  const archiveDay = async () => {
    if (!(await ui.confirm("Are you sure you want to close the day? This will archive everything."))) return;
    
    try { 
      const res = await apiFetch(`/api/orders/archive`, { method: 'POST' }); 
      const data = await res.json();
      
      if (data.success) {
        ui.alert("Register closed and day archived successfully!");
        setOrders([]); // Instantly clears active orders from the screen
        await fetchOrders(); // Refreshes to pull the new archive list
      } else {
        ui.alert("Failed to archive day.");
      }
    } catch (err) { 
      console.error("Failed to archive:", err); 
    }
  };
  // --- 🖨️ ORDER SLIP PRINTER ---
  const printOrderSlip = async (order) => {
    // Order-slip data mapped onto the shared receipt template (same format the
    // Procurement PO print uses). Letterhead/footer come from system settings.
    const lh = resolveLetterhead(systemSettings);
    // Logistics always prints an original + duplicate; fb prints one receipt by
    // default with the duplicate opt-in via Settings → Printer Settings.
    const dupe = BUSINESS_TYPE === 'log' || systemSettings.fbDuplicateReceipt === true;
    const buildReceiptHTML = () => {
      const dateStr = new Date(order.createdAt || Date.now()).toLocaleString('en-PH', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });

      const lineItems = order.items.map(item => {
        const addOnTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + Number(a.price || 0), 0);
        return {
          qty: `${item.quantity}x`,
          name: item.name,
          amount: (item.price + addOnTotal) * item.quantity,
          subLines: (item.selectedAddOns || []).map(a => ({ name: a.name, amount: Number(a.price || 0) })),
        };
      });

      const subTotal = order.subtotal || 0;
      const discAmt  = order.discount  || 0;
      const total    = order.total     || 0;
      const tendered = order.amountTendered || 0;
      const change   = order.changeDue || 0;
      const P = n => '&#x20B1;' + Number(n).toFixed(2);

      const summaryRows = [{ label: 'Subtotal', value: P(subTotal) }];
      if ((order.deliveryFee || 0) > 0) summaryRows.push({ label: 'Delivery Fee', value: P(order.deliveryFee) });
      if (discAmt > 0 && !order.isComplimentary) summaryRows.push({ label: `Discount (${order.discountType || ''})`, value: '-' + P(discAmt), cls: 'disc' });
      // VAT breakdown — only for orders actually rung up under VAT. Read from
      // the order's own stamped fields so a receipt reprinted after the setting
      // changed still shows what was charged at the time.
      if ((order.vatRate || 0) > 0) {
        const vatPct = (order.vatRate * 100).toFixed(0);
        // BIR wants VATable and VAT-Exempt shown as separate lines, and a basket
        // can contain both — an SC/PWD sale, or exempt goods alongside VATable
        // ones. Print whichever are non-zero rather than assuming one or other.
        if ((order.vatableSales || 0) > 0) {
          summaryRows.push({ label: 'VATable Sales', value: P(order.vatableSales) });
        }
        if ((order.vatExemptSales || 0) > 0) {
          summaryRows.push({ label: 'VAT-Exempt Sales', value: P(order.vatExemptSales) });
        }
        summaryRows.push({ label: `VAT (${vatPct}%)`, value: P(order.vatAmount || 0) });
      }
      if (order.isComplimentary) {
        summaryRows.push({ label: 'AMOUNT DUE', value: P(0), cls: 'tot' });
      } else {
        summaryRows.push({ label: 'TOTAL', value: P(total), cls: 'tot' });
        if (tendered > 0 && order.paymentMethod === 'Cash') {
          summaryRows.push({ label: 'Cash Tendered', value: P(tendered) });
          summaryRows.push({ label: 'Change', value: P(change), cls: 'chg' });
        }
      }
      if (order.isComplimentary) summaryRows.push({ label: 'NO PAYMENT REQUIRED', value: '' });

      return buildSharedReceipt({
        docLabel: 'OFFICIAL ORDER SLIP',
        docNumber: { label: 'Order #', value: order.orderNumber },
        title: `Order ${order.orderNumber || ''}`,
        settings: systemSettings,
        banner: order.isComplimentary ? {
          text: 'COMPLIMENTARY ORDER',
          subs: [
            order.complimentaryReasonType ? `${COMP_REASON_LABELS[order.complimentaryReasonType] || ''}${order.complimentaryReasonNote ? ` - ${order.complimentaryReasonNote}` : ''}` : '',
            order.complimentaryApprovedBy ? `Approved by: ${order.complimentaryApprovedBy}` : '',
          ].filter(Boolean),
        } : null,
        metaRows: [
          { label: 'Type', value: order.table || '-' },
          { label: 'Date', value: dateStr },
          (order.cashier && order.cashier !== 'System') ? { label: 'Cashier', value: order.cashier } : null,
          (order.customerName && order.customerName !== 'Guest') ? { label: 'Name', value: order.customerName } : null,
          order.customerPhone ? { label: 'Phone', value: order.customerPhone } : null,
          order.deliveryAddress ? { label: 'Address', value: order.deliveryAddress } : null,
          order.scheduledTime ? { label: 'Sched', value: order.scheduledTime } : null,
          !order.isComplimentary ? { label: 'Payment', value: order.paymentMethod || 'Cash' } : null,
        ].filter(Boolean),
        lineItems,
        summaryRows,
        notes: order.orderNotes ? { title: 'SPECIAL INSTRUCTIONS', text: order.orderNotes } : null,
        footerLines: [BUSINESS_TYPE === 'log' ? 'Thank you for your business!' : 'Thank you for dining with us!'],
        duplicate: dupe,
      });
    };

    // Per-device opt-out: 'browser' skips straight to the iframe print below,
    // so a terminal with no paired thermal printer stops getting probed by
    // navigator.bluetooth/navigator.serial on every receipt. Default 'auto'
    // preserves the try-thermal-then-fall-back behavior this always had.
    const skipThermal = readPrinterMode() === 'browser';

    // === 1. TRY BLUETOOTH ESC/POS (Chrome / Android only) ===
    if (!skipThermal && navigator.bluetooth) {
      try {
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2']
        });
        const server = await device.gatt.connect();

        const services = await server.getPrimaryServices();
        let printChar = null;
        for (const svc of services) {
          const chars = await svc.getCharacteristics();
          for (const c of chars) {
            if (c.properties.write || c.properties.writeWithoutResponse) { printChar = c; break; }
          }
          if (printChar) break;
        }
        if (!printChar) throw new Error('No writable characteristic found');

        const data = buildEscposReceiptBytes(order, { lh, dupe, vatRegLabel, businessType: BUSINESS_TYPE, compReasonLabels: COMP_REASON_LABELS });
        for (let i = 0; i < data.length; i += 256) {
          await printChar.writeValue(data.slice(i, i + 256));
          await escposSleep(100);
        }
        server.disconnect();
        return; // Success - skip HTML fallback
      } catch (err) {
        console.error('Bluetooth print error:', err);
        // Fall through to HTML popup
      }
    }

    // === 2. TRY WebSerial (USB thermal printer, Chrome / Edge only) ===
    if (!skipThermal && navigator.serial) {
      try {
        // Try to reuse a previously opened port first (stored on window)
        let port = window._thermalPort;
        if (!port || port.readable === null) {
          port = await navigator.serial.requestPort();
          window._thermalPort = port;
        }
        if (!port.writable) await port.open({ baudRate: 9600 });

        const data   = buildEscposReceiptBytes(order, { lh, dupe, vatRegLabel, businessType: BUSINESS_TYPE, compReasonLabels: COMP_REASON_LABELS });
        const writer = port.writable.getWriter();
        for (let i = 0; i < data.length; i += 256) { await writer.write(data.slice(i, i + 256)); await escposSleep(60); }
        writer.releaseLock();
        return; // Success - skip HTML fallback
      } catch (err) {
        window._thermalPort = null; // Reset cached port on error
        if (err.name !== 'NotFoundError') console.warn('WebSerial print failed, falling back:', err.message);
      }
    }

    // === 3. HIDDEN IFRAME auto-print (no popup dialog on most configs) ===
    printReceiptHTML(buildReceiptHTML());
  };

  // --- 🚨 SAFE VOID & REFUND SYSTEM ---
  const handleVoidOrder = async (orderId) => {
    const reason = window.prompt("WARNING: You are voiding a completed order.\n\nType 'Restock' if the food was NOT made (refunds inventory).\nType 'Spoilage' if the food WAS made (records as waste/loss).");
    
    if (!reason) return;
    if (reason !== 'Restock' && reason !== 'Spoilage') {
      return ui.alert("Action Cancelled. You must type exactly 'Restock' or 'Spoilage'.");
    }

    try {
      const res = await apiFetch(`/api/orders/${orderId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      
      if (data.success) {
        ui.alert(`Order Voided Successfully. Inventory & Ledger updated for ${reason}.`);
        fetchOrders();
        fetchERPData();
      } else {
        ui.alert("Failed to void order: " + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };
  const [qrSessionId, setQrSessionId] = useState(''); // Add this to your states at the top if needed

  // Logistics: copy the client portal link instead of generating a table QR.
  const handleCopyPortalLink = async () => {
    const link = `${window.location.origin}/client/portal`;
    try {
      await navigator.clipboard.writeText(link);
      ui.alert(`Portal link copied:\n${link}`);
    } catch {
      window.prompt('Copy the client portal link:', link);
    }
  };

  const handleShowQR = async () => {
    try {
      const newTable = `T-${Date.now().toString(36).toUpperCase()}`;
      
      // Request a secure, timed link from the backend
      const res = await apiFetch('/api/sessions/generate', {
        method: 'POST',
        body: JSON.stringify({ table: newTable })
      });
      const data = await res.json();
      
      if (data.success) {
        setAutoTableId(newTable);
        setQrSessionId(data.sessionId);
        setShowQR(true);
      }
    } catch (err) {
      console.error("Failed to generate secure QR session");
    }
  };

  const handleRestockSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch(`/api/inventory/restock/${activeInventoryItem._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addedStock: Number(restockData.addedStock),
          totalCost: Number(restockData.totalCost),
          creditAccount: restockData.creditAccount || '111000',
        })
      });
      if (res.ok) {
        ui.alert("Stock received. Weighted Average Cost updated!");
        setActiveInventoryItem(null);
        setRestockData({ addedStock: '', totalCost: '', creditAccount: '111000' });
        fetchERPData(); // Re-fetch inventory
      }
    } catch (err) { console.error("Restock failed", err); }
  };

  const submitPhysicalCounts = async () => {
    try {
      // Convert physical counts → BASE units (g/ml/pcs) before sending; server math
      // operates on base units. LOG counts in packages (× packBase); FB in kg/L (× mult).
      const countsBase = {};
      for (const [id, val] of Object.entries(physicalCounts)) {
        if (val === '' || val === undefined || val === null) continue;
        const item = inventory.find(i => i._id === id);
        const mult = item ? (itemDisplay(item).packBase || 1) : 1;
        countsBase[id] = Number(val) * mult;
      }
      const res = await apiFetch(`/api/inventory/count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          counts: countsBase,
          reasons: varianceReasons,
          adminName: activeAdmin ? activeAdmin.name : 'System Admin'
        })
      });
      const data = await res.json();
      
      if (data.success) {
        ui.alert('End of Day counts successfully locked and recorded.');
        setPhysicalCounts({});
        setVarianceReasons({});
        setVarianceNoteMode({});
        fetchERPData(); // Refresh the live data
        setInvSubTab('live'); // Kick them back to the live tab so they see the updated numbers!
      } else {
        ui.alert('Failed to submit counts: ' + data.error);
      }
    } catch (err) {
      console.error('Failed to submit counts', err);
    }
  };

  const addInventory = async () => {
    // log: honour the chosen unit (defaulting to pcs) and per-qty size (default 1)
    // so a "10× 1L Milk" restock keeps its L unit and 1-per-pack size.
    const eff = BUSINESS_TYPE === 'log'
      ? { ...invForm, unitPerPack: invForm.unitPerPack || '1', unit: invForm.unit || 'pcs' }
      : invForm;
    if (!eff.itemName || !eff.packQty || !eff.costPerPack) return ui.alert("Please fill in Item Name, Qty, and Price.");
    if (BUSINESS_TYPE !== 'log' && (!eff.unitPerPack || !eff.unit)) return ui.alert("Please fill in all inventory fields.");
    const invFormEff = eff;

    const qtyBought   = parseFloat(invFormEff.packQty);
    const costPerPack = parseFloat(invFormEff.costPerPack);
    if (isNaN(qtyBought) || qtyBought <= 0) return ui.alert("Qty Bought must be a positive number.");
    if (isNaN(costPerPack) || costPerPack <= 0) return ui.alert("Price Paid Per Pack must be a positive number.");

    let itemNameClean = invFormEff.itemName.trim();
    const totalCost = qtyBought * costPerPack;

    // log: auto-append weight/vol suffix to name for new items
    const existingItemCheck = inventory.find(i => i.itemName.toLowerCase() === itemNameClean.toLowerCase());
    if (BUSINESS_TYPE === 'log' && !existingItemCheck && invFormEff.unitPerPack && invFormEff.unit && invFormEff.unit !== 'pcs') {
      const wvSuffix = `${invFormEff.unitPerPack}${invFormEff.unit}`;
      if (!itemNameClean.toLowerCase().includes(wvSuffix.toLowerCase())) {
        itemNameClean = `${itemNameClean} ${wvSuffix}`;
      }
    }

    // Check if the item already exists!
    const existingItem = inventory.find(i => i.itemName.toLowerCase() === itemNameClean.toLowerCase());

    // Resolve display unit → base unit + multiplier
    const resolved = resolveUnitFE(invFormEff.unit);
    const baseUnit = resolved.base;
    const mult = resolved.mult;
    const totalStockAdded = qtyBought * parseFloat(invFormEff.unitPerPack);
    const totalStockBase = totalStockAdded * mult;
    const costPerDisplayUnit = costPerPack / parseFloat(invFormEff.unitPerPack);
    const costPerBase = costPerDisplayUnit / mult;

    if (existingItem) {
      // For log mode: use packBase from item name so "2 pcs of 377G" → 2×377=754g in DB
      let restockBase = totalStockBase;
      if (BUSINESS_TYPE === 'log') {
        const pack = packInfo(existingItem);
        restockBase = qtyBought * (pack.packBase || 1);
      }
      if (!(await ui.confirm(`Restock "${existingItem.itemName}"?\n\nQty: +${qtyBought} pcs\nCost per pack: ₱${costPerPack.toFixed(2)}\nTotal cost: ₱${totalCost.toFixed(2)}`))) return;
      await apiFetch(`/api/inventory/restock/${existingItem._id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addedStock: restockBase, totalCost, expiryDate: invFormEff.expiryDate || null, creditAccount: invFormEff.creditAccount || '111000' })
      });
    } else {
      // ADD BRAND NEW ITEM
      const payload = {
        itemName: itemNameClean,
        stockQty: totalStockBase,
        unit: baseUnit,
        unitCost: costPerBase,
        lowStockThreshold: (parseFloat(invForm.lowStockThreshold) || 0) * mult, // threshold also enters in displayUnit
        expiryDate: invForm.expiryDate || null,
        expiryWarnDays: parseInt(invForm.expiryWarnDays) || 7,
        displayUnit: invForm.unit,
        unitMultiplier: mult,
        packSize: invFormEff.unitPerPack ? parseFloat(invFormEff.unitPerPack) : null,
      };

      payload.creditAccount = invForm.creditAccount || '111000';
      const res = await apiFetch(`/api/inventory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.success) return ui.alert(data.error);
    }

    setInvForm({ itemName: '', packQty: '', unitPerPack: '', unit: '', costPerPack: '', lowStockThreshold: '', expiryDate: '', expiryWarnDays: 7, creditAccount: '111000' });
    fetchERPData();
  };
  const deleteInventory = async (id) => { if(await ui.confirm('Delete inventory item?')) { await apiFetch(`/api/inventory/${id}`, { method: 'DELETE' }); fetchERPData(); } };

  // --- OPEN EDIT INVENTORY MODAL: pre-fill from item ---
  // ============================================================
  // UNITS DISPLAY HELPER — base ↔ display conversion (mirrors server/lib/units.js)
  // ============================================================
  const UNIT_TABLE = {
    g:   { base: 'g',   mult: 1 },
    kg:  { base: 'g',   mult: 1000 },
    ml:  { base: 'ml',  mult: 1 },
    L:   { base: 'ml',  mult: 1000 },
    pcs: { base: 'pcs', mult: 1 },
  };
  const resolveUnitFE = (u) => {
    if (!u) return { base: 'pcs', mult: 1 };
    const k = String(u).trim();
    if (UNIT_TABLE[k]) return UNIT_TABLE[k];
    const low = k.toLowerCase();
    if (['l','liter','litre'].includes(low)) return UNIT_TABLE.L;
    if (['kg','kilogram'].includes(low))     return UNIT_TABLE.kg;
    if (['g','gram'].includes(low))          return UNIT_TABLE.g;
    if (['ml','milliliter'].includes(low))   return UNIT_TABLE.ml;
    if (['pcs','pc','piece'].includes(low))  return UNIT_TABLE.pcs;
    return { base: k, mult: 1 };
  };
  // Effective display unit + multiplier for any inventory item.
  // FORCED RULE: never display g or ml — auto-promote to kg / L.
  // Returns { unit, mult } — use everywhere that needs to convert base ↔ display.
  const effectiveDisplay = (item) => {
    const baseUnit = item.unit || '';
    let displayUnit = item.displayUnit;
    let mult = (item.unitMultiplier && item.unitMultiplier > 0) ? item.unitMultiplier : null;
    if (!displayUnit || displayUnit === 'g' || displayUnit === 'ml') {
      if (baseUnit === 'g')        { displayUnit = 'kg';  mult = mult || 1000; }
      else if (baseUnit === 'ml')  { displayUnit = 'L';   mult = mult || 1000; }
      else                          { displayUnit = baseUnit || 'pcs'; mult = mult || 1; }
    }
    return { unit: displayUnit, mult: mult || 1 };
  };
  // LOG 1:1 — the pack size (how much ONE purchased unit holds) drives cost-per-pack
  // and the "count of packages" stock display. Prefer the persisted item.packSize
  // field (set on import/edit — see server InventorySchema.packSize) since imports
  // now STRIP the size hint out of the item name (e.g. "Milk 1L" → name "Milk",
  // packSize 1). Only fall back to parsing the name for legacy items that still
  // carry their size embedded in it (pre-packSize-field imports).
  // unitCost is stored per base unit, so packCost = unitCost × packBaseUnits.
  const PACK_RE = /(\d+(?:\.\d+)?)\s*(mg|kg|g|ml|cl|l|pcs|pc|pack|unit)\b/i;
  const PACK_TO_BASE = { mg: 0.001, g: 1, kg: 1000, ml: 1, cl: 10, l: 1000, pcs: 1, pc: 1, pack: 1, unit: 1 };
  // A pack under one whole kg/L reads better in the sub-unit: 0.377kg → 377g,
  // 0.5L → 500ml. Only the display string changes; packBase (used for costing)
  // stays in the stored unit. Math.round strips the ×1000 float noise
  // (0.377 × 1000 = 377.0000…6).
  const fmtPackLabel = (value, unit) => {
    const v = Number(value);
    const u = String(unit || '');
    if (!Number.isFinite(v) || v <= 0) return `${value}${unit}`;
    const ul = u.toLowerCase();
    if (ul === 'kg' && v < 1) return `${Math.round(v * 1000 * 1000) / 1000}g`;
    if (ul === 'l' && v < 1) return `${Math.round(v * 1000 * 1000) / 1000}ml`;
    return `${v}${u}`; // ≥1 or already a sub-unit — keep the entered unit casing
  };
  const packInfo = (item) => {
    if (item.packSize && item.packSize > 0) {
      const { unit, mult } = effectiveDisplay(item);
      const packBase = item.packSize * mult;
      return { packBase, label: fmtPackLabel(item.packSize, unit), cost: (item.unitCost || 0) * packBase };
    }
    const mt = (item.itemName || '').match(PACK_RE);
    const baseFactor = PACK_TO_BASE[(item.unit || '').toLowerCase()] || 1;
    if (mt) {
      const val = parseFloat(mt[1]);
      const f = PACK_TO_BASE[mt[2].toLowerCase()];
      if (f !== undefined && val > 0) {
        const packBase = val * (f / baseFactor);
        return { packBase, label: fmtPackLabel(mt[1], mt[2]), cost: (item.unitCost || 0) * packBase };
      }
    }
    const { unit, mult } = effectiveDisplay(item);
    return { packBase: mult, label: unit, cost: (item.unitCost || 0) * mult };
  };
  // Convenience: { qty, unit, cost } already converted to display.
  const itemDisplay = (item) => {
    const { unit, mult } = effectiveDisplay(item);
    const pack = packInfo(item);
    return {
      qty:  (item.stockQty || 0) / mult,
      unit,
      cost: (item.unitCost || 0) * mult,
      packCost: pack.cost,                                  // cost of one named pack (e.g. ₱200 for 250g)
      packLabel: pack.label,                                // pack size label from the name (e.g. "250g")
      packBase: pack.packBase,                              // base units in one package (e.g. 250)
      packQty: pack.packBase ? (item.stockQty || 0) / pack.packBase : 0, // stock as a count of packages
      // True only when a REAL pack size is known. packInfo() falls back to the
      // plain display unit when there isn't one, in which case packQty/packCost
      // already equal qty/cost — so the pack-first columns stay correct, but the
      // unit must still read "kg", not "pcs".
      isPacked: pack.label !== unit,
    };
  };
  // Pretty currency
  const peso = (n) => `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ============================================================
  // BULK EXCEL/CSV IMPORT — Stock-take semantics
  // ============================================================
  const downloadImportTemplate = () => {
    // LOG: each row is a packaged SKU. Put the pack size in the Product name
    //   (…377G / …1L / …250G), Qty = number of packages (pure count, no unit),
    //   Unit Cost = price per package. The importer multiplies the count by the
    //   pack size and stores cost per base unit automatically.
    // FB: Qty carries a unit (kg/L/pcs); Unit Cost = cost per display unit.
    const csv = BUSINESS_TYPE === 'log'
      ? 'Code,Product,Qty Unit,SRP,Unit Cost,Expiry date\n' +
        ',ALASKA CONDENSED MILK 377G,100,77,50,\n' +
        ',ALASKA BARISTA MILK 1L,100,89,50,\n' +
        ',COMMERCIAL BLEND 1KG,100,950,200,\n' +
        ',FILTER ETHIOPIA - LIMU G2 250G,100,900,200,2026-12-31\n'
      : 'Code,Product,Qty Unit,Unit Cost,Expiry date\n' +
        ',Milk 1L,10 L,70,2026-12-31\n' +
        ',Sugar 1kg,5 kg,100,\n' +
        ',Coffee Beans 1kg,1 kg,800,2026-09-15\n' +
        ',Cups (12oz),200 pcs,8,\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'semivra-inventory-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const parseImportFile = async (file) => {
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (rows.length === 0) return ui.alert('No rows found in the file.');

      // Normalise column names (case-insensitive). Standard header:
      //   Code, Product, Qty Unit, Unit Cost, Expiry date
      // Backwards-compat also accepts: itemName, displayUnit, qty, unitCost.
      // Product may contain trailing size hint like "Milk 1kg" or "Coke 1.5L" — we parse it.
      // Matches trailing pack size in product name: "250G", "1KG", "750ML", "1.3KG", "2.5L".
      // Also tolerates a trailing parenthetical note after the size, e.g. "1KG (NW)" —
      // that note is preserved in the cleaned name, only the size token is stripped.
      // Anchoring strictly to end-of-string without this meant "MATCHA POWDER 1KG (NW)"
      // never matched at all (the "(NW)" broke the `$` anchor), silently dropping the
      // row from import (no unit could be inferred → filtered out with zero warning).
      const PACK_SIZE_RE = /\s+([0-9]+(?:\.[0-9]+)?)\s*(kg|g|L|l|ml|pcs|pc|piece)\b(\s*\([^)]*\))?\s*$/i;
      const normalise = (r) => {
        const lower = {};
        for (const [k, v] of Object.entries(r)) lower[String(k).toLowerCase().trim()] = v;

        // Parse trailing pack-size from product name.
        // Capture both the number AND unit so we can compute total stock and unit cost per display unit.
        // e.g. "FILTER PHIL 250G" → packQty=250, packRawUnit='g' → hintedUnit='kg', packSizeInDisplay=0.25
        // e.g. "MONIN STRAWBERRY 750ML" → packQty=750, packRawUnit='ml' → hintedUnit='L', packSizeInDisplay=0.75
        const rawProduct = String(lower.product || lower.itemname || lower.item || lower.name || '').trim();
        const sizeMatch = rawProduct.match(PACK_SIZE_RE);
        let cleanedName = rawProduct, hintedUnit = '', packSizeInDisplay = 1;
        if (sizeMatch) {
          const trailingNote = sizeMatch[3] ? sizeMatch[3].trim() : '';
          cleanedName = (rawProduct.slice(0, sizeMatch.index).trim() + (trailingNote ? ' ' + trailingNote : '')).trim();
          const packQty = parseFloat(sizeMatch[1]);
          const rawU = sizeMatch[2].toLowerCase();
          if (rawU === 'g') {
            hintedUnit = 'kg'; packSizeInDisplay = packQty / 1000; // 250g → 0.25 kg
          } else if (rawU === 'kg') {
            hintedUnit = 'kg'; packSizeInDisplay = packQty;         // 1kg → 1 kg
          } else if (rawU === 'ml') {
            hintedUnit = 'L';  packSizeInDisplay = packQty / 1000; // 750ml → 0.75 L
          } else if (rawU === 'l') {
            hintedUnit = 'L';  packSizeInDisplay = packQty;         // 1L → 1 L
          } else if (['pc', 'pcs', 'piece'].includes(rawU)) {
            hintedUnit = 'pcs'; packSizeInDisplay = packQty;
          }
        }

        // "Qty Unit" may be combined ("10 L") or just a number ("100") representing package count
        let qty = 0, unitFromCol = '';
        const qtyUnitCell = String(lower['qty unit'] || lower['qty/unit'] || lower['quantity unit'] || '').trim();
        if (qtyUnitCell) {
          const m = qtyUnitCell.match(/^([0-9.,]+)\s*[|/\s]*\s*([A-Za-z]+)$/);
          if (m) {
            qty = parseFloat(m[1].replace(/,/g, '')) || 0;
            unitFromCol = m[2];
          } else {
            const numOnly = parseFloat(qtyUnitCell.replace(/,/g, ''));
            if (!isNaN(numOnly)) qty = numOnly;
          }
        }
        if (!qty) qty = parseFloat(lower.qty || lower.quantity || lower.stock || 0) || 0;
        if (!unitFromCol) unitFromCol = String(lower.unit || lower.displayunit || '').trim();

        // Normalise any unit that came directly from the column
        if (unitFromCol.toLowerCase() === 'g') unitFromCol = 'kg';
        else if (unitFromCol.toLowerCase() === 'ml') unitFromCol = 'L';
        else if (unitFromCol.toLowerCase() === 'l') unitFromCol = 'L';

        let unit = unitFromCol;

        // When the Qty column is a pure package count (no unit in column), multiply by pack size.
        // e.g. 100 packs × 0.25 kg/pack = 25 kg total.
        if (!unitFromCol && hintedUnit && packSizeInDisplay > 0) {
          qty = qty * packSizeInDisplay;
          unit = hintedUnit;
        } else if (!unit && hintedUnit) {
          unit = hintedUnit;
        }

        // Nothing to go on — no Unit column, no parseable size in the name. Don't
        // drop the row: default to pcs (no per-pack conversion needed) so the item
        // still gets created/updated, and flag it so it's clearly marked "SET SIZE"
        // for the user to fix later, same badge already used in the inventory list.
        const needsSize = !unit;
        if (needsSize) unit = 'pcs';

        const exp = lower['expiry date'] || lower['expiry'] || lower['expirydate'] || '';
        const expStr = exp === '' || exp == null ? '' : String(exp).trim();

        // SRP — strip ₱ symbol and commas
        const rawSrp = String(lower.srp || lower['selling price'] || lower['retail price'] || '').replace(/[₱,\s]/g, '');
        const srp = rawSrp ? parseFloat(rawSrp) : '';

        // Excel unit cost is per package. Convert to cost per display unit.
        // e.g. 200 per 250g pack → 200 / 0.25 kg = 800 per kg.
        const rawUnitCost = lower['unit cost'] === '' || lower['unit cost'] == null
          ? (lower.unitcost === '' || lower.unitcost == null ? '' : parseFloat(lower.unitcost))
          : parseFloat(lower['unit cost']);
        const unitCost = (rawUnitCost !== '' && !isNaN(rawUnitCost) && !unitFromCol && hintedUnit && packSizeInDisplay > 0)
          ? rawUnitCost / packSizeInDisplay
          : rawUnitCost;

        return {
          itemCode: String(lower.code || lower.itemcode || '').trim(),
          itemName: cleanedName,
          displayUnit: unit,
          qty,
          unitCost,
          expiryDate: expStr,
          srp,
          // Per-qty (pack) size parsed from the name, e.g. "Milk 1L" → packSize 1.
          // null when the name carried no size hint (nothing to persist).
          packSize: sizeMatch ? packSizeInDisplay : null,
          // No unit/size could be determined anywhere — imported as pcs, but flagged
          // so the preview (and later the inventory list's SET SIZE badge) tells the
          // user this item still needs its real size added.
          _needsSize: needsSize,
        };
      };

      // Diff against current inventory for preview
      // Track category from header rows (rows where code = category name, product = empty)
      let currentCategory = '';
      const previewed = rows.map(raw => {
        const r = normalise(raw);
        // Category header row: no itemName but code column has a plain word (not a product code)
        if (!r.itemName) {
          const looksLikeCategoryHeader = r.itemCode && !/^[A-Z]\d+$/i.test(r.itemCode);
          if (looksLikeCategoryHeader) {
            currentCategory = r.itemCode;
            return { ...r, _isCategory: true, category: r.itemCode };
          }
          return { ...r, _error: 'Missing itemName' };
        }
        r.category = currentCategory;
        const existing = inventory.find(inv =>
          (r.itemCode && inv.itemCode && inv.itemCode === r.itemCode) ||
          inv.itemName.toLowerCase() === r.itemName.toLowerCase()
        );
        const resolved = resolveUnitFE(r.displayUnit);
        const newBaseQty = r.qty * resolved.mult;
        if (existing) {
          const oldDisplay = itemDisplay(existing);
          const diff = newBaseQty - (existing.stockQty || 0);
          const diffDisplay = diff / resolved.mult;
          // Detect new expiry batch: import has expiry AND it differs from existing soonest expiry
          const existingExpiry = existing.expiryDate ? String(existing.expiryDate).slice(0, 10) : '';
          const importExpiry = r.expiryDate ? String(r.expiryDate).slice(0, 10) : '';
          const isNewBatch = !!(importExpiry && existingExpiry && importExpiry !== existingExpiry);
          return { ...r, _newItem: false, _existing: existing, _diff: diffDisplay, _oldDisplay: oldDisplay, _newBatch: isNewBatch };
        }
        return { ...r, _newItem: true, _diff: r.qty };
      });

      setImportRows(previewed);
      setImportModal(true);
    } catch (err) {
      console.error('parseImportFile', err);
      ui.alert('Failed to parse file. Make sure it is a valid .xlsx, .xls, or .csv with columns: itemName, displayUnit, qty, unitCost');
    }
  };

  const submitImport = async () => {
    if (importSubmitting) return;
    const validRows = importRows.filter(r => !r._error && !r._isCategory && r.itemName && r.displayUnit);
    if (validRows.length === 0) return ui.alert('No valid rows to import.');
    if (!(await ui.confirm({
      title: 'Replace stock from import?',
      message: `This will REPLACE current stock for ${validRows.length} item(s).`,
      detail: 'New items will be created. Differences will be booked as journal adjustments.',
      confirmLabel: 'Import',
      tone: 'danger',
    }))) return;
    setImportSubmitting(true);
    setImportProgress(0);
    // Animate to ~88% while waiting for the server response
    let prog = 0;
    const progInterval = setInterval(() => {
      prog = Math.min(88, prog + (88 - prog) * 0.07 + 0.4);
      setImportProgress(Math.round(prog));
    }, 120);
    try {
      const payload = {
        items: validRows.map(r => ({
          itemCode: r.itemCode || undefined,
          itemName: r.itemName,
          displayUnit: r.displayUnit,
          qty: r.qty,
          unitCost: r.unitCost === '' || r.unitCost === undefined ? undefined : r.unitCost,
          expiryDate: r.expiryDate || undefined,
          category: r.category || undefined,
          srp: r.srp === '' || r.srp === undefined ? undefined : r.srp,
          packSize: r.packSize == null ? undefined : r.packSize,
        }))
      };
      const res = await apiFetch('/api/inventory/import', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        clearInterval(progInterval);
        setImportProgress(100);
        await new Promise(r => setTimeout(r, 500)); // show 100% briefly
        const s = data.summary;
        ui.alert(
          `Import complete.\n\n` +
          `Created: ${s.created}\n` +
          `Updated: ${s.updated}\n` +
          `Items increased: ${s.increased}\n` +
          `Items decreased: ${s.decreased}\n` +
          `Inventory gain: ₱${(s.gainValue || 0).toFixed(2)}\n` +
          `Inventory loss: ₱${(s.lossValue || 0).toFixed(2)}\n` +
          (s.errors?.length ? `\nWarnings:\n- ${s.errors.join('\n- ')}` : '')
        );
        setImportModal(false);
        setImportRows([]);
        fetchERPData();
      } else {
        ui.alert(data.error || 'Import failed.');
      }
    } catch (err) {
      clearInterval(progInterval);
      console.error('submitImport', err);
      ui.alert('Network error during import.');
    } finally {
      setImportSubmitting(false);
      setImportProgress(-1);
    }
  };

  const openEditInventory = (item) => {
    const eff = effectiveDisplay(item);
    // LOG: cost & threshold are per package (₱200/250G, N pcs); FB: per display unit.
    const costBasis = packInfo(item).packBase || eff.mult;
    setEditInvForm({
      itemCode: item.itemCode || '',
      itemName: item.itemName || '',
      unit: item.unit || '',
      unitCost: ((item.unitCost || 0) * costBasis).toFixed(2),                      // base → per-pack (log) / per-display (fb)
      lowStockThreshold: ((item.lowStockThreshold || 0) / costBasis).toString(),    // base → packages (log) / display (fb)
      expiryDate: item.expiryDate ? new Date(item.expiryDate).toISOString().slice(0, 10) : '',
      expiryWarnDays: item.expiryWarnDays || 7,
      displayUnit: eff.unit,
      packSize: item.packSize != null ? String(item.packSize) : ''
    });
    setEditInvModal({ item });
  };

  // --- SUBMIT EDIT: PUT /api/inventory/:id (metadata only — stock changes via Restock / Spoilage) ---
  const submitEditInventory = async () => {
    if (editInvSubmitting || !editInvModal?.item) return;
    if (!editInvForm.itemName?.trim()) return ui.alert('Item name is required.');
    if (!editInvForm.unit?.trim()) return ui.alert('Unit is required.');
    const unitCostNum = parseFloat(editInvForm.unitCost);
    if (Number.isNaN(unitCostNum) || unitCostNum < 0) return ui.alert('Unit cost must be a non-negative number.');

    setEditInvSubmitting(true);
    try {
      // Convert display-unit values (₱/L, threshold in L) → base storage (₱/ml, threshold in ml)
      const resolved = resolveUnitFE(editInvForm.displayUnit || editInvForm.unit);
      const mult = resolved.mult;
      // LOG: the entered cost is per package — divide by the pack size (the
      // explicit field the user just edited, falling back to a name-parse for
      // legacy items). FB: per display unit — divide by display multiplier.
      const costBasis = packInfo({ itemName: editInvForm.itemName.trim(), unit: resolved.base, displayUnit: editInvForm.displayUnit, unitMultiplier: mult, packSize: editInvForm.packSize === '' ? null : parseFloat(editInvForm.packSize) }).packBase || mult;
      const payload = {
        // Only send itemCode when the operator actually changed it — the server
        // treats a code change as a rename that cascades to the linked product,
        // so we don't want to trigger that on every unrelated edit.
        ...(editInvForm.itemCode?.trim() && editInvForm.itemCode.trim() !== editInvModal.item.itemCode
          ? { itemCode: editInvForm.itemCode.trim() } : {}),
        itemName: editInvForm.itemName.trim(),
        unit: resolved.base,                            // base storage unit (g/ml/pcs)
        unitCost: unitCostNum / costBasis,              // per-pack (log) / per-display (fb) → ₱/baseUnit
        lowStockThreshold: Math.max(0, parseFloat(editInvForm.lowStockThreshold) || 0) * costBasis, // packages (log) / display (fb) → base
        expiryWarnDays: Math.max(1, parseInt(editInvForm.expiryWarnDays) || 7),
        expiryDate: editInvForm.expiryDate ? new Date(editInvForm.expiryDate).toISOString() : null,
        displayUnit: editInvForm.displayUnit || editInvForm.unit,
        unitMultiplier: mult,
        packSize: editInvForm.packSize === '' ? null : parseFloat(editInvForm.packSize),
      };
      const res = await apiFetch(`/api/inventory/${editInvModal.item._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setEditInvModal(null);
        fetchERPData();
      } else {
        ui.alert(data.error || 'Failed to update item.');
      }
    } catch (err) {
      console.error('submitEditInventory', err);
      ui.alert('Network error.');
    } finally {
      setEditInvSubmitting(false);
    }
  };

// ==========================================
  //   PDF EXPORT ENGINE
  // ==========================================

  const formatMoney = (val) => `P${(val || 0).toFixed(2)}`;

  // 1. Inventory & Movement History PDF (Unchanged)
  const exportInventoryToPDF = async () => {
    if (inventory.length === 0) return ui.alert("No inventory to export.");
    try {
      const res = await apiFetch(`/api/inventory/history`);
      const data = await res.json();
      const allHistory = data.success ? data.history : [];
      const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
      doc.setFontSize(18); doc.text(`${BIZ_NAME} - Daily Inventory & Movement Report`, 14, 15);
      const todayStr = new Date().toLocaleDateString();
      doc.setFontSize(10); doc.text(`Date: ${todayStr} | Generated: ${new Date().toLocaleString()}`, 14, 22);
      
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayHistory = allHistory.filter(h => new Date(h.date) >= startOfDay);
      
      const stockBody = inventory.map(item => {
        const itemHistory = todayHistory.filter(h => h.inventoryId === item._id);
        let purchases = 0, sales = 0, adjustments = 0;
        itemHistory.forEach(h => {
          if (h.type === 'Restock' || h.type === 'Initial') purchases += h.qtyChange;
          else if (h.type === 'Sale') sales += Math.abs(h.qtyChange);
          else if (h.type === 'Adjustment') adjustments += h.qtyChange;
        });
        const ending = item.stockQty;
        const beginning = ending - purchases + sales - adjustments;
        // Show quantities in the item's DISPLAY unit (e.g. 1 L, not 1000 ml). LOG counts
        // in packages (pcs); FB in kg/L/pcs — same conversion the inventory table uses.
        const eff = BUSINESS_TYPE === 'log'
          ? { mult: itemDisplay(item).packBase || 1, unit: 'pcs' }
          : effectiveDisplay(item);
        const conv = (n) => (n / eff.mult).toLocaleString(undefined, { maximumFractionDigits: 3 });
        return [
          item.itemName, eff.unit, conv(beginning), conv(purchases),
          conv(sales), (adjustments > 0 ? '+' : '') + conv(adjustments), conv(ending)
        ];
      });
      autoTable(doc, {
        startY: 30,
        head: [['Item Name', 'Unit', 'Beginning Bal.', 'Purchases (In)', 'Sales (Out)', 'Adjustments', 'Ending Bal.']],
        body: stockBody, theme: 'grid', headStyles: { fillColor: [204, 163, 0], textColor: [0,0,0] }
      });
      doc.save(`Inventory_Movement_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) { ui.alert("Failed to generate PDF: " + err.message); }
  };

  const exportLedgerToPDF = async () => {
    if (journalEntries.length === 0) return ui.alert("No entries to export.");
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    doc.setFontSize(18); doc.text(`${BIZ_NAME} - General Ledger Report`, 14, 15);
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 22);
    let currentY = 30;
    journalEntries.forEach(entry => {
      if (currentY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); currentY = 20; }
      doc.setFontSize(11); doc.setFont(undefined, 'bold');
      doc.text(`Ref: ${entry.reference}  |  Date: ${new Date(entry.date).toLocaleDateString()}`, 14, currentY);
      doc.setFontSize(10); doc.setFont(undefined, 'normal');
      doc.text(`Memo: ${entry.description}`, 14, currentY + 6);
      const rows = entry.lines.map(line => [`${line.accountCode} - ${line.accountName}`, line.debit ? line.debit.toFixed(2) : '', line.credit ? line.credit.toFixed(2) : '']);
      rows.push(['TOTAL', entry.totalDebit ? entry.totalDebit.toFixed(2) : '0.00', entry.totalCredit ? entry.totalCredit.toFixed(2) : '0.00']);
      autoTable(doc, {
        startY: currentY + 10, head: [['Account', 'Debit (P)', 'Credit (P)']], body: rows,
        theme: 'grid', headStyles: { fillColor: [40, 40, 40] }, styles: { fontSize: 9 }
      });
      currentY = doc.lastAutoTable.finalY + 15;
    });
    doc.save(`General_Ledger_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // 1. COMPLETE SALES HISTORY (Master Summary + Daily Breakdown)
  const exportAllToPDF = async () => {
    const allOrders = [...orders.filter(o => o.status !== 'Pending' && o.status !== 'Preparing' && o.status !== 'Ready'), ...archivedOrders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (allOrders.length === 0) return ui.alert("No orders to export.");
    
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    doc.setFontSize(18); doc.text(`${BIZ_NAME} - Complete Sales History`, 14, 15);
    const timeGenerated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleDateString()} at ${timeGenerated}`, 14, 22);
    
    const grouped = {};
    allOrders.forEach(o => {
      const date = new Date(o.createdAt).toLocaleDateString();
      if (!grouped[date]) grouped[date] = { orders: [], ordersCount: 0, gross: 0, vatable: 0, vatExempt: 0, vat: 0, discount: 0, netSales: 0 };
      grouped[date].orders.push(o);
      
      // ONLY calculate revenue if the order is officially 'Completed'
      if (o.status === 'Completed') {
        grouped[date].ordersCount++;
        grouped[date].gross += o.subtotal;
        if (o.isVatExempt) { grouped[date].vatExempt += (o.subtotal / 1.12); }
        else { grouped[date].vatable += (o.total / 1.12); }
        grouped[date].vat += o.vatAmount || 0;
        grouped[date].discount += o.isComplimentary ? o.subtotal : (o.discount || 0); // comp = 100% discount
        grouped[date].netSales += o.total;
      }
    });

    // MASTER SUMMARY TABLE
    const summaryBody = Object.keys(grouped).map(date => [
      date, grouped[date].ordersCount.toString(), formatMoney(grouped[date].gross), formatMoney(grouped[date].vatable),
      formatMoney(grouped[date].vatExempt), formatMoney(grouped[date].vat), formatMoney(grouped[date].discount), formatMoney(grouped[date].netSales)
    ]);
    autoTable(doc, {
      startY: 28, head: [['Date', 'Completed Orders', 'Gross Sales (VAT-Inc)', 'VATable Sales', 'VAT-Exempt (PWD)', 'VAT (12%)', 'Discounts', 'Net Sales']],
      body: summaryBody, theme: 'grid', headStyles: { fillColor: [40, 40, 40] }
    });

    let currentY = doc.lastAutoTable.finalY + 15;

    // INDIVIDUAL DAILY BREAKDOWN TABLES
    Object.keys(grouped).forEach(date => {
      if (currentY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); currentY = 20; }
      doc.setFontSize(14); doc.setTextColor(204, 163, 0); doc.text(`Sales Breakdown: ${date}`, 14, currentY); doc.setTextColor(0, 0, 0);
      
      const dayRows = [];
      let dayTotals = { cash: 0, bank: 0, ewallet: 0, grand: 0 };
      
      grouped[date].orders.forEach(order => {
        const time = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        // --- NEW PAYMENT CLASSIFICATION LOGIC ---
        const pm = order.paymentMethod || 'Cash';
        const isCash = pm === 'Cash';
        const isBank = pm === 'Bank Transfer';
        const isEwallet = ['E-Wallet', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'].includes(pm);
        const isDelivery = ['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(pm);
        const isCompleted = order.status === 'Completed';

        // Protect Daily Totals from Voided/Cancelled Orders
        if (isCompleted) {
          if (dayTotals.delivery === undefined) dayTotals.delivery = 0; // Ensure delivery exists
          dayTotals.cash += isCash ? order.total : 0;
          dayTotals.bank += isBank ? order.total : 0;
          dayTotals.ewallet += isEwallet ? order.total : 0;
          dayTotals.delivery += isDelivery ? order.total : 0;
          dayTotals.grand += order.total;
        }

        let discType = '-';
        if (order.isComplimentary || order.transactionType === 'COMPLIMENTARY' || order.discountType === 'Complimentary') {
          discType = 'COMPLIMENTARY';
        } else if (order.discountPercent > 0) {
          discType = order.isVatExempt ? `SC/PWD (${order.discountPercent}%)` : `Promo (${order.discountPercent}%)`;
        }

        // Update the array pushing logic to include Delivery
        order.items.forEach((item, index) => {
          const isLastItem = index === order.items.length - 1;
          dayRows.push([
            time, order.orderNumber, order.status, `${item.quantity}x ${item.name}`,
            formatMoney(item.price * item.quantity),
            isLastItem && isCompleted ? formatMoney(order.vatAmount) : '-',
            isLastItem && isCompleted ? formatMoney(order.discount) : '-', 
            isLastItem ? discType : '-',
            isLastItem && isCash && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isBank && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isEwallet && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isDelivery && isCompleted ? formatMoney(order.total) : '-', // <-- NEW DELIVERY COLUMN
            isLastItem ? (isCompleted ? formatMoney(order.total) : 'VOID') : '-'
          ]);
        });
      });

      // Daily Footer
      dayRows.push(['', '', '', '', '', '', '', 'DAILY TOTAL:', formatMoney(dayTotals.cash), formatMoney(dayTotals.bank), formatMoney(dayTotals.ewallet), formatMoney(dayTotals.delivery), formatMoney(dayTotals.grand)]);
      autoTable(doc, {
        startY: currentY + 5, // Use 28 for exportDayToPDF
        // ADDED 'Delivery' to the Headers!
        head: [['Time', 'Order #', 'Status', 'Item', 'Gross', 'VAT', 'Discount', 'Type', 'Cash', 'Bank', 'E-Wallet', 'Delivery', 'Total']],
        body: dayRows, theme: 'striped', styles: { fontSize: 7 }, columnStyles: { 3: { cellWidth: 40 } },
        willDrawCell: function(data) {
          if (data.row.index === dayRows.length - 1) { doc.setFont(undefined, 'bold'); doc.setTextColor(204, 163, 0); }
        }
      });
      currentY = doc.lastAutoTable.finalY + 15;
    });
    doc.save(`Complete_Sales_History_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // 2. EXPORT SPECIFIC DAY 
  const exportDayToPDF = async (dateString, dayOrders) => {
    if (dayOrders.length === 0) return ui.alert("No orders to export.");
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    doc.setFontSize(18); doc.text(`${BIZ_NAME} - Sales Report: ${dateString}`, 14, 15);
    const timeGenerated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleDateString()} at ${timeGenerated}`, 14, 22);
    
    const dayRows = [];
    let dayTotals = { cash: 0, bank: 0, ewallet: 0, grand: 0 };
    
    dayOrders.forEach(order => {
      const time = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // --- NEW PAYMENT CLASSIFICATION LOGIC ---
      const pm = order.paymentMethod || 'Cash';
      const isCash = pm === 'Cash';
      const isBank = pm === 'Bank Transfer';
      const isEwallet = ['E-Wallet', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'].includes(pm);
      const isDelivery = ['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(pm);
      const isCompleted = order.status === 'Completed';

      // Protect Daily Totals from Voided/Cancelled Orders
      if (isCompleted) {
        if (dayTotals.delivery === undefined) dayTotals.delivery = 0; // Ensure delivery exists
        dayTotals.cash += isCash ? order.total : 0;
        dayTotals.bank += isBank ? order.total : 0;
        dayTotals.ewallet += isEwallet ? order.total : 0;
        dayTotals.delivery += isDelivery ? order.total : 0;
        dayTotals.grand += order.total;
      }

      let discType = '-';
      if (order.discountPercent > 0) discType = order.isVatExempt ? `SC/PWD (${order.discountPercent}%)` : `Promo (${order.discountPercent}%)`;
      if (order.isComplimentary) discType = 'COMPLIMENTARY';

      // Update the array pushing logic to include Delivery
        order.items.forEach((item, index) => {
          const isLastItem = index === order.items.length - 1;
          dayRows.push([
            time, order.orderNumber, order.status, `${item.quantity}x ${item.name}`,
            formatMoney(item.price * item.quantity),
            isLastItem && isCompleted ? formatMoney(order.vatAmount) : '-',
            isLastItem && isCompleted ? formatMoney(order.discount) : '-', 
            isLastItem ? discType : '-',
            isLastItem && isCash && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isBank && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isEwallet && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isDelivery && isCompleted ? formatMoney(order.total) : '-', // <-- NEW DELIVERY COLUMN
            isLastItem ? (isCompleted ? formatMoney(order.total) : 'VOID') : '-'
          ]);
        });
      });

      // Daily Footer
      dayRows.push(['', '', '', '', '', '', '', 'DAILY TOTAL:', formatMoney(dayTotals.cash), formatMoney(dayTotals.bank), formatMoney(dayTotals.ewallet), formatMoney(dayTotals.delivery), formatMoney(dayTotals.grand)]);
      autoTable(doc, {
        startY: 28,
        // ADDED 'Delivery' to the Headers!
        head: [['Time', 'Order #', 'Status', 'Item', 'Gross', 'VAT', 'Discount', 'Type', 'Cash', 'Bank', 'E-Wallet', 'Delivery', 'Total']],
        body: dayRows, theme: 'striped', styles: { fontSize: 7 }, columnStyles: { 3: { cellWidth: 40 } },
        willDrawCell: function(data) {
          if (data.row.index === dayRows.length - 1) { doc.setFont(undefined, 'bold'); doc.setTextColor(204, 163, 0); }
        }
      });
    doc.save(`Sales_${dateString.replace(/,/g, '').replace(/ /g, '_')}.pdf`);
  };

  // 3. DAILY SALES SUMMARY (Analytics Trend Export)
  const exportAnalyticsToPDF = async () => {
    // STRICT FILTER: Analytics must ONLY track Completed orders. Voided orders must never touch analytics.
    const allCompletedOrders = [...orders.filter(o => o.status === 'Completed'), ...archivedOrders.filter(o => o.status === 'Completed')].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (allCompletedOrders.length === 0) return ui.alert("No analytics data to export.");
    
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    doc.setFontSize(18); doc.text(`${BIZ_NAME} - Analytics Report`, 14, 15);
    const timeGenerated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleDateString()} at ${timeGenerated}`, 14, 22);
    
    const grouped = {};
    allCompletedOrders.forEach(o => {
      const date = new Date(o.createdAt).toLocaleDateString();
      if (!grouped[date]) grouped[date] = { ordersCount: 0, gross: 0, vatable: 0, vatExempt: 0, vat: 0, discount: 0, netSales: 0 };
      grouped[date].ordersCount++;
      grouped[date].gross += o.subtotal;
      // Prefer the figures the server stamped on the order. The /1.12 fallback
      // is for legacy rows written before VAT was configurable — it assumes the
      // 12% standard rate, which is all those rows can tell us.
      if (o.isVatExempt) { grouped[date].vatExempt += (o.vatExemptSales ?? (o.subtotal / 1.12)); }
      else { grouped[date].vatable += (o.vatableSales ?? (o.total / 1.12)); }
      grouped[date].vat += o.vatAmount || 0;
      grouped[date].discount += o.isComplimentary ? o.subtotal : (o.discount || 0); // comp = 100% discount
      grouped[date].netSales += o.total;
    });

    const summaryBody = Object.keys(grouped).map(date => [
      date, grouped[date].ordersCount.toString(), formatMoney(grouped[date].gross), formatMoney(grouped[date].vatable),
      formatMoney(grouped[date].vatExempt), formatMoney(grouped[date].vat), formatMoney(grouped[date].discount), formatMoney(grouped[date].netSales)
    ]);
    autoTable(doc, {
      startY: 28, head: [['Date', 'Orders', 'Gross Sales (VAT-Inc)', 'VATable Sales', 'VAT-Exempt (PWD/SC)', 'VAT (12%)', 'Discounts', 'Net Sales']],
      body: summaryBody, theme: 'grid', headStyles: { fillColor: [40, 40, 40] }
    });

    // ── Inventory analytics sections (display units: kg/L/pcs) ──
    const ad = analyticsData || {};
    const du = (item) => effectiveDisplay(item || {});
    const sect = (title, head, body, fill) => {
      if (!body.length) return;
      doc.setFontSize(12); doc.text(title, 14, doc.lastAutoTable.finalY + 8);
      autoTable(doc, { startY: doc.lastAutoTable.finalY + 11, head: [head], body, theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: fill } });
    };

    // High Velocity & Forecast
    sect('High Velocity & Forecast', ['Item', 'Daily Burn', 'Lasts', 'Buy 1wk', 'Buy 1mo', 'Trend'],
      (ad.mostUsedStock || []).map(i => { const d = du(i); return [
        i.name, `${((i.dailyAvg||0)/d.mult).toFixed(2)} ${d.unit}`,
        (!isFinite(i.daysLeft) ? '∞' : `${i.daysLeft}d`),
        `${((i.weeklyNeed||0)/d.mult).toFixed(2)} ${d.unit}`,
        `${((i.monthlyNeed||0)/d.mult).toFixed(2)} ${d.unit}`,
        `${i.trend > 0.1 ? 'rising' : i.trend < -0.1 ? 'easing' : 'stable'} ${Math.abs((i.trend||0)*100).toFixed(0)}%`,
      ]; }), [180, 130, 30]);

    // Low Stock (Risk)
    sect('Low Stock (Risk)', ['Item', 'On Hand', 'Days of Supply'],
      (ad.lowestStock || []).map(i => { const d = du(i); return [
        i.itemName, `${(Number(i.stockQty||0)/d.mult).toFixed(2)} ${d.unit}`,
        (i.daysOfSupply <= 0 ? 'OUT' : `~${Math.floor(i.daysOfSupply)}d`),
      ]; }), [180, 50, 50]);

    // Overstock Watch
    sect('Overstock Watch', ['Item', 'On Hand', 'Days of Supply', 'Tied-up Capital (PHP)'],
      (ad.highestStock || []).map(i => { const d = du(i); return [
        i.itemName, `${(Number(i.stockQty||0)/d.mult).toFixed(2)} ${d.unit}`,
        (isFinite(i.daysOfSupply) ? `~${Math.floor(i.daysOfSupply)}d` : '∞'),
        pdfMoney(i.tiedUpCapital || 0),
      ]; }), [90, 90, 90]);

    doc.save(`Analytics_Report_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const exportMonthlyToPDF = async () => {
    // STRICT FILTER: Only Completed orders.
    const allCompletedOrders = [...orders.filter(o => o.status === 'Completed'), ...archivedOrders.filter(o => o.status === 'Completed')].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (allCompletedOrders.length === 0) return ui.alert("No orders to export.");
    
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    doc.setFontSize(18); doc.text(`${BIZ_NAME} - Monthly Sales Summary`, 14, 15);
    const groupedByMonth = {};
    allCompletedOrders.forEach(o => {
      const month = new Date(o.createdAt).toLocaleString('default', { month: 'long', year: 'numeric' });
      if (!groupedByMonth[month]) groupedByMonth[month] = { cash: 0, bank: 0, ewallet: 0, total: 0 };
      groupedByMonth[month].cash += (o.paymentMethod === 'Cash' || !o.paymentMethod) ? o.total : 0;
      groupedByMonth[month].bank += (o.paymentMethod === 'Bank Transfer') ? o.total : 0;
      groupedByMonth[month].ewallet += (o.paymentMethod === 'E-Wallet') ? o.total : 0;
      groupedByMonth[month].total += o.total;
    });
    const rows = Object.keys(groupedByMonth).map(month => [
      month, `P${groupedByMonth[month].cash.toFixed(2)}`, `P${groupedByMonth[month].bank.toFixed(2)}`, `P${groupedByMonth[month].ewallet.toFixed(2)}`, `P${groupedByMonth[month].total.toFixed(2)}`
    ]);
    autoTable(doc, {
      startY: 25, head: [['Month', 'Cash', 'Bank', 'E-Wallet', 'Total Revenue']],
      body: rows, theme: 'grid', headStyles: { fillColor: [40, 40, 40] }
    });
    doc.save(`Monthly_Summary_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // 4. Sales History PDF Helper
  const handleSaveCategory = async (e) => { 
    e.preventDefault(); 
    if(!catForm.name.trim()) return; 

    if (editingCategory) {
      await apiFetch(`/api/categories/${editingCategory._id}`, { 
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(catForm) 
      });
      setEditingCategory(null);
    } else {
      await apiFetch(`/api/categories`, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(catForm) 
      });
    }
    setCatForm({ name: '', department: DEFAULT_DEPARTMENT });
    fetchData();
  };

  const deleteCategory = async (id) => { if(await ui.confirm('Delete category?')) await apiFetch(`/api/categories/${id}`, { method: 'DELETE' }); };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image(); img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scaleSize = 600 / img.width;
        canvas.width = 600; canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setFormData({ ...formData, image: canvas.toDataURL('image/webp', 0.8) });
      };
    };
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    const method = editingProduct ? 'PUT' : 'POST';
    const url = editingProduct ? `/api/products/${editingProduct._id}` : `/api/products`;
    // Normalize modifierGroups to just IDs before sending
    const payload = {
      ...formData,
      modifierGroups: (formData.modifierGroups||[]).map(id => (id && id._id) ? id._id : id),
      image: formData.imageUrl?.trim() || formData.image, // URL overrides uploaded base64
    };
    const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.success) { ui.alert(data.error || 'Failed to save product.'); return; }
    resetProductForm();
    fetchData();
  };
  const deleteProduct = async (id) => {
    if(await ui.confirm("Delete this product permanently?")) {
      await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
      if (editingProduct && editingProduct._id === id) resetProductForm();
    }
  };
  
  const addSize = () => setFormData({ ...formData, sizes: [...formData.sizes, { name: '', price: 0 }] });
  const updateSize = (index, field, value) => { const newSizes = [...formData.sizes]; newSizes[index][field] = field === 'price' ? parseFloat(value) || 0 : value; setFormData({ ...formData, sizes: newSizes }); };
  const removeSize = (index) => setFormData({ ...formData, sizes: formData.sizes.filter((_, i) => i !== index) });
  const addAddOn = () => setFormData({ ...formData, addOns: [...(formData.addOns || []), { name: '', price: 0, recipe: [] }] });
  const updateAddOn = (index, field, value) => { const newAddOns = [...formData.addOns]; newAddOns[index][field] = field === 'price' ? parseFloat(value) || 0 : value; setFormData({ ...formData, addOns: newAddOns }); };
  const removeAddOn = (index) => setFormData({ ...formData, addOns: formData.addOns.filter((_, i) => i !== index) });

  const addMaterialToRecipe = (invId, sizeIndex = null) => {
    if (!invId) return;
    const invItem = inventory.find(i => i._id === invId);
    if (!invItem) return;
    const material = { invId: invItem._id, name: invItem.itemName, qty: 1, cost: invItem.unitCost, unit: invItem.unit };
    if (sizeIndex === null) { setFormData({ ...formData, baseRecipe: [...(formData.baseRecipe || []), material] });
    } else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe = [...(newSizes[sizeIndex].recipe || []), material]; setFormData({ ...formData, sizes: newSizes }); }
  };
  const updateMaterialQty = (val, matIndex, sizeIndex = null) => {
    const newQty = parseFloat(val) || 0;
    if (sizeIndex === null) { const newRecipe = [...formData.baseRecipe]; newRecipe[matIndex].qty = newQty; setFormData({ ...formData, baseRecipe: newRecipe });
    } else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe[matIndex].qty = newQty; setFormData({ ...formData, sizes: newSizes }); }
  };
  const removeMaterial = (matIndex, sizeIndex = null) => {
    if (sizeIndex === null) { setFormData({ ...formData, baseRecipe: formData.baseRecipe.filter((_, i) => i !== matIndex) });
    } else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe = newSizes[sizeIndex].recipe.filter((_, i) => i !== matIndex); setFormData({ ...formData, sizes: newSizes }); }
  };
  const calcRecipeCost = (recipe) => (recipe || []).reduce((sum, item) => sum + (item.qty * item.cost), 0);

  // --- ESTIMATED MENU STOCK CALCULATOR ---
  const getEstimatedStock = (recipe) => {
    if (!recipe || recipe.length === 0) return null; // No recipe means infinite stock
    let minServings = Infinity;
    
    for (let mat of recipe) {
      const invItem = inventory.find(i => i._id === mat.invId);
      if (!invItem) return 0; // If an ingredient is missing entirely, stock is 0
      
      const possibleServings = Math.floor(invItem.stockQty / mat.qty);
      if (possibleServings < minServings) minServings = possibleServings;
    }
    return minServings === Infinity ? 0 : minServings;
  };

  // ── Modifier Groups ─────────────────────────────────────────────────────────
  const fetchModifierGroups = async () => {
    try { const res = await apiFetch('/api/modifier-groups'); if (res.ok) setModifierGroups((await res.json()).groups || []); }
    catch (err) { console.error('fetchModifierGroups', err); }
  };

  // ── Modifier Group editor (create / update / delete) ─────────────────────────
  const saveModifierGroup = async () => {
    if (!modForm.name.trim()) return ui.alert('Group name is required.');
    if (!modForm.options.length || modForm.options.some(o => !o.name.trim())) return ui.alert('Add at least one named option.');
    const method = editingModifier ? 'PUT' : 'POST';
    const url = editingModifier ? `/api/modifier-groups/${editingModifier._id}` : '/api/modifier-groups';
    const payload = {
      name: modForm.name.trim(),
      isRequired: !!modForm.isRequired,
      minSelect: Math.max(0, parseInt(modForm.minSelect) || 0),
      maxSelect: Math.max(1, parseInt(modForm.maxSelect) || 1),
      options: modForm.options.map(o => ({ name: o.name.trim(), price: parseFloat(o.price) || 0, recipe: o.recipe || [] })),
    };
    const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.success) return ui.alert(data.error || 'Failed to save modifier group.');
    setEditingModifier(null);
    setModForm({ name: '', isRequired: true, minSelect: 1, maxSelect: 1, options: [] });
    fetchModifierGroups();
  };
  const editModifierGroup = (g) => {
    setEditingModifier(g);
    setModForm({ name: g.name, isRequired: g.isRequired, minSelect: g.minSelect, maxSelect: g.maxSelect,
      options: (g.options || []).map(o => ({ name: o.name, price: o.price || 0, recipe: o.recipe || [] })) });
  };
  const deleteModifierGroup = async (id) => {
    if (!(await ui.confirm('Delete this modifier group? Products using it will lose the requirement.'))) return;
    await apiFetch(`/api/modifier-groups/${id}`, { method: 'DELETE' });
    if (editingModifier?._id === id) { setEditingModifier(null); setModForm({ name: '', isRequired: true, minSelect: 1, maxSelect: 1, options: [] }); }
    fetchModifierGroups();
  };

  // ── Combos / Bundles (Product Promos) ────────────────────────────────────────
  const fetchCombos = async () => {
    try { const res = await apiFetch('/api/combos?all=1'); if (res.ok) setCombos((await res.json()).combos || []); }
    catch (err) { console.error('fetchCombos', err); }
  };
  const saveCombo = async () => {
    if (!comboForm.name.trim()) return ui.alert('Combo name is required.');
    if (!(parseFloat(comboForm.price) > 0)) return ui.alert('Enter a positive combo price.');
    if (!comboForm.items.length) return ui.alert('Add at least one component product.');
    const method = editingCombo ? 'PUT' : 'POST';
    const url = editingCombo ? `/api/combos/${editingCombo._id}` : '/api/combos';
    const payload = {
      name: comboForm.name.trim(), description: comboForm.description, price: parseFloat(comboForm.price),
      image: comboForm.image, isActive: true,
      items: comboForm.items.map(i => ({ productId: i.productId, name: i.name, sizeName: i.sizeName || '', quantity: Math.max(1, parseInt(i.quantity) || 1) })),
    };
    const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.success) return ui.alert(data.error || 'Failed to save combo.');
    setEditingCombo(null);
    setComboForm({ name: '', description: '', price: '', image: '', items: [] });
    fetchCombos();
  };
  const editCombo = (c) => {
    setEditingCombo(c);
    setComboForm({ name: c.name, description: c.description || '', price: c.price, image: c.image || '', items: c.items || [] });
  };
  const deleteCombo = async (id) => {
    if (!(await ui.confirm('Delete this combo?'))) return;
    await apiFetch(`/api/combos/${id}`, { method: 'DELETE' });
    if (editingCombo?._id === id) { setEditingCombo(null); setComboForm({ name: '', description: '', price: '', image: '', items: [] }); }
    fetchCombos();
  };
  // Add a combo to the POS cart as a single line that carries its components.
  const addComboToPosCart = (combo) => {
    setPosCart(prev => [...prev, {
      productId: combo._id, productCode: combo.comboCode || '', name: combo.name, price: combo.price, quantity: 1,
      department: DEFAULT_DEPARTMENT, selectedAddOns: [], isCombo: true,
      comboItems: (combo.items || []).map(i => ({ productId: i.productId, name: i.name, sizeName: i.sizeName || '', quantity: i.quantity || 1 })),
    }]);
  };

  // ── Parked Orders / Open Tabs ─────────────────────────────────────────────────
  const fetchParked = async () => {
    try { const res = await apiFetch('/api/orders/parked'); if (res.ok) setParkedOrders((await res.json()).parked || []); }
    catch (err) { console.error('fetchParked', err); }
  };
  const parkCurrentOrder = async () => {
    if (posCart.length === 0) return ui.alert('Cart is empty - nothing to park.');
    const res = await apiFetch('/api/orders/park', { method: 'POST', body: JSON.stringify({
      items: posCart, customerName: posCustomerName || 'Guest', table: posTable, orderNotes: posNotes, guestCount: posGuestCount,
    }) });
    const data = await res.json();
    if (!data.success) return ui.alert(data.error || 'Failed to park order.');
    setPosCart([]); setPosCustomerName(''); setPosNotes(''); setPosGuestCount(1);
    setIsPosOpen(false);
    await fetchParked();        // refresh the parked list + dropdown count
    setOrderFilter('Parked');   // jump straight to the Parked view so it's visible
    ui.alert('Order parked. It is now under the "Parked" filter - tap Resume to ring it up.');
  };
  const resumeParked = async (id) => {
    const res = await apiFetch(`/api/orders/parked/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) return ui.alert(data.error || 'Failed to resume.');
    const o = data.order;
    setPosCart(o.items || []);
    setPosCustomerName(o.customerName === 'Guest' ? '' : o.customerName);
    setPosTable(o.table || 'Dine-In');
    setPosNotes(o.orderNotes || '');
    setPosGuestCount(o.guestCount || 1);
    setParkedModalOpen(false);
    setIsPosOpen(true);
    fetchParked();
  };

  // ── Reports ───────────────────────────────────────────────────────────────────
  const fetchMenuEngineering = async () => {
    try { const res = await apiFetch('/api/reports/menu-engineering'); const d = await res.json(); if (d.success) setMenuEngineering(d); }
    catch (err) { console.error('fetchMenuEngineering', err); }
  };
  const fetchCashierVariance = async () => {
    try { const res = await apiFetch('/api/reports/cashier-variance'); const d = await res.json(); if (d.success) setCashierVariance(d); }
    catch (err) { console.error('fetchCashierVariance', err); }
  };
  const fetchCommissions = async () => {
    try { const res = await apiFetch('/api/reports/commissions'); const d = await res.json(); if (d.success) setCommissions(d); }
    catch (err) { console.error('fetchCommissions', err); }
  };
  const fetchPurchaseOrder = async () => {
    try {
      const res = await apiFetch('/api/reports/purchase-order?days=7');
      const d = await res.json();
      if (d.success) setPurchaseOrder(d);
      else ui.alert(d.error || 'Failed to generate purchase order.');
    } catch (err) { console.error('fetchPurchaseOrder', err); ui.alert('Network error generating purchase order.'); }
  };

  // Purchase Order → PDF in the requested "Product | Qty Unit" format
  const exportPurchaseOrderPDF = async () => {
    if (!purchaseOrder || !(purchaseOrder.lines || []).length) return ui.alert('Generate a purchase order first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    const today = new Date().toLocaleDateString('en-PH');
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text('PURCHASE ORDER', 105, 22, { align: 'center' });
    doc.setFontSize(9);  doc.text(`${today}  ·  covers ~${purchaseOrder.coverDays || 7} days`, 105, 28, { align: 'center' });
    autoTable(doc, {
      startY: 34,
      head: [['Product', 'Qty Unit']],
      body: (purchaseOrder.lines || []).map(l => [
        l.itemName + (l.lowStock ? '  (LOW)' : ''),
        `${l.suggestedOrder} ${l.displayUnit}`,
      ]),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [111, 135, 77] },
      columnStyles: { 1: { halign: 'right' } },
    });
    const y = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    doc.text(`Estimated Total (PHP): ${pdfMoney(purchaseOrder.totalEstCost || 0)}`, 14, y);
    doc.save(`Purchase-Order-${today.replace(/\//g, '-')}.pdf`);
  };

  // Profit & Loss → PDF (replaces CSV export)
  const exportPnlPDF = async () => {
    if (!pnlData) return ui.alert('Run the P&L report first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    const range = `${pnlRange.start} to ${pnlRange.end}`;
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text(`PROFIT & LOSS STATEMENT ${vatStmtSuffix}`, 105, 22, { align: 'center' });
    doc.setFontSize(9);  doc.text(range, 105, 28, { align: 'center' });
    const section = (title, rows, startY) => {
      autoTable(doc, {
        startY,
        head: [[title, 'Amount (PHP)']],
        body: rows.length ? rows.map(r => [r.accountName || r.name || r.label || '', pdfMoney(r.amount ?? r.total)]) : [['-', pdfMoney(0)]],
        styles: { fontSize: 9 }, headStyles: { fillColor: [111, 135, 77] },
        columnStyles: { 1: { halign: 'right' } },
      });
      return doc.lastAutoTable.finalY + 4;
    };
    let y = 34;
    y = section('Revenue', pnlData.revenue || [], y);
    y = section('Cost of Goods Sold', pnlData.cogs || [], y);
    y = section('Operating Expenses', pnlData.opex || pnlData.expenses || [], y);
    // Summary totals — negatives shown in parentheses, no ± / ₱ glyph issues.
    const t = pnlData.totals || {};
    autoTable(doc, {
      startY: y,
      head: [['Summary', 'Amount (PHP)']],
      body: [
        ['Gross Profit', pdfMoney(t.grossProfit)],
        ['Net Income', pdfMoney(t.netIncome)],
        ...(t.netMargin !== undefined ? [['Net Margin', `${Number(t.netMargin).toFixed(1)}%`]] : []),
      ],
      styles: { fontSize: 10, fontStyle: 'bold' }, headStyles: { fillColor: [61, 74, 42] },
      columnStyles: { 1: { halign: 'right' } },
    });
    doc.save(`Profit-Loss-${pnlRange.start}_to_${pnlRange.end}.pdf`);
  };

  const exportBalanceSheetPDF = async () => {
    if (!bsData) return ui.alert('Load the Balance Sheet first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    const asOf = bsData.asOf ? new Date(bsData.asOf).toLocaleDateString() : new Date().toLocaleDateString();
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text(`BALANCE SHEET ${vatStmtSuffix}`, 105, 22, { align: 'center' });
    doc.setFontSize(9);  doc.text(`As of ${asOf}`, 105, 28, { align: 'center' });
    const rowName = (r) => r.accountName || r.name || r.label || '';
    const rowAmt = (r) => pdfMoney(r.amount ?? r.balance ?? r.total ?? 0);
    const section = (title, rows, total, startY) => {
      autoTable(doc, {
        startY,
        head: [[title, 'Amount (PHP)']],
        body: [
          ...(rows && rows.length ? rows.map(r => [rowName(r), rowAmt(r)]) : [['-', pdfMoney(0)]]),
          [`Total ${title}`, pdfMoney(total ?? 0)],
        ],
        styles: { fontSize: 9 }, headStyles: { fillColor: [111, 135, 77] },
        columnStyles: { 1: { halign: 'right' } },
        didParseCell: (d) => { if (d.row.index === (rows?.length || 1)) d.cell.styles.fontStyle = 'bold'; },
      });
      return doc.lastAutoTable.finalY + 4;
    };
    const t = bsData.totals || {};
    let y = 34;
    y = section('Assets', bsData.assets, t.assets, y);
    y = section('Liabilities', bsData.liabilities, t.liabilities, y);
    y = section('Equity', bsData.equity, t.equity, y);
    const balanced = Math.abs((t.assets || 0) - ((t.liabilities || 0) + (t.equity || 0))) < 0.01;
    autoTable(doc, {
      startY: y,
      head: [['Accounting Equation', '']],
      body: [
        ['Assets', pdfMoney(t.assets)],
        ['Liabilities + Equity', pdfMoney((t.liabilities || 0) + (t.equity || 0))],
        ['Status', balanced ? 'BALANCED' : 'OUT OF BALANCE'],
      ],
      styles: { fontSize: 10, fontStyle: 'bold' }, headStyles: { fillColor: [61, 74, 42] },
      columnStyles: { 1: { halign: 'right' } },
    });
    doc.save(`Balance-Sheet-${asOf.replace(/\//g, '-')}.pdf`);
  };

  // ── Settings / QR toggle ────────────────────────────────────────────────────
  const fetchSettings = async () => {
    try { const res = await apiFetch('/api/settings'); const d = await res.json(); if (d.success) setSystemSettings(p => ({ ...p, ...d.settings })); }
    catch (err) { console.error('fetchSettings', err); }
  };
  const toggleQROrders = async () => {
    try {
      const res = await apiFetch('/api/settings/isAcceptingQROrders', { method: 'PATCH', body: JSON.stringify({ value: !systemSettings.isAcceptingQROrders }) });
      const d = await res.json(); if (d.success) fetchSettings();
    } catch (err) { console.error('toggleQROrders', err); }
  };
  // Superadmin-only: enable/disable the automatic midnight close & day archive.
  const toggleAutoClose = async () => {
    const next = systemSettings.autoCloseEnabled === false; // currently off → turning on
    if (!next && !await ui.confirm('Disable automatic midnight close?\n\nThe day will stay OPEN past midnight and a superadmin must close & archive it manually.')) return;
    try {
      const res = await apiFetch('/api/settings/autoCloseEnabled', { method: 'PATCH', body: JSON.stringify({ value: next }) });
      const d = await res.json(); if (d.success) fetchSettings();
    } catch (err) { console.error('toggleAutoClose', err); }
  };

  // Toggle whether product images are shown across the app (menu, portal, product list).
  // Generic setting writer for non-boolean settings (credit limit mode, global
  // limit). The toggle* helpers above stay as they are — they encode their own
  // confirm/labelling rules.
  const saveSetting = async (key, value) => {
    try {
      const res = await apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
        method: 'PATCH', body: JSON.stringify({ value }),
      });
      const d = await res.json();
      if (d.success) fetchSettings();
      else ui.alert(d.error || 'Could not save setting.');
    } catch (err) { console.error('saveSetting', err); ui.alert('Could not save setting.'); }
  };

  const toggleImages = async () => {
    const next = systemSettings.imagesEnabled === false; // currently off -> turning on
    try {
      const res = await apiFetch('/api/settings/imagesEnabled', { method: 'PATCH', body: JSON.stringify({ value: next }) });
      const d = await res.json(); if (d.success) fetchSettings();
    } catch (err) { console.error('toggleImages', err); }
  };

  // ── Profit by category ──────────────────────────────────────────────────────
  const fetchProfitByCategory = async () => {
    try { const res = await apiFetch('/api/reports/profit-by-category'); const d = await res.json(); if (d.success) setProfitByCategory(d); }
    catch (err) { console.error('fetchProfitByCategory', err); }
  };

  // ── Sales by payment ─────────────────────────────────────────────────────────
  const fetchSalesByPayment = async () => {
    try { const res = await apiFetch(`/api/reports/sales-by-payment?start=${sbpRange.start}&end=${sbpRange.end}`); const d = await res.json(); if (d.success) setSalesByPayment(d); }
    catch (err) { console.error('fetchSalesByPayment', err); }
  };

  // ── Summary Sales (channel breakdown: cash / e-wallet / bank / delivery) ──────
  const fetchSalesSummary = async () => {
    try { const res = await apiFetch(`/api/reports/sales-summary?start=${sssRange.start}&end=${sssRange.end}`); const d = await res.json(); if (d.success) setSalesSummary(d); }
    catch (err) { console.error('fetchSalesSummary', err); }
  };
  // Roll per-order rows up to per-day rows (client-side), merging channel + method detail.
  const sssRows = useMemo(() => {
    const rows = salesSummary?.rows || [];
    if (sssGroup === 'order') return rows;
    const byDay = {};
    for (const r of rows) {
      const day = new Date(r.date).toLocaleDateString('en-CA'); // YYYY-MM-DD
      if (!byDay[day]) byDay[day] = { date: r.date, orderNumber: null, count: 0, cash: 0, ewallet: 0, bank: 0, delivery: 0, total: 0, methods: {} };
      const t = byDay[day];
      t.count++; t.cash += r.cash; t.ewallet += r.ewallet; t.bank += r.bank; t.delivery += r.delivery; t.total += r.total;
      for (const [m, a] of Object.entries(r.methods || {})) t.methods[m] = (t.methods[m] || 0) + a;
    }
    return Object.values(byDay).sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [salesSummary, sssGroup]);

  const exportSalesSummaryPDF = async () => {
    if (!salesSummary) return ui.alert('Load the Summary Sales report first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    doc.setFontSize(16); doc.text(`${BIZ_NAME} - Sales Summary`, 14, 14);
    doc.setFontSize(9); doc.text(`${sssRange.start} to ${sssRange.end}  ·  ${sssGroup === 'day' ? 'Per Day' : 'Per Order'}`, 14, 20);
    // Fixed columns (match the on-screen Summary Sales table).
    const tm = salesSummary.totals?.methods || {};
    const COLS = [
      ['Cash', ['Cash']], ['Bank', ['Bank Transfer']], ['GCash', ['GCash']], ['Maya', ['Maya']],
      ['Maribank/SeaBank', ['Maribank']], ['Other E-Wallet', ['E-Wallet', 'Other E-Wallet']],
      ['GrabFood', ['Grab Delivery']], ...(BUSINESS_TYPE === 'log' ? [['Lalamove', ['Lalamove']]] : [['Foodpanda', ['Foodpanda']]]), ['Manual/Direct', ['Manual Delivery']],
    ];
    const cv = (r, ms) => ms.reduce((s, m) => s + (r?.methods?.[m] || 0), 0);
    // Item-level detail lives in the separate Sales Line Items report.
    const head = ['Date', 'Customer ID', 'Customer Name', sssGroup === 'day' ? 'Orders' : 'Order ID', ...COLS.map(c => c[0]), 'Total'];
    const body = sssRows.map(r => [
      new Date(r.date).toLocaleDateString(),
      sssGroup === 'day' ? '' : (r.customerId || ''),
      sssGroup === 'day' ? '' : (r.customerName || ''),
      sssGroup === 'day' ? String(r.count) : r.orderNumber,
      ...COLS.map(([, ms]) => pdfMoney(cv(r, ms))),
      pdfMoney(r.total),
    ]);
    const t = salesSummary.totals || {};
    autoTable(doc, {
      startY: 24, head: [head], body,
      foot: [[ 'TOTALS', '', '', '', ...COLS.map(([, ms]) => pdfMoney(ms.reduce((s, m) => s + (tm[m] || 0), 0))), pdfMoney(t.total) ]],
      styles: { fontSize: 7 }, headStyles: { fillColor: [111,135,77] }, footStyles: { fillColor: [61,74,42], textColor: 255 },
    });
    doc.save(`Sales-Summary_${sssRange.start}_to_${sssRange.end}.pdf`);
  };

  // ── Sales Line Items (item-level detail) ─────────────────────────────────────
  const fetchSalesLineItems = async () => {
    try { const res = await apiFetch(`/api/reports/sales-line-items?start=${sliRange.start}&end=${sliRange.end}`); const d = await res.json(); if (d.success) setSalesLineItems(d); }
    catch (err) { console.error('fetchSalesLineItems', err); }
  };
  const exportSalesLineItemsPDF = async () => {
    if (!salesLineItems) return ui.alert('Load the Sales Line Items report first.');
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF('landscape');
    doc.setFontSize(16); doc.text(`${BIZ_NAME} - Sales Line Items`, 14, 14);
    doc.setFontSize(9); doc.text(`${sliRange.start} to ${sliRange.end}`, 14, 20);
    const head = ['Date', 'Customer ID', 'Customer Name', 'Order ID', 'Item Code', 'Item', 'Qty', 'Payment', 'Line Total'];
    const body = salesLineItems.rows.map(r => r.isComponent
      // Promo/combo component: indented, no price (it's included in the combo row).
      ? ['', '', '', '', r.itemCode || '', `   ↳ ${r.itemName || ''}`, String(r.quantity), '', 'included']
      : [
        new Date(r.date).toLocaleDateString(), r.customerId || '', r.customerName || '', r.orderNumber,
        r.itemCode || '', (r.itemName || '') + (r.isCombo ? ' (promo)' : ''), String(r.quantity), r.paymentMethod || '', pdfMoney(r.lineTotal),
      ]);
    autoTable(doc, {
      startY: 24, head: [head], body,
      foot: [[ 'TOTAL', '', '', '', '', '', '', '', pdfMoney(salesLineItems.grandTotal) ]],
      styles: { fontSize: 7 }, headStyles: { fillColor: [111,135,77] }, footStyles: { fillColor: [61,74,42], textColor: 255 },
    });
    doc.save(`Sales-Line-Items_${sliRange.start}_to_${sliRange.end}.pdf`);
  };

  // ── Refund ──────────────────────────────────────────────────────────────────
  const handleRefund = async () => {
    if (!refundModal || !refundForm.reason.trim()) return ui.alert('Reason required.');
    setRefundSubmitting(true);
    try {
      const res = await apiFetch(`/api/orders/${refundModal._id}/refund`, { method: 'POST', body: JSON.stringify({ reason: refundForm.reason, refundAmount: parseFloat(refundForm.refundAmount) || refundModal.total, inventoryAction: refundForm.inventoryAction }) });
      const d = await res.json();
      if (d.success) { setRefundModal(null); setRefundForm({ reason: '', refundAmount: '', inventoryAction: 'Restock' }); fetchOrders(); ui.alert('Refund processed. Reversal journal created.'); }
      else ui.alert(d.error || 'Refund failed.');
    } catch { ui.alert('Network error.'); }
    finally { setRefundSubmitting(false); }
  };

  // ── Clock in/out ─────────────────────────────────────────────────────────────
  // Apply any queued offline clock events on top of a base status so the gate /
  // button reflect the staff member's optimistic state until the queue syncs.
  const applyQueuedClock = (base) => {
    let s = { ...base };
    for (const e of getQueuedClock()) {
      if (e.type === 'in')  s = { ...s, isClockedIn: true,  onBreak: false };
      if (e.type === 'out') s = { ...s, isClockedIn: false, onBreak: false };
    }
    return s;
  };
  const CLOCK_STATE_KEY = 'semivra_clock_state';
  const fetchClockStatus = async () => {
    // OFFLINE: rebuild status from the last cached server snapshot + queued events.
    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem(CLOCK_STATE_KEY) || 'null')
          || { isClockedIn: false, entry: null, onBreak: false, breakUsedMinutes: 0, breakRemainingMinutes: 60 };
        setClockStatus(applyQueuedClock(cached));
      } catch { /* ignore */ }
      finally { setClockStatusLoaded(true); }
      return;
    }
    try {
      const res = await apiFetch('/api/clock/status'); const d = await res.json();
      if (d.success) {
        const st = {
          isClockedIn: d.isClockedIn, entry: d.entry,
          onBreak: !!d.onBreak, breakStartedAt: d.breakStartedAt || null,
          breakUsedMinutes: d.breakUsedMinutes || 0, breakRemainingMinutes: d.breakRemainingMinutes ?? 60,
        };
        setClockStatus(st);
        try { localStorage.setItem(CLOCK_STATE_KEY, JSON.stringify(st)); } catch { /* ignore */ }
      }
    }
    catch (err) { console.error('fetchClockStatus', err); }
    finally { setClockStatusLoaded(true); }
  };
  const fetchClockEntries = async (page = 1) => {
    try { const res = await apiFetch(`/api/clock/entries?page=${page}&limit=30`); const d = await res.json(); if (d.success) { setClockEntries(d.entries||[]); setClockEntriesTotal(d.total||0); setClockEntriesPage(page); } }
    catch (err) { console.error('fetchClockEntries', err); }
  };
  const handleClockIn = async () => {
    if (!navigator.onLine) {
      queueClock('in');
      setClockStatus((s) => ({ ...s, isClockedIn: true, onBreak: false }));
      ui.alert('Clocked in (offline - will sync when back online).');
      return;
    }
    try { const res = await apiFetch('/api/clock/in', { method: 'POST', body: '{}' }); const d = await res.json(); if (d.success) { fetchClockStatus(); ui.alert('Clocked in.'); } else ui.alert(d.error||'Clock-in failed.'); }
    catch { ui.alert('Network error.'); }
  };
  // Pressing the clock button while working opens the choice modal (break vs end shift).
  const handleClockButton = () => {
    if (!clockStatus.isClockedIn) return handleClockIn();
    if (clockStatus.onBreak) return endBreak();      // currently on break → resume
    setClockModalOpen(true);                          // working → show options
  };
  const startBreak = async () => {
    try {
      const res = await apiFetch('/api/clock/break/start', { method: 'POST', body: '{}' });
      const d = await res.json();
      if (d.success) { setClockModalOpen(false); fetchClockStatus(); }
      else ui.alert(d.error || 'Could not start break.');
    } catch { ui.alert('Network error.'); }
  };
  const endBreak = async () => {
    try {
      const res = await apiFetch('/api/clock/break/end', { method: 'POST', body: '{}' });
      const d = await res.json();
      if (d.success) { fetchClockStatus(); } else ui.alert(d.error || 'Could not end break.');
    } catch { ui.alert('Network error.'); }
  };
  const handleClockOut = async () => {
    if (!navigator.onLine) {
      queueClock('out');
      setClockStatus((s) => ({ ...s, isClockedIn: false, onBreak: false }));
      setClockModalOpen(false);
      ui.alert('Clocked out (offline - will sync when back online).');
      return;
    }
    try {
      const res = await apiFetch('/api/clock/out', { method: 'POST', body: '{}' });
      const d = await res.json();
      if (d.success) {
        setClockModalOpen(false); fetchClockStatus();
        const m = d.entry?.workedMinutes ?? d.entry?.durationMinutes ?? 0;
        const b = d.entry?.breakMinutes || 0;
        ui.alert(`Clocked out. Worked ${Math.floor(m/60)}h ${m%60}m${b ? ` (${b}m break)` : ''}.`);
      } else ui.alert(d.error||'Clock-out failed.');
    } catch { ui.alert('Network error.'); }
  };

  // ── Billing Statement print (log mode) ──────────────────────────────────────
  // Uses the shared A4 document template (same one the Procurement purchase-order
  // print uses). Letterhead/payment/contact come from system settings, falling
  // back to VITE_BILLING_* env then defaults.
  const printBillingStatement = (order) => {
    const dateStr = new Date(order.createdAt || Date.now()).toLocaleDateString('en-PH', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    const transactionNo = order.billingNumber || order.orderNumber || '-';
    const isDelivery = ['Manual Delivery', 'Lalamove'].includes(order.table);

    const items = (order.items || []).map(item => {
      const addOnTotal = (item.selectedAddOns || []).reduce((s, a) => s + Number(a.price || 0), 0);
      const unitPrice  = item.price + addOnTotal;
      const addOnDesc  = (item.selectedAddOns || []).map(a => a.name).join(', ');
      return {
        code: item.productCode || '',
        desc: item.name + (item.size ? ` (${item.size})` : '') + (addOnDesc ? ` + ${addOnDesc}` : ''),
        qty: item.quantity,
        unitPrice,
        total: unitPrice * item.quantity,
      };
    });

    const schedRows = [
      order.scheduledTime   ? { label: `Scheduled ${isDelivery ? 'Delivery' : 'Pickup'} Time:`, value: order.scheduledTime } : null,
      order.deliveryAddress ? { label: 'Delivery Address:', value: order.deliveryAddress } : null,
      order.customerPhone   ? { label: 'Contact No.:', value: order.customerPhone } : null,
    ].filter(Boolean);

    printBillingDoc(buildBillingDocHTML({
      docTitle: 'BILLING STATEMENT',
      dateLabel: 'Submitted date',
      dateStr,
      settings: systemSettings,
      metaFields: [
        { label: 'Invoice For', value: order.customerName || '' },
        { label: 'Payable To', value: '' },
        { label: 'Transaction No.', value: transactionNo },
      ],
      subFields: [
        { label: 'Terms of Payment', value: order.paymentMethod || '' },
        { label: 'Order Type', value: order.table || '' },
      ],
      schedRows,
      items,
      totals: [
        { label: 'Subtotal', value: order.subtotal || order.total || 0 },
        { label: 'Discount', value: order.discount || 0 },
        { label: 'Delivery Fee', value: order.deliveryFee || 0 },
        { label: 'TOTAL', value: order.total || 0, grand: true },
      ],
    }));
  };

  // ── Delivery Receipt print (logistics) ───────────────────────────────────────
  // Prints TWO copies in one job: ORIGINAL for the customer, DUPLICATE for the
  // office. Both are identical apart from the copy label, so a signature on the
  // duplicate is proof of delivery.
  //
  // Item lines are pre-filled from the order, but the delivery details (driver,
  // plate, received-by, date, signature) are printed as blank ruled fields — the
  // crew fills those in by hand at the drop-off, which is how the paper DR is
  // actually used.
  const printDeliveryReceipt = (order) => {
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) return ui.alert('Pop-up blocked - allow pop-ups for this site.');

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const BILL_NAME  = import.meta.env.VITE_BILLING_NAME     || BIZ_NAME;
    const BILL_ADDR1 = import.meta.env.VITE_BILLING_ADDRESS1 || '';
    const BILL_ADDR2 = import.meta.env.VITE_BILLING_ADDRESS2 || '';
    const BILL_PHONE = import.meta.env.VITE_BILLING_PHONE    || '';

    const drNo = order.billingNumber || order.orderNumber || '';
    const dateStr = new Date(order.createdAt || Date.now()).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

    const rows = (order.items || []).map((item, i) => {
      const addOns = (item.selectedAddOns || []).map(a => a.name).join(', ');
      const desc = esc(item.name) + (item.size ? ` (${esc(item.size)})` : '') + (addOns ? ` + ${esc(addOns)}` : '');
      return `<tr>
        <td class="n">${i + 1}</td>
        <td class="c">${esc(item.productCode || '')}</td>
        <td class="d">${desc}</td>
        <td class="q">${esc(item.quantity)}</td>
        <td class="u"></td>
      </tr>`;
    }).join('');

    // Pad to a fixed number of rows so the form keeps its shape and leaves room
    // for hand-written additions.
    const MIN_ROWS = 10;
    const padding = Math.max(0, MIN_ROWS - (order.items || []).length);
    const padRows = Array.from({ length: padding }, () =>
      '<tr><td class="n">&nbsp;</td><td class="c"></td><td class="d"></td><td class="q"></td><td class="u"></td></tr>'
    ).join('');

    const copy = (label, note) => `
      <section class="dr">
        <div class="copy-tag">${label}<span class="copy-note">${note}</span></div>
        <header>
          <div class="biz">
            <div class="biz-name">${esc(BILL_NAME)}</div>
            ${BILL_ADDR1 ? `<div class="biz-line">${esc(BILL_ADDR1)}</div>` : ''}
            ${BILL_ADDR2 ? `<div class="biz-line">${esc(BILL_ADDR2)}</div>` : ''}
            ${BILL_PHONE ? `<div class="biz-line">Tel: ${esc(BILL_PHONE)}</div>` : ''}
          </div>
          <div class="doc">
            <div class="doc-title">DELIVERY RECEIPT</div>
            <div class="doc-no">No. <b>${esc(drNo)}</b></div>
            <div class="doc-date">Date: ${esc(dateStr)}</div>
          </div>
        </header>

        <div class="party">
          <div class="fld wide"><span class="lbl">Delivered To</span><span class="val">${esc(order.customerName || '')}</span></div>
          <div class="fld wide"><span class="lbl">Address</span><span class="val"></span></div>
          <div class="fld"><span class="lbl">P.O. / Ref No.</span><span class="val"></span></div>
          <div class="fld"><span class="lbl">Terms</span><span class="val">${esc(order.termsOfPayment || '')}</span></div>
        </div>

        <table>
          <thead>
            <tr><th class="n">#</th><th class="c">Item Code</th><th class="d">Description</th><th class="q">Qty</th><th class="u">Unit</th></tr>
          </thead>
          <tbody>${rows}${padRows}</tbody>
        </table>

        ${order.orderNotes ? `<div class="notes"><b>Notes:</b> ${esc(order.orderNotes)}</div>` : ''}

        <div class="sigs">
          <div class="sig"><div class="line"></div><div class="cap">Prepared By</div></div>
          <div class="sig"><div class="line"></div><div class="cap">Driver / Plate No.</div></div>
          <div class="sig"><div class="line"></div><div class="cap">Received By (Signature over Printed Name)</div></div>
          <div class="sig narrow"><div class="line"></div><div class="cap">Date Received</div></div>
        </div>
        <div class="foot">Received the above goods in good order and condition.</div>
      </section>`;

    win.document.write(`<!DOCTYPE html><html><head><title>Delivery Receipt ${esc(drNo)}</title><style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; margin:0; color:#000; font-size:11px; }
      .dr { padding:10mm 10mm 6mm; border-bottom:1px dashed #999; position:relative; }
      /* Each copy fills half a page so both land on one sheet; the second starts
         a new page only if the content genuinely overflows. */
      .copy-tag { position:absolute; top:4mm; right:10mm; font-size:10px; font-weight:bold; letter-spacing:1px; border:1px solid #000; padding:2px 8px; }
      .copy-note { font-weight:normal; letter-spacing:0; margin-left:6px; color:#444; }
      header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:4mm; margin-bottom:4mm; }
      .biz-name { font-size:15px; font-weight:bold; text-transform:uppercase; }
      .biz-line { font-size:10px; color:#333; }
      .doc { text-align:right; }
      .doc-title { font-size:14px; font-weight:bold; letter-spacing:1px; }
      .doc-no, .doc-date { font-size:11px; margin-top:2px; }
      .party { display:grid; grid-template-columns:1fr 1fr; gap:2mm 6mm; margin-bottom:4mm; }
      .fld { display:flex; align-items:flex-end; gap:4px; }
      .fld.wide { grid-column:span 2; }
      .lbl { font-size:9px; text-transform:uppercase; color:#555; white-space:nowrap; }
      .val { flex:1; border-bottom:1px solid #000; min-height:14px; padding:0 4px 1px; font-weight:bold; }
      table { width:100%; border-collapse:collapse; }
      th, td { border:1px solid #000; padding:3px 5px; }
      th { background:#eee; font-size:9px; text-transform:uppercase; text-align:left; }
      td { height:16px; }
      .n { width:6%; text-align:center; } .c { width:16%; } .q { width:10%; text-align:center; } .u { width:12%; }
      .notes { margin-top:3mm; font-size:10px; border:1px solid #000; padding:3px 5px; }
      .sigs { display:flex; gap:6mm; margin-top:6mm; }
      .sig { flex:1; } .sig.narrow { flex:0 0 28%; }
      .line { border-bottom:1px solid #000; height:9mm; }
      .cap { font-size:8.5px; text-transform:uppercase; color:#333; margin-top:2px; text-align:center; }
      .foot { margin-top:3mm; font-size:9px; font-style:italic; color:#333; text-align:center; }
      @media print {
        @page { size:A4; margin:0; }
        .dr { page-break-inside:avoid; }
        body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      }
    </style></head><body>
      ${copy('ORIGINAL', 'Customer&rsquo;s Copy')}
      ${copy('DUPLICATE', 'Office Copy')}
    </body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  };

  // ── Kitchen ticket print ─────────────────────────────────────────────────────
  const printKitchenTicket = (order) => {
    const win = window.open('', '_blank', 'width=320,height=600');
    if (!win) return ui.alert('Pop-up blocked - allow pop-ups for this site.');
    // Escape all dynamic values — customerName / orderNotes / item names can be
    // customer-supplied (QR menu) and are written into raw HTML below.
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const items = (order.items||[]).map(item => `
      <div class="item">
        <span class="qty">${esc(item.quantity)}×</span>
        <span class="name">${esc(item.name)}</span>
        ${item.isCombo ? (item.comboItems||[]).map(c=>`<div class="addon">• ${c.quantity>1?esc(c.quantity)+'× ':''}${esc(c.name)}${c.sizeName?` (${esc(c.sizeName)})`:''}</div>`).join('') : ''}
        ${(item.selectedAddOns||[]).map(a=>`<div class="addon">+ ${esc(a.name)}</div>`).join('')}
      </div>`).join('');
    win.document.write(`<!DOCTYPE html><html><head><style>
      body { font-family:monospace; width:72mm; font-size:14px; }
      .header { text-align:center; border-bottom:3px solid #000; padding-bottom:6px; margin-bottom:8px; }
      .order-num { font-size:28px; font-weight:bold; }
      .tbl { font-size:16px; font-weight:bold; }
      .item { margin:8px 0; padding:4px 0; border-bottom:1px dashed #ccc; }
      .qty { font-weight:bold; font-size:18px; margin-right:6px; }
      .name { font-size:16px; font-weight:bold; }
      .addon { font-size:12px; padding-left:24px; color:#555; }
      .notes { margin-top:8px; padding:6px; border:2px solid #000; font-size:13px; font-weight:bold; }
      @media print { @page { size:80mm auto; margin:3mm; } }
    </style></head><body>
      <div class="header">
        <div class="order-num">${esc(order.orderNumber)}</div>
        <div class="tbl">${esc(order.table||'Takeout')} · ${esc(order.customerName||'Guest')}</div>
        <div style="font-size:11px">${new Date(order.createdAt||Date.now()).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      ${items}
      ${order.orderNotes ? `<div class="notes">📝 ${esc(order.orderNotes)}</div>` : ''}
    </body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 300);
  };

  // ── Z-Reading PDF ─────────────────────────────────────────────────────────────
  const printZReading = async () => {
    const { jsPDF, autoTable } = await loadPdfLibs(); const doc = new jsPDF();
    const today = new Date().toLocaleDateString('en-PH');
    const now   = new Date().toLocaleTimeString('en-PH');
    doc.setFontSize(16); doc.text(BIZ_NAME, 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.text(vatRegLabel, 105, 21, { align: 'center' });
    doc.setFontSize(12); doc.text('Z-READING', 105, 28, { align: 'center' });
    doc.setFontSize(9);  doc.text(`${today}  ${now}  -  OFFICIAL END-OF-DAY REPORT`, 105, 34, { align: 'center' });
    const completed  = archivedOrders.filter(o => o.status === 'Completed');
    const voided     = archivedOrders.filter(o => o.status === 'Voided');
    const cancelled  = archivedOrders.filter(o => o.status === 'Cancelled');
    const comps      = completed.filter(o => o.isComplimentary);
    const regular    = completed.filter(o => !o.isComplimentary);
    const gross      = regular.reduce((s,o) => s+(o.subtotal||0), 0);
    const discounts  = regular.reduce((s,o) => s+(o.discount||0), 0);
    const payMethods = {};
    regular.forEach(o => { const m = o.paymentMethod||'Cash'; if (!payMethods[m]) payMethods[m]={count:0,total:0}; payMethods[m].count++; payMethods[m].total+=(o.total||0); });
    doc.setFontSize(8); doc.setTextColor(120); doc.text('All amounts in PHP. Negatives shown in (parentheses).', 105, 38, { align: 'center' }); doc.setTextColor(0);
    autoTable(doc, {
      startY: 42,
      head: [['Summary', 'Amount (PHP)']],
      body: [
        ['Gross Sales',      pdfMoney(gross)],
        ['Less: Discounts',  pdfMoney(-discounts)],
        ['Net Sales',        pdfMoney(gross - discounts)],
        ['Complimentary',    pdfMoney(-comps.reduce((s,o)=>s+(o.subtotal||0),0))],
        ['Orders Completed', String(completed.length)],
        ['Orders Voided',    String(voided.length)],
        ['Orders Cancelled', String(cancelled.length)],
      ],
      styles: { fontSize: 9 }, headStyles: { fillColor: [111, 135, 77] },
      columnStyles: { 1: { halign: 'right' } },
    });
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 6,
      head: [['Payment Method', 'Orders', 'Amount (PHP)']],
      body: Object.entries(payMethods).map(([m, d]) => [m, String(d.count), pdfMoney(d.total)]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [111, 135, 77] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
    });
    doc.save(`Z-Reading-${today.replace(/\//g,'-')}.pdf`);
  };

  // Toggle a product's manual availability flag (Removed on/off). Superadmin only.
  const toggleProductAvailability = async (product) => {
    try {
      const next = !(product.isAvailable !== false); // default true → toggle to false
      const res = await apiFetch(`/api/products/${product._id}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable: next }),
      });
      if (res.ok) fetchData(); // refresh products
      else ui.alert('Failed to update availability.');
    } catch (err) { console.error('toggleProductAvailability', err); }
  };

  // Toggle Out-Of-Stock flag. Stays on the menu (with a badge), still in reports.
  const toggleProductOOS = async (product) => {
    try {
      const next = !product.isOutOfStock;
      const res = await apiFetch(`/api/products/${product._id}/oos`, {
        method: 'PATCH',
        body: JSON.stringify({ isOutOfStock: next }),
      });
      if (res.ok) fetchData();
      else ui.alert('Failed to update OOS status.');
    } catch (err) { console.error('toggleProductOOS', err); }
  };

  // ── Change Password ────────────────────────────────────────────────────────
  const handleChangePassword = async () => {
    setChangePwError('');
    const { currentPassword, newPassword, confirmPassword } = changePwForm;
    if (!currentPassword || !newPassword || !confirmPassword) return setChangePwError('All fields are required.');
    if (newPassword.length < 6) return setChangePwError('New password must be at least 6 characters.');
    if (newPassword !== confirmPassword) return setChangePwError('New passwords do not match.');
    setChangePwLoading(true);
    try {
      const res = await apiFetch('/api/users/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        ui.alert('Password changed successfully.');
        setChangePwModal(false);
        setChangePwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        setChangePwError(data.error || 'Failed to change password.');
      }
    } catch { setChangePwError('Network error. Please try again.'); }
    finally { setChangePwLoading(false); }
  };

  // ── Fetch Audit Logs ───────────────────────────────────────────────────────
  const fetchAuditLogs = async (page = 1) => {
    try {
      const qs = new URLSearchParams({ page, limit: AUDIT_LOGS_PAGE_SIZE });
      if (auditLogFilters.action) qs.set('action', auditLogFilters.action);
      if (auditLogFilters.actor)  qs.set('actor', auditLogFilters.actor);
      if (auditLogFilters.start)  qs.set('start', auditLogFilters.start);
      if (auditLogFilters.end)    qs.set('end', auditLogFilters.end);
      const res = await apiFetch(`/api/audit-logs?${qs.toString()}`);
      const data = await res.json();
      if (data.success) { setAuditLogs(data.logs); setAuditLogsTotal(data.total); setAuditLogsPage(page); }
    } catch (err) { console.error('fetchAuditLogs', err); }
  };

  // CSV export streams straight from the server (bounded to a 92-day range,
  // same convention as /api/journal/export) — filters must be set before
  // exporting since the server has no memory of the on-screen page.
  const exportAuditLogsCsv = async () => {
    if (!auditLogFilters.start || !auditLogFilters.end) { return ui.alert('Pick a start and end date to export (max 92 days).'); }
    const qs = new URLSearchParams({ start: auditLogFilters.start, end: auditLogFilters.end });
    if (auditLogFilters.action) qs.set('action', auditLogFilters.action);
    if (auditLogFilters.actor)  qs.set('actor', auditLogFilters.actor);
    try {
      const res = await apiFetch(`/api/audit-logs/export?${qs.toString()}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); return ui.alert(d.error || 'Failed to export audit log.'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `audit_log_${auditLogFilters.start}_to_${auditLogFilters.end}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('exportAuditLogsCsv', err); ui.alert('Network error exporting audit log.'); }
  };

  // PDF export builds from whatever's already loaded in `auditLogs` state — the
  // current page only, same "client-side from fetched JSON" convention every
  // other PDF export in this file follows via loadPdfLibs().
  const exportAuditLogsPdf = async () => {
    if (!auditLogs.length) return ui.alert('Nothing to export — load some audit log entries first.');
    const { jsPDF, autoTable } = await loadPdfLibs();
    const doc = new jsPDF();
    doc.setFontSize(14); doc.text('Audit Log', 14, 16);
    doc.setFontSize(9);
    doc.text(`Page ${auditLogsPage} of ${Math.max(1, Math.ceil(auditLogsTotal / AUDIT_LOGS_PAGE_SIZE))} · ${auditLogsTotal} total entries`, 14, 22);
    autoTable(doc, {
      startY: 28,
      head: [['Timestamp', 'User', 'Action', 'Target', 'Notes']],
      body: auditLogs.map(l => [new Date(l.timestamp).toLocaleString(), l.userId, l.action, l.targetReference, l.details?.notes || '']),
      styles: { fontSize: 7 }, headStyles: { fillColor: [30, 30, 30] },
    });
    doc.save(`audit_log_page${auditLogsPage}.pdf`);
  };

  // ── Fetch AP Outstanding ───────────────────────────────────────────────────
  const fetchApData = async () => {
    try {
      const res = await apiFetch('/api/finance/ap-outstanding');
      const data = await res.json();
      if (data.success) setApData(data);
    } catch (err) { console.error('fetchApData', err); }
  };

  const submitApPayment = async () => {
    const amt = parseFloat(apPayForm.amount);
    if (!amt || amt <= 0) return ui.alert('Enter a valid amount.');
    setApPaySubmitting(true);
    try {
      const res = await apiFetch('/api/finance/ap-payment', {
        method: 'POST',
        body: JSON.stringify(apPayForm),
      });
      const data = await res.json();
      if (data.success) {
        ui.alert('AP payment recorded.');
        setApPayModal(false);
        setApPayForm({ amount: '', payFromAccount: '111000', description: '', vendorName: '', supplierId: '' });
        fetchApData();
      } else ui.alert(data.error || 'Failed to record payment.');
    } catch { ui.alert('Network error.'); }
    finally { setApPaySubmitting(false); }
  };

  // ── Bills (AP approval workflow) ────────────────────────────────────────────
  const [bills, setBills] = useState(null);
  const [billsFilter, setBillsFilter] = useState('Pending');
  const [billCreate, setBillCreate] = useState({ open: false, supplierId: '', description: '', amount: '', dueDate: '', expenseAccountCode: '600000' });
  const [billPayModal, setBillPayModal] = useState(null); // the bill being paid
  const [billPayFrom, setBillPayFrom] = useState('111000');
  const [billBusy, setBillBusy] = useState(false);

  const fetchBills = async (status = billsFilter) => {
    try {
      const q = status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : '';
      const res = await apiFetch(`/api/bills${q}`);
      const d = await res.json();
      if (d.success) setBills(d.bills);
    } catch (err) { console.error('fetchBills', err); }
  };

  const billAction = async (id, path, body) => {
    setBillBusy(true);
    try {
      const res = await apiFetch(`/api/bills/${id}/${path}`, { method: path === 'schedule' ? 'PATCH' : 'POST', body: JSON.stringify(body || {}) });
      const d = await res.json();
      if (d.success) { fetchBills(); return true; }
      ui.alert(d.error || 'Action failed.');
      return false;
    } catch { ui.alert('Network error.'); return false; }
    finally { setBillBusy(false); }
  };

  const approveBill = (b) => billAction(b._id, 'approve');
  const rejectBill = async (b) => {
    const reason = prompt(`Reject bill ${b.billNumber}? Enter a reason:`);
    if (!reason || !reason.trim()) return;
    billAction(b._id, 'reject', { reason: reason.trim() });
  };
  const scheduleBill = async (b) => {
    const date = prompt(`Schedule payment date for ${b.billNumber} (YYYY-MM-DD, blank to clear):`, b.scheduledPaymentDate ? String(b.scheduledPaymentDate).slice(0, 10) : '');
    if (date === null) return;
    billAction(b._id, 'schedule', { scheduledPaymentDate: date.trim() || null });
  };
  const submitBillPay = async () => {
    const ok = await billAction(billPayModal._id, 'pay', { payFromAccount: billPayFrom });
    if (ok) { setBillPayModal(null); ui.alert('Payment recorded.'); }
  };
  const submitCreateBill = async () => {
    const amt = parseFloat(billCreate.amount);
    if (!billCreate.supplierId) return ui.alert('Pick a supplier.');
    if (!amt || amt <= 0) return ui.alert('Enter a valid amount.');
    if (!billCreate.description.trim()) return ui.alert('Enter a description.');
    setBillBusy(true);
    try {
      const res = await apiFetch('/api/bills', { method: 'POST', body: JSON.stringify({
        supplierId: billCreate.supplierId, description: billCreate.description.trim(),
        amount: amt, dueDate: billCreate.dueDate || null, expenseAccountCode: billCreate.expenseAccountCode,
      }) });
      const d = await res.json();
      if (d.success) {
        ui.alert('Bill created (Pending approval).');
        setBillCreate({ open: false, supplierId: '', description: '', amount: '', dueDate: '', expenseAccountCode: '600000' });
        fetchBills();
      } else ui.alert(d.error || 'Failed to create bill.');
    } catch { ui.alert('Network error.'); }
    finally { setBillBusy(false); }
  };

  // Expense/asset accounts a manual bill can be booked against (DR side).
  const expenseAccounts = useMemo(() => [
    ...accountsUnder('510000'), ...accountsUnder('600000'), ...accountsUnder('540000'), ...accountsUnder('130000'),
  ], [accountsUnder]);

  // The "Parked" filter shows held tabs (separate collection). "All" must show
  // EVERY order regardless of state — the active board already carries every
  // non-archived status (Pending → Completed, Cancelled, Voided…), and parked
  // tabs live in their own collection, so fold them in (deduped by _id). All
  // other filters work against the active orders board.
  const allOrdersSource = (() => {
    const byId = new Map(orders.map(o => [o._id, o]));
    for (const p of parkedOrders) if (!byId.has(p._id)) byId.set(p._id, p);
    return [...byId.values()];
  })();
  const filteredOrders = (orderFilter === 'Parked' ? parkedOrders : orderFilter === 'All' ? allOrdersSource : orders).filter(o => {
    const statusOk = (orderFilter === 'All' || orderFilter === 'Parked') ? true : o.status === orderFilter;
    if (!statusOk) return false;
    if (!orderSearch.trim()) return true;
    const q = orderSearch.trim().toLowerCase();
    return (
      (o.customerName || '').toLowerCase().includes(q) ||
      (o.orderNumber  || '').toLowerCase().includes(q) ||
      (o.table        || '').toLowerCase().includes(q)
    );
  });

  // ── Inventory badge count (hoisted so it can be used in sidebar AND ctx) ──
  const invBadgeCount = (() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const low     = inventory.filter(i => i.lowStockThreshold > 0 && i.stockQty <= i.lowStockThreshold).length;
    const expired = inventory.filter(i => i.expiryDate && i.stockQty > 0 && new Date(i.expiryDate) < today).length;
    const soon    = inventory.filter(i => {
      if (!i.expiryDate || i.stockQty <= 0) return false;
      const days = Math.ceil((new Date(i.expiryDate) - today) / 86400000);
      return days >= 0 && days <= (i.expiryWarnDays || 7);
    }).length;
    return low + expired + soon;
  })();
  const invBadgeColor = (() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const expired = inventory.filter(i => i.expiryDate && i.stockQty > 0 && new Date(i.expiryDate) < today).length;
    const low     = inventory.filter(i => i.lowStockThreshold > 0 && i.stockQty <= i.lowStockThreshold).length;
    const soon    = inventory.filter(i => {
      if (!i.expiryDate || i.stockQty <= 0) return false;
      const days = Math.ceil((new Date(i.expiryDate) - today) / 86400000);
      return days >= 0 && days <= (i.expiryWarnDays || 7);
    }).length;
    return expired > 0 ? 'bg-red-500 animate-pulse' : low > 0 ? 'bg-red-500' : soon > 0 ? 'bg-orange-500' : 'bg-red-500';
  })();
  const todayCompleted = orders.filter(o => o.status === 'Completed');
  const todayComplimentary = todayCompleted.filter(o => o.isComplimentary);
  const todayCompAmount = todayComplimentary.reduce((sum, o) => sum + o.subtotal, 0);
  const todayGross = todayCompleted.reduce((sum, o) => sum + o.subtotal, 0); // ALL orders incl. comp (gross stays visible)
  const todayDiscounts = todayCompleted.reduce((sum, o) => o.isComplimentary ? sum + o.subtotal : sum + (o.discount || 0), 0); // comp = 100% discount
  const todayRevenue = todayGross - todayDiscounts; // Net cash-collected (comp cancels out)
  const todayVat = todayCompleted.filter(o => !o.isComplimentary).reduce((sum, o) => sum + o.vatAmount, 0);

  const groupedArchives = archivedOrders.reduce((acc, order) => {
    const date = new Date(order.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (!acc[date]) acc[date] = { orders: [], revenue: 0, vat: 0, discounts: 0 };
    acc[date].orders.push(order);
    if (order.status === 'Completed') {
      acc[date].revenue += order.total; acc[date].vat += order.vatAmount; acc[date].discounts += order.discount;
    }
    return acc;
  }, {});

  const toggleDay = (date) => setExpandedDays(prev => ({ ...prev, [date]: !prev[date] }));
  const toggleOrderList = (date) => setExpandedOrderLists(prev => ({ ...prev, [date]: !prev[date] })); 

  // ==========================================
  // 🔥 ANALYTICS ENGINE 🔥 — memoized so the 1-second countdown doesn't re-run this
  // ==========================================
  const {
    allCompletedOrders, totalAllTimeRevenue, totalAllTimeComplimentary,
    dailyRevenueList, bestDay, topProducts,
    mostUsedStock, lowestStock, highestStock
  } = useMemo(() => {
    const completed = [
      ...orders.filter(o => o.status === 'Completed'),
      ...archivedOrders.filter(o => o.status === 'Completed')
    ];

    // 1. Daily Sales & Best Day
    const dailyRevenueMap = {};
    let totalRev = 0, totalComp = 0;
    completed.forEach(o => {
      const dateStr = new Date(o.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (!dailyRevenueMap[dateStr]) dailyRevenueMap[dateStr] = { net: 0, comp: 0 };
      if (o.isComplimentary) { dailyRevenueMap[dateStr].comp += o.subtotal; totalComp += o.subtotal; }
      else { dailyRevenueMap[dateStr].net += o.total; totalRev += o.total; }
    });
    let best = { date: 'N/A', revenue: 0 };
    const revList = Object.entries(dailyRevenueMap).map(([date, data]) => {
      const revenue = data.net;
      if (revenue > best.revenue) best = { date, revenue };
      return { date, revenue };
    });

    // 2. Top Products
    const productStats = {};
    completed.forEach(o => {
      o.items.forEach(item => {
        const baseName = item.name.replace(/\s*\(.*?\)\s*/g, '').trim();
        if (!productStats[baseName]) productStats[baseName] = { qty: 0, revenue: 0 };
        productStats[baseName].qty += item.quantity;
        productStats[baseName].revenue += (item.price * item.quantity);
      });
    });
    const top5 = Object.entries(productStats).map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.qty - a.qty).slice(0, 5);

    // 3. Raw Material Velocity (Weighted ADU)
    const nowMs = Date.now();
    const MS_DAY = 86400000;
    const orders7d  = completed.filter(o => (nowMs - new Date(o.createdAt).getTime()) <= 7  * MS_DAY);
    const orders30d = completed.filter(o => (nowMs - new Date(o.createdAt).getTime()) <= 30 * MS_DAY);

    let daysElapsed = 1;
    if (completed.length > 0) {
      const ts = completed.map(o => new Date(o.createdAt).getTime());
      daysElapsed = Math.max(1, Math.ceil((Math.max(...ts) - Math.min(...ts)) / MS_DAY));
    }
    const days7  = Math.min(7,  Math.max(1, daysElapsed));
    const days30 = Math.min(30, Math.max(1, daysElapsed));

    const computeIngUsage = (subset) => {
      const usage = {};
      subset.forEach(o => {
        o.items.forEach(orderItem => {
          let product = products.find(p => p._id === orderItem.productId);
          if (!product) {
            const baseName = orderItem.name.replace(/\s*\(.*?\)\s*/g, '').trim();
            product = products.find(p => p.name === baseName);
          }
          if (!product) return;
          let recipe = product.baseRecipe || [];
          const sizeMatch = orderItem.name.match(/\(([^)]+)\)$/);
          if (sizeMatch) {
            const sizeObj = product.sizes?.find(s => s.name === sizeMatch[1]);
            if (sizeObj?.recipe?.length > 0) recipe = sizeObj.recipe;
          }
          recipe.forEach(ing => {
            if (!usage[ing.name]) {
              const invItem = inventory.find(i => i.itemName.toLowerCase() === ing.name.toLowerCase());
              usage[ing.name] = { name: ing.name, qtyUsed: 0, unit: ing.unit, currentStock: invItem ? invItem.stockQty : 0 };
            }
            usage[ing.name].qtyUsed += ing.qty * orderItem.quantity;
          });
        });
      });
      return usage;
    };

    const usage7d  = computeIngUsage(orders7d);
    const usage30d = computeIngUsage(orders30d);

    const rawMaterialUsage = {};
    const allIngNames = new Set([...Object.keys(usage7d), ...Object.keys(usage30d)]);
    allIngNames.forEach(name => {
      const u7 = usage7d[name], u30 = usage30d[name];
      const adu7 = u7 ? u7.qtyUsed / days7 : 0;
      const adu30 = u30 ? u30.qtyUsed / days30 : 0;
      const weightedAdu = adu7 * 0.7 + adu30 * 0.3;
      const trend = adu30 > 0 ? (adu7 - adu30) / adu30 : 0;
      const ref = u7 || u30;
      rawMaterialUsage[name] = { name, unit: ref.unit, currentStock: ref.currentStock, qtyUsed: (u30 || u7).qtyUsed, weightedAdu, adu7, adu30, trend };
    });

    const mostUsed = Object.values(rawMaterialUsage)
      .filter(item => item.weightedAdu > 0).sort((a, b) => b.weightedAdu - a.weightedAdu).slice(0, 5)
      .map(item => {
        const daysLeft = item.weightedAdu > 0 ? item.currentStock / item.weightedAdu : Infinity;
        return { ...item, dailyAvg: item.weightedAdu, daysLeft: isFinite(daysLeft) ? Math.floor(daysLeft) : Infinity, weeklyNeed: Math.ceil(item.weightedAdu * 7), monthlyNeed: Math.ceil(item.weightedAdu * 30), reorderPoint: Math.ceil(item.weightedAdu * 3) };
      });

    const usageEntries = Object.values(rawMaterialUsage);
    const lowest = inventory
      .map(item => { const u = usageEntries.find(e => e.name.toLowerCase() === item.itemName.toLowerCase()); const adu = u ? u.weightedAdu : 0; const daysOfSupply = adu > 0 ? item.stockQty / adu : (item.stockQty <= 0 ? 0 : Infinity); return { ...item, adu, daysOfSupply }; })
      .filter(item => item.daysOfSupply < Infinity).sort((a, b) => a.daysOfSupply - b.daysOfSupply).slice(0, 5);

    const highest = inventory
      .map(item => { const u = usageEntries.find(e => e.name.toLowerCase() === item.itemName.toLowerCase()); const adu = u ? u.weightedAdu : 0; const daysOfSupply = adu > 0 ? item.stockQty / adu : (item.stockQty > 0 ? Infinity : 0); const tiedUpCapital = item.stockQty * (item.unitCost || 0); return { ...item, adu, daysOfSupply, tiedUpCapital }; })
      .filter(item => item.daysOfSupply > 30 && item.stockQty > 0).sort((a, b) => b.tiedUpCapital - a.tiedUpCapital).slice(0, 5);

    return {
      allCompletedOrders: completed, totalAllTimeRevenue: totalRev, totalAllTimeComplimentary: totalComp,
      dailyRevenueList: revList, bestDay: best, topProducts: top5,
      mostUsedStock: mostUsed, lowestStock: lowest, highestStock: highest
    };
  }, [orders, archivedOrders, inventory, products]);

  // --- DEPARTMENT ROUTING LOGIC (fb: Kitchen/Bar · log: Logistics/Warehouse) ---
  const displayOrders = filteredOrders.filter(order => {
    if (departmentFilter === 'All') return true;
    return order.items.some(item => (item.department || DEFAULT_DEPARTMENT) === departmentFilter);
  });

  // While the silent refresh is resolving, show a neutral splash instead of
  // briefly flashing the login screen for an already-authenticated user.
  if (authBootstrapping) {
    return (
      <div className="min-h-screen bg-page-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-fg/60">
          <RefreshCw size={32} className="animate-spin text-brand" />
          <span className="text-sm">Restoring session…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-page-bg flex flex-col lg:flex-row">
        <div className="hidden lg:flex lg:w-1/2 bg-surface border-r border-white/5 items-center justify-center">
          <div className="text-center p-12">
            <div className="w-24 h-24 bg-brand/20 border border-brand/30 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-brand/30">
              <Lock size={40} className="text-brand" />
            </div>
            <p className="text-5xl font-black text-brand tracking-tight leading-none mb-3">{BIZ_NAME}</p>
            <p className="text-fg/25 font-bold uppercase tracking-[0.3em] text-sm">SEMIVRA LIBELLUS</p>
            <p className="text-fg/15 text-xs mt-12 font-medium">Restaurant POS &amp; Management System</p>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
        <form onSubmit={handleSystemLogin} className="bg-sidebar-bg border border-white/10 p-8 rounded-2xl shadow-2xl w-full max-w-sm text-center">
          <div className="lg:hidden w-14 h-14 bg-brand/20 border border-brand/30 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand/20">
            <Lock size={24} className="text-brand" />
          </div>
          <h2 className="text-2xl font-black text-fg tracking-widest mb-1 uppercase">System Locked</h2>
          <p className="text-fg/40 text-sm mb-6">Enter credentials to begin your shift.</p>

          {loginError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4 text-left">
              <AlertCircle size={14} className="flex-shrink-0" />
              {loginError}
            </div>
          )}

          <input
            type="text"
            aria-label="Staff Name"
            placeholder="Staff Name"
            value={loginForm.name}
            onChange={e => setLoginForm({...loginForm, name: e.target.value})}
            className="w-full bg-white/5 border border-white/10 focus:border-brand focus:ring-2 focus:ring-brand/20 text-fg placeholder-white/20 text-center py-3 rounded-xl outline-none mb-3 font-bold transition"
            required
            autoFocus
          />
          <input
            type="password"
            aria-label="Password"
            placeholder="Password"
            value={loginForm.password}
            onChange={e => setLoginForm({...loginForm, password: e.target.value})}
            className="w-full bg-white/5 border border-white/10 focus:border-brand focus:ring-2 focus:ring-brand/20 text-fg placeholder-white/20 text-center py-3 rounded-xl outline-none mb-3 font-bold tracking-widest transition"
            required
          />
          <div className="relative mb-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand font-black text-lg pointer-events-none">₱</span>
            <input
              type="number"
              aria-label="Starting Cash in Philippine Pesos"
              placeholder="Starting Cash"
              min="0"
              step="0.01"
              value={startingCash}
              onChange={e => setStartingCash(e.target.value)}
              className="w-full bg-white/5 border border-brand/30 focus:border-brand text-fg text-center py-3 pl-8 rounded-xl outline-none font-black text-lg transition"
            />
          </div>
          <p className="text-fg/25 text-xs mb-5 text-center font-medium">
            Required for staff · Optional for Superadmin
          </p>
          <button type="submit" className="w-full bg-brand hover:bg-brand-dark text-fg font-black py-4 rounded-xl transition shadow-lg shadow-brand/20 uppercase tracking-widest">
            Start Shift
          </button>
        </form>
        </div>
      </div>
    );
  }

  // --- MENU ITEMS SEARCH / FILTER / SORT ---
  const filteredProducts = (() => {
    const q = prodSearch.trim().toLowerCase();
    const f = prodFilters;
    let list = products.filter(p => {
      if (q && !(
        p.name?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.productCode?.toLowerCase().includes(q)
      )) return false;

      if (f.category !== 'all' && p.category !== f.category) return false;

      const hasImage = !!p.image;
      if (f.image === 'with' && !hasImage) return false;
      if (f.image === 'without' && hasImage) return false;

      if (f.stock !== 'all') {
        // null = no recipe linked, so stock isn't tracked for this product.
        const est = getEstimatedStock(p.baseRecipe);
        if (f.stock === 'untracked' && est !== null) return false;
        if (f.stock === 'out'  && !(est !== null && est <= 0)) return false;
        if (f.stock === 'low'  && !(est !== null && est > 0 && est <= 5)) return false;
        if (f.stock === 'in'   && !(est !== null && est > 5)) return false;
      }

      const disc = Number(p.discountPercent || 0) > 0 || (p.clientDiscounts || []).length > 0;
      if (f.discount === 'discounted' && !disc) return false;
      if (f.discount === 'full' && disc) return false;

      const multi = (p.sizes || []).length > 0;
      if (f.sizes === 'multi' && !multi) return false;
      if (f.sizes === 'single' && multi) return false;

      return true;
    });

    const price = p => Number(p.basePrice ?? p.price ?? 0);
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
    const sorters = {
      'name': byName,
      'name-desc': (a, b) => byName(b, a),
      'price': (a, b) => price(a) - price(b),
      'price-desc': (a, b) => price(b) - price(a),
      'category': (a, b) => (a.category || '').localeCompare(b.category || '') || byName(a, b),
    };
    return [...list].sort(sorters[f.sort] || byName);
  })();

  const prodFiltersActive =
    prodSearch.trim() !== '' ||
    Object.entries(prodFilters).some(([k, v]) => k !== 'sort' && v !== 'all');

  const resetProdFilters = () => {
    setProdSearch('');
    setProdFilters({ category: 'all', image: 'all', stock: 'all', discount: 'all', sizes: 'all', sort: 'name' });
  };

  // --- PAGINATION MATH ---
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;

  // Only grab the items for the current page, out of the FILTERED list.
  const currentProducts = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

  // --- INVENTORY SEARCH / FILTER / SORT ---
  const invFilteredSorted = (() => {
    // Build itemCode → category map from products (set during import)
    const codeToCategory = {};
    for (const p of products) {
      if (p.productCode && p.category) codeToCategory[p.productCode] = p.category;
    }
    const getInvCategory = (i) => i.category || codeToCategory[i.itemCode] || '';

    let list = [...inventory];
    // Search
    if (invSearch.trim()) {
      const q = invSearch.trim().toLowerCase();
      list = list.filter(i =>
        i.itemName?.toLowerCase().includes(q) ||
        i.itemCode?.toLowerCase().includes(q)
      );
    }
    // Category filter
    if (invCategoryFilter) {
      list = list.filter(i => getInvCategory(i).toLowerCase() === invCategoryFilter.toLowerCase());
    }
    // Sort
    switch (invSort) {
      case 'name-asc':  list.sort((a, b) => (a.itemName || '').localeCompare(b.itemName || '')); break;
      case 'name-desc': list.sort((a, b) => (b.itemName || '').localeCompare(a.itemName || '')); break;
      case 'qty-asc':   list.sort((a, b) => (a.stockQty || 0) - (b.stockQty || 0)); break;
      case 'qty-desc':  list.sort((a, b) => (b.stockQty || 0) - (a.stockQty || 0)); break;
      case 'price-asc': list.sort((a, b) => (a.unitCost || 0) - (b.unitCost || 0)); break;
      case 'price-desc':list.sort((a, b) => (b.unitCost || 0) - (a.unitCost || 0)); break;
      default: break;
    }
    return list;
  })();

  // --- INVENTORY PAGINATION MATH ---
  const indexOfLastInv = invPage * invItemsPerPage;
  const indexOfFirstInv = indexOfLastInv - invItemsPerPage;
  const currentInventory = invFilteredSorted.slice(indexOfFirstInv, indexOfLastInv);
  const totalInvPages = Math.ceil(invFilteredSorted.length / invItemsPerPage);

  // --- ORDERS PAGINATION MATH ---
  const indexOfLastOrder = ordersPage * ordersItemsPerPage;
  const indexOfFirstOrder = indexOfLastOrder - ordersItemsPerPage;
  const currentOrders = displayOrders.slice(indexOfFirstOrder, indexOfLastOrder);
  const totalOrdersPages = Math.ceil(displayOrders.length / ordersItemsPerPage);

  // --- ACCOUNTING PAGINATION MATH ---
  const journalSearchQ = journalSearch.trim().toLowerCase();
  const filteredJournalEntries = journalSearchQ
    ? journalEntries.filter(e => e.reference?.toLowerCase().includes(journalSearchQ) || e.description?.toLowerCase().includes(journalSearchQ))
    : journalEntries;
  const indexOfLastEntry = accountingPage * accountingItemsPerPage;
  const indexOfFirstEntry = indexOfLastEntry - accountingItemsPerPage;

  const currentEntries = filteredJournalEntries.slice(indexOfFirstEntry, indexOfLastEntry);
  const totalAccountingPages = Math.ceil(filteredJournalEntries.length / accountingItemsPerPage);

  // --- PRICING PAGINATION MATH ---
  const indexOfLastPricing = pricingPage * pricingItemsPerPage;
  const indexOfFirstPricing = indexOfLastPricing - pricingItemsPerPage;
  const currentPricingProducts = products.slice(indexOfFirstPricing, indexOfLastPricing);
  const totalPricingPages = Math.ceil(products.length / pricingItemsPerPage);

  const isSuperAdmin = activeAdmin?.role === 'superadmin';
  // Granular permission check for UI gating (server still enforces). Superadmin ⇒ all.
  const can = (perm) => isSuperAdmin || auth.can(perm);
  // Void / refund are allowed for superadmin OR admin (case-insensitive).
  const canVoidRefund = ['superadmin', 'admin'].includes(String(activeAdmin?.role || '').toLowerCase());

  // CLOCK-IN GATE: every non-superadmin must clock in before using the POS.
  // (Superadmin/owner is exempt.) Shown once the clock status is known so we
  // don't flash this screen at an already-clocked-in user on load.
  if (!isSuperAdmin && clockStatusLoaded && !clockStatus.isClockedIn) {
    return (
      <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-brand/15 border border-brand/30 rounded-3xl flex items-center justify-center mb-6">
          <Clock size={40} className="text-brand" />
        </div>
        <h1 className="text-fg text-2xl font-black mb-1">Clock in to start</h1>
        <p className="text-fg/50 text-sm mb-8 max-w-xs">Hi {activeAdmin?.name} - you must clock in before taking orders or using the system.</p>
        <button onClick={handleClockIn}
          className="bg-brand text-white px-10 py-4 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-brand/90 active:scale-98 transition shadow-lg shadow-brand/20 min-h-[56px] flex items-center gap-2">
          <Clock size={18} /> Clock In
        </button>
        <button onClick={performLogout} className="mt-5 text-fg/40 hover:text-fg/70 text-xs font-bold uppercase tracking-wider transition">
          Log out
        </button>
      </div>
    );
  }

  // Sidebar nav content (inlined twice: desktop + mobile)
  const renderSidebarNav = (closeFn) => (
    <>
      {/* Brand — display only. Mode switching happens via the nav items below,
          which are always visible; the old hidden logo-click toggle was
          undiscoverable and is intentionally gone. */}
      <div className="p-5 border-b border-white/5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-black text-brand tracking-tight leading-none drop-shadow-sm">{BIZ_NAME}</p>
          <p className="text-[10px] text-fg/80 font-bold uppercase tracking-[0.25em] mt-0.5">
            SEMIVRA <span className="text-brand/80">{navMode === 'libellus' ? 'LIBELLUS' : 'NEGOTIUM'}</span>
            <span className="text-fg/40 normal-case tracking-normal font-bold"> · {navMode === 'libellus' ? 'Operations' : 'Management'}</span>
          </p>
          <span className="inline-block mt-1.5 text-[8px] font-black bg-brand/15 border border-brand/30 text-brand px-2 py-0.5 rounded-full uppercase tracking-widest">{vatRegLabel}</span>
        </div>
        {/* Notifications live HERE, not in the <nav> below — that list scrolls
            (lg:overflow-y-auto), so a bell inside it disappears the moment the
            menu is long enough. This header block is always on screen.
            Desktop only: the lg:hidden mobile top bar has its own bell. */}
        <div className="hidden lg:block shrink-0">
          <NotificationBell align="left" />
        </div>
      </div>

      {/* Nav */}
      <nav className="p-3 space-y-0.5 lg:flex-1 lg:min-h-0 lg:overflow-y-auto custom-scrollbar">
        <p className="text-[9px] text-fg/80 font-bold uppercase tracking-[0.2em] px-4 pt-2 pb-1">Operations</p>
        {[
          { id: 'orders', label: 'Orders & POS', icon: ShoppingCart, perm: 'orders.view' },
          { id: 'inventory', label: 'Inventory & Stock', icon: Package, perm: 'inventory.view' },
          { id: 'procurement', label: 'Procurement', icon: Truck, perm: 'procurement.view' },
          { id: 'clients', label: 'Clients', icon: Users, perm: 'orders.view' },
          { id: 'products', label: 'Menu Setup', icon: ChefHat, perm: 'products.view' },
        ].filter(({ perm }) => can(perm)).map(({ id, label, icon: Icon }) => {
          // invBadgeCount and invBadgeColor are hoisted to component scope above
          const badgeCount = id === 'inventory' ? invBadgeCount : 0;
          const badgeColor = id === 'inventory' ? invBadgeColor : 'bg-red-500';
          return (
            <button key={id}
              onClick={() => { setActiveTab(id); setNavMode('libellus'); closeFn?.(); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition font-bold text-sm
                ${activeTab === id && navMode === 'libellus' ? 'bg-brand text-white shadow-sm' : 'text-fg/50 hover:text-fg hover:bg-white/5'}`}
            >
              <Icon size={16} />
              {label}
              {badgeCount > 0 && <span className={`ml-auto text-[9px] text-fg font-black px-1.5 py-0.5 rounded-full ${badgeColor}`}>{badgeCount}</span>}
              {activeTab === id && navMode === 'libellus' && badgeCount === 0 && <ChevronRight size={13} className="ml-auto" />}
            </button>
          );
        })}

        {(() => {
          // Management tabs gated by granular permission. History still depends on
          // superadmin-only server routes, so it stays superadmin-only; Pricing
          // Control's only server calls (/api/discounts — promos, PWD/Senior
          // discounts) are requireStaff, not superadmin-only, so it's gated on
          // products.manage like Menu Setup — a hardcoded isSuperAdmin here made
          // any non-superadmin staff (managers, custom roles with products.manage)
          // unable to find or CRUD promos/discounts at all.
          // Default sub-tab for each grouped tab, set on click so switching between
          // Ledger and Reports (both rendered by LedgerTab) lands on the right page.
          const mgmtItems = [
            { id: 'analytics', label: 'Analytics',       icon: BarChart3,   show: can('analytics.view') },
            { id: 'reports',   label: 'Reports',         icon: BarChart2,   show: can('reports.view'), sub: 'salessummary' },
            { id: 'ledger',    label: 'Ledger',          icon: FileText,    show: can('accounting.view'), sub: 'journal' },
            { id: 'pricing',   label: 'Pricing Control', icon: DollarSign,  show: can('products.manage') },
            { id: 'history',   label: 'Shifts & Cash',   icon: Clock,       show: isSuperAdmin },
            { id: 'audit',     label: 'Audit Report',    icon: ShieldCheck, show: can('audit.view') },
          ].filter(it => it.show);
          if (mgmtItems.length === 0 && !isSuperAdmin) return null;
          return (
            <>
              <p className="text-[9px] text-fg/80 font-bold uppercase tracking-[0.2em] px-4 pt-4 pb-1">Management</p>
              {mgmtItems.map(({ id, label, icon: Icon, sub }) => (
                <button key={id}
                  onClick={() => { setActiveTab(id); setNavMode('negotium'); closeFn?.(); if (id === 'analytics') { fetchAnalytics(); fetchTurnover(); fetchSalesTrend(); } if (sub) setLedgerSubTab(sub); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition font-bold text-sm
                    ${activeTab === id && navMode === 'negotium' ? 'bg-brand text-white shadow-sm' : 'text-fg/50 hover:text-fg hover:bg-white/5'}`}
                >
                  <Icon size={16} />
                  {label}
                  {activeTab === id && navMode === 'negotium' && <ChevronRight size={13} className="ml-auto" />}
                </button>
              ))}
              {isSuperAdmin && (
                // Superadmin-only deep link — the Admin Panel page (user, client-
                // account, role & tenant management), outside the tabbed dashboard.
                <button key="admin-panel"
                  onClick={() => { closeFn?.(); navigate('/admin/admin-panel'); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition font-bold text-sm text-fg/50 hover:text-fg hover:bg-white/5"
                >
                  <ShieldCheck size={16} className="text-brand shrink-0" />
                  <span className="whitespace-nowrap">Admin Panel</span>
                  <span className="ml-auto shrink-0 text-[8px] font-black uppercase tracking-widest bg-brand border border-brand text-white px-1.5 py-0.5 rounded">Super</span>
                </button>
              )}
            </>
          );
        })()}
      </nav>

      {/* Bottom */}
      <div className="p-3 border-t border-white/5 space-y-0.5">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-[10px] text-fg/60 font-bold uppercase tracking-wider">Auto-Close</span>
          <MidnightCountdown />
        </div>
        {/* Clock In/Out/Break - always visible (frequent, critical action) */}
        <button onClick={handleClockButton}
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-sm transition ${clockStatus.onBreak ? 'text-white bg-amber-500 hover:bg-amber-600' : clockStatus.isClockedIn ? 'text-white bg-accent hover:bg-accent/80' : 'text-fg/40 hover:text-fg hover:bg-white/5'}`}>
          <Clock size={15} />
          {clockStatus.onBreak
            ? `On Break - tap to resume`
            : clockStatus.isClockedIn
              ? `Clocked In · ${clockStatus.entry ? Math.round((Date.now()-new Date(clockStatus.entry.clockIn))/60000) : 0}m`
              : 'Clock In'}
        </button>

        {/* Settings — system preferences & account. The QR-Orders / Auto-Close /
            Product-Images toggles and Change Password now live on this page
            instead of being crammed into the sidebar dropdown. */}
        <button onClick={() => { setActiveTab('settings'); setNavMode('negotium'); closeFn?.(); }}
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-sm transition ${activeTab === 'settings' ? 'bg-brand text-white shadow-sm' : 'text-fg/40 hover:text-fg hover:bg-white/5'}`}>
          <Settings size={15} />
          Settings
          {activeTab === 'settings' && <ChevronRight size={13} className="ml-auto" />}
        </button>

        {/* Collapsible quick tools - Fullscreen / QR / Install (frequent, low-stakes) */}
        <button onClick={toggleOpsTools}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-fg/40 hover:text-fg hover:bg-white/5 transition font-bold text-[11px] uppercase tracking-wider">
          {opsToolsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          Quick Tools
        </button>
        {opsToolsOpen && (
          <div className="space-y-0.5">
            <button onClick={toggleFullScreen} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-fg/40 hover:text-fg hover:bg-white/5 transition font-bold text-sm">
              {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
            <button onClick={e => { e.preventDefault(); (BUSINESS_TYPE === 'log' ? handleCopyPortalLink() : handleShowQR()); closeFn?.(); }} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-brand/60 hover:text-brand hover:bg-brand/10 transition font-bold text-sm">
              <QrCode size={15} />
              {BUSINESS_TYPE === 'log' ? 'Portal' : 'Show QR'}
            </button>
            {/* Install as app (only when the browser offers it) */}
            {installable && (
              <button onClick={() => { install(); closeFn?.(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-brand/70 hover:text-brand hover:bg-brand/10 transition font-bold text-sm">
                <Download size={15} />
                Install App
              </button>
            )}
          </div>
        )}
        <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition font-bold text-sm">
          <LogOut size={15} />
          {isSuperAdmin ? 'Log Out' : 'End Shift'}
        </button>
        <div className="px-3 py-2 border-t border-white/5 mt-1">
          <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
            <div className="w-8 h-8 rounded-lg bg-brand/20 border border-brand/30 flex items-center justify-center flex-shrink-0">
              <span className="text-brand font-black text-xs">{activeAdmin?.name?.charAt(0)?.toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <p className="text-fg/60 text-xs font-bold truncate">{activeAdmin?.name}</p>
              <p className="text-fg/25 text-[10px] uppercase tracking-widest">{activeAdmin?.role}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );


  // ── Computed pagination variables exposed to ctx ─────────────────────────────
  // (already computed above in pagination math section; aliased here for clarity)
  // These are referenced directly by the tab files.

  // ── CTX: bundle state + handlers for tab components ─────────────────────────
  // Only include identifiers that are actually defined at this scope.
  // Tab files receive undefined for any key not in this object (harmless).
  const ctx = {
    // ── Shared data ─────────────────────────────────────────────────────────
    orders, archivedOrders, products, categories, inventory, discounts, globalAddOns,
    users, activeAdmin, isSuperAdmin, canVoidRefund, can,
    // ── Core helpers ────────────────────────────────────────────────────────
    fetchOrders, fetchData, fetchERPData, fetchEODData,
    apiFetch, updateStatus, printOrderSlip, printBillingStatement, printDeliveryReceipt, handleVoidOrder,
    peso, BIZ_NAME, COMP_REASON_LABELS, API_URL, FRONTEND_URL,
    // ── Analytics ───────────────────────────────────────────────────────────
    analyticsData, analyticsLoading, fetchAnalytics, exportAnalyticsToPDF,
    turnoverData, fetchTurnover,
    salesTrendData, salesTrendPeriod, setSalesTrendPeriod, fetchSalesTrend,
    // ── Navigation ──────────────────────────────────────────────────────────
    activeTab, setActiveTab, navMode, setNavMode,
    // ── Shift end / bank deposit (ShiftEndModal) ────────────────────────────
    shiftEndModal, setShiftEndModal, shiftEndLoading, shiftReconcile, setShiftReconcile,
    handleEndShift, handleBankDeposit, performLogout, startingCash,
    depositAmount, setDepositAmount, depositError, setDepositError, depositLoading,
    // ── Stock history / import / partial fulfil modals ──────────────────────
    submitImport, loadPdfLibs,
    // ── Ledger sub-tabs ─────────────────────────────────────────────────────
    ledgerSubTab, setLedgerSubTab, jeForm, setJeForm, cashOnHand, standardAccounts,
    // ── Chart of Accounts CRUD ──
    coaAccounts, fetchCoa, coaParent, setCoaParent, coaNewName, setCoaNewName,
    coaEditId, setCoaEditId, coaEditName, setCoaEditName, coaBusy,
    addCoaChild, renameCoaChild, deleteCoaChild, seedPaymentSubaccounts,
    // ── Derived account lists for "Paid From / Charge To" dropdowns ──
    cashAndBankAccounts, apAccounts, arAccounts, procurementCreditAccounts,
    // ── Closed periods ──
    closedPeriods, fetchClosedPeriods, closePeriod, reopenPeriod,
    periodCloseForm, setPeriodCloseForm,
    // ── Audit log ──
    auditLogEntries, auditLogPage, auditLogPages, auditLogFilter, setAuditLogFilter, fetchAuditLog,
    // ── Payment method → account map ──
    paymentMap, fetchPaymentMap, savePaymentMapping, resetPaymentMapping,
    // ── Backdated Sales (superadmin) ──
    backdateForm, setBackdateForm, backdateBusy, submitBackdateSale,
    // ── Tenancy ──
    tenancyReport, tenancyBusy, fetchTenancyReport, runTenancyRebackfill,
    // ── Client accounts (for per-product per-client discount picker) ──
    clientAccounts,
    // ── Partial fulfillment ──
    partialModal, setPartialModal, partialQtys, setPartialQtys,
    partialMode, setPartialMode, partialPayment, setPartialPayment,
    partialBusy, openPartial, submitPartialFulfill, dropRemaining,
    pnlData, pnlRange, setPnlRange, fetchPnl, bsData, fetchBalanceSheet, reconcileInventory,
    pnlMonthly, pnlmRange, setPnlmRange, pnlmView, setPnlmView, fetchPnlMonthly, exportPnlMonthlyPDF,
    bsMonthly, bsmRange, setBsmRange, bsmView, setBsmView, fetchBsMonthly, exportBsMonthlyPDF,
    arOutstanding, fetchArOutstanding, arAgeing, fetchArAgeing, suppliers, fetchSuppliers,
    expenseModal, setExpenseModal, expenseCategories, fetchExpenseCategories,
    expenseForm, setExpenseForm, expenseSubmitting, submitExpense, expenseList, fetchExpenses,
    settleModal, setSettleModal, settleForm, setSettleForm, settleSubmitting, setSettleSubmitting,
    submitArSettlement,
    // ── Revolving funds ─────────────────────────────────────────────────────
    rfFunds, rfLoading, rfActiveFund, setRfActiveFund, rfTxs, rfTxTotal, rfTxPage, rfTxPages,
    rfNewModal, setRfNewModal, rfNewForm, setRfNewForm, rfNewSubmitting,
    rfDisbModal, setRfDisbModal, rfDisbForm, setRfDisbForm, rfDisbSubmitting,
    rfReplModal, setRfReplModal, rfReplForm, setRfReplForm, rfReplSubmitting,
    fetchRfFunds, fetchRfTxs, submitRfNew, submitRfDisb, submitRfRepl, closeRfFund,
    // ── Orders & POS ────────────────────────────────────────────────────────
    filteredOrders, displayOrders, orderFilter, setOrderFilter, departmentFilter, setDepartmentFilter,
    orderSearch, setOrderSearch,
    collapsedOrders, setCollapsedOrders, updatingOrders, cashTendered, setCashTendered,
    isPosOpen, setIsPosOpen, posCart, setPosCart, posCategory, setPosCategory, posPage, setPosPage,
    posSearch, setPosSearch, posCustomerName, setPosCustomerName, posClientId, setPosClientId, posReserveOnly, setPosReserveOnly, posTable, setPosTable,
    posPayment, setPosPayment, posSelectedProduct, setPosSelectedProduct,
    posActiveSize, setPosActiveSize, posActiveAddOns, setPosActiveAddOns, posItemQty, setPosItemQty,
    posDiscountType, setPosDiscountType, posDiscountValue, setPosDiscountValue,
    posDiscountAmt, posItemDiscountAmt, posGrandTotal, posSubtotal, posSubmitting,
    posCheckoutModal, setPosCheckoutModal, posCashTendered, setPosCashTendered,
    posDeliveryAddress, setPosDeliveryAddress, posCustomerPhone, setPosCustomerPhone,
    posDeliveryFee, setPosDeliveryFee, posDeliveryFeeNum, posScheduledTime, setPosScheduledTime,
    compSelections, setCompSelections, compOverride, setCompOverride,
    compReasonTypes, setCompReasonTypes, compReasonNotes, setCompReasonNotes,
    paymentSelections, setPaymentSelections,
    submitManualOrder, openProductModal, confirmPosItem,
    ordersPage, setOrdersPage, ordersItemsPerPage,
    // ── Inventory ───────────────────────────────────────────────────────────
    invSubTab, setInvSubTab, invForm, setInvForm, invPage, setInvPage, invItemsPerPage,
    invSearch, setInvSearch, invSort, setInvSort, invCategoryFilter, setInvCategoryFilter,
    importProgress,
    activeInventoryItem, setActiveInventoryItem, restockData, setRestockData,
    stockHistory, setStockHistory, historyModalOpen, setHistoryModalOpen, historyItemName, setHistoryItemName, historyItem,
    physicalCounts, setPhysicalCounts, varianceReasons, setVarianceReasons,
    varianceNoteMode, setVarianceNoteMode,
    eodStatus, eodLockedAt, dailyMovement,
    invBadgeCount, expandedBatchRows, setExpandedBatchRows,
    editInvModal, setEditInvModal, editInvForm, setEditInvForm, editInvSubmitting,
    importModal, setImportModal, importRows, setImportRows, importSubmitting,
    spoilageModal, setSpoilageModal, spoilageForm, setSpoilageForm, spoilageLoading, setSpoilageLoading,
    handleRestockSubmit, submitPhysicalCounts,
    // ── Inventory helpers ────────────────────────────────────────────────────
    effectiveDisplay, itemDisplay, packInfo, fetchStockHistory,
    resolveUnitFE, submitEditInventory,
    openEditInventory, deleteInventory, parseImportFile,
    printXReading, handleSaveAddOn,
    // ── History ─────────────────────────────────────────────────────────────
    historySubTab, setHistorySubTab, groupedArchives, expandedDays, toggleDay,
    expandedOrderLists, toggleOrderList, historyPage, setHistoryPage, HIST_PAGE_SIZE,
    shiftHistory, shiftHistoryPage, setShiftHistoryPage, shiftHistoryTotal, SHIFT_HIST_PAGE_SIZE,
    fetchShiftHistory, shiftFilter, setShiftFilter, exportDayToPDF,
    // ── Pricing ─────────────────────────────────────────────────────────────
    editPriceId, setEditPriceId, editPriceVal, setEditPriceVal,
    editCostId, setEditCostId, editCostVal, setEditCostVal,
    pricingPage, setPricingPage, pricingItemsPerPage,
    handleInlinePriceUpdate, handleInlineCostUpdate, discountForm, setDiscountForm,
    // ── Audit ───────────────────────────────────────────────────────────────
    auditFilter, setAuditFilter, auditCancelPage, setAuditCancelPage,
    auditCompPage, setAuditCompPage, auditDiscPage, setAuditDiscPage,
    auditStaffPage, setAuditStaffPage, AUDIT_PAGE_SIZE,
    // ── Products / Menu ─────────────────────────────────────────────────────
    editingProduct, setEditingProduct, formData, setFormData,
    catForm, setCatForm, editingCategory, setEditingCategory,
    discountList, newDiscount, setNewDiscount, addOnForm, setAddOnForm,
    currentPage, setCurrentPage, itemsPerPage,
    resetProductForm,
    // ── Menu items search / filter ───────────────────────────────────────────
    prodSearch, setProdSearch, prodFilters, setProdFilters,
    filteredProducts, prodFiltersActive, resetProdFilters,
    // ── Computed pagination slices ───────────────────────────────────────────
    currentProducts, totalPages,
    currentInventory, totalInvPages,
    currentOrders, totalOrdersPages,
    currentEntries, totalAccountingPages,
    currentPricingProducts, totalPricingPages,
    // ── Per-page constants ───────────────────────────────────────────────────
    POS_PER_PAGE,
    // ── Additional data state ────────────────────────────────────────────────
    journalEntries, setJournalEntries,
    // ── Additional handlers ──────────────────────────────────────────────────
    archiveDay, addInventory,
    downloadImportTemplate, downloadJournalCsv,
    exportInventoryToPDF, exportLedgerToPDF, exportAllToPDF,
    handleSaveProduct, handleSaveCategory, toggleProductAvailability, toggleProductOOS,
    // ── Change Password ──────────────────────────────────────────────────────
    changePwModal, setChangePwModal, setChangePwError, changePwForm, setChangePwForm, changePwLoading, changePwError, handleChangePassword,
    // ── Modifier Groups ──────────────────────────────────────────────────────
    modifierGroups, fetchModifierGroups,
    editingModifier, setEditingModifier, modForm, setModForm,
    saveModifierGroup, editModifierGroup, deleteModifierGroup,
    // ── Combos / Bundles ─────────────────────────────────────────────────────
    combos, editingCombo, setEditingCombo, comboForm, setComboForm,
    saveCombo, editCombo, deleteCombo, addComboToPosCart,
    // ── Parked Orders ────────────────────────────────────────────────────────
    parkedOrders, parkedModalOpen, setParkedModalOpen, fetchParked, parkCurrentOrder, resumeParked,
    // ── Reports ──────────────────────────────────────────────────────────────
    menuEngineering, fetchMenuEngineering, cashierVariance, fetchCashierVariance, purchaseOrder, fetchPurchaseOrder,
    commissions, fetchCommissions,
    exportPnlPDF, exportBalanceSheetPDF, exportPurchaseOrderPDF,
    // ── Multi-Payment ────────────────────────────────────────────────────────
    posPayments, setPosPayments, posGuestCount, setPosGuestCount,
    // ── Archive Search ───────────────────────────────────────────────────────
    archiveSearch, setArchiveSearch, archiveDateRange, setArchiveDateRange, archiveTotal,
    // ── Denomination Breakdown + Z-Reading ──────────────────────────────────
    DENOMS, denomCounts, setDenomCounts, denomTotal, printZReading,
    // ── Profit by Category ───────────────────────────────────────────────────
    profitByCategory, fetchProfitByCategory,
    // ── System Settings / QR Toggle ─────────────────────────────────────────
    systemSettings, toggleQROrders, toggleAutoClose, toggleImages, saveSetting,
    // ── Sales by Payment ─────────────────────────────────────────────────────
    salesByPayment, sbpRange, setSbpRange, fetchSalesByPayment,
    // ── Summary Sales (channel breakdown) ────────────────────────────────────
    salesSummary, sssRange, setSssRange, sssGroup, setSssGroup, sssRows, fetchSalesSummary, exportSalesSummaryPDF,
    salesLineItems, sliRange, setSliRange, fetchSalesLineItems, exportSalesLineItemsPDF,
    // ── Refund ───────────────────────────────────────────────────────────────
    refundModal, setRefundModal, refundForm, setRefundForm, refundSubmitting, handleRefund,
    // ── Clock In/Out ─────────────────────────────────────────────────────────
    clockStatus, clockEntries, clockEntriesTotal, clockEntriesPage,
    fetchClockStatus, fetchClockEntries, handleClockIn, handleClockOut,
    clockModalOpen, setClockModalOpen, handleClockButton, startBreak, endBreak,
    // ── Kitchen Ticket ───────────────────────────────────────────────────────
    printKitchenTicket,
    // ── Audit Logs ──────────────────────────────────────────────────────────
    auditLogs, auditLogsPage, auditLogsTotal, AUDIT_LOGS_PAGE_SIZE, fetchAuditLogs,
    auditLogFilters, setAuditLogFilters, exportAuditLogsCsv, exportAuditLogsPdf,
    // ── AP Outstanding ──────────────────────────────────────────────────────
    apData, fetchApData, apPayModal, setApPayModal, apPayForm, setApPayForm, apPaySubmitting, submitApPayment,
    // ── Bills (AP approval workflow) ─────────────────────────────────────────
    bills, billsFilter, setBillsFilter, fetchBills, billBusy,
    billCreate, setBillCreate, submitCreateBill,
    approveBill, rejectBill, scheduleBill,
    billPayModal, setBillPayModal, billPayFrom, setBillPayFrom, submitBillPay,
    expenseAccounts,
    // ── Order Notes ─────────────────────────────────────────────────────────
    posNotes, setPosNotes,
    deleteProduct, deleteCategory, deleteAddOn,
    updateSize, removeSize, addSize, addMaterialToRecipe, updateMaterialQty, removeMaterial,
    calcRecipeCost, getEstimatedStock, handleImageUpload,
    // ── Orders interactive handlers ──────────────────────────────────────────
    updateItemStatus, removeAddOnFromOrder,
    applyComplimentary, removeComplimentary,
    applyDiscount, applyItemDiscount,
    discountInputs, setDiscountInputs,
    scpwdOpen, setScpwdOpen,
    isStatusMenuOpen, setIsStatusMenuOpen,
    // ── Ledger pagination ────────────────────────────────────────────────────
    accountingPage, setAccountingPage, accountingItemsPerPage, journalSearch, setJournalSearch,
    setRfTxs,
  };

  return (
    <DashboardProvider value={ctx}>
    <div className="min-h-screen bg-page-bg flex text-fg">

      {/* ── IN-APP ORDER TOASTS (sound plays on newOrder; this shows the visual) ── */}
      {orderToasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[99999] flex flex-col gap-2 pointer-events-none">
          {orderToasts.map(t => (
            <div key={t.id}
              className="flex items-center gap-3 bg-brand text-white px-4 py-3 rounded-2xl shadow-lg shadow-brand/30 animate-fade-in min-w-[220px]">
              <Bell size={16} className="shrink-0 animate-bounce"/>
              <div>
                <p className="font-black text-sm leading-none">New Order! #{t.orderNumber}</p>
                <p className="text-fg/70 text-xs mt-0.5">{t.table} · {t.ts}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── MANAGER ACCOUNTING ALERTS (persist until dismissed) ── */}
      {mgrAlerts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[99999] flex flex-col gap-2 max-w-sm">
          {mgrAlerts.map(a => (
            <div key={a.id} className="flex items-start gap-2 bg-amber-500/15 border border-amber-500/40 text-amber-200 px-4 py-3 rounded-2xl shadow-lg animate-fade-in">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <p className="text-xs font-bold leading-snug flex-1">{a.message}</p>
              <button onClick={() => dismissMgrAlert(a.id)} className="text-amber-200/60 hover:text-amber-100 shrink-0"><X size={15} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Mobile overlay */}
      {dashDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setDashDrawerOpen(false)} />
      )}

      {/* Mobile drawer - capped width on small phones, scrollable on short screens */}
      <aside className={`lg:hidden fixed top-0 left-0 h-full w-72 max-w-[85vw] bg-sidebar-bg z-50 flex flex-col border-r border-white/5 overflow-y-auto overscroll-contain transition-transform duration-300 ${dashDrawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {renderSidebarNav(() => setDashDrawerOpen(false))}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 bg-sidebar-bg border-r border-white/5 h-screen sticky top-0 overflow-hidden">
        {renderSidebarNav()}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile top bar - sticky so the menu button is always reachable */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-16 bg-sidebar-bg border-b border-white/5 flex-shrink-0">
          <button
            onClick={() => setDashDrawerOpen(true)}
            className="p-2 rounded-xl text-fg/50 hover:text-fg hover:bg-white/10 transition"
            aria-label={dashDrawerOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={dashDrawerOpen}
          >
            <Menu size={21} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-black text-fg text-sm uppercase tracking-widest truncate">{BIZ_NAME}</p>
              <span className="text-[8px] font-black bg-brand/20 border border-brand/30 text-brand px-1.5 py-0.5 rounded-full uppercase tracking-widest flex-shrink-0">NON-VAT</span>
            </div>
            <p className="text-brand text-[10px] font-bold uppercase truncate">{activeAdmin?.name} · {navMode === 'libellus' ? 'Operations' : 'Management'}</p>
          </div>
          {/* min-w-0 + overflow-x lets this action group scroll internally on a
              very narrow phone (≤320px) rather than pushing the whole page wider;
              shrink-0 keeps each control its natural size. At 375px+ it all fits,
              so no scrollbar shows. */}
          <div className="flex items-center gap-2 min-w-0 overflow-x-auto scrollbar-hide">
            {(!isOnline || queuedCount > 0) && (
              <span className={`shrink-0 flex items-center gap-1 px-2 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider ${isOnline ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
                {isOnline ? <RefreshCw size={12} className={queuedCount > 0 ? 'animate-spin' : ''} /> : <WifiOff size={12} />}
                {queuedCount > 0 ? queuedCount : 'Off'}
              </span>
            )}
            <button onClick={() => setPaletteOpen(true)}
              title="Quick jump (Ctrl+K)" aria-label="Open quick jump"
              className="shrink-0 flex items-center gap-1.5 bg-white/5 text-fg/50 border border-white/10 px-3 py-2 rounded-xl font-bold text-xs hover:bg-white/10 hover:text-fg transition">
              <Search size={13} /><span className="hidden lg:inline">Jump</span>
            </button>
            <div className="shrink-0"><NotificationBell /></div>
            <button onClick={e => { e.preventDefault(); BUSINESS_TYPE === 'log' ? handleCopyPortalLink() : handleShowQR(); }} className="shrink-0 flex items-center gap-1.5 bg-brand/20 text-brand border border-brand/30 px-3 py-2 rounded-xl font-bold text-xs hover:bg-brand/30 transition">
              <QrCode size={13} /> {BUSINESS_TYPE === 'log' ? 'Portal' : 'QR'}
            </button>
            <button onClick={() => { setChangePwModal(true); setChangePwError(''); }} className="shrink-0 flex items-center gap-1.5 bg-white/5 text-fg/50 border border-white/10 px-3 py-2 rounded-xl font-bold text-xs hover:bg-white/10 transition" title="Change Password">
              <Settings size={13} />
            </button>
            <button onClick={handleLogout} className="shrink-0 flex items-center gap-1.5 bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-2 rounded-xl font-bold text-xs hover:bg-red-500/20 transition">
              {isSuperAdmin ? 'Log Out' : 'End Shift'}
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 p-4 lg:p-6">

      {/* ── OFFLINE / SYNC BANNER ─────────────────────────────────────────── */}
      {(!isOnline || queuedCount > 0) && (
        <div className={`mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border ${isOnline ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          {isOnline ? <CloudOff size={18} className="shrink-0" /> : <WifiOff size={18} className="shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm leading-tight">
              {isOnline
                ? `Syncing ${queuedCount} offline order${queuedCount === 1 ? '' : 's'}…`
                : 'You are offline - orders are saved locally'}
            </p>
            <p className="text-xs opacity-70 leading-tight mt-0.5">
              {isOnline
                ? 'Queued orders are being sent to the server automatically.'
                : `New orders are queued and will sync when the connection returns.${queuedCount > 0 ? ` (${queuedCount} waiting)` : ''}`}
            </p>
          </div>
          {isOnline && queuedCount > 0 && (
            <button onClick={() => syncQueue(sendQueuedOrder).then(({ sent }) => { if (sent > 0) fetchOrders(); })}
              className="shrink-0 flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition">
              <RefreshCw size={12} /> Sync now
            </button>
          )}
        </div>
      )}

      {/* QR MODAL (Fixed z-index and flex shrinking issues) */}
      {showQR && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface p-6 md:p-8 rounded-xl border border-gray-700 shadow-2xl flex flex-col items-center max-w-sm w-full relative max-h-[95vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setShowQR(false)} className="absolute top-4 right-4 text-gray-400 hover:text-fg font-bold text-2xl shrink-0">✕</button>
            <h2 className="text-2xl font-bold mb-1 text-fg shrink-0">Customer QR</h2>
            <div className="bg-page-bg px-6 py-2 rounded-full border border-gray-700 mb-6 mt-2 flex items-center gap-2 shrink-0">
              <span className="text-gray-400 text-sm font-bold uppercase tracking-wider">Session ID:</span>
              <span className="text-accent font-black text-lg">{autoTableId}</span>
            </div>
            
            {/* FIX: Added shrink-0, p-4, and removed overflow-hidden so the QR never gets squished! */}
            <div className="bg-white rounded-xl shadow-inner w-full flex justify-center items-center p-4 shrink-0 min-h-[250px]">
              {/* Point the QR at the SAME origin the app is actually served from,
                  not a build-time VITE_FRONTEND_URL that can be stale or (in local
                  rehearsal) a non-resolving *.localtest host. The customer menu
                  (/menu/:table) is the same app at the same origin as this admin
                  view, so window.location.origin is always the reachable URL —
                  mirrors how the logistics portal link is built. */}
              <QRCode
                value={`${window.location.origin}/menu/${autoTableId}?session=${qrSessionId}`}
                size={200}
              />
            </div>
            
            <button 
              onClick={(e) => { e.preventDefault(); handleShowQR(); }} 
              className="mt-6 w-full bg-surface border border-accent text-accent font-bold py-3 rounded-md hover:bg-accent hover:text-fg transition uppercase tracking-widest text-sm shrink-0"
            >
              Generate Next QR
            </button>
            <button 
              onClick={() => setShowQR(false)} 
              className="mt-3 w-full bg-page-bg border border-gray-600 text-accent font-bold py-3 rounded-md hover:bg-accent hover:text-fg transition text-sm shrink-0"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          END-OF-SHIFT RECONCILIATION MODAL
          ============================================================ */}
      <ShiftEndModal />

      {/* --- ANALYTICS DASHBOARD TAB --- */}
      {activeTab === 'analytics' && <Suspense fallback={<TabFallback />}><AnalyticsTab ctx={ctx} /></Suspense>}

      {/* --- ACTIVE ORDERS TAB (Kitchen & Bar View) --- */}
      {/* --- ACTIVE ORDERS TAB (Kitchen & Bar View) --- */}
      {activeTab === 'orders' && <Suspense fallback={<TabFallback />}><OrdersTab ctx={ctx} /></Suspense>}

      {/* --- SALES HISTORY & REGISTER TAB --- */}
      {activeTab === 'history' && <Suspense fallback={<TabFallback />}><HistoryTab ctx={ctx} /></Suspense>}


      {/* --- INVENTORY TAB --- */}
      {activeTab === 'inventory' && <Suspense fallback={<TabFallback />}><InventoryTab ctx={ctx} /></Suspense>}

      {/* --- ACCOUNTING & LEDGER TAB --- */}
      {(activeTab === 'ledger' || activeTab === 'reports') && <Suspense fallback={<TabFallback />}><LedgerTab ctx={ctx} /></Suspense>}

      {/* ===== REVOLVING FUND MODALS ===== */}

      {/* NEW FUND MODAL */}
      <RevolvingFundNewModal />

      {/* DISBURSE MODAL */}
      <RevolvingFundDisburseModal />

      {/* REPLENISH MODAL */}
      <RevolvingFundReplenishModal />

      {/* ===== EXPENSE ENTRY MODAL ===== */}

      {/* ===== A/R SETTLEMENT MODAL ===== */}
      <SettleArModal />

      {/* --- PRICING & DISCOUNTS TAB --- */}
      {activeTab === 'pricing' && <Suspense fallback={<TabFallback />}><PricingTab ctx={ctx} /></Suspense>}

{/* --- AUDIT REPORT --- */}
      {activeTab === 'audit' && <Suspense fallback={<TabFallback />}><AuditTab ctx={ctx} /></Suspense>}

{/* --- MENU SETUP (PRODUCTS/CATEGORIES) --- */}
      {activeTab === 'products' && <Suspense fallback={<TabFallback />}><ProductsTab ctx={ctx} /></Suspense>}

{/* --- PROCUREMENT (PURCHASE ORDERS) --- */}
      {activeTab === 'procurement' && <Suspense fallback={<TabFallback />}><ProcurementTab ctx={ctx} /></Suspense>}

      {/* --- CLIENTS TAB --- */}
      {activeTab === 'clients' && <Suspense fallback={<TabFallback />}><ClientsTab /></Suspense>}

{/* --- SETTINGS --- */}
      {activeTab === 'settings' && <Suspense fallback={<TabFallback />}><SettingsTab ctx={ctx} /></Suspense>}

      {/* --- STOCK MOVEMENT HISTORY MODAL --- */}
      <StockHistoryModal />

      {/* ============================================================
          WASTE / SPOILAGE LOGGING MODAL
          ============================================================ */}
      {/* ===== BULK INVENTORY IMPORT MODAL ===== */}
      <ImportModal />

      {/* ===== EDIT INVENTORY ITEM MODAL ===== */}
      <EditInventoryModal />

      {/* ── PARTIAL FULFILLMENT MODAL ─────────────────────────────────────── */}
      <PartialFulfillModal />

      {/* ── REFUND MODAL ──────────────────────────────────────────────────── */}
      <RefundModal />

      {/* ── CLOCK OUT / BREAK CHOICE MODAL ───────────────────────────────── */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ClockModal />

      {/* ── CHANGE PASSWORD MODAL ─────────────────────────────────────────── */}
      <ChangePasswordModal />

      <SpoilageModal />

        </div>
      </div>
    </div>
    </DashboardProvider>
  );
}