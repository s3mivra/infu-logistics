// Pure ledger helpers — no DB, fully unit-testable.

export const LEDGER_TOLERANCE = 0.01;

export function sumDebits(lines) {
  return lines.reduce((s, l) => s + (l.debit || 0), 0);
}

export function sumCredits(lines) {
  return lines.reduce((s, l) => s + (l.credit || 0), 0);
}

export function isBalanced(lines) {
  return Math.abs(sumDebits(lines) - sumCredits(lines)) <= LEDGER_TOLERANCE;
}

export function assertBalanced(lines, ctx = '') {
  const d = sumDebits(lines);
  const c = sumCredits(lines);
  if (Math.abs(d - c) > LEDGER_TOLERANCE) {
    throw new Error(`Journal entry UNBALANCED${ctx ? ` (${ctx})` : ''}: DR ${d.toFixed(2)} vs CR ${c.toFixed(2)}`);
  }
}

// Pick the debit-side cash account based on payment method.
// Only physical Cash hits Cash on Hand (1000) immediately.
// Every other channel (Bank, E-Wallet, Delivery Partners) books as Accounts
// Receivable (1200) until the merchant verifies the money has landed and
// settles the receivable via /api/orders/:id/settle-ar.
// Payments collected in hand immediately → Cash on Hand (111000).
// Delivery platforms and bank transfers → Accounts Receivable (120000) until settled.
const CASH_ON_HAND_METHODS = new Set(['Cash', 'Pickup', 'Manual Delivery', 'Lalamove']);
export function debitAccountFor(paymentMethod) {
  if (CASH_ON_HAND_METHODS.has(paymentMethod)) return { code: '111000', name: 'Cash on Hand' };
  return { code: '120000', name: 'Accounts Receivable' };
}

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
  // Delivery partners default to Cash in Bank (typical payout channel)
  if (['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(paymentMethod)) {
    return { code: '112000', name: 'Cash in Bank' };
  }
  return { code: '111000', name: 'Cash on Hand' };
}

// Non-VAT gross receipts: total collected + discount given.
export function grossSalesAmount(order) {
  return (order.total || 0) + (order.discount || 0);
}
