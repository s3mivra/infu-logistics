// scheduling routes - staff roster (planned future shifts). See the
// ScheduledShiftSchema comment in server.js for why this is separate from the
// cash-drawer `Shift` and attendance `ClockEntry` records.
import { captureError } from '../lib/errorLog.js';

export default function registerScheduling(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    BUSINESS_TYPE,
    tenantScope,
    logAudit,
    ScheduledShift,
    SCHEDULED_SHIFT_STATUSES,
    User,
    verifyToken,
    requireStaff,
    requirePermission,
  } = ctx;

  const canManageRoster = [requireStaff, requirePermission('scheduling.manage')];

  // 'HH:MM' 24h. Rejects '9:5', '25:00', '12:60', etc.
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  // 'YYYY-MM-DD' with a real-ish calendar shape (no month 13 / day 32).
  const isDate = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);

  // ── ROSTER LIST (manager view) ───────────────────────────────────────────────
  // GET /api/scheduling/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD&staffId=&status=
  // Every scheduled shift in a window - Draft included, since a manager building
  // next week's roster needs to see their unpublished work.
  app.get('/api/scheduling/shifts', verifyToken, ...canManageRoster, async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      const { from, to, staffId, status } = req.query;
      if (from && isDate(from)) q.date = { ...(q.date || {}), $gte: from };  // string compare works: YYYY-MM-DD sorts lexicographically = chronologically
      if (to && isDate(to)) q.date = { ...(q.date || {}), $lte: to };
      if (staffId && mongoose.Types.ObjectId.isValid(staffId)) q.staffId = staffId;
      if (status && SCHEDULED_SHIFT_STATUSES.includes(status)) q.status = status;
      const shifts = await ScheduledShift.find(q).sort({ date: 1, startTime: 1 }).lean();
      res.json({ success: true, shifts });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── MY UPCOMING SCHEDULE (any staff, own only) ───────────────────────────────
  // A staffer sees only their OWN Published shifts, today onward. No permission
  // beyond being logged in - they can never see anyone else's or any Draft.
  app.get('/api/scheduling/my-schedule', verifyToken, requireStaff, async (req, res) => {
    try {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD Manila
      const shifts = await ScheduledShift.find({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        staffId: req.user._id, status: 'Published', date: { $gte: today },
      }).sort({ date: 1, startTime: 1 }).lean();
      res.json({ success: true, shifts });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── CREATE ───────────────────────────────────────────────────────────────────
  // POST /api/scheduling/shifts { staffId, date, startTime, endTime, role, notes, status? }
  app.post('/api/scheduling/shifts', verifyToken, ...canManageRoster, async (req, res) => {
    try {
      const { staffId, date, startTime, endTime, role, notes, status } = req.body || {};
      if (!staffId || !mongoose.Types.ObjectId.isValid(staffId)) return res.status(400).json({ success: false, error: 'A valid staff member is required.' });
      if (!isDate(date)) return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD.' });
      if (!isTime(startTime) || !isTime(endTime)) return res.status(400).json({ success: false, error: 'startTime and endTime must be HH:MM (24h).' });
      if (endTime <= startTime) return res.status(400).json({ success: false, error: 'endTime must be after startTime.' });

      const staff = await User.findById(staffId).lean();
      if (!staff) return res.status(404).json({ success: false, error: 'Staff member not found.' });

      const shift = await ScheduledShift.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        staffId, staffName: staff.name,
        date, startTime, endTime,
        role: String(role || '').slice(0, 60),
        notes: String(notes || '').slice(0, 500),
        status: SCHEDULED_SHIFT_STATUSES.includes(status) ? status : 'Draft',
        createdBy: req.user?.name || '',
      });
      await logAudit(req, { action: 'create', entity: 'ScheduledShift', entityId: shift._id, after: { staffName: staff.name, date, startTime, endTime } });
      res.json({ success: true, shift });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── UPDATE ───────────────────────────────────────────────────────────────────
  app.patch('/api/scheduling/shifts/:id', verifyToken, ...canManageRoster, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const shift = await ScheduledShift.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!shift) return res.status(404).json({ success: false, error: 'Not found' });

      const { staffId, date, startTime, endTime, role, notes, status } = req.body || {};
      if (staffId !== undefined) {
        if (!mongoose.Types.ObjectId.isValid(staffId)) return res.status(400).json({ success: false, error: 'A valid staff member is required.' });
        const staff = await User.findById(staffId).lean();
        if (!staff) return res.status(404).json({ success: false, error: 'Staff member not found.' });
        shift.staffId = staffId; shift.staffName = staff.name;
      }
      if (date !== undefined) { if (!isDate(date)) return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD.' }); shift.date = date; }
      if (startTime !== undefined) { if (!isTime(startTime)) return res.status(400).json({ success: false, error: 'startTime must be HH:MM.' }); shift.startTime = startTime; }
      if (endTime !== undefined) { if (!isTime(endTime)) return res.status(400).json({ success: false, error: 'endTime must be HH:MM.' }); shift.endTime = endTime; }
      if (shift.endTime <= shift.startTime) return res.status(400).json({ success: false, error: 'endTime must be after startTime.' });
      if (role !== undefined) shift.role = String(role).slice(0, 60);
      if (notes !== undefined) shift.notes = String(notes).slice(0, 500);
      if (status !== undefined) {
        if (!SCHEDULED_SHIFT_STATUSES.includes(status)) return res.status(400).json({ success: false, error: `status must be one of: ${SCHEDULED_SHIFT_STATUSES.join(', ')}.` });
        shift.status = status;
      }
      await shift.save();
      await logAudit(req, { action: 'update', entity: 'ScheduledShift', entityId: shift._id, after: { status: shift.status, date: shift.date } });
      res.json({ success: true, shift });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── PUBLISH A WHOLE DAY / RANGE ──────────────────────────────────────────────
  // POST /api/scheduling/publish { from, to } - flips every Draft in the window
  // to Published in one action, so a manager releases a finished roster at once
  // rather than shift-by-shift.
  app.post('/api/scheduling/publish', verifyToken, ...canManageRoster, async (req, res) => {
    try {
      const { from, to } = req.body || {};
      if (!isDate(from) || !isDate(to)) return res.status(400).json({ success: false, error: 'from and to (YYYY-MM-DD) are required.' });
      const result = await ScheduledShift.updateMany(
        { businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Draft', date: { $gte: from, $lte: to } },
        { $set: { status: 'Published' } }
      );
      await logAudit(req, { action: 'publish', entity: 'ScheduledShift', entityId: `${from}..${to}`, after: { published: result.modifiedCount } });
      res.json({ success: true, published: result.modifiedCount });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── DELETE ───────────────────────────────────────────────────────────────────
  app.delete('/api/scheduling/shifts/:id', verifyToken, ...canManageRoster, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const shift = await ScheduledShift.findOneAndDelete({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!shift) return res.status(404).json({ success: false, error: 'Not found' });
      await logAudit(req, { action: 'delete', entity: 'ScheduledShift', entityId: req.params.id, before: { staffName: shift.staffName, date: shift.date } });
      res.json({ success: true });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
