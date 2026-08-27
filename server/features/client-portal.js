// client-portal routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { title, lower } from '../lib/normalize.js';

// A credit limit of 0 means "cash only" and must survive as 0, while '' / null
// mean "no limit set". Truthiness would collapse those two into one.
const parseCreditLimit = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[,\s₱]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
// Payment terms in whole days. '' / null clears back to "no terms". Floored to a
// non-negative integer (0 = due on receipt).
const parseTermsDays = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.floor(Number(String(v).replace(/[,\s]/g, '')));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

import { captureError } from '../lib/errorLog.js';

export default function registerClientPortal(ctx) {
  const {
    app,
    io,
    server,
    express,
    http,
    Server,
    cors,
    helmet,
    cookieParser,
    Sentry,
    z,
    mongoose,
    bcrypt,
    jwt,
    compression,
    rateLimit,
    crypto,
    pino,
    pinoHttp,
    assertBalanced,
    debitAccountFor,
    suggestedSettleAccount,
    ACCOUNTS,
    EXPENSE_CATEGORIES,
    CODE_MAP,
    resolveUnit,
    displayToBase,
    effectiveDisplay,
    addBatch,
    consumeBatches,
    soonestExpiry,
    sortBatchesFEFO,
    batchesTotal,
    requireStaff,
    evaluateClientAccess,
    computePercentageTax,
    PERCENTAGE_TAX_RATE,
    validateDateRange,
    log,
    SENTRY_ON,
    IS_PROD,
    BUSINESS_TYPE,
    ENV_ORIGINS,
    allowedOrigins,
    corsOriginCheck,
    mkRef,
    resolveLinkedInventory,
    UNIT_TO_BASE,
    baseUnitsPerSale,
    escapeRegex,
    tenantScope,
    BCRYPT_ROUNDS,
    shiftCashFilter,
    ACCESS_TTL,
    REFRESH_TTL_MS,
    REFRESH_COOKIE,
    signAccessToken,
    hashToken,
    refreshCookieOptions,
    requireTrustedOrigin,
    issueSession,
    revokeUserSessions,
    validate,
    zName,
    zMoney,
    zRole,
    loginSchema,
    userCreateSchema,
    addonSchema,
    zRecipe,
    productSchema,
    comboSchema,
    discountSchema,
    roleSchema,
    modifierGroupSchema,
    mkSeqRef,
    loginLimiter,
    orderLimiter,
    generalApiLimiter,
    runStartupTasks,
    CategorySchema,
    Category,
    ModifierGroupSchema,
    ModifierGroup,
    SettingsSchema,
    Settings,
    TenantSchema,
    Tenant,
    tenantSchema,
    AddOnSchema,
    AddOn,
    ProductSchema,
    Product,
    ComboSchema,
    Combo,
    OrderSchema,
    Order,
    QRSessionSchema,
    QRSession,
    InventorySchema,
    Inventory,
    JournalEntrySchema,
    JournalEntry,
    InventoryMovementSchema,
    InventoryMovement,
    StockCardSchema,
    StockCard,
    ShiftSchema,
    Shift,
    ClockEntrySchema,
    ClockEntry,
    ownerUserIds,
    ownerIdentity,
    logAudit,
    PaymentMethodMapSchema,
    PaymentMethodMap,
    DEFAULT_PAYMENT_ACCOUNT_MAP,
    refreshPaymentMap,
    accountForPaymentMethod,
    ClosedPeriodSchema,
    ClosedPeriod,
    periodLockFor,
    AccountSchema,
    Account,
    BankDepositSchema,
    BankDeposit,
    DEFAULT_ACCOUNTS,
    CUSTOM_META,
    refreshCustomMeta,
    acctMeta,
    UserSchema,
    User,
    ClientAccountSchema,
    ClientAccount,
    RefreshSessionSchema,
    RefreshSession,
    RoleSchema,
    Role,
    AuditLogSchema,
    AuditLog,
    DiscountSchema,
    Discount,
    EODRecordSchema,
    EODRecord,
    CounterSchema,
    Counter,
    emitToOps,
    emitToAll,
    emitToMgr,
    getCategoryPrefix,
    generateNextSequence,
    scheduleMidnightArchive,
    validateOrderMath,
    normalBalanceForCode,
    reportLinesForItem,
    paymentChannel,
    parseClockAt,
    completedBreakMinutes,
    openBreak,
    BREAK_CAP_MIN,
    RevolvingFundSchema,
    RevolvingFund,
    RevolvingFundTxSchema,
    RevolvingFundTx,
    verifyToken,
    verifyClientToken,
    requireSuperAdmin,
    requireSuperOrAdmin,
    verifyOrderAuth,
  } = ctx;

// Client login - returns a short-lived JWT with role='client' and pre-set paymentMethod
app.post('/api/client-auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password are required.' });
    // Case-insensitive on purpose: new accounts store a lowercased username, but
    // accounts created before that change still hold mixed case. An exact match
    // would lock those clients out of their own portal.
    const client = await ClientAccount.findOne({
      username: { $regex: `^${escapeRegex(lower(username))}$`, $options: 'i' },
    });
    if (!client || !client.isActive) return res.status(401).json({ success: false, error: 'Invalid credentials or account is inactive.' });
    const match = await bcrypt.compare(password, client.password);
    if (!match) return res.status(401).json({ success: false, error: 'Invalid credentials.' });
    const token = jwt.sign(
      // aud:'client' - verified strictly by verifyClientToken on the two client-portal
      // routes, and rejected by verifyToken/requireStaff on every staff route.
      { _id: client._id, clientId: String(client._id), username: client.username, name: client.name, role: 'client', paymentMethod: client.paymentMethod, aud: 'client' },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ success: true, token, client: { _id: String(client._id), clientCode: client.clientCode, username: client.username, name: client.name, paymentMethod: client.paymentMethod, theme: client.theme || null } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Logged-in client's own orders - drives the portal status sidebar.
app.get('/api/client/orders', verifyClientToken, async (req, res) => {
  try {
    const clientId = req.user?.clientId || req.user?._id;
    if (!clientId || req.user?.role !== 'client') {
      return res.status(403).json({ success: false, error: 'Client session required.' });
    }
    const orders = await Order.find(
      { clientId: String(clientId) },
      // orderNotes is the client's own text - it belongs on their order slip.
      { orderNumber: 1, billingNumber: 1, status: 1, total: 1, items: 1, paymentMethod: 1, createdAt: 1, transactionType: 1, clientReceived: 1, orderNotes: 1 }
    ).sort({ createdAt: -1 }).limit(30).lean();
    res.json({ success: true, orders });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Client confirms they received a completed order (portal "I received my order").
app.post('/api/client/orders/:id/received', verifyClientToken, async (req, res) => {
  try {
    const clientId = req.user?.clientId || req.user?._id;
    if (!clientId || req.user?.role !== 'client') return res.status(403).json({ success: false, error: 'Client session required.' });
    const order = await Order.findOne({ _id: req.params.id, clientId: String(clientId) });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (!['Completed', 'Delivered', 'Picked Up'].includes(order.status)) {
      return res.status(400).json({ success: false, error: 'Order is not ready yet.' });
    }
    order.clientReceived = true;
    await order.save();
    emitToOps('orderUpdated', order);
    res.json({ success: true });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Client cancels their OWN order while it is still Pending (placed, unpaid, not
// yet accepted into Preparing). No inventory/ledger has moved at this stage, so
// this is a pure status flip - nothing to reverse. Once staff move it to
// Preparing (payment confirmed) the client can no longer cancel from the portal.
app.post('/api/client/orders/:id/cancel', verifyClientToken, async (req, res) => {
  try {
    const clientId = req.user?.clientId || req.user?._id;
    if (!clientId || req.user?.role !== 'client') return res.status(403).json({ success: false, error: 'Client session required.' });
    const order = await Order.findOne({ _id: req.params.id, clientId: String(clientId) });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.status !== 'Pending') {
      return res.status(400).json({ success: false, error: 'Only a pending, unpaid order can be cancelled. Please contact us for changes.' });
    }
    order.status = 'Cancelled';
    await order.save();
    emitToOps('orderUpdated', order);
    emitToMgr('erpUpdated');
    res.json({ success: true, order });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── Client self-service ──────────────────────────────────────────────────────
// A client manages their own login and appearance. Scoped strictly to the
// account in their own token - never accepts an id from the request body.

const THEMES = ['default', 'light', 'yellow', 'ocean'];

const ownClient = async (req) => {
  const clientId = req.user?.clientId || req.user?._id;
  if (!clientId || req.user?.role !== 'client') return null;
  return ClientAccount.findById(clientId);
};

app.get('/api/client/profile', verifyClientToken, async (req, res) => {
  try {
    const me = await ownClient(req);
    if (!me) return res.status(403).json({ success: false, error: 'Client session required.' });
    res.json({ success: true, profile: {
      _id: String(me._id), clientCode: me.clientCode, username: me.username,
      name: me.name, paymentMethod: me.paymentMethod, theme: me.theme || null,
    } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.patch('/api/client/profile', verifyClientToken, async (req, res) => {
  try {
    const me = await ownClient(req);
    if (!me) return res.status(403).json({ success: false, error: 'Client session required.' });

    if (req.body.theme !== undefined) {
      const t = req.body.theme === null || req.body.theme === '' ? null : String(req.body.theme);
      if (t !== null && !THEMES.includes(t)) {
        return res.status(400).json({ success: false, error: 'Unknown theme.' });
      }
      me.theme = t;
    }

    if (req.body.username !== undefined) {
      const next = lower(String(req.body.username).trim());
      if (next.length < 3 || next.length > 40) {
        return res.status(400).json({ success: false, error: 'Username must be 3-40 characters.' });
      }
      if (!/^[a-z0-9._-]+$/.test(next)) {
        return res.status(400).json({ success: false, error: 'Username may use letters, digits, dot, dash and underscore only.' });
      }
      if (next !== lower(me.username)) {
        // Case-insensitive check: logins are matched case-insensitively, so two
        // accounts differing only by case would be indistinguishable at sign-in.
        const clash = await ClientAccount.findOne({
          _id: { $ne: me._id },
          username: { $regex: `^${escapeRegex(next)}$`, $options: 'i' },
        }).lean();
        if (clash) return res.status(409).json({ success: false, error: 'That username is already taken.' });
        me.username = next;
      }
    }

    await me.save();
    res.json({ success: true, profile: {
      _id: String(me._id), clientCode: me.clientCode, username: me.username,
      name: me.name, paymentMethod: me.paymentMethod, theme: me.theme || null,
    } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/client/password', verifyClientToken, async (req, res) => {
  try {
    const me = await ownClient(req);
    if (!me) return res.status(403).json({ success: false, error: 'Client session required.' });

    const current = String(req.body.currentPassword || '');
    const next = String(req.body.newPassword || '');
    if (next.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters.' });
    }
    // Requiring the current password is what stops a stolen session token from
    // being escalated into permanent account takeover.
    if (!current || !(await bcrypt.compare(current, me.password))) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }
    if (await bcrypt.compare(next, me.password)) {
      return res.status(400).json({ success: false, error: 'New password must be different.' });
    }
    me.password = await bcrypt.hash(next, BCRYPT_ROUNDS);
    await me.save();
    res.json({ success: true, message: 'Password changed.' });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// CRUD for client accounts - superadmin only
app.get('/api/client-accounts', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const clients = await ClientAccount.find({}, { password: 0 }).sort({ createdAt: -1 });
    res.json({ success: true, clients });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Light contact-field sanitizers. Email format is validated loosely (there's
// no server-side deliverability check - nothing here sends mail); an invalid
// one is rejected rather than silently stored, so the collections/CRM views
// don't surface garbage. Empty is always allowed - these are optional.
const cleanEmail = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null; // sentinel: invalid
  return s.slice(0, 254);
};
const cleanPhone = (v) => String(v ?? '').trim().slice(0, 40);

app.post('/api/client-accounts', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, name, paymentMethod, creditLimit, creditTermsDays, segments, phone, email, contactNotes } = req.body;
    // Usernames are stored lowercase so "KasaLokal" and "kasalokal" are the same
    // account - mixed case here is the classic duplicate-login bug.
    const cleanUsername = lower(username);
    const cleanName = title(name);
    if (!cleanUsername || !password || !cleanName) {
      return res.status(400).json({ success: false, error: 'username, password, and name are required.' });
    }
    const exists = await ClientAccount.findOne({ username: cleanUsername });
    if (exists) return res.status(409).json({ success: false, error: 'Username already taken.' });
    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const cleanSegments = Array.isArray(segments) ? [...new Set(segments.map(s => String(s).trim()).filter(Boolean))] : [];
    // Standard customer ID format: CUS-1000-A0000 ("1000" is a fixed segment;
    // "A0000" is the zero-padded sequence - same "prefix-A + digits" convention
    // used for client/product codes elsewhere, just with the fixed segment folded
    // into the prefix so generateNextSequence's `${prefix}-A${seq}` template fits).
    const clientCode = await generateNextSequence(ClientAccount, 'CUS-1000', 'clientCode');
    const emailVal = cleanEmail(email);
    if (emailVal === null) return res.status(400).json({ success: false, error: 'Email is not a valid address.' });
    const client = await ClientAccount.create({ clientCode, username: cleanUsername, password: hashed, name: cleanName, paymentMethod: paymentMethod || 'Cash', creditLimit: parseCreditLimit(creditLimit), creditTermsDays: parseTermsDays(creditTermsDays), segments: cleanSegments, phone: cleanPhone(phone), email: emailVal, contactNotes: String(contactNotes ?? '').trim().slice(0, 1000) });
    res.json({ success: true, client: { _id: client._id, clientCode: client.clientCode, username: client.username, name: client.name, paymentMethod: client.paymentMethod, isActive: client.isActive, creditLimit: client.creditLimit, creditTermsDays: client.creditTermsDays, segments: client.segments, phone: client.phone, email: client.email, contactNotes: client.contactNotes } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.patch('/api/client-accounts/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, name, paymentMethod, isActive, creditLimit, creditTermsDays, segments, phone, email, contactNotes } = req.body;
    const update = {};
    if (username) update.username = lower(username);
    if (name) update.name = title(name);
    if (paymentMethod) update.paymentMethod = paymentMethod;
    if (typeof isActive === 'boolean') update.isActive = isActive;
    // Sent explicitly (including '' / null to clear it back to "no limit").
    if (creditLimit !== undefined) update.creditLimit = parseCreditLimit(creditLimit);
    if (creditTermsDays !== undefined) update.creditTermsDays = parseTermsDays(creditTermsDays);
    if (Array.isArray(segments)) update.segments = [...new Set(segments.map(s => String(s).trim()).filter(Boolean))];
    // Contact fields - sent explicitly (including '' to clear). Email validated.
    if (phone !== undefined) update.phone = cleanPhone(phone);
    if (email !== undefined) {
      const emailVal = cleanEmail(email);
      if (emailVal === null) return res.status(400).json({ success: false, error: 'Email is not a valid address.' });
      update.email = emailVal;
    }
    if (contactNotes !== undefined) update.contactNotes = String(contactNotes ?? '').trim().slice(0, 1000);
    if (password) update.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const client = await ClientAccount.findByIdAndUpdate(req.params.id, { $set: update }, { returnDocument: 'after', select: '-password' });
    if (!client) return res.status(404).json({ success: false, error: 'Client account not found.' });
    res.json({ success: true, client });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, error: 'Username already taken.' });
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// A client's password is bcrypt-hashed - there is no "reveal the existing
// password" that doesn't mean storing it in reversible form, which we don't
// do. This resets it to a new one instead: the caller re-enters THEIR OWN
// password (proving it's really them, not a hijacked session), and the new
// client password is generated here and returned exactly once, in this
// response. It is never retrievable again after this - write it down/share it
// now, or reset again later.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // no 0/O/1/l/I - avoids misread-on-paper
function generateClientPassword(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

app.post('/api/client-accounts/:id/reset-password', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const confirmPassword = String(req.body?.confirmPassword || '');
    if (!confirmPassword) return res.status(400).json({ success: false, error: 'Re-enter your own password to confirm.' });

    const me = await User.findById(req.user._id);
    if (!me || !(await bcrypt.compare(confirmPassword, me.password))) {
      return res.status(401).json({ success: false, error: 'Your password is incorrect.' });
    }

    const client = await ClientAccount.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, error: 'Client account not found.' });

    const newPassword = generateClientPassword();
    client.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await client.save();

    await logAudit(req, { action: 'reset_password', entity: 'ClientAccount', entityId: client._id, after: { username: client.username } });
    // The only response that ever carries this in plaintext.
    res.json({ success: true, newPassword, client: { _id: client._id, username: client.username, name: client.name } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── Self-service onboarding link (#10) ────────────────────────────────────────
// Generate: superadmin-only, from the Command Center. The client then opens
// the link with NO auth at all (that's the point - they don't have a login
// yet), fills in their own details, and sets their own username/password.
app.post('/api/client-accounts/:id/onboard-link', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const client = await ClientAccount.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, error: 'Client account not found.' });
    const token = crypto.randomBytes(24).toString('hex');
    client.onboardingToken = token;
    client.onboardingTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await client.save();
    await logAudit(req, { action: 'onboard_link_created', entity: 'ClientAccount', entityId: client._id, after: { clientCode: client.clientCode } });
    res.json({ success: true, token, expiresAt: client.onboardingTokenExpiresAt });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Public - no auth. The token itself IS the proof of authorization (mailed/
// handed to the client directly), same trust model as a password-reset link.
app.get('/api/client-onboard/:token', async (req, res) => {
  try {
    const client = await ClientAccount.findOne({ onboardingToken: req.params.token }, { name: 1, clientCode: 1, phone: 1, email: 1, onboardingTokenExpiresAt: 1 });
    if (!client || !client.onboardingTokenExpiresAt || client.onboardingTokenExpiresAt < new Date()) {
      return res.status(404).json({ success: false, error: 'This link is invalid or has expired. Ask the shop to send you a new one.' });
    }
    res.json({ success: true, client: { name: client.name, clientCode: client.clientCode, phone: client.phone, email: client.email } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/client-onboard/:token', async (req, res) => {
  try {
    const client = await ClientAccount.findOne({ onboardingToken: req.params.token });
    if (!client || !client.onboardingTokenExpiresAt || client.onboardingTokenExpiresAt < new Date()) {
      return res.status(404).json({ success: false, error: 'This link is invalid or has expired. Ask the shop to send you a new one.' });
    }
    const { name, phone, email, username, password } = req.body || {};
    const cleanUsername = lower(username);
    if (!cleanUsername || !password) return res.status(400).json({ success: false, error: 'Username and password are required.' });
    if (String(password).length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    const clash = await ClientAccount.findOne({ username: cleanUsername, _id: { $ne: client._id } });
    if (clash) return res.status(409).json({ success: false, error: 'That username is already taken - pick another.' });
    const emailVal = cleanEmail(email);
    if (emailVal === null) return res.status(400).json({ success: false, error: 'Email is not a valid address.' });

    if (name && title(name)) client.name = title(name);
    if (phone !== undefined) client.phone = cleanPhone(phone);
    client.email = emailVal;
    client.username = cleanUsername;
    client.password = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    client.source = 'portal'; // now has a real, usable login
    client.onboardingToken = null;
    client.onboardingTokenExpiresAt = null;
    await client.save();

    res.json({ success: true, client: { clientCode: client.clientCode, username: client.username, name: client.name } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.delete('/api/client-accounts/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    await ClientAccount.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
}
