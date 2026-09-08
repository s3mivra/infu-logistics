// Optional accounting modules, and whether this deployment uses them.
//
// Not every business needs every one of these. A small cafe on percentage tax
// withholds nothing and runs payroll out of a notebook; a company with staff
// and a landlord needs both. VAT already worked this way - a `vatEnabled`
// switch in Settings - and these follow the same shape rather than inventing a
// second mechanism.
//
// A module that is OFF is off end to end: its routes refuse, its accounts stay
// out of the pickers, and its screen is hidden. Half-on is worse than either -
// a screen that posts into books nobody is reading is how a business ends up
// with a Withholding Tax Payable balance it cannot explain.
//
// The Settings key is the switch, and it is deliberately the same key the
// client reads, so there is one answer to "is this on" and not two.

export const OPTIONAL_MODULES = {
  bankReconciliation: {
    key: 'bankReconciliationEnabled',
    label: 'Bank Reconciliation',
    // Why someone would turn it on, in the words of the person deciding.
    blurb: 'Match a bank statement against the ledger and see what has not cleared.',
    // Off by default: a business paid only in cash has no statement to match,
    // and an unused module on the sidebar is noise.
    default: false,
  },
  withholdingTax: {
    key: 'withholdingTaxEnabled',
    label: 'Withholding Tax',
    blurb: 'Withhold tax on rent, professional fees and other services, and track what is due to the BIR.',
    default: false,
  },
  payroll: {
    key: 'payrollEnabled',
    label: 'Payroll',
    blurb: 'Turn hours into a payroll run: gross pay, statutory deductions, and what is left to pay out.',
    default: false,
  },
};

export const MODULE_KEYS = new Set(Object.values(OPTIONAL_MODULES).map(m => m.key));

// A stored value can be a real boolean or the string a form posted. Both mean
// the same thing, and reading only one of them is how a switch appears to do
// nothing.
export function truthy(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return fallback;
}

// Reads one module's switch. `Settings` is passed in rather than imported so
// this stays a pure library the tests can drive directly.
export async function isModuleEnabled(Settings, name) {
  const mod = OPTIONAL_MODULES[name];
  if (!mod) return false;
  const row = await Settings.findOne({ key: mod.key }).lean();
  return truthy(row?.value, mod.default);
}

// Express guard. A disabled module answers 404 rather than 403: to a
// deployment that does not use it, the feature does not exist, and saying
// "forbidden" would imply a permission the operator could go and grant.
export function requireModule(Settings, name) {
  return async (req, res, next) => {
    if (await isModuleEnabled(Settings, name)) return next();
    const label = OPTIONAL_MODULES[name]?.label || name;
    res.status(404).json({
      success: false,
      error: `${label} is not switched on for this business. Turn it on in Settings first.`,
      module: name,
    });
  };
}

export async function moduleStates(Settings) {
  const rows = await Settings.find({ key: { $in: [...MODULE_KEYS] } }).lean();
  const byKey = new Map(rows.map(r => [r.key, r.value]));
  return Object.entries(OPTIONAL_MODULES).map(([name, m]) => ({
    name, key: m.key, label: m.label, blurb: m.blurb,
    enabled: truthy(byKey.get(m.key), m.default),
    default: m.default,
  }));
}
