// Shared A4 "official document" template used by BOTH the Orders billing
// statement/order slip AND the Procurement purchase-order print, so every
// printed document looks the same and only the labels differ
// ("BILLING STATEMENT" vs "PURCHASE ORDER").
//
// Header/letterhead, payment/deposit and inquiry contact all come from the
// system settings the admin edits under Settings → Order Slip Letterhead,
// Support & Payment, and Welcome & Announcements. Anything left blank falls back
// to VITE_BILLING_* env values, then to a sensible default.

const BIZ_NAME = (import.meta.env.VITE_BUSINESS_NAME || 'Kasa Lokal').toUpperCase();
const ENV_BILLING = {
  name: import.meta.env.VITE_BILLING_NAME || '',
  address1: import.meta.env.VITE_BILLING_ADDRESS1 || '',
  address2: import.meta.env.VITE_BILLING_ADDRESS2 || '',
  phone: import.meta.env.VITE_BILLING_PHONE || '',
  email: import.meta.env.VITE_BILLING_EMAIL || '',
  bank: import.meta.env.VITE_BILLING_BANK || '',
  accountName: import.meta.env.VITE_BILLING_ACCOUNT_NAME || '',
  accountNo: import.meta.env.VITE_BILLING_ACCOUNT_NO || '',
};

const pick = (...vals) => { for (const v of vals) { const s = String(v ?? '').trim(); if (s) return s; } return ''; };
const esc = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const money = (n) => Number(n || 0).toFixed(2);

// Resolve the shared letterhead + payment/contact strings from settings → env → default.
export function resolveBillingLetterhead(settings = {}) {
  const s = settings || {};
  const logo = s.businessLogo || '';
  const companyName = pick(s.portalCompanyName, ENV_BILLING.name, BIZ_NAME);
  // Settings hold a single address field; env holds up to two lines. Prefer the
  // admin-entered value, else stitch the env lines.
  const addressLines = pick(s.portalCompanyAddress)
    ? [s.portalCompanyAddress]
    : [ENV_BILLING.address1, ENV_BILLING.address2].filter(Boolean);
  const phone = pick(s.portalCompanyPhone, ENV_BILLING.phone);
  const email = pick(s.portalCompanyEmail, ENV_BILLING.email);
  const announcement = pick(s.portalAnnouncement);
  const supportLink = pick(s.portalSupportLink);
  const accountName = pick(ENV_BILLING.accountName, companyName);
  // Deposit / payment line: prefer the admin-entered payment instructions, else
  // build one from the env bank details.
  const paymentInstructions = pick(
    s.portalPaymentInstructions,
    ENV_BILLING.bank && ENV_BILLING.accountNo
      ? `Bank: ${ENV_BILLING.bank}  |  Account Name: ${accountName}  |  Account No.: ${ENV_BILLING.accountNo}`
      : '',
  );
  const slipFooter = pick(s.portalSlipFooter);
  return { logo, companyName, addressLines, phone, email, announcement, supportLink, accountName, paymentInstructions, slipFooter };
}

const DEFAULT_TERMS = [
  '1. Items may be returned or exchanged only under the following conditions:',
  '&nbsp;&nbsp;&nbsp;a. Item is defective upon purchase.',
  '&nbsp;&nbsp;&nbsp;b. Item has a shelf life of less than one (1) month upon purchase (near expiry).',
  '&nbsp;&nbsp;&nbsp;c. Issue is reported within 24-48 hours from receipt of item(s).',
  '2. Full payment is required and must be settled prior to delivery of item(s).',
  '3. We accept bank deposits, cheques, and other approved payment methods.',
];

