// Four small things a cafe keeps that the books do not: tips, a stamp card for
// regulars, what customers thought of their order, and what to prepare for
// tomorrow. None of them posts to the ledger or moves stock.
//
//   Tips       what was left for the staff, and each payout of the pool
//   Loyalty    stamps on a phone number; so many stamps earn a reward
//   Feedback   a rating and a comment, left from the table QR after ordering
//   Prep list  what usually sells on that weekday, to prepare ahead
//
// A logistics business has none of these - its customers sign in and order on
// account - so every route here is refused there (cafeOnly).
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { businessDateStr, businessTimeZone } from '../lib/businessTime.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const DEFAULT_STAMPS_PER_REWARD = 10;

export default function registerCafeExtras(ctx) {
  const {
    app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope, Order, Settings, logAudit,
    verifyToken, requireStaff, requirePermission,
  } = ctx;
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  const cafeOnly = (req, res, next) => (BUSINESS_TYPE === 'fb' ? next() : res.status(404).json({ success: false, error: 'This is part of the cafe app only.' }));
  const windowOf = (q) => {
    const today = businessDateStr(new Date());
    const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    const startKey = ok(q.start) ? String(q.start) : `${today.slice(0, 8)}01`;
    const endKey = ok(q.end) ? String(q.end) : today;
    return { startKey, endKey, from: dayStart(startKey), to: dayEnd(endKey) };
  };
  const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

  // ── TIPS ───────────────────────────────────────────────────────────────────
  // A record, not an accounting entry: tips are the staff's money passing
  // through, not the shop's income, so nothing is posted. What this keeps is
  // the pool - tips taken in and not yet shared out - and each payout: who got
  // how much, and who handed it over. A tip in a payout cannot be removed.
  const Tip = model('Tip', new mongoose.Schema({
    businessType: { type: String, index: true },
    date: { type: Date, required: true, index: true },
    amount: { type: Number, required: true },
    method: { type: String, default: 'Cash' },
    note: { type: String, default: '' },
    recordedBy: { type: String, default: '' },
    payoutId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  }, { timestamps: true }));
  const TipPayout = model('TipPayout', new mongoose.Schema({
    businessType: { type: String, index: true },
    date: { type: Date, required: true },
    total: { type: Number, required: true },
    shares: [{ name: String, amount: Number }],
    note: { type: String, default: '' },
    paidBy: { type: String, default: '' },
  }, { timestamps: true }));
  const canTips = [cafeOnly, verifyToken, requireStaff, requirePermission('shifts.view')];

  app.get('/api/tips', ...canTips, async (req, res) => {
    try {
      const { startKey, endKey, from, to } = windowOf(req.query);
      const [tips, pool, payouts] = await Promise.all([
        Tip.find({ businessType: BUSINESS_TYPE, date: { $gte: from, $lte: to } }).sort({ date: -1 }).limit(1000).lean(),
        Tip.aggregate([{ $match: { businessType: BUSINESS_TYPE, payoutId: null } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        TipPayout.find({ businessType: BUSINESS_TYPE, date: { $gte: from, $lte: to } }).sort({ date: -1 }).limit(200).lean(),
      ]);
      res.json({
        success: true, start: startKey, end: endKey, tips, payouts,
        collected: r2(tips.reduce((t, x) => t + x.amount, 0)),
        // Everything not yet shared out, whenever it was taken - not just this window.
        pool: r2(pool[0]?.total), poolCount: pool[0]?.count || 0,
      });
    } catch (err) { fail(req, res, err); }
  });

  app.post('/api/tips', ...canTips, async (req, res) => {
    try {
      const amount = r2(req.body?.amount);
      if (!(amount > 0) || amount > 1_000_000) return res.status(400).json({ success: false, error: 'Enter the tip amount.' });
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || '')) ? String(req.body.date) : businessDateStr(new Date());
      const date = day === businessDateStr(new Date()) ? new Date() : dayStart(day);
      if (date.getTime() > Date.now() + 60000) return res.status(400).json({ success: false, error: 'A tip cannot be dated in the future.' });
      const tip = await Tip.create({ businessType: BUSINESS_TYPE, date, amount, method: text(req.body?.method, 40) || 'Cash', note: text(req.body?.note, 300), recordedBy: req.user?.name || '' });
      res.json({ success: true, tip });
    } catch (err) { fail(req, res, err); }
  });

  app.delete('/api/tips/:id', ...canTips, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) return res.status(404).json({ success: false, error: 'Tip not found.' });
      const tip = await Tip.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE });
      if (!tip) return res.status(404).json({ success: false, error: 'Tip not found.' });
      if (tip.payoutId) return res.status(409).json({ success: false, error: 'That tip has already been shared out.' });
      await tip.deleteOne();
      try { await logAudit?.(req, { action: 'delete', entity: 'Tip', entityId: tip._id, before: { amount: tip.amount, date: tip.date } }); } catch { /* non-fatal */ }
      res.json({ success: true });
    } catch (err) { fail(req, res, err); }
  });

  // Share out the whole pool. The shares must add up to it exactly - a pool
  // paid out "about right" is how the difference goes missing.
  app.post('/api/tips/payout', ...canTips, requirePermission('scheduling.manage'), async (req, res) => {
    try {
      const shares = (Array.isArray(req.body?.shares) ? req.body.shares : [])
        .map(s => ({ name: text(s?.name, 80), amount: r2(s?.amount) })).filter(s => s.name && s.amount > 0);
      if (!shares.length) return res.status(400).json({ success: false, error: 'Say who gets how much.' });
      const open = await Tip.find({ businessType: BUSINESS_TYPE, payoutId: null }, { amount: 1 }).lean();
      const pool = r2(open.reduce((t, x) => t + x.amount, 0));
      if (!(pool > 0)) return res.status(409).json({ success: false, error: 'There are no tips waiting to be shared out.' });
      const given = r2(shares.reduce((t, s) => t + s.amount, 0));
      if (given !== pool) return res.status(400).json({ success: false, error: `The shares add up to ${given.toFixed(2)}, but the pool is ${pool.toFixed(2)}. They must match exactly.` });
      const payout = await TipPayout.create({ businessType: BUSINESS_TYPE, date: new Date(), total: pool, shares, note: text(req.body?.note, 300), paidBy: req.user?.name || '' });
      // Only the tips counted above: one recorded while this ran stays in the pool.
      await Tip.updateMany({ _id: { $in: open.map(t => t._id) }, payoutId: null }, { $set: { payoutId: payout._id } });
      try { await logAudit?.(req, { action: 'create', entity: 'TipPayout', entityId: payout._id, after: { total: pool, shares } }); } catch { /* non-fatal */ }
      res.json({ success: true, payout });
    } catch (err) { fail(req, res, err); }
  });

  // ── LOYALTY ────────────────────────────────────────────────────────────────
  // A stamp card kept on a phone number. Every so many stamps is one reward;
  // redeeming takes one reward off. It records the visits and the rewards -
  // giving the free drink is still a complimentary order at the till, with its
  // own reason, so the stock and the books see it there.
  const loyaltySchema = new mongoose.Schema({
    businessType: { type: String, index: true },
    phone: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    stamps: { type: Number, default: 0 },          // lifetime stamps
    redeemed: { type: Number, default: 0 },        // rewards already given
    history: [{ at: { type: Date, default: Date.now }, action: String, stamps: Number, by: String, ref: String }],
  }, { timestamps: true });
  // One card per phone number. Declared before the model is made: an index
  // added to a schema afterwards is never built, and two tills stamping a new
  // number at the same moment would then each start a card.
  loyaltySchema.index({ businessType: 1, phone: 1 }, { unique: true });
  const LoyaltyCard = model('LoyaltyCard', loyaltySchema);
  const canLoyalty = [cafeOnly, verifyToken, requireStaff, requirePermission('pos.use')];
  // 0917 123 4567, +63 917 123 4567 and 9171234567 are one card.
  const phoneKey = (v) => {
    let d = String(v ?? '').replace(/\D/g, '');
    if (d.startsWith('63') && d.length === 12) d = d.slice(2);
    if (d.startsWith('0') && d.length === 11) d = d.slice(1);
    return d.length >= 7 && d.length <= 12 ? d : '';
  };
  const perReward = async () => {
    const n = Math.round(Number((await Settings.findOne({ key: 'loyaltyStampsPerReward' }).lean())?.value));
    return n >= 2 && n <= 100 ? n : DEFAULT_STAMPS_PER_REWARD;
  };
  const cardView = (c, per) => {
    const earned = Math.floor((c.stamps || 0) / per);
    return {
      phone: c.phone, name: c.name || '', stamps: c.stamps || 0, perReward: per,
      rewardsAvailable: Math.max(0, earned - (c.redeemed || 0)), rewardsRedeemed: c.redeemed || 0,
      // Stamps on the card being filled now, and how many more fill it.
      onCard: (c.stamps || 0) % per, toNext: per - ((c.stamps || 0) % per),
      history: (c.history || []).slice(-10).reverse(),
    };
  };

  app.get('/api/loyalty/settings', ...canLoyalty, async (req, res) => {
    try { res.json({ success: true, perReward: await perReward() }); } catch (err) { fail(req, res, err); }
  });
  app.put('/api/loyalty/settings', cafeOnly, verifyToken, requireStaff, requirePermission('settings.manage'), async (req, res) => {
    try {
      const n = Math.round(Number(req.body?.perReward));
      if (!(n >= 2 && n <= 100)) return res.status(400).json({ success: false, error: 'Stamps for a reward must be between 2 and 100.' });
      await Settings.findOneAndUpdate({ key: 'loyaltyStampsPerReward' }, { key: 'loyaltyStampsPerReward', value: n }, { upsert: true });
      res.json({ success: true, perReward: n });
    } catch (err) { fail(req, res, err); }
  });

  app.get('/api/loyalty/card', ...canLoyalty, async (req, res) => {
    try {
      const phone = phoneKey(req.query.phone);
      if (!phone) return res.status(400).json({ success: false, error: 'Enter the phone number.' });
      const per = await perReward();
      const card = await LoyaltyCard.findOne({ businessType: BUSINESS_TYPE, phone }).lean();
      res.json({ success: true, found: !!card, card: cardView(card || { phone }, per) });
    } catch (err) { fail(req, res, err); }
  });

  app.post('/api/loyalty/stamp', ...canLoyalty, async (req, res) => {
    try {
      const phone = phoneKey(req.body?.phone);
      if (!phone) return res.status(400).json({ success: false, error: 'Enter the phone number.' });
      const stamps = Math.round(Number(req.body?.stamps) || 1);
      if (!(stamps >= 1 && stamps <= 20)) return res.status(400).json({ success: false, error: 'Between 1 and 20 stamps at a time.' });
      const name = text(req.body?.name, 80);
      const stampIt = () => LoyaltyCard.findOneAndUpdate(
        { businessType: BUSINESS_TYPE, phone },
        { $inc: { stamps }, ...(name ? { $set: { name } } : {}), $setOnInsert: { businessType: BUSINESS_TYPE, phone },
          $push: { history: { $each: [{ at: new Date(), action: 'stamp', stamps, by: req.user?.name || '', ref: text(req.body?.orderNumber, 40) }], $slice: -100 } } },
        { upsert: true, new: true },
      ).lean();
      // Two tills starting the same new card at once: one creates it, the
      // other is refused by the unique index - and simply stamps the card that
      // now exists, instead of showing the cashier an error.
      const card = await stampIt().catch((e) => { if (e?.code === 11000) return stampIt(); throw e; });
      res.json({ success: true, card: cardView(card, await perReward()) });
    } catch (err) { fail(req, res, err); }
  });

  app.post('/api/loyalty/redeem', ...canLoyalty, async (req, res) => {
    try {
      const phone = phoneKey(req.body?.phone);
      if (!phone) return res.status(400).json({ success: false, error: 'Enter the phone number.' });
      const per = await perReward();
      const card = await LoyaltyCard.findOne({ businessType: BUSINESS_TYPE, phone });
      if (!card) return res.status(404).json({ success: false, error: 'No card for that number yet.' });
      const earned = Math.floor((card.stamps || 0) / per);
      const already = card.redeemed || 0;
      if (earned <= already) return res.status(409).json({ success: false, error: `No reward yet - ${per - ((card.stamps || 0) % per)} more stamp(s) to go.` });
      // Guarded on the count it was read with: two tills redeeming the same
      // last reward at once cannot both succeed.
      const done = await LoyaltyCard.findOneAndUpdate(
        { _id: card._id, redeemed: already },
        { $inc: { redeemed: 1 }, $push: { history: { $each: [{ at: new Date(), action: 'redeem', stamps: 0, by: req.user?.name || '', ref: '' }], $slice: -100 } } },
        { new: true },
      ).lean();
      if (!done) return res.status(409).json({ success: false, error: 'That reward was just redeemed at another till.' });
      res.json({ success: true, card: cardView(done, per) });
    } catch (err) { fail(req, res, err); }
  });

  // ── FEEDBACK ───────────────────────────────────────────────────────────────
  // Left from the table QR after ordering, with no account - so it is tied to
  // a real order of the last day, once per order. That is what keeps it from
  // being a public comment box anyone can fill.
  const Feedback = model('Feedback', new mongoose.Schema({
    businessType: { type: String, index: true },
    orderId: { type: String, required: true, unique: true },
    orderNumber: String, table: String,
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
  }, { timestamps: true }));

  app.post('/api/feedback', cafeOnly, async (req, res) => {
    try {
      const orderId = String(req.body?.orderId || '');
      const rating = Math.round(Number(req.body?.rating));
      if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ success: false, error: 'That order was not found.' });
      if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ success: false, error: 'Choose 1 to 5 stars.' });
      const order = await Order.findOne({ _id: orderId, businessType: BUSINESS_TYPE }, { orderNumber: 1, table: 1, createdAt: 1, status: 1 }).lean();
      if (!order || Date.now() - new Date(order.createdAt).getTime() > 24 * 3600000) return res.status(400).json({ success: false, error: 'That order was not found.' });
      if (['Cancelled', 'Voided'].includes(order.status)) return res.status(400).json({ success: false, error: 'That order was cancelled.' });
      try {
        await Feedback.create({ businessType: BUSINESS_TYPE, orderId, orderNumber: order.orderNumber, table: order.table || '', rating, comment: text(req.body?.comment, 500) });
      } catch (e) {
        if (e?.code === 11000) return res.status(409).json({ success: false, error: 'Thanks - you have already rated this order.' });
        throw e;
      }
      res.json({ success: true });
    } catch (err) { fail(req, res, err); }
  });

  app.get('/api/reports/feedback', cafeOnly, verifyToken, requireStaff, requirePermission('reports.view'), requirePermission('screen.reports.feedback'), async (req, res) => {
    try {
      const { startKey, endKey, from, to } = windowOf(req.query);
      const rows = await Feedback.find({ businessType: BUSINESS_TYPE, createdAt: { $gte: from, $lte: to } }).sort({ createdAt: -1 }).limit(2000).lean();
      const counts = [1, 2, 3, 4, 5].map(n => ({ stars: n, count: rows.filter(r => r.rating === n).length }));
      res.json({
        success: true, start: startKey, end: endKey, count: rows.length,
        average: rows.length ? Math.round((rows.reduce((t, r) => t + r.rating, 0) / rows.length) * 100) / 100 : null,
        counts, low: rows.filter(r => r.rating <= 2).length,
        entries: rows.slice(0, 300).map(r => ({ at: r.createdAt, orderNumber: r.orderNumber, table: r.table, rating: r.rating, comment: r.comment })),
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── PREP LIST ──────────────────────────────────────────────────────────────
  // What usually sells on that weekday: each product's average over the last
  // few of the same weekday, rounded up, with the most and the least it sold
  // on one of them. A guide for what to prepare ahead - weather, a holiday or
  // a promo will still move it.
  app.get('/api/reports/prep-list', cafeOnly, verifyToken, requireStaff, requirePermission('reports.view'), requirePermission('screen.reports.preplist'), async (req, res) => {
    try {
      const today = businessDateStr(new Date());
      const tomorrow = businessDateStr(new Date(dayStart(today).getTime() + 26 * 3600000));
      const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : tomorrow;
      const weeks = Math.min(8, Math.max(2, Math.round(Number(req.query.weeks) || 4)));
      const target = dayStart(dateKey);
      // The same weekday, one to `weeks` weeks before the target, that have already happened.
      const days = Array.from({ length: weeks }, (_, i) => businessDateStr(new Date(target.getTime() - (i + 1) * 7 * 86400000 + 12 * 3600000)))
        .filter(d => d < today || (d === today && dateKey !== today));
      if (!days.length) return res.json({ success: true, date: dateKey, weekday: '', days: [], products: [], note: 'No earlier day of that weekday to go by yet.' });
      const timezone = businessTimeZone();
      const rows = await Order.aggregate([
        { $match: { businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Completed', $or: days.map(d => ({ createdAt: { $gte: dayStart(d), $lte: dayEnd(d) } })) } },
        { $unwind: '$items' },
        { $group: { _id: { name: '$items.name', day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone } } }, qty: { $sum: '$items.quantity' } } },
      ]);
      const byName = new Map();
      for (const r of rows) {
        if (!r._id.name) continue;
        const p = byName.get(r._id.name) || { name: r._id.name, perDay: {} };
        p.perDay[r._id.day] = (p.perDay[r._id.day] || 0) + r.qty;
        byName.set(r._id.name, p);
      }
      const products = [...byName.values()].map((p) => {
        const each = days.map(d => p.perDay[d] || 0);           // a day it did not sell counts as zero
        const average = each.reduce((t, n) => t + n, 0) / days.length;
        return { name: p.name, average: Math.round(average * 10) / 10, prepare: Math.ceil(average), most: Math.max(...each), least: Math.min(...each), soldOn: each.filter(n => n > 0).length };
      }).filter(p => p.prepare > 0).sort((a, b) => b.average - a.average);
      res.json({
        success: true, date: dateKey, weekday: target.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone }),
        days, products: products.slice(0, 300), totalToPrepare: products.reduce((t, p) => t + p.prepare, 0),
      });
    } catch (err) { fail(req, res, err); }
  });
}
