'use strict';
const PDFDocument = require('./node_modules/pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..');

// ── COLOURS ──────────────────────────────────────────────────────────────────
const GREEN       = '#4A7C2F';
const GREEN_LIGHT = '#EAF2E3';
const GREEN_DARK  = '#2E4D1C';
const TEXT        = '#1A1A1A';
const TEXT_MUTED  = '#666666';
const WHITE       = '#FFFFFF';
const LINE        = '#CCCCCC';
const RED         = '#C0392B';
const ORANGE      = '#D35400';
const BLUE        = '#1A5276';
const GREY_BG     = '#F7F7F7';

// ── PAGE DIMENSIONS ──────────────────────────────────────────────────────────
const ML  = 60;    // left margin
const MR  = 60;    // right margin
const PW  = 595;   // A4 width
const PH  = 842;   // A4 height
const CW  = PW - ML - MR;   // content width = 475

function mkDoc() {
  return new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 70, left: ML, right: MR },
  });
}

// ── PRIMITIVES ────────────────────────────────────────────────────────────────

function rule(doc, color) {
  color = color || LINE;
  doc.moveTo(ML, doc.y).lineTo(PW - MR, doc.y)
     .strokeColor(color).lineWidth(0.75).stroke();
  doc.y += 1;
}

function gap(doc, n) { doc.y += (n || 8); }

function safeY(doc, needed) {
  if ((PH - doc.page.margins.bottom - doc.y) < needed) {
    doc.addPage();
  }
}

function footer(doc, label) {
  const fy = PH - 48;
  doc.moveTo(ML, fy).lineTo(PW - MR, fy).strokeColor(LINE).lineWidth(0.5).stroke();
  doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED)
     .text('Semivra Negotium & Libellus  |  ' + label, ML, fy + 7,
           { width: CW / 2, lineBreak: false });
  doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED)
     .text('May 2026', ML + CW / 2, fy + 7,
           { width: CW / 2, align: 'right', lineBreak: false });
}

// h1 – large page title
function h1(doc, text) {
  doc.fontSize(20).font('Helvetica-Bold').fillColor(GREEN_DARK)
     .text(text, ML, doc.y, { width: CW });
  doc.y += 4;
}

// h2 – section heading
function h2(doc, text) {
  doc.fontSize(14).font('Helvetica-Bold').fillColor(GREEN)
     .text(text, ML, doc.y, { width: CW });
  doc.y += 4;
}

// h3 – sub-heading
function h3(doc, text) {
  doc.fontSize(11).font('Helvetica-Bold').fillColor(TEXT)
     .text(text, ML, doc.y, { width: CW });
  doc.y += 3;
}

// body paragraph
function body(doc, text) {
  doc.fontSize(10.5).font('Helvetica').fillColor(TEXT)
     .text(text, ML, doc.y, { width: CW, align: 'left', lineBreak: true });
  doc.y += 5;
}

// muted paragraph (slightly smaller, grey)
function muted(doc, text) {
  doc.fontSize(10).font('Helvetica').fillColor(TEXT_MUTED)
     .text(text, ML, doc.y, { width: CW, lineBreak: true });
  doc.y += 4;
}

// green callout box
function callout(doc, text, bgColor, barColor) {
  bgColor  = bgColor  || GREEN_LIGHT;
  barColor = barColor || GREEN;
  const PAD = 12;
  doc.fontSize(10.5).font('Helvetica');
  const h = doc.heightOfString(text, { width: CW - PAD * 2 - 6 }) + PAD * 2;
  const startY = doc.y;
  doc.rect(ML, startY, CW, h).fill(bgColor);
  doc.rect(ML, startY, 4, h).fill(barColor);
  doc.fillColor(TEXT).font('Helvetica')
     .text(text, ML + PAD + 4, startY + PAD, { width: CW - PAD * 2 - 6 });
  doc.y = startY + h + 10;
}

// green bullet
function bullet(doc, text, indent, dotColor) {
  indent   = indent   || 14;
  dotColor = dotColor || GREEN;
  safeY(doc, 20);
  const bx = ML + indent - 8;
  doc.circle(bx, doc.y + 5.5, 2.5).fill(dotColor);
  doc.fontSize(10.5).font('Helvetica').fillColor(TEXT)
     .text(text, ML + indent, doc.y, { width: CW - indent, lineBreak: true });
  doc.y += 3;
}

// check (green ✓) or cross (red ✗) bullet
function checkBullet(doc, text, isCheck) {
  const mark = isCheck ? '✓' : '✗';
  const col  = isCheck ? GREEN : RED;
  safeY(doc, 20);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(col)
     .text(mark, ML, doc.y, { width: 18, lineBreak: false });
  doc.fontSize(10.5).font('Helvetica').fillColor(TEXT)
     .text(text, ML + 22, doc.y, { width: CW - 22, lineBreak: true });
  doc.y += 3;
}

// labelled key-value row (no background)
function kvRow(doc, label, value, labelW) {
  labelW = labelW || 170;
  const rowY = doc.y;
  doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_MUTED)
     .text(label, ML, rowY, { width: labelW - 4, lineBreak: false });
  doc.fontSize(10.5).font('Helvetica').fillColor(TEXT)
     .text(value, ML + labelW, rowY, { width: CW - labelW });
  doc.y += 4;
}

// section title bar with green left accent
function sectionBar(doc, text) {
  safeY(doc, 40);
  const barY = doc.y;
  doc.rect(ML, barY, CW, 24).fill(GREEN_LIGHT);
  doc.rect(ML, barY, 4, 24).fill(GREEN);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(GREEN_DARK)
     .text(text, ML + 12, barY + 6, { lineBreak: false });
  doc.y = barY + 32;
}

// ── VERSION BLOCK ──────────────────────────────────────────────────────────────
function versionBlock(doc, ver, dateStr, status, statusColor, intro, features) {
  safeY(doc, 80);

  // version pill
  const pillY = doc.y;
  doc.roundedRect(ML, pillY, 68, 22, 4).fill(GREEN_DARK);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(WHITE)
     .text(ver, ML + 8, pillY + 5, { lineBreak: false });

  // status badge
  const badgeX = ML + 76;
  doc.fontSize(9).font('Helvetica-Bold');
  const bw = doc.widthOfString(status) + 18;
  doc.roundedRect(badgeX, pillY + 2, bw, 18, 3).fill(statusColor);
  doc.fillColor(WHITE).text(status, badgeX + 9, pillY + 6, { lineBreak: false });

  // date
  doc.fontSize(10).font('Helvetica').fillColor(TEXT_MUTED)
     .text(dateStr, badgeX + bw + 10, pillY + 6, { lineBreak: false });

  doc.y = pillY + 30;

  if (intro) { muted(doc, intro); }

  features.forEach(function(f) {
    safeY(doc, 22);
    bullet(doc, f);
  });

  doc.y += 4;
  rule(doc);
  doc.y += 12;
}

