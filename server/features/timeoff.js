// Phase 2 - leave, overtime, and the timesheet payroll is prepared from.
//
// Staff file their own leave and overtime; someone who builds rosters
// (scheduling.manage) approves or rejects it - never their own. The timesheet
// brings together, per person and pay period: days actually worked (clock-in
// records), approved paid and unpaid leave, approved overtime hours, and the
// daily rate on their staff record - and suggests the gross pay a payroll
// draft starts from. Nothing here posts; the payroll run does.
import { captureError } from '../lib/errorLog.js';
import { roundMoney } from '../lib/money.js';
import { businessDateStr } from '../lib/businessTime.js';
import { hasPermission } from '../lib/authz.js';

export const LEAVE_TYPES = ['Vacation', 'Sick', 'Emergency', 'Unpaid'];
const PAID_LEAVE = new Set(['Vacation', 'Sick', 'Emergency']);
// Philippine regular-day overtime premium: 125% of the hourly rate.
export const OVERTIME_PREMIUM = 1.25;
const HOURS_PER_DAY = 8;

// Calendar days from..to, inclusive, both as YYYY-MM-DD on the business calendar.
export function leaveDays(from, to) {
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return Math.round((b - a) / 86400_000) + 1;
}

// Suggested gross for a pay period.
export function suggestedGross({ dailyRate = 0, daysWorked = 0, paidLeaveDays = 0, overtimeHours = 0 }) {
  const rate = Number(dailyRate) || 0;
  return roundMoney((daysWorked + paidLeaveDays) * rate + overtimeHours * (rate / HOURS_PER_DAY) * OVERTIME_PREMIUM);
}

