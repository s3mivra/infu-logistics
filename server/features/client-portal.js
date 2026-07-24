// client-portal routes — moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
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

// Client login — returns a short-lived JWT with role='client' and pre-set paymentMethod
app.post('/api/client-auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password are required.' });
    const client = await ClientAccount.findOne({ username: username.trim() });
    if (!client || !client.isActive) return res.status(401).json({ success: false, error: 'Invalid credentials or account is inactive.' });
    const match = await bcrypt.compare(password, client.password);
    if (!match) return res.status(401).json({ success: false, error: 'Invalid credentials.' });
    const token = jwt.sign(
      // aud:'client' — verified strictly by verifyClientToken on the two client-portal
      // routes, and rejected by verifyToken/requireStaff on every staff route.
      { _id: client._id, clientId: String(client._id), username: client.username, name: client.name, role: 'client', paymentMethod: client.paymentMethod, aud: 'client' },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ success: true, token, client: { _id: String(client._id), clientCode: client.clientCode, username: client.username, name: client.name, paymentMethod: client.paymentMethod } });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Logged-in client's own orders — drives the portal status sidebar.
app.get('/api/client/orders', verifyClientToken, async (req, res) => {
  try {
    const clientId = req.user?.clientId || req.user?._id;
    if (!clientId || req.user?.role !== 'client') {
      return res.status(403).json({ success: false, error: 'Client session required.' });
    }
    const orders = await Order.find(
      { clientId: String(clientId) },
      { orderNumber: 1, billingNumber: 1, status: 1, total: 1, items: 1, paymentMethod: 1, createdAt: 1, transactionType: 1, clientReceived: 1 }
    ).sort({ createdAt: -1 }).limit(30).lean();
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Client cancels their OWN order while it is still Pending (placed, unpaid, not
// yet accepted into Preparing). No inventory/ledger has moved at this stage, so
// this is a pure status flip — nothing to reverse. Once staff move it to
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// CRUD for client accounts — superadmin only
app.get('/api/client-accounts', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const clients = await ClientAccount.find({}, { password: 0 }).sort({ createdAt: -1 });
    res.json({ success: true, clients });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.post('/api/client-accounts', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, name, paymentMethod } = req.body;
    if (!username?.trim() || !password || !name?.trim()) {
      return res.status(400).json({ success: false, error: 'username, password, and name are required.' });
    }
    const exists = await ClientAccount.findOne({ username: username.trim() });
    if (exists) return res.status(409).json({ success: false, error: 'Username already taken.' });
    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const clientCode = await generateNextSequence(ClientAccount, 'CLT', 'clientCode');
    const client = await ClientAccount.create({ clientCode, username: username.trim(), password: hashed, name: name.trim(), paymentMethod: paymentMethod || 'Cash' });
    res.json({ success: true, client: { _id: client._id, clientCode: client.clientCode, username: client.username, name: client.name, paymentMethod: client.paymentMethod, isActive: client.isActive } });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.patch('/api/client-accounts/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, name, paymentMethod, isActive } = req.body;
    const update = {};
    if (username) update.username = username.trim();
    if (name) update.name = name.trim();
    if (paymentMethod) update.paymentMethod = paymentMethod;
    if (typeof isActive === 'boolean') update.isActive = isActive;
    if (password) update.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const client = await ClientAccount.findByIdAndUpdate(req.params.id, { $set: update }, { returnDocument: 'after', select: '-password' });
    if (!client) return res.status(404).json({ success: false, error: 'Client account not found.' });
    res.json({ success: true, client });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, error: 'Username already taken.' });
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.delete('/api/client-accounts/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    await ClientAccount.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});
}
