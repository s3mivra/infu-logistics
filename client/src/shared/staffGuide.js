// The quick guide for the people who run the till and the floor - staff,
// managers, admins and any custom role. Not the owner: the superadmin set the
// system up and sees every screen; this is for someone on their first shift.
//
// Built from what THIS person may do, so nobody reads steps for buttons they do
// not have: a section appears only when its permission is held, and the words
// follow the business (kitchen or warehouse). Kept as plain data so the choice
// of sections is tested without rendering anything.

export const GUIDE_SEEN_KEY = (userId) => `staffGuide.seen.${userId || 'anon'}`;

export function showsGuide(user) {
  return !!user && user.role !== 'superadmin';
}

export function staffGuide({ role, businessType, can = () => false }) {
  const log = businessType === 'log';
  const target = log ? 'Logistics' : 'Kitchen';
  const isLead = role === 'admin' || role === 'manager';
  const sections = [];

  sections.push({
    id: 'shift',
    title: 'Start and end your shift',
    steps: [
      'Sign in with your name and password, and type the cash already in the drawer as Starting Cash.',
      'Press Clock In when it asks - nothing can be sold before that. Later, the Clocked In button at the bottom of the sidebar is for a break or clocking out.',
      'Handing the till to someone? Open the account menu (your name, bottom left) → Switch User, and they type their PIN.',
      'Leaving: account menu → End Shift. Count the drawer when asked - the system compares it with the cash it expected.',
    ],
  });

  if (can('pos.use')) {
    sections.push({
      id: 'order',
      title: 'Take an order',
      steps: [
        'Orders & POS → + Manual Order. Tap items to add them, then set the quantity and any options.',
        log
          ? 'Selling to a client on file? Pick them, so their prices, terms and credit limit apply.'
          : 'Pick the order type (Dine-In, Take-out…). Orders customers place by scanning the table QR arrive in the queue on their own.',
        'The order appears in the queue as Pending until it is paid.',
      ],
    });
    sections.push({
      id: 'pay',
      title: 'Take payment',
      steps: [
        'On the order, choose how they pay. For cash, type the amount handed over to see the change.',
        'Check or QR payment: the check number or the reference number from their app is required.',
        `Press Pay & send to ${target}.${log ? ' The billing statement prints when it is sent.' : ''}`,
        ...(log ? ['Delivering now and collecting later? Press Not paid yet - send & collect later. It needs the customer\'s name, and a client\'s credit limit applies. The order keeps a "Not paid yet" tag until the owner records the payment.'] : []),
        'Senior Citizen / PWD: Add a discount on the order and fill in their name and ID number.',
        ...(can('orders.comp') ? ['Free of charge: Mark Complimentary and name who approved it.'] : []),
      ],
    });
    sections.push({
      id: 'fulfil',
      title: log ? 'Prepare and deliver' : 'Prepare and serve',
      steps: [
        log
          ? 'In Logistics View or Warehouse View each line goes Start prep → Mark ready.'
          : 'In Kitchen View and Bar View each item goes Start prep → Mark ready.',
        log
          ? 'Only part of it can go today? Use Partial fulfill, and deliver the rest later.'
          : 'At the counter, give each item as it is handed over.',
        'When everything is out, press Complete Order. Completing is what records the sale and takes the stock off.',
      ],
    });
    sections.push({
      id: 'mistakes',
      title: 'Fixing a mistake',
      steps: [
        'Entered by mistake and not paid yet: press the bin icon at the top of the order → Delete.',
        can('orders.delete')
          ? 'Already paid: you may delete it yourself - give the money back first. It is kept in the audit log under your name.'
          : 'Already paid: deleting it needs a manager. They type their PIN on your screen; you stay signed in.',
        can('orders.delete')
          ? 'Completed orders cannot be deleted. Press Void instead: it reverses the sale and puts the stock back.'
          : 'Completed orders cannot be deleted - ask a manager to void it.',
      ],
    });
  }

  if (can('inventory.view') || can('inventory.count') || can('inventory.manage') || can('inventory.waste')) {
    const steps = [
      'Inventory & Stock shows what is left. Ingredients and items come off by themselves when orders are completed.',
    ];
    if (can('inventory.count') || can('inventory.manage')) {
      steps.push('Counting: type what you actually counted in the Physical Count column, or use the ⋮ menu → Stock count from a sheet.');
    }
    if (can('inventory.waste')) {
      steps.push('Spoiled, spilled or wasted in preparation? Record it with its reason, so the count stays right.');
    }
    sections.push({ id: 'stock', title: 'Stock', steps });
  }

  if (can('reports.view')) {
    sections.push({
      id: 'reports',
      title: 'Reports',
      steps: [
        'Reports → choose a group (Sales, Receivable, Payable, Financials, Operations), then the report.',
        'Press Today, Last 7 days, This month… above the dates - the report loads at once. The dates are still there for any other range.',
        'PDF downloads what is on screen.',
      ],
    });
  }

  if (isLead) {
    const steps = [];
    if (can('orders.delete')) {
      steps.push('Your PIN approves deleting paid orders on other people\'s tills. Keep it to yourself - the approval is recorded under your name.');
    }
    const waiting = [
      can('requisitions.approve') && 'requisition slips in Ledger → Approvals',
      can('pricing.approve') && 'price and cost changes in Reports → Price Changes',
      can('production.approve') && 'production orders in Production',
    ].filter(Boolean);
    if (waiting.length) {
      steps.push(`Waiting for your approval: ${waiting.join('; ')}.`);
    }
    if (log) {
      steps.push('Orders sent "Not paid yet" are listed in Ledger → AR & AP until the owner records the payment.');
    }
    steps.push('Changes to what a role may do apply at once - nobody has to sign out.');
    sections.push({ id: 'lead', title: role === 'admin' ? 'For admins' : 'For managers', steps });
  }

  sections.push({
    id: 'find',
    title: 'Finding your way',
    steps: [
      'Press Go to… at the top of the sidebar (or Ctrl + K) and type the screen you want.',
      'You only see the screens your role allows. Missing one you need? Ask the owner.',
      'This guide is always in the account menu → Quick guide.',
    ],
  });

  return sections;
}
