// Who a sale is for, when nobody gave a name.
//
// A nameless sale is recorded under a stand-in - "Guest", or "Walk-in" for a
// dine-in order - and a stand-in is not a person. The repeat-customer
// promotion counts completed orders by NAME, so a stand-in it failed to
// recognise would be promoted after its third sale into a client account
// literally called "Walk-in", and every nameless order in the shop would then
// be pulled onto that one account.
//
// The two promotion paths had drifted: the backdated-sale one already skipped
// "walk-in", the live POS one skipped only "guest". Both read this now.
export const WALK_IN_NAME = 'Walk-in';

export function isAnonymousCustomerName(name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n || n === 'guest') return true;
  // "Walk-in", "walk in", "walkin", "Walk-in 2" - however a cashier types it.
  return /^walk[\s-]?in\b/.test(n);
}
