// Journal entries are append-only. A posted entry is corrected by posting a
// reversing one, never by editing or deleting it - that is what makes the
// ledger an audit trail rather than a spreadsheet.
//
// This was true only by convention. The schema now refuses every update and
// delete of a journal entry unless the code doing it has explicitly declared
// itself ledger MAINTENANCE: a one-time account-code migration, the
// superadmin's data purge, or a test resetting its fixture. Anything else that
// tries - a future route, a script, a slip - fails loudly instead of silently
// rewriting history.
import { AsyncLocalStorage } from 'node:async_hooks';

const maintenance = new AsyncLocalStorage();

// Awaits INSIDE the context on purpose: a Mongoose query is lazy and only
// runs when awaited, so returning the query unawaited would execute it after
// the context had already ended - and be refused.
export function withLedgerMaintenance(fn) {
  return maintenance.run(true, async () => await fn());
}

export function inLedgerMaintenance() {
  return maintenance.getStore() === true;
}

export const LEDGER_WRITE_OPS = [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
];

export function refuseLedgerRewrite(op) {
  const e = new Error(`Journal entries are append-only: ${op} refused. Post a reversing entry instead.`);
  e.status = 409;
  return e;
}
