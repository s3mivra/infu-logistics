// Shared thermal-receipt template used by BOTH the Orders order-slip print and
// the Procurement purchase-order print, so every printed slip looks the same and
// only the labels differ ("OFFICIAL ORDER SLIP" vs "PURCHASE ORDER").
//
// The letterhead, announcement, payment/support and footer all come from the
// system settings the admin edits under Settings → Welcome & Announcements,
// Support & Payment, and Order Slip Letterhead. Anything left blank falls back
// to VITE_BILLING_* env values, then to a sensible baked-in default - so a fresh
// install prints something reasonable with zero configuration.

const BIZ_NAME = (import.meta.env.VITE_BUSINESS_NAME || 'Kasa Lokal').toUpperCase();
const FB_LINK_ENV = import.meta.env.VITE_FB_LINK || '';
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

// First non-empty, trimmed value wins.
export const pick = (...vals) => {
  for (const v of vals) { const s = String(v ?? '').trim(); if (s) return s; }
  return '';
};

const esc = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export const peso = (n) => '&#x20B1;' + Number(n || 0).toFixed(2);

// Resolve the shared header/footer content from settings → env → defaults.
export function resolveLetterhead(settings = {}) {
  const s = settings || {};
  const companyName = pick(s.portalCompanyName, ENV_BILLING.name, BIZ_NAME);
  const address = pick(
    s.portalCompanyAddress,
    [ENV_BILLING.address1, ENV_BILLING.address2].filter(Boolean).join(', '),
    'Angeles City, Pampanga',
  );
  const phone = pick(s.portalCompanyPhone, ENV_BILLING.phone);
  const email = pick(s.portalCompanyEmail, ENV_BILLING.email);
  const announcement = pick(s.portalAnnouncement);
  const paymentInstructions = pick(
    s.portalPaymentInstructions,
    ENV_BILLING.bank && ENV_BILLING.accountNo
      ? `${ENV_BILLING.bank} - ${ENV_BILLING.accountName || companyName} - ${ENV_BILLING.accountNo}`
      : '',
  );
  const supportLink = pick(s.portalSupportLink, FB_LINK_ENV);
  const supportLabel = pick(s.portalSupportLabel, 'Send payment proof');
  // Registration status drives both the header stamp and the default footer
  // line. A VAT-registered seller must not print "NON-VAT REGISTERED" on an
  // official receipt, so this follows the same setting that drives the maths.
  const vatRegistered = s.vatEnabled === true;
  const slipFooter = pick(
    s.portalSlipFooter,
    vatRegistered ? 'This is a VAT Transaction.' : 'This is a Non-VAT Transaction.',
  );
  // Print logo: dedicated print logo takes priority unless "use business logo" toggle is on
  // Default: use business logo unless user explicitly set printLogoUseBusiness=false AND uploaded a print logo
  const logo = (s.printLogoEnabled && s.printLogo) ? s.printLogo : (s.businessLogo || '');
  const logoColor = s.logoColor || '';
  const logoRadius = s.logoRadius || '8px';
  return { logo, logoColor, logoRadius, companyName, address, phone, email, announcement, paymentInstructions, supportLink, supportLabel, slipFooter, vatRegistered };
}

