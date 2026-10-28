// One colour per meaning, for every status tag in the app, so "green" always
// means done and "red" always means a problem - whichever screen you are on.
//   done      green  - finished, nothing left to do
//   waiting   amber  - needs someone's action or decision
//   moving    blue   - under way, nobody needs to act yet
//   problem   red    - late, refused or bounced
//   closed    grey   - cancelled or no longer in use
export const TONES = {
  done:    'bg-green-500/15 text-success',
  waiting: 'bg-amber-400/15 text-warning',
  moving:  'bg-blue-500/15 text-info',
  problem: 'bg-red-500/15 text-danger',
  closed:  'bg-white/10 text-fg/70',
};

const MEANING = {
  done: ['Completed', 'Complete', 'Paid', 'Approved', 'Received', 'Posted', 'Accepted', 'Active', 'Settled', 'Cleared', 'Closed', 'Delivered', 'Fulfilled', 'Done'],
  waiting: ['Pending', 'Draft', 'Requested', 'Partially Paid', 'Partially Delivered', 'Partially Fulfilled', 'Reserved', 'Quoted', 'CounterPending', 'AwaitingFinal', 'Open', 'Fully Depreciated', 'Due', 'Post-dated'],
  moving: ['Ordered', 'Processing', 'Preparing', 'Ready', 'Released', 'In Transit', 'Sent', 'Issued'],
  problem: ['Overdue', 'Rejected', 'Declined', 'Incomplete', 'Bounced', 'Failed', 'Voided', 'Refunded', 'Over'],
  closed: ['Cancelled', 'Canceled', 'Expired', 'Disposed', 'Archived', 'Discarded', 'Inactive'],
};
const BY_STATUS = new Map(Object.entries(MEANING).flatMap(([tone, list]) => list.map((s) => [s.toLowerCase(), tone])));

/** The tag classes for a status word; unknown words read as closed (grey). */
export const statusTone = (status) => TONES[BY_STATUS.get(String(status || '').toLowerCase()) || 'closed'];
