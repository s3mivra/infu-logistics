// Run a unit of work inside a MongoDB transaction when the deployment supports
// one, and fall back to running it WITHOUT a session when it doesn't.
//
// WHY: every money/stock route wraps its writes in a multi-document transaction,
// which MongoDB only allows on a replica set. Production (Atlas) is a replica
// set, but a plain standalone mongod — which is what a simple dev box or a
// non-replica test harness runs — rejects them outright with
// "Transaction numbers are only allowed on a replica set member or mongos",
// making those routes impossible to exercise locally.
//
// The alternative already in the codebase is to hand-write the whole handler
// twice (see the restock route). That doubles every future edit and the two
// copies drift. This runs ONE implementation either way.
//
// The caller's `work` receives a session that is `undefined` on the fallback
// path; Mongoose ignores `{ session: undefined }`, so the same code runs
// unchanged — it simply loses atomicity, which is the honest trade on a
// database that cannot offer it.

const UNSUPPORTED = /Transaction numbers are only allowed|Transactions are not supported|replica set member or mongos/i;
const TRANSIENT = /WriteConflict|TransientTransactionError/i;

export async function withOptionalTransaction(mongoose, work, { retries = 3, log } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const session = await mongoose.startSession();
    try {
      let out;
      await session.withTransaction(async () => { out = await work(session); });
      return out;
    } catch (err) {
      const msg = String(err?.errorLabels || err?.message || '');
      const isTransient = (err?.errorLabels || []).includes('TransientTransactionError') || TRANSIENT.test(msg);

      // A write conflict is worth retrying — another writer touched the same doc.
      if (isTransient && attempt < retries) continue;

      // No transaction support: run the same work without a session, once.
      if (UNSUPPORTED.test(msg)) {
        log?.warn?.('Transactions unsupported on this MongoDB (not a replica set) — running without a session. Atomicity is NOT guaranteed for this write.');
        return work(undefined);
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  // Retries exhausted on a transient error.
  throw Object.assign(new Error('Write conflict — please retry.'), { httpStatus: 409 });
}