// ── ISSUE CARD ────────────────────────────────────────────────────────────────
function issueCard(doc, id, priority, title, whatText, impactText, fixText, color) {
  const PAD = 14;

  // Measure text heights
  doc.fontSize(10.5).font('Helvetica');
  const whatH   = doc.heightOfString(whatText,   { width: CW - PAD * 2 });
  const impH    = doc.heightOfString(impactText,  { width: CW - PAD * 2 });
  const fixH    = doc.heightOfString(fixText,     { width: CW - PAD * 2 });
  const labelH  = 14 * 3; // three label lines
  const cardH   = 30 + whatH + impH + fixH + labelH + PAD * 5 + 8;

  safeY(doc, Math.min(cardH + 20, 200));
  const cy = doc.y;

  // outer border
  doc.rect(ML, cy, CW, cardH).strokeColor(LINE).lineWidth(0.75).stroke();
  // left colour bar
  doc.rect(ML, cy, 5, cardH).fill(color);
  // header band
  doc.rect(ML + 5, cy, CW - 5, 30).fill(GREY_BG);

  // ID tag
  doc.fontSize(9).font('Helvetica-Bold').fillColor(color)
     .text(id, ML + 14, cy + 9, { lineBreak: false });

  // priority pill
  doc.fontSize(9).font('Helvetica-Bold');
  const pw2 = doc.widthOfString(priority) + 14;
  doc.roundedRect(ML + 50, cy + 7, pw2, 17, 3).fill(color);
  doc.fillColor(WHITE).text(priority, ML + 57, cy + 11, { lineBreak: false });

  // title
  doc.fontSize(11).font('Helvetica-Bold').fillColor(TEXT)
     .text(title, ML + 56 + pw2, cy + 8, { width: CW - 62 - pw2, lineBreak: false });

  let iy = cy + 38;

  // What is it?
  doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_MUTED)
     .text('What is it?', ML + PAD, iy);
  iy = doc.y + 2;
  doc.fontSize(10.5).font('Helvetica').fillColor(TEXT)
     .text(whatText, ML + PAD, iy, { width: CW - PAD * 2 });
  iy = doc.y + 8;

  // Impact
  doc.fontSize(10).font('Helvetica-Bold').fillColor(RED)
     .text('Impact on you:', ML + PAD, iy);
  iy = doc.y + 2;
  doc.fontSize(10.5).font('Helvetica').fillColor(TEXT)
     .text(impactText, ML + PAD, iy, { width: CW - PAD * 2 });
  iy = doc.y + 8;

  // Fix
  doc.fontSize(10).font('Helvetica-Bold').fillColor(BLUE)
     .text('How to fix it:', ML + PAD, iy);
  iy = doc.y + 2;
  doc.fontSize(10.5).font('Helvetica').fillColor(TEXT)
     .text(fixText, ML + PAD, iy, { width: CW - PAD * 2 });

  doc.y = cy + cardH + 16;
}

