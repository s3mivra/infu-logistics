import { Network } from 'lucide-react';
import * as ui from '../../shared/ui';

// Refunds.
// Moved out of AdminDashboard.jsx as it was. The dashboard calls this once per
// render and hands in what these functions read, so each one still sees
// that render's values exactly as it did inline.
export default function makeRefunds(deps) {
  const {
    refundModal, refundForm, setRefundSubmitting, apiFetch, setRefundModal, setRefundForm, fetchOrders,
  } = deps;

  // ── Refund ──────────────────────────────────────────────────────────────────
  const handleRefund = async () => {
    if (!refundModal || !refundForm.reason.trim()) return ui.alert('Reason required.');
    setRefundSubmitting(true);
    try {
      const res = await apiFetch(`/api/orders/${refundModal._id}/refund`, { method: 'POST', body: JSON.stringify({ reason: refundForm.reason, refundAmount: parseFloat(refundForm.refundAmount) || refundModal.total, inventoryAction: refundForm.inventoryAction }) });
      const d = await res.json();
      if (d.success) { setRefundModal(null); setRefundForm({ reason: '', refundAmount: '', inventoryAction: 'Restock' }); fetchOrders(); ui.alert('Refund processed. Reversal journal created.'); }
      else ui.alert(d.error || 'Refund failed.');
    } catch { ui.alert('Network error.'); }
    finally { setRefundSubmitting(false); }
  };

  // Line-item + qty precise refund - not everything on the order has to come
  // back, and not all of a line's qty either. `items` is [{ itemIndex, qty }].
  const handlePartialRefund = async (items) => {
    if (!refundModal || !refundForm.reason.trim()) return ui.alert('Reason required.');
    if (!items || items.length === 0) return ui.alert('Select at least one item to refund.');
    setRefundSubmitting(true);
    try {
      const res = await apiFetch(`/api/orders/${refundModal._id}/partial-refund`, {
        method: 'POST',
        body: JSON.stringify({ items, reason: refundForm.reason, inventoryAction: refundForm.inventoryAction }),
      });
      const d = await res.json();
      if (d.success) {
        setRefundModal(null);
        setRefundForm({ reason: '', refundAmount: '', inventoryAction: 'Restock' });
        fetchOrders();
        ui.alert(d.fullyRefunded
          ? `Refunded ₱${(d.refundAmount || 0).toFixed(2)} - every item on this order is now refunded.`
          : `Refunded ₱${(d.refundAmount || 0).toFixed(2)}. The order stays Completed - the rest can still be refunded later.`);
      } else ui.alert(d.error || 'Refund failed.');
    } catch { ui.alert('Network error.'); }
    finally { setRefundSubmitting(false); }
  };

  // Return some line(s)/qty and add a replacement item on the SAME order, net-
  // settled in one cash movement. `returnItems` is [{ itemIndex, qty }] (may be
  // empty - a pure add-on exchange), `newItems` is [{ productId, quantity }].
  const handleExchange = async (returnItems, newItems) => {
    if (!refundModal || !refundForm.reason.trim()) return ui.alert('Reason required.');
    if (!newItems || newItems.length === 0) return ui.alert('Pick at least one replacement item.');
    setRefundSubmitting(true);
    try {
      const res = await apiFetch(`/api/orders/${refundModal._id}/exchange`, {
        method: 'POST',
        body: JSON.stringify({ returnItems, newItems, reason: refundForm.reason, inventoryAction: refundForm.inventoryAction }),
      });
      const d = await res.json();
      if (d.success) {
        setRefundModal(null);
        setRefundForm({ reason: '', refundAmount: '', inventoryAction: 'Restock' });
        fetchOrders();
        const delta = d.netDelta || 0;
        ui.alert(Math.abs(delta) < 0.01
          ? 'Exchange processed - even swap, no cash movement.'
          : delta > 0
            ? `Exchange processed - customer paid ₱${delta.toFixed(2)} more.`
            : `Exchange processed - ₱${Math.abs(delta).toFixed(2)} refunded to the customer.`);
      } else ui.alert(d.error || 'Exchange failed.');
    } catch { ui.alert('Network error.'); }
    finally { setRefundSubmitting(false); }
  };

  return {
    handleRefund, handlePartialRefund, handleExchange,
  };
}
