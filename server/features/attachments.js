// Supporting documents attached to a transaction: a supplier's invoice on a
// bill, the receipt behind a manual journal entry, a signed check voucher.
//
// Files travel as base64 in the JSON body (the app has no multipart parser)
// and are stored in the tenant's own database, so they are backed up and
// restored with the books. Kept small and to the kinds of file a receipt or
// invoice actually is.
import { captureError } from '../lib/errorLog.js';
import { hasPermission } from '../lib/authz.js';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_RECORD = 20;
// What a scanned or photographed document is. No HTML/SVG: those can carry
// script, and they would be served back from this origin.
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export default function registerAttachments(ctx) {
  const { app, mongoose, IS_PROD, Attachment, ATTACHMENT_ENTITIES, logAudit, verifyToken, requireStaff } = ctx;

  // Documents follow the books and purchasing: whoever can see those records
  // can see what is attached, and whoever can post them can attach.
  const canView = (u) => hasPermission(u, 'accounting.view') || hasPermission(u, 'procurement.view');
  const canAttach = (u) => hasPermission(u, 'accounting.manage') || hasPermission(u, 'procurement.manage');
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  const cleanName = (s) => String(s || 'document').replace(/[\\/\r\n"<>:*?|]+/g, '_').trim().slice(0, 120) || 'document';
  const validRef = (entity, entityId) => ATTACHMENT_ENTITIES.includes(entity) && /^[A-Za-z0-9._-]{1,80}$/.test(String(entityId || ''));

  // List (no file bytes).
  app.get('/api/attachments', verifyToken, requireStaff, async (req, res) => {
    try {
      if (!canView(req.user)) return res.status(403).json({ success: false, error: 'Forbidden.' });
      const { entity, entityId } = req.query;
      if (!validRef(entity, entityId)) return res.status(400).json({ success: false, error: 'Unknown record.' });
      const rows = await Attachment.find({ entity, entityId: String(entityId) }, { data: 0 }).sort({ createdAt: 1 }).lean();
      res.json({ success: true, attachments: rows });
    } catch (err) { fail(req, res, err); }
  });

  app.post('/api/attachments', verifyToken, requireStaff, async (req, res) => {
    try {
      if (!canAttach(req.user)) return res.status(403).json({ success: false, error: 'Attaching documents needs the accounting or procurement "manage" permission.' });
      const { entity, entityId, filename, mime, dataBase64 } = req.body || {};
      if (!validRef(entity, entityId)) return res.status(400).json({ success: false, error: 'Unknown record.' });
      if (!ALLOWED_MIME.has(String(mime))) return res.status(415).json({ success: false, error: 'Attach a PDF or a photo (JPEG, PNG, WebP, HEIC).' });
      const b64 = String(dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
      if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return res.status(400).json({ success: false, error: 'The file did not arrive.' });
      const data = Buffer.from(b64, 'base64');
      if (!data.length) return res.status(400).json({ success: false, error: 'The file is empty.' });
      if (data.length > MAX_BYTES) return res.status(413).json({ success: false, error: 'Files are limited to 5 MB - a phone photo of a receipt is well under that.' });
      if (await Attachment.countDocuments({ entity, entityId: String(entityId) }) >= MAX_PER_RECORD) {
        return res.status(400).json({ success: false, error: `At most ${MAX_PER_RECORD} documents per record.` });
      }
      const doc = await Attachment.create({
        entity, entityId: String(entityId), filename: cleanName(filename), mime, size: data.length, data,
        uploadedBy: req.user?.name || '', uploadedById: String(req.user?._id || ''),
      });
      await logAudit(req, { action: 'attach', entity, entityId: String(entityId), after: { attachmentId: String(doc._id), filename: doc.filename, size: doc.size } });
      const { data: _omit, ...meta } = doc.toObject();
      res.status(201).json({ success: true, attachment: meta });
    } catch (err) { fail(req, res, err); }
  });

  // Served as a download, never rendered from this origin as a page.
  app.get('/api/attachments/:id/file', verifyToken, requireStaff, async (req, res) => {
    try {
      if (!canView(req.user)) return res.status(403).json({ success: false, error: 'Forbidden.' });
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const doc = await Attachment.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      const inline = req.query.inline === '1' && doc.mime !== 'application/pdf' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', doc.mime);
      res.setHeader('Content-Disposition', `${inline}; filename="${cleanName(doc.filename)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.send(Buffer.from(doc.data.buffer || doc.data));
    } catch (err) { fail(req, res, err); }
  });

  // Removing a document is recorded. Only the person who attached it, or a
  // superadmin, may remove it.
  app.delete('/api/attachments/:id', verifyToken, requireStaff, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const doc = await Attachment.findById(req.params.id, { data: 0 }).lean();
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      const isOwner = String(doc.uploadedById) === String(req.user?._id || '');
      if (!isOwner && String(req.user?.role || '').toLowerCase() !== 'superadmin') {
        return res.status(403).json({ success: false, error: 'Only the person who attached it, or a superadmin, can remove it.' });
      }
      await Attachment.deleteOne({ _id: doc._id });
      await logAudit(req, { action: 'detach', entity: doc.entity, entityId: doc.entityId, before: { attachmentId: String(doc._id), filename: doc.filename, size: doc.size } });
      res.json({ success: true });
    } catch (err) { fail(req, res, err); }
  });
}
