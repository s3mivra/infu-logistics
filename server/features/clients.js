// clients routes - the customer-facing side of the business in one place.
//
// WHY a dedicated endpoint rather than joining on the client: answering "who is
// this client, what do they owe, and how close are they to their limit?" needs
// accounts, receivables and credit settings together. Composing that in the UI
// meant matching rows by NAME, which breaks the moment two clients share one.
// Here everything is keyed by account id.
/* eslint-disable no-unused-vars */
import { ageingBuckets, resolveCreditLimit, withArBalance, DEFAULT_CREDIT_MODE, isReceivableStatus } from '../lib/credit.js';

import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { businessDateStr } from '../lib/businessTime.js';

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
  // columns additionally require accounting.view - see below.
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
      // One pass over every relevant order, then bucket in memory - far cheaper
      // than a query per client once there are more than a handful.
      const orders = await Order.find({
        businessType: BUSINESS_TYPE,
        ...tenantScope(req),
        $or: [{ clientAccountId: { $in: ids } }, { clientId: { $in: ids } }],
      }, {
        clientAccountId: 1, clientId: 1, total: 1, status: 1, createdAt: 1,
        paymentMethod: 1, isComplimentary: 1, arSettled: 1, isParked: 1, arPaidAmount: 1, refundedAmount: 1,
      }).lean();

      // Open customer deposits per client - money they have paid us ahead of
      // any order, which offsets what they owe.
      const depositByClient = new Map();
      if (showMoney && ctx.Advance) {
        const deps = await ctx.Advance.find({
          businessType: BUSINESS_TYPE, ...tenantScope(req),
          type: 'customer', clientId: { $in: ids }, status: { $in: ['Open', 'Partially Liquidated'] },
        }, { clientId: 1, amount: 1, liquidatedAmount: 1 }).lean();
        for (const d of deps) {
          const left = (Number(d.amount) || 0) - (Number(d.liquidatedAmount) || 0);
          depositByClient.set(d.clientId, (depositByClient.get(d.clientId) || 0) + left);
        }
      }

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
        // exposure counts everything committed - the same distinction the
        // credit gate and the ageing report already make.
        // withArBalance restates each order's `total` as its unpaid remainder, so
        // a partly collected invoice ages on what is left rather than face value.
        const aged = ageingBuckets(withArBalance(list.filter(o => isReceivableStatus(o.status) && isReceivable(o))));
        const exposure = +list
          .filter(o => isLive(o) && isReceivable(o))
          .reduce((s, o) => s + Math.max(0, (Number(o.total) || 0) - (Number(o.refundedAmount) || 0)), 0)
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
          deposits: Math.round((depositByClient.get(String(c._id)) || 0) * 100) / 100,
        };
      });

      res.json({ success: true, mode, globalLimit, showMoney, clients: rows });
    } catch (err) {
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // A single client's recent orders - loaded on demand when a row is expanded,
  // so the summary above stays one cheap call.

  // -- STATEMENT OF ACCOUNT --------------------------------------------------
  // GET /api/clients/:id/statement?start=YYYY-MM-DD&end=YYYY-MM-DD
  //
  // What a credit client actually asks for at the end of the month: not a list
  // of orders, but the running account - what they owed when the period opened,
  // every charge and every payment in date order, and what is left. The screens
  // so far could show a balance but never how it was arrived at, so a client
  // disputing their total had nothing to check it against and the collector had
  // nothing to send.
  //
  // The opening balance is computed rather than stored: every charge raised
  // before the window, less every payment received before it. That way the
  // statement reconciles to the ledger no matter which period is asked for.
  app.get('/api/clients/:id/statement', verifyToken, ...canViewClients, async (req, res) => {
    try {
      if (!ctx.hasPermission(req.user, 'accounting.view')) {
        return res.status(403).json({ success: false, error: 'Viewing a statement of account needs accounting access.' });
      }
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      const client = await ClientAccount.findById(req.params.id, { password: 0 }).lean();
      if (!client) return res.status(404).json({ success: false, error: 'Not found' });

      // Default window: this month to date, on the business's own clock.
      const end = req.query.end ? dayEnd(req.query.end) : dayEnd(businessDateStr());
      const start = req.query.start
        ? dayStart(req.query.start)
        : dayStart(new Date(end.getFullYear(), end.getMonth(), 1));
      // A date the caller made up reaches Mongo as an Invalid Date and comes
      // back as a 500; it is a bad request, and saying so is more use.
      if ([start, end].some(d => Number.isNaN(d?.getTime?.()))) {
        return res.status(400).json({ success: false, error: 'Those dates are not readable. Use YYYY-MM-DD.' });
      }
      if (end < start) {
        return res.status(400).json({ success: false, error: 'The statement period ends before it starts.' });
      }

      // Every order this client was ever charged for. A statement that only
      // fetched the window could not know what was carried into it.
      const orders = await Order.find({
        businessType: BUSINESS_TYPE,
        ...tenantScope(req),
        ...orderMatchesClient(req.params.id),
        status: LIVE_STATUSES,
        createdAt: { $lte: end },
      }, {
        orderNumber: 1, billingNumber: 1, orNumber: 1, status: 1, total: 1, createdAt: 1,
        paymentMethod: 1, isComplimentary: 1, arSettled: 1, arPaidAmount: 1, refundedAmount: 1, arPayments: 1, refundHistory: 1,
        dueDate: 1,
      }).sort({ createdAt: 1 }).lean();

      // A charge is what went onto the account: a credit sale that is neither
      // complimentary nor settled in cash at the counter.
      const isCharge = (o) => o.paymentMethod !== 'Cash' && o.isComplimentary !== true;

      // Every movement, charges and payments alike, on one timeline.
      const moves = [];
      for (const o of orders) {
        if (!isCharge(o)) continue;
        moves.push({
          at: o.createdAt,
          kind: 'charge',
          reference: o.billingNumber || o.orderNumber || '',
          orNumber: o.orNumber || '',
          description: `Order ${o.orderNumber || ''}`.trim(),
          dueDate: o.dueDate || null,
          charge: Math.round((Number(o.total) || 0) * 100) / 100,
          payment: 0,
        });
        if ((Number(o.refundedAmount) || 0) > 0) {
          // Dated at the refund itself where we know it, so the running balance
          // drops on the day the credit was actually given.
          const lastRefund = (o.refundHistory || [])
            .filter(r => !String(r.reason || '').startsWith('EXCHANGE:'))
            .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
          moves.push({
            at: lastRefund?.at || o.createdAt,
            kind: 'credit',
            reference: lastRefund?.reference || '',
            description: `Refund on ${o.billingNumber || o.orderNumber || 'account'}${lastRefund?.reason ? ` - ${lastRefund.reason}` : ''}`,
            charge: 0,
            payment: Math.round((Number(o.refundedAmount) || 0) * 100) / 100,
          });
        }
        for (const pmt of (o.arPayments || [])) {
          moves.push({
            at: pmt.collectionDate || pmt.createdAt || o.createdAt,
            kind: 'payment',
            reference: pmt.referenceNumber || '',
            description: `Payment on ${o.billingNumber || o.orderNumber || 'account'}${pmt.paymentMethod ? ` (${pmt.paymentMethod})` : ''}`,
            charge: 0,
            payment: Math.round((Number(pmt.amount) || 0) * 100) / 100,
          });
        }
      }
      moves.sort((a, b) => new Date(a.at) - new Date(b.at));

      const r2 = (n) => Math.round(n * 100) / 100;
      // Brought forward: everything that happened before the window opened.
      let opening = 0;
      for (const m of moves) {
        if (new Date(m.at) >= start) break;
        opening = r2(opening + m.charge - m.payment);
      }

      // The window itself, with the balance carried down each line - the column
      // a client reads first when checking a statement against their own books.
      let running = opening;
      const rows = [];
      let charges = 0, payments = 0;
      for (const m of moves) {
        const at = new Date(m.at);
        if (at < start || at > end) continue;
        running = r2(running + m.charge - m.payment);
        charges = r2(charges + m.charge);
        payments = r2(payments + m.payment);
        rows.push({ ...m, at, balance: running });
      }
      const closing = running;

      // Ageing of what is still open as of the statement date, so the client can
      // see which of it is overdue rather than just the total.
      const openCharges = orders
        .filter(o => isCharge(o) && isReceivableStatus(o.status) && o.arSettled !== true)
        .map(o => ({ createdAt: o.createdAt, total: r2((Number(o.total) || 0) - (Number(o.refundedAmount) || 0) - (Number(o.arPaidAmount) || 0)) }))
        .filter(o => o.total > 0.005);
      const aged = ageingBuckets(openCharges, end);

      // Money they have already handed over that is not yet against an order -
      // it offsets what the statement says they owe.
      let deposits = 0;
      if (ctx.Advance) {
        const deps = await ctx.Advance.find({
          businessType: BUSINESS_TYPE, ...tenantScope(req),
          type: 'customer', clientId: String(client._id), status: { $in: ['Open', 'Partially Liquidated'] },
        }, { amount: 1, liquidatedAmount: 1 }).lean();
        deposits = r2(deps.reduce((t, d) => t + (Number(d.amount) || 0) - (Number(d.liquidatedAmount) || 0), 0));
      }

      res.json({
        success: true,
        client: {
          _id: String(client._id), name: client.name, clientCode: client.clientCode,
          phone: client.phone || '', email: client.email || '',
          tin: client.tin || '', registeredName: client.registeredName || '',
          registeredAddress: client.registeredAddress || '',
          creditTermsDays: client.creditTermsDays ?? null,
        },
        period: { start, end },
        openingBalance: opening,
        rows,
        totals: { charges, payments },
        closingBalance: closing,
        aged,
        deposits,
        netDue: r2(closing - deposits),
      });
    } catch (err) {
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

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
        createdAt: 1, arSettled: 1, items: 1, arPaidAmount: 1, refundedAmount: 1,
      }).sort({ createdAt: -1 }).limit(limit).lean();

      res.json({
        success: true,
        orders: orders.map(o => ({ ...o, itemCount: (o.items || []).length, items: undefined })),
      });
    } catch (err) {
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });
}
