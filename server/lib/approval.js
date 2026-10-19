// A manager's approval, carried from the PIN prompt to the action it approves.
//
// POST /api/users/authorize checks a manager's PIN (rate limited). On its own
// that proves nothing to the next request - the till could simply claim a
// manager said yes. So it hands back a short-lived signed approval, bound to:
//   - the permission it approves (e.g. orders.delete),
//   - the person at the till who asked (it cannot be passed to someone else),
//   - the one record it is for (it cannot be reused on another order),
// and the action verifies it. Two minutes is long enough to finish the dialog
// and too short to keep one in a pocket.
import jwt from 'jsonwebtoken';

const TTL = '2m';
const KIND = 'manager-approval';

export function signApproval({ approver, permission, requestedBy, target }) {
  return jwt.sign(
    { kind: KIND, approverId: String(approver._id), approverName: approver.name, permission, requestedBy: String(requestedBy || ''), target: String(target || '') },
    process.env.JWT_SECRET,
    { expiresIn: TTL },
  );
}

// -> { approverName } when the approval is good for exactly this, else null.
export function checkApproval(token, { permission, requestedBy, target }) {
  if (typeof token !== 'string' || !token) return null;
  let claims;
  try { claims = jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
  if (claims?.kind !== KIND) return null;
  if (claims.permission !== permission) return null;
  if (claims.requestedBy !== String(requestedBy || '')) return null;
  if (claims.target !== String(target || '')) return null;
  return { approverName: claims.approverName, approverId: claims.approverId };
}

// Money has changed hands, or the order is under way, once it has left Pending.
// A pending (or parked, or held) order is an unpaid ticket - deleting it is
// fixing a typo. Anything further along is a sale that someone paid for.
export const orderIsPaid = (order) => (Number(order?.amountTendered) || 0) > 0
  || (order?.payments || []).length > 0
  || !['Pending', 'Parked', 'Reserved'].includes(order?.status);
