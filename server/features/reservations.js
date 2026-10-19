// Stock reservations - holding goods for a client who has committed to them.
//
// See the ReservationSchema comment in server.js for why this exists. The rule
// this file enforces is simple and lives in one place: Inventory.reservedQty is
// the sum of every Open reservation's outstanding quantity, and nothing else
// may move it. Every path that opens, releases, cancels or expires a
// reservation adjusts reservedQty in the same breath, so the two can never
// drift apart.
import { captureError } from '../lib/errorLog.js';

export default function registerReservations(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    log,
    mkSeqRef,
    currentBranchCode,
    tenantScope,
    logAudit,
    BUSINESS_TYPE,
    Reservation,
    Inventory,
    Order,
    ClientAccount,
    Settings,
    emitToMgr,
    verifyToken,
    requireStaff,
    requirePermission,
  } = ctx;

  const canView = [requireStaff, requirePermission('inventory.view')];
  const canManage = [requireStaff, requirePermission('inventory.manage')];
  const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
  const outstandingOf = (r) => r6((r.items || []).reduce((s, i) => s + (Number(i.qty) || 0) - (Number(i.releasedQty) || 0), 0));

  // Free what a reservation is still holding and close it. Used by release,
  // cancel, expiry and order completion alike - one exit, so reservedQty can
  // never be left holding stock for a closed reservation.
  const closeReservation = async (reservation, { status, by = '', reason = '', session = null }) => {
    for (const line of reservation.items || []) {
      const left = r6((Number(line.qty) || 0) - (Number(line.releasedQty) || 0));
      if (left > 0) {
        await Inventory.updateOne({ _id: line.invId }, { $inc: { reservedQty: -left } }, session ? { session } : {});
        line.releasedQty = line.qty;
      }
    }
    reservation.status = status;
    reservation.closedBy = by;
    reservation.closedAt = new Date();
    reservation.closeReason = reason;
    await reservation.save(session ? { session } : {});
    return reservation;
  };

  // Reservations whose date has passed are not holding anything anyone intends
  // to honour. Swept lazily off the routes that care, the same way overdue
  // drawer sessions are - a timer firing while the shop is shut frees nothing
  // that could not wait, and a lazy sweep is testable.
  const sweepExpired = async () => {
    const due = await Reservation.find({
      businessType: BUSINESS_TYPE, status: 'Open',
      expiresAt: { $ne: null, $lte: new Date() },
    });
    for (const r of due) {
      await closeReservation(r, { status: 'Expired', by: 'System', reason: 'Reservation period ended' });
      emitToMgr('mgrAlert', {
        kind: 'reservationExpired', ref: r.reservationNumber,
        message: `Reservation ${r.reservationNumber} for ${r.clientName || 'a client'} expired - the stock is back on sale.`,
      });
    }
    return due.length;
  };
  ctx.sweepExpiredReservations = sweepExpired;

  // Releasing what an order is holding, just before it deducts stock. Exposed
  // on ctx so order completion can call it inside its own transaction: the
  // client's own reservation must never block the sale it was made for.
  ctx.releaseReservationsForOrder = async (orderId, { by = '', session = null } = {}) => {
    if (!orderId) return 0;
    const held = await Reservation.find({ businessType: BUSINESS_TYPE, orderId, status: 'Open' }).session(session ?? null);
    for (const r of held) await closeReservation(r, { status: 'Released', by, reason: 'Order completed', session });
    return held.length;
  };

  const defaultDays = async () => {
    const row = await Settings.findOne({ key: 'reservationDays' }).lean();
    const n = Number(row?.value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
  };

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get('/api/reservations', verifyToken, ...canView, async (req, res) => {
    try {
      await sweepExpired();
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.status) q.status = req.query.status;
      if (req.query.clientId) q.clientId = String(req.query.clientId);
      const rows = await Reservation.find(q).sort({ createdAt: -1 }).limit(300).lean();
      res.json({
        success: true,
        reservations: rows.map(r => ({ ...r, outstanding: outstandingOf(r) })),
        defaultDays: await defaultDays(),
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── CREATE ──────────────────────────────────────────────────────────────────
  // Body: { clientId?, clientName?, orderId?, items: [{ invId, qty }], expiresAt?, note?, advanceId? }
  // With an orderId and no items, the order's own lines are held.
  app.post('/api/reservations', verifyToken, ...canManage, async (req, res) => {
    try {
      await sweepExpired();
      const { clientId, orderId, items, expiresAt, note, advanceId } = req.body || {};

      let order = null;
      if (orderId) {
        if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ success: false, error: 'Order not found.' });
        order = await Order.findOne({ _id: orderId, businessType: BUSINESS_TYPE, ...tenantScope(req) });
        if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
        if (['Completed', 'Cancelled', 'Voided', 'Refunded'].includes(order.status)) {
          return res.status(409).json({ success: false, error: `A ${String(order.status).toLowerCase()} order has nothing left to hold.` });
        }
        const already = await Reservation.countDocuments({ businessType: BUSINESS_TYPE, orderId: order._id, status: 'Open' });
        if (already) return res.status(409).json({ success: false, error: 'This order already has stock held for it.' });
      }

      // Who it is for. A reservation with no named client is stock held for
      // nobody, which is indistinguishable from stock quietly going missing.
      const buyerId = String(clientId || order?.clientId || order?.clientAccountId || '');
      if (!buyerId || !mongoose.Types.ObjectId.isValid(buyerId)) {
        return res.status(400).json({ success: false, error: 'Stock is held for a named client - pick one.' });
      }
      const client = await ClientAccount.findOne({ _id: buyerId, ...tenantScope(req) }, { name: 1 }).lean();
      if (!client) return res.status(400).json({ success: false, error: 'Client not found.' });

      // The lines. From the request, or from the order being held.
      let wanted = Array.isArray(items) ? items : [];
      if (!wanted.length && order) {
        // Only stocked lines can be held; a made-to-order recipe item has no
        // single inventory row to hold, and pretending otherwise would hold the
        // wrong thing.
        wanted = [];
        for (const line of order.items || []) {
          const inv = await Inventory.findOne({
            businessType: BUSINESS_TYPE, ...tenantScope(req),
            itemName: new RegExp(`^${String(line.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
          }, { _id: 1 }).lean();
          if (inv) wanted.push({ invId: String(inv._id), qty: line.quantity });
        }
        if (!wanted.length) return res.status(400).json({ success: false, error: 'None of this order\'s lines match a stocked item, so there is nothing to hold.' });
      }
      if (!wanted.length) return res.status(400).json({ success: false, error: 'Pick at least one item to hold.' });

      // Check availability for every line BEFORE holding any of it, so a
      // half-applied reservation can never exist.
      const lines = [];
      for (const w of wanted) {
        if (!mongoose.Types.ObjectId.isValid(String(w?.invId))) return res.status(400).json({ success: false, error: 'One of the items does not exist.' });
        const inv = await Inventory.findOne({ _id: w.invId, businessType: BUSINESS_TYPE, ...tenantScope(req) });
        if (!inv) return res.status(400).json({ success: false, error: 'One of the items does not exist.' });
        const qty = r6(w.qty);
        if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ success: false, error: `Invalid quantity for ${inv.itemName}.` });
        const available = r6((inv.stockQty || 0) - (inv.reservedQty || 0));
        if (qty > available + 1e-6) {
          return res.status(409).json({ success: false, error: `Only ${available} of ${inv.itemName} is available to hold (the rest is already sold or held).` });
        }
        lines.push({ invId: inv._id, itemName: inv.itemName, qty });
      }

      const days = await defaultDays();
      let ends = expiresAt ? new Date(expiresAt) : new Date(Date.now() + days * 86400000);
      if (Number.isNaN(ends.getTime())) return res.status(400).json({ success: false, error: 'Invalid expiry date.' });
      if (ends.getTime() <= Date.now()) return res.status(400).json({ success: false, error: 'The hold has to end in the future.' });

      for (const line of lines) {
        await Inventory.updateOne({ _id: line.invId }, { $inc: { reservedQty: line.qty } });
      }

      const reservation = await Reservation.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        reservationNumber: await mkSeqRef('RSV'),
        branchCode: await currentBranchCode(),
        clientId: String(client._id), clientName: client.name,
        orderId: order?._id || null, orderNumber: order?.orderNumber || '',
        advanceId: advanceId && mongoose.Types.ObjectId.isValid(advanceId) ? advanceId : null,
        items: lines, expiresAt: ends,
        note: String(note || '').trim().slice(0, 300),
        createdBy: req.user?.name || '',
      });

      await logAudit(req, { action: 'create', entity: 'Reservation', entityId: reservation._id, after: { reservationNumber: reservation.reservationNumber, clientName: client.name, items: lines.length, expiresAt: ends } });
      emitToMgr('erpUpdated');
      res.json({ success: true, reservation: { ...reservation.toObject(), outstanding: outstandingOf(reservation) } });
    } catch (err) {
      log.error?.({ err }, 'POST /api/reservations failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── RELEASE / CANCEL ────────────────────────────────────────────────────────
  // Both free the stock; they differ in what they say happened, which is what a
  // later question ("why did we let that go?") actually needs.
  const closeRoute = (path, status) => app.post(path, verifyToken, ...canManage, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const reservation = await Reservation.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!reservation) return res.status(404).json({ success: false, error: 'Not found' });
      if (reservation.status !== 'Open') return res.status(409).json({ success: false, error: `This reservation is already ${reservation.status.toLowerCase()}.` });

      const reason = String(req.body?.reason || '').trim().slice(0, 300);
      if (status === 'Cancelled' && !reason) return res.status(400).json({ success: false, error: 'Say why the hold is being cancelled.' });

      await closeReservation(reservation, { status, by: req.user?.name || '', reason });
      await logAudit(req, { action: status.toLowerCase(), entity: 'Reservation', entityId: reservation._id, after: { reservationNumber: reservation.reservationNumber, reason } });
      emitToMgr('erpUpdated');
      res.json({ success: true, reservation });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
  closeRoute('/api/reservations/:id/release', 'Released');
  closeRoute('/api/reservations/:id/cancel', 'Cancelled');
}
