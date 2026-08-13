// users routes — moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { captureError } from '../lib/errorLog.js';

export default function registerUsers(ctx) {
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
    resolvePermissions,
    PERMISSIONS,
    PERMISSION_KEYS,
    refreshCustomRolePerms,
  } = ctx;

// Catalogue of assignable permissions + role defaults — drives the UI editor.
app.get('/api/permissions', verifyToken, requireStaff, async (req, res) => {
  res.json({ success: true, permissions: PERMISSIONS });
});

// Effective permissions for the caller — the client gates its UI on this.
app.get('/api/users/me', verifyToken, requireStaff, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password').lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    res.json({ success: true, user: { _id: user._id, name: user.name, userCode: user.userCode, role: user.role, permissions: resolvePermissions(user) } });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.get('/api/roles', verifyToken, requireStaff, async (req, res) => {
  try {
    const roles = await Role.find();
    res.json({ success: true, roles });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/roles', verifyToken, requireSuperAdmin, validate(roleSchema), async (req, res) => {
  try {
    const permissions = Array.isArray(req.body.permissions)
      ? req.body.permissions.filter((k) => PERMISSION_KEYS.has(k)) : [];
    const newRole = await Role.create({ name: req.body.name, permissions });
    await refreshCustomRolePerms?.(); // new grants take effect on next login/refresh
    res.json({ success: true, role: newRole });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Edit a custom role's name and/or its permission set.
app.patch('/api/roles/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const updates = {};
    if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
    if (Array.isArray(req.body.permissions)) updates.permissions = req.body.permissions.filter((k) => PERMISSION_KEYS.has(k));
    const role = await Role.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after' });
    if (!role) return res.status(404).json({ success: false, error: 'Role not found.' });
    await refreshCustomRolePerms?.();
    res.json({ success: true, role });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.delete('/api/roles/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    await Role.findByIdAndDelete(req.params.id);
    await refreshCustomRolePerms?.();
    res.json({ success: true });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/users/login', loginLimiter, validate(loginSchema), async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ success: false, message: 'Name and password are required.' });
    const user = await User.findOne({ name });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid name or password' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
      const token = await issueSession(res, user, { userAgent: req.headers['user-agent'] });
      res.json({ success: true, token, user: { _id: user._id, name: user.name, userCode: user.userCode, role: user.role, permissions: resolvePermissions(user) } });
    } else {
      res.status(401).json({ success: false, message: 'Invalid name or password' });
    }
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Silent refresh — exchange a valid refresh cookie for a new access token.
// Rotates the refresh token (single-use): the old session is revoked and a new
// cookie is issued. A revoked/expired/unknown token clears the cookie and 401s.
app.post('/api/auth/refresh', requireTrustedOrigin, async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) return res.status(401).json({ success: false, error: 'No refresh session.' });

    const session = await RefreshSession.findOne({ tokenHash: hashToken(raw) });
    if (!session || session.revoked || session.expiresAt < new Date()) {
      res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
    }

    const user = await User.findById(session.userId).select('-password');
    if (!user) {
      res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
      return res.status(401).json({ success: false, error: 'User no longer exists.' });
    }

    // NON-ROTATING refresh: validate the existing session and mint a fresh access
    // token, keeping the SAME refresh cookie. (We deliberately don't rotate on every
    // refresh — rapid reloads fire concurrent refreshes and rotation would treat the
    // in-flight duplicate as token reuse and log the user out.) Slide the expiry so
    // active sessions stay alive; logout/password/role changes still revoke server-side.
    session.expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await session.save();
    res.cookie(REFRESH_COOKIE, raw, refreshCookieOptions());

    const newToken = signAccessToken(user);
    res.json({ success: true, token: newToken, user: { _id: user._id, name: user.name, userCode: user.userCode, role: user.role, permissions: resolvePermissions(user) } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Logout — revoke the current refresh session and clear the cookie.
// This is the real teardown the old localStorage-only logout never provided.
app.post('/api/auth/logout', requireTrustedOrigin, async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await RefreshSession.updateOne({ tokenHash: hashToken(raw) }, { revoked: true });
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
    res.json({ success: true });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.get('/api/users', verifyToken, requireStaff, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ userCode: 1 });
    res.json({ success: true, users });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/users', verifyToken, requireSuperAdmin, validate(userCreateSchema), async (req, res) => {
  try {
    const existing = await User.findOne({ name: { $regex: new RegExp(`^${escapeRegex(req.body.name.trim())}$`, 'i') } });
    if (existing) return res.status(400).json({ success: false, error: 'User already exists' });
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
    const userCode = await generateNextSequence(User, 'ADN', 'userCode');
    
    // THE FIX: Add the role from the request body!
    const role = req.body.role || 'Staff'; // Default to cashier if none provided
    // Optional explicit permission override (empty ⇒ role defaults). Sanitized.
    const permissions = Array.isArray(req.body.permissions)
      ? req.body.permissions.filter((k) => PERMISSION_KEYS.has(k)) : [];

    const newUser = await User.create({ name: req.body.name, password: hashedPassword, userCode, role, permissions, tenantId: req.user?.tenantId || null });
    res.json({ success: true, user: { _id: newUser._id, name: newUser.name, userCode: newUser.userCode, role: newUser.role, permissions: resolvePermissions(newUser) } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.put('/api/users/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const updateData = { name: req.body.name };

    // Only hash and update the password if they actually typed a new one
    if (req.body.password && req.body.password.trim() !== '') {
      updateData.password = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
    }

    const updated = await User.findByIdAndUpdate(req.params.id, updateData, { returnDocument: 'after' }).select('-password');
    if (updateData.password) await revokeUserSessions(req.params.id); // force re-login after password change
    res.json({ success: true, user: updated });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.patch('/api/users/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { name, password, role, permissions, commissionRate } = req.body;
    const updates = {};
    if (name) updates.name = name.trim();
    if (role) updates.role = role;
    if (Array.isArray(permissions)) updates.permissions = permissions.filter((k) => PERMISSION_KEYS.has(k));
    if (password && password.trim()) updates.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    if (commissionRate !== undefined) {
      const rate = Number(commissionRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return res.status(400).json({ success: false, error: 'commissionRate must be a number between 0 and 100.' });
      }
      updates.commissionRate = rate;
    }
    const user = await User.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after' }).select('-password');
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    // Any privilege change (password/role/permissions) revokes sessions → re-login
    // so the new permission set is minted into a fresh token.
    if (updates.password || updates.role || updates.permissions) await revokeUserSessions(req.params.id);
    res.json({ success: true, user: { _id: user._id, name: user.name, userCode: user.userCode, role: user.role, permissions: resolvePermissions(user), commissionRate: user.commissionRate } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.delete('/api/users/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await revokeUserSessions(req.params.id); // kill any active sessions for the deleted account
    res.json({ success: true });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Staff self-service password change (any authenticated user, no superadmin required)
// Requires current password for verification — prevents session hijacking.
app.patch('/api/users/me/password', verifyToken, requireStaff, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ success: false, error: 'Both currentPassword and newPassword are required.' });
    if (newPassword.length < 6)
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(403).json({ success: false, error: 'Current password is incorrect.' });

    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await user.save();

    // Invalidate all existing sessions (other devices), then re-issue one for the
    // current device so the user who just changed their password stays logged in here.
    await revokeUserSessions(user._id);
    const token = await issueSession(res, user, { userAgent: req.headers['user-agent'] });

    await AuditLog.create({
      userId: user.name,
      action: 'PASSWORD_CHANGED',
      targetReference: user.userCode || user._id.toString(),
      details: { changedBy: user.name }
    });

    res.json({ success: true, message: 'Password changed successfully.', token });
  } catch (err) {
    log.error({ err }, 'PATCH /api/users/me/password failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
}