// Build the 80mm thermal receipt HTML. Callers pass their own doc label, meta
// rows, line items and summary rows; the letterhead/footer come from settings.
//
//   docLabel   : string    e.g. 'PURCHASE ORDER' / 'OFFICIAL ORDER SLIP'
//   docNumber  : { label, value }   e.g. { label: 'PO #', value: 'PO-0001' }
//   title      : browser/print document title
//   metaRows   : [{ label, value }]
//   banner     : { text, subs: [] }        optional highlighted banner (e.g. COMPLIMENTARY)
//   lineItems  : [{ qty, name, amount, subLines: [{ name, amount }] }]
//   summaryRows: [{ label, value, cls }]   cls: '' | 'disc' | 'tot' | 'chg'
//   notes      : { title, text }           optional
//   footerLines: [string]                  optional extra centered footer lines
//   settings   : system settings object
export function buildReceiptHTML({
  docLabel = '',
  docNumber = null,
  title = 'Receipt',
  metaRows = [],
  banner = null,
  lineItems = [],
  summaryRows = [],
  notes = null,
  footerLines = [],
  duplicate = false,
  settings = {},
} = {}) {
  const lh = resolveLetterhead(settings);

  const metaHTML = [
    ...(docNumber ? [{ label: docNumber.label, value: `<strong>${esc(docNumber.value || '-')}</strong>` }] : []),
    ...metaRows.filter(r => r && pick(r.value)),
  ].map(r => `<tr><td>${esc(r.label)}</td><td>${r.value}</td></tr>`).join('');

  const itemsHTML = lineItems.map(it => {
    const subHTML = (it.subLines || []).map(s =>
      `<tr><td></td><td class="aname">+ ${esc(s.name)}</td><td class="amt">${peso(s.amount)}</td></tr>`
    ).join('');
    return `<tr>
      <td class="qty">${esc(it.qty)}</td>
      <td class="iname">${esc(it.name)}</td>
      <td class="amt">${it.amount == null ? '' : peso(it.amount)}</td>
    </tr>${subHTML}`;
  }).join('');

  const summaryHTML = summaryRows.map(r =>
    `<tr class="${r.cls || ''}"><td colspan="2">${esc(r.label)}</td><td class="amt">${r.value}</td></tr>`
  ).join('');

  const bannerHTML = banner ? `
    <div class="comp-banner">&#9733; ${esc(banner.text)} &#9733;</div>
    ${(banner.subs || []).map(x => `<div class="comp-sub">${esc(x)}</div>`).join('')}
    <div class="dash"></div>` : '';

  const announceHTML = lh.announcement
    ? `<div class="announce">${esc(lh.announcement)}</div><div class="dash"></div>` : '';

  const contactLine = [lh.phone, lh.email].filter(Boolean).map(esc).join(' &#183; ');

  const payHTML = lh.paymentInstructions
    ? `<div class="dash"></div><div class="pay"><strong>Payment</strong><br>${esc(lh.paymentInstructions)}</div>` : '';
  const supportHTML = lh.supportLink
    ? `<div class="pay">${esc(lh.supportLabel)}: ${esc(lh.supportLink)}</div>` : '';

  const notesHTML = notes && pick(notes.text)
    ? `<div class="dash"></div><div class="notes-t">${esc(notes.title || 'NOTES')}</div><div class="notes">${esc(notes.text)}</div>` : '';

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: 80mm auto; margin: 0 4mm; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 11px; color: #000; background: #fff; width: 72mm; padding-top: 3mm; }
  .center { text-align: center; }
  .logo-row { display: flex; align-items: center; justify-content: center; gap: 6px; }
  .logo-img { max-height: 36px; max-width: 36px; object-fit: contain; border-radius: ${lh.logoRadius}; }
  .logo-wrap { display: inline-flex; align-items: center; justify-content: center; border-radius: ${lh.logoRadius}; }
  .store  { font-size: 15px; font-weight: bold; letter-spacing: 1px; margin-bottom: 1px; }
  .addr   { font-size: 9px; color: #333; }
  .doclabel { font-size: 12px; font-weight: bold; letter-spacing: 1px; margin-top: 3px; }
  .dash   { border-top: 1px dashed #000; margin: 4px 0; }
  table   { width: 100%; border-collapse: collapse; }
  td      { padding: 1px 0; vertical-align: top; font-size: 11px; }
  td.qty  { width: 32px; font-weight: bold; white-space: nowrap; }
  td.iname { padding-right: 4px; font-weight: bold; word-break: break-word; }
  td.amt  { text-align: right; white-space: nowrap; font-weight: bold; }
  td.aname { padding-left: 10px; color: #555; font-weight: normal; font-size: 10px; word-break: break-word; }
  .meta td { font-weight: normal; padding: 1px 0; }
  .meta td:first-child { width: 66px; color: #555; }
  .disc td { color: #333; }
  .tot td  { font-size: 13px; font-weight: bold; padding-top: 4px; border-top: 1px solid #000; }
  .chg td  { font-weight: bold; }
  .comp-banner { text-align: center; font-weight: bold; font-size: 12px; margin: 3px 0 2px; }
  .comp-sub    { text-align: center; font-size: 9px; color: #333; }
  .announce { text-align: center; font-size: 10px; font-weight: bold; margin: 3px 0; }
  .pay { text-align: center; font-size: 9px; color: #333; margin-top: 2px; word-break: break-word; }
  .notes-t { font-size: 10px; font-weight: bold; text-align: center; }
  .notes   { font-size: 10px; text-align: center; margin: 2px 0 0; word-break: break-word; }
  .footer { text-align: center; font-size: 9px; margin-top: 8px; }
  .copy { page-break-after: always; }
  .copy:last-child { page-break-after: auto; }
  .copy-tag { text-align: center; font-size: 10px; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
  @media print {
    html, body { width: 72mm; background: #fff; }
    @page { size: 80mm auto; margin: 0 4mm; }
  }
</style>
</head>
<body>
${(duplicate ? ['', 'DUPLICATE'] : ['']).map(copyTag => `
  <div class="copy">
  ${copyTag ? `<div class="copy-tag">-- ${esc(copyTag)} --</div>` : ''}
  <div class="center">
    <div class="logo-row">
      ${lh.logo ? `<span class="logo-wrap" style="${lh.logoColor ? `background:${lh.logoColor};padding:3px;` : ''}"><img class="logo-img" src="${lh.logo}" alt="" /></span>` : ''}
      <div class="store">${esc(lh.companyName)}</div>
    </div>
    ${lh.address ? `<div class="addr">${esc(lh.address)}</div>` : ''}
    ${contactLine ? `<div class="addr">${contactLine}</div>` : ''}
    <div class="addr" style="font-weight:bold;margin-top:2px;">${lh.vatRegistered ? 'VAT REGISTERED' : 'NON-VAT REGISTERED'}</div>
    ${docLabel ? `<div class="doclabel">${esc(docLabel)}</div>` : ''}
  </div>
  <div class="dash"></div>
  ${announceHTML}
  ${bannerHTML}
  <table class="meta">${metaHTML}</table>
  <div class="dash"></div>
  <table>${itemsHTML}</table>
  ${summaryHTML ? `<div class="dash"></div><table>${summaryHTML}</table>` : ''}
  ${notesHTML}
  ${payHTML}
  ${supportHTML}
  <div class="footer">
    ${footerLines.map(l => `<div>${esc(l)}</div>`).join('')}
    ${lh.slipFooter ? `<div style="margin-top:2px;">${esc(lh.slipFooter)}</div>` : ''}
    <div style="margin-top:3px">&#8212; ${esc(lh.companyName)} &#8212;</div>
  </div>
  </div>`).join('')}
</body></html>`;
}

// Print an HTML string via a hidden auto-printing iframe (no popup dialog on
// most configs). Shared by every slip printer so the mechanism is identical.
export function printReceiptHTML(html) {
  try {
    const old = document.getElementById('__receipt_iframe__');
    if (old) old.remove();

    const iframe = document.createElement('iframe');
    iframe.id = '__receipt_iframe__';
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:80mm;height:1px;border:0;';
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();

    iframe.onload = () => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { /* fall through */ }
      setTimeout(() => { try { iframe.remove(); } catch (e) {} }, 30000);
    };
    setTimeout(() => {
      try {
        if (document.getElementById('__receipt_iframe__')) {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        }
      } catch (e) {}
    }, 400);
  } catch (fallbackErr) {
    console.error('iframe print failed:', fallbackErr);
  }
}