// ════════════════════════════════════════════════════════════════════════════
//  REPORT 1 — Overview & Capability (Client-Facing)
// ════════════════════════════════════════════════════════════════════════════
function buildReport1() {
  const doc = mkDoc();
  doc.pipe(fs.createWriteStream(path.join(OUT, 'Semivra_Libellus_Overview_Report.pdf')));

  // ── COVER PAGE ────────────────────────────────────────────────────────────
  doc.rect(0, 0, PW, PH).fill(GREEN_DARK);
  doc.rect(0, PH - 90, PW, 90).fill(GREEN);

  doc.fontSize(52).font('Helvetica-Bold').fillColor(WHITE)
     .text('semivra', ML, 110, { lineBreak: false });
  doc.fontSize(18).font('Helvetica').fillColor('#A8D58A')
     .text('  negotium & libellus', ML, 170);
  doc.fontSize(11).font('Helvetica').fillColor('#A8D58A')
     .text('Point-of-Sale & Business Management System', ML, 200);

  doc.moveTo(ML, 230).lineTo(PW - MR, 230).strokeColor('#A8D58A').lineWidth(1).stroke();

  doc.fontSize(24).font('Helvetica-Bold').fillColor(WHITE)
     .text('Full System Overview &\nCapability Report', ML, 244, { width: CW });

  doc.fontSize(11).font('Helvetica').fillColor('#CCDDBB')
     .text('A plain-language guide for business owners and decision makers', ML, 310, { width: CW });

  // info table
  var infoTop = 360;
  [
    ['Prepared for',  'Client Review & Onboarding'],
    ['Version',       'Semivra Libellus POS  v1.1'],
    ['Date',          'May 30, 2026'],
    ['Tax Compliance','Non-VAT Registered (BIR Philippines)'],
  ].forEach(function(row, i) {
    var ry = infoTop + i * 40;
    doc.fontSize(9).font('Helvetica').fillColor('#A8D58A').text(row[0], ML, ry);
    doc.fontSize(13).font('Helvetica-Bold').fillColor(WHITE).text(row[1], ML, ry + 13);
    doc.moveTo(ML, ry + 34).lineTo(PW - MR, ry + 34).strokeColor('#3A6020').lineWidth(0.5).stroke();
  });

  doc.fontSize(9).font('Helvetica').fillColor(WHITE)
     .text('CONFIDENTIAL — FOR CLIENT REVIEW ONLY', 0, PH - 70, { align: 'center', width: PW });
  doc.fontSize(9).font('Helvetica').fillColor(WHITE)
     .text('s3mivra@gmail.com', 0, PH - 54, { align: 'center', width: PW });

  // ── SECTION 1: WHAT IS IT? ────────────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Section 1 — What is it?');
  doc.y = 50;

  h1(doc, 'Section 1');
  h2(doc, 'What is Semivra Negotium & Libellus?');
  rule(doc);
  gap(doc, 12);

  body(doc, 'Semivra Negotium & Libellus is a complete Point-of-Sale (POS) and business management system designed for small to medium food and beverage businesses in the Philippines — cafés, milk tea shops, cloud kitchens, and similar operations.');
  gap(doc, 4);
  body(doc, 'It replaces the combination of a cash register, a manual stock notebook, a separate accounting spreadsheet, and a paper order pad — with one system that runs on any device with a web browser.');
  gap(doc, 10);

  callout(doc, 'In simple terms: it is the digital brain of your café operations. From the moment a customer orders to the moment your accountant needs a report — it is all in one place, automatically recorded.');

  gap(doc, 8);
  h3(doc, 'What does the name mean?');
  body(doc, '"Negotium" is Latin for business or trade. It refers to the operational side — the POS register, order management, delivery tracking, and kitchen workflow.');
  body(doc, '"Libellus" is Latin for a small book or ledger. It refers to the accounting side — the journal, profit & loss reports, inventory logs, and balance sheet.');
  body(doc, 'Together they form two sides of one coin: the front of the house (negotium) and the back office (libellus), unified in a single system.');

  gap(doc, 10);
  h3(doc, 'What device does it run on?');
  body(doc, 'It runs on any device with a modern web browser — a tablet (Android or iPad), a laptop, or a desktop computer. No special POS hardware is required. A ₱5,000 Android tablet and a Wi-Fi connection is enough to get started.');

  gap(doc, 8);
  h3(doc, 'Does it need internet?');
  body(doc, 'The system requires an internet connection or a local network (LAN). The recommended setup is to run the server on a small cloud service (about ₱200–₱800/month) so staff can connect from any device in the store. An offline mode is not yet available — see the Issues Report for details.');

  // ── SECTION 2: WHO IS IT FOR? ─────────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Section 2 — Who is it for?');
  doc.y = 50;

  h1(doc, 'Section 2');
  h2(doc, 'Who is this system built for?');
  rule(doc);
  gap(doc, 12);

  body(doc, 'Semivra Libellus was designed specifically for the Philippine F&B (food and beverage) small business context — but it applies to any similar business that needs a reliable, affordable, all-in-one POS.');
  gap(doc, 12);

  sectionBar(doc, 'Best fit — these businesses will get the most value');

  [
    'Cafés and coffee shops',
    'Milk tea and boba shops',
    'Small restaurants and carinderia-style operations',
    'Cloud kitchens (delivery-only, no dine-in)',
    'Kiosks and food stalls with a counter',
    'Any food business with 1 to 5 cashier stations',
    'Businesses registered as Non-VAT with the BIR',
    'Operators who want real accounting records without hiring a bookkeeper for daily entries',
  ].forEach(function(t) { bullet(doc, t); });

  gap(doc, 16);
  sectionBar(doc, 'Less ideal for — consider alternatives');

  [
    'Large restaurant chains with 50 or more tables (multi-branch sync not yet available)',
    'VAT-registered corporations requiring automatic VAT invoice generation',
    'Grocery or retail stores (product catalog is oriented toward F&B)',
    'Businesses that need to work completely offline with zero internet connection',
    'Businesses that need a native app on the App Store or Google Play',
  ].forEach(function(t) { checkBullet(doc, t, false); });

  // ── SECTION 3: WHY THIS SYSTEM? ───────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Section 3 — Why this system?');
  doc.y = 50;

  h1(doc, 'Section 3');
  h2(doc, 'Why choose Semivra over other POS systems?');
  rule(doc);
  gap(doc, 12);

  body(doc, 'Philippine small business owners typically face a difficult choice: expensive imported POS platforms that charge in US dollars, or basic local systems that lack proper accounting. Here is how Semivra compares:');
  gap(doc, 12);

  // Comparison table
  var rows = [
    ['Feature',                                 'Semivra',          'Typical Local POS',   'Square / Toast (US)'],
    ['Monthly software fee',                    'One-time setup',   '₱500–₱2,000 / month', '$60–$165 USD / month'],
    ['Hardware required',                       'None — browser',   'Dedicated terminal',   'iPad + card reader'],
    ['Real accounting (double-entry ledger)',    'Yes ✓',            'No ✗',                'Basic only'],
    ['Non-VAT BIR compliance',                  'Yes ✓',            'Partial',              'No (VAT-focused)'],
    ['Inventory with expiry date tracking',     'Yes ✓',            'No ✗',                'Paid add-on'],
    ['QR code customer self-ordering',          'Yes ✓',            'Rare',                 'Paid add-on'],
    ['Delivery tracking (Grab / Foodpanda)',    'Yes ✓',            'No ✗',                'No ✗'],
    ['Custom branding for white-label clients', 'Yes ✓',            'No ✗',                'No ✗'],
    ['Server location',                         'PH cloud or LAN',  'Windows PC on-site',   'US-based servers'],
  ];

  var cW = [195, 92, 112, 112];
  rows.forEach(function(row, ri) {
    var rowH = ri === 0 ? 22 : 20;
    var bg   = ri === 0 ? GREEN_DARK : (ri % 2 === 0 ? WHITE : GREY_BG);
    var defaultFg = ri === 0 ? WHITE : TEXT;
    var rowY = doc.y;
    doc.rect(ML, rowY, CW, rowH).fill(bg);

    var cx = ML;
    row.forEach(function(cell, ci) {
      var fg = defaultFg;
      if (ri > 0 && ci === 1) {
        if (cell.indexOf('✓') >= 0) fg = GREEN;
        else if (cell.indexOf('✗') >= 0) fg = RED;
      }
      var fw = (ri === 0 || ci === 0) ? 'Helvetica-Bold' : 'Helvetica';
      doc.fontSize(ri === 0 ? 9 : 9.5).font(fw).fillColor(fg)
         .text(cell, cx + 5, rowY + (rowH - 11) / 2, { width: cW[ci] - 8, lineBreak: false });
      cx += cW[ci];
    });

    doc.y = rowY + rowH;
    if (ri > 0 && ri < rows.length - 1) {
      doc.moveTo(ML, doc.y).lineTo(PW - MR, doc.y).strokeColor(LINE).lineWidth(0.3).stroke();
    }
  });

  gap(doc, 14);
  callout(doc, 'Bottom line: Semivra is the only Philippine-focused POS that includes real double-entry accounting, Non-VAT compliance, expiry-tracked inventory, and QR self-ordering — all in one system, with no recurring subscription fee.');

  // ── SECTION 4: CAPABILITIES ───────────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Section 4 — Capabilities');
  doc.y = 50;

  h1(doc, 'Section 4');
  h2(doc, 'What can it do? — Full Capability Guide');
  rule(doc);
  gap(doc, 10);

  body(doc, 'Below is a complete list of everything the system can do as of version 1.1. Each capability is explained in plain language. No technical knowledge is needed to read this section.');
  gap(doc, 10);

  var caps = [
    {
      title: '1.  Point-of-Sale (POS) Register',
      paras: [
        'The cashier screen where orders are built and payments are processed. The cashier searches or browses products, adds items to the order, applies discounts, selects the payment method, and issues a receipt.',
        'Payment methods accepted: Cash, GCash, Maya, Maribank, Bank Transfer, and other e-wallets.',
        'Discount types: flat peso amount (e.g. ₱50 off) or percentage (e.g. 10% off). Complimentary or free orders are also supported for staff meals.',
        'A live change calculator shows the cashier exactly how much change to give for cash payments.',
      ],
    },
    {
      title: '2.  Customer QR Dine-In Ordering',
      paras: [
        'Each table has a unique QR code. A customer scans it with their phone, sees the full menu with photos and add-on options, builds their order, and submits it — no app download needed.',
        'The order goes directly to the kitchen queue on the cashier screen. This reduces wait time, eliminates miscommunication between waiter and kitchen, and frees up staff for other tasks.',
        'The QR session expires after the order is submitted, so the link cannot be reused by another customer.',
      ],
    },
    {
      title: '3.  Fulfillment Modes (6 types)',
      paras: [
        'Every order is tagged with how it will be served. The system supports: Dine-In, Takeout, Pickup (customer collects later), Manual Delivery (your own rider), Grab Delivery, and Foodpanda.',
        'For delivery orders, the system collects the delivery address, customer phone number, delivery fee, and scheduled delivery time.',
      ],
    },
    {
      title: '4.  Delivery Dispatch Tracking',
      paras: [
        'Delivery orders have a visual pipeline showing their current stage: Preparing → Out for Delivery → Delivered. Pickup orders use: Preparing → Awaiting Pickup → Picked Up.',
        'Staff can advance the status with one tap. This gives you a real-time view of which deliveries are in progress at any moment.',
      ],
    },
    {
      title: '5.  Inventory & Stock Management',
      paras: [
        'Every ingredient is tracked by quantity — in kilograms (kg), litres (L), or pieces (pcs). When an order is completed, the system automatically deducts the ingredients used based on the recipes you define.',
        'You never have to manually update stock counts after a sale — it happens automatically and instantly.',
        'You can set a low-stock alert level for each ingredient. When stock falls at or below that level, a warning badge appears on the sidebar so staff are reminded to reorder.',
      ],
    },
    {
      title: '6.  Expiry Date Tracking & FEFO',
      paras: [
        'Each ingredient can have an expiry date. The system tracks multiple batches of the same ingredient separately — for example, one carton of milk received on Monday and another received on Friday.',
        'When stock is consumed, the system always uses the oldest batch first. This is called FEFO — First-Expiry, First-Out. It reduces waste and ensures fresher stock is not used before older stock.',
        'Colour-coded badges on each ingredient show its status: expired (red flashing), expiring today, expiring soon (yellow), expiring within 30 days (orange), or safe (grey).',
      ],
    },
    {
      title: '7.  Spoilage & Waste Logging',
      paras: [
        'When ingredients are thrown away — due to spoilage, damage, or over-production — the operator logs a waste entry with the quantity, reason, and notes.',
        'The system records this in the accounting ledger automatically, so your profit & loss report accurately reflects the real cost of spoilage.',
      ],
    },
    {
      title: '8.  Excel / CSV Stock-Take Import',
      paras: [
        'Instead of entering every ingredient one by one, you can prepare a spreadsheet (Excel or CSV) with your full stock count and import it in bulk.',
        'The system shows a preview of all changes before you confirm: new items are highlighted green, increases are shown as arrows up, decreases as arrows down.',
        'A template file is available to download so you always know the correct format to use.',
      ],
    },
    {
      title: '9.  Shift & Cash Management',
      paras: [
        'At the start of each shift, the cashier enters the starting cash amount in the register (the float). At the end of the shift, they count the actual cash and enter it into the system.',
        'The system calculates the expected amount based on all cash sales during the shift and shows the variance — the difference between expected and actual cash.',
        'All shift history is visible to the manager: who worked each shift, their starting cash, ending cash, and any variance that was recorded.',
      ],
    },
    {
      title: '10.  Real Accounting — Double-Entry Ledger',
      paras: [
        'Every transaction in the system creates a proper accounting journal entry — automatically. This includes sales, refunds, free orders, spoilage, inventory purchases, and expenses.',
        'Double-entry accounting means every peso has a corresponding opposite entry that keeps the books balanced. For example, when a cash sale is made: Revenue increases, and Cash on Hand also increases.',
        'This is the same standard used by professional accountants. You do not need a separate bookkeeping app or manual spreadsheet for daily entries.',
      ],
    },
    {
      title: '11.  Accounts Receivable (E-Wallet & Delivery Payments)',
      paras: [
        'When a customer pays by GCash, Maya, bank transfer, or through a delivery platform, the money is not physically in the register yet — it needs to be verified and transferred to your account.',
        'The system records these as Accounts Receivable (money owed to you) until your manager confirms the transfer was received and marks it as settled.',
        'This prevents confusion between "sales recorded" and "cash actually in hand."',
      ],
    },
    {
      title: '12.  Profit & Loss (P&L) Statement',
      paras: [
        'The system generates a Profit & Loss report for any date range you choose. It shows: Total Revenue, Cost of Goods Sold, Gross Profit, Operating Expenses, and Net Income.',
        'This is the report your accountant or BIR auditor will ask for. It is generated automatically from your daily transactions — no manual preparation needed.',
      ],
    },
    {
      title: '13.  Balance Sheet',
      paras: [
        'A snapshot of your business financial position at any point in time: Assets (cash, inventory), Liabilities (money you owe), and Equity (your net value in the business).',
        'The system verifies that the accounting equation balances and shows a check indicator.',
      ],
    },
    {
      title: '14.  Expense Tracking',
      paras: [
        'Record any business expense — rent, utilities, supplies — with the amount, category, description, and which cash account it was paid from.',
        'Expenses are posted to the accounting ledger automatically so they always appear in your P&L report.',
      ],
    },
    {
      title: '15.  Real-Time Analytics Dashboard',
      paras: [
        'A summary screen showing today\'s performance: total gross sales, number of orders, average order value, top-selling products, and an hourly sales chart.',
        'Updated in real time as orders are processed — no manual refresh needed.',
      ],
    },
    {
      title: '16.  User & Role Management',
      paras: [
        'Two types of accounts: Staff (cashiers and kitchen crew) and Super Admin (managers and owners).',
        'Staff can use the POS, process orders, and manage deliveries but cannot see financial reports, accounting ledgers, or change system settings.',
        'Super Admin has full access to everything. This ensures sensitive business data is only visible to authorised personnel.',
      ],
    },
    {
      title: '17.  Receipts — Non-VAT Compliant',
      paras: [
        'Every completed order generates a receipt showing the itemised breakdown, payment method, cashier name, date, and a "NON-VAT REGISTERED" footer — required by the BIR for non-VAT businesses.',
        'Receipts appear on screen and can be printed using the browser\'s print function.',
      ],
    },
    {
      title: '18.  End-of-Day History & X-Reading',
      paras: [
        'At midnight every day, all completed orders are automatically archived. You can browse any past day\'s orders and filter by cashier or payment method.',
        'X-Reading: A mid-shift report that shows sales up to that moment without closing the register — useful for spot-checking totals during a busy day.',
      ],
    },
  ];

  caps.forEach(function(cap) {
    safeY(doc, 80);
    // Check if we are near the bottom and need a new page
    var remaining = PH - doc.page.margins.bottom - doc.y;
    if (remaining < 80) {
      doc.addPage();
      footer(doc, 'Section 4 — Capabilities (continued)');
      doc.y = 50;
    }
    h3(doc, cap.title);
    cap.paras.forEach(function(p) {
      var rem2 = PH - doc.page.margins.bottom - doc.y;
      if (rem2 < 40) {
        doc.addPage();
        footer(doc, 'Section 4 — Capabilities (continued)');
        doc.y = 50;
      }
      body(doc, p);
    });
    gap(doc, 8);
  });

  // ── SECTION 5: VERSION HISTORY ────────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Section 5 — Version History');
  doc.y = 50;

  h1(doc, 'Section 5');
  h2(doc, 'Version History — How the System Has Grown');
  rule(doc);
  gap(doc, 10);

  body(doc, 'Semivra Libellus has been developed in stages. Each version added new capabilities on top of everything before it. This history shows what was built and when — so you can see how the system has matured.');
  gap(doc, 14);

  versionBlock(doc, 'v0.2', 'Early 2026', 'FOUNDATION', TEXT_MUTED,
    'The first working version. Proved the concept — customers could see a digital menu and place an order.',
    [
      'Digital menu with product photos, categories, and pricing',
      'QR code generation for tables',
      'Basic order flow: customer submits, cashier sees the order',
      'Admin login with a secure JWT security token',
      'Order status tracking: Pending → Ready → Completed',
      'MongoDB database foundation: products, orders, categories',
    ]);

  versionBlock(doc, 'v0.45–v0.48', 'Early 2026', 'CORE POS', BLUE,
    'The cashier register was built. The system became usable as a real daily POS.',
    [
      'Full POS cashier interface — product catalog, add-ons, cart, and checkout',
      'Multiple payment methods: Cash, GCash, Maya, Bank Transfer',
      'Discount system: flat peso discount and percentage discount',
      'Inventory tracking — stock levels, restock entries, and stock history',
      'StockCard audit trail: every stock movement is permanently recorded',
      'Real-time order updates across all connected devices',
      'First accounting journal entries automatically linked to completed orders',
    ]);

  versionBlock(doc, 'v0.5', 'Early 2026', 'ACCOUNTING', ORANGE,
    'Real accounting was wired in. Every sale, void, and free order now creates proper double-entry ledger records.',
    [
      'Double-entry journal ledger — visible and searchable by the admin',
      'Automatic cost-of-goods (COGS) calculation on every completed sale',
      'Void order workflow with full accounting reversal (undoes every journal entry)',
      'Complimentary (free/staff meal) order type — records cost only, no revenue',
      'Automatic end-of-day archiving at midnight',
      'Analytics dashboard: gross sales, order count, and average order value',
    ]);

  versionBlock(doc, 'v0.55', 'Early 2026', 'SHIFTS', GREEN,
    'Shift management and role-based access controls were added.',
    [
      'Shift start: cashier enters starting cash amount before taking any orders',
      'End-of-shift reconciliation: expected cash vs. actual cash, variance recorded',
      'Full shift history for management review',
      'Role-based access: Staff sees POS only; Super Admin has full access',
      'Partial delivery state for large orders: "Give Partial — More Items Coming"',
    ]);

  versionBlock(doc, 'v0.6–v0.7', 'Early 2026', 'SECURITY', RED,
    'A full security audit was conducted and all critical vulnerabilities were resolved.',
    [
      'Login rate limiting: prevents password guessing attacks (brute force)',
      'Cashier identity taken from the secure login token — not from the order form (prevents impersonation)',
      'Voiding an order restricted to Super Admin only',
      'Inventory editing locked to Super Admin only',
      'CRITICAL fix: staff could previously change the admin password — resolved',
      'Removed a hardcoded PIN code and secret token that were exposed in the app',
      'All financial and inventory endpoints now require a valid login',
    ]);

  versionBlock(doc, 'v0.9–v1.0', 'May 2026', 'ENTERPRISE READY', GREEN,
    'Upgraded to enterprise grade: full accounting suite, delivery management, expiry tracking, and production deployment infrastructure.',
    [
      'Profit & Loss Statement with a date-range picker',
      'Balance Sheet — auto-calculated with balance verification check',
      'Accounts Receivable tracking for e-wallet and delivery payments',
      'Expense entry with automatic accounting journal posting',
      'Complete Chart of Accounts with standard account codes (1000–6200)',
      'Delivery dispatch pipeline with 6 fulfillment modes',
      'Expiry date tracking per ingredient with colour-coded warning badges',
      'FEFO batch tracking — oldest stock is always consumed first',
      'Multi-batch inventory — track separate deliveries of the same ingredient',
      'Excel / CSV bulk stock-take import with diff preview before confirming',
      'Spoilage / waste logging with automatic accounting journal entry',
      'Low-stock alert badges on the sidebar',
      'Shift history archive with variance colour coding',
      'X-Reading mid-shift report',
      'NON-VAT REGISTERED label on sidebar and all receipts',
      'Docker deployment containers for easy cloud setup',
      'GitHub automated test suite: 75 tests pass on every code change',
    ]);

  versionBlock(doc, 'v1.1', 'May 30, 2026', 'CURRENT VERSION', GREEN_DARK,
    'Unit display and Excel import were standardised for operator convenience.',
    [
      'Operators only ever see kg, L, and pcs — never raw grams or millilitres',
      'Excel import format simplified to 5 columns: Code, Product, Qty+Unit, Unit Cost, Expiry',
      'Smart name parsing: writing "Milk 1L" in the spreadsheet auto-detects the unit',
      'Physical stock count in the EOD audit now shows display units (kg/L/pcs)',
      'SRP (suggested retail price) field removed — not applicable in Non-VAT model',
      'All 75 automated tests passing; clean build on both server and client',
    ]);

  // ── SECTION 6: PROS & CONS ────────────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Section 6 — Pros & Cons');
  doc.y = 50;

  h1(doc, 'Section 6');
  h2(doc, 'Pros & Cons — An Honest Assessment');
  rule(doc);
  gap(doc, 10);

  body(doc, 'No system is perfect. Below is an honest assessment of what Semivra does very well and where it currently has limitations. The limitations are explained in full detail in the separate Issues Report.');
  gap(doc, 12);

  sectionBar(doc, 'Strengths — What Semivra does well');
  gap(doc, 4);

  var pros = [
    ['No monthly subscription fee',
     'You pay for the setup once. There is no recurring software bill — only your cloud server hosting (roughly ₱200–₱800/month).'],
    ['Works on any device',
     'A tablet, laptop, or desktop with a browser is all you need. No expensive dedicated POS hardware required.'],
    ['Real double-entry accounting built in',
     'Most POS systems record sales but cannot produce a proper P&L or Balance Sheet. Semivra generates these automatically from your daily operations.'],
    ['Non-VAT compliant from day one',
     'Receipts, journal entries, and reports are structured correctly for non-VAT registered businesses. No phantom VAT amounts anywhere.'],
    ['QR self-ordering reduces workload',
     'Customers order directly from their phone at the table. This reduces staff workload, eliminates order errors, and speeds up service.'],
    ['FEFO batch tracking protects product quality',
     'Older stock is always consumed before newer stock — automatically. This reduces waste and supports food safety.'],
    ['Full audit trail — nothing can be silently changed',
     'Every stock movement, sale, void, and accounting entry is permanently recorded. Nothing disappears quietly.'],
    ['Staff cannot see sensitive financial data',
     'Role-based access means cashiers and kitchen staff cannot see your revenue reports, accounting, or void completed orders.'],
    ['E-wallet and delivery payments tracked as receivables',
     'GrabFood and Foodpanda payments are recorded as Accounts Receivable until you confirm receipt of the payout.'],
    ['Automatic inventory deduction on every sale',
     'No manual stock counting after each sale. Ingredients are deducted based on recipes the moment an order is completed.'],
    ['Customisable for any F&B brand',
     'Colours, branding, and product categories are configurable — suitable for white-label deployment to multiple café clients.'],
    ['75 automated tests protect the system',
     'Every time the code is updated, 75 automated tests verify that accounting, unit conversions, and batch logic are still correct.'],
  ];

  pros.forEach(function(item) {
    var rem = PH - doc.page.margins.bottom - doc.y;
    if (rem < 60) { doc.addPage(); footer(doc, 'Section 6 — Pros & Cons (continued)'); doc.y = 50; }
    h3(doc, '✓  ' + item[0]);
    body(doc, item[1]);
    gap(doc, 4);
  });

  gap(doc, 8);
  sectionBar(doc, 'Limitations — What it cannot yet do');
  gap(doc, 4);

  var cons = [
    ['Requires internet or LAN',
     'The system does not work without a network connection. If the internet drops during service, orders cannot be processed digitally. A local LAN setup mitigates this for most cafés.'],
    ['No offline mode',
     'There is no "work offline and sync later" capability. A full offline mode is a significant development project — it is on the roadmap but not yet built.'],
    ['Single café per installation',
     'Each deployment serves one business location. A second branch would need its own separate installation. Combined multi-branch reports are not yet available.'],
    ['No direct thermal printer connection',
     'Receipts and kitchen tickets print via the browser\'s print dialog. There is no automatic print-on-order or direct thermal printer driver integration.'],
    ['No mobile app',
     'The system runs in a browser. There is no native iOS or Android app available on the App Store or Google Play.'],
    ['No loyalty / rewards programme',
     'There is no built-in customer points system or stamp card. Discounts can be applied manually but automatic loyalty rewards are not available.'],
    ['No payment terminal integration',
     'GCash and Maya payments are confirmed manually by the cashier. There is no card reader or e-wallet terminal that auto-confirms transactions.'],
    ['Analytics runs on the device',
     'Charts and calculations run inside the browser. With a very large order history (many months of data), this may slow down on older tablets.'],
    ['Technical setup required',
     'Initial deployment requires a developer to configure the server, database, and environment settings. It is not yet a self-serve one-click install.'],
  ];

  cons.forEach(function(item) {
    var rem = PH - doc.page.margins.bottom - doc.y;
    if (rem < 60) { doc.addPage(); footer(doc, 'Section 6 — Pros & Cons (continued)'); doc.y = 50; }
    h3(doc, '✗  ' + item[0]);
    body(doc, item[1]);
    gap(doc, 4);
  });

  gap(doc, 12);
  var rem3 = PH - doc.page.margins.bottom - doc.y;
  if (rem3 < 80) { doc.addPage(); footer(doc, 'Section 6 — Summary'); doc.y = 50; }
  callout(doc, 'Summary: The limitations listed above are either planned improvements for future versions or deliberate scope decisions (e.g. Non-VAT focus). None of them prevent the system from being used effectively as a daily POS for a Philippine café today.');

  doc.end();
  console.log('✓  Report 1 written:', path.join(OUT, 'Semivra_Libellus_Overview_Report.pdf'));
}

