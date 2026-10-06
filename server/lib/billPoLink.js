// Linking a payable that did not come from a delivery in this app - one carried
// in by the setup workbook, or typed in - to the purchase order it was for.
// The bill becomes that order's payable and the order closes on its own: its
// goods and its debt are already in the books, so there is nothing to receive.
// Used by the PO-number edit on a bill and by the workbook imports alike.

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  // An order already received has the payable the app raised for it; a second
  // one on the same order would be the same debt twice. (An order closed by an
  // earlier link is not "received".)
  const own = await Bill.findOne({ purchaseOrderId: po._id, source: 'PO', status: { $ne: 'Rejected' } }, { billNumber: 1 }).lean();
  if (own || (['Complete', 'Incomplete'].includes(po.status) && !po.closedByBill)) {
    return { po, status: 409, error: `${po.poNumber} was received in the app${own ? ` and already has its payable, ${own.billNumber}` : ''}. Linking this bill too would count the same debt twice.` };
  }
  return { po };
}

// Close the order a bill was just linked to.
export async function closeLinkedPo(mongoose, po, bill) {
  if (!po || ['Complete', 'Incomplete'].includes(po.status)) return;
  await mongoose.model('PurchaseOrder').updateOne({ _id: po._id }, { $set: { status: 'Complete', closedByBill: bill.billNumber, statusBeforeLink: po.status } });
}

// For an import: the bill was saved with its PO number as text; make it a real
// link when that number is an order here. Returns a note for the import's
// result when the number matched an order that could not take the bill.
export async function linkImportedBill(mongoose, bill, scope = {}) {
  if (!bill?.poNumber) return '';
  const { po, error } = await findLinkablePo(mongoose, { wanted: bill.poNumber, bill, scope });
  if (!po) return '';
  if (error) return `${bill.billNumber}: PO number kept as a note only - ${error}`;
  await mongoose.model('Bill').updateOne({ _id: bill._id }, { $set: { purchaseOrderId: po._id, poNumber: po.poNumber } });
  await closeLinkedPo(mongoose, po, bill);
  return '';
}

// The bill that held an order closed has let go of it (its PO number was
// changed or removed, or the bill was rejected): the order reopens to the
// status it had, unless another payable from the books still holds it closed.
export async function releaseLinkedPo(mongoose, poId) {
  const PurchaseOrder = mongoose.model('PurchaseOrder');
  const old = await PurchaseOrder.findById(poId).lean();
  if (!old?.closedByBill) return;
  const other = await mongoose.model('Bill').findOne({ purchaseOrderId: old._id, source: { $ne: 'PO' }, status: { $ne: 'Rejected' } }, { billNumber: 1 }).lean();
  await PurchaseOrder.updateOne({ _id: old._id }, other
    ? { $set: { closedByBill: other.billNumber } }
    : { $set: { status: old.statusBeforeLink || 'Ordered', closedByBill: '', statusBeforeLink: '' } });
}
