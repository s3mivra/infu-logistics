const PDFDocument = require('./node_modules/pdfkit');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..');

// ─── COLOUR PALETTE ────────────────────────────────────────────────────────
const C = {
  brand:      '#6F874D',
  brandDark:  '#4A5E33',
  brandLight: '#B8C99A',
  accent:     '#D4A017',
  bg:         '#0D0D0D',
  surface:    '#1A1A1A',
  white:      '#FFFFFF',
  offWhite:   '#F5F5F5',
  muted:      '#9CA3AF',
  danger:     '#EF4444',
  warn:       '#F59E0B',
  ok:         '#22C55E',
  blue:       '#3B82F6',
  ink:        '#1E1E1E',
  lineGrey:   '#E5E7EB',
  sectionBg:  '#F9FAF6',
  tagBg:      '#EFF3E8',
};

// ─── HELPERS ───────────────────────────────────────────────────────────────
function newDoc() {
  return new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: { Creator: 'Semivra Negotium / Libellus', Author: 's3mivra' },
  });
}

function pageW(doc) { return doc.page.width; }
function usableW(doc) { return pageW(doc) - doc.page.margins.left - doc.page.margins.right; }
function lm(doc) { return doc.page.margins.left; }

function hRule(doc, y, color = C.lineGrey, w = null) {
  const x = lm(doc);
  const width = w || usableW(doc);
  doc.moveTo(x, y).lineTo(x + width, y).strokeColor(color).lineWidth(0.5).stroke();
}

function coverBand(doc, hex, x, y, w, h) {
  doc.rect(x, y, w, h).fill(hex);
}

function tag(doc, label, x, y, bgHex = C.tagBg, fgHex = C.brandDark) {
  const pad = 5;
  doc.fontSize(7).font('Helvetica-Bold');
  const tw = doc.widthOfString(label) + pad * 2;
  doc.roundedRect(x, y, tw, 14, 3).fill(bgHex);
  doc.fillColor(fgHex).text(label, x + pad, y + 3, { lineBreak: false });
  return tw + 4; // width consumed
}

function sectionHeader(doc, title, y) {
  const x = lm(doc);
  const w = usableW(doc);
  doc.rect(x, y, w, 22).fill(C.sectionBg);
  doc.moveTo(x, y).lineTo(x, y + 22).strokeColor(C.brand).lineWidth(3).stroke();
  doc.fontSize(10).font('Helvetica-Bold').fillColor(C.brandDark)
     .text(title, x + 10, y + 6, { lineBreak: false });
  return y + 30;
}

function kpiBox(doc, label, value, unit, x, y, w = 110, color = C.brand) {
  doc.rect(x, y, w, 52).fill(C.sectionBg);
  doc.rect(x, y, w, 3).fill(color);
  doc.fontSize(7).font('Helvetica').fillColor(C.muted).text(label, x + 8, y + 10, { lineBreak: false, width: w - 12 });
  doc.fontSize(16).font('Helvetica-Bold').fillColor(C.ink).text(value, x + 8, y + 22, { lineBreak: false });
  if (unit) doc.fontSize(7).font('Helvetica').fillColor(C.muted).text(unit, x + 8, y + 42, { lineBreak: false });
}

function bullet(doc, text, x, y, indent = 10, color = C.brand) {
  doc.circle(x + indent - 4, y + 5, 2).fill(color);
  doc.fontSize(9).font('Helvetica').fillColor(C.ink)
     .text(text, x + indent + 2, y, { width: usableW(doc) - indent - 2, lineBreak: true });
  return doc.y + 2;
}

function proConRow(doc, type, text, x, y) {
  const isPlus = type === '+';
  const iconBg = isPlus ? C.ok : C.danger;
  const icon   = isPlus ? '✓' : '✕';
  doc.roundedRect(x, y, 14, 14, 2).fill(iconBg);
  doc.fontSize(8).font('Helvetica-Bold').fillColor(C.white).text(icon, x + 3, y + 3, { lineBreak: false });
  doc.fontSize(9).font('Helvetica').fillColor(C.ink)
     .text(text, x + 20, y + 1, { width: usableW(doc) - 24, lineBreak: true });
  return Math.max(doc.y, y + 18) + 2;
}

function versionRow(doc, ver, date, badge, badgeColor, items, x, y) {
  // version pill
  doc.roundedRect(x, y, 46, 18, 4).fill(C.brandDark);
  doc.fontSize(9).font('Helvetica-Bold').fillColor(C.white).text(ver, x + 5, y + 4, { lineBreak: false });
  // badge
  doc.roundedRect(x + 52, y + 2, badgeColor === C.ok ? 58 : 72, 14, 3).fill(badgeColor);
  doc.fontSize(7).font('Helvetica-Bold').fillColor(C.white).text(badge, x + 56, y + 4, { lineBreak: false });
  // date
  doc.fontSize(8).font('Helvetica').fillColor(C.muted).text(date, x + 140, y + 4, { lineBreak: false });

  let cy = y + 24;
  items.forEach(item => {
    cy = bullet(doc, item, x + 4, cy, 10, C.brandLight);
    if (cy > 720) { doc.addPage(); cy = 56; }
  });
  hRule(doc, cy + 4, C.lineGrey);
  return cy + 12;
}

function addPageHeader(doc, title, subtitle) {
  const x = lm(doc);
  const w = usableW(doc);
  // top green band
  doc.rect(0, 0, pageW(doc), 6).fill(C.brand);
  // title
  doc.fontSize(11).font('Helvetica-Bold').fillColor(C.brandDark).text(title, x, 18, { lineBreak: false });
  doc.fontSize(8).font('Helvetica').fillColor(C.muted).text(subtitle, x + doc.widthOfString(title) + 8, 21, { lineBreak: false });
  hRule(doc, 34, C.brandLight);
}

