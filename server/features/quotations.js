// Quotations: a price asked for, not a sale made.
//
//   client requests  ->  business prices it  ->  client accepts  ->  real order
//                                            ->  client declines ->  closed
//
// The rule this module exists to keep: a quotation posts NOTHING. No revenue,
// no receivable, no stock movement, no journal entry. It is a conversation
// about a price. Only acceptance creates an Order, through the same route
// every other order goes through, so the accounting is the accounting that is
// already proven rather than a second implementation of it.
//
// That is also why this is its own collection instead of an Order status: an
// order-shaped quote would have to be excluded by every sales report, the EOD
// close, the P&L and the A/R list, and the first one that forgot would show
// revenue for something nobody had agreed to buy.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';

export default function registerQuotations(ctx) {
  const {
    app, mongoose, IS_PROD, log, BUSINESS_TYPE, tenantScope, logAudit,
    Quotation, ClientAccount, Product, Order,
    mkSeqRef, currentBranchCode, emitToMgr,
    verifyToken, requireStaff, requirePermission, verifyClientToken,
  } = ctx;

  const canView = [requireStaff, requirePermission('orders.view')];
  const canQuote = [requireStaff, requirePermission('orders.manage')];

  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const clientIdOf = (req) => req.user?.clientId || req.user?._id;

  // The total the business has actually quoted. Null prices mean the quote is
  // not finished, so there is no total to show yet - deliberately not treated
  // as zero, which would read as "free".
  const quotedTotal = (q) => {
    const priced = (q.lines || []).filter(l => l.quotedPrice != null);
    if (priced.length !== (q.lines || []).length || priced.length === 0) return null;
    return money(priced.reduce((s, l) => s + (l.quotedPrice * (l.quantity || 1)), 0));
  };

  // A quote past its own validity date is not a live price any more, whatever
  // the stored status says. Computed on read rather than by a scheduled job:
  // a job that has not run yet would leave an expired price acceptable.
  const decorate = (q) => {
    const expired = q.status === 'Quoted' && q.validUntil && new Date(q.validUntil) < new Date();
    return {
      ...q,
      status: expired ? 'Expired' : q.status,
      quotedTotal: quotedTotal(q),
      askedTotal: money((q.lines || []).reduce((s, l) => s + ((l.askedPrice || 0) * (l.quantity || 1)), 0)),
    };
  };

  // ── THE CLIENT SIDE ───────────────────────────────────────────────────────
  app.post('/api/client/quotations', verifyClientToken, async (req, res) => {
    try {
      const clientId = clientIdOf(req);
      if (!clientId || req.user?.role !== 'client') {
        return res.status(403).json({ success: false, error: 'Client session required.' });
      }
      const client = await ClientAccount.findById(clientId, { name: 1, username: 1 }).lean();
      if (!client) return res.status(404).json({ success: false, error: 'Client account not found.' });

      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (items.length === 0) return res.status(400).json({ success: false, error: 'Add at least one item to ask about.' });

      const lines = [];
      for (const it of items) {
        const name = String(it?.name || '').trim();
        if (!name) continue;
        const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
        lines.push({
          productId: mongoose.Types.ObjectId.isValid(it.productId || '') ? it.productId : null,
          name, quantity: qty,
          askedPrice: money(it.price),
          note: String(it.note || '').slice(0, 200),
        });
      }
      if (lines.length === 0) return res.status(400).json({ success: false, error: 'Nothing on that request could be read.' });

      const quotation = await Quotation.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        branchCode: await currentBranchCode(),
        quoteNumber: await mkSeqRef('QUO'),
        clientAccountId: clientId,
        clientName: client.name || client.username || 'Client',
        lines,
        clientNotes: String(req.body?.notes || '').slice(0, 1000),
      });

      emitToMgr?.('erpUpdated');
      res.json({
        success: true, quotation: decorate(quotation.toObject()),
        note: 'Nothing has been ordered or charged. We will price this and send it back to you.',
      });
    } catch (err) {
      log.error?.({ err }, 'POST /api/client/quotations failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  app.get('/api/client/quotations', verifyClientToken, async (req, res) => {
    try {
      const clientId = clientIdOf(req);
      if (!clientId || req.user?.role !== 'client') {
        return res.status(403).json({ success: false, error: 'Client session required.' });
      }
      const rows = await Quotation.find({
        businessType: BUSINESS_TYPE, clientAccountId: clientId,
      }).sort({ createdAt: -1 }).limit(100).lean();
      res.json({ success: true, quotations: rows.map(decorate) });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Accepting is the moment it becomes real. Everything before this was talk.
  app.post('/api/client/quotations/:id/accept', verifyClientToken, async (req, res) => {
    try {
      const clientId = clientIdOf(req);
      if (!clientId || req.user?.role !== 'client') {
        return res.status(403).json({ success: false, error: 'Client session required.' });
      }
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });

      const q = await Quotation.findOne({ _id: req.params.id, clientAccountId: clientId });
      if (!q) return res.status(404).json({ success: false, error: 'Not found' });
      if (q.status !== 'Quoted') {
        return res.status(409).json({ success: false, error: `Only a quoted price can be accepted (this one is ${q.status}).` });
      }
      if (q.validUntil && new Date(q.validUntil) < new Date()) {
        return res.status(409).json({ success: false, error: 'That quote has expired. Ask for a new one.' });
      }
      const total = quotedTotal(q.toObject());
      if (total == null) {
        return res.status(409).json({ success: false, error: 'That quote is not fully priced yet.' });
      }

      // The order carries the QUOTED prices, not the list prices. That is the
      // whole point of having quoted: the client accepted a specific number,
      // and charging anything else would be a different agreement.
      const items = q.lines.map(l => ({
        productId: l.productId ? String(l.productId) : undefined,
        name: l.name,
        price: money(l.quotedPrice),
        quantity: l.quantity || 1,
      }));

      q.status = 'Accepted';
      q.respondedAt = new Date();
      await q.save();

      await logAudit(req, { action: 'accept', entity: 'Quotation', entityId: q._id, after: { quoteNumber: q.quoteNumber, total } });
      emitToMgr?.('erpUpdated');
      // The caller places the order through the ordinary route with these
      // items, so every price rule, stock check and posting behaves exactly as
      // it does for any other order. Doing it here would be a second, unproven
      // path to the same ledger.
      res.json({
        success: true, quotation: decorate(q.toObject()), items, total,
        note: 'Accepted. Place it as an order to confirm.',
      });
    } catch (err) {
      log.error?.({ err }, 'POST /api/client/quotations/:id/accept failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  app.post('/api/client/quotations/:id/decline', verifyClientToken, async (req, res) => {
    try {
      const clientId = clientIdOf(req);
      if (!clientId || req.user?.role !== 'client') {
        return res.status(403).json({ success: false, error: 'Client session required.' });
      }
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const q = await Quotation.findOne({ _id: req.params.id, clientAccountId: clientId });
      if (!q) return res.status(404).json({ success: false, error: 'Not found' });
      if (!['Requested', 'Quoted'].includes(q.status)) {
        return res.status(409).json({ success: false, error: `That quotation is already ${q.status}.` });
      }
      q.status = 'Declined';
      q.respondedAt = new Date();
      q.declineReason = String(req.body?.reason || '').slice(0, 300);
      await q.save();
      res.json({ success: true, quotation: decorate(q.toObject()) });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── THE BUSINESS SIDE ─────────────────────────────────────────────────────
  app.get('/api/quotations', verifyToken, ...canView, async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.status) q.status = req.query.status;
      if (req.query.clientId && mongoose.Types.ObjectId.isValid(req.query.clientId)) {
        q.clientAccountId = req.query.clientId;
      }
      if (req.query.start || req.query.end) {
        q.createdAt = {};
        if (req.query.start) q.createdAt.$gte = dayStart(req.query.start);
        if (req.query.end) q.createdAt.$lte = dayEnd(req.query.end);
      }
      const rows = (await Quotation.find(q).sort({ createdAt: -1 }).limit(300).lean()).map(decorate);
      res.json({
        success: true, quotations: rows,
        counts: {
          waiting: rows.filter(r => r.status === 'Requested').length,
          quoted: rows.filter(r => r.status === 'Quoted').length,
          accepted: rows.filter(r => r.status === 'Accepted').length,
        },
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.get('/api/quotations/:id', verifyToken, ...canView, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const q = await Quotation.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!q) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, quotation: decorate(q) });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Pricing it and sending it back.
  app.post('/api/quotations/:id/quote', verifyToken, ...canQuote, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const q = await Quotation.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!q) return res.status(404).json({ success: false, error: 'Not found' });
      if (['Accepted', 'Declined'].includes(q.status)) {
        return res.status(409).json({ success: false, error: `That quotation is already ${q.status}.` });
      }

      const prices = Array.isArray(req.body?.lines) ? req.body.lines : [];
      const byIndex = new Map(prices.map(l => [Number(l.index), l]));
      for (let i = 0; i < q.lines.length; i++) {
        const p = byIndex.get(i);
        if (!p) continue;
        if (p.quotedPrice != null && p.quotedPrice !== '') {
          const v = money(p.quotedPrice);
          if (v < 0) return res.status(400).json({ success: false, error: `Line ${i + 1}: a price cannot be negative.` });
          q.lines[i].quotedPrice = v;
        }
        if (p.note !== undefined) q.lines[i].note = String(p.note).slice(0, 200);
      }
      q.markModified('lines');

      // Every line priced, or it is not a quote yet - a half-priced quote sent
      // to a client is a number they cannot act on.
      if (q.lines.some(l => l.quotedPrice == null)) {
        return res.status(400).json({ success: false, error: 'Price every line before sending the quote.' });
      }

      if (req.body?.validUntil) {
        const until = dayEnd(req.body.validUntil);
        if (Number.isNaN(until.getTime())) return res.status(400).json({ success: false, error: 'Invalid validity date.' });
        q.validUntil = until;
      }
      if (req.body?.quoteNotes !== undefined) q.quoteNotes = String(req.body.quoteNotes).slice(0, 1000);

      q.status = 'Quoted';
      q.quotedBy = req.user?.name || '';
      q.quotedAt = new Date();
      await q.save();

      await logAudit(req, { action: 'update', entity: 'Quotation', entityId: q._id, after: { quoteNumber: q.quoteNumber, quoted: quotedTotal(q.toObject()) } });
      res.json({ success: true, quotation: decorate(q.toObject()) });
    } catch (err) {
      log.error?.({ err }, 'POST /api/quotations/:id/quote failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // Recording the order a quote turned into, so the two are tied together and
  // a quote can never be spent twice.
  app.post('/api/quotations/:id/link-order', verifyToken, ...canQuote, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const q = await Quotation.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!q) return res.status(404).json({ success: false, error: 'Not found' });
      if (q.orderId) return res.status(409).json({ success: false, error: `That quotation is already on order ${q.orderNumber}.` });

      const order = await Order.findById(req.body?.orderId).lean();
      if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
      q.orderId = order._id;
      q.orderNumber = order.orderNumber || '';
      if (q.status === 'Quoted') { q.status = 'Accepted'; q.respondedAt = new Date(); }
      await q.save();
      res.json({ success: true, quotation: decorate(q.toObject()) });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
