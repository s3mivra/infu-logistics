// One person's data: find it, export it, erase it (2026-11 audit, M76; the
// Data Privacy Act gives a person the right to a copy and to erasure).
//
// A person is a client account, a walk-in customer (known only by the name or
// phone on their orders), or a staff account. Their details sit on several
// records - the account, orders, reservations, quotations, staff profile - and
// this gathers them in one place.
//
// Erasing is anonymising, not deleting: the sale, its amounts and its number
// are the business's own records and stay; the person's name, phone, address
// and notes come off them. What the law makes the business keep is kept, and
// the result says so:
//   - an SC/PWD cardholder's name and ID on a sale, while the sale is inside
//     the tax retention period (setting privacyRetentionYears, default 10);
//   - a VAT-registered client's registered name, TIN and address, while they
//     have sales inside that period (invoices must carry them);
//   - government numbers copied into payroll records, for three years after
//     the last payroll (Labor Code), sealed at rest.
//
// Permissions: privacy.manage to look up and erase; the export also needs
// Export All. Erasing asks for the password again. All three are audited -
// who did it and to whom, never the data itself.
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { captureError } from '../lib/errorLog.js';
import { requirePermission, hasPermission } from '../lib/authz.js';

const PAYROLL_RETENTION_YEARS = 3;
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const yearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d; };