// ═══════════════════════════════════════════════════════════════════════════
//  REPORT 1 — Full Audit / Client Overview
// ═══════════════════════════════════════════════════════════════════════════
function buildReport1() {
  const doc = newDoc();
  const file = path.join(OUT_DIR, 'Semivra_Libellus_Overview_Report.pdf');
  doc.pipe(fs.createWriteStream(file));

  // ── COVER PAGE ──────────────────────────────────────────────────────────
  doc.rect(0, 0, pageW(doc), 595).fill(C.ink);

  // green accent bar left
  doc.rect(0, 0, 6, 595).fill(C.brand);

  // Logo area (text-based logo)
  doc.fontSize(36).font('Helvetica-Bold').fillColor(C.brand).text('semivra', 66, 100, { lineBreak: false });
  doc.fontSize(12).font('Helvetica').fillColor(C.brandLight).text('  negotium + libellus', 66 + doc.widthOfString('semivra', { fontSize: 36 }), 116, { lineBreak: false });

  doc.fontSize(9).font('Helvetica').fillColor(C.muted).text('POINT-OF-SALE SYSTEM', 66, 148);

  // tagline
  doc.moveTo(66, 168).lineTo(520, 168).strokeColor(C.brand).lineWidth(1).stroke();
  doc.fontSize(16).font('Helvetica-Bold').fillColor(C.white)
     .text('Full System Overview & Capability Report', 66, 178, { width: 460 });
  doc.fontSize(10).font('Helvetica').fillColor(C.muted)
     .text('Prepared for: Client Review & Onboarding', 66, 220);

  // info block
  const infoY = 260;
  [
    ['Document Type', 'Capability & Version Audit'],
    ['Product',       'Semivra Libellus POS v1.1'],
    ['Target Client', 'F&B / Café Operators (Philippines)'],
    ['Compliance',    'Non-VAT Registered (BIR Non-VAT)'],
    ['Date',          'May 30, 2026'],
    ['Prepared by',   's3mivra · s3mivra@gmail.com'],
  ].forEach(([k, v], i) => {
    const yy = infoY + i * 26;
    doc.fontSize(7).font('Helvetica').fillColor(C.muted).text(k.toUpperCase(), 66, yy, { lineBreak: false });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.white).text(v, 220, yy, { lineBreak: false });
    doc.moveTo(66, yy + 16).lineTo(500, yy + 16).strokeColor('#2A2A2A').lineWidth(0.4).stroke();
  });

  // bottom accent
  doc.rect(0, 570, pageW(doc), 25).fill(C.brandDark);
  doc.fontSize(7).font('Helvetica').fillColor(C.brandLight)
     .text('CONFIDENTIAL — FOR CLIENT REVIEW ONLY', 0, 579, { align: 'center', lineBreak: false });

  // ── PAGE 2: WHAT IS SEMIVRA? ─────────────────────────────────────────────
  doc.addPage();
  addPageHeader(doc, 'SECTION 1', 'What is Semivra Negotium & Libellus?');

  let y = 50;

  // Intro paragraph
  doc.fontSize(10).font('Helvetica-Bold').fillColor(C.brandDark).text('What is this system?', lm(doc), y);
  y += 18;
  doc.fontSize(9.5).font('Helvetica').fillColor(C.ink).text(
    'Semivra Negotium & Libellus is a complete Point-of-Sale (POS) and business management system built specifically for small-to-medium food and beverage businesses in the Philippines — starting with café operations. It runs on any modern device with a web browser (tablet, laptop, desktop) and requires no expensive dedicated hardware.',
    lm(doc), y, { width: usableW(doc), lineBreak: true }
  );
  y = doc.y + 10;

  // Name explanation box
  doc.rect(lm(doc), y, usableW(doc), 44).fill(C.tagBg);
  doc.rect(lm(doc), y, 3, 44).fill(C.brand);
  doc.fontSize(8).font('Helvetica-Bold').fillColor(C.brandDark).text('What does the name mean?', lm(doc) + 10, y + 6);
  doc.fontSize(8.5).font('Helvetica').fillColor(C.ink).text(
    '"Negotium" is Latin for business/trade — the operational engine. "Libellus" is Latin for ledger/little book — the accounting and records side. Together they form one unified system.',
    lm(doc) + 10, y + 18, { width: usableW(doc) - 16 }
  );
  y = y + 54;

  // Two-column: who it is for / not for
  y = sectionHeader(doc, 'Who is this built for?', y);
  const colW = (usableW(doc) - 12) / 2;

  // Left: Good fit
  doc.rect(lm(doc), y, colW, 16).fill(C.brand);
  doc.fontSize(8).font('Helvetica-Bold').fillColor(C.white).text('BEST FIT', lm(doc) + 8, y + 4, { lineBreak: false });
  let lyL = y + 22;
  [
    'Cafés, milk tea shops, small restaurants',
    'Food stalls and kiosks',
    'Cloud kitchens / delivery-only brands',
    'Businesses with 1–3 cashier stations',
    'Non-VAT registered establishments',
    'Operators wanting real accounting records',
  ].forEach(t => { lyL = bullet(doc, t, lm(doc), lyL, 10, C.brand); });

  // Right: Less ideal
  const rx = lm(doc) + colW + 12;
  doc.rect(rx, y, colW, 16).fill(C.muted);
  doc.fontSize(8).font('Helvetica-Bold').fillColor(C.white).text('LESS IDEAL FOR', rx + 8, y + 4, { lineBreak: false });
  let lyR = y + 22;
  [
    'Large restaurant chains (50+ tables)',
    'VAT-registered corporations',
    'Businesses needing multi-branch sync',
    'Grocery/retail (non-food product types)',
    'Businesses requiring offline-first mode',
  ].forEach(t => { lyR = bullet(doc, t, rx, lyR, 10, C.muted); });

  y = Math.max(lyL, lyR) + 14;

  // ── WHY THIS AND NOT THE OTHER ────────────────────────────────────────────
  y = sectionHeader(doc, 'Why Semivra instead of other POS systems?', y);
  if (y > 650) { doc.addPage(); addPageHeader(doc, 'SECTION 1', 'Continued'); y = 50; }

  doc.fontSize(9).font('Helvetica').fillColor(C.ink).text(
    'Most POS systems available to Philippine SMEs are either (a) expensive imported products like Square or Toast that carry USD pricing and require proprietary hardware, or (b) basic local systems that lack proper accounting depth. Semivra fills the gap:',
    lm(doc), y, { width: usableW(doc) }
  );
  y = doc.y + 8;

  const compRows = [
    ['Feature',             'Semivra',     'Typical Local POS',  'Square / Toast'],
    ['Real double-entry accounting', '✓',  '✗',                  '✗ (basic only)'],
    ['Non-VAT BIR compliance',       '✓',  'Partial',            '✗ (VAT-focused)'],
    ['Built-in inventory FEFO',      '✓',  '✗',                  'Add-on cost'],
    ['QR dine-in ordering',          '✓',  'Rare',               'Add-on cost'],
    ['Custom branding / white-label','✓',  '✗',                  '✗'],
    ['Monthly fee',         'One-time',    '₱500–₱2,000/mo',     '$60–$165 USD/mo'],
    ['Hardware required',   'None',        'Dedicated terminal',  'iPad + reader'],
    ['Deployment',          'Cloud/LAN',   'Windows only',        'Cloud (US servers)'],
  ];

  const cW = [160, 80, 110, 110];
  const tX = lm(doc);
  compRows.forEach((row, ri) => {
    const rowH = 16;
    const bg = ri === 0 ? C.brandDark : (ri % 2 === 0 ? C.white : C.sectionBg);
    const fg = ri === 0 ? C.white : C.ink;
    doc.rect(tX, y, usableW(doc), rowH).fill(bg);
    row.forEach((cell, ci) => {
      const cx = tX + cW.slice(0, ci).reduce((a, b) => a + b, 0);
      const cellColor = ri > 0 && ci === 1 && cell === '✓' ? C.ok
                      : ri > 0 && ci === 1 && cell === '✗' ? C.danger
                      : fg;
      doc.fontSize(ri === 0 ? 7.5 : 8).font(ri === 0 ? 'Helvetica-Bold' : 'Helvetica')
         .fillColor(cellColor).text(cell, cx + 5, y + 4, { width: cW[ci] - 8, lineBreak: false });
    });
    y += rowH;
    if (y > 730) { doc.addPage(); addPageHeader(doc, 'SECTION 1', 'Continued'); y = 50; }
  });
  y += 6;

  // ── PAGE 3: CAPABILITY OVERVIEW ──────────────────────────────────────────
  doc.addPage();
  addPageHeader(doc, 'SECTION 2', 'System Capabilities');
  y = 50;

  const caps = [
    {
      icon: '🛒', title: 'Point-of-Sale (POS) Register',
      desc: 'Full-featured cashier interface with product search, add-ons, discounts, multiple payment methods, and live change calculator. Supports Dine-In, Takeout, Pickup, Manual Delivery, Grab, and Foodpanda fulfillment modes.',
    },
    {
      icon: '📋', title: 'QR Dine-In Self-Ordering',
      desc: 'Customers scan a table QR code, browse the menu, and submit their own orders. Orders go directly to the kitchen queue. No need for a waiter to take the order — reduces errors and wait times.',
    },
    {
      icon: '📦', title: 'Inventory & Stock Management',
      desc: 'Track every ingredient by weight (kg/L/pcs). Set low-stock alerts. Monitor expiry dates. Use First-Expiry-First-Out (FEFO) batching so older stock is always used first. Log spoilage and waste with one click.',
    },
    {
      icon: '📊', title: 'Real Accounting (Double-Entry Ledger)',
      desc: 'Every sale, payment, expense, and stock movement creates a proper accounting journal entry. View Profit & Loss statement, Balance Sheet, and Accounts Receivable — all generated automatically from your sales data.',
    },
    {
      icon: '🚚', title: 'Delivery & Dispatch Tracking',
      desc: 'Manage delivery orders with full address, phone, fee, and scheduled time. Track dispatch status: Preparing → Out for Delivery → Delivered. Works for your own riders and third-party apps (Grab, Foodpanda).',
    },
    {
      icon: '💰', title: 'Shift & Cash Management',
      desc: 'Cashiers log in with a starting cash amount. At end of shift, the system shows expected vs. actual cash count and records any variance. Full shift history visible to management.',
    },
    {
      icon: '📈', title: 'Analytics Dashboard',
      desc: 'Real-time today\'s gross sales, total orders, average order value, top-selling products, and sales-by-hour chart. All calculated automatically — no spreadsheet needed.',
    },
    {
      icon: '👥', title: 'User & Role Management',
      desc: 'Create Staff accounts (cashiers, kitchen) and Super Admin accounts. Each role sees only what they need. Sensitive financial reports, accounting, and user management are locked to Super Admin.',
    },
    {
      icon: '🖨️', title: 'Receipt Printing',
      desc: 'On-screen thermal receipt preview for every order showing itemised breakdown, payment method, cashier name, and NON-VAT REGISTERED footer as required by BIR. Print-ready format.',
    },
    {
      icon: '📁', title: 'End-of-Day History & X-Reading',
      desc: 'Every day\'s orders are archived at midnight. Run an X-Reading any time to get a mid-shift snapshot. Full order history searchable by date, cashier, payment method, and fulfillment type.',
    },
  ];

  caps.forEach(cap => {
    if (y > 680) { doc.addPage(); addPageHeader(doc, 'SECTION 2', 'Continued'); y = 50; }
    doc.rect(lm(doc), y, usableW(doc), 14).fill(C.brandDark);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.white).text(`${cap.title}`, lm(doc) + 10, y + 3, { lineBreak: false });
    y += 14;
    doc.fontSize(8.5).font('Helvetica').fillColor(C.ink)
       .text(cap.desc, lm(doc) + 10, y + 4, { width: usableW(doc) - 16 });
    y = doc.y + 10;
  });

  // ── PAGE: VERSION HISTORY ─────────────────────────────────────────────────
  doc.addPage();
  addPageHeader(doc, 'SECTION 3', 'Version History');
  y = 50;

  doc.fontSize(9).font('Helvetica').fillColor(C.muted)
     .text('Each version represents a shipped milestone. Features are cumulative — each release includes everything from prior versions.',
     lm(doc), y, { width: usableW(doc) });
  y = doc.y + 14;

  const versions = [
    {
      ver: 'v0.2', date: 'Early 2026', badge: 'Foundation', color: C.muted,
      items: [
        'First working version — menu browsing and basic ordering flow',
        'QR code generation for tables',
        'MongoDB schema: Products, Orders, Categories',
        'JWT login for admin users',
        'Basic order status tracking (Pending → Ready → Completed)',
      ],
    },
    {
      ver: 'v0.45–v0.48', date: 'Early 2026', badge: 'Core POS', color: C.blue,
      items: [
        'Full POS cashier interface with product catalog',
        'Add-ons / modifiers per product',
        'Multiple payment methods (Cash, GCash, Maya, Bank Transfer)',
        'Discount system (flat ₱ and percentage)',
        'Inventory schema with stock tracking and restock flow',
        'StockCard audit trail for every stock movement',
        'Socket.io real-time order updates across devices',
        'First accounting journal entries wired to order completion',
      ],
    },
    {
      ver: 'v0.5', date: 'Early 2026', badge: 'Accounting', color: C.accent,
      items: [
        'Double-entry journal ledger visible to admin',
        'COGS calculation on every completed order (cost of goods consumed)',
        'Void order workflow with full accounting reversal',
        'Complimentary order type (free / staff meal) with cost-only journal',
        'End-of-Day archiving — orders roll over at midnight',
        'Analytics dashboard: gross sales, order count, avg. value',
      ],
    },
    {
      ver: 'v0.55', date: 'Early 2026', badge: 'Staff & Shifts', color: C.brand,
      items: [
        'Shift start / end flow with Starting Cash input',
        'End-of-Shift reconciliation modal (Expected vs. Actual cash)',
        'Shift variance recorded in history',
        'Role-based access: Staff sees POS only; Super Admin sees everything',
        'RBAC lock indicators on restricted tabs',
        'Partial delivery state for kitchen — "Give Partial – More Items Coming"',
      ],
    },
    {
      ver: 'v0.6–v0.7', date: 'Early 2026', badge: 'Security', color: C.danger,
      items: [
        'Rate limiting on login (prevent brute force) and order creation',
        'JWT secret no longer has a hardcode fallback — requires env var',
        'Cashier identity read from login token, not from form input (prevents impersonation)',
        'Void order restricted to Super Admin only',
        'Inventory edit route locked to Super Admin',
        'CRITICAL: privilege escalation fix — staff could no longer change admin passwords',
        'Removed dead PIN code and secret token from frontend bundle',
        'Inventory history endpoints now require login',
      ],
    },
    {
      ver: 'v0.9', date: 'Early 2026', badge: 'Production Ready', color: C.ok,
      items: [
        'Docker containers for server and frontend — one-command deploy',
        'GitHub Actions CI: automated build + test checks on every commit',
        'Structured JSON logging (pino) — production-grade log output',
        'MongoDB aggregation pipeline for finance balances (memory-safe at scale)',
        'P&L Statement and Balance Sheet reports added to Ledger tab',
        'A/R Outstanding: track e-wallet and delivery payments awaiting settlement',
        'Expense entry system with categorised journal posting',
        'Chart of Accounts — canonical account numbering (1xxx–6xxx)',
        '75 automated tests passing',
        'DEPLOY.md runbook + Makefile for operator convenience',
      ],
    },
    {
      ver: 'v1.0', date: 'May 2026', badge: 'Enterprise Features', color: C.accent,
      items: [
        'Delivery & dispatch pipeline: address, phone, fee, scheduled time',
        'Fulfillment modes: Dine-In, Takeout, Pickup, Manual Delivery, Grab, Foodpanda',
        'Waste / Spoilage logging with enforced reason and automatic accounting',
        'Expiry date tracking per inventory item with color-coded warning badges',
        'FEFO (First-Expiry-First-Out) batch consumption — oldest stock used first',
        'Multi-batch inventory — track multiple deliveries of same ingredient separately',
        'Excel / CSV stock-take import with diff preview (NEW / INCREASE / DECREASE)',
        'Display units: operators always see kg, L, pcs — never raw grams/ml',
        'Low-stock alert badges on sidebar and inventory rows',
        'Shift history archive sub-tab + X-Reading mid-shift PDF',
        'E-Wallet + Bank payments post to Accounts Receivable until settled',
        'NON-VAT REGISTERED badge on sidebar and all receipts',
        'Navigation renamed for clarity',
      ],
    },
    {
      ver: 'v1.1', date: 'May 30, 2026', badge: 'Current', color: C.brand,
      items: [
        'Excel format simplified: Code, Product, Qty Unit, Unit Cost, Expiry date',
        'Smart product-name parsing: "Milk 1L" → item=Milk, unit hint=L',
        'FORCED display rule: only kg / L / pcs shown to operators everywhere',
        'Procurement and Edit modals: g/ml removed from unit dropdown',
        'EOD audit table fully shows display units (kg/L) for physical counts',
        'SRP field removed from inventory (not used in Non-VAT pricing model)',
        'Vitest test suite: 75/75 passing',
        'Server syntax check and client build: both clean',
      ],
    },
  ];

  versions.forEach(v => {
    if (y > 660) { doc.addPage(); addPageHeader(doc, 'SECTION 3', 'Version History Continued'); y = 50; }
    y = versionRow(doc, v.ver, v.date, v.badge, v.color, v.items, lm(doc), y);
    y += 4;
  });

  // ── PAGE: PROS & CONS ─────────────────────────────────────────────────────
  doc.addPage();
  addPageHeader(doc, 'SECTION 4', 'Pros & Cons');
  y = 50;

  const proColW = (usableW(doc) - 12) / 2;

  // PROS header
  doc.rect(lm(doc), y, proColW, 20).fill(C.ok);
  doc.fontSize(9).font('Helvetica-Bold').fillColor(C.white).text('STRENGTHS / PROS', lm(doc) + 10, y + 5, { lineBreak: false });

  // CONS header
  const cx2 = lm(doc) + proColW + 12;
  doc.rect(cx2, y, proColW, 20).fill(C.danger);
  doc.fontSize(9).font('Helvetica-Bold').fillColor(C.white).text('LIMITATIONS / CONS', cx2 + 10, y + 5, { lineBreak: false });
  y += 26;

  const pros = [
    'No monthly subscription fee — one-time deployment',
    'Works on any tablet, laptop, or desktop browser',
    'Real double-entry accounting built-in — no separate bookkeeping app needed',
    'Non-VAT compliant from day one — receipts and reports match BIR requirements',
    'QR self-ordering reduces staff workload and order errors',
    'FEFO batch tracking protects product quality and reduces spoilage cost',
    'Full audit trail on every transaction — nothing can be silently changed',
    'Role-based access — cashiers cannot see accounting or void sales',
    'Automated inventory deduction on every sale — no manual counting needed',
    'E-wallet and delivery payments properly tracked as receivables until verified',
    'Docker containers — runs on ₱200/mo cloud server or local hardware',
    'Open architecture — can be customised for any F&B brand',
    '75 automated tests protect against regressions when updating',
    'Export to CSV/Excel for your accountant or BIR submissions',
  ];

  const cons = [
    'Requires stable internet or LAN — no offline mode',
    'AdminDashboard is a single large file (~4,800 lines) — harder to maintain long-term',
    'Multi-branch / multi-tenant not yet supported (single café per deployment)',
    'Analytics runs on the browser — may slow on very old devices with large data',
    'No mobile app (iOS/Android) — browser-only, though it works on mobile browsers',
    'No integrated payment terminal (GCash/Maya confirmations are manual)',
    'Printing requires browser print dialog — no direct thermal printer driver',
    'No web push notifications — staff must keep browser open to see new orders',
    'Setup requires technical knowledge (server deployment, MongoDB, environment variables)',
    'No built-in loyalty / rewards programme',
    'Multi-user real-time sync uses global socket rooms (acceptable now, needs rooms at scale)',
  ];

  const maxRows = Math.max(pros.length, cons.length);
  let lyPro = y, lyCon = y;
  for (let i = 0; i < maxRows; i++) {
    if (pros[i]) lyPro = proConRow(doc, '+', pros[i], lm(doc), lyPro);
    if (cons[i]) lyCon = proConRow(doc, '-', cons[i], cx2, lyCon);
    if (Math.max(lyPro, lyCon) > 710) {
      doc.addPage(); addPageHeader(doc, 'SECTION 4', 'Pros & Cons Continued'); y = 50; lyPro = 50; lyCon = 50;
    }
  }
  y = Math.max(lyPro, lyCon) + 16;

  // ── BACK COVER ────────────────────────────────────────────────────────────
  doc.addPage();
  doc.rect(0, 0, pageW(doc), 595).fill(C.ink);
  doc.rect(0, 0, 6, 595).fill(C.brand);
  doc.fontSize(18).font('Helvetica-Bold').fillColor(C.white)
     .text('Ready to get started?', 66, 200, { width: 460 });
  doc.fontSize(10).font('Helvetica').fillColor(C.muted).text(
    'Reach out to discuss onboarding, deployment, and pricing for your café.',
    66, 232, { width: 420 }
  );
  doc.fontSize(9).font('Helvetica-Bold').fillColor(C.brandLight).text('s3mivra@gmail.com', 66, 270);
  doc.rect(0, 570, pageW(doc), 25).fill(C.brandDark);
  doc.fontSize(7).font('Helvetica').fillColor(C.brandLight)
     .text('Semivra Negotium & Libellus · © 2026 · CONFIDENTIAL', 0, 579, { align: 'center', lineBreak: false });

  doc.end();
  console.log('✓ Report 1 written:', file);
}