// ════════════════════════════════════════════════════════════════════════════
//  REPORT 2 — Current Issues & Pending Work (Internal)
// ════════════════════════════════════════════════════════════════════════════
function buildReport2() {
  const doc = mkDoc();
  doc.pipe(fs.createWriteStream(path.join(OUT, 'Semivra_Libellus_Issues_Report.pdf')));

  // ── COVER ─────────────────────────────────────────────────────────────────
  var IDARK = '#1C0505';
  var IRED  = '#7B1111';
  doc.rect(0, 0, PW, PH).fill(IDARK);
  doc.rect(0, PH - 90, PW, 90).fill(IRED);

  doc.fontSize(48).font('Helvetica-Bold').fillColor('#E8A0A0').text('Open Issues &', ML, 110);
  doc.fontSize(48).font('Helvetica-Bold').fillColor(WHITE).text('Pending Work', ML, 162);
  doc.fontSize(13).font('Helvetica').fillColor('#CC9999').text('Semivra Libellus POS — v1.1', ML, 220);

  doc.moveTo(ML, 248).lineTo(PW - MR, 248).strokeColor(IRED).lineWidth(1).stroke();

  doc.fontSize(11).font('Helvetica').fillColor('#CCAAAA')
     .text('Internal review document. This report lists what still needs to be done before the system reaches its full planned feature set. Written in plain language for business owners and decision makers.', ML, 262, { width: CW });

  var infoTop = 360;
  [
    ['Document Type', 'Open Issues & Pending Feature Report'],
    ['System Version', 'v1.1  (May 30, 2026)'],
    ['Overall Status', 'Operational — approximately 85% complete toward full feature set'],
    ['Contact',        's3mivra@gmail.com'],
  ].forEach(function(row, i) {
    var ry = infoTop + i * 38;
    doc.fontSize(9).font('Helvetica').fillColor('#CC9999').text(row[0], ML, ry);
    doc.fontSize(12).font('Helvetica-Bold').fillColor(WHITE).text(row[1], ML, ry + 12);
    doc.moveTo(ML, ry + 32).lineTo(PW - MR, ry + 32).strokeColor('#3A1515').lineWidth(0.4).stroke();
  });

  doc.fontSize(9).font('Helvetica').fillColor('#FF9999')
     .text('INTERNAL DOCUMENT — NOT FOR EXTERNAL DISTRIBUTION', 0, PH - 70, { align: 'center', width: PW });
  doc.fontSize(9).font('Helvetica').fillColor(WHITE)
     .text('s3mivra@gmail.com', 0, PH - 54, { align: 'center', width: PW });

  // ── PAGE 2: INTRO & SUMMARY ────────────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Issues Report — Overview');
  doc.y = 50;

  h1(doc, 'About This Report');
  rule(doc);
  gap(doc, 12);

  body(doc, 'This report is for the development team and any stakeholders who need to understand the current state of Semivra Libellus — specifically what is not yet done, what has known limitations, and what is planned for future versions.');
  gap(doc, 4);
  body(doc, 'Issues are grouped into four priority levels so you can judge what should be fixed before launch, what can be improved over time, and what is a nice-to-have for the future.');
  gap(doc, 16);

  sectionBar(doc, 'Issue Summary at a Glance');
  gap(doc, 6);

  var summaryItems = [
    { level: 'CRITICAL',      count: '0', note: 'No blocking issues. The system is operational.',     color: GREEN },
    { level: 'HIGH',          count: '3', note: 'Should be fixed before full client launch.',          color: RED },
    { level: 'MEDIUM',        count: '6', note: 'Important improvements for growth and reliability.',  color: ORANGE },
    { level: 'LOW / FUTURE',  count: '5', note: 'Nice-to-have features for future versions.',          color: TEXT_MUTED },
  ];

  summaryItems.forEach(function(s) {
    var boxY = doc.y;
    doc.rect(ML, boxY, CW, 36).fill(GREY_BG);
    doc.rect(ML, boxY, 5, 36).fill(s.color);

    doc.fontSize(22).font('Helvetica-Bold').fillColor(s.color)
       .text(s.count, ML + 16, boxY + 7, { lineBreak: false });

    doc.fontSize(9).font('Helvetica-Bold');
    var pw3 = doc.widthOfString(s.level) + 16;
    doc.roundedRect(ML + 50, boxY + 10, pw3, 17, 3).fill(s.color);
    doc.fillColor(WHITE).text(s.level, ML + 58, boxY + 14, { lineBreak: false });

    doc.fontSize(10.5).font('Helvetica').fillColor(TEXT)
       .text(s.note, ML + 56 + pw3, boxY + 12, { lineBreak: false });

    doc.y = boxY + 44;
    doc.moveTo(ML, doc.y).lineTo(PW - MR, doc.y).strokeColor(LINE).lineWidth(0.4).stroke();
    doc.y += 4;
  });

  gap(doc, 14);
  callout(doc, 'Important context: The system is fully operational today. Cashiers can take orders, inventory is tracked automatically, and accounting journals are generated on every transaction. The issues in this report are improvements and missing features — not reasons to stop using the system.');

  // ── HIGH PRIORITY ─────────────────────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Issues — High Priority');
  doc.y = 50;

  h1(doc, 'High Priority Issues');
  rule(doc);
  gap(doc, 8);
  body(doc, 'These three issues pose the greatest operational risk and should be resolved before the system is launched to paying clients.');
  gap(doc, 14);

  issueCard(doc,
    'H-01', 'HIGH',
    'The admin panel is one very large file (4,825 lines)',
    'The complete POS interface — orders, inventory, accounting, analytics, and settings — is all written in a single code file that is now 4,825 lines long. Think of it like a physical notebook where every department\'s records are crammed together with no dividers or organisation.',
    'When a developer needs to fix or add something, they work inside this one giant file. A mistake in one section can accidentally break something in a completely different section. As the system grows, updates become slower and riskier. This directly increases the cost and time of future customisation.',
    'The file needs to be split into smaller, organised parts — one file per major section (Orders, Inventory, Accounting, Analytics, Settings). This is a code organisation task only and will not change anything visible to users. Estimated effort: 3–5 working days. Planned for version 1.2.',
    RED);

  issueCard(doc,
    'H-02', 'HIGH',
    'No offline mode — an internet outage stops operations',
    'If the internet connection goes down while the POS is being used, cashiers cannot submit new orders or save data. There is no "work offline and sync when back online" feature. It is similar to a cash register that stops working when the electricity flickers.',
    'During peak café hours, an internet outage — even for 10 to 15 minutes — means orders cannot be processed digitally. Staff must take orders on paper and enter them manually after reconnecting. This is a real risk given the inconsistency of some Philippine internet providers.',
    'The recommended mitigation today is to run the POS server on a local router inside the café (LAN setup), so the system works even if the internet goes down — only cloud backups need internet. A full offline mode with sync is a major engineering project (estimated 4–6 weeks) and is on the roadmap.',
    RED);

  issueCard(doc,
    'H-03', 'HIGH',
    'Receipts do not print automatically — browser dialog required',
    'When an order is completed, the receipt appears on screen. To print it, the cashier must click a "Print" button which opens the browser\'s standard print dialog — the same one used for printing documents or web pages. Every single receipt requires this extra step.',
    'This slows down the checkout process compared to systems where receipts print instantly with no extra interaction. It also means there is no automatic kitchen ticket printing when an order is submitted — kitchen staff rely entirely on the screen.',
    'Integrating with a Bluetooth or USB thermal receipt printer (common 58mm or 80mm models sold in the Philippines for ₱800–₱3,000) would solve this. A local print server can bridge the gap without changing the main application. Estimated development effort: 1–2 weeks.',
    RED);

  // ── MEDIUM PRIORITY ───────────────────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Issues — Medium Priority');
  doc.y = 50;

  h1(doc, 'Medium Priority Issues');
  rule(doc);
  gap(doc, 8);
  body(doc, 'These issues do not block daily operations but are important improvements for long-term stability, growth, and a better staff experience.');
  gap(doc, 14);

  issueCard(doc,
    'M-01', 'MEDIUM',
    'Analytics calculations run on the device and may slow down over time',
    'All charts and sales summaries are calculated inside the browser using the full order history loaded from the server. For a new café with a few weeks of data this is fast. But after a year of operation with tens of thousands of orders, loading and processing all that data may cause sluggishness on older tablets.',
    'On an Amazon Fire tablet or older Android device, the analytics tab may take several seconds to load or may feel unresponsive as order volume grows. Staff experience degrades, not functionality.',
    'Move the heavy calculations to the server so the browser only receives pre-computed summary numbers. The browser then just displays the results — no heavy processing needed. Estimated effort: 3–5 days of backend work.',
    ORANGE);

  issueCard(doc,
    'M-02', 'MEDIUM',
    'Only one café branch per installation',
    'Each installation of Semivra serves one physical location. If you open a second branch, you need a separate server, separate database, and a separate URL for that branch. There is no combined management view or consolidated reports across both.',
    'As the business grows beyond one location, managing two separate systems becomes inconvenient. You would need to log in to each separately and manually combine the numbers to see total business performance.',
    'Add a "branch" layer to the data model so one installation can manage multiple locations with a combined management view and per-branch reports. This is a significant architectural change — estimated 3–4 weeks of development. Planned as a future version.',
    ORANGE);

  issueCard(doc,
    'M-03', 'MEDIUM',
    'No sound or pop-up alert when a new QR order arrives',
    'When a customer submits an order through the QR dine-in menu, there is no sound, vibration, or pop-up notification on the cashier\'s device. The order appears in the queue, but only if a staff member is actively looking at the screen.',
    'A busy cashier handling multiple tasks — taking payments, packing takeout orders, answering questions — might miss a new QR order for several minutes. This reduces the speed-of-service benefit that QR self-ordering is supposed to provide.',
    'Implement an audio chime or bell sound that plays automatically when a new order arrives. This is a small change — estimated 2–3 days. Web Push Notifications (alerts even when the browser tab is minimised) are a more complete solution requiring additional setup.',
    ORANGE);

  issueCard(doc,
    'M-04', 'MEDIUM',
    'All connected devices receive all real-time updates',
    'When any order is updated — prepared, delivered, or cancelled — every device currently logged in receives that notification simultaneously. The cashier\'s tablet, the manager\'s laptop, and any kitchen screen all get the same event, even if it does not apply to them.',
    'With 2–3 devices this is not a problem. But as more stations are added — a dedicated kitchen screen, multiple cashier tablets, a manager\'s office device — the system sends unnecessary data to all of them. Not a current issue, but will become inefficient at scale.',
    'Implement channel-based routing (called "rooms" in the technology used) so kitchen devices only receive kitchen events and cashier devices only receive checkout events. Low risk, estimated 1–2 days. Scheduled for when the number of connected devices grows.',
    ORANGE);

  issueCard(doc,
    'M-05', 'MEDIUM',
    'Legacy admin accounts may be missing the correct role assignment',
    'When role-based access was introduced, a startup script was written to automatically update any old "Super Admin" accounts that were missing the role field. This script runs automatically when the server starts. However, if the server starts in an unusual way that bypasses the normal startup sequence, those accounts could silently lose Super Admin access.',
    'Edge case scenario: an old admin account loses its role flag without any obvious error message. The manager tries to access financial reports or user management and receives an "access denied" message — confusing and alarming in the middle of operations.',
    'Run a one-time database migration to permanently fix all legacy accounts independently of server startup behaviour. Low effort — estimated half a day. Very low risk, but worth doing before the system is handed over to a client.',
    ORANGE);

  issueCard(doc,
    'M-06', 'MEDIUM',
    'No customer loyalty or rewards programme',
    'There is no built-in customer points system, stamp card, or repeat-customer discount. Discounts can be applied manually by the cashier at any time, but the system does not automatically recognise returning customers or accumulate rewards across visits.',
    'Loyalty programmes are a common and proven retention tool for Philippine cafés. Without one, you cannot offer "buy 10 get 1 free" or points-based rewards without tracking it in a separate notebook or spreadsheet.',
    'Add a customer profile model with a phone number or name as the identifier, a points balance, and configurable rewards rules. The cashier could look up a customer at checkout and apply accumulated points. Estimated development effort: 1–2 weeks.',
    ORANGE);

  // ── LOW PRIORITY ──────────────────────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Issues — Low Priority / Future');
  doc.y = 50;

  h1(doc, 'Low Priority / Future Features');
  rule(doc);
  gap(doc, 8);
  body(doc, 'These items will not affect daily operations. They are improvements and additions planned for future versions of the system.');
  gap(doc, 14);

  var lowItems = [
    {
      id: 'L-01', title: 'No native mobile app (iOS or Android)',
      what: 'The system runs in a web browser. While it works reasonably well on a mobile browser, there is no dedicated app available on the App Store or Google Play Store that staff can install on their phones.',
      impact: 'Staff cannot receive push notifications on their personal phones. The browsing experience on small phone screens is functional but not optimised for phone-sized layouts.',
      fix: 'Build a Progressive Web App (PWA) version — this can be "installed" from the browser and behaves like a native app without requiring App Store submission or approval. Estimated: 2–4 weeks.',
    },
    {
      id: 'L-02', title: 'No payment terminal integration',
      what: 'When a customer pays by GCash or Maya, the cashier manually selects the payment method after the customer shows their confirmation screen. There is no physical terminal that automatically verifies the payment.',
      impact: 'Slight risk of cashier selecting the wrong payment method by mistake. Slightly slower checkout compared to tap-to-pay terminals, which auto-confirm the payment.',
      fix: 'Integrate with the GCash for Business API or a third-party payment terminal SDK. This depends on obtaining a merchant agreement with the payment provider. Estimated development time: 2–3 weeks once API access is provided.',
    },
    {
      id: 'L-03', title: 'No dedicated kitchen display screen (KDS)',
      what: 'Kitchen staff currently use the same order queue screen as the cashier, or a separate browser window showing the same interface. There is no screen designed specifically for kitchen use — large text, clear status buttons, audio alerts.',
      impact: 'Kitchen staff workflow is less efficient than a purpose-built kitchen display. Orders may be missed on busy days if no dedicated kitchen screen is set up.',
      fix: 'Build a read-only kitchen-facing view showing only pending and in-progress orders, with large touch-friendly buttons to mark each order as ready. Estimated: 3–5 days of frontend work.',
    },
    {
      id: 'L-04', title: 'No supplier management or purchase orders',
      what: 'There is no supplier contact book or formal purchase order (PO) workflow in the system. When stock runs low, the operator contacts the supplier manually and then enters the restock into the system by hand.',
      impact: 'Restocking is a fully manual process. There is no automated "generate a purchase order when stock falls below the threshold" feature, and no way to track which supplier provides which ingredient.',
      fix: 'Add a supplier model (name, contact details, products supplied), a PO creation and approval workflow, and a "receive against PO" restock flow. Estimated: 1–2 weeks of development.',
    },
    {
      id: 'L-05', title: 'No customer-facing display (second screen)',
      what: 'A customer-facing screen — like the second monitor you see at a supermarket checkout showing your items and total — is not yet available. Customers cannot see their order building up as the cashier adds items.',
      impact: 'This is a transparency and trust improvement rather than a functional gap. Most small cafés do not need it, but larger operations with a counter setup may want it.',
      fix: 'Create a second browser window or TV-connected display mode that shows the current order in large, clear text. Estimated: 2–3 days of frontend work.',
    },
  ];

  lowItems.forEach(function(item) {
    var rem = PH - doc.page.margins.bottom - doc.y;
    if (rem < 160) { doc.addPage(); footer(doc, 'Issues — Low Priority (continued)'); doc.y = 50; }

    // item header
    var headerY = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_MUTED)
       .text(item.id, ML, headerY, { lineBreak: false, width: 36 });
    doc.fontSize(12).font('Helvetica-Bold').fillColor(TEXT)
       .text(item.title, ML + 40, headerY, { width: CW - 44 });
    doc.y += 4;
    rule(doc, LINE);
    gap(doc, 6);

    doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_MUTED).text('What is it?', ML);
    doc.y += 12;
    body(doc, item.what);

    doc.fontSize(10).font('Helvetica-Bold').fillColor(RED).text('Impact:', ML);
    doc.y += 12;
    body(doc, item.impact);

    doc.fontSize(10).font('Helvetica-Bold').fillColor(BLUE).text('How to fix it:', ML);
    doc.y += 12;
    body(doc, item.fix);

    gap(doc, 8);
    rule(doc, LINE);
    gap(doc, 14);
  });

  // ── WHAT IS WORKING ───────────────────────────────────────────────────────
  doc.addPage();
  footer(doc, 'Issues Report — What IS working');
  doc.y = 50;

  h1(doc, 'What Is Fully Working Today');
  rule(doc);
  gap(doc, 8);

  body(doc, 'To provide complete context alongside the issues above, here is the full list of everything verified, tested, and working correctly in version 1.1.');
  gap(doc, 12);

  var working = [
    'POS cashier interface: product search, add-ons, discounts, payment methods, change calculator',
    'Customer QR dine-in self-ordering: scan QR → browse menu → submit order → appears in queue',
    'Six fulfillment modes: Dine-In, Takeout, Pickup, Manual Delivery, Grab Delivery, Foodpanda',
    'Delivery dispatch pipeline: Preparing → Out for Delivery → Delivered',
    'Delivery details capture: address, customer phone number, delivery fee, scheduled time',
    'Partial delivery state: "Give Partial — More Items Coming"',
    'Complimentary (free) orders with cost-only accounting',
    'Void completed orders with full accounting reversal (Super Admin only)',
    'Shift start with starting cash entry by the cashier',
    'End-of-shift reconciliation: expected vs. actual cash, variance logged',
    'Shift history archive with variance colour coding',
    'X-Reading mid-shift PDF generation',
    'Real double-entry journal ledger — automatic entry on every transaction',
    'Automatic COGS (cost of goods sold) calculation on every sale',
    'Accounts Receivable tracking for e-wallet and delivery platform payments',
    'A/R settlement workflow: mark as received and record deposit destination',
    'Profit & Loss Statement with custom date range',
    'Balance Sheet with accounting equation verification',
    'Expense entry with journal posting and category tracking',
    'Chart of Accounts with standard Philippine SME account codes (1000–6200)',
    'Inventory tracking: stock levels, restock, and full stock movement history',
    'FEFO batch consumption: oldest expiry date always consumed first',
    'Multi-batch inventory: separate tracking per delivery receipt',
    'Expiry date monitoring with colour-coded badges (expired, warning, safe)',
    'Low-stock alerts on sidebar and on each inventory row',
    'Spoilage / waste logging with automatic accounting journal entry',
    'Excel / CSV stock-take import with diff preview and confirmation step',
    'Display units: operators see kg / L / pcs everywhere — never raw grams or millilitres',
    'EOD physical count audit in display units (kg/L/pcs)',
    'Role-based access: Staff vs. Super Admin with locked sections',
    'Login rate limiting: brute-force protection on the login page',
    'Atomic inventory deduction: no double-counting during simultaneous orders',
    'Non-VAT compliant receipts with BIR-required "NON-VAT REGISTERED" label',
    'Docker deployment containers: one-command server setup',
    'GitHub Actions CI: automated build and test checks on every code change',
    '75 automated tests: accounting logic, unit conversion, and batch math all verified',
    'Structured production logging for server monitoring and debugging',
    'Health check endpoint for uptime monitoring by load balancers',
  ];

  working.forEach(function(item) {
    var rem = PH - doc.page.margins.bottom - doc.y;
    if (rem < 22) { doc.addPage(); footer(doc, 'What IS working (continued)'); doc.y = 50; }
    checkBullet(doc, item, true);
  });

  gap(doc, 16);
  var rem4 = PH - doc.page.margins.bottom - doc.y;
  if (rem4 < 80) { doc.addPage(); footer(doc, 'Issues Report — Closing'); doc.y = 50; }
  callout(doc, 'Overall assessment: Semivra Libellus v1.1 is a production-ready POS system. The 3 high-priority issues represent real operational risks that should be addressed before full commercial deployment. The medium and low items form a healthy development backlog — not blockers. A business using this system today has a more capable and more auditable back-office than the majority of Philippine SME cafés.');

  doc.end();
  console.log('✓  Report 2 written:', path.join(OUT, 'Semivra_Libellus_Issues_Report.pdf'));
}

buildReport1();
buildReport2();
