// users routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { captureError } from '../lib/errorLog.js';
import { signApproval } from '../lib/approval.js';

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
    pinLimiter,
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

// Catalogue of assignable permissions + role defaults - drives the UI editor.
app.get('/api/permissions', verifyToken, requireStaff, async (req, res) => {
  res.json({ success: true, permissions: PERMISSIONS });
});

// Effective permissions for the caller - the client gates its UI on this.
app.get('/api/users/me', verifyToken, requireStaff, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -pinHash -pinFailedCount -pinLockedUntil').lean();
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


// ── WHO IS AT THE SCREEN ─────────────────────────────────────────────────────
// One tablet behind a bar, several people using it. Signing out and back in
// with a password between drinks is friction nobody absorbs, so in practice
// everything gets rung on whoever is still signed in - and Cashier Variance,
// Commissions and the sale's own `cashier` all quietly follow the wrong person.
// Nothing warns you, which is what makes it worse than an obvious bug.
//
// So identity works in two tiers, the way a shared POS terminal normally does:
// the DEVICE is signed in once with a real password, and a short PIN says who
// is ringing right now. The PIN only ever identifies; what that person may DO
// still comes from their role, exactly as before. Switching issues a genuine
// session for them, so every route downstream sees the right `req.user` with no
// special handling anywhere.
const PIN_RE = /^\d{4,6}$/;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 5;

// Who can be switched to: staff with a PIN set. Names only - enough to show a
// row to tap, and nothing that would help someone guess a code.
app.get('/api/users/operators', verifyToken, requireStaff, async (req, res) => {
  try {
    const users = await User.find({ pinHash: { $ne: '' } }, { name: 1, role: 1, userCode: 1 })
      .sort({ name: 1 }).lean();
    res.json({ success: true, operators: users.map(u => ({ _id: u._id, name: u.name, role: u.role, userCode: u.userCode })) });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Hand the terminal to someone else.
//
// Requires an existing session: the device has to have been signed in properly
// first. A PIN alone can never open a terminal from cold - it is the second
// tier, not a replacement for the password.
app.post('/api/users/switch', pinLimiter, verifyToken, requireStaff, async (req, res) => {
  try {
    const pin = String(req.body?.pin || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!PIN_RE.test(pin)) return res.status(400).json({ success: false, error: 'Enter your 4 to 6 digit PIN.' });

    // Named or not, the PIN is checked against a single account: PINs are
    // unique (enforced when one is set), so a bare PIN identifies exactly one
    // person, and tapping a name first simply narrows it sooner.
    const candidates = name
      ? await User.find({ name })
      : await User.find({ pinHash: { $ne: '' } });

    let matched = null;
    for (const u of candidates) {
      if (!u.pinHash) continue;
      if (u.pinLockedUntil && u.pinLockedUntil > new Date()) continue;
      if (await bcrypt.compare(pin, u.pinHash)) { matched = u; break; }
    }

    if (!matched) {
      // A wrong PIN counts against the named account when one was given. With
      // no name there is nobody to count it against, so the only defence is the
      // rate limiter on the route itself.
      if (name && candidates[0]?.pinHash) {
        const u = candidates[0];
        u.pinFailedCount = (u.pinFailedCount || 0) + 1;
        if (u.pinFailedCount >= PIN_MAX_ATTEMPTS) {
          u.pinLockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60000);
          u.pinFailedCount = 0;
        }
        await u.save();
        if (u.pinLockedUntil && u.pinLockedUntil > new Date()) {
          return res.status(429).json({ success: false, error: `Too many wrong PINs. Try again in ${PIN_LOCK_MINUTES} minutes, or sign in with a password.` });
        }
      }
      // 403, not 401: the person at the till is still signed in - only the PIN
      // was wrong. The app treats any 401 as an expired session and signs the
      // terminal out, so a single mistyped PIN used to lock out whoever was
      // already working.
      return res.status(403).json({ success: false, error: 'That PIN was not recognised.' });
    }

    matched.pinFailedCount = 0;
    matched.pinLockedUntil = null;
    await matched.save();

    const token = await issueSession(res, matched, { userAgent: req.headers['user-agent'] });
    await logAudit(req, { action: 'switch-operator', entity: 'User', entityId: matched._id, after: { to: matched.name, from: req.user?.name || '' } });
    res.json({
      success: true, token,
      user: { _id: matched._id, name: matched.name, userCode: matched.userCode, role: matched.role, permissions: resolvePermissions(matched) },
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// A manager approving something the person at the screen may not do: a void, a
// refund, a large discount. Without this the only way through is for the
// manager to sign in fully at the counter, which is how a manager password ends
// up known to everyone on the floor. Approving does NOT switch the terminal -
// the barista stays signed in, and the approval is recorded against the manager.
app.post('/api/users/authorize', pinLimiter, verifyToken, requireStaff, async (req, res) => {
  try {
    const pin = String(req.body?.pin || '').trim();
    const permission = String(req.body?.permission || '').trim();
    if (!PIN_RE.test(pin)) return res.status(400).json({ success: false, error: 'Enter the manager PIN.' });

    const users = await User.find({ pinHash: { $ne: '' } });
    let approver = null;
    for (const u of users) {
      if (u.pinLockedUntil && u.pinLockedUntil > new Date()) continue;
      if (await bcrypt.compare(pin, u.pinHash)) { approver = u; break; }
    }
    // 403 for the same reason as the switch above: a wrong manager PIN must not
    // sign out the cashier who asked for approval.
    if (!approver) return res.status(403).json({ success: false, error: 'That PIN was not recognised.' });

    // The PIN proves who they are; the role decides whether they may approve.
    const allowed = approver.role === 'superadmin'
      || !permission
      || resolvePermissions(approver).includes(permission);
    if (!allowed) {
      return res.status(403).json({ success: false, error: `${approver.name} is not allowed to approve that.` });
    }

    // The record being approved, when there is one (an order id). The signed
    // approval is bound to it, so it cannot be spent on a different record.
    const target = String(req.body?.target || '').trim().slice(0, 64);
    await logAudit(req, { action: 'authorize', entity: 'User', entityId: approver._id, after: { approver: approver.name, permission, target, requestedBy: req.user?.name || '' } });
    res.json({
      success: true,
      approver: { _id: approver._id, name: approver.name, role: approver.role },
      // What the action checks - see lib/approval.js. Only issued for a named
      // permission: a blanket "a manager said yes" approves nothing.
      ...(permission ? { approval: signApproval({ approver, permission, requestedBy: req.user?._id, target }) } : {}),
    });
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

// Silent refresh - exchange a valid refresh cookie for a new access token.
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
    // refresh - rapid reloads fire concurrent refreshes and rotation would treat the
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

// Logout - revoke the current refresh session and clear the cookie.
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
    // The PIN hash never leaves the server. A four digit code behind a hash is
    // a few seconds of offline guessing, so shipping it to every till would
    // hand over every operator identity in the shop. The screen only needs to
    // know whether one is set.
    const users = await User.find().select('-password -pinHash -pinFailedCount -pinLockedUntil').sort({ userCode: 1 }).lean();
    const withPin = new Set(
      (await User.find({ pinHash: { $ne: '' } }, { _id: 1 }).lean()).map(u => String(u._id)),
    );
    res.json({ success: true, users: users.map(u => ({ ...u, hasPin: withPin.has(String(u._id)) })) });
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

    const updated = await User.findByIdAndUpdate(req.params.id, updateData, { returnDocument: 'after' }).select('-password -pinHash -pinFailedCount -pinLockedUntil');
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
    // The statutory account numbers. Stored as typed - the agencies' formats
    // differ and change, and a validator that guesses wrong would block a
    // legitimate number rather than catch a wrong one.
    for (const key of ['sssNumber', 'philhealthNumber', 'pagibigNumber', 'tin', 'employeeNumber']) {
      if (req.body[key] !== undefined) updates[key] = String(req.body[key] || '').trim().slice(0, 40);
    }

    // The terminal PIN. Empty clears it, which takes that person out of the
    // switch list entirely.
    if (req.body.pin !== undefined) {
      const pin = String(req.body.pin || '').trim();
      if (pin === '') {
        updates.pinHash = '';
        updates.pinFailedCount = 0;
        updates.pinLockedUntil = null;
      } else {
        if (!/^\d{4,6}$/.test(pin)) {
          return res.status(400).json({ success: false, error: 'A PIN is 4 to 6 digits.' });
        }
        // Unique, because a bare PIN has to identify exactly one person. Two
        // people sharing 1234 would mean sales landing on whichever record was
        // read first, which is the very problem this exists to solve.
        const others = await User.find({ _id: { $ne: req.params.id }, pinHash: { $ne: '' } }, { pinHash: 1, name: 1 });
        for (const o of others) {
          if (await bcrypt.compare(pin, o.pinHash)) {
            return res.status(409).json({ success: false, error: `That PIN is already used by ${o.name}. Pick another.` });
          }
        }
        updates.pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
        updates.pinFailedCount = 0;
        updates.pinLockedUntil = null;
      }
    }
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
    res.json({ success: true, user: { _id: user._id, name: user.name, userCode: user.userCode, role: user.role, permissions: resolvePermissions(user), commissionRate: user.commissionRate, sssNumber: user.sssNumber, philhealthNumber: user.philhealthNumber, pagibigNumber: user.pagibigNumber, tin: user.tin, employeeNumber: user.employeeNumber, hasPin: !!user.pinHash } });
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
// Requires current password for verification - prevents session hijacking.
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