export default function registerPrivacy(ctx) {
  const {
    app, IS_PROD, BUSINESS_TYPE, verifyToken, requireStaff, tenantScope, logAudit, confirmPassword,
    Order, User, Settings,
  } = ctx;
  const M = (n) => mongoose.model(n);
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  const canPrivacy = [verifyToken, requireStaff, requirePermission('privacy.manage')];

  const retentionYears = async () => {
    const v = Number((await Settings.findOne({ key: 'privacyRetentionYears' }).lean())?.value);
    return Number.isFinite(v) && v >= 1 && v <= 30 ? v : 10;
  };

  // The records that belong to a person -> { kind, label, filters }.
  const resolve = async (req, q) => {
    const type = String(q.type || '');
    const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    if (type === 'client') {
      if (!mongoose.Types.ObjectId.isValid(q.id)) return null;
      const client = await M('ClientAccount').findById(q.id).lean();
      if (!client) return null;
      const id = String(client._id);
      return {
        type, client, label: `${client.name || client.username} (${client.clientCode})`,
        orders: { ...scope, $or: [{ clientAccountId: id }, { clientId: id }] },
        reservations: { clientId: client._id },
        quotations: { clientAccountId: client._id },
      };
    }
    if (type === 'customer') {
      const name = String(q.name || '').trim(), phone = String(q.phone || '').trim();
      if (!name && !phone) return null;
      const who = [
        ...(name ? [{ customerName: { $regex: `^${escapeRe(name)}$`, $options: 'i' } }] : []),
        ...(phone ? [{ customerPhone: phone }] : []),
      ];
      // A walk-in only: an order on a client account belongs to that account.
      const notClient = { $and: [{ $or: [{ clientAccountId: null }, { clientAccountId: { $exists: false } }, { clientAccountId: '' }] }, { $or: [{ clientId: null }, { clientId: { $exists: false } }, { clientId: '' }] }] };
      const nameRe = name ? { $regex: `^${escapeRe(name)}$`, $options: 'i' } : null;
      return {
        type, label: [name, phone].filter(Boolean).join(' · '),
        orders: { ...scope, $or: who, ...notClient },
        reservations: nameRe ? { clientName: nameRe, clientId: null } : null,
        quotations: nameRe ? { clientName: nameRe, clientAccountId: null } : null,
      };
    }
    if (type === 'staff') {
      if (!mongoose.Types.ObjectId.isValid(q.id)) return null;
      const user = await User.findById(q.id).lean();
      if (!user || user.role === 'superadmin') return null;
      return { type, user, label: `${user.name} (${user.userCode || 'staff'})` };
    }
    return null;
  };

  // Everything held about the person, as plain data.
  const gather = async (who) => {
    const orderFields = { orderNumber: 1, createdAt: 1, status: 1, total: 1, paymentMethod: 1, customerName: 1, customerPhone: 1, deliveryAddress: 1, scPwdName: 1, scPwdIdNumber: 1, scPwdKind: 1, table: 1 };
    const out = { person: who.label, type: who.type, gatheredAt: new Date().toISOString() };
    if (who.type === 'client') {
      const c = who.client;
      out.profile = {
        clientCode: c.clientCode, name: c.name, username: c.username, phone: c.phone, email: c.email,
        contactNotes: c.contactNotes, registeredName: c.registeredName, tin: c.tin, registeredAddress: c.registeredAddress,
        isActive: c.isActive, createdAt: c.createdAt, privacyNoticeAcceptedAt: c.privacyNoticeAcceptedAt || null, privacyNoticeVersion: c.privacyNoticeVersion || '',
      };
    }
    if (who.type === 'staff') {
      const u = await User.findById(who.user._id).lean();   // read through the model: sealed fields come back plain
      out.profile = {
        userCode: u.userCode, name: u.name, role: u.role, isEmployee: u.isEmployee, employeeNumber: u.employeeNumber,
        sssNumber: u.sssNumber, philhealthNumber: u.philhealthNumber, pagibigNumber: u.pagibigNumber, tin: u.tin,
        dailyRate: u.dailyRate, createdAt: u.createdAt,
      };
      const runs = await M('PayrollRun').find({ 'lines.employeeId': String(u._id) }, { reference: 1, periodStart: 1, periodEnd: 1, payDate: 1, lines: 1 }).lean();
      out.payroll = runs.flatMap((r) => r.lines.filter((l) => String(l.employeeId) === String(u._id)).map((l) => ({
        reference: r.reference, periodStart: r.periodStart, periodEnd: r.periodEnd, payDate: r.payDate,
        grossPay: l.grossPay, netPay: l.netPay, sss: l.sss, philhealth: l.philhealth, pagibig: l.pagibig, withholdingTax: l.withholdingTax,
      })));
      out.attendance = await M('ClockEntry').find({ staffId: u._id }, { clockIn: 1, clockOut: 1 }).sort({ clockIn: -1 }).limit(2000).lean();
      return out;
    }
    out.orders = await Order.find(who.orders, orderFields).sort({ createdAt: -1 }).limit(5000).lean();
    out.reservations = who.reservations ? await M('Reservation').find(who.reservations, { reservationNumber: 1, clientName: 1, note: 1, status: 1, createdAt: 1 }).lean() : [];
    out.quotations = who.quotations ? await M('Quotation').find(who.quotations, { quoteNumber: 1, clientName: 1, clientNotes: 1, status: 1, createdAt: 1 }).lean() : [];
    return out;
  };

  const counts = (data) => ({
    orders: data.orders?.length || 0, reservations: data.reservations?.length || 0, quotations: data.quotations?.length || 0,
    payroll: data.payroll?.length || 0, attendance: data.attendance?.length || 0,
  });

  // GET /api/privacy/search?q= -> people matching a name, username, e-mail or phone.
  app.get('/api/privacy/search', ...canPrivacy, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) return res.json({ success: true, people: [] });
      const re = { $regex: escapeRe(q), $options: 'i' };
      const [clients, staff, walkins] = await Promise.all([
        M('ClientAccount').find({ $or: [{ name: re }, { username: re }, { email: re }, { phone: re }, { clientCode: re }] }, { name: 1, username: 1, clientCode: 1, phone: 1 }).limit(20).lean(),
        User.find({ name: re, role: { $ne: 'superadmin' } }, { name: 1, userCode: 1, role: 1 }).limit(20).lean(),
        Order.aggregate([
          { $match: { businessType: BUSINESS_TYPE, ...tenantScope(req), $or: [{ customerName: re }, { customerPhone: re }], clientAccountId: { $in: [null, ''] } } },
          { $group: { _id: { name: '$customerName', phone: '$customerPhone' }, orders: { $sum: 1 }, last: { $max: '$createdAt' } } },
          { $sort: { last: -1 } }, { $limit: 20 },
        ]),
      ]);
      res.json({
        success: true,
        people: [
          ...clients.map((c) => ({ type: 'client', id: String(c._id), label: `${c.name || c.username} (${c.clientCode})`, detail: c.phone || '' })),
          ...staff.map((u) => ({ type: 'staff', id: String(u._id), label: `${u.name} (${u.userCode || u.role})`, detail: 'Staff account' })),
          ...walkins.filter((w) => w._id.name || w._id.phone).map((w) => ({
            type: 'customer', name: w._id.name || '', phone: w._id.phone || '',
            label: [w._id.name, w._id.phone].filter(Boolean).join(' · '), detail: `Walk-in customer, ${w.orders} order(s)`,
          })),
        ],
      });
    } catch (err) { fail(req, res, err); }
  });

  // GET /api/privacy/person?type=client&id= | type=customer&name=&phone= | type=staff&id=
  // What is held (counts and the profile); ?export=1 returns all of it.
  app.get('/api/privacy/person', ...canPrivacy, async (req, res) => {
    try {
      const who = await resolve(req, req.query);
      if (!who) return res.status(404).json({ success: false, error: 'No such person.' });
      const wantsExport = req.query.export === '1';
      if (wantsExport && !hasPermission(req.user, 'screen.ledger.exportall')) {
        return res.status(403).json({ success: false, error: 'Exporting needs the Export All permission.' });
      }
      const data = await gather(who);
      await logAudit(req, { action: wantsExport ? 'export' : 'view', entity: 'PersonalData', entityId: who.label, after: { type: who.type, ...counts(data) } });
      if (wantsExport) return res.json({ success: true, data });
      res.json({ success: true, person: { type: who.type, label: who.label }, profile: data.profile || null, counts: counts(data) });
    } catch (err) { fail(req, res, err); }
  });

  // POST /api/privacy/erase { type, id | name, phone, password, confirm: 'ERASE' }
  app.post('/api/privacy/erase', ...canPrivacy, async (req, res) => {
    try {
      if (req.body?.confirm !== 'ERASE') return res.status(400).json({ success: false, error: 'Type ERASE to confirm.' });
      if (!(await confirmPassword?.(req, req.body?.password))) {
        return res.status(403).json({ success: false, needsPassword: true, error: 'Enter your password to erase this person\'s data.' });
      }
      const who = await resolve(req, req.body);
      if (!who) return res.status(404).json({ success: false, error: 'No such person.' });
      const keepFrom = yearsAgo(await retentionYears());
      const kept = [], done = {};

      if (who.type === 'staff') {
        const u = who.user;
        const recentPayroll = await M('PayrollRun').exists({ 'lines.employeeId': String(u._id), payDate: { $gte: yearsAgo(PAYROLL_RETENTION_YEARS) } });
        // The account can no longer be signed in to: a password nobody knows,
        // no PIN or two-step, and every session ended (tokenVersion).
        const set = { pinHash: '', totpEnabled: false, totpSecret: '', trustedDevices: [], password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10) };
        if (!recentPayroll) Object.assign(set, { sssNumber: '', philhealthNumber: '', pagibigNumber: '', tin: '' });
        else kept.push(`Government numbers stay on the staff record and the payroll records until ${PAYROLL_RETENTION_YEARS} years after the last payroll (Labor Code). They are sealed at rest.`);
        await User.updateOne({ _id: u._id }, { $set: set, $inc: { tokenVersion: 1 } });
        kept.push('Their name stays on sales, shifts and the audit log: those are the business\'s records of who did what.');
        done.profile = 1;
      } else {
        const pseudonym = who.type === 'client' ? `Erased client ${who.client.clientCode}` : 'Erased customer';
        // Orders: contact details off; SC/PWD details off only once past retention.
        const base = { customerName: pseudonym, customerPhone: '', deliveryAddress: '' };
        const old = await Order.updateMany({ ...who.orders, createdAt: { $lt: keepFrom } }, { $set: { ...base, scPwdName: '', scPwdIdNumber: '' } });
        const recent = await Order.updateMany({ ...who.orders, createdAt: { $gte: keepFrom } }, { $set: base });
        done.orders = (old.modifiedCount || 0) + (recent.modifiedCount || 0);
        if (await Order.exists({ ...who.orders, createdAt: { $gte: keepFrom }, scPwdName: { $nin: ['', null] } })) {
          kept.push(`SC/PWD cardholder names and ID numbers stay on sales from the last ${await retentionYears()} years (tax rules); they come off once older.`);
        }
        if (who.reservations) done.reservations = (await M('Reservation').updateMany(who.reservations, { $set: { clientName: pseudonym, note: '' } })).modifiedCount || 0;
        if (who.quotations) done.quotations = (await M('Quotation').updateMany(who.quotations, { $set: { clientName: pseudonym, clientNotes: '' } })).modifiedCount || 0;
        if (who.type === 'client') {
          const c = who.client;
          const set = {
            name: pseudonym, username: `erased-${c.clientCode}`.toLowerCase(), phone: '', email: '', contactNotes: '',
            password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10), isActive: false, sessionsValidFrom: new Date(),
          };
          const invoiced = c.isVatRegistered && (await Order.exists({ ...who.orders, createdAt: { $gte: keepFrom } }));
          if (!invoiced) Object.assign(set, { registeredName: '', tin: '', registeredAddress: '' });
          else kept.push('Their registered name, TIN and address stay while they have invoices inside the tax retention period.');
          await M('ClientAccount').updateOne({ _id: c._id }, { $set: set });
          done.account = 1;
        }
        kept.push('Sales amounts, order numbers and the books are unchanged: they are the business\'s records.');
      }
      await logAudit(req, { action: 'erase', entity: 'PersonalData', entityId: who.label, after: { type: who.type, ...done } });
      res.json({ success: true, erased: done, kept });
    } catch (err) { fail(req, res, err); }
  });
}