// ═══════════════════════════════════════════════════════════════════════════
//  REPORT 2 — Current Issues / Punch List
// ═══════════════════════════════════════════════════════════════════════════
function buildReport2() {
  const doc = newDoc();
  const file = path.join(OUT_DIR, 'Semivra_Libellus_Issues_Report.pdf');
  doc.pipe(fs.createWriteStream(file));

  // ── COVER ─────────────────────────────────────────────────────────────────
  doc.rect(0, 0, pageW(doc), 595).fill(C.ink);
  doc.rect(0, 0, 6, 595).fill(C.danger);
  doc.fontSize(36).font('Helvetica-Bold').fillColor(C.danger).text('Issues &', 66, 100);
  doc.fontSize(36).font('Helvetica-Bold').fillColor(C.white).text('Pending Work', 66, 140);
  doc.fontSize(12).font('Helvetica').fillColor(C.muted).text('Semivra Libellus POS — v1.1 Open Items', 66, 185);
  doc.moveTo(66, 205).lineTo(520, 205).strokeColor(C.danger).lineWidth(1).stroke();
  doc.fontSize(9).font('Helvetica').fillColor(C.muted).text('Prepared for internal review. Non-technical summary of what remains to be done before the system can be considered feature-complete for Kasa Lokal and future clients.', 66, 215, { width: 450 });

  const infoY = 290;
  [
    ['Document Type', 'Open Issues & Pending Feature Report'],
    ['System Version', 'v1.1 (May 30, 2026)'],
    ['Status',         '~85% complete — see sections below'],
    ['Prepared by',    's3mivra · s3mivra@gmail.com'],
  ].forEach(([k, v], i) => {
    const yy = infoY + i * 26;
    doc.fontSize(7).font('Helvetica').fillColor(C.muted).text(k.toUpperCase(), 66, yy);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.white).text(v, 220, yy);
    doc.moveTo(66, yy + 16).lineTo(500, yy + 16).strokeColor('#2A2A2A').lineWidth(0.4).stroke();
  });

  doc.rect(0, 570, pageW(doc), 25).fill('#3B0000');
  doc.fontSize(7).font('Helvetica').fillColor('#FF9999')
     .text('INTERNAL DOCUMENT — NOT FOR EXTERNAL DISTRIBUTION', 0, 579, { align: 'center', lineBreak: false });

  // ── OVERVIEW PAGE ─────────────────────────────────────────────────────────
  doc.addPage();
  addPageHeader(doc, 'ISSUES OVERVIEW', 'Summary of open items as of v1.1');
  let y = 50;

  // KPI boxes
  const kpis = [
    { label: 'CRITICAL', value: '0', unit: 'blocking issues', color: C.ok },
    { label: 'HIGH PRIORITY', value: '3', unit: 'should fix before launch', color: C.danger },
    { label: 'MEDIUM', value: '6', unit: 'important improvements', color: C.warn },
    { label: 'LOW / FUTURE', value: '5', unit: 'nice to have', color: C.muted },
  ];
  const kpW = (usableW(doc) - 12) / 4;
  kpis.forEach((k, i) => {
    kpiBox(doc, k.label, k.value, k.unit, lm(doc) + i * (kpW + 4), y, kpW, k.color);
  });
  y += 62;

  doc.fontSize(8.5).font('Helvetica').fillColor(C.ink).text(
    'The system is fully operational and has been tested. The issues listed in this report do not prevent the POS from being used daily — they represent missing features, code quality concerns, and improvements planned for future versions.',
    lm(doc), y, { width: usableW(doc) }
  );
  y = doc.y + 14;

  // ── HIGH PRIORITY ISSUES ──────────────────────────────────────────────────
  y = sectionHeader(doc, '🔴  HIGH PRIORITY — Should Fix Before Full Client Launch', y);

  const highPriority = [
    {
      id: 'H-01',
      title: 'Admin Dashboard is a single 4,825-line file',
      type: 'Maintenance Risk',
      detail: 'The entire POS interface (orders, inventory, accounting, analytics, settings) is written in one massive file called AdminDashboard.jsx. While it works perfectly right now, this makes it very hard to make changes safely — a fix in one area can accidentally break something in another area. It also makes future feature development slower.\n\nImpact on you: Risk of new bugs being introduced when we update or customise your system. Fixing this requires splitting the file into smaller organised parts — estimated 3–5 days of engineering work.\n\nStatus: Deferred (too high-risk to do mid-sprint). Planned for v1.2.',
    },
    {
      id: 'H-02',
      title: 'No offline / low-connectivity fallback',
      type: 'Operational Risk',
      detail: 'If the internet connection drops while the POS is being used, the cashier cannot submit new orders or save data. There is no "work offline and sync later" mode. This is a real risk in areas with unstable internet (common in PH telco environments).\n\nImpact on you: If internet drops during peak hours, orders cannot be processed digitally. Operators must fall back to manual recording.\n\nMitigation today: Deploy on a local LAN router so the POS server runs inside the store network — internet is only needed for backups. Full offline mode is a significant engineering effort (estimated 2–3 weeks).',
    },
    {
      id: 'H-03',
      title: 'No direct thermal printer integration',
      type: 'Operational Gap',
      detail: 'Receipts and kitchen tickets are displayed on screen and printed using the browser\'s built-in print function. This means: (1) staff must click "Print" and deal with the print dialog every time, (2) there is no auto-print on order confirmation, and (3) no kitchen display system (KDS) printer integration.\n\nImpact on you: Slower checkout and kitchen workflow compared to systems with direct thermal printer drivers.\n\nFix path: Integrate with a Bluetooth or USB thermal printer library, or implement a local print server. Estimated 1–2 weeks of development.',
    },
  ];

  highPriority.forEach(issue => {
    if (y > 640) { doc.addPage(); addPageHeader(doc, 'HIGH PRIORITY ISSUES', 'Continued'); y = 50; }
    // ID pill
    doc.roundedRect(lm(doc), y, 36, 16, 3).fill(C.danger);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.white).text(issue.id, lm(doc) + 5, y + 4, { lineBreak: false });
    // type tag
    doc.roundedRect(lm(doc) + 42, y + 1, 100, 14, 3).fill('#FEE2E2');
    doc.fontSize(7).font('Helvetica').fillColor(C.danger).text(issue.type, lm(doc) + 47, y + 4, { lineBreak: false });
    // title
    doc.fontSize(10).font('Helvetica-Bold').fillColor(C.ink).text(issue.title, lm(doc) + 150, y + 2, { lineBreak: false, width: usableW(doc) - 150 });
    y += 22;
    doc.rect(lm(doc), y, usableW(doc), 0.5).fill(C.lineGrey);
    y += 6;
    doc.fontSize(8.5).font('Helvetica').fillColor(C.ink).text(issue.detail, lm(doc) + 4, y, { width: usableW(doc) - 8 });
    y = doc.y + 14;
  });

  // ── MEDIUM PRIORITY ───────────────────────────────────────────────────────
  doc.addPage();
  addPageHeader(doc, 'MEDIUM PRIORITY ISSUES', 'Important improvements for stability and growth');
  y = 50;

  y = sectionHeader(doc, '🟡  MEDIUM PRIORITY — Important Improvements', y);

  const medium = [
    {
      id: 'M-01',
      title: 'Analytics runs entirely on the device (client-side)',
      detail: 'All charts and daily summary calculations happen inside the browser using all the orders loaded from the server. For small data sets this is fine, but as months of data accumulate (e.g. 10,000+ orders), the browser may slow down or freeze on older devices like the Amazon Fire tablet.\n\nFix: Move heavy analytics calculations to the server so the browser only receives pre-computed numbers.',
    },
    {
      id: 'M-02',
      title: 'Multi-branch support not available',
      detail: 'The system is designed for one cafe per deployment. If you open a second branch, you would need a completely separate installation with a separate database — there is no way to see combined reports across both branches from one screen.\n\nFix: Add a "brand" or "branch" layer to the data model. Significant engineering effort — estimated 2–4 weeks.',
    },
    {
      id: 'M-03',
      title: 'All connected devices receive all real-time events',
      detail: 'When an order is updated, every device logged in (cashier, kitchen, manager) receives the notification — even if that update does not apply to them. This is fine for 1–3 devices but becomes network-inefficient at larger scale.\n\nFix: Implement Socket.io rooms so kitchen devices only get kitchen events, cashier gets cashier events, etc. Low impact today — scheduled for when scale requires it.',
    },
    {
      id: 'M-04',
      title: 'No push notifications — staff must keep browser open',
      detail: 'When a new order comes in from the QR menu, there is no sound, vibration, or pop-up notification unless the browser tab is already open and visible. Staff must actively monitor the screen.\n\nFix: Implement Web Push Notifications and/or an audible alert sound. Estimated 3–5 days.',
    },
    {
      id: 'M-05',
      title: 'Existing Super Admin accounts from old installs may lack role field',
      detail: 'Very old accounts created before the role field was added to the database may not have a proper role value stored. A startup script runs to fix this automatically, but if that script is skipped or fails silently, those accounts may not have full superadmin access.\n\nFix: Add a one-time database migration to ensure all legacy superadmin accounts are correctly tagged.',
    },
    {
      id: 'M-06',
      title: 'No built-in loyalty / rewards programme',
      detail: 'There is no customer loyalty tracking — no points system, no stamp card, no repeat customer discounts. Discounts can be applied manually, but there is no automated rewards logic.\n\nFix: Add a customer profile model with points tracking. Medium-complexity feature — estimated 1–2 weeks.',
    },
  ];

  medium.forEach(issue => {
    if (y > 650) { doc.addPage(); addPageHeader(doc, 'MEDIUM PRIORITY ISSUES', 'Continued'); y = 50; }
    doc.roundedRect(lm(doc), y, 36, 16, 3).fill(C.warn);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.white).text(issue.id, lm(doc) + 5, y + 4, { lineBreak: false });
    doc.fontSize(10).font('Helvetica-Bold').fillColor(C.ink).text(issue.title, lm(doc) + 44, y + 2, { lineBreak: false, width: usableW(doc) - 48 });
    y += 22;
    doc.rect(lm(doc), y, usableW(doc), 0.5).fill(C.lineGrey);
    y += 5;
    doc.fontSize(8.5).font('Helvetica').fillColor(C.ink).text(issue.detail, lm(doc) + 4, y, { width: usableW(doc) - 8 });
    y = doc.y + 12;
  });

  // ── LOW / FUTURE ──────────────────────────────────────────────────────────
  doc.addPage();
  addPageHeader(doc, 'LOW PRIORITY / FUTURE FEATURES', 'Nice-to-have items for future versions');
  y = 50;

  y = sectionHeader(doc, '⚪  LOW / FUTURE — Nice to Have', y);

  const low = [
    {
      id: 'L-01',
      title: 'No dedicated mobile app (iOS / Android)',
      detail: 'The system runs in a browser and works on mobile browsers, but there is no native app available on the App Store or Google Play. A native app would allow push notifications, offline mode, and a better touchscreen experience on phones.',
    },
    {
      id: 'L-02',
      title: 'Payment terminal integration (direct GCash / Maya tap)',
      detail: 'Currently the cashier manually selects the payment method after the customer pays. There is no integration with a physical card reader or e-wallet terminal that would auto-confirm the payment. This is a hardware/API integration project.',
    },
    {
      id: 'L-03',
      title: 'Kitchen Display System (KDS) screen',
      detail: 'A dedicated kitchen screen showing only pending orders, with sound alerts and one-tap order progression, would improve kitchen efficiency. Currently kitchen staff check the same screen as the cashier.',
    },
    {
      id: 'L-04',
      title: 'Supplier management and purchase orders',
      detail: 'There is no supplier address book or formal purchase order workflow. Restocking is manual. A future version could track supplier details, auto-generate purchase orders when stock is low, and receive against PO.',
    },
    {
      id: 'L-05',
      title: 'Customer-facing display (second screen)',
      detail: 'A customer-facing screen showing the order total and itemised breakdown during checkout (like a second monitor at a checkout counter) is not yet implemented. This is a common request for larger café setups.',
    },
  ];

  low.forEach(issue => {
    if (y > 660) { doc.addPage(); addPageHeader(doc, 'LOW PRIORITY', 'Continued'); y = 50; }
    doc.roundedRect(lm(doc), y, 36, 16, 3).fill(C.muted);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.white).text(issue.id, lm(doc) + 5, y + 4, { lineBreak: false });
    doc.fontSize(10).font('Helvetica-Bold').fillColor(C.ink).text(issue.title, lm(doc) + 44, y + 2, { lineBreak: false, width: usableW(doc) - 48 });
    y += 22;
    doc.rect(lm(doc), y, usableW(doc), 0.5).fill(C.lineGrey);
    y += 5;
    doc.fontSize(8.5).font('Helvetica').fillColor(C.ink).text(issue.detail, lm(doc) + 4, y, { width: usableW(doc) - 8 });
    y = doc.y + 12;
  });

  // ── WHAT IS WORKING ───────────────────────────────────────────────────────
  doc.addPage();
  addPageHeader(doc, 'WHAT IS WORKING', 'All verified-stable features as of v1.1');
  y = 50;

  y = sectionHeader(doc, '✅  Fully Working & Tested', y);

  const working = [
    'POS cashier interface — product search, add-ons, discounts, payment, receipt',
    'QR dine-in self-ordering — customer menu → kitchen queue',
    'Dine-In, Takeout, Pickup, Manual Delivery, Grab, Foodpanda fulfillment modes',
    'Dispatch pipeline: Preparing → Out for Delivery → Delivered',
    'Delivery address, phone, fee, and scheduled time capture',
    'Shift start (with starting cash) and end-of-shift reconciliation',
    'Shift history archive — full cashier ledger',
    'X-Reading mid-shift PDF generation',
    'Real double-entry accounting on every transaction',
    'Accounts Receivable for e-wallet and delivery payments',
    'P&L Statement with date range picker',
    'Balance Sheet (auto-calculated, balanced-check included)',
    'Expense entry with categories and journal posting',
    'Inventory FEFO batch tracking across multiple deliveries',
    'Expiry date monitoring with colour-coded badges',
    'Low-stock alerts on sidebar and inventory rows',
    'Spoilage / waste logging with automatic accounting entries',
    'Excel / CSV stock-take import with diff preview',
    'EOD physical count audit with display units (kg / L / pcs)',
    'Role-based access: Staff vs Super Admin',
    'Rate limiting on login (brute-force protection)',
    'Atomic inventory deduction — no double-counting on busy periods',
    'NON-VAT receipts — correct format for BIR-registered non-VAT businesses',
    'Docker containers for easy cloud deployment',
    'GitHub Actions CI — automated tests on every code change',
    '75 automated tests covering accounting logic, unit conversions, and batch math',
  ];

  working.forEach(item => {
    if (y > 700) { doc.addPage(); addPageHeader(doc, 'WHAT IS WORKING', 'Continued'); y = 50; }
    y = bullet(doc, item, lm(doc), y, 10, C.ok);
  });

  y += 12;
  // Summary box
  if (y > 680) { doc.addPage(); y = 50; }
  doc.rect(lm(doc), y, usableW(doc), 50).fill(C.tagBg);
  doc.rect(lm(doc), y, 3, 50).fill(C.brand);
  doc.fontSize(9).font('Helvetica-Bold').fillColor(C.brandDark).text('Bottom line', lm(doc) + 10, y + 8);
  doc.fontSize(8.5).font('Helvetica').fillColor(C.ink).text(
    'The system is ready for daily operations. The open items listed in this report are improvements and future growth features — not blockers. A business opening today with Semivra Libellus has a fully functional POS, real accounting records, and proper Non-VAT receipts from day one.',
    lm(doc) + 10, y + 22, { width: usableW(doc) - 16 }
  );

  // back cover
  doc.addPage();
  doc.rect(0, 0, pageW(doc), 595).fill(C.ink);
  doc.rect(0, 0, 6, 595).fill(C.danger);
  doc.fontSize(14).font('Helvetica-Bold').fillColor(C.white).text('Questions about these issues?', 66, 220, { width: 450 });
  doc.fontSize(10).font('Helvetica').fillColor(C.muted).text('Reach out to discuss timelines, priorities, and what to tackle first.', 66, 248, { width: 420 });
  doc.fontSize(9).font('Helvetica-Bold').fillColor(C.brandLight).text('s3mivra@gmail.com', 66, 286);
  doc.rect(0, 570, pageW(doc), 25).fill('#3B0000');
  doc.fontSize(7).font('Helvetica').fillColor('#FF9999')
     .text('Semivra Negotium & Libellus · Issues Report v1.1 · INTERNAL DOCUMENT', 0, 579, { align: 'center', lineBreak: false });

  doc.end();
  console.log('✓ Report 2 written:', file);
}

buildReport1();
buildReport2();
