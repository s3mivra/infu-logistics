import { Receipt } from 'lucide-react';
import { buildBillingDocHTML, printBillingDoc } from '../../shared/billingDocument';
import * as ui from '../../shared/ui';
import { dateStr } from '../../shared/businessDay.js';

// Printed sales documents: the billing statement and the delivery receipt.
// Moved out of AdminDashboard.jsx as it was. The dashboard calls this once per
// render and hands in what these functions read, so each one still sees
// that render's values exactly as it did inline.
export default function makeSalesDocuments(deps) {
  const {
    clientAccounts, systemSettings, activeAdmin, BIZ_NAME,
  } = deps;

  // ── Billing Statement print (log mode) ──────────────────────────────────────
  // Uses the shared A4 document template (same one the Procurement purchase-order
  // print uses). Letterhead/payment/contact come from system settings, falling
  // back to VITE_BILLING_* env then defaults.
  const printBillingStatement = (order) => {
    const dateStr = new Date(order.createdAt || Date.now()).toLocaleDateString('en-PH', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    const transactionNo = order.billingNumber || order.orderNumber || '-';
    const isDelivery = ['Manual Delivery', 'Lalamove'].includes(order.table);

    // Who the invoice is made out to. A VAT-registered buyer is invoiced in
    // their REGISTERED name with their TIN and registered address; that is what
    // makes the document usable for their own input-VAT claim. Everyone else is
    // billed to the name on the order, exactly as before.
    const buyer = (clientAccounts || []).find(c =>
      String(c._id) === String(order.clientId || order.clientAccountId || ''));
    const billTo = {
      name: (buyer?.isVatRegistered && buyer?.registeredName) || buyer?.name || order.customerName || '',
      tin: buyer?.tin || '',
      address: buyer?.registeredAddress || '',
    };

    const items = (order.items || []).map(item => {
      const addOnTotal = (item.selectedAddOns || []).reduce((s, a) => s + Number(a.price || 0), 0);
      const unitPrice  = item.price + addOnTotal;
      const addOnDesc  = (item.selectedAddOns || []).map(a => a.name).join(', ');
      return {
        code: item.productCode || '',
        desc: item.name + (item.size ? ` (${item.size})` : '') + (addOnDesc ? ` + ${addOnDesc}` : ''),
        // The till's print name, on the customer's copy only (billingDocument.js).
        printDesc: item.printName ? item.printName + (item.size ? ` (${item.size})` : '') + (addOnDesc ? ` + ${addOnDesc}` : '') : '',
        qty: item.quantity,
        unitPrice,
        total: unitPrice * item.quantity,
      };
    });

    const schedRows = [
      order.scheduledTime   ? { label: `Scheduled ${isDelivery ? 'Delivery' : 'Pickup'} Time:`, value: order.scheduledTime } : null,
      order.deliveryAddress ? { label: 'Delivery Address:', value: order.deliveryAddress } : null,
      order.customerPhone   ? { label: 'Contact No.:', value: order.customerPhone } : null,
    ].filter(Boolean);

    printBillingDoc(buildBillingDocHTML({
      docTitle: 'BILLING STATEMENT',
      dateLabel: 'Submitted date',
      dateStr,
      settings: systemSettings,
      metaFields: [
        { label: 'Invoice For', value: billTo.name },
        // A VAT-registered buyer needs their registered name, TIN and address on
        // the invoice, or they cannot claim the VAT they just paid.
        ...(billTo.tin ? [{ label: 'TIN', value: billTo.tin }] : []),
        ...(billTo.address ? [{ label: 'Registered Address', value: billTo.address }] : []),
        ...(order.scPwdName ? [{ label: order.scPwdKind === 'PWD' ? 'PWD Cardholder' : 'Senior Citizen', value: `${order.scPwdName} (ID ${order.scPwdIdNumber})` }] : []),
        { label: 'Payable To', value: '' },
        { label: 'Transaction No.', value: transactionNo },
        // The registered serial, once the sale has completed and been issued
        // one. An unfinished order has no receipt number to show.
        ...(order.orNumber ? [{ label: 'OR No.', value: order.orNumber }] : []),
        // Delivery receipts, one per delivery (logistics). Several when the
        // order went out in parts.
        ...((order.deliveryReceipts || []).length || order.drNumber ? [{ label: 'DR No.', value: (order.deliveryReceipts || []).map(d => d.drNumber).join(', ') || order.drNumber }] : []),
      ],
      subFields: [
        { label: 'Terms of Payment', value: order.paymentMethod || '' },
        { label: 'Order Type', value: order.table || '' },
      ],
      schedRows,
      items,
      totals: [
        { label: 'Subtotal', value: order.subtotal || order.total || 0 },
        { label: 'Discount', value: order.discount || 0 },
        { label: 'Delivery Fee', value: order.deliveryFee || 0 },
        // The VAT split, from the order's own stamped figures - a VAT invoice
        // has to show what part of the total is tax.
        ...((order.vatAmount || 0) > 0 ? [
          { label: 'VATable Sales', value: order.vatableSales || 0 },
          ...((order.vatExemptSales || 0) > 0 ? [{ label: 'VAT-Exempt Sales', value: order.vatExemptSales }] : []),
          { label: 'VAT (' + Math.round((order.vatRate || 0) * 100) + '%)', value: order.vatAmount },
        ] : []),
        { label: 'TOTAL', value: order.total || 0, grand: true },
      ],
      // Prepared By pre-filled with whoever rang up the sale (falls back to the
      // current user printing it, for legacy orders with no cashier on record).
      // Checked/Received By stay blank ruled lines - those really do get signed
      // by someone else after the fact.
      signatures: [
        `PREPARED BY${(order.cashier || activeAdmin?.name) ? `: ${order.cashier || activeAdmin?.name}` : ''} - Signature over Printed Name / Date`,
        'CHECKED BY: Signature over Printed Name / Date',
        'RECEIVED BY: Signature over Printed Name / Date',
      ],
    }));
  };

  // ── Delivery Receipt print (logistics) ───────────────────────────────────────
  // Prints TWO copies in one job: ORIGINAL for the customer, DUPLICATE for the
  // office. Both are identical apart from the copy label, so a signature on the
  // duplicate is proof of delivery.
  //
  // Item lines are pre-filled from the order, but the delivery details (driver,
  // plate, received-by, date, signature) are printed as blank ruled fields - the
  // crew fills those in by hand at the drop-off, which is how the paper DR is
  // actually used.
  const printDeliveryReceipt = (order) => {
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) return ui.alert('Pop-up blocked - allow pop-ups for this site.');

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const BILL_NAME  = import.meta.env.VITE_BILLING_NAME     || BIZ_NAME;
    const BILL_ADDR1 = import.meta.env.VITE_BILLING_ADDRESS1 || '';
    const BILL_ADDR2 = import.meta.env.VITE_BILLING_ADDRESS2 || '';
    const BILL_PHONE = import.meta.env.VITE_BILLING_PHONE    || '';

    const drNo = order.billingNumber || order.orderNumber || '';
    const dateStr = new Date(order.createdAt || Date.now()).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

    // The customer's ORIGINAL shows a line's print name when the till gave one;
    // the office DUPLICATE always shows the real product name.
    const rowsFor = (original) => (order.items || []).map((item, i) => {
      const addOns = (item.selectedAddOns || []).map(a => a.name).join(', ');
      const shown = original && item.printName ? item.printName : item.name;
      const desc = esc(shown) + (item.size ? ` (${esc(item.size)})` : '') + (addOns ? ` + ${esc(addOns)}` : '');
      return `<tr>
        <td class="n">${i + 1}</td>
        <td class="c">${esc(item.productCode || '')}</td>
        <td class="d">${desc}</td>
        <td class="q">${esc(item.quantity)}</td>
        <td class="u"></td>
      </tr>`;
    }).join('');

    // Pad to a fixed number of rows so the form keeps its shape and leaves room
    // for hand-written additions.
    const MIN_ROWS = 10;
    const padding = Math.max(0, MIN_ROWS - (order.items || []).length);
    const padRows = Array.from({ length: padding }, () =>
      '<tr><td class="n">&nbsp;</td><td class="c"></td><td class="d"></td><td class="q"></td><td class="u"></td></tr>'
    ).join('');

    const copy = (label, note) => { const rows = rowsFor(label === 'ORIGINAL'); return `
      <section class="dr">
        <div class="copy-tag">${label}<span class="copy-note">${note}</span></div>
        <header>
          <div class="biz">
            <div class="biz-name">${esc(BILL_NAME)}</div>
            ${BILL_ADDR1 ? `<div class="biz-line">${esc(BILL_ADDR1)}</div>` : ''}
            ${BILL_ADDR2 ? `<div class="biz-line">${esc(BILL_ADDR2)}</div>` : ''}
            ${BILL_PHONE ? `<div class="biz-line">Tel: ${esc(BILL_PHONE)}</div>` : ''}
          </div>
          <div class="doc">
            <div class="doc-title">DELIVERY RECEIPT</div>
            <div class="doc-no">No. <b>${esc(drNo)}</b></div>
            <div class="doc-date">Date: ${esc(dateStr)}</div>
          </div>
        </header>

        <div class="party">
          <div class="fld wide"><span class="lbl">Delivered To</span><span class="val">${esc(order.customerName || '')}</span></div>
          <div class="fld wide"><span class="lbl">Address</span><span class="val"></span></div>
          <div class="fld"><span class="lbl">P.O. / Ref No.</span><span class="val"></span></div>
          <div class="fld"><span class="lbl">Terms</span><span class="val">${esc(order.termsOfPayment || '')}</span></div>
        </div>

        <table>
          <thead>
            <tr><th class="n">#</th><th class="c">Item Code</th><th class="d">Description</th><th class="q">Qty</th><th class="u">Unit</th></tr>
          </thead>
          <tbody>${rows}${padRows}</tbody>
        </table>

        ${order.orderNotes ? `<div class="notes"><b>Notes:</b> ${esc(order.orderNotes)}</div>` : ''}

        <div class="sigs">
          <div class="sig"><div class="line"></div><div class="cap">Prepared By${(order.cashier || activeAdmin?.name) ? `: ${esc(order.cashier || activeAdmin?.name)}` : ''}</div></div>
          <div class="sig"><div class="line"></div><div class="cap">Driver / Plate No.</div></div>
          <div class="sig"><div class="line"></div><div class="cap">Received By (Signature over Printed Name)</div></div>
          <div class="sig narrow"><div class="line"></div><div class="cap">Date Received</div></div>
        </div>
        <div class="foot">Received the above goods in good order and condition.</div>
      </section>`; };

    win.document.write(`<!DOCTYPE html><html><head><title>Delivery Receipt ${esc(drNo)}</title><style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; margin:0; color:#000; font-size:11px; }
      .dr { padding:10mm 10mm 6mm; border-bottom:1px dashed #999; position:relative; }
      /* Each copy fills half a page so both land on one sheet; the second starts
         a new page only if the content genuinely overflows. */
      .copy-tag { position:absolute; top:4mm; right:10mm; font-size:10px; font-weight:bold; letter-spacing:1px; border:1px solid #000; padding:2px 8px; }
      .copy-note { font-weight:normal; letter-spacing:0; margin-left:6px; color:#444; }
      header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:4mm; margin-bottom:4mm; }
      .biz-name { font-size:15px; font-weight:bold; text-transform:uppercase; }
      .biz-line { font-size:10px; color:#333; }
      .doc { text-align:right; }
      .doc-title { font-size:14px; font-weight:bold; letter-spacing:1px; }
      .doc-no, .doc-date { font-size:11px; margin-top:2px; }
      .party { display:grid; grid-template-columns:1fr 1fr; gap:2mm 6mm; margin-bottom:4mm; }
      .fld { display:flex; align-items:flex-end; gap:4px; }
      .fld.wide { grid-column:span 2; }
      .lbl { font-size:9px; text-transform:uppercase; color:#555; white-space:nowrap; }
      .val { flex:1; border-bottom:1px solid #000; min-height:14px; padding:0 4px 1px; font-weight:bold; }
      table { width:100%; border-collapse:collapse; }
      th, td { border:1px solid #000; padding:3px 5px; }
      th { background:#eee; font-size:9px; text-transform:uppercase; text-align:left; }
      td { height:16px; }
      .n { width:6%; text-align:center; } .c { width:16%; } .q { width:10%; text-align:center; } .u { width:12%; }
      .notes { margin-top:3mm; font-size:10px; border:1px solid #000; padding:3px 5px; }
      .sigs { display:flex; gap:6mm; margin-top:6mm; }
      .sig { flex:1; } .sig.narrow { flex:0 0 28%; }
      .line { border-bottom:1px solid #000; height:9mm; }
      .cap { font-size:8.5px; text-transform:uppercase; color:#333; margin-top:2px; text-align:center; }
      .foot { margin-top:3mm; font-size:9px; font-style:italic; color:#333; text-align:center; }
      @media print {
        @page { size:A4; margin:0; }
        .dr { page-break-inside:avoid; }
        body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      }
    </style></head><body>
      ${copy('ORIGINAL', 'Customer&rsquo;s Copy')}
      ${copy('DUPLICATE', 'Office Copy')}
    </body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  };

  return {
    printBillingStatement, printDeliveryReceipt,
  };
}
