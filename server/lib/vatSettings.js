// The business's VAT configuration, read from Settings.
//
// One reader, because every posting path has to agree on it: the register, a
// backdated sale, and the VAT return all have to see the same rate and the
// same inclusive/exclusive basis, or the books disagree with the receipts.
import { normaliseVatRate, DEFAULT_VAT_RATE } from './vat.js';

export async function loadVatConfig(Settings) {
  const [enabledRow, rateRow, orderRow, inclusiveRow] = await Promise.all([
    Settings.findOne({ key: 'vatEnabled' }).lean(),
    Settings.findOne({ key: 'vatRate' }).lean(),
    Settings.findOne({ key: 'scPwdOrder' }).lean(),
    Settings.findOne({ key: 'vatInclusive' }).lean(),
  ]);
  return {
    enabled: enabledRow?.value === true || enabledRow?.value === 'true',
    rate: normaliseVatRate(rateRow?.value, DEFAULT_VAT_RATE),
    scPwdOrder: orderRow?.value === 'discount-first' ? 'discount-first' : 'vat-first',
    // Default true: absent setting means the Philippine retail default, which is
    // also how every order booked before this option existed was priced.
    inclusive: inclusiveRow ? inclusiveRow.value !== false && inclusiveRow.value !== 'false' : true,
  };
}