// Build the A4 document HTML.
//   docTitle      : 'BILLING STATEMENT' | 'PURCHASE ORDER'
//   dateLabel     : 'Submitted date' | 'Date issued'
//   dateStr       : formatted date string
//   metaFields    : [{ label, value }]  (top 3-col grid)
//   subFields     : [{ label, value }]  (2-col grid)
//   schedRows     : [{ label, value }]  optional gray box
//   items         : [{ code, desc, qty, unitPrice, total }]
//   totals        : [{ label, value, grand }]
//   termsTitle    : heading above the terms list (default 'Terms and Conditions')
//   terms         : [string]  (defaults to DEFAULT_TERMS)
//   signatures    : [string]  signature-line labels (default prepared/checked/received)
//   depositTitle  : heading for the deposit box (default 'Please deposit all payments to:')
//   settings      : system settings object
export function buildBillingDocHTML({
  docTitle = 'DOCUMENT',
  dateLabel = 'Date',
  dateStr = '',
  metaFields = [],
  subFields = [],
  schedRows = [],
  items = [],
  totals = [],
  termsTitle = 'Terms and Conditions',
  terms = null,
  signatures = ['PREPARED BY: Signature over Printed Name / Date', 'CHECKED BY: Signature over Printed Name / Date', 'RECEIVED BY: Signature over Printed Name / Date'],
  depositTitle = 'Please deposit all payments to:',
  copies = ['ORIGINAL', 'DUPLICATE'],
  settings = {},
} = {}) {
  const lh = resolveBillingLetterhead(settings);
  const termsList = terms || DEFAULT_TERMS;

  // Print/paper size is admin-configurable (Settings → Order Slip Letterhead).
  // Only whitelisted CSS @page sizes are honoured; anything else falls back to A4.
  const PAGE_SIZES = { A4: 'A4', LETTER: 'Letter', LEGAL: 'Legal', A5: 'A5' };
  const pageSize = PAGE_SIZES[String(pick(settings.portalPrintSize) || 'A4').toUpperCase()] || 'A4';

  const metaHTML = metaFields.map(f =>
    `<div class="section"><label>${esc(f.label)}</label><div class="val">${f.value ? esc(f.value) : '&nbsp;'}</div></div>`
  ).join('');
  const subHTML = subFields.map(f =>
    `<div class="section"><label>${esc(f.label)}</label><div class="val">${f.value ? esc(f.value) : '&nbsp;'}</div></div>`
  ).join('');

  const schedHTML = schedRows.length ? `
  <div class="sched-box"><table>
    ${schedRows.map(r => `<tr><td class="lbl">${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join('')}
  </table></div>` : '';

  const itemsHTML = items.map(it => `<tr>
    <td class="code">${esc(it.code || '')}</td>
    <td class="desc">${esc(it.desc || '')}</td>
    <td class="qty">${esc(it.qty)}</td>
    <td class="price">${money(it.unitPrice)}</td>
    <td class="total">${money(it.total)}</td>
  </tr>`).join('');

  const totalsHTML = totals.map(t =>
    `<div class="totals-row${t.grand ? ' grand' : ''}"><div class="tl">${esc(t.label)}</div><div class="tr">${money(t.value)}</div></div>`
  ).join('');

  const contactLine = lh.email
    ? `<p>For inquiries, contact us at ${esc(lh.phone)}${lh.email ? ` / ${esc(lh.email)}` : ''}${lh.supportLink ? ` / ${esc(lh.supportLink)}` : ''}.</p>`
    : '';

  const depositHTML = lh.paymentInstructions ? `
    <div class="bank-info">
      <strong>${esc(depositTitle)}</strong><br>
      ${esc(lh.paymentInstructions)}<br>
      Or pay directly at our office at ${esc(lh.companyName)}.
    </div>` : '';

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${esc(docTitle)} - ${esc(metaFields.find(f => /transaction|po|order/i.test(f.label))?.value || dateStr)}</title>
<style>
  @page { size: ${pageSize} portrait; margin: 15mm 16mm 20mm; }
  @page :first { margin-top: 15mm; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; }
  .header { text-align: center; margin-bottom: 10px; }
  .header .biz-row { display: flex; align-items: center; justify-content: center; gap: 10px; }
  .header .biz-logo { max-height: 44px; max-width: 72px; object-fit: contain; }
  .header .biz  { font-size: 14pt; font-weight: bold; letter-spacing: 1px; }
  .header .addr { font-size: 8.5pt; margin-top: 1px; color: #333; }
  .title-wrap   { text-align: center; margin-bottom: 6px; }
  .title        { display: inline-block; font-size: 13pt; font-weight: bold; border: 2px solid #000; padding: 3px 18px; }
  .docnum-wrap  { text-align: center; margin-bottom: 8px; font-size: 9pt; }
  .announce     { text-align: center; font-size: 8.5pt; font-weight: bold; margin: 0 0 10px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 10px; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; padding: 6px 0; margin-bottom: 8px; }
  .sub-grid  { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; margin-bottom: 8px; }
  .section label { font-size: 7.5pt; text-transform: uppercase; font-weight: bold; color: #555; display: block; margin-bottom: 2px; }
  .section .val  { font-size: 10pt; font-weight: bold; border-bottom: 1px solid #aaa; min-height: 16px; padding-bottom: 2px; }
  .sched-box { background: #f6f6f6; border: 1px solid #ccc; padding: 5px 8px; font-size: 9pt; margin-bottom: 8px; break-inside: avoid; page-break-inside: avoid; }
  .sched-box table { width: 100%; }
  .sched-box td.lbl { font-weight: bold; width: 160px; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  table.items thead { display: table-header-group; }
  table.items thead th { background: #000; color: #fff; font-size: 8.5pt; padding: 4px 5px; text-align: left; border-bottom: 2px solid #000; }
  table.items thead th.r { text-align: right; }
  table.items tbody tr { break-inside: avoid; page-break-inside: avoid; }
  table.items td { padding: 3.5px 5px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; vertical-align: top; }
  table.items td.code  { width: 68px; font-family: monospace; font-size: 8pt; color: #444; }
  table.items td.qty   { width: 46px; text-align: center; font-weight: bold; }
  table.items td.price, table.items td.total { width: 82px; text-align: right; font-family: monospace; }
  .totals-wrap { break-inside: avoid; page-break-inside: avoid; }
  .totals-row  { display: flex; justify-content: flex-end; margin-bottom: 1px; }
  .totals-row .tl { width: 150px; font-size: 9.5pt; padding: 1px 4px; }
  .totals-row .tr { width: 90px; text-align: right; font-family: monospace; font-size: 9.5pt; padding: 1px 0; }
  .totals-row.grand .tl, .totals-row.grand .tr { font-size: 11pt; font-weight: bold; border-top: 2px solid #000; padding-top: 4px; margin-top: 2px; }
  .footer-block { break-inside: avoid; page-break-inside: avoid; margin-top: 12px; }
  .tcs { font-size: 8pt; border-top: 1px solid #ccc; padding-top: 7px; }
  .tcs h4 { font-size: 8.5pt; font-weight: bold; margin-bottom: 4px; }
  .tcs p  { margin-bottom: 2px; line-height: 1.45; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 14px; margin-top: 14px; }
  .sig-block { text-align: center; }
  .sig-block .line  { border-bottom: 1px solid #000; height: 34px; margin-bottom: 3px; }
  .sig-block .label { font-size: 7.5pt; color: #333; }
  .bank-info { margin-top: 10px; border: 1px solid #ccc; padding: 5px 8px; font-size: 8.5pt; line-height: 1.5; }
  .bank-info strong { font-size: 9pt; }
  /* Each copy (ORIGINAL / DUPLICATE) is its own block that starts on a fresh
     page. A multi-page copy stays intact - the whole original prints, then the
     whole duplicate - so page order is 1..N (orig) then 1..N (dupe). */
  .copy { page-break-after: always; }
  .copy:last-child { page-break-after: auto; }
  .copy-tag { text-align: right; font-size: 8pt; font-weight: bold; letter-spacing: 1px; color: #444; border: 1px solid #999; display: inline-block; padding: 1px 6px; float: right; }
  @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
${copies.map(copyLabel => `
  <div class="copy">
  ${copyLabel ? `<div class="copy-tag">${esc(copyLabel)}</div>` : ''}
  <div class="header">
    <div class="biz-row">
      ${lh.logo ? `<img class="biz-logo" src="${lh.logo}" alt="" />` : ''}
      <div class="biz">${esc(lh.companyName)}</div>
    </div>
    ${lh.addressLines.map(a => `<div class="addr">${esc(a)}</div>`).join('')}
    ${lh.phone ? `<div class="addr">${esc(lh.phone)}</div>` : ''}
  </div>

  <div class="title-wrap"><div class="title">${esc(docTitle)}</div></div>
  ${lh.announcement ? `<div class="announce">${esc(lh.announcement)}</div>` : ''}

  <p style="font-size:9pt;margin-bottom:8px;text-align:center;">${esc(dateLabel)}: <strong>${esc(dateStr)}</strong></p>

  <div class="meta-grid">${metaHTML}</div>
  ${subHTML ? `<div class="sub-grid">${subHTML}</div>` : ''}
  ${schedHTML}

  <table class="items">
    <thead><tr>
      <th>Code</th><th>Description</th>
      <th class="r" style="text-align:center">Qty</th>
      <th class="r">Unit Price</th><th class="r">Total Price</th>
    </tr></thead>
    <tbody>${itemsHTML}</tbody>
  </table>

  <div class="totals-wrap">${totalsHTML}</div>

  <div class="footer-block">
    <div class="tcs">
      <h4>${esc(termsTitle)}</h4>
      ${termsList.map(t => `<p>${t}</p>`).join('')}
      ${terms ? '' : `<p>4. All bank and cheque payments must be made payable to ${esc(lh.accountName)}.</p>`}
      ${contactLine}
      ${lh.slipFooter ? `<p style="margin-top:4px;font-style:italic;">${esc(lh.slipFooter)}</p>` : ''}
    </div>

    <div class="sigs">
      ${signatures.map(l => `<div class="sig-block"><div class="line"></div><div class="label">${esc(l)}</div></div>`).join('')}
    </div>

    ${depositHTML}
  </div>
  </div>`).join('')}
</body></html>`;
}

// Open the document in a new window and trigger print (matches the existing
// billing-statement behaviour).
export function printBillingDoc(html) {
  const win = window.open('', '_blank', 'width=794,height=1123');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.onload = () => {
    win.focus();
    // Close the print window once the dialog is dismissed (printed or cancelled)
    // so it doesn't linger. onafterprint covers Chrome/Edge; the timeout is a
    // fallback for browsers that never fire it.
    win.onafterprint = () => { try { win.close(); } catch (e) {} };
    win.print();
  };
}
