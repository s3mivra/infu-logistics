// Three-way match: the purchase order, the receiving report and the supplier's
// invoice must agree before a bill is released for payment.
//
//   PO value        what we agreed to pay for what ARRIVED:
//                   received qty × the PO's unit cost, line by line
//   Received value  what receiving actually booked into Accounts Payable
//                   (the bill's amount - it posted at receipt)
//   Invoice amount  what the supplier is billing us
//
// Pure: no DB. The bills route feeds it the PO and bill and acts on the answer.
import { roundMoney, toCentavos } from './money.js';

// A peso either way is rounding on a supplier's invoice, not a dispute.
export const MATCH_TOLERANCE = 1;

// `delivery` is what arrived in the delivery being billed (Bill.deliveryLines).
// With it, the PO price is checked against that delivery alone: a PO received
// in two parts raises two bills, and the second invoice must not be compared
// with both deliveries together. Without it (bills raised before deliveries
// were recorded) the whole PO's receipts are used, as before.
export function threeWayMatch({ po, receivedValue, invoiceAmount, delivery, tolerance = MATCH_TOLERANCE }) {
  const issues = [];
  const lines = Array.isArray(delivery) && delivery.length
    ? delivery.map((d) => ({ receivedQty: d.qty, unitCost: d.unitCost }))
    : (po?.lines || []).filter((l) => l.receivedQty != null);
  const poValue = roundMoney(lines.reduce((s, l) => s + (Number(l.receivedQty) || 0) * (Number(l.unitCost) || 0), 0));
  for (const l of po?.lines || []) {
    const got = Number(l.receivedQty) || 0;
    const ordered = Number(l.orderedQty) || 0;
    if (got > ordered + 1e-9) {
      issues.push({ code: 'over_receipt', text: `${l.itemName || 'A line'}: received ${got} but only ${ordered} was ordered.` });
    }
  }
  const inv = roundMoney(invoiceAmount);
  const rcv = roundMoney(receivedValue);
  const tol = toCentavos(tolerance);
  if (Math.abs(toCentavos(inv) - toCentavos(rcv)) > tol) {
    issues.push({ code: 'invoice_vs_receipt', text: `The invoice (₱${inv.toFixed(2)}) differs from what was received (₱${rcv.toFixed(2)}) by ₱${roundMoney(inv - rcv).toFixed(2)}.` });
  }
  if (lines.length && Math.abs(toCentavos(inv) - toCentavos(poValue)) > tol) {
    issues.push({ code: 'invoice_vs_po', text: `The invoice (₱${inv.toFixed(2)}) differs from the PO price of what arrived (₱${poValue.toFixed(2)}) by ₱${roundMoney(inv - poValue).toFixed(2)}.` });
  }
  return {
    status: issues.length ? 'Exception' : 'Matched',
    poValue, receivedValue: rcv, invoiceAmount: inv,
    variance: roundMoney(inv - rcv),
    issues,
  };
}

// The same supplier's invoice number, compared the way a person reads it:
// case, spaces and dashes do not make "INV-0012" a different invoice.
export const normalizeInvoiceNo = (v) => String(v ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');