export default function registerTimeOff(ctx) {
  const {
    app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope, LeaveRequest, OvertimeRequest, ClockEntry, User,
    logAudit, verifyToken, requireStaff, requirePermission,
  } = ctx;
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  const canDecide = (u) => hasPermission(u, 'scheduling.manage');
  const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

  // Whose request is this? A manager may file for someone else; anyone else
  // only for themselves.
  const subjectFor = async (req) => {
    const wanted = req.body?.userId && String(req.body.userId) !== String(req.user._id) ? String(req.body.userId) : null;
    if (!wanted) return { id: String(req.user._id), name: req.user.name };
    if (!canDecide(req.user)) { const e = new Error('You can only file for yourself.'); e.status = 403; throw e; }
    if (!mongoose.Types.ObjectId.isValid(wanted)) { const e = new Error('Staff member not found.'); e.status = 404; throw e; }
    const u = await User.findById(wanted, { name: 1 }).lean();
    if (!u) { const e = new Error('Staff member not found.'); e.status = 404; throw e; }
    return { id: String(u._id), name: u.name };
  };

  const listRoute = (path, Model) => app.get(path, verifyToken, requireStaff, async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (['Pending', 'Approved', 'Rejected'].includes(req.query.status)) q.status = req.query.status;
      // Without approval rights you see your own only.
      if (!canDecide(req.user) || req.query.mine === '1') q.userId = String(req.user._id);
      res.json({ success: true, requests: await Model.find(q).sort({ createdAt: -1 }).limit(300).lean(), canDecide: canDecide(req.user) });
    } catch (err) { fail(req, res, err); }
  });
  const decideRoute = (path, Model, entity) => app.post(path, verifyToken, requireStaff, requirePermission('scheduling.manage'), async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const decision = req.params.decision === 'approve' ? 'Approved' : req.params.decision === 'reject' ? 'Rejected' : null;
      if (!decision) return res.status(404).json({ success: false, error: 'Not found' });
      const doc = await Model.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      if (doc.status !== 'Pending') return res.status(409).json({ success: false, error: `Already ${doc.status}.` });
      if (String(doc.userId) === String(req.user._id)) return res.status(403).json({ success: false, error: 'Someone else has to decide your own request.' });
      const note = String(req.body?.note || '').trim().slice(0, 300);
      if (decision === 'Rejected' && !note) return res.status(400).json({ success: false, error: 'Say why it is rejected.' });
      doc.status = decision; doc.decidedBy = req.user?.name || ''; doc.decidedAt = new Date(); doc.decisionNote = note;
      await doc.save();
      await logAudit(req, { action: decision === 'Approved' ? 'approve' : 'reject', entity, entityId: doc._id, after: { userName: doc.userName, note } });
      res.json({ success: true, request: doc });
    } catch (err) { fail(req, res, err); }
  });

  // ── LEAVE ──
  app.post('/api/leave-requests', verifyToken, requireStaff, async (req, res) => {
    try {
      const type = String(req.body?.type || '');
      if (!LEAVE_TYPES.includes(type)) return res.status(400).json({ success: false, error: `Leave type is one of: ${LEAVE_TYPES.join(', ')}.` });
      const from = ymd(req.body?.from), to = ymd(req.body?.to || req.body?.from);
      if (!from || !to) return res.status(400).json({ success: false, error: 'Give the dates as YYYY-MM-DD.' });
      const days = leaveDays(from, to);
      if (!days) return res.status(400).json({ success: false, error: 'The leave ends before it starts.' });
      if (days > 60) return res.status(400).json({ success: false, error: 'File leave longer than 60 days in parts.' });
      const who = await subjectFor(req);
      const clash = await LeaveRequest.findOne({ userId: who.id, status: { $ne: 'Rejected' }, from: { $lte: to }, to: { $gte: from } }).lean();
      if (clash) return res.status(409).json({ success: false, error: `Overlaps leave already filed (${clash.from} to ${clash.to}).` });
      const doc = await LeaveRequest.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req), userId: who.id, userName: who.name,
        type, from, to, days, paid: PAID_LEAVE.has(type), reason: String(req.body?.reason || '').trim().slice(0, 300),
        filedBy: req.user?.name || '',
      });
      res.status(201).json({ success: true, request: doc });
    } catch (err) { if (err.status) return res.status(err.status).json({ success: false, error: err.message }); fail(req, res, err); }
  });
  listRoute('/api/leave-requests', LeaveRequest);
  decideRoute('/api/leave-requests/:id/:decision', LeaveRequest, 'LeaveRequest');

  // ── OVERTIME ──
  app.post('/api/overtime-requests', verifyToken, requireStaff, async (req, res) => {
    try {
      const date = ymd(req.body?.date);
      if (!date) return res.status(400).json({ success: false, error: 'Give the date as YYYY-MM-DD.' });
      const hours = Number(req.body?.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 16) return res.status(400).json({ success: false, error: 'Overtime is between 0 and 16 hours.' });
      const who = await subjectFor(req);
      const doc = await OvertimeRequest.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req), userId: who.id, userName: who.name,
        date, hours: Math.round(hours * 100) / 100, reason: String(req.body?.reason || '').trim().slice(0, 300),
        filedBy: req.user?.name || '',
      });
      res.status(201).json({ success: true, request: doc });
    } catch (err) { if (err.status) return res.status(err.status).json({ success: false, error: err.message }); fail(req, res, err); }
  });
  listRoute('/api/overtime-requests', OvertimeRequest);
  decideRoute('/api/overtime-requests/:id/:decision', OvertimeRequest, 'OvertimeRequest');

  // ── TIMESHEET for a pay period ──
  app.get('/api/payroll/timesheet', verifyToken, requireStaff, requirePermission('accounting.view'), async (req, res) => {
    try {
      const start = ymd(req.query.start), end = ymd(req.query.end);
      if (!start || !end || end < start) return res.status(400).json({ success: false, error: 'Give the pay period as YYYY-MM-DD.' });
      const [entries, leaves, ots, users] = await Promise.all([
        ClockEntry.find({ date: { $gte: start, $lte: end }, workedMinutes: { $gt: 0 } }, { staffId: 1, staffName: 1, date: 1, workedMinutes: 1 }).lean(),
        LeaveRequest.find({ businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Approved', from: { $lte: end }, to: { $gte: start } }).lean(),
        OvertimeRequest.find({ businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Approved', date: { $gte: start, $lte: end } }).lean(),
        User.find({}, { name: 1, dailyRate: 1 }).lean(),
      ]);
      const rows = new Map();
      const userById = new Map(users.map(u => [String(u._id), u]));
      const row = (id, name) => {
        if (!rows.has(id)) {
          const u = userById.get(id);
          rows.set(id, { userId: id, name: u?.name || name, dailyRate: Number(u?.dailyRate) || 0, days: new Set(), workedMinutes: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, overtimeHours: 0 });
        }
        return rows.get(id);
      };
      for (const e of entries) { const r = row(String(e.staffId), e.staffName); r.days.add(e.date); r.workedMinutes += e.workedMinutes || 0; }
      for (const l of leaves) {
        // Only the part of the leave inside the pay period.
        const days = leaveDays(l.from < start ? start : l.from, l.to > end ? end : l.to);
        const r = row(String(l.userId), l.userName);
        if (l.paid) r.paidLeaveDays += days; else r.unpaidLeaveDays += days;
      }
      for (const o of ots) row(String(o.userId), o.userName).overtimeHours += o.hours || 0;
      const out = [...rows.values()].map(r => {
        const daysWorked = r.days.size;
        return {
          userId: r.userId, name: r.name, dailyRate: r.dailyRate, daysWorked,
          hoursWorked: Math.round(r.workedMinutes / 6) / 10,
          paidLeaveDays: r.paidLeaveDays, unpaidLeaveDays: r.unpaidLeaveDays,
          overtimeHours: Math.round(r.overtimeHours * 100) / 100,
          suggestedGross: suggestedGross({ dailyRate: r.dailyRate, daysWorked, paidLeaveDays: r.paidLeaveDays, overtimeHours: r.overtimeHours }),
          missingRate: !r.dailyRate,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      res.json({ success: true, start, end, rows: out, today: businessDateStr() });
    } catch (err) { fail(req, res, err); }
  });
}
