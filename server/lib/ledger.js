// Pure ledger helpers - no DB, fully unit-testable.
import { toCentavos } from './money.js';

// Kept for callers comparing report totals; journal entries themselves must
// balance EXACTLY (see assertBalanced).
export const LEDGER_TOLERANCE = 0.01;

export function sumDebits(lines) {
  return lines.reduce((s, l) => s + (l.debit || 0), 0);
}

export function sumCredits(lines) {
  return lines.reduce((s, l) => s + (l.credit || 0), 0);
}

// Each line is taken to the centavo (that is how it is stored) and the two
// sides must then be equal to the centavo. A one-centavo tolerance on raw
// float sums let entries be stored up to P0.01 out, so the trial balance never
// tied to exactly zero.
function centavoSides(lines) {
  let d = 0; let c = 0;
  for (const l of lines) { d += toCentavos(l.debit || 0); c += toCentavos(l.credit || 0); }
  return { d, c };
}

export function isBalanced(lines) {
  const { d, c } = centavoSides(lines);
  return d === c;
}

export function assertBalanced(lines, ctx = '') {
  const { d, c } = centavoSides(lines);
  if (d !== c) {
    throw new Error(`Journal entry UNBALANCED${ctx ? ` (${ctx})` : ''}: DR ${(d / 100).toFixed(2)} vs CR ${(c / 100).toFixed(2)}`);
  }
}

// Pick the debit-side cash account based on payment method.
// Only physical Cash hits Cash on Hand (1000) immediately.
// Every other channel (Bank, E-Wallet, Delivery Partners) books as Accounts
// Receivable (1200) until the merchant verifies the money has landed and
// settles the receivable via /api/orders/:id/settle-ar.
// Payments collected in hand immediately → Cash on Hand (111000).
// Delivery platforms and bank transfers → Accounts Receivable (120000) until settled.
export const CASH_ON_HAND_METHODS = Object.freeze(['Cash', 'Pickup', 'Manual Delivery', 'Lalamove']);
const CASH_ON_HAND_SET = new Set(CASH_ON_HAND_METHODS);
export function debitAccountFor(paymentMethod) {
  if (CASH_ON_HAND_SET.has(paymentMethod)) return { code: '111000', name: 'Cash on Hand' };
  return { code: '120000', name: 'Accounts Receivable' };
}

// The A/R subsidiary ledger must select exactly the orders this module posted
// to 120000, or the subledger stops tying to its control account.
//
// Every A/R query used to spell this as `{ $ne: 'Cash' }`, which silently
// counted Pickup, Manual Delivery and Lalamove as receivables even though the
// money for them was collected in hand and debited to 111000. That overstated
// A/R on the aging report, the collections worklist, the overdue alerts, and
// the credit headroom a client is allowed. One exported predicate instead of
// seven hand-written copies is what keeps them from drifting apart again.
export const AR_PAYMENT_METHOD_FILTER = Object.freeze({ $nin: CASH_ON_HAND_METHODS });
export const isReceivableMethod = (m) => !CASH_ON_HAND_SET.has(m);

// Cash-class accounts that the operator can "settle into" once the money
// arrives. Used by the A/R settlement modal.
export const SETTLE_DESTINATIONS = [
  { code: '111000', name: 'Cash on Hand',  match: ['Cash'] },
  { code: '112000', name: 'Cash in Bank',  match: ['Bank Transfer'] },
  { code: '113000', name: 'E-Wallet',      match: ['GCash', 'Maya', 'Maribank', 'E-Wallet', 'Other E-Wallet'] },
];

// Suggest which cash account should receive the settlement based on the
// original payment method. Lets the UI smart-default the destination.
export function suggestedSettleAccount(paymentMethod) {
  for (const d of SETTLE_DESTINATIONS) {
    if (d.match.includes(paymentMethod)) return d;
  }
  // Delivery partners default to Cash in Bank (typical payout channel).
  // Manual Delivery is not listed: it is collected in hand (see
  // CASH_ON_HAND_METHODS), so it never becomes a receivable to settle.
  if (['Grab Delivery', 'Foodpanda'].includes(paymentMethod)) {
    return { code: '112000', name: 'Cash in Bank' };
  }
  return { code: '111000', name: 'Cash on Hand' };
}

// Non-VAT gross receipts: total collected + discount given.
export function grossSalesAmount(order) {
  return (order.total || 0) + (order.discount || 0);
}
