// Auth integration tests (supertest + mongodb-memory-server).
//
// These prove the route-wiring claim that pure guard unit tests cannot: a REAL client
// token minted by /api/client-auth/login receives 403 on every staff route, while a
// real staff token still passes. Env is set BEFORE importing server.js so the app
// connects to the in-memory MongoDB and skips port binding / signal handlers (NODE_ENV=test).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import request from 'supertest';

let mongod;
let app;
let clientToken;
let staffToken;

// Every verifyToken-only staff route flagged in the audit. Format: [method, path].
const STAFF_ROUTES = [
  ['get',  '/api/orders'],
  ['put',  '/api/orders/000000000000000000000000'],
  ['get',  '/api/inventory'],
  ['post', '/api/inventory/spoilage/000000000000000000000000'],
  ['post', '/api/shifts/start'],
  ['post', '/api/shifts/end'],
  ['get',  '/api/users'],
];

const call = (method, path, token) =>
  request(app)[method](path).set('Authorization', `Bearer ${token}`).send({});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 30000 } });
  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = mongod.getUri();
  process.env.JWT_SECRET = 'test-secret-for-auth-integration-tests';
  process.env.BUSINESS_TYPE = 'log';

  ({ app } = await import('../server.js'));

  // Wait for the module-level mongoose.connect to finish.
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve, reject) => {
      mongoose.connection.once('connected', resolve);
      mongoose.connection.once('error', reject);
    });
  }

  const ClientAccount = mongoose.model('ClientAccount');
  const User = mongoose.model('User');
  await ClientAccount.create({
    clientCode: 'CLT-A0001',
    username: 'auditclient',
    password: await bcrypt.hash('clientpw', 12),
    name: 'Audit Client',
    paymentMethod: 'Cash',
    isActive: true,
  });
  await User.create({
    name: 'AuditAdmin',
    password: await bcrypt.hash('adminpw', 12),
    userCode: 'ADN-A9001',
    role: 'admin',
  });

  const clientRes = await request(app).post('/api/client-auth/login').send({ username: 'auditclient', password: 'clientpw' });
  clientToken = clientRes.body.token;
  const staffRes = await request(app).post('/api/users/login').send({ name: 'AuditAdmin', password: 'adminpw' });
  staffToken = staffRes.body.token;
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

describe('auth: token minting', () => {
  it('client login returns a token carrying aud:client', () => {
    expect(clientToken).toBeTruthy();
    const payload = JSON.parse(Buffer.from(clientToken.split('.')[1], 'base64').toString());
    expect(payload.aud).toBe('client');
    expect(payload.role).toBe('client');
  });

  it('staff login returns a token carrying aud:staff', () => {
    expect(staffToken).toBeTruthy();
    const payload = JSON.parse(Buffer.from(staffToken.split('.')[1], 'base64').toString());
    expect(payload.aud).toBe('staff');
  });
});

describe('auth breach: client token is rejected on every staff route', () => {
  for (const [method, path] of STAFF_ROUTES) {
    it(`${method.toUpperCase()} ${path} → 403 for a client token`, async () => {
      const res = await call(method, path, clientToken);
      expect(res.status).toBe(403);
    });
  }
});

describe('auth: staff token still passes (not 403) on every staff route', () => {
  for (const [method, path] of STAFF_ROUTES) {
    it(`${method.toUpperCase()} ${path} → not 403 for a staff token`, async () => {
      const res = await call(method, path, staffToken);
      expect(res.status).not.toBe(403);
    });
  }
});

describe('auth: client-scoped routes still work for the client token', () => {
  it('GET /api/client/orders → not 401/403 for a client token', async () => {
    const res = await call('get', '/api/client/orders', clientToken);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('GET /api/client/orders → 403 for a staff token (wrong audience)', async () => {
    const res = await call('get', '/api/client/orders', staffToken);
    expect(res.status).toBe(403);
  });
});
