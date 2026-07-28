// clients routes — the customer-facing side of the business in one place.
//
// WHY a dedicated endpoint rather than joining on the client: answering "who is
// this client, what do they owe, and how close are they to their limit?" needs
// accounts, receivables and credit settings together. Composing that in the UI
// meant matching rows by NAME, which breaks the moment two clients share one.
// Here everything is keyed by account id.
/* eslint-disable no-unused-vars */
import { ageingBuckets, resolveCreditLimit, DEFAULT_CREDIT_MODE } from '../lib/credit.js';

export default function registerClients(ctx) {
  const {
    app,
    IS_PROD,
    BUSINESS_TYPE,
    mongoose,
    tenantScope,
    Order,
    ClientAccount,
    Settings,
    verifyToken,
    requireStaff,
    requirePermission,
  } = ctx;

  // Viewing clients is an orders-domain concern (who we sell to); the money
  // columns additionally require accounting.view — see below.
  const canViewClients = [requireStaff, requirePermission('orders.view')];

  // An order belongs to a client through EITHER field: portal orders carry
  // clientId, cashier-placed on-behalf orders carry clientAccountId.
  const orderMatchesClient = (id) => ({
    $or: [{ clientAccountId: String(id) }, { clientId: String(id) }],
  });

  // Statuses that represent live commercial exposure (mirrors the credit gate).
  const LIVE_STATUSES = { $nin: ['Cancelled', 'Voided', 'Refunded', 'Parked'] };

  app.get('/api/clients/summary', verifyToken, ...canViewClients, async (req, res) => {
    try {
      const showMoney = (() => {
        try { return ctx.hasPermission(req.user, 'accounting.view'); }
        catch { return false; }
      })();

      const [clients, modeRow, globalRow] = await Promise.all([
        ClientAccount.find({}, { password: 0 }).sort({ name: 1 }).lean(),
        Settings.findOne({ key: 'creditLimitMode' }).lean(),
        Settings.findOne({ key: 'globalCreditLimit' }).lean(),
      ]);
      const mode = modeRow?.value || DEFAULT_CREDIT_MODE;
      const globalLimit = globalRow?.value ?? null;

      const ids = clients.map(c => String(c._id));
      // One pass over every relevant order, then bucket in memory — far cheaper
      // than a query per client once there are more than a handful.
      const orders = await Order.find({
        businessType: BUSINESS_TYPE,
        ...tenantScope(req),
        $or: [{ clientAccountId: { $in: ids } }, { clientId: { $in: ids } }],
      }, {
        clientAccountId: 1, clientId: 1, total: 1, status: 1, createdAt: 1,
        paymentMethod: 1, isComplimentary: 1, arSettled: 1, isParked: 1,
      }).lean();

      const byClient = new Map(ids.map(id => [id, []]));
      for (const o of orders) {
        const key = (o.clientAccountId && byClient.has(String(o.clientAccountId)))
          ? String(o.clientAccountId)
          : (o.clientId && byClient.has(String(o.clientId)) ? String(o.clientId) : null);
        if (key) byClient.get(key).push(o);
      }

      const isLive = (o) =>
        !['Cancelled', 'Voided', 'Refunded', 'Parked'].includes(o.status) && o.isParked !== true;
      const isReceivable = (o) =>
        o.paymentMethod !== 'Cash' && o.isComplimentary !== true && o.arSettled !== true;

      const rows = clients.map(c => {
        const list = byClient.get(String(c._id)) || [];
        const limit = resolveCreditLimit({ mode, globalLimit, clientLimit: c.creditLimit });

        // Aged A/R uses COMPLETED sales only (a real book receivable), while
        // exposure counts everything committed — the same distinction the
        // credit gate and the ageing report already make.
        const aged = ageingBuckets(list.filter(o => o.status === 'Completed' && isReceivable(o)));
        const exposure = +list
          .filter(o => isLive(o) && isReceivable(o))
          .reduce((s, o) => s + (Number(o.total) || 0), 0)
          .toFixed(2);

        const completed = list.filter(o => o.status === 'Completed');
        const lifetime = +completed.reduce((s, o) => s + (Number(o.total) || 0), 0).toFixed(2);
        const lastOrderAt = list.length
          ? new Date(Math.max(...list.map(o => new Date(o.createdAt).getTime()))).toISOString()
          : null;

        const base = {
          _id: String(c._id),
          clientCode: c.clientCode,
          name: c.name,
          username: c.username,
          isActive: c.isActive !== false,
          paymentMethod: c.paymentMethod,
          source: c.source || 'portal',
          orderCount: list.length,
          completedCount: completed.length,
          lastOrderAt,
        };
        if (!showMoney) return base;
        return {
          ...base,
          lifetimeValue: lifetime,
          aged,
          exposure,
          creditLimit: limit,
          available: limit === null ? null : Math.max(0, Math.round((limit - exposure) * 100) / 100),
          overLimit: limit !== null && exposure > limit,
        };
      });

      res.json({ success: true, mode, globalLimit, showMoney, clients: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
    }
  });

  // A single client's recent orders — loaded on demand when a row is expanded,
  // so the summary above stays one cheap call.
  app.get('/api/clients/:id/orders', verifyToken, ...canViewClients, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
      const orders = await Order.find({
        businessType: BUSINESS_TYPE,
        ...tenantScope(req),
        ...orderMatchesClient(req.params.id),
      }, {
        orderNumber: 1, billingNumber: 1, status: 1, total: 1, paymentMethod: 1,
        createdAt: 1, arSettled: 1, items: 1,
      }).sort({ createdAt: -1 }).limit(limit).lean();

      res.json({
        success: true,
        orders: orders.map(o => ({ ...o, itemCount: (o.items || []).length, items: undefined })),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
    }
  });
}
