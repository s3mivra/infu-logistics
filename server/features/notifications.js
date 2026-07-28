// notifications routes — one aggregated "what needs attention" feed.
//
// WHY a single endpoint: the bell needs seven unrelated signals at once. Seven
// round-trips on every dashboard poll would be wasteful, and the client would
// have to re-implement each threshold rule that already lives on the server.
//
// Every item carries navigation coordinates (`tab`, `sub`, `focusId`) so the UI
// can send the user straight to the offending record instead of just telling
// them something is wrong.
/* eslint-disable no-unused-vars */
export default function registerNotifications(ctx) {
  const {
    app,
    IS_PROD,
    BUSINESS_TYPE,
    tenantScope,
    Inventory,
    Order,
    PurchaseOrder,
    verifyToken,
    requireStaff,
    requirePermission,
    hasPermission,
    effectiveDisplay,
  } = ctx;

  // Severity drives sort order and colour. 'critical' outranks 'warn'.
  const CRIT = 'critical';
  const WARN = 'warn';

  const daysBetween = (a, b) => Math.round((a - b) / 86400000);

  // Inventory is stored in BASE units (g/ml/pcs) but every screen shows display
  // units. Reporting the raw base number here would read as a different figure
  // entirely — "200 left" for 200 g of an item the user thinks of in kg. So the
  // feed converts exactly the way the tables do.
  const display = (item) => {
    const qty = Number(item.stockQty) || 0;
    if (BUSINESS_TYPE === 'log') {
      // Log mode counts whole packs/pieces.
      const packBase = (Number(item.packSize) || 1) * (Number(item.unitMultiplier) || 1);
      return { qty: qty / (packBase || 1), unit: 'pcs', div: packBase || 1 };
    }
    const { displayUnit, mult } = effectiveDisplay(item);
    return { qty: qty / (mult || 1), unit: displayUnit, div: mult || 1 };
  };

  // Trim float noise from the division without lying about small quantities.
  const fmt = (n) => Number(n.toFixed(3)).toLocaleString();

  app.get('/api/notifications', verifyToken, requireStaff, async (req, res) => {
    try {
      const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      const now = new Date();
      const items = [];

      // Permission-aware: a cashier shouldn't be told about A/R or supplier POs.
      // hasPermission is the same check the routes themselves use, so the bell
      // can never surface a record its owner isn't allowed to open. Fails CLOSED
      // — an unknown permission hides the signal rather than leaking it.
      const may = (perm) => {
        try { return hasPermission(req.user, perm); }
        catch { return false; }
      };

      const [inventory, parkedOrders, arOrders, openPOs] = await Promise.all([
        may('inventory.view')
          ? Inventory.find(scope, { itemName: 1, stockQty: 1, lowStockThreshold: 1, unit: 1, displayUnit: 1, unitMultiplier: 1, packSize: 1, expiryDate: 1, expiryWarnDays: 1 }).lean()
          : [],
        may('orders.view')
          ? Order.find({ ...scope, isParked: true, isArchived: false }, { orderNumber: 1, customerName: 1, total: 1, createdAt: 1 }).lean()
          : [],
        may('accounting.view')
          ? Order.find({
              ...scope, status: 'Completed', paymentMethod: { $ne: 'Cash' },
              isComplimentary: { $ne: true }, arSettled: { $ne: true },
            }, { orderNumber: 1, customerName: 1, total: 1, createdAt: 1, paymentMethod: 1 }).sort({ createdAt: 1 }).limit(500).lean()
          : [],
        may('procurement.view')
          ? PurchaseOrder.find({ ...scope, status: { $in: ['Ordered', 'Processing', 'Incomplete'] } },
              { poNumber: 1, supplier: 1, expectedDate: 1, status: 1 }).lean()
          : [],
      ]);

      // ── Low stock ──────────────────────────────────────────────────────────
      for (const i of inventory) {
        const threshold = Number(i.lowStockThreshold) || 0;
        if (threshold <= 0) continue;                  // 0 = alerting disabled
        const qty = Number(i.stockQty) || 0;
        if (qty > threshold) continue;
        const d = display(i);
        items.push({
          id: `low:${i._id}`,
          kind: 'low_stock',
          severity: qty <= 0 ? CRIT : WARN,
          title: qty <= 0 ? `${i.itemName} is out of stock` : `${i.itemName} is low`,
          detail: `${fmt(d.qty)} ${d.unit} left (alert at ${fmt(threshold / d.div)} ${d.unit})`,
          tab: 'inventory', focusId: String(i._id),
        });
      }

      // ── Expiry ─────────────────────────────────────────────────────────────
      for (const i of inventory) {
        if (!i.expiryDate || (Number(i.stockQty) || 0) <= 0) continue;
        const exp = new Date(i.expiryDate);
        const warnDays = Number(i.expiryWarnDays) || 7;
        const left = daysBetween(exp, now);
        const d = display(i);
        if (left < 0) {
          items.push({
            id: `exp:${i._id}`, kind: 'expired', severity: CRIT,
            title: `${i.itemName} has expired`,
            detail: `Expired ${Math.abs(left)} day(s) ago — still ${fmt(d.qty)} ${d.unit} in stock`,
            tab: 'inventory', focusId: String(i._id),
          });
        } else if (left <= warnDays) {
          items.push({
            id: `exp:${i._id}`, kind: 'expiring', severity: WARN,
            title: `${i.itemName} expires in ${left} day(s)`,
            detail: `${fmt(d.qty)} ${d.unit} in stock`,
            tab: 'inventory', focusId: String(i._id),
          });
        }
      }

      // ── Parked / unfinished orders ─────────────────────────────────────────
      for (const o of parkedOrders) {
        const age = daysBetween(now, new Date(o.createdAt));
        items.push({
          id: `park:${o._id}`,
          kind: 'parked_order',
          severity: age >= 1 ? WARN : 'info',
          title: `Parked order #${o.orderNumber}`,
          detail: `${o.customerName || 'No name'} · ₱${(o.total || 0).toFixed(2)}${age >= 1 ? ` · open ${age} day(s)` : ''}`,
          tab: 'orders', focusId: String(o._id),
        });
      }

      // ── A/R ageing ─────────────────────────────────────────────────────────
      // Non-cash sales sit in A/R until settlement is recorded. Anything past 30
      // days is the first bucket worth chasing.
      for (const o of arOrders) {
        const age = daysBetween(now, new Date(o.createdAt));
        if (age < 30) continue;
        items.push({
          id: `ar:${o._id}`,
          kind: 'ar_overdue',
          severity: age >= 60 ? CRIT : WARN,
          title: `Unsettled ${o.paymentMethod} · #${o.orderNumber}`,
          detail: `${o.customerName || 'No name'} · ₱${(o.total || 0).toFixed(2)} · ${age} days outstanding`,
          tab: 'ledger', sub: 'arap', focusId: String(o._id),
        });
      }

      // ── Purchase orders awaiting delivery ──────────────────────────────────
      for (const po of openPOs) {
        const overdue = po.expectedDate ? daysBetween(now, new Date(po.expectedDate)) : null;
        // Only nag once a PO is actually late, or already short-delivered.
        if (po.status !== 'Incomplete' && !(overdue !== null && overdue > 0)) continue;
        items.push({
          id: `po:${po._id}`,
          kind: po.status === 'Incomplete' ? 'po_short' : 'po_overdue',
          severity: WARN,
          title: po.status === 'Incomplete'
            ? `${po.poNumber} short-delivered`
            : `${po.poNumber} overdue by ${overdue} day(s)`,
          detail: po.supplier || '',
          tab: 'procurement', focusId: String(po._id),
        });
      }

      const rank = { [CRIT]: 0, [WARN]: 1, info: 2 };
      items.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));

      res.json({
        success: true,
        count: items.length,
        criticalCount: items.filter(i => i.severity === CRIT).length,
        items,
        generatedAt: now.toISOString(),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
    }
  });
}
