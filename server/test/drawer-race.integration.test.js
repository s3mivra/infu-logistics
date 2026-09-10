import { it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, ana, ben, cara;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'race-secret-0123456789' }));
  await makeUser({ name: 'Ana', role: 'cashier', password: 'pw' });
  await makeUser({ name: 'Ben', role: 'cashier', password: 'pw' });
  await makeUser({ name: 'Cara', role: 'cashier', password: 'pw' });
  ana = await loginStaff(app, 'Ana', 'pw');
  ben = await loginStaff(app, 'Ben', 'pw');
  cara = await loginStaff(app, 'Cara', 'pw');
  await mongoose.model('Settings').findOneAndUpdate({ key: 'sharedDrawer' }, { value: true }, { upsert: true });
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

it('three people opening up at the same moment must not create three floats', async () => {
  await mongoose.model('Shift').deleteMany({});
  await Promise.all([
    request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 2000 }),
    request(app).post('/api/shifts/start').set(auth(ben)).send({ startingCash: 2000 }),
    request(app).post('/api/shifts/start').set(auth(cara)).send({ startingCash: 2000 }),
  ]);
  const open = await mongoose.model('Shift').countDocuments({ scope: 'drawer', status: 'Open' });
  console.log('OPEN DRAWER SESSIONS AFTER CONCURRENT LOGINS:', open);
  expect(open).toBe(1);
});
