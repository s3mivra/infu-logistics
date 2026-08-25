import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import * as ui from '../../shared/ui';
import { loadSession, clearSession, saveSession, loadDraft, saveDraft } from './clientSession';
import { CLIENT_THEMES, applyClientTheme, cachedClientTheme, clearClientTheme } from './clientTheme';
import { buildBillingDocHTML, printBillingDoc } from '../../shared/billingDocument';
import {
  Package, ShoppingCart, Plus, Minus, X, LogOut, CheckCircle,
  CreditCard, Loader2, ChevronLeft, Search, Download, FileText, Menu, Megaphone,
  Settings, KeyRound, Palette, UserCircle, Eye, EyeOff, QrCode,
} from 'lucide-react';

let _pdfLibPromise = null;
const loadPdfLib = () => {
  if (!_pdfLibPromise) _pdfLibPromise = import('jspdf').then(m => m.default);
  return _pdfLibPromise;
};

// '' is meaningful: it means same-origin (nginx proxies /api), so use ?? not ||
// - an UNSET var still falls back to the dev LAN box.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://192.168.100.2:5002';
const BIZ_NAME = (import.meta.env.VITE_BUSINESS_NAME || 'Semivra').toUpperCase();
const socket = io(API_URL, { transports: ['websocket'], upgrade: false });

// ── helpers ───────────────────────────────────────────────────────────────────

const PAYMENT_LABELS = {
  Cash: 'Cash on Delivery',
  'E-Wallet': 'E-Wallet',
  'Bank Transfer': 'Bank Transfer',
  'Credit Card': 'Credit Card',
  'Credit': 'Credit',
};

// Fallback support link. The `portalSupportLink` setting overrides it, so a shop
// can change where clients send payment proof without a rebuild.
const FB_LINK_ENV = import.meta.env.VITE_FB_LINK || '';

// The billing block already configured for this deployment. Portal settings
// override these; unset settings inherit them rather than showing blanks.
const ENV_BILLING = {
  name: import.meta.env.VITE_BILLING_NAME || '',
  address1: import.meta.env.VITE_BILLING_ADDRESS1 || '',
  address2: import.meta.env.VITE_BILLING_ADDRESS2 || '',
  phone: import.meta.env.VITE_BILLING_PHONE || '',
  email: import.meta.env.VITE_BILLING_EMAIL || '',
  bank: import.meta.env.VITE_BILLING_BANK || '',
  accountName: import.meta.env.VITE_BILLING_ACCOUNT_NAME || '',
  accountNo: import.meta.env.VITE_BILLING_ACCOUNT_NO || '',
};

// Client-selectable payment methods - mirrors the POS order tab, minus delivery partners.
const CLIENT_PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet', 'Credit'];

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Map an order's status to a client-facing queue state for the portal sidebar.
// The first step after ordering asks the client to send payment proof on FB.
const STATUS_VIEW = (status) => {
  switch (status) {
    case 'Pending':
      return { label: 'Sent to logistics', tone: 'amber',
        msg: 'Please send your payment proof so we can process your order.', needsProof: true };
    case 'Preparing':
      return { label: 'Preparing order', tone: 'blue', msg: 'Payment received - your order is being prepared.' };
    case 'Partially Fulfilled':
      return { label: 'Partially fulfilled', tone: 'blue', msg: 'Some items are ready; the rest will follow.' };
    case 'Out for Delivery':
      return { label: 'Out for delivery', tone: 'blue', msg: 'Your order is on the way.' };
    // "Ready for pickup" is only true while the order is still WAITING to be
    // collected. Once it's been handed over, saying so contradicts the fully
    // filled progress rail - these are terminal states, so name them.
    case 'Awaiting Pickup':
      return { label: 'Ready for pickup', tone: 'blue', msg: 'Your order is ready for pickup.' };
    case 'Delivered':
      return { label: 'Delivered', tone: 'green', msg: 'Your order has been delivered.', canConfirm: true };
    case 'Picked Up':
      return { label: 'Picked up', tone: 'green', msg: 'Your order has been picked up.', canConfirm: true };
    case 'Completed':
      return { label: 'Completed', tone: 'green', msg: 'This order is complete. Thank you!', canConfirm: true };
    case 'Cancelled':
      return { label: 'Cancelled', tone: 'red', msg: 'This order was cancelled.' };
    case 'Voided':
    case 'Refunded':
      return { label: status, tone: 'red', msg: `This order was ${String(status).toLowerCase()}.` };
    default:
      return { label: status || 'Processing', tone: 'gray', msg: '' };
  }
};

// Progress rail on the slip. Cancelled/voided orders leave the happy path, so
// they render as a single terminal step instead of a half-filled timeline.
const SLIP_STEPS = ['Ordered', 'Payment confirmed', 'Preparing', 'On the way', 'Completed'];
const STEP_INDEX = {
  Pending: 0,
  Preparing: 2, 'Partially Fulfilled': 2,
  'Out for Delivery': 3, 'Awaiting Pickup': 3,
  Delivered: 4, 'Picked Up': 4, Completed: 4,
};
const isTerminated = (s) => ['Cancelled', 'Voided', 'Refunded'].includes(s);

// Filter chips group the portal's many granular statuses into the 4 buckets a
// client actually cares about: still moving, partially done, cancelled, or done.
const FILTER_BUCKETS = [
  { key: 'all',       label: 'All',                statuses: null },
  { key: 'sent',      label: 'Sent',                statuses: ['Pending', 'Preparing', 'Out for Delivery', 'Awaiting Pickup'] },
  { key: 'partial',   label: 'Partially Fulfilled', statuses: ['Partially Fulfilled'] },
  { key: 'complete',  label: 'Complete',            statuses: ['Completed', 'Delivered', 'Picked Up'] },
  { key: 'cancelled', label: 'Cancelled',           statuses: ['Cancelled', 'Voided', 'Refunded'] },
];

const TONE_CLS = {
  amber: 'bg-amber-500 border-amber-500 text-white',
  blue:  'bg-blue-500 border-blue-500 text-white',
  green: 'bg-emerald-500 border-emerald-500 text-white',
  red:   'bg-red-500 border-red-500/30 text-white',
  gray:  'bg-white border-white text-black',
};

