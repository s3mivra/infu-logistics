// Rotating the displayed QR the moment it is scanned.
//
// A scan never reaches the server on its own - the phone just loads a page. The
// menu page therefore claims its session on load, and that claim is what tells
// the counter to put a fresh code up. Before this, a code stayed on screen for
// the whole time a customer browsed, so a second person scanning it landed on
// the SAME session and whoever ordered first closed it under the other.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, tok;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'qrclaim-secret-0123456789' }));
  await makeUser({ name: 'QrBoss', role: 'superadmin', password: 'pw' });
  tok = await loginStaff(app, 'QrBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = () => ({ Authorization: `Bearer ${tok}` });
const mint = async (table) => {
  const r = await request(app).post('/api/sessions/generate').set(auth()).send({ table });
  expect(r.status).toBe(200);
  return r.body.sessionId;
};

describe('QR claim on scan', () => {
  it('the first open claims the session and reports it as the first', async () => {
    const id = await mint('T-CLAIM-1');
    const res = await request(app).post(`/api/sessions/${id}/claim`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.firstClaim).toBe(true);
    expect(res.body.table).toBe('T-CLAIM-1');

    const QRSession = mongoose.model('QRSession');
    const saved = await QRSession.findOne({ sessionId: id }).lean();
    expect(saved.claimedAt).toBeTruthy();
  });

  it('reloading the menu does NOT re-notify staff', async () => {
    const id = await mint('T-CLAIM-2');
    const first = await request(app).post(`/api/sessions/${id}/claim`);
    expect(first.body.firstClaim).toBe(true);
    // A customer refreshing, or opening a second tab, must not make the counter
    // cycle through a new code every time.
    for (let i = 0; i < 3; i++) {
      const again = await request(app).post(`/api/sessions/${id}/claim`);
      expect(again.status).toBe(200);
      expect(again.body.success).toBe(true);
      expect(again.body.firstClaim).toBe(false);
    }
  });

  it('claiming keeps the session usable - the scanner still orders on it', async () => {
    const id = await mint('T-CLAIM-3');
    await request(app).post(`/api/sessions/${id}/claim`);
    // The counter mints a replacement under a NEW table id; that must not
    // disturb the session the customer is holding.
    await mint('T-CLAIM-3-NEXT');
    const beat = await request(app).post(`/api/sessions/${id}/heartbeat`);
    expect(beat.status).toBe(200);
    expect(beat.body.success).toBe(true);
  });

  it('a closed or unknown session cannot be claimed', async () => {
    const id = await mint('T-CLAIM-4');
    await request(app).post(`/api/sessions/${id}/close`);
    const res = await request(app).post(`/api/sessions/${id}/claim`);
    expect(res.status).toBe(404);

    const bogus = await request(app).post('/api/sessions/not-a-real-session/claim');
    expect(bogus.status).toBe(404);
  });

  it('an expired session is refused and deactivated', async () => {
    const id = await mint('T-CLAIM-5');
    const QRSession = mongoose.model('QRSession');
    await QRSession.updateOne({ sessionId: id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post(`/api/sessions/${id}/claim`);
    expect(res.status).toBe(403);
    const saved = await QRSession.findOne({ sessionId: id }).lean();
    expect(saved.isActive).toBe(false);
  });

  it('minting a code for the same table kills the previous one', async () => {
    const first = await mint('T-CLAIM-6');
    const second = await mint('T-CLAIM-6');
    expect(second).not.toBe(first);
    // No table may ever have two live codes.
    const res = await request(app).post(`/api/sessions/${first}/claim`);
    expect(res.status).toBe(404);
  });
});
