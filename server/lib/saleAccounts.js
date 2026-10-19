// Where the money side of a SALE lands.
//
// The payment-method map (accountForPaymentMethod in server.js) serves both
// directions: for a purchase, "On Account" means bought on credit, so it is
// routed to 220000 Accounts Payable. A backdated sale read the same map, so a
// sale "On Account" was booked as a DEBIT TO ACCOUNTS PAYABLE - it shrank what
// is owed to suppliers (driving A/P negative) and never reached Accounts
// Receivable, while the A/R subledger still listed the invoice as owed.
//
// For a sale, anything the map routes to a liability is money the CUSTOMER
// owes, i.e. Accounts Receivable.
export const AR = { code: '120000', name: 'Accounts Receivable' };

export function saleDebitAccount(accountForPaymentMethod, method) {
  const a = accountForPaymentMethod(method);
  if (!a || String(a.code || '').startsWith('2')) return { ...AR };
  return a;
}

// One-time repair of backdated sales already booked that way: a correcting
// entry per sale (DR Accounts Receivable / CR the payable it hit), dated the
// sale's day - or today when that month is closed, so a signed-off month is
// never changed. Nothing is rewritten: the original entry stays, the correction
// sits beside it, and running this again finds nothing left to correct.
export async function repairBackdatedSalesOnPayables(mongoose, { mkRef } = {}) {
  const JournalEntry = mongoose.model('JournalEntry');
  const ClosedPeriod = (() => { try { return mongoose.model('ClosedPeriod'); } catch { return null; } })();
  const entries = await JournalEntry.find({
    description: /^Backdated sale: /,
    lines: { $elemMatch: { accountCode: /^2/, debit: { $gt: 0 } } },
  }).lean();
  const fixed = [];
  for (const je of entries) {
    const tag = `[fixes ${je.reference}]`;
    if (await JournalEntry.exists({ description: { $regex: tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } })) continue;
    const wrong = (je.lines || []).filter(l => /^2/.test(String(l.accountCode)) && Number(l.debit) > 0);
    if (!wrong.length) continue;
    const d = new Date(je.date);
    const closed = ClosedPeriod ? await ClosedPeriod.exists({ year: d.getFullYear(), month: d.getMonth() + 1 }) : false;
    const lines = [];
    for (const l of wrong) {
      const amt = Math.round(Number(l.debit) * 100) / 100;
      lines.push({ accountCode: AR.code, accountName: AR.name, debit: amt, credit: 0 });
      lines.push({ accountCode: l.accountCode, accountName: l.accountName, debit: 0, credit: amt });
    }
    const reference = mkRef ? await mkRef() : `BDFIX-${je.reference}`;
    await JournalEntry.create({
      date: closed ? new Date() : d,
      reference,
      description: `Correction: ${je.description} was booked to ${wrong.map(l => `${l.accountCode} ${l.accountName}`).join(', ')} instead of Accounts Receivable${closed ? ` (sale dated ${d.toISOString().slice(0, 10)}, a closed month)` : ''} ${tag}`,
      lines,
    });
    fixed.push({ reference: je.reference, amount: lines.filter(x => x.debit > 0).reduce((s, x) => s + x.debit, 0) });
  }
  return fixed;
}