const ProductCard = memo(({ product, onAdd, showPrices }) => {
  // Unorderable when staff 86'd it OR the linked stock is depleted (stockAvailable).
  const unavailable = product.isAvailable === false || product.stockAvailable === false;
  const discount = (product.effectiveDiscountPercent ?? product.discountPercent) || 0;
  const base = Number(product.basePrice || 0);
  // Sale price from active sales takes priority over client discount percent
  const hasSale = product.activeSalePrice != null;
  const net = hasSale ? Number(product.activeSalePrice) : base * (1 - discount / 100);
  return (
  <div
    onClick={() => !unavailable && onAdd(product)}
    className={`bg-sidebar-bg rounded-2xl border p-3 transition-all duration-150 group relative
      ${unavailable
        ? 'border-white/5 opacity-50 cursor-not-allowed'
        : 'border-white/5 hover:border-brand/30 cursor-pointer active:scale-[0.97]'}`}
  >
    {/* Product image - only present when the "Product Images" setting is on
        (the server strips product.image for customers when disabled). */}
    <div className="w-full h-24 sm:h-28 mb-2.5 rounded-xl flex items-center justify-center overflow-hidden" style={{ background: 'color-mix(in srgb, currentColor 6%, transparent)' }}>
      {product.image
        ? <img src={product.image} alt={product.name} loading="lazy" className="w-full h-full object-contain p-2" style={{ filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.55))' }} />
        : <Package size={32} className="opacity-20" />}
    </div>
    <div className="flex items-start justify-between gap-2">
      <h3 className="font-bold text-fg text-[13px] sm:text-sm leading-snug">{product.name}</h3>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {hasSale && <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-orange-500 text-white">Sale</span>}
        <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${unavailable ? 'bg-white border-white text-fg' : 'bg-emerald-400 border-emerald-400 text-white'}`}>
          {unavailable ? 'Out of Stock' : 'In Stock'}
        </span>
      </div>
    </div>
    {product.description && <p className="text-fg/40 text-xs mt-1 line-clamp-2">{product.description}</p>}
    <div className="flex items-center justify-between gap-2 mt-3">
      {showPrices ? (
        <div className="min-w-0">
          <p className={`font-black text-sm leading-none ${hasSale ? 'text-orange-400' : 'text-fg'}`}>{peso(net)}</p>
          {(hasSale || discount > 0) && (
            <p className="text-fg/30 text-[10px] line-through mt-0.5">{peso(base)}</p>
          )}
        </div>
      ) : (
        <p className="text-fg/40 font-black text-[11px] uppercase tracking-wider">Inquire price</p>
      )}
      {!unavailable && (
        <button
          onClick={e => { e.stopPropagation(); onAdd(product); }}
          className="w-10 h-10 shrink-0 bg-brand rounded-xl flex items-center justify-center shadow-lg shadow-brand/40 hover:bg-brand-dark transition active:scale-90"
          aria-label={`Add ${product.name}`}
        >
          <Plus size={19} className="text-white" strokeWidth={2.5} />
        </button>
      )}
    </div>
  </div>
  );
});
ProductCard.displayName = 'ProductCard';

// ── main component ────────────────────────────────────────────────────────────

export default function ClientOrderPage() {
  const navigate = useNavigate();

  // Auth
  const [clientInfo, setClientInfo] = useState(null);
  const [token, setToken] = useState('');
  // Guards the draft-save effect: without it the first render (empty cart) would
  // overwrite the draft we're about to restore.
  const draftReady = useRef(false);

  // Portal customization (admin-editable copy/branding, read from a public route)
  const [portal, setPortal] = useState({});

  // Products
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [productSearch, setProductSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Cart
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);

  // Order state
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successOrder, setSuccessOrder] = useState(null);
  const [showQr, setShowQr] = useState(false);

  // Order status queue (portal sidebar)
  const [myOrders, setMyOrders] = useState([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);   // mobile hamburger menu
  const [orderFilter, setOrderFilter] = useState('all');
  const [slipOrder, setSlipOrder] = useState(null);        // order shown in the PO-slip popup
  const [slipDownloading, setSlipDownloading] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(true);

  // Client's own account settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(cachedClientTheme);
  const [nameForm, setNameForm] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '', show: false });
  const [pwBusy, setPwBusy] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState(null);   // { tone, text }

  // ── Derived portal config ───────────────────────────────────────────────────
  // Every field falls back to the deployment's env before falling back to a
  // generic default, so a fresh install already shows the right company details
  // on the slip without an admin having to retype what's in .env.
  const pick = (...vals) => {
    for (const v of vals) { const s = String(v ?? '').trim(); if (s) return s; }
    return '';
  };
  const supportLink = pick(portal.portalSupportLink, FB_LINK_ENV);
  const supportLabel = pick(portal.portalSupportLabel, 'Send payment proof');
  const showPrices = portal.portalShowPrices === true;
  const allowNotes = portal.portalAllowNotes !== false;
  const companyName = pick(portal.portalCompanyName, ENV_BILLING.name, BIZ_NAME);
  const companyAddress = pick(
    portal.portalCompanyAddress,
    [ENV_BILLING.address1, ENV_BILLING.address2].filter(Boolean).join(', '),
  );
  const companyPhone = pick(portal.portalCompanyPhone, ENV_BILLING.phone);
  const companyEmail = pick(portal.portalCompanyEmail, ENV_BILLING.email);
  const slipFooter = pick(portal.portalSlipFooter,
    'Final total is confirmed by our team - this slip is a reference only.');
  const paymentInstructions = pick(
    portal.portalPaymentInstructions,
    // Nothing configured? Fall back to the bank details already in .env.
    ENV_BILLING.bank && ENV_BILLING.accountNo
      ? `${ENV_BILLING.bank} · ${ENV_BILLING.accountName || companyName} · ${ENV_BILLING.accountNo}`
      : '',
  );
  const welcomeTitle = pick(portal.portalWelcomeTitle, 'Welcome back');
  const welcomeMessage = pick(portal.portalWelcomeMessage,
    'Browse the catalogue and send us your order. Our team confirms pricing before dispatch.');

  // On mount: restore session + any in-progress draft
  useEffect(() => {
    const session = loadSession();
    if (!session) { navigate('/client/portal', { replace: true }); return; }

    const { token: storedToken, info } = session;
    setToken(storedToken);
    setClientInfo(info);

    // Apply the client's OWN theme immediately from the cached value (no flash),
    // then from their account once the profile fetch lands. Never reads the
    // staff `dash.theme` - see clientTheme.js.
    applyClientTheme(info.theme || cachedClientTheme());

    // Restore the draft BEFORE falling back to the client's default payment
    // method, so a refresh mid-checkout keeps whatever they had picked.
    const draft = loadDraft(info);
    if (draft) {
      setCart(Array.isArray(draft.cart) ? draft.cart : []);
      setOrderNotes(typeof draft.orderNotes === 'string' ? draft.orderNotes : '');
      if (draft.activeCategory) setActiveCategory(draft.activeCategory);
      if (draft.cartOpen) setCartOpen(true);
      if (draft.successOrder) setSuccessOrder(draft.successOrder);
    }
    const preset = draft?.paymentMethod || info.paymentMethod;
    setPaymentMethod(CLIENT_PAYMENT_METHODS.includes(preset) ? preset : 'Cash');

    draftReady.current = true;
  }, [navigate]);

  // Persist the draft on every change so a refresh, an app switch, or a killed
  // tab never costs the client their basket.
  useEffect(() => {
    if (!draftReady.current || !clientInfo) return;
    saveDraft(clientInfo, { cart, paymentMethod, orderNotes, activeCategory, cartOpen, successOrder });
  }, [clientInfo, cart, paymentMethod, orderNotes, activeCategory, cartOpen, successOrder]);

  // Portal customization - public route, no token needed.
  useEffect(() => {
    fetch(`${API_URL}/api/public/portal-settings`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.success) setPortal(d.settings || {}); })
      .catch(() => { /* fall back to defaults */ });
  }, []);

  // Keep the copy live when an admin edits it while a client is on the page.
  useEffect(() => {
    const LIVE_KEYS = new Set(['paymentQrImage', 'businessLogo', 'logoColor', 'logoRadius']);
    const onSettings = ({ key, value }) => {
      if (key && (key.startsWith('portal') || LIVE_KEYS.has(key))) setPortal(p => ({ ...p, [key]: value }));
    };
    socket.on('settingsUpdated', onSettings);
    return () => socket.off('settingsUpdated', onSettings);
  }, []);

  // Fetch products
  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const [prodRes, catRes] = await Promise.all([
        fetch(`${API_URL}/api/products`),
        fetch(`${API_URL}/api/categories`),
      ]);
      const prodData = await prodRes.json();
      const catData = await catRes.json();
      setProducts((prodData.products || []).filter(p => !p.isArchived));
      setCategories(catData.categories || []);
    } catch { /* silently retry on socket event */ }
    finally { setLoadingProducts(false); }
  }, []);

  useEffect(() => { if (token) fetchProducts(); }, [token, fetchProducts]);

  // Real-time menu refresh
  useEffect(() => {
    socket.on('menuUpdated', fetchProducts);
    return () => socket.off('menuUpdated', fetchProducts);
  }, [fetchProducts]);

  // Client's own orders → status queue sidebar
  const fetchMyOrders = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/client/orders`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setMyOrders(data.orders || []);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { if (token) fetchMyOrders(); }, [token, fetchMyOrders]);

  const confirmReceived = useCallback(async (orderId) => {
    try {
      const res = await fetch(`${API_URL}/api/client/orders/${orderId}/received`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) fetchMyOrders();
      else ui.alert(data.error || 'Could not confirm.');
    } catch { ui.alert('Network error.'); }
  }, [token, fetchMyOrders]);

  // Cancel a still-pending (unpaid) order from the portal.
  const cancelOrder = useCallback(async (orderId) => {
    if (!(await ui.confirm('Cancel this order? This cannot be undone.'))) return;
    try {
      const res = await fetch(`${API_URL}/api/client/orders/${orderId}/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) { setSlipOrder(null); fetchMyOrders(); }
      else ui.alert(data.error || 'Could not cancel.');
    } catch { ui.alert('Network error.'); }
  }, [token, fetchMyOrders]);

  // Live updates: refresh the queue whenever any order changes, + gentle poll.
  useEffect(() => {
    if (!token) return;
    const refresh = () => fetchMyOrders();
    socket.on('orderUpdated', refresh);
    socket.on('erpUpdated', refresh);
    const iv = setInterval(refresh, 30000);
    return () => { socket.off('orderUpdated', refresh); socket.off('erpUpdated', refresh); clearInterval(iv); };
  }, [token, fetchMyOrders]);

  // Keep an open slip in sync with the live order list - otherwise a status
  // change behind the modal leaves the client reading a stale slip.
  useEffect(() => {
    if (!slipOrder) return;
    const fresh = myOrders.find(o => o._id === slipOrder._id);
    if (fresh && fresh !== slipOrder) setSlipOrder(fresh);
  }, [myOrders, slipOrder]);

  // Active orders still in the pipeline (exclude finished/cancelled from the badge count).
  const activeOrders = useMemo(
    () => myOrders.filter(o => !['Completed', 'Delivered', 'Picked Up', 'Cancelled', 'Voided', 'Refunded'].includes(o.status)),
    [myOrders]
  );

  const filteredOrders = useMemo(() => {
    const bucket = FILTER_BUCKETS.find(b => b.key === orderFilter);
    if (!bucket || !bucket.statuses) return myOrders;
    return myOrders.filter(o => bucket.statuses.includes(o.status));
  }, [myOrders, orderFilter]);

  // A PLACED order's line discount lives in TWO fields: productDiscountPercent
  // (the server-resolved client/segment/price-tier rate, set at order creation)
  // and discountPercent (a separate cashier-typed override on an existing
  // order, added later by staff). The server's own math takes whichever is
  // higher (see validateOrderMath) - reading only `discountPercent` here
  // showed a tiered client the full undiscounted price even though the order
  // total they were actually charged already had the tier rate applied.
  const lineDiscPct = (it) => Math.max(Number(it.productDiscountPercent || 0), Number(it.discountPercent || 0));

  const orderTotal = useCallback((order) => (order?.items || []).reduce(
    (s, i) => s + Number(i.price || 0) * (1 - lineDiscPct(i) / 100) * Number(i.quantity || 0), 0
  ), []);

  // Renders the slip using the SAME shared A4 document template as the staff-side
  // order slip / billing statement, so the client's copy is the identical layout.
  // Letterhead/terms/deposit all come from the portal settings.
  const downloadOrderSlip = useCallback(async (order) => {
    setSlipDownloading(true);
    try {
      const items = (order.items || []).map((it, idx) => {
        const pct = lineDiscPct(it);
        const unit = Number(it.price || 0) * (1 - pct / 100);
        return {
          code: it.productCode || String(idx + 1),
          desc: String(it.name || '') + (pct > 0 ? ` (list ${peso(Number(it.price || 0))}, less ${pct}%)` : ''),
          qty: it.quantity ?? 0,
          unitPrice: unit,
          total: unit * Number(it.quantity || 0),
        };
      });
      printBillingDoc(buildBillingDocHTML({
        docTitle: 'ORDER SLIP',
        dateLabel: 'Placed',
        dateStr: new Date(order.createdAt).toLocaleString(),
        settings: portal,
        metaFields: [
          { label: 'Billed To', value: clientInfo?.name || clientInfo?.username || 'Client' },
          { label: 'Client Code', value: clientInfo?.clientCode || '' },
          { label: 'Order No.', value: order.orderNumber },
        ],
        subFields: [
          { label: 'Status', value: STATUS_VIEW(order.status).label },
          ...(order.billingNumber ? [{ label: 'Billing No.', value: order.billingNumber }] : []),
          ...(order.paymentMethod ? [{ label: 'Payment', value: order.paymentMethod }] : []),
        ],
        schedRows: order.orderNotes ? [{ label: 'Notes:', value: order.orderNotes }] : [],
        items,
        totals: [{ label: 'TOTAL', value: orderTotal(order), grand: true }],
      }));
    } catch {
      ui.alert('Could not generate the slip. Please try again.');
    } finally {
      setSlipDownloading(false);
    }
  }, [portal, clientInfo, orderTotal]);

  // Cart helpers
  const addToCart = useCallback((product) => {
    if (product.isAvailable === false || product.stockAvailable === false) return;
    setCart(prev => {
      const idx = prev.findIndex(i => i.productId === String(product._id));
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        return updated;
      }
      return [...prev, {
        productId: String(product._id),
        name: product.name,
        productCode: product.productCode,
        price: product.basePrice,
        // effectiveDiscountPercent reflects the per-client override (when applicable);
        // falls back to the product default if there's no override.
        discountPercent: (product.effectiveDiscountPercent ?? product.discountPercent) || 0,
        quantity: 1,
        selectedAddOns: [],
      }];
    });
  }, []);

  const changeQty = useCallback((productId, delta) => {
    setCart(prev => prev
      .map(i => i.productId === productId ? { ...i, quantity: i.quantity + delta } : i)
      .filter(i => i.quantity > 0));
  }, []);

  const netPrice = (i) => (i.price || 0) * (1 - (i.discountPercent || 0) / 100);
  const cartTotal = useMemo(() => cart.reduce((s, i) => s + netPrice(i) * i.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);

  const visibleProducts = useMemo(() => {
    // Raw material, no SRP (basePrice <= 0) - stock the admin tracks but never sells.
    let active = products.filter(p => !p.isArchived && (p.basePrice || 0) > 0);
    if (activeCategory === 'Bulk') active = active.filter(p => p.isBulk);
    else if (activeCategory !== 'All') active = active.filter(p => p.category === activeCategory);
    const q = productSearch.trim().toLowerCase();
    if (q) active = active.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.productCode?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
    return active;
  }, [products, activeCategory, productSearch]);

  const handleLogout = () => {
    clearSession();      // also drops this client's saved draft
    clearClientTheme();  // next client on this device starts from the default
    navigate('/client/portal', { replace: true });
  };

  // ── Client account settings ─────────────────────────────────────────────────
  const authHeaders = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token]
  );

  // Pull the authoritative profile when the panel opens, so a theme changed on
  // another device shows up here rather than the stale login snapshot.
  useEffect(() => {
    if (!settingsOpen || !token) return;
    setSettingsMsg(null);
    fetch(`${API_URL}/api/client/profile`, { headers: authHeaders })
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        setNameForm(d.profile.username || '');
        const t = applyClientTheme(d.profile.theme || cachedClientTheme());
        setTheme(t);
        setClientInfo(prev => {
          const merged = { ...prev, ...d.profile };
          saveSession(token, merged);   // keep the cached session in step
          return merged;
        });
      })
      .catch(() => { /* panel still usable offline */ });
  }, [settingsOpen, token, authHeaders]);

  const chooseTheme = useCallback(async (value) => {
    const applied = applyClientTheme(value);   // optimistic: instant feedback
    setTheme(applied);
    try {
      const res = await fetch(`${API_URL}/api/client/profile`, {
        method: 'PATCH', headers: authHeaders, body: JSON.stringify({ theme: applied }),
      });
      const d = await res.json();
      if (!d.success) { setSettingsMsg({ tone: 'bad', text: d.error || 'Could not save the theme.' }); return; }
      setClientInfo(prev => { const m = { ...prev, theme: applied }; saveSession(token, m); return m; });
      setSettingsMsg({ tone: 'ok', text: 'Appearance saved to your account.' });
    } catch {
      setSettingsMsg({ tone: 'bad', text: 'Saved on this device only - network error.' });
    }
  }, [authHeaders, token]);

  const saveUsername = useCallback(async () => {
    const next = nameForm.trim().toLowerCase();
    if (!next || next === (clientInfo?.username || '')) return;
    setNameBusy(true); setSettingsMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/client/profile`, {
        method: 'PATCH', headers: authHeaders, body: JSON.stringify({ username: next }),
      });
      const d = await res.json();
      if (!d.success) { setSettingsMsg({ tone: 'bad', text: d.error || 'Could not change the username.' }); return; }
      setClientInfo(prev => { const m = { ...prev, ...d.profile }; saveSession(token, m); return m; });
      setNameForm(d.profile.username);
      setSettingsMsg({ tone: 'ok', text: 'Username updated. Use it next time you sign in.' });
    } catch {
      setSettingsMsg({ tone: 'bad', text: 'Network error.' });
    } finally { setNameBusy(false); }
  }, [nameForm, clientInfo, authHeaders, token]);

  const savePassword = useCallback(async () => {
    if (pwForm.next !== pwForm.confirm) {
      setSettingsMsg({ tone: 'bad', text: 'The two new passwords do not match.' });
      return;
    }
    setPwBusy(true); setSettingsMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/client/password`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      const d = await res.json();
      if (!d.success) { setSettingsMsg({ tone: 'bad', text: d.error || 'Could not change the password.' }); return; }
      setPwForm({ current: '', next: '', confirm: '', show: false });
      setSettingsMsg({ tone: 'ok', text: 'Password changed. Your current session stays signed in.' });
    } catch {
      setSettingsMsg({ tone: 'bad', text: 'Network error.' });
    } finally { setPwBusy(false); }
  }, [pwForm, authHeaders]);

  const handleSubmitOrder = async () => {
    if (!cart.length || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          items: cart,
          table: 'Client Order',
          customerName: clientInfo?.name || clientInfo?.username || 'Client',
          paymentMethod,
          orderNotes: orderNotes.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessOrder(data.order);
        setCart([]);
        setCartOpen(false);
        setOrderNotes('');
        fetchMyOrders();
      } else {
        ui.alert(data.error || 'Order failed. Please try again.');
      }
    } catch {
      ui.alert('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Support CTA, reused across the success screen, the queue and the cart.
  const SupportLink = ({ label = supportLabel, className = '' }) => (supportLink ? (
    <a href={supportLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
      className={`inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 transition rounded-lg px-3 py-1.5 text-[11px] font-black text-fg ${className}`}>
      {label} →
    </a>
  ) : null);

  // ── Success screen ──────────────────────────────────────────────────────────
  if (successOrder) {
    return (
      <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center p-4 sm:p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
          <CheckCircle size={32} className="text-emerald-400" />
        </div>
        <h2 className="text-2xl font-black text-fg mb-1">Sent to Logistics!</h2>
        <p className="text-fg/50 text-sm mb-3">Your order has been received.</p>
        {/* POS reference - show this to staff so they can pull up the same order. */}
        <div className="bg-page-bg border border-brand/30 rounded-2xl px-4 py-3 mb-3 w-full max-w-sm">
          <p className="text-[10px] uppercase tracking-widest text-fg/40 font-black mb-1">Order Reference (show to staff)</p>
          <p className="text-brand font-mono font-black text-lg tracking-wider">{successOrder.orderNumber}</p>
          {successOrder.billingNumber && (
            <p className="text-fg/50 text-[11px] font-mono mt-0.5">Billing: <span className="text-fg/80 font-bold">{successOrder.billingNumber}</span></p>
          )}
        </div>

        {/* First queue state: ask for payment proof */}
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-2xl px-4 py-3 w-full max-w-sm mb-5 text-left">
          <p className="text-xs font-black uppercase tracking-wider mb-1">Next step - Payment proof</p>
          <p className="text-[12px] leading-snug opacity-90">
            {paymentInstructions || 'Please send your payment proof so we can start preparing your order.'}
          </p>
          <SupportLink className="mt-2" />
        </div>
        {/* Same rule as the slip: the order exists, so its line prices are known
            and shown. Gating this on showPrices while the slip one tap away
            printed a total made the two screens contradict each other. */}
        <div className="bg-sidebar-bg border border-white/10 rounded-2xl p-5 w-full max-w-sm mb-6 text-left space-y-2">
          {successOrder.items?.map((item, i) => {
            const unit = Number(item.price || 0) * (1 - lineDiscPct(item) / 100);
            return (
              <div key={i} className="flex justify-between gap-3 text-sm">
                <span className="text-fg font-bold min-w-0 truncate">
                  {item.name}
                  <span className="text-fg/40 font-normal font-mono"> ×{item.quantity}</span>
                </span>
                <span className="text-fg/70 font-mono shrink-0 tabular-nums">{peso(unit * Number(item.quantity || 0))}</span>
              </div>
            );
          })}
          <div className="border-t border-white/10 pt-2 flex justify-between items-baseline gap-3">
            <span className="text-[11px] font-black uppercase tracking-widest text-fg/40">Total</span>
            <span className="text-fg font-black text-base tabular-nums">{peso(orderTotal(successOrder))}</span>
          </div>
          <p className="text-[11px] text-fg/40 italic">Final total is confirmed by our team.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full max-w-sm">
          <button
            onClick={() => { setSlipOrder(successOrder); }}
            className="flex-1 bg-white/5 hover:bg-white/10 text-fg font-black px-6 py-3 rounded-xl transition uppercase tracking-widest text-xs flex items-center justify-center gap-2"
          >
            <FileText size={14} /> View slip
          </button>
          <button
            onClick={() => setSuccessOrder(null)}
            className="flex-1 bg-brand hover:bg-brand-dark text-white font-black px-6 py-3 rounded-xl transition uppercase tracking-widest text-xs"
          >
            Place Another Order
          </button>
        </div>
        {slipOrder && <OrderSlipModal />}
      </div>
    );
  }

  // ── Order slip modal ────────────────────────────────────────────────────────
  // Declared as a closure so both the success screen and the main UI render the
  // exact same document.
  function OrderSlipModal() {
    const v = STATUS_VIEW(slipOrder.status);
    const terminated = isTerminated(slipOrder.status);
    const stepIdx = STEP_INDEX[slipOrder.status] ?? 0;
    const items = slipOrder.items || [];
    const totalQty = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
    const contact = [companyAddress, companyPhone, companyEmail].filter(Boolean);

    return (
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
        onClick={() => setSlipOrder(null)} role="dialog" aria-modal="true" aria-label="Order slip">
        <div className="bg-sidebar-bg border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-hidden flex flex-col text-left"
          onClick={e => e.stopPropagation()}>

          {/* Sticky close bar - the document itself has no chrome */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/10 flex-shrink-0">
            <p className="font-black text-accent text-[10px] uppercase tracking-widest">Order Slip</p>
            <button onClick={() => setSlipOrder(null)} className="p-2 -mr-2 rounded-xl text-fg/40 hover:text-fg hover:bg-white/10 transition" aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ── The slip, styled as a paper document on a light sheet ── */}
            <div className="bg-white text-neutral-900 m-3 sm:m-4 rounded-xl overflow-hidden shadow-lg">

              {/* Letterhead */}
              <div className="px-5 pt-5 pb-4 border-b-2 border-neutral-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-black text-lg leading-tight truncate">{companyName}</h2>
                    {contact.map((c, i) => (
                      <p key={i} className="text-[10.5px] text-neutral-500 leading-snug">{c}</p>
                    ))}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-accent">Order Slip</p>
                    <p className="font-mono font-black text-sm mt-0.5">{slipOrder.orderNumber}</p>
                    <span className={`inline-block mt-1.5 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      terminated ? 'bg-red-100 text-red-700'
                      : stepIdx >= 4 ? 'bg-emerald-100 text-emerald-700'
                      : slipOrder.status === 'Partially Fulfilled' ? 'bg-blue-100 text-blue-700'
                      : 'bg-amber-100 text-amber-800'}`}>
                      {v.label}
                    </span>
                  </div>
                </div>
              </div>

              {/* Billed to / order meta */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-5 py-4 border-b border-neutral-200">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.15em] text-accent mb-1">Billed to</p>
                  <p className="font-bold text-sm leading-tight">{clientInfo?.name || clientInfo?.username || 'Client'}</p>
                  {clientInfo?.clientCode && <p className="text-[11px] text-accent font-mono">{clientInfo.clientCode}</p>}
                </div>
                <div className="sm:text-right space-y-0.5">
                  <p className="text-[9px] font-black uppercase tracking-[0.15em] text-accent mb-1">Details</p>
                  <p className="text-[11.5px]"><span className="text-accent">Placed </span>{new Date(slipOrder.createdAt).toLocaleString()}</p>
                  {slipOrder.billingNumber && (
                    <p className="text-[11.5px]"><span className="text-accent">Billing </span><span className="font-mono">{slipOrder.billingNumber}</span></p>
                  )}
                  {slipOrder.paymentMethod && (
                    <p className="text-[11.5px]"><span className="text-accent">Payment </span>{PAYMENT_LABELS[slipOrder.paymentMethod] || slipOrder.paymentMethod}</p>
                  )}
                </div>
              </div>

              {/* Status + progress rail */}
              <div className="px-5 py-4 border-b border-neutral-200">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${
                    terminated ? 'bg-red-100 text-red-700'
                    : stepIdx >= 4 ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-800'}`}>
                    {v.label}
                  </span>
                </div>
                {/* Each step owns an equal-width cell with the dot dead centre
                    and its label centred beneath. The connector is split into
                    two halves per cell (hidden at the two outer ends) so the
                    track meets each dot instead of trailing off one side. */}
                {terminated ? (
                  <p className="text-[11.5px] text-accent">{v.msg}</p>
                ) : (
                  <ol className="flex items-start gap-0">
                    {SLIP_STEPS.map((s, i) => {
                      const done = i <= stepIdx;
                      const track = (filled) => filled ? 'bg-neutral-900' : 'bg-neutral-200';
                      return (
                        <li key={s} className="flex-1 min-w-0">
                          <div className="flex items-center">
                            <span className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : track(i <= stepIdx)}`} />
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${done ? 'bg-neutral-900' : 'bg-neutral-300'}`} />
                            <span className={`h-0.5 flex-1 ${i === SLIP_STEPS.length - 1 ? 'bg-transparent' : track(i < stepIdx)}`} />
                          </div>
                          <p className={`text-[8.5px] leading-tight mt-1.5 px-0.5 text-center ${done ? 'text-neutral-900 font-bold' : 'text-neutral-400'}`}>{s}</p>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {/* Partial dispatch: the rail sits at Preparing, so spell out that
                    some units are already out while the rest are still being prepared,
                    otherwise the timeline looks stuck and contradicts the badge. */}
                {slipOrder.status === 'Partially Fulfilled' && (() => {
                  const doneU = (slipOrder.items || []).reduce((s, it) => s + (it.fulfilledQty || 0), 0);
                  const totU  = (slipOrder.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
                  return (
                    <p className="text-[11px] font-bold text-blue-600 mt-2.5 flex items-center gap-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
                      Partial dispatch - {doneU} of {totU} unit{totU === 1 ? '' : 's'} delivered; the rest are being prepared.
                    </p>
                  );
                })()}
              </div>

              {/* Item table.
                  Prices are ALWAYS itemised here, regardless of portalShowPrices.
                  That setting governs the CATALOGUE, where a rate isn't agreed yet
                  ("Inquire price"); by the time an order exists its line prices are
                  recorded on the order itself, so the slip can state what was
                  charged. The footer still notes the team confirms the final total. */}
              <div className="px-5 py-4">
                <div className="grid gap-2 pb-2 mb-2 border-b border-neutral-300 text-[9px] font-black uppercase tracking-[0.12em] text-accent grid-cols-[1rem_1fr_2.75rem_4.25rem_1.75rem_4.5rem]">
                  <span>#</span>
                  <span>Item</span>
                  <span className="text-right">Unit</span>
                  <span className="text-right">SRP</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Amount</span>
                </div>
                {items.length === 0 && <p className="text-[11.5px] text-accent italic py-2">No items on this order.</p>}
                {items.map((item, i) => {
                  const gross = Number(item.price || 0);
                  const pct = lineDiscPct(item);
                  // The unit selling price IS the SRP for these items; it now has its
                  // own column, so the old "₱x each" sub-line under the name is gone.
                  const unit = gross * (1 - pct / 100);
                  // Pack/unit label (e.g. "1kg", "150g") derived server-side from the
                  // linked INVENTORY item (packSize + display unit) and returned on the
                  // product. Looked up live, so it also covers older orders. Falls back
                  // to the product's own base size for anything without a stock link.
                  const prod = products.find(p => (item.productCode && p.productCode === item.productCode) || (item.productId && String(p._id) === String(item.productId)));
                  const sizeLabel = (prod?.unitLabel || prod?.baseSize || '').trim();
                  return (
                    <div key={i} className="grid gap-2 py-2 border-b border-neutral-100 text-[12px] items-start grid-cols-[1rem_1fr_2.75rem_4.25rem_1.75rem_4.5rem]">
                      <span className="text-accent tabular-nums">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="font-semibold block leading-snug break-words">{item.name}</span>
                        {item.productCode && <span className="text-[10px] text-accent font-mono">{item.productCode}</span>}
                        {pct > 0 && (
                          <span className="text-[10px] text-accent block">
                            <span className="line-through">{peso(gross)}</span> <span className="font-bold">-{pct}%</span>
                          </span>
                        )}
                        {slipOrder.status === 'Partially Fulfilled' && (item.fulfilledQty || 0) > 0 && (item.fulfilledQty || 0) < (item.quantity || 0) && (
                          <span className="text-[10px] font-black block mt-0.5">
                            <span className="text-emerald-600">Fulfilled: {item.fulfilledQty}</span>
                            <span className="text-neutral-400"> | </span>
                            <span className="text-amber-600">Remaining: {Math.max(0, (item.quantity || 0) - (item.fulfilledQty || 0))}</span>
                          </span>
                        )}
                        {slipOrder.status === 'Partially Fulfilled' && (item.fulfilledQty || 0) >= (item.quantity || 0) && (item.quantity || 0) > 0 && (
                          <span className="text-[10px] font-black block mt-0.5 text-emerald-600">✓ Fulfilled: {item.quantity}</span>
                        )}
                      </span>
                      <span className="text-right tabular-nums text-accent/80">{sizeLabel || '-'}</span>
                      <span className="text-right tabular-nums">{peso(unit)}</span>
                      <span className="text-right tabular-nums font-semibold">{item.quantity}</span>
                      <span className="text-right tabular-nums font-semibold">{peso(unit * Number(item.quantity || 0))}</span>
                    </div>
                  );
                })}

                {/* Totals */}
                <div className="flex items-baseline justify-between gap-3 pt-3 mt-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.12em] text-accent">
                    {totalQty} item{totalQty === 1 ? '' : 's'}
                  </span>
                  <span className="text-right">
                    <span className="text-[9px] font-black uppercase tracking-[0.12em] text-accent block leading-none mb-0.5">Total</span>
                    <span className="font-black text-base tabular-nums leading-none">{peso(orderTotal(slipOrder))}</span>
                  </span>
                </div>
              </div>

              {/* Notes & terms */}
              {slipOrder.orderNotes && (
                <div className="px-5 pb-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.15em] text-neutral-400 mb-1">Notes</p>
                  <p className="text-[11.5px] text-neutral-600 leading-snug whitespace-pre-line">{slipOrder.orderNotes}</p>
                </div>
              )}
              <div className="px-5 py-3 bg-neutral-50 border-t border-neutral-200">
                <p className="text-[10.5px] text-neutral-500 italic leading-snug">{slipFooter}</p>
              </div>
            </div>

            {/* Actions that belong to the portal, not the document */}
            <div className="px-4 sm:px-5 pb-4 space-y-2">
              {STATUS_VIEW(slipOrder.status).needsProof && supportLink && (
                <SupportLink className="w-full justify-center py-2.5" />
              )}
              {STATUS_VIEW(slipOrder.status).canConfirm && !slipOrder.clientReceived && (
                <button onClick={() => confirmReceived(slipOrder._id)}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 transition rounded-xl px-3 py-2.5 text-[11px] font-black text-white uppercase tracking-wider">
                  I received my order
                </button>
              )}
              {slipOrder.status === 'Pending' && (
                <button onClick={() => cancelOrder(slipOrder._id)}
                  className="w-full border border-red-500/30 text-red-300 hover:bg-red-500/10 transition rounded-xl px-3 py-2.5 text-[11px] font-black uppercase tracking-wider">
                  Cancel order
                </button>
              )}
            </div>
          </div>

          <div className="p-3 sm:p-4 border-t border-white/10 flex-shrink-0">
            <button onClick={() => downloadOrderSlip(slipOrder)} disabled={slipDownloading}
              className="w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-60 text-white font-black py-3 rounded-xl transition uppercase tracking-widest text-xs">
              {slipDownloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {slipDownloading ? 'Preparing…' : 'Download Slip (PDF)'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main ordering UI ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-page-bg flex flex-col text-fg">

      {/* QR Payment modal */}
      {showQr && portal.paymentQrImage && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setShowQr(false)}
        >
          <div
            className="bg-sidebar-bg border border-white/10 rounded-2xl p-5 flex flex-col items-center gap-4 max-w-xs w-full"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full">
              <p className="font-bold text-fg text-sm">Scan to Pay</p>
              <button onClick={() => setShowQr(false)} className="text-fg/40 hover:text-fg transition">
                <X size={18} />
              </button>
            </div>
            <img
              src={portal.paymentQrImage}
              alt="Payment QR"
              className="w-full max-w-[220px] rounded-xl object-contain"
            />
            <p className="text-xs text-fg/40 text-center">
              Scan the QR code with GCash, Maya, or your banking app to pay.
            </p>
          </div>
        </div>
      )}

      {/* Header - below `sm` the client name and actions collapse into a
          hamburger so the brand and the cart badge still fit on a 320px screen. */}
      <header className="sticky top-0 z-30 bg-sidebar-bg border-b border-white/5 px-3 sm:px-4 h-14 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {portal.businessLogo
            ? <img src={portal.businessLogo} alt="" className="w-7 h-7 rounded-lg object-cover shrink-0" />
            : <Package size={18} className="text-brand shrink-0" />}
          <span className="font-black text-fg text-xs sm:text-sm uppercase tracking-widest truncate">{companyName}</span>
        </div>

        {/* Desktop / tablet actions */}
        <div className="hidden sm:flex items-center gap-3">
          {clientInfo && (
            <span className="text-fg/40 text-xs max-w-[12rem] truncate">
              {clientInfo.name || clientInfo.username}
            </span>
          )}
          <button
            onClick={() => { setQueueOpen(true); fetchMyOrders(); }}
            className="relative p-2 rounded-xl text-fg/60 hover:text-fg hover:bg-white/10 transition"
            aria-label="My orders"
            title="My orders"
          >
            <Package size={16} />
            {activeOrders.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-brand text-white text-[9px] font-black flex items-center justify-center">
                {activeOrders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-xl text-fg/60 hover:text-fg hover:bg-white/10 transition"
            aria-label="My settings"
            title="My settings"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={handleLogout}
            className="p-2 rounded-xl text-fg/40 hover:text-fg hover:bg-white/10 transition"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(true)}
          className="sm:hidden relative p-2 -mr-1 rounded-xl text-fg/70 hover:text-fg hover:bg-white/10 transition"
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          <Menu size={20} />
          {activeOrders.length > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-brand text-white text-[9px] font-black flex items-center justify-center">
              {activeOrders.length}
            </span>
          )}
        </button>
      </header>

      {/* ── Mobile menu (hamburger) ───────────────────────────────────────────── */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 sm:hidden flex justify-end" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <nav className="w-64 max-w-[80vw] h-full bg-sidebar-bg border-l border-white/10 flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-white/5">
              <div className="min-w-0">
                <p className="text-fg font-black text-xs uppercase tracking-widest truncate">{clientInfo?.name || clientInfo?.username || 'Client'}</p>
                {clientInfo?.clientCode && <p className="text-fg/30 text-[10px] font-mono truncate">{clientInfo.clientCode}</p>}
              </div>
              <button onClick={() => setMenuOpen(false)} className="p-2 -mr-2 rounded-xl text-fg/40 hover:text-fg hover:bg-white/10 transition" aria-label="Close menu">
                <X size={16} />
              </button>
            </div>
            <div className="p-3 space-y-1.5">
              <button
                onClick={() => { setMenuOpen(false); setQueueOpen(true); fetchMyOrders(); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold text-fg/70 hover:text-fg hover:bg-white/5 transition"
              >
                <Package size={16} /> My orders
                {activeOrders.length > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[10px] font-black flex items-center justify-center">
                    {activeOrders.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setMenuOpen(false); setCartOpen(true); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold text-fg/70 hover:text-fg hover:bg-white/5 transition"
              >
                <ShoppingCart size={16} /> Your order
                {cartCount > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[10px] font-black flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </button>
              {supportLink && (
                <a href={supportLink} target="_blank" rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold text-fg/70 hover:text-fg hover:bg-white/5 transition">
                  <CreditCard size={16} /> {supportLabel}
                </a>
              )}
              <button
                onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold text-fg/70 hover:text-fg hover:bg-white/5 transition"
              >
                <Settings size={16} /> My settings
              </button>
            </div>
            <div className="mt-auto p-3 border-t border-white/5">
              <button
                onClick={() => { setMenuOpen(false); handleLogout(); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold text-red-300 hover:bg-red-500/10 transition"
              >
                <LogOut size={16} /> Sign out
              </button>
            </div>
          </nav>
        </div>
      )}

      {/* ── Order status queue (sidebar drawer) ───────────────────────────────── */}
      {queueOpen && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="My orders">
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setQueueOpen(false)} />
          <aside className="w-full max-w-sm h-full bg-sidebar-bg border-l border-white/10 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-4 h-14 border-b border-white/5 flex-shrink-0">
              <h2 className="font-black text-fg text-sm uppercase tracking-widest flex items-center gap-2">
                <Package size={16} className="text-brand" /> My Orders
              </h2>
              <button onClick={() => setQueueOpen(false)} className="p-2 rounded-xl text-fg/40 hover:text-fg hover:bg-white/10 transition" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            {/* Filter chips - group the many granular statuses into what a client
                actually asks about: still moving, partial, cancelled, or done. */}
            <div className="flex gap-1.5 px-4 py-2.5 overflow-x-auto scrollbar-hide custom-scrollbar border-b border-white/5 flex-shrink-0">
              {FILTER_BUCKETS.map(b => (
                <button key={b.key} onClick={() => setOrderFilter(b.key)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition flex-shrink-0
                    ${orderFilter === b.key ? 'bg-brand text-white' : 'bg-white/5 text-fg/50 hover:text-fg'}`}>
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {myOrders.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-center">
                  <Package size={36} className="text-fg/10 mb-3" />
                  <p className="text-fg/40 text-sm font-bold">No orders yet.</p>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-center">
                  <Package size={36} className="text-fg/10 mb-3" />
                  <p className="text-fg/40 text-sm font-bold">No orders in this filter.</p>
                </div>
              ) : filteredOrders.map(o => {
                const v = STATUS_VIEW(o.status);
                return (
                  <div key={o._id} onClick={() => setSlipOrder(o)}
                    className="bg-page-bg border border-white/10 rounded-2xl p-4 cursor-pointer hover:border-brand/30 transition">
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <span className="font-mono text-xs text-brand font-black tracking-wider">{o.orderNumber}</span>
                        {o.billingNumber && (
                          <span className="font-mono text-[10px] text-fg/40">Billing: {o.billingNumber}</span>
                        )}
                      </div>
                      <span className="text-fg/30 text-[10px] font-black uppercase tracking-wider shrink-0 inline-flex items-center gap-1">
                        <FileText size={11} /> View slip
                      </span>
                    </div>
                    <div className={`rounded-xl border px-3 py-2 ${TONE_CLS[v.tone] || TONE_CLS.gray}`}>
                      <p className="text-xs font-black uppercase tracking-wider">{v.label}</p>
                      {v.msg && <p className="text-[11px] mt-1 leading-snug opacity-90">{v.msg}</p>}
                      {v.needsProof && <SupportLink className="mt-2" />}
                      {v.canConfirm && (
                        o.clientReceived ? (
                          <p className="mt-2 text-[11px] font-black inline-flex items-center gap-1.5"><CheckCircle size={13} /> Received - thank you!</p>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); confirmReceived(o._id); }}
                            className="mt-2 w-full bg-emerald-500 hover:bg-emerald-400 transition rounded-lg px-3 py-2 text-[11px] font-black text-fg uppercase tracking-wider">
                            I received my order
                          </button>
                        )
                      )}
                    </div>
                    {o.status === 'Pending' && (
                      <button onClick={e => { e.stopPropagation(); cancelOrder(o._id); }}
                        className="mt-2 w-full border border-red-500/30 text-red-300 hover:bg-red-500/10 transition rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-wider">
                        Cancel order
                      </button>
                    )}
                    <div className="mt-2 text-[10px] text-fg/30">
                      {(o.items || []).reduce((s, i) => s + (i.quantity || 0), 0)} item(s) · {new Date(o.createdAt).toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      )}

      {/* ── PO Slip popup ─────────────────────────────────────────────────────── */}
      {slipOrder && <OrderSlipModal />}

      {/* ── Client account settings ───────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setSettingsOpen(false)} role="dialog" aria-modal="true" aria-label="My settings">
          <div className="bg-sidebar-bg border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[92vh] sm:max-h-[88vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
              <h2 className="font-black text-fg text-sm uppercase tracking-widest flex items-center gap-2">
                <Settings size={15} className="text-brand" /> My settings
              </h2>
              <button onClick={() => setSettingsOpen(false)} className="p-2 -mr-2 rounded-xl text-fg/40 hover:text-fg hover:bg-white/10 transition" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {settingsMsg && (
                <p className={`text-xs font-bold rounded-xl px-3 py-2.5 ${settingsMsg.tone === 'ok'
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
                  {settingsMsg.text}
                </p>
              )}

              {/* Account */}
              <section>
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/40 mb-2 flex items-center gap-1.5">
                  <UserCircle size={12} /> Account
                </p>
                <div className="bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-fg/40">Business</span>
                    <span className="text-fg font-bold">{clientInfo?.name}</span>
                  </div>
                  {clientInfo?.clientCode && (
                    <div className="flex justify-between text-xs">
                      <span className="text-fg/40">Client code</span>
                      <span className="text-fg font-mono">{clientInfo.clientCode}</span>
                    </div>
                  )}
                  <div>
                    <label htmlFor="cp-username" className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">Username</label>
                    <div className="flex gap-2">
                      <input id="cp-username" type="text" value={nameForm}
                        onChange={e => setNameForm(e.target.value)}
                        autoComplete="username" spellCheck="false"
                        className="flex-1 min-w-0 bg-white/5 border border-white/10 focus:border-brand text-fg px-3 py-2.5 rounded-xl outline-none transition text-sm" />
                      <button onClick={saveUsername}
                        disabled={nameBusy || !nameForm.trim() || nameForm.trim().toLowerCase() === (clientInfo?.username || '')}
                        className="shrink-0 bg-brand hover:bg-brand-dark disabled:opacity-40 text-white font-black px-4 rounded-xl transition text-xs uppercase tracking-wider">
                        {nameBusy ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                      </button>
                    </div>
                    <p className="text-[10px] text-fg/30 mt-1.5">Letters, digits, dot, dash and underscore. This is what you sign in with.</p>
                  </div>
                </div>
              </section>

              {/* Password */}
              <section>
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/40 mb-2 flex items-center gap-1.5">
                  <KeyRound size={12} /> Password
                </p>
                <div className="bg-page-bg border border-white/10 rounded-xl p-4 space-y-2.5">
                  {[
                    { key: 'current', label: 'Current password', auto: 'current-password' },
                    { key: 'next', label: 'New password', auto: 'new-password' },
                    { key: 'confirm', label: 'Confirm new password', auto: 'new-password' },
                  ].map(f => (
                    <div key={f.key}>
                      <label htmlFor={`cp-pw-${f.key}`} className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">{f.label}</label>
                      <div className="relative">
                        <input id={`cp-pw-${f.key}`} type={pwForm.show ? 'text' : 'password'}
                          value={pwForm[f.key]} autoComplete={f.auto}
                          onChange={e => setPwForm(p => ({ ...p, [f.key]: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg px-3 py-2.5 pr-10 rounded-xl outline-none transition text-sm" />
                        {f.key === 'current' && (
                          <button type="button" onClick={() => setPwForm(p => ({ ...p, show: !p.show }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/70 transition"
                            aria-label={pwForm.show ? 'Hide passwords' : 'Show passwords'}>
                            {pwForm.show ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <button onClick={savePassword}
                    disabled={pwBusy || !pwForm.current || pwForm.next.length < 8}
                    className="w-full mt-1 bg-brand hover:bg-brand-dark disabled:opacity-40 text-white font-black py-2.5 rounded-xl transition text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                    {pwBusy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={13} />}
                    Change password
                  </button>
                  <p className="text-[10px] text-fg/30">At least 8 characters, and different from your current one.</p>
                </div>
              </section>

              {/* Appearance - this client's own, not the shop's */}
              <section>
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/40 mb-2 flex items-center gap-1.5">
                  <Palette size={12} /> Appearance
                </p>
                <div className="bg-page-bg border border-white/10 rounded-xl p-4">
                  <div className="grid grid-cols-2 gap-2">
                    {CLIENT_THEMES.map(t => (
                      <button key={t.value} onClick={() => chooseTheme(t.value)}
                        className={`px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border transition text-left ${
                          theme === t.value
                            ? 'bg-brand text-white border-brand'
                            : 'bg-white/5 text-fg/60 border-white/10 hover:text-fg hover:bg-white/10'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-fg/30 mt-2.5">
                    {CLIENT_THEMES.find(t => t.value === theme)?.hint} · saved to your account, so it follows you to any device.
                    Changing it here never affects anyone else.
                  </p>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Welcome + announcement (admin-editable copy) */}
      {(welcomeTitle || welcomeMessage) && (
        <div className="px-3 sm:px-4 pt-3">
          <div className="bg-sidebar-bg border border-white/10 rounded-2xl px-4 py-3">
            {welcomeTitle && (
              <p className="text-fg font-black text-sm">
                {welcomeTitle}
                {clientInfo && <span className="text-brand">, {clientInfo.name || clientInfo.username}</span>}
              </p>
            )}
            {welcomeMessage && (
              <p className="text-fg/50 text-xs mt-1 leading-snug">{welcomeMessage}</p>
            )}
          </div>
        </div>
      )}
      {portal.portalAnnouncement && announcementOpen && (
        <div className="px-3 sm:px-4 pt-3">
          <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-2xl px-4 py-3">
            <Megaphone size={15} className="shrink-0 mt-0.5" />
            <p className="text-xs leading-snug flex-1">{portal.portalAnnouncement}</p>
            <button onClick={() => setAnnouncementOpen(false)} className="shrink-0 text-amber-200/60 hover:text-amber-100 transition" aria-label="Dismiss announcement">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Product search */}
      <div className="px-3 sm:px-4 pt-3 pb-1 flex-shrink-0">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/30" />
          <input
            type="text"
            value={productSearch}
            onChange={e => setProductSearch(e.target.value)}
            placeholder="Search products by name or code…"
            className="w-full bg-white/5 border border-white/10 focus:border-brand rounded-xl pl-9 pr-9 py-2.5 text-sm text-fg placeholder-fg/30 outline-none transition"
          />
          {productSearch && (
            <button onClick={() => setProductSearch('')} aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg/40 hover:text-fg transition">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 px-3 sm:px-4 py-3 overflow-x-auto scrollbar-hide border-b border-white/5 flex-shrink-0">
        {['All', ...(products.some(p => p.isBulk) ? ['Bulk'] : []), ...categories.map(c => c.name)].map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition flex-shrink-0
              ${activeCategory === cat ? 'bg-brand text-white' : 'bg-white/5 text-fg/50 hover:text-fg'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Product grid - leaves room at the bottom for the cart FAB on mobile */}
      <div className="flex-1 p-3 sm:p-4 pb-28 overflow-y-auto">
        {loadingProducts ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-brand" />
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Package size={40} className="text-fg/10 mb-4" />
            <p className="text-fg/40 font-bold text-sm">
              {productSearch.trim() ? `No products match "${productSearch.trim()}".` : 'No products available.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-3">
            {visibleProducts.map(p => (
              <ProductCard key={p._id} product={p} onAdd={addToCart} showPrices={showPrices} />
            ))}
          </div>
        )}
      </div>

      {/* Cart FAB */}
      {cartCount > 0 && !cartOpen && (
        <div className="fixed bottom-5 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] sm:w-auto max-w-sm">
          <button
            onClick={() => setCartOpen(true)}
            className="w-full flex items-center justify-center gap-3 bg-brand hover:bg-brand-dark text-white font-black px-6 py-3.5 rounded-2xl shadow-2xl shadow-brand/40 transition active:scale-95"
          >
            <ShoppingCart size={18} />
            <span>{cartCount} item{cartCount !== 1 ? 's' : ''}</span>
            {showPrices && <span className="ml-auto tabular-nums">{peso(cartTotal)}</span>}
          </button>
        </div>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page-bg">

          {/* Drawer header */}
          <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 h-14 bg-sidebar-bg border-b border-white/5 flex-shrink-0">
            <button
              onClick={() => setCartOpen(false)}
              className="p-2 rounded-xl text-fg/40 hover:text-fg hover:bg-white/10 transition"
              aria-label="Back"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="font-black text-fg text-sm uppercase tracking-widest">Your Order</h2>
              <p className="text-fg/40 text-xs truncate">{clientInfo?.name || clientInfo?.username}</p>
            </div>
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
            {cart.length === 0 && (
              <div className="flex flex-col items-center py-16 text-center">
                <ShoppingCart size={36} className="text-fg/10 mb-3" />
                <p className="text-fg/40 text-sm font-bold">Your order is empty.</p>
              </div>
            )}
            {cart.map(item => (
              <div key={item.productId} className="flex items-center gap-2 sm:gap-3 bg-sidebar-bg border border-white/5 rounded-xl px-3 sm:px-4 py-3">
                <div className="flex-1 min-w-0">
                  {item.productCode && (
                    <p className="text-fg/30 text-[10px] font-mono uppercase tracking-widest truncate">{item.productCode}</p>
                  )}
                  <p className="font-bold text-fg text-sm truncate">{item.name}</p>
                  {showPrices
                    ? <p className="text-fg/50 text-[11px] tabular-nums">{peso(netPrice(item))} each</p>
                    : <p className="text-fg/30 text-[10px] italic">Price confirmed by our team</p>}
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                  <button
                    onClick={() => changeQty(item.productId, -1)}
                    className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                    aria-label={`Decrease ${item.name}`}
                  >
                    <Minus size={13} />
                  </button>
                  <span className="text-fg font-black text-sm w-6 text-center tabular-nums">{item.quantity}</span>
                  <button
                    onClick={() => changeQty(item.productId, 1)}
                    className="w-8 h-8 rounded-lg bg-brand/20 hover:bg-brand/30 text-brand flex items-center justify-center transition"
                    aria-label={`Increase ${item.name}`}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <p className="text-fg/50 font-black text-[11px] w-16 sm:w-20 text-right flex-shrink-0 tabular-nums">
                  {showPrices ? peso(netPrice(item) * item.quantity) : `×${item.quantity}`}
                </p>
              </div>
            ))}

            {/* Payment method (pre-set, can be changed) */}
            <div className="bg-sidebar-bg border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-fg/40 uppercase tracking-widest">
                <CreditCard size={13} />
                Payment Method
              </div>
              {/* Styled pill grid — groups: In-Store, E-Wallets */}
              {[
                { label: 'In-Store', methods: [['Cash','Cash'],['Bank Transfer','Bank Transfer'],['Credit','Credit']] },
                { label: 'E-Wallets', methods: [['GCash','GCash'],['Maya','Maya'],['Maribank','Maribank / Seabank'],['Other E-Wallet','Other E-Wallet']] },
              ].map(group => (
                <div key={group.label}>
                  <p className="text-[10px] font-bold text-fg/30 uppercase tracking-widest mb-1.5">{group.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {group.methods.map(([val, lbl]) => (
                      <button
                        key={val}
                        onClick={() => setPaymentMethod(val)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                          paymentMethod === val
                            ? 'bg-brand text-white border-brand'
                            : 'bg-white/5 text-fg/60 border-white/10 hover:border-white/30 hover:text-fg'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {/* Pay Now button — only shown when a QR image is uploaded */}
              {portal.paymentQrImage && (
                <button
                  onClick={() => setShowQr(true)}
                  className="w-full mt-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand text-white text-xs font-bold uppercase tracking-wider hover:bg-brand/90 transition"
                >
                  <QrCode size={14} />
                  Pay Now — Scan QR
                </button>
              )}
              {clientInfo?.paymentMethod && clientInfo.paymentMethod !== paymentMethod && (
                <p className="text-xs text-fg/30">
                  Default: {PAYMENT_LABELS[clientInfo.paymentMethod] || clientInfo.paymentMethod}
                  {' '}
                  <button onClick={() => setPaymentMethod(clientInfo.paymentMethod)} className="text-brand underline">Reset</button>
                </p>
              )}
            </div>

            {/* Order notes */}
            {allowNotes && (
              <div className="bg-sidebar-bg border border-white/5 rounded-xl p-4">
                <p className="text-xs font-bold text-fg/40 uppercase tracking-widest mb-2">Order Notes (optional)</p>
                <textarea
                  value={orderNotes}
                  onChange={e => setOrderNotes(e.target.value)}
                  placeholder="Special instructions, delivery notes…"
                  rows={2}
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-3 py-2 rounded-xl outline-none transition text-sm resize-none"
                />
              </div>
            )}
          </div>

          {/* Drawer footer */}
          <div className="p-3 sm:p-4 bg-sidebar-bg border-t border-white/5 flex-shrink-0 space-y-2">
            {showPrices && cart.length > 0 && (
              <div className="flex items-baseline justify-between px-1">
                <span className="text-xs font-black uppercase tracking-widest text-fg/40">Estimated total</span>
                <span className="text-fg font-black text-lg tabular-nums">{peso(cartTotal)}</span>
              </div>
            )}
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2.5 text-[11px] leading-snug">
              <p className="font-black uppercase tracking-wider mb-0.5">Pricing &amp; Payment</p>
              <p className="opacity-90">
                {paymentInstructions
                  || 'Final total will be confirmed by our team. After placing the order, please contact us for payment.'}
              </p>
              <SupportLink label={supportLabel} className="mt-1.5" />
            </div>
            <button
              onClick={handleSubmitOrder}
              disabled={submitting || cart.length === 0}
              className="w-full bg-brand hover:bg-brand-dark text-white font-black py-4 rounded-xl transition shadow-lg shadow-brand/20 uppercase tracking-widest text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              {submitting ? 'Placing Order…' : 'Place Order'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
