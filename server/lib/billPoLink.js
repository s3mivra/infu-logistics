// Linking a payable that did not come from a delivery in this app - one carried
// in by the setup workbook, or typed in - to the purchase order it was for.
// Used by the PO-number edit on a bill and by the workbook imports alike.
//
// What the link does depends on whether the bill is already in the books:
//
//   in the books   (an opening payable, or a typed-in bill already approved)
//                  The goods and the debt are both recorded. The order closes
//                  on its own - receiving it would count them a second time.
//
//   still pending  (a typed-in bill nobody has approved yet)
//                  Nothing is recorded yet. The order stays open; when its
//                  delivery is received, this bill becomes that delivery's
//                  payable instead of a second one being raised.

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const billIsInBooks = (bill) => bill?.source === 'Opening' || (bill?.source === 'Manual' && bill?.status !== 'Pending' && bill?.status !== 'Rejected');

// The carried bills (not raised by a delivery, not rejected) that name an order -
// linked for real, or only by the PO number typed on them.
export const carriedBillsFilter = (po) => ({
  source: { $ne: 'PO' }, status: { $ne: 'Rejected' },
  $or: [{ purchaseOrderId: po._id }, { purchaseOrderId: null, poNumber: po.poNumber }],
});

// The order a typed PO number names, and why it cannot take this bill (if it
// cannot). `po` is null when no order here has that number - then the number
// is only a reference.
export async function findLinkablePo(mongoose, { wanted, bill, scope = {} }) {
  const PurchaseOrder = mongoose.model('PurchaseOrder');
  const Bill = mongoose.model('Bill');
  const number = String(wanted || '').trim();
  if (!number) return { po: null };
  const po = await PurchaseOrder.findOne({ poNumber: { $regex: `^${escapeRegex(number)}$`, $options: 'i' }, ...scope }).lean();
  if (!po) return { po: null };
  if (po.supplierId && bill.supplierId && String(po.supplierId) !== String(bill.supplierId)) {
    return { po, status: 400, error: `${po.poNumber} is an order to ${po.supplier || 'another supplier'}, not ${bill.supplierName || 'this supplier'}.` };
  }
  if (po.status === 'Cancelled') return { po, status: 400, error: `${po.poNumber} was cancelled.` };
  // The bill has to be for the whole order: the same total, to the centavo.
  // A bill for a different amount is for something else (or only part of it),
  // and linking it would make the order look settled when it is not.
  const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const poTotal = Math.round((Number(po.estTotal) || 0) * 100) / 100;
  const billTotal = Math.round((Number(bill.amount) || 0) * 100) / 100;
  if (Math.abs(poTotal - billTotal) > 0.005) {
    return { po, status: 400, error: `${po.poNumber} totals ${peso(poTotal)} but this bill is ${peso(billTotal)}. They must be the same amount to be linked.` };
  }
  // One order, one such bill: an order already linked cannot be linked again.
  const taken = await Bill.findOne({ ...carriedBillsFilter(po), _id: { $ne: bill._id } }, { billNumber: 1 }).lean();
  if (taken) return { po, status: 409, error: `${po.poNumber} is already linked to ${taken.billNumber}. An order can be linked to one bill only.` };
  // An order already received has the payable the app raised for it; a second
  // one on the same order would be the same debt twice. (An order closed by an
  // earlier link is not "received".)
  const own = await Bill.findOne({ purchaseOrderId: po._id, source: 'PO', status: { $ne: 'Rejected' } }, { billNumber: 1 }).lean();
  if (own || (['Complete', 'Incomplete'].includes(po.status) && !po.closedByBill)) {
    return { po, status: 409, error: `${po.poNumber} was received in the app${own ? ` and already has its payable, ${own.billNumber}` : ''}. Linking this bill too would count the same debt twice.` };
  }
  return { po };
}

// Bring an order's open/closed state into line with the bill linked to it:
// closed while a bill already in the books holds it, open otherwise.
export async function syncLinkedPo(mongoose, poId) {
  const PurchaseOrder = mongoose.model('PurchaseOrder');
  const po = await PurchaseOrder.findById(poId).lean();
  if (!po) return;
  const linked = await mongoose.model('Bill').find({ purchaseOrderId: po._id, source: { $ne: 'PO' }, status: { $ne: 'Rejected' } }, { billNumber: 1, source: 1, status: 1 }).lean();
  const holder = linked.find(billIsInBooks);
  if (holder) {
    if (['Ordered', 'Processing'].includes(po.status)) {
      await PurchaseOrder.updateOne({ _id: po._id }, { $set: { status: 'Complete', closedByBill: holder.billNumber, statusBeforeLink: po.status } });
    } else if (po.closedByBill && po.closedByBill !== holder.billNumber) {
      await PurchaseOrder.updateOne({ _id: po._id }, { $set: { closedByBill: holder.billNumber } });
    }
  } else if (po.closedByBill) {
    await PurchaseOrder.updateOne({ _id: po._id }, { $set: { status: po.statusBeforeLink || 'Ordered', closedByBill: '', statusBeforeLink: '' } });
  }
}

// For an import: the bill was saved with its PO number as text; make it a real
// link when that number is an order here. Returns a note for the import's
// result when the number matched an order that could not take the bill.
export async function linkImportedBill(mongoose, bill, scope = {}) {
  if (!bill?.poNumber) return '';
  const { po, error } = await findLinkablePo(mongoose, { wanted: bill.poNumber, bill, scope });
  if (!po) return '';
  if (error) {
    // Kept off the bill altogether: left as text it would still read as a
    // link to an order that refused it.
    await mongoose.model('Bill').updateOne({ _id: bill._id }, { $set: { poNumber: '' } });
    return `${bill.billNumber}: PO number not kept - ${error}`;
  }
  await mongoose.model('Bill').updateOne({ _id: bill._id }, { $set: { purchaseOrderId: po._id, poNumber: po.poNumber } });
  await syncLinkedPo(mongoose, po._id);
  return '';
}

// One-time: orders an earlier version closed as soon as ANY bill was linked,
// including a bill still pending. Those reopen.
export async function reopenOrdersClosedByPendingBills(mongoose) {
  const closed = await mongoose.model('PurchaseOrder').find({ closedByBill: { $nin: ['', null] } }, { _id: 1 }).lean();
  for (const po of closed) await syncLinkedPo(mongoose, po._id);
  return closed.length;
}
