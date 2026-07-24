// Shared integration-test harness. Boots the real Express app against an in-memory
// MongoDB REPLICA SET (transactions require a replica set), and provides small
// fixture/login helpers. Env is set before importing server.js so the app connects to
// the in-memory DB and skips port binding / signal handlers (NODE_ENV=test).
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import request from 'supertest';

export async function bootApp({ businessType = 'log', jwtSecret = 'test-secret-harness' } = {}) {
  const repl = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 30000 }], // tolerate slow mongod startup under load
  });
  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = repl.getUri();
  process.env.JWT_SECRET = jwtSecret;
  process.env.BUSINESS_TYPE = businessType;

  const mod = await import('../../server.js');
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve, reject) => {
      mongoose.connection.once('connected', resolve);
      mongoose.connection.once('error', reject);
    });
  }
  return {
    app: mod.app,
    server: mod.server, // http.Server — for socket.io tests that need a real port
    runStartupTasks: mod.runStartupTasks, // for boot-migration tests
    repl,
    stop: async () => { await mongoose.disconnect(); await repl.stop(); },
  };
}

let userSeq = 0;
export async function makeUser({ name, role, password = 'pw' }) {
  const User = mongoose.model('User');
  await User.create({ name, role, userCode: `ADN-T${String(++userSeq).padStart(4, '0')}`, password: await bcrypt.hash(password, 12) });
  return name;
}

export async function makeClient({ username, password = 'pw', paymentMethod = 'Cash' }) {
  const ClientAccount = mongoose.model('ClientAccount');
  await ClientAccount.create({
    clientCode: `CLT-T${String(++userSeq).padStart(4, '0')}`,
    username, name: username, paymentMethod, isActive: true,
    password: await bcrypt.hash(password, 12),
  });
  return username;
}

export async function loginStaff(app, name, password = 'pw') {
  const r = await request(app).post('/api/users/login').send({ name, password });
  return r.body.token;
}

export async function loginClient(app, username, password = 'pw') {
  const r = await request(app).post('/api/client-auth/login').send({ username, password });
  return r.body.token;
}

// Sum of all debits/credits across the entire ledger — used to assert the books stay
// balanced (a trial balance) after a sequence of money operations.
export async function trialBalance() {
  const JournalEntry = mongoose.model('JournalEntry');
  const agg = await JournalEntry.aggregate([
    { $unwind: '$lines' },
    { $group: {
        _id: null,
        debits: { $sum: { $ifNull: ['$lines.debit', 0] } },
        credits: { $sum: { $ifNull: ['$lines.credit', 0] } },
    } },
  ]);
  const r = agg[0] || { debits: 0, credits: 0 };
  return { debits: +r.debits.toFixed(2), credits: +r.credits.toFixed(2) };
}
