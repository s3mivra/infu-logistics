// qr-sessions routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { captureError } from '../lib/errorLog.js';
import { requirePermission as permit, hasPermission } from '../lib/authz.js';

export default function registerQrSessions(ctx) {
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

// --- 📱 STRICT QR SESSION CONTROL ---
app.post('/api/sessions/generate', verifyToken, requireStaff, async (req, res) => {
  try {
    const { table } = req.body;
    // KILL any previously active links for this table so there's never a duplicate online
    await QRSession.updateMany({ table, isActive: true }, { isActive: false });
    
    // Generate a secure random string
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Expires in exactly 10 minutes
    
    await QRSession.create({ sessionId, table, expiresAt });
    // expiresAt goes back too, so the screen showing the code can count down to
    // it and mint a replacement rather than displaying a dead QR to whoever
    // walks up next.
    res.json({ success: true, sessionId, table, expiresAt });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// The customer's phone calls this the moment the menu page opens, which is as
// close to "the code was scanned" as the server can get - a scan itself never
// reaches us, and the keep-alive heartbeat below only fires every two minutes,
// so waiting for that left a freshly-scanned code on display for up to two
// minutes with someone already ordering on it.
//
// Deliberately open (no auth): the caller is a customer's phone holding nothing
// but the session id from the QR. Claiming is idempotent and reveals nothing -
// a repeat call (a reload, a second tab) returns the same answer and does not
// re-notify staff, so a customer refreshing the page cannot make the counter
// cycle through codes.
app.post('/api/sessions/:id/claim', async (req, res) => {
  try {
    const session = await QRSession.findOne({ sessionId: req.params.id, isActive: true });
    if (!session) return res.status(404).json({ success: false, error: 'Session closed or invalid' });
    if (new Date() > session.expiresAt) {
      session.isActive = false;
      await session.save();
      return res.status(403).json({ success: false, error: 'Session expired' });
    }

    const firstClaim = !session.claimedAt;
    if (firstClaim) {
      session.claimedAt = new Date();
      // Opening the menu counts as activity, same as a heartbeat would.
      session.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await session.save();
      // emitToOps, not emitToMgr: 'manager' is superadmin/admin only, while
      // every authenticated user joins 'cashier' - and it is usually a cashier
      // holding the screen that shows this code. Sent to managers alone, the
      // code would simply never rotate for the person actually displaying it.
      // The payload is a session id and table the same staff member just
      // generated and is looking at, so it reveals nothing new.
      //
      // The screen showing this code swaps in a new one; the session just
      // claimed stays alive, so whoever scanned keeps ordering on it - a new
      // code is minted under a new table id and does not touch it.
      emitToOps('qrSessionClaimed', { sessionId: session.sessionId, table: session.table });
    }
    res.json({ success: true, table: session.table, firstClaim });
  } catch (err) {
    captureError(req, err);
    res.status(500).json({ success: false });
  }
});

// The customer's phone calls this to stay alive
app.post('/api/sessions/:id/heartbeat', async (req, res) => {
  try {
    const session = await QRSession.findOne({ sessionId: req.params.id, isActive: true });
    if (!session) return res.status(404).json({ success: false, error: 'Session closed or invalid' });
    
    // Check if the 10 minutes ran out
    if (new Date() > session.expiresAt) {
      session.isActive = false;
      await session.save();
      return res.status(403).json({ success: false, error: 'Session expired due to inactivity' });
    }
    
    // If they are still active, push the expiration back another 10 minutes
    session.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await session.save();
    
    res.json({ success: true, table: session.table });
  } catch (err) {
    captureError(req, err);
    res.status(500).json({ success: false });
  }
});

// Burn the link after the order is received
app.post('/api/sessions/:id/close', async (req, res) => {
  try {
    await QRSession.findOneAndUpdate({ sessionId: req.params.id }, { isActive: false });
    res.json({ success: true });
  } catch (err) {
    captureError(req, err);
    res.status(500).json({ success: false });
  }
});
// ── JUST QR: showing the ordering code without signing in ──────────────────
// The login screen has a "Just QR" button, so a counter tablet can put the
// ordering code up without anyone signing in. A code is a live ordering
// session - whoever scans it can send orders to the kitchen - so it cannot be
// handed to anyone who can reach this server; the login page is on the open
// internet. Instead a manager enables a DEVICE once: the tablet is given a
// long random key, kept in its own storage, and only a device holding a live
// key may make codes this way. The server keeps a hash of the key, never the
// key, and a device can be switched off at any time.
const QrDevice = mongoose.models.QrDevice || mongoose.model('QrDevice', new mongoose.Schema({
  businessType: { type: String, index: true },
  label: { type: String, default: '' },
  keyHash: { type: String, unique: true },
  createdBy: { type: String, default: '' },
  lastUsedAt: { type: Date, default: null },
  revoked: { type: Boolean, default: false },
}, { timestamps: true }));

const hashKey = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
const canManageDevices = [verifyToken, requireStaff, permit('settings.manage')];
// A code is replaced when one is scanned or runs out; nothing a person does
// asks for one faster than this, so anything faster is not a person.
const MIN_GAP_MS = 4000;
const lastIssued = new Map();

async function deviceFrom(req) {
  const key = req.headers['x-qr-device'];
  if (typeof key !== 'string' || key.length < 32 || key.length > 200) return null;
  const device = await QrDevice.findOne({ keyHash: hashKey(key), businessType: BUSINESS_TYPE, revoked: false });
  return device || null;
}

app.post('/api/qr-devices', ...canManageDevices, async (req, res) => {
  try {
    const label = String(req.body?.label || '').trim().slice(0, 60) || 'Counter tablet';
    const key = crypto.randomBytes(32).toString('hex');
    const device = await QrDevice.create({ businessType: BUSINESS_TYPE, label, keyHash: hashKey(key), createdBy: req.user?.name || '' });
    await logAudit(req, { action: 'create', entity: 'QrDevice', entityId: device._id, after: { label } });
    // The key is returned once and never again - the server only keeps its hash.
    res.json({ success: true, key, device: { _id: device._id, label, createdAt: device.createdAt } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.get('/api/qr-devices', ...canManageDevices, async (req, res) => {
  try {
    const devices = await QrDevice.find({ businessType: BUSINESS_TYPE, revoked: false }, { keyHash: 0 }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, devices });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.delete('/api/qr-devices/:id', ...canManageDevices, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
    const r = await QrDevice.updateOne({ _id: req.params.id, businessType: BUSINESS_TYPE }, { $set: { revoked: true } });
    if (!r.matchedCount) return res.status(404).json({ success: false, error: 'Not found' });
    await logAudit(req, { action: 'delete', entity: 'QrDevice', entityId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Turning a device on from the Just QR screen itself. The tablet is at the
// counter with nobody signed in, and sending someone to find a Settings card
// meant signing in, finding it, and signing out again. A manager types their
// name and password right there instead. It checks them the way the login
// does, but opens no session: nobody is left signed in on the tablet.
app.post('/api/qr-devices/enable-here', loginLimiter, async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const label = String(req.body?.label || '').trim().slice(0, 60) || 'Counter tablet';
    if (!name || !password) return res.status(400).json({ success: false, error: 'Enter a manager name and password.' });
    const user = await User.findOne({ name });
    const ok = user && user.password && await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ success: false, error: 'That name and password do not match.' });
    if (!hasPermission(user, 'settings.manage')) {
      return res.status(403).json({ success: false, error: `${user.name} cannot turn devices on - it needs someone who can change system settings.` });
    }
    const key = crypto.randomBytes(32).toString('hex');
    const device = await QrDevice.create({ businessType: BUSINESS_TYPE, label, keyHash: hashKey(key), createdBy: user.name });
    req.user = { _id: user._id, name: user.name, role: user.role };   // the manager who turned it on, for the audit log
    await logAudit(req, { action: 'create', entity: 'QrDevice', entityId: device._id, after: { label, via: 'just-qr' } });
    res.json({ success: true, key, device: { _id: device._id, label } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Is this device still allowed? The login screen asks, so a switched-off
// tablet says so instead of failing at the moment someone wants the code.
app.get('/api/qr-devices/me', async (req, res) => {
  try {
    const device = await deviceFrom(req);
    res.json({ success: true, enabled: !!device, label: device?.label || null });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// A fresh ordering code for an enabled device - the same session the signed-in
// "Show QR" makes, for this device's own counter table.
app.post('/api/qr-devices/session', async (req, res) => {
  try {
    const device = await deviceFrom(req);
    if (!device) return res.status(403).json({ success: false, error: 'This device is not set up to show the QR. A manager can turn it on in Settings.' });
    const id = String(device._id);
    const last = lastIssued.get(id) || 0;
    if (Date.now() - last < MIN_GAP_MS) return res.status(429).json({ success: false, error: 'Too soon - wait a moment.' });
    lastIssued.set(id, Date.now());

    const table = `QR-${id.slice(-6).toUpperCase()}`;
    // Retire only the code nobody has scanned. A new code is made the moment
    // one is scanned, and every code from this tablet shares its table - so
    // retiring them all ended the session the person who just scanned was
    // ordering on, and their order came back "QR session expired".
    await QRSession.updateMany({ table, isActive: true, claimedAt: null }, { isActive: false });
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await QRSession.create({ sessionId, table, expiresAt });
    device.lastUsedAt = new Date();
    await device.save();
    res.json({ success: true, sessionId, table, expiresAt });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Has the code on screen been scanned, or run out? The device is not signed
// in, so it cannot hear the staff-only "code claimed" event; it asks instead,
// every few seconds, about its own code only.
app.get('/api/qr-devices/session/:sessionId', async (req, res) => {
  try {
    const device = await deviceFrom(req);
    if (!device) return res.status(403).json({ success: false, error: 'This device is not set up to show the QR.' });
    const table = `QR-${String(device._id).slice(-6).toUpperCase()}`;
    const session = await QRSession.findOne({ sessionId: String(req.params.sessionId), table }).lean();
    if (!session) return res.status(404).json({ success: false, error: 'Not found' });
    const expired = !session.isActive || new Date(session.expiresAt) < new Date();
    res.json({ success: true, claimed: !!session.claimedAt, expired });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
}
