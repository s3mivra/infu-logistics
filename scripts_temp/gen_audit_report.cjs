// Professional Production-Readiness Audit -> PDF (pdfkit). COMPREHENSIVE edition.
// Continuous-flow layout (no forced per-section page breaks => no near-empty pages).
// Cover + TOC (page numbers) + color-coded severity + tables + bar charts.
// Built-in blank-page self-check using pdfkit's own page tracking.
// Usage: node scripts_temp/gen_audit_report.cjs <out.pdf>
const PDFDocument = require('./node_modules/pdfkit');
const fs = require('fs');

const OUT = process.argv[2] || 'Semivra_Production_Readiness_Audit.pdf';

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  ink: '#1F2933', body: '#33414E', muted: '#6B7785', faint: '#9AA5B1',
  navy: '#16324F', teal: '#0E7C86',
  line: '#D7DEE4', zebra: '#F4F8FA', cardBg: '#F1F5F8',
  crit: '#9B1C1C', high: '#DC2626', med: '#C77700', low: '#2563EB',
  ok: '#15803D', white: '#FFFFFF', barTrack: '#E3EAEF',
};
const sevColor = (s) => ({ CRITICAL: C.crit, HIGH: C.high, MEDIUM: C.med, LOW: C.low, INFO: C.teal, GOOD: C.ok, PASS: C.ok, PARTIAL: C.med, MISSING: C.high }[s] || C.muted);
const scoreColor = (n) => (n >= 80 ? C.ok : n >= 60 ? C.med : C.high);

const TR = [
  [/[₱]/g, 'PHP '], [/[→➔▶]/g, '->'], [/[←]/g, '<-'], [/[—–]/g, '-'],
  [/[•]/g, '-'], [/[…]/g, '...'], [/[‘’]/g, "'"], [/[“”]/g, '"'],
  [/[✓✔]/g, 'OK'], [/[≥]/g, '>='], [/[≤]/g, '<='], [/[≠]/g, '!='], [/[×]/g, 'x'],
];
const tr = (s) => { let t = String(s == null ? '' : s); for (const [re, v] of TR) t = t.replace(re, v); return t.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ''); };

const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 54, right: 54 }, bufferPages: true,
  info: { Title: 'Semivra Libellus POS - Production Readiness Audit', Author: 'Independent Audit (Claude Code)', Subject: 'Complete Software Audit & Deployment Readiness Review' } });
doc.pipe(fs.createWriteStream(OUT));

const ML = doc.page.margins.left;
const uW = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const top = () => doc.page.margins.top;
const bottom = () => doc.page.height - doc.page.margins.bottom;
const curIdx = () => doc.bufferedPageRange().count - 1;     // 0-based current page
const curPageNum = () => doc.bufferedPageRange().count;     // 1-based displayed number

// content-page tracking for the blank-page self-check
const contentPages = new Set();
const touch = () => contentPages.add(curIdx());
const newPage = () => { doc.addPage(); };
const need = (h) => { if (doc.y + h > bottom()) newPage(); };

// ── Rich text ────────────────────────────────────────────────────────────────
const runsOf = (text) => String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p) => {
  if (/^\*\*[\s\S]+\*\*$/.test(p)) return { t: p.slice(2, -2), f: 'Helvetica-Bold', c: null };
  if (/^`[^`]+`$/.test(p)) return { t: p.slice(1, -1), f: 'Courier', c: C.navy };
  return { t: p, f: 'Helvetica', c: null };
});
function flow(text, { size = 9.3, color = C.body, indent = 0, gap = 5, lead = '', leadColor = C.teal } = {}) {
  const width = uW() - indent;
  need(doc.font('Helvetica').fontSize(size).heightOfString(tr(String(text).replace(/\*\*/g, '')), { width }) + gap + 2);
  touch();
  doc.x = ML + indent;
  if (lead) doc.font('Helvetica-Bold').fontSize(size).fillColor(leadColor).text(tr(lead), { continued: true, width });
  runsOf(text).forEach((r, i, a) => doc.font(r.f).fontSize(size).fillColor(r.c || color).text(tr(r.t), { continued: i < a.length - 1, width, lineGap: 1.6 }));
  doc.x = ML; doc.y += gap; touch();
}
const para = (t, o = {}) => flow(t, { gap: 6, ...o });
const bullet = (t, indent = 12) => flow(t, { indent, gap: 3.4, lead: '-  ' });
const sub = (t) => flow(t, { indent: 24, gap: 3, lead: '.  ', size: 9 });

// ── Headings (continuous flow; record TOC anchor on H1) ───────────────────────
const toc = [];
function h1(text) {
  doc.y += 16; need(64); doc.x = ML;
  doc.save().rect(ML, doc.y, 5, 21).fill(C.teal).restore();
  doc.font('Helvetica-Bold').fontSize(16.5).fillColor(C.navy).text(tr(text), ML + 13, doc.y + 1.5, { width: uW() - 13 });
  doc.moveTo(ML, doc.y + 5).lineTo(ML + uW(), doc.y + 5).lineWidth(1).strokeColor(C.line).stroke();
  doc.y += 16; doc.x = ML; touch();
  toc.push({ title: text, page: curPageNum() });
}
function h2(t) { doc.y += 7; need(38); doc.x = ML; doc.font('Helvetica-Bold').fontSize(12).fillColor(C.teal).text(tr(t), { width: uW() }); doc.y += 5; doc.x = ML; touch(); }
function h3(t) { doc.y += 4; need(26); doc.x = ML; doc.font('Helvetica-Bold').fontSize(10.3).fillColor(C.ink).text(tr(t), { width: uW() }); doc.y += 3; doc.x = ML; touch(); }

// ── Severity badge + structured finding ───────────────────────────────────────
function badge(label, color, x, y) {
  const w = doc.font('Helvetica-Bold').fontSize(7.3).widthOfString(label) + 11;
  doc.save().roundedRect(x, y, w, 12.5, 3).fill(color).restore();
  doc.font('Helvetica-Bold').fontSize(7.3).fillColor(C.white).text(label, x + 5.5, y + 3.2, { lineBreak: false });
  return w;
}
function findingF(sev, title, fields) {
  need(50); touch();
  const y0 = doc.y;
  const bw = badge(sev, sevColor(sev), ML, y0 + 0.5);
  doc.font('Helvetica-Bold').fontSize(9.8).fillColor(C.ink).text(tr(title), ML + bw + 7, y0 + 1, { width: uW() - bw - 7 });
  doc.x = ML; doc.y = Math.max(doc.y, y0 + 14) + 2.5;
  for (const [k, v] of fields) flow(v, { size: 8.9, indent: 8, gap: 2.4, lead: k + ': ', leadColor: C.navy });
  doc.y += 6; doc.x = ML; touch();
}

// ── Table ────────────────────────────────────────────────────────────────────
function table(header, rows, weights) {
  const w = uW(), pad = 5.5;
  weights = weights || header.map((_, i) => (i === 0 ? 1.4 : 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map((x) => (x / wsum) * w);
  const rowH = (cells, font, size) => Math.max(12, ...cells.map((c, i) =>
    doc.font(font).fontSize(size).heightOfString(tr(String(c).replace(/\*\*/g, '')) || ' ', { width: colW[i] - pad * 2 }))) + pad * 1.6;
  const draw = (cells, isHead, zebra) => {
    const font = isHead ? 'Helvetica-Bold' : 'Helvetica', size = 8.3;
    const h = rowH(cells, font, size);
    if (doc.y + h > bottom()) newPage();
    touch();
    const y0 = doc.y;
    if (isHead) doc.save().rect(ML, y0, w, h).fill(C.navy).restore();
    else if (zebra) doc.save().rect(ML, y0, w, h).fill(C.zebra).restore();
    let x = ML;
    cells.forEach((c, i) => {
      let col = isHead ? C.white : C.body;
      const raw = String(c); const sm = raw.match(/^(CRITICAL|HIGH|MEDIUM|LOW|GOOD|INFO|PASS|PARTIAL|MISSING)\b/);
      if (!isHead && sm) col = sevColor(sm[1]);
      doc.font(font).fontSize(size).fillColor(col).text(tr(raw.replace(/\*\*/g, '')), x + pad, y0 + pad, { width: colW[i] - pad * 2 });
      x += colW[i];
    });
    doc.save().lineWidth(0.5).strokeColor(C.line).moveTo(ML, y0 + h).lineTo(ML + w, y0 + h).stroke().restore();
    doc.x = ML; doc.y = y0 + h;
  };
  need(46); draw(header, true, false);
  rows.forEach((r, i) => draw(header.map((_, ci) => (r[ci] != null ? r[ci] : '')), false, i % 2 === 1));
  doc.y += 9; doc.x = ML; touch();
}

// ── Bar chart ─────────────────────────────────────────────────────────────────
function barChart(items, { labelW = 128, max = 100, h = 14, gap = 6 } = {}) {
  const chartW = uW() - labelW - 42;
  items.forEach((it) => {
    need(h + gap); touch();
    const y0 = doc.y;
    const bold = /overall/i.test(it.label);
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(bold ? C.navy : C.ink).text(tr(it.label), ML, y0 + 2.3, { width: labelW - 6, lineBreak: false });
    const bx = ML + labelW;
    doc.save().roundedRect(bx, y0, chartW, h, 2.5).fill(C.barTrack).restore();
    doc.save().roundedRect(bx, y0, Math.max(2, (Math.min(it.value, max) / max) * chartW), h, 2.5).fill(scoreColor(it.value)).restore();
    doc.font('Helvetica-Bold').fontSize(8.4).fillColor(C.ink).text(it.value + '%', bx + chartW + 6, y0 + 3, { width: 34, lineBreak: false });
    doc.x = ML; doc.y = y0 + h + gap;
  });
  doc.y += 3; touch();
}

// ── Stacked severity bar ──────────────────────────────────────────────────────
function severityBar(counts) {
  const order = [['CRITICAL', counts.CRITICAL || 0], ['HIGH', counts.HIGH || 0], ['MEDIUM', counts.MEDIUM || 0], ['LOW', counts.LOW || 0]];
  const total = order.reduce((s, [, n]) => s + n, 0) || 1;
  const w = uW(), h = 20; need(h + 26); touch();
  const y0 = doc.y; let x = ML;
  order.forEach(([k, n]) => { if (n <= 0) return; const seg = (n / total) * w; doc.save().rect(x, y0, seg, h).fill(sevColor(k)).restore(); if (seg > 16) doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white).text(String(n), x, y0 + 5.5, { width: seg, align: 'center', lineBreak: false }); x += seg; });
  doc.x = ML; doc.y = y0 + h + 6; let lx = ML;
  order.forEach(([k, n]) => { doc.save().rect(lx, doc.y + 1, 9, 9).fill(sevColor(k)).restore(); doc.font('Helvetica').fontSize(8.3).fillColor(C.body).text(`${k} (${n})`, lx + 12, doc.y + 1.5, { lineBreak: false }); lx += doc.widthOfString(`${k} (${n})`) + 30; });
  doc.y += 17; doc.x = ML; touch();
}

// ── Callout ───────────────────────────────────────────────────────────────────
function callout(title, text, color = C.teal, bg = C.cardBg) {
  const pad = 9, innerW = uW() - pad * 2 - 6;
  const th = doc.font('Helvetica-Bold').fontSize(9.5).heightOfString(tr(title), { width: innerW });
  const bh = doc.font('Helvetica').fontSize(8.9).heightOfString(tr(text), { width: innerW });
  const h = th + bh + pad * 2 + 3; need(h + 6); touch();
  const y0 = doc.y;
  doc.save().rect(ML, y0, uW(), h).fill(bg).restore();
  doc.save().rect(ML, y0, 5, h).fill(color).restore();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(color).text(tr(title), ML + pad + 6, y0 + pad, { width: innerW });
  doc.font('Helvetica').fontSize(8.9).fillColor(C.body).text(tr(text), ML + pad + 6, doc.y + 2, { width: innerW });
  doc.x = ML; doc.y = y0 + h + 9; touch();
}

// =============================================================================
// COVER
// =============================================================================
(function cover() {
  touch();
  doc.save().rect(0, 0, doc.page.width, doc.page.height).fill('#FFFFFF').restore();
  doc.save().rect(0, 0, doc.page.width, 196).fill(C.navy).restore();
  doc.save().rect(0, 196, doc.page.width, 6).fill(C.teal).restore();
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor('#9FC6CC').text('COMPLETE SOFTWARE AUDIT & DEPLOYMENT READINESS REVIEW', 54, 52, { width: doc.page.width - 108, characterSpacing: 0.8 });
  doc.font('Helvetica-Bold').fontSize(30).fillColor(C.white).text('Semivra Libellus', 54, 90, { width: doc.page.width - 108 });
  doc.font('Helvetica').fontSize(14.5).fillColor('#CBD6DD').text('Enterprise POS + ERP - Independent Production-Readiness Audit', 54, 132, { width: doc.page.width - 108 });

  let y = 240;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.muted).text('OVERALL PRODUCTION READINESS', 54, y, { characterSpacing: 0.5 });
  y += 20; const gw = doc.page.width - 108, gh = 25;
  doc.save().roundedRect(54, y, gw, gh, 4).fill(C.barTrack).restore();
  doc.save().roundedRect(54, y, gw * 0.78, gh, 4).fill(C.med).restore();
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white).text('78%', 54 + gw * 0.78 - 42, y + 6, { width: 36, align: 'right' });
  y += gh + 9;
  doc.font('Helvetica').fontSize(9.3).fillColor(C.muted).text('Verdict: RELEASE CANDIDATE - deployable to a single-tenant SMB after 3 must-fix blockers are cleared.', 54, y, { width: gw });

  y += 32;
  const cards = [
    ['304 / 304', 'server tests passing'], ['77.8%', 'server line coverage'], ['139', 'API routes - all RBAC-gated'],
    ['9', 'dependency vulnerabilities'], ['3', 'must-fix deploy blockers'], ['~25.5k', 'lines of application code'],
  ];
  const cw = (gw - 24) / 3, ch = 50;
  cards.forEach((c, i) => {
    const cx = 54 + (i % 3) * (cw + 12), cy = y + Math.floor(i / 3) * (ch + 12);
    doc.save().roundedRect(cx, cy, cw, ch, 5).fill(C.cardBg).restore();
    doc.save().roundedRect(cx, cy, cw, ch, 5).lineWidth(0.6).stroke(C.line).restore();
    doc.font('Helvetica-Bold').fontSize(15.5).fillColor(C.navy).text(c[0], cx + 10, cy + 9, { width: cw - 20 });
    doc.font('Helvetica').fontSize(7.6).fillColor(C.muted).text(c[1].toUpperCase(), cx + 10, cy + 31, { width: cw - 20, characterSpacing: 0.3 });
  });
  y += 2 * (ch + 12) + 16;

  doc.y = y;
  [
    ['Application', 'Semivra Libellus - QR menu / POS / double-entry ERP (dual mode: F&B + Logistics)'],
    ['Stack', 'React 18 + Vite 8 + Tailwind  |  Node/Express 4 + MongoDB (Mongoose 9) + Socket.io'],
    ['Repository', 'Branch pwa-rbac-followups; build clean; 304 tests green; working tree has uncommitted changes'],
    ['Audit date', new Date().toISOString().slice(0, 10) + ' - evidence-based; tests, coverage, build & dependency audits executed'],
    ['Auditor', 'Independent review - Architect / QA / DevOps / Security / Performance / UX'],
    ['Method', 'Full static review + executed: vitest (304), v8 coverage, vite build, npm audit, Playwright e2e (9/9 in real Chromium)'],
  ].forEach(([k, v]) => {
    const yy = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.8).fillColor(C.navy).text(k, 54, yy, { width: 96 });
    doc.font('Helvetica').fontSize(8.8).fillColor(C.body).text(tr(v), 154, yy, { width: doc.page.width - 108 - 100 });
    doc.y = Math.max(doc.y, yy) + 5;
  });

  doc.font('Helvetica-Oblique').fontSize(7.8).fillColor(C.faint)
    .text('Evidence-based report. Every "passing/clean" claim or metric reflects a command actually executed against this repository, or a specific file/line inspected. Items that could not be verified are stated as such.',
      54, doc.page.height - 86, { width: doc.page.width - 108 });
})();

// Reserve TOC page, then begin body on a fresh page.
newPage(); const TOC_PAGE_INDEX = curIdx(); newPage();

// =============================================================================
h1('1. Executive Summary');
para('**Semivra Libellus** is a full-stack, offline-capable Point-of-Sale and back-office ERP for Philippine small businesses, with two modes chosen by a `BUSINESS_TYPE` env flag: **F&B** (QR self-ordering cafe/restaurant) and **Logistics** (client-login ordering with billing statements). It unifies POS, recipe/BOM inventory with FEFO batch expiry, genuine double-entry accounting with BIR-aware Philippine tax, shift/cash-drawer control, and a PWA offline queue into one tablet-first app.');
para('**This is not a prototype.** The backend is genuinely well-engineered: dual-token auth (in-memory access token + httpOnly, server-revocable refresh cookie), Zod boundary validation with mass-assignment defense, Helmet, granular role-based authorization on all 139 routes, MongoDB transactions guarding accounting integrity, balanced-journal assertions, atomic counters/inventory, a production-safe centralized error handler, graceful shutdown, and structured logging. It ships Docker, docker-compose, a CI workflow, backup/restore scripts, and 304 passing server tests.');
callout('Can it be deployed today?  YES - conditionally.',
  'The app builds cleanly, all 304 server tests pass, and the deployment scaffolding (Docker, Vercel/Railway config, /health, graceful shutdown) is in place. Three issues must be fixed BEFORE any real deployment: (1) the live JWT signing secret is weak and reused, (2) high-severity dependency vulnerabilities are unpatched, (3) an unauthenticated endpoint exposes customer PII. None require architectural change; all are fixable in well under a day.', C.med, '#FBF3E6');
h2('Top strengths (verified)');
bullet('**Real double-entry accounting** - every sale/void/spoilage/expense posts a balanced journal entry; an assertion throws if DR != CR; order completion runs inside a MongoDB transaction.');
bullet('**Disciplined authorization** - all 139 routes enumerated; every sensitive route carries `verifyToken` + `requireStaff`/`requireSuperAdmin`; Socket.io decides rooms server-side (no self-elevation).');
bullet('**Mature auth** - access token in memory only (XSS-resistant); refresh token httpOnly, hashed at rest, rotated on use, revoked on logout/password/role change.');
bullet('**Backend test depth** - 304 tests / 20 files incl. fault injection, money math, edge cases; 77.8% line coverage.');
h2('Top weaknesses (verified)');
bullet('**Weak, shared JWT secret** in the live `.env` (`infu-pass-2026`); boot validates presence, not strength.');
bullet('**Unauthenticated `GET /api/orders/:id`** returns customer name, phone, delivery address (IDOR / PII).');
bullet('**Public products endpoint leaks COGS/recipe (BOM)** data to anonymous customers.');
bullet('**9 dependency vulnerabilities** (3 high server / 2 high client - mostly `ws` DoS); CI audit gate is non-blocking.');
bullet('**Maintainability debt** - `server.js` 6,691 lines; `AdminDashboard.jsx` 6,098 lines / 234 useState; no ESLint/Prettier; stale in-repo audit docs contradict current code.');

// =============================================================================
h1('2. Project Overview');
h2('What it is and the problem it solves');
para('Semivra Libellus replaces the "generic POS + manual spreadsheet bookkeeping" workflow of a PH micro/small business with a single system that "closes its own books": each transaction is auto-journalized into a chart of accounts, producing export-ready P&L, Balance Sheet, A/R and percentage-tax reports without re-keying.');
h2('Target users');
bullet('**F&B mode** - cafe / restaurant operators wanting QR self-ordering, kitchen/bar routing, recipe COGS, and cash-drawer control.');
bullet('**Logistics mode** - small trading/logistics operators billing named client accounts with statements, deposits, and partial fulfillment.');
bullet('**Roles** - superadmin (owner), admin/manager, cashier/staff, and authenticated clients (logistics portal).');
h2('Technology, frameworks, libraries, services (verified from package.json + installed)');
table(['Layer', 'Technology (installed version)'], [
  ['Frontend', 'React 18.3.1, Vite 8.0.16, Tailwind 3.4, react-router-dom 6.30, lucide-react 1.17, socket.io-client 4'],
  ['Exports', 'jspdf 4.2.1 + jspdf-autotable 5.0.8, SheetJS xlsx 0.20.3 (CDN tarball), html2canvas, react-qr-code 2.0.21'],
  ['Backend', 'Node 22 / Express 4.22, Mongoose 9.6, Socket.io 4.8.3, jsonwebtoken 9.0.3, bcrypt 6.0'],
  ['Security/infra', 'helmet 8.2, express-rate-limit 8, cookie-parser, cors, zod 4.4, compression'],
  ['Observability', 'pino 10 + pino-http (structured logs); optional @sentry/node 10.56 (inert unless DSN set)'],
  ['Database', 'MongoDB Atlas (cloud); transactions require a replica set - Atlas provides this'],
  ['Testing', 'vitest 4 + @vitest/coverage-v8, mongodb-memory-server, supertest; Playwright (client e2e)'],
  ['Deploy', 'Vercel (SPA) + Railway (API); Docker + docker-compose + nginx for self-host'],
]);

// =============================================================================
h1('3. Architecture Review');
bullet('**SPA + JSON API + WebSocket.** React SPA (lazy-loaded routes) talks to a stateless Express JSON API; Socket.io pushes real-time order/menu updates. The API serves no HTML (CSP intentionally off server-side; belongs on the SPA host).');
bullet('**Pure-logic core, unit-tested.** `server/lib/` holds framework-free modules - `ledger`, `tax`, `units`, `expiry`, `chartOfAccounts`, `authz`, `reportRange` - each with a co-located `*.test.js`. Money and authorization decisions are testable without booting Express/Mongo. This is the single best architectural decision in the codebase.');
bullet('**Layered request pipeline.** helmet -> compression -> CORS -> pino-http -> body parsers -> cookie-parser -> per-route (rate limit -> verifyToken -> requireStaff/SuperAdmin -> Zod validate -> handler -> emit) -> 404 -> centralized error handler.');
bullet('**Single-tenant per deployment.** Data is scoped by a `businessType` field, not true multi-tenancy. A multi-branch rollup would require tenant scoping + Socket.io room partitioning.');
bullet('**Monolithic delivery files.** Nearly all backend logic is in one 6,691-line `server.js`; the admin UI is one 6,098-line component. Functional, but a maintainability/merge-risk liability (see Code Quality).');
h2('Source size map (verified - wc -l)');
table(['File', 'Lines', 'Role'], [
  ['server/server.js', '6,691', 'All routes, schemas, ledger orchestration, sockets'],
  ['client/.../AdminDashboard.jsx', '6,098', 'Admin SPA shell (234 useState, 11 useEffect)'],
  ['client/.../tabs/LedgerTab.jsx', '1,928', 'Accounting UI'],
  ['client/.../tabs/OrdersTab.jsx', '1,277', 'POS / orders UI'],
  ['client/.../pages/CustomerMenu.jsx', '1,043', 'QR customer ordering'],
  ['server/lib/*.js (7 modules)', '~620', 'Pure, fully unit-tested core logic'],
], [1.9, 0.6, 2.0]);

// =============================================================================
h1('4. Version Analysis');
para('Version identifiers disagree across the repo - a finding in itself. There are no git tags.');
table(['Source', 'Declared version'], [
  ['server/package.json, client/package.json', '1.0.0'],
  ['README.md "Version History"', 'v0.2 (ERP & Management Upgrade)'],
  ['Recent git commit subjects', '"new version 0.5", "v.5", "0.9/1.1 fix patch"'],
  ['Git tags', 'none'],
]);
h2('Evolution timeline (from git history + in-repo reports)');
bullet('**v0.1** - Core QR menu + real-time kitchen display (WebSockets), menu builder, basic order lifecycle, manual discount/VAT.');
bullet('**v0.2** - ERP upgrade: double-entry accounting, weighted-average inventory, BOM engine, analytics, CSV export, PWA wake-lock.');
bullet('**Security hardening (PR #1, branch security/hardening-p1-p3)** - Helmet, Zod, bcrypt 10->12, regex-injection fix, centralized error handler, and the **breaking dual-token auth rewrite**.');
bullet('**PWA + RBAC follow-ups (current branch)** - offline POS/clock queue, RBAC void/refund split, responsive sidebar, the logistics (`log`) mode with client portal + billing statements.');
h2('Architecture / dependency / config changes across versions');
bullet('Auth: single localStorage JWT -> dual-token (in-memory access + httpOnly refresh + server revocation).');
bullet('Deps added over time: helmet, zod, cookie-parser, @sentry/node, express-rate-limit, pino; client added Playwright; xlsx swapped from abandoned npm package to patched SheetJS 0.20.3 CDN build; Vite 5 -> 8.');
bullet('Config: introduced `BUSINESS_TYPE`, `ALLOWED_ORIGINS`, `SENTRY_DSN`, billing-statement VITE_* vars; Docker/compose/CI added.');

// =============================================================================
h1('5. Change Log');
h2('Current branch vs origin/main (git diff - committed)');
para('`pwa-rbac-followups` vs `origin/main`: **3 files, +68 / -23** (PricingTab.jsx, AdminDashboard.jsx, server.js).');
h2('Uncommitted working-tree changes (git status / diff - NOT yet committed)');
para('**23 files, +1,855 / -597.** Largest: `server.js` (+585/-), `AdminDashboard.jsx` (~183 lines), all 8 tab components, `index.css`, plus a server dependency bump (1,387-line package-lock churn).');
table(['Category', 'Change'], [
  ['Backend', 'server.js heavily modified (uncommitted); new lib modules authz.js, tax.js, reportRange.js + tests'],
  ['Tests', 'New server/test/ integration suite (15 files) + vitest.config.js'],
  ['Frontend', 'All tab components + AdminDashboard, SuperAdminPanel, CustomerMenu, Client* pages modified'],
  ['Dependencies', 'server/package.json + package-lock churn; root package.json scripts'],
  ['Docs', 'AUDIT_OVERVIEW.md, README.md, SESSION_REPORT.md edited'],
  ['Config', 'No tracked .env (gitignored); CI, Docker, compose present'],
]);
callout('Risk: substantial uncommitted work.',
  'A large body of changes (incl. core server logic and dependencies) lives only in the working tree - unbacked-up, unreviewed, and NOT what CI validated on the branch. Commit to a feature branch and let CI run before relying on it.', C.med, '#FBF3E6');

// =============================================================================
h1('6. Feature Audit');
para('Legend:  GOOD = implemented & evidenced.  PARTIAL = present but caveated.  MISSING = absent/stub.');
table(['Feature', 'Status', 'Evidence / notes'], [
  ['POS register, checkout, split payments', 'GOOD', 'Order POST w/ idempotency key, payments[]; OrdersTab 1,277 LOC'],
  ['QR self-ordering (F&B)', 'GOOD', 'Crypto-random session, time-boxed, single-use "burn" on order'],
  ['Client-login ordering + billing (Logistics)', 'GOOD', 'verifyClientToken gate; client-portal integration test'],
  ['Double-entry GL', 'GOOD', 'Balanced-journal assertion; txn-wrapped; lib/ledger unit-tested'],
  ['PH percentage tax (3%) / VAT modes', 'GOOD', 'lib/tax.js pure + tested; gross-receipts model'],
  ['Inventory: recipe deduction + FEFO expiry', 'GOOD', 'lib/expiry.js FEFO; atomic $inc deduction'],
  ['Excel/CSV import & stock-take', 'GOOD', 'SheetJS 0.20.3; diff-preview; journal-backed'],
  ['Reports: P&L, Balance Sheet, A/R, tax', 'GOOD', 'Mongo aggregation; date-range bounded (max 92d)'],
  ['Shifts / cash drawer / EOD reconcile', 'GOOD', 'shift cash filter; variance report'],
  ['Real-time multi-device sync', 'GOOD', 'Socket.io JWT handshake + server-decided rooms'],
  ['PWA offline order/clock queue', 'GOOD', 'lib/pwa.js + service worker (network-first/SWR)'],
  ['RBAC (superadmin/admin/staff/client)', 'GOOD', 'All 139 routes; void=superadmin, refund=super/admin'],
  ['Revolving/petty cash fund', 'GOOD', 'disburse/replenish/close routes + ledger'],
  ['Push "order ready" notification', 'PARTIAL', 'In-page showNotification only; no VAPID server push'],
  ['Analytics dashboard', 'PARTIAL', 'Works but computed client-side; will not scale to large data'],
  ['Multi-branch / franchise rollup', 'MISSING', 'Single-tenant by businessType field only'],
  ['Loyalty / CRM', 'MISSING', 'Acknowledged roadmap item'],
  ['Hardware printer / cash-drawer (ESC/POS)', 'MISSING', 'Browser print only; no certification'],
], [1.85, 0.6, 2.1]);

// =============================================================================
h1('7. Code Quality Review');
h2('Strengths');
bullet('**Excellent separation of pure logic** into `server/lib/*` with co-located tests - the highest-risk logic (money, tax, authz) is isolated and verifiable.');
bullet('**Consistent defensive route pattern**: validate -> authorize -> transaction -> emit -> typed `{success,...}` response, with prod-safe errors.');
bullet('**Thoughtful "why" comments** (A/R vs cash-on-hand policy, aud-beats-role precedence, SameSite/CSRF trade-off) - above average for an SMB project.');
h2('Issues');
findingF('MEDIUM', 'God files / monolith', [['Evidence', 'server.js 6,691 lines; AdminDashboard.jsx 6,098 lines / 234 useState; LedgerTab 1,928; OrdersTab 1,277.'], ['Impact', 'High cognitive load, painful merges, hard-to-test UI, slow onboarding, easy regressions.'], ['Fix', 'Continue the started components/tabs extraction; split server.js into route modules behind the lib core.']]);
findingF('MEDIUM', 'No linter or formatter', [['Evidence', 'No .eslintrc / eslint.config / .prettierrc anywhere; CI runs only node --check.'], ['Impact', 'No automated catch of unused vars, accidental globals, missing hook deps, style drift.'], ['Fix', 'Add ESLint (+react-hooks plugin) + Prettier and a CI lint step.']]);
findingF('LOW', 'Dead / temp artifacts committed', [['Evidence', 'scripts_temp/ holds 10 one-off dev scripts; showcase.html duplicated at repo root and client/public/; 8 generated PDFs committed.'], ['Impact', 'Repo clutter; confusion over source vs scratch; larger clone.'], ['Fix', 'Move throwaway scripts out (or to /tools with a README); de-dupe showcase.html; gitignore generated PDFs.']]);
findingF('LOW', 'Mongoose deprecation warnings', [['Evidence', 'Test output repeats "the `new` option for findOneAndUpdate() is deprecated".'], ['Impact', 'Forward-compat risk on a future Mongoose major; log noise.'], ['Fix', 'Replace { new: true } with { returnDocument: "after" }.']]);
findingF('LOW', 'Unconventional in-file structure', [['Evidence', 'Schemas, routes, helpers, and seeding are interleaved in server.js; some helpers defined after first use (hoisting-dependent).'], ['Impact', 'Harder to navigate/review.'], ['Fix', 'Group by concern or split into modules.']]);

// =============================================================================
h1('8. Error Detection');
para('No compilation/build errors were found (server `node --check` passes in CI; `vite build` clean). The runtime/logic risks below were identified by inspection.');
table(['Area', 'Severity', 'Finding'], [
  ['Auth', 'HIGH', 'GET /api/orders/:id has no auth guard - reachable without a token (see Security).'],
  ['Data exposure', 'MEDIUM', 'Public /api/products returns recipe/cost fields to anonymous callers.'],
  ['DB dependency', 'MEDIUM', 'Multi-doc transactions throw on a non-replica-set Mongo (standalone/local).'],
  ['Async', 'LOW', 'Startup seeding wrapped in try/catch and logs errors but proceeds; a partial seed failure is non-fatal (intended, but can mask issues).'],
  ['Validation', 'LOW', 'Some write routes still use Model.create(req.body); Mongoose strict mode drops unknown keys so risk is low, but not all routes have explicit Zod schemas.'],
  ['Deprecation', 'LOW', 'Mongoose { new: true } usage will break on a future major.'],
  ['Unhandled input', 'LOW', 'Most boundaries covered by Zod + escapeRegex; analytics math assumes well-formed numeric aggregates.'],
]);
para('**Crash handling is robust:** uncaughtException / unhandledRejection are caught, logged (and sent to Sentry if configured), then the process drains and exits for a supervisor restart - the correct pattern.');

// =============================================================================
h1('9. Dependency Audit');
para('`npm audit` was executed in both packages during this review.');
severityBar({ CRITICAL: 0, HIGH: 5, MEDIUM: 0, LOW: 0 });
para('(5 HIGH = 3 server + 2 client; plus 4 moderate not shown in the bar. 9 total.)');
table(['Package (transitive)', 'Where', 'Severity', 'Advisory'], [
  ['ws 8.0-8.20.1', 'server + client', 'HIGH', 'Memory-exhaustion DoS (via socket.io / engine.io)'],
  ['@opentelemetry/core', 'server', 'MODERATE', 'Unbounded memory in W3C baggage (via @sentry/node)'],
  ['dompurify <=3.4.10', 'client', 'MODERATE', 'Trusted-Types / ALLOWED_ATTR pollution (via jspdf)'],
], [1.6, 0.9, 0.7, 2.0]);
bullet('**All are fixable** via `npm audit fix` in `server/` and `client/` (no breaking majors required for the high-severity ones).');
bullet('**CI gate is non-blocking** - the workflow ends the audit step with `|| echo "...review."`, so advisories never fail the build.');
bullet('**Direct dependencies are current and legitimate** - no abandoned or typosquatted packages observed; the prior abandoned `xlsx` was already swapped for patched SheetJS 0.20.3.');
h2('Direct dependency inventory');
table(['Server (prod)', 'Client (prod)'], [
  ['express 4.22, mongoose 9.6, socket.io 4.8', 'react 18.3, react-dom, react-router-dom 6.30'],
  ['jsonwebtoken 9, bcrypt 6, zod 4.4', 'socket.io-client 4, lucide-react 1.17'],
  ['helmet 8.2, cors, express-rate-limit 8', 'jspdf 4.2 + autotable 5, xlsx 0.20.3, html2canvas'],
  ['compression, cookie-parser, dotenv', 'react-qr-code 2'],
  ['pino/pino-http, @sentry/node 10.56', 'dev: vite 8, tailwind 3.4, @playwright/test 1.6'],
]);

// =============================================================================
h1('10. Security Audit');
para('Security DESIGN is strong; the gaps are CONFIGURATION (weak secret), a couple of EXPOSURE points, and DEPENDENCIES. Finding severity distribution:');
severityBar({ CRITICAL: 1, HIGH: 2, MEDIUM: 4, LOW: 3 });
findingF('CRITICAL', 'Weak and reused JWT signing secret', [['Evidence', 'Live .env sets JWT_SECRET=infu-pass-2026 - short, guessable, dictionary-style - identical across the F&B and logistics deployments. Boot only checks presence (server.js:44), not strength.'], ['Impact', 'Anyone who guesses/obtains it can forge a superadmin token and bypass all auth; reuse means one leak compromises both businesses.'], ['Fix', 'openssl rand -hex 32, UNIQUE per deployment, store in host secret manager, add a boot check rejecting secrets < 32 chars, rotate now.']]);
findingF('HIGH', 'Unauthenticated order lookup exposes PII (IDOR)', [['Evidence', 'GET /api/orders/:id (server.js:2085) has NO auth and returns customerName, customerPhone, deliveryAddress, totals, payment method.'], ['Impact', 'MongoDB ObjectIds embed a timestamp + counter and are partly predictable; orders can be enumerated to harvest PII (OWASP A01).'], ['Fix', 'Require a matching QR-session/client token, or return only non-PII status fields on the public path.']]);
findingF('HIGH', 'Unpatched high-severity dependencies', [['Evidence', 'ws memory-exhaustion DoS reachable via Socket.io on both server and client (npm audit, executed).'], ['Impact', 'Remote DoS vector on any deployment.'], ['Fix', 'npm audit fix in both packages; make CI audit blocking for high/critical.']]);
findingF('MEDIUM', 'Internal cost / recipe (COGS) data exposed publicly', [['Evidence', 'Public GET /api/products strips clientDiscounts/images for anonymous callers but still returns baseRecipe, costOverride, and sizes[].recipe / addOns[].recipe costs.'], ['Impact', 'Competitors/customers read ingredient lists, per-item costs, and margins via the menu.'], ['Fix', 'Project only customer-facing fields for unauthenticated/QR callers.']]);
findingF('MEDIUM', 'Guessable / default admin credentials', [['Evidence', 'Seed fallback ChangeMe@2026! (server.js:405, docker-compose default); live ADMIN_PASS follows a guessable pattern (...masterkey2026!).'], ['Fix', 'Force a strong unique admin password on first boot; never ship a default.']]);
findingF('MEDIUM', 'No secret-strength / config validation at boot', [['Evidence', 'Only presence of MONGO_URI & JWT_SECRET checked; weak secret, default admin pass, or empty prod ALLOWED_ORIGINS accepted silently.'], ['Fix', 'Add a startup config validator.']]);
findingF('MEDIUM', 'Non-blocking security gate in CI', [['Evidence', 'ci.yml audit step ends with || echo so advisories never fail the build.'], ['Fix', 'Fail CI on high/critical with a time-boxed allowlist for accepted advisories.']]);
findingF('LOW', 'Client-side route guards absent', [['Evidence', '/admin & /admin/admin-panel render directly in App.jsx; protection relies on the component login gate (server RBAC is the real control).'], ['Fix', 'Add a route guard for UX + defense-in-depth.']]);
findingF('LOW', 'Secrets in plaintext .env on disk', [['Evidence', 'Real Atlas creds + ADMIN_PASS in .env files. Confirmed NOT tracked by git (gitignored; ls-files/history clean) - good - but readable with host/disk access.'], ['Fix', 'Use a managed secret store in prod; rotate the DB password given it appears in working files.']]);
findingF('LOW', 'Hardcoded F&B notification copy in Logistics mode', [['Evidence', 'Service worker push body hardcodes "Food is Ready!" regardless of BUSINESS_TYPE.'], ['Fix', 'Parameterize by business type.']]);
h2('Controls verified IN PLACE (good)');
bullet('Helmet (HSTS preload, nosniff, frameguard, referrer-policy); x-powered-by off; trust proxy 1.');
bullet('bcrypt cost 12; rate limiting (login 5/15min skip-success, orders 60/min, global 300/min).');
bullet('Zod strips unknown keys (mass-assignment/BOPLA defense) + 422 field errors; escapeRegex guards ReDoS/regex-injection.');
bullet('CSRF: Origin allowlist on cookie auth routes; Bearer API is CSRF-immune. Refresh token hashed at rest, rotated, revocable.');
bullet('No XSS sinks in client (no dangerouslySetInnerHTML / innerHTML / eval); no hardcoded secrets in source; prod error handler hides stack/message.');

// =============================================================================
h1('11. Performance Audit');
h2('Frontend (vite build - executed, 4.9s)');
para('Clean build with proper route-level code-splitting; heavy export libs load only on demand:');
table(['Chunk', 'Raw', 'Gzip', 'Loading'], [
  ['index (entry)', '160 kB', '53 kB', 'eager'], ['AdminDashboard', '225 kB', '59 kB', 'lazy route'],
  ['xlsx (SheetJS)', '493 kB', '161 kB', 'lazy (export only)'], ['jspdf', '400 kB', '130 kB', 'lazy (PDF export)'],
  ['html2canvas', '200 kB', '47 kB', 'lazy (PDF export)'], ['LedgerTab', '100 kB', '19 kB', 'lazy'],
], [1.6, 0.7, 0.7, 1.2]);
bullet('**Good:** ~290 kB of export libs do not block first paint; entry + dashboard (~112 kB gz) is acceptable for a tablet LAN app.');
bullet('**Watch:** AdminDashboard at 59 kB gz is large for one route; further tab splitting would help cold load.');
h2('Backend');
bullet('**Good:** Mongo pool (maxPoolSize 20), fail-fast selection (10s), gzip, 40 schema indexes, atomic $inc, bounded report ranges (<=92 days).');
bullet('**Watch:** analytics/dashboard partly client-side; some list endpoints build in-memory maps of all inventory (O(n)/request) - fine at SMB scale, not 10k+ SKUs.');
bullet('**Constraint:** order completion needs a replica set (Atlas OK; standalone Mongo fails). Not noted in docker-compose (which ships no Mongo service).');

// =============================================================================
h1('12. UI / UX Review');
para('Partially verified live this audit: the app was logged into in a real browser and every admin tab was opened (see Section 15). Login, navigation, theming, the SUPER role badge, and empty states render correctly with zero console errors. Deeper UX (accessibility, responsive breakpoints) remains code-level only.');
bullet('**Verified live** - login screen + authenticated dashboard render; sidebar groups (Operations / Management), role-gated "Command Center (SUPER)", "No orders in any queue" empty state, Clock-In, auto-close timer; all 8 tabs mount without errors.');
bullet('**Theming** - data-theme (default/yellow/ocean) via CSS variables; black/olive brand confirmed in the live screenshot; tablet-first with large (>=44px) touch targets per the code.');
bullet('**Resilience** - top-level React ErrorBoundary with a reload affordance; Suspense loading fallback on lazy routes.');
bullet('**Not verified (recommend Lighthouse + axe):** color contrast, keyboard accessibility, ARIA labeling, focus management, screen-reader behavior, responsive breakpoints across phone/tablet.');
callout('UI/UX status',
  'Core flows are now browser-verified (login, navigation, all tabs, ledger views - 9/9 e2e). What remains unverified is accessibility and responsive correctness across device sizes, which need a Lighthouse + axe pass on a tablet viewport.', C.teal);

// =============================================================================
h1('13. Database Review');
bullet('**Schema** - Mongoose models for Order, Product, Inventory, Category, User, ClientAccount, JournalEntry, Account, Counter, Settings, AuditLog, RefreshSession, and more; timestamps enabled; soft-delete via isArchived.');
bullet('**Indexes** - 40 index/unique declarations (orderNumber, businessType, idempotencyKey sparse, cashier, clientAccountId, etc.). Reasonable coverage for the main query paths.');
bullet('**Integrity** - balanced-journal assertion before commit; multi-document transactions on order completion (24 session-scoped ops); atomic counters prevent duplicate sequence numbers.');
bullet('**Tenancy** - businessType field stamped on docs + one-time backfill migration; not hard isolation.');
bullet('**Migrations** - hand-rolled in runStartupTasks (role backfill, businessType stamping, COA 4->6 digit code migration, counter sync), each guarded by a Settings flag. Works, but there is NO versioned/rollbackable migration framework.');
bullet('**Backup** - scripts/backup-mongo.sh + restore-mongo.sh provided; an automated/scheduled backup is not proven to run.');

// =============================================================================
h1('14. API Review');
para('**139 REST routes** + 1 health endpoint, all enumerated. Consistent `{success, ...}` envelope, sensible status codes (401 vs 403 distinction, 422 validation, 404 fallback).');
table(['Concern', 'Assessment'], [
  ['REST consistency', 'GOOD - resource-oriented; consistent response shape'],
  ['Status codes', 'GOOD - 200/401/403/404/422/500 used correctly; 401 vs 403 deliberate'],
  ['AuthN/AuthZ', 'GOOD - every sensitive route guarded; public routes are menu reads + QR session + one IDOR exception'],
  ['Validation', 'PARTIAL - Zod on key write routes; not universal'],
  ['Rate limiting', 'GOOD - login/order/global limiters'],
  ['Versioning', 'MISSING - no /v1 prefix'],
  ['Documentation', 'MISSING - no OpenAPI/Swagger spec'],
]);
h2('Public (unauthenticated) routes - complete list');
table(['Route', 'Intent', 'Verdict'], [
  ['GET /health', 'Load-balancer health', 'OK'],
  ['GET /api/products, /categories, /addons, /combos', 'Customer menu reads', 'OK except COGS/recipe leak (see Security)'],
  ['POST /api/sessions/:id/heartbeat, /close', 'QR session keepalive', 'OK (public by nature)'],
  ['POST /api/orders', 'Place order', 'OK - orderLimiter + verifyOrderAuth (QR session or staff token)'],
  ['POST /api/users/login, /client-auth/login', 'Login', 'OK - loginLimiter + Zod'],
  ['POST /api/auth/refresh, /logout', 'Token rotation', 'OK - requireTrustedOrigin + httpOnly cookie'],
  ['GET /api/orders/:id', 'Order status poll', 'FINDING - no auth; exposes PII (IDOR)'],
], [2.0, 1.2, 1.4]);
h2('Authorization tiers (verified across all 139)');
bullet('`verifyToken + requireSuperAdmin` - finance/journal/reports/accounts/users-mgmt/voids/inventory-destructive/admin tools.');
bullet('`verifyToken + requireStaff` - orders list, inventory ops, shifts, clock, categories, settings read.');
bullet('`verifyToken + requireSuperOrAdmin` - refunds.  `verifyClientToken` - the 2 client-portal routes.');

// =============================================================================
h1('15. Testing Review');
table(['Suite', 'Result', 'Evidence'], [
  ['Server unit + integration (vitest)', 'PASS - 304/304, 20 files', 'Ran npm test (exit 0)'],
  ['Server coverage (v8)', 'PARTIAL - 77.8% lines / 49.1% branch / 75% funcs', 'Ran npm run coverage (split below)'],
  ['Pure lib coverage (ledger/tax/units/...)', 'GOOD - 99.1% lines / 89.1% branch', 'Co-located *.test.js per lib'],
  ['Client build', 'PASS - clean', 'Ran vite build (exit 0)'],
  ['Client unit tests', 'MISSING - none', 'No client unit runner configured'],
  ['E2E (Playwright, real Chromium)', 'PASS - 9/9', 'EXECUTED this audit vs an ephemeral DB'],
], [1.7, 1.05, 1.5]);
h2('Coverage split by area (verified - npm run coverage)');
table(['Area', 'Stmts', 'Branch', 'Funcs', 'Lines'], [
  ['server/lib (pure core)', '97.2%', '89.1%', '97.2%', '99.1%'],
  ['  authz.js / tax.js / reportRange.js', '100%', '100%', '100%', '100%'],
  ['  ledger.js', '100%', '94.7%', '100%', '100%'],
  ['server.js (routes + orchestration)', '71.3%', '46.8%', '73.1%', '77.0%'],
  ['ALL FILES', '72.3%', '49.1%', '75.1%', '77.8%'],
], [2.0, 0.8, 0.8, 0.8, 0.8]);
bullet('The highest-risk logic (journal balancing, tax, authorization) is at ~100%. The gap is in server.js error/edge branches - and part of the "uncovered" server.js lines are the bootstrap/shutdown handlers (listen, SIGTERM, uncaughtException) deliberately skipped under test, so effective handler coverage is a bit higher than 46.8% branch implies.');
h2('Live browser verification (EXECUTED this audit)');
para('The project\'s own Playwright suite was run in real headless Chromium against an EPHEMERAL in-memory MongoDB replica set (production Atlas never touched). **Result: 9/9 passing.** Verified end-to-end in a browser:');
bullet('Dual-token auth: login reaches the dashboard; access token NOT in localStorage; session survives reload (silent refresh); spamming reload keeps the user logged in; clearing the refresh cookie forces re-login.');
bullet('Navigation: ALL 8 admin tabs (Orders & POS, Inventory, Menu Setup, History & Shifts, Analytics, Accounting & Ledger, Pricing, Audit) mount with NO console/runtime errors; ledger sub-views (Journal, P&L, Balance Sheet, A/R, A/P) load.');
bullet('Smoke: login screen renders; dashboard renders post-login clean.');
callout('Live finding reproduced during this run',
  'The first e2e attempt failed at login with "Network error" - the browser origin was not in the backend ALLOWED_ORIGINS, so CORS blocked every call and the app looked broken. Adding the origin fixed it and all 9 passed. This is a real, in-vivo demonstration of deployment finding #2: a wrong ALLOWED_ORIGINS makes the entire deployed app non-functional even though the code is correct.', C.med, '#FBF3E6');
para('**Honest read:** backend logic is well-tested (esp. money paths) with strong integration coverage incl. fault injection; the core UI is now BROWSER-VERIFIED (login, session, all tabs, ledger views, zero console errors). Remaining gaps: no client UNIT tests, deep frontend logic (cart math, exports, offline queue) is not automatically tested, and the e2e is not yet wired into CI. Blended automated-test confidence: **moderate-to-good (~66%)**.');

// =============================================================================
h1('16. Deployment Review');
table(['Capability', 'Status', 'Notes'], [
  ['Production build', 'GOOD', 'vite build clean; server node --check in CI'],
  ['Containerization', 'GOOD', 'Dockerfiles (server + client/nginx) + docker-compose with healthcheck'],
  ['CI/CD', 'PARTIAL', 'GitHub Actions builds+tests both apps; audit gate non-blocking; no CD'],
  ['Config management', 'PARTIAL', '.env.example thorough; live .env has weak secret + stray vars'],
  ['Health checks', 'GOOD', '/health reports DB state; compose healthcheck wired'],
  ['Graceful shutdown', 'GOOD', 'SIGTERM/SIGINT drain; fatal handlers exit for supervisor restart'],
  ['Logging', 'GOOD', 'Structured pino; request logging; /health noise filtered'],
  ['Monitoring / crash reporting', 'PARTIAL', 'Sentry supported but inert unless SENTRY_DSN set'],
  ['Backups / rollback', 'PARTIAL', 'Backup/restore scripts + GO_LIVE runbook; no scheduled backup or migration rollback'],
  ['Secrets management', 'LOW', 'Plaintext .env; no managed secret store wired'],
  ['DB provisioning', 'PARTIAL', 'compose ships NO mongo service - external Atlas (replica set) required'],
  ['SSL / domain', 'PARTIAL', 'Terminated at Vercel/Railway/nginx; not configured in-repo'],
], [1.5, 0.7, 2.0]);

// =============================================================================
h1('17. Production Readiness Ratings');
para('Evidence-based estimates (0-100). Green >= 80, amber 60-79, red < 60.');
barChart([
  { label: 'Architecture', value: 90 }, { label: 'Security', value: 74 }, { label: 'Performance', value: 85 },
  { label: 'Scalability', value: 70 }, { label: 'Maintainability', value: 68 }, { label: 'Reliability', value: 85 },
  { label: 'Testing', value: 66 }, { label: 'Documentation', value: 64 }, { label: 'Deployment', value: 82 },
  { label: 'Code Quality', value: 72 }, { label: 'UI/UX', value: 80 }, { label: 'OVERALL', value: 78 },
]);
callout('Overall Production Readiness: 78%',
  'Weighted toward a strong, well-tested backend and solid deployment scaffolding, pulled down by a weak live secret, an IDOR/PII exposure, unpatched high-severity dependencies, and maintainability/documentation debt. None of the blockers are architectural.', C.teal);

// =============================================================================
h1('18. Deployment Decision');
callout('DECISION: YES - deployable to a single-tenant SMB, but ONLY after 3 must-fix blockers.',
  'The system is functionally complete and operationally scaffolded for a real go-live. It is NOT safe to expose to the public internet in its current configuration until the blockers below are cleared - all small, well-understood fixes.', C.med, '#FBF3E6');
h2('Must-fix blockers (before any live deployment)');
findingF('CRITICAL', '1. Replace the JWT secret', [['Action', 'Generate a strong UNIQUE per-deployment secret (openssl rand -hex 32), store in the host secret manager, add a boot strength check, rotate now (logs everyone out once).']]);
findingF('HIGH', '2. Patch dependencies', [['Action', 'npm audit fix in server/ and client/ to clear the high-severity ws DoS; make the CI audit gate blocking.']]);
findingF('HIGH', '3. Close the unauthenticated PII exposure', [['Action', 'Lock down GET /api/orders/:id and trim COGS/recipe from the public products response.']]);
h2('Strongly recommended before public/scale launch');
bullet('Force-rotate the default/guessable admin password and the Atlas DB password.');
bullet('Add boot-time config validation (secret length, no default admin pass in prod, warn on empty origins).');
bullet('Commit the working-tree changes and let CI validate; reconcile the version number and tag a release.');
bullet('Wire SENTRY_DSN; verify an automated backup actually runs and restores.');

// =============================================================================
h1('19. Bug Prediction & Risk Analysis');
table(['Scenario', 'Likelihood', 'Predicted failure / risk'], [
  ['Public internet exposure', 'High', 'JWT forgery (weak secret) + order PII harvesting (IDOR) before other defenses matter'],
  ['Socket.io DoS', 'Medium', 'ws memory-exhaustion advisory directly reachable until patched'],
  ['Standalone/local MongoDB', 'High', 'Order completion throws - transactions need a replica set (Atlas only)'],
  ['Years of data growth', 'Medium', 'Client-side analytics + in-memory product/inventory maps degrade; reports slow'],
  ['High concurrency at counter', 'Low', 'Mitigated: atomic $inc + atomic counters + idempotency keys prevent oversell/dupes'],
  ['Offline -> reconnect sync', 'Medium', 'Queue replay relies on idempotency keys; needs real-world soak testing for edge dupes'],
  ['Crash / uncaught exception', 'Low', 'Handled: drains + exits for supervisor restart; Sentry capture if configured'],
  ['Unexpected user input', 'Low', 'Zod + escapeRegex + typed schemas cover most boundaries'],
  ['Multi-branch expansion attempted', 'High', 'No real multi-tenancy; all clients receive all Socket events - data-bleed risk'],
  ['Mongoose major upgrade', 'Medium', 'Deprecated { new: true } usage breaks on a future major'],
], [1.5, 0.7, 2.4]);

// =============================================================================
h1('20. Completeness Analysis');
para('Estimated completion by area:');
barChart([
  { label: 'Backend', value: 88 }, { label: 'Frontend', value: 82 }, { label: 'Authentication', value: 85 },
  { label: 'Security', value: 74 }, { label: 'Database', value: 84 }, { label: 'Features', value: 86 },
  { label: 'Testing', value: 66 }, { label: 'Deployment', value: 82 }, { label: 'Documentation', value: 64 },
  { label: 'OVERALL', value: 78 },
], { labelW: 118 });
para('**Is it 100% complete? No - approximately 78% production-ready.** The gap to "100%" is disciplined finishing work (Section 22 checklist), not research-level or architecturally risky.');

// =============================================================================
h1('21. Final Scorecard');
table(['Category', 'Score', 'Notes'], [
  ['Architecture', '90%', 'Clean SPA/API/WS split; pure-logic core extracted & tested'],
  ['Code Quality', '72%', 'Strong patterns, but god files + no lint'],
  ['Performance', '85%', 'Code-split bundles, indexed DB, atomic ops; client-side analytics caveat'],
  ['Security', '74%', 'Strong design; weak live secret + IDOR + dep vulns drag it down'],
  ['Scalability', '70%', 'Single-tenant; client-side analytics; monolith'],
  ['Maintainability', '68%', '6.7k-line server, 6.1k-line component, doc drift'],
  ['Deployment', '82%', 'Docker/CI/health/graceful shutdown; non-blocking audit, plaintext secrets'],
  ['Documentation', '64%', 'Abundant but drifted/contradictory; no API spec'],
  ['Testing', '66%', '304 backend tests (77.8% lines) + 9/9 e2e executed; no client unit tests'],
  ['UI/UX', '80%', 'Core flows browser-verified (9/9 e2e + screenshot); a11y/responsive unverified'],
  ['Reliability', '85%', 'Transactions, graceful shutdown, fatal handlers, idempotency'],
  ['OVERALL', '78%', 'Release Candidate; deployable after 3 blockers'],
], [1.3, 0.5, 2.4]);

// =============================================================================
h1('22. Final Verdict & 100% Completion Checklist');
callout('Classification: RELEASE CANDIDATE.',
  'Beyond Beta - feature-complete for its single-tenant scope, well-tested on the backend, operationally packaged. Short of "Production Ready" only due to fixable config/exposure/dependency blockers; short of "Enterprise/Commercial multi-tenant Ready" due to single-tenancy, the monolithic frontend, light frontend testing, and documentation drift. Clear the 3 blockers and it becomes a legitimate single-tenant production deployment.', C.teal);
h2('Critical (deploy blockers)');
bullet('[ ] Replace JWT_SECRET with a strong, unique-per-deployment value; add boot strength check.');
bullet('[ ] npm audit fix (server + client); make the CI audit gate blocking on high/critical.');
bullet('[ ] Authenticate / de-PII GET /api/orders/:id.');
h2('Major');
bullet('[ ] Strip COGS/recipe fields from the public /api/products response.');
bullet('[ ] Force-rotate default admin password + Atlas DB password; remove shipped defaults.');
bullet('[ ] Add boot-time config validation (secret length, prod origins, no default admin pass).');
bullet('[ ] Commit working-tree changes; reconcile version (1.0.0 / 0.5 / 0.2) and tag a release.');
bullet('[ ] Wire Sentry DSN in prod; prove backup + restore end-to-end.');
h2('Minor');
bullet('[ ] Add ESLint + Prettier + a CI lint step.');
bullet('[ ] Replace deprecated Mongoose { new: true } with { returnDocument: "after" }.');
bullet('[ ] Remove scripts_temp/ from the repo; de-duplicate showcase.html; gitignore generated PDFs.');
bullet('[ ] Reconcile/archive stale reports (AUDIT_OVERVIEW, SESSION_REPORT) that contradict current code.');
bullet('[ ] Parameterize push-notification copy by business type.');
h2('Recommended improvements');
bullet('[ ] Split server.js into route modules; continue AdminDashboard.jsx tab extraction.');
bullet('[ ] Add Playwright E2E (checkout, void, EOD) to CI; add client unit tests for cart/money math.');
bullet('[ ] Raise server branch coverage toward 70%+.');
bullet('[ ] Move heavy analytics aggregation server-side; paginate large lists.');
bullet('[ ] Publish an OpenAPI spec; add API versioning.');
h2('Optional enhancements');
bullet('[ ] True multi-tenancy + Socket.io room partitioning (unlocks multi-branch/franchise).');
bullet('[ ] Loyalty/CRM module; hardware (ESC/POS) certification matrix.');
bullet('[ ] Formal, versioned DB migration framework with rollback.');
h2('Closing statement');
para('Semivra Libellus is a genuinely capable, above-average SMB POS/ERP with a security and accounting core most products in its class do not attempt. Its problems are concentrated and fixable: tighten three configuration/exposure items to deploy safely, then pay down monolith and documentation debt to make it maintainable and scalable. A strong Release Candidate - not yet a finished product.');

// =============================================================================
h1('Appendix A - What To Read Later');
para('A curated reading list so you can verify this report and act on it without re-deriving context. Ordered by priority.');

h2('A.1 Read FIRST - to confirm the 3 blockers yourself');
table(['What to open', 'Why', 'Look for'], [
  ['server/.env (and the F&B .env)', 'Confirm the weak/reused JWT secret', 'JWT_SECRET=infu-pass-2026 (same in both)'],
  ['server/server.js : 2085', 'The unauthenticated order-lookup (IDOR/PII)', 'app.get("/api/orders/:id", ...) with NO verifyToken'],
  ['server/server.js : 1751-1797', 'COGS/recipe leak on the public menu', 'baseRecipe / costOverride still returned to anonymous'],
  ['server/server.js : 44', 'Boot env check (presence only, not strength)', 'if (!MONGO_URI || !JWT_SECRET) ...'],
  ['npm audit (server/ and client/)', 'The 9 dependency advisories', 'high-severity ws DoS; run npm audit fix'],
], [1.5, 1.3, 1.5]);

h2('A.2 Read to UNDERSTAND the system (the well-built parts)');
bullet('`server/lib/*.js` (+ the matching `*.test.js`) - the pure, fully-tested core: ledger, tax, units, expiry, chartOfAccounts, authz, reportRange. Start here; it is the clearest code in the repo.');
bullet('`server/server.js` auth middleware (verifyToken, verifyClientToken, requireStaff/SuperAdmin) and the order-completion transaction (around the `mongoose.startSession()` blocks) - the heart of correctness.');
bullet('`client/src/lib/auth.js` - the in-memory access token + silent refresh pattern (why tokens are NOT in localStorage).');
bullet('`client/src/lib/pwa.js` + `client/public/sw.js` - the offline queue and service-worker caching/notifications.');
bullet('`server/test/*.integration.test.js` - the best living documentation of expected behavior (money math, fault injection, edge cases).');

h2('A.3 In-repo docs - trust map');
table(['Document', 'Use it for', 'Trust'], [
  ['DEPLOY.md, GO_LIVE.md, Makefile', 'Deploy steps, rollback runbook, ops commands', 'Trust (operational)'],
  ['MANUAL.md, Semivra_Complete_Guide', 'End-user / operator how-to', 'Trust (usage)'],
  ['PROJECT_CHARTER.md, README.md', 'Intent, scope, feature list', 'Mostly - version is stale (says v0.2)'],
  ['AUDIT_OVERVIEW.md, SESSION_REPORT.md', 'Prior self-audit', 'CAUTION - stale: claims 75/81 tests, 0 vulns, token rewrite "not done", 4,661-line dashboard. All contradicted by current code.'],
  ['The 8 committed *.pdf reports', 'Historical snapshots', 'CAUTION - point-in-time; may be outdated'],
], [1.4, 1.4, 1.6]);
callout('Reconcile the docs',
  'Several in-repo reports describe an earlier state of the project and now contradict the code (test counts, vuln counts, auth status, file sizes, version). Before sharing this project with anyone, archive or update those documents - conflicting "official" reports erode trust faster than a known gap.', C.med, '#FBF3E6');

h2('A.4 External references for the findings');
bullet('OWASP Top 10 - A01 Broken Access Control (the IDOR) and A07 Identification & Authentication Failures (the JWT secret).');
bullet('OWASP Password Storage & Secrets Management cheat sheets; JWT best current practices (RFC 8725).');
bullet('Advisories to track: GHSA for `ws` (memory-exhaustion DoS), `dompurify` (Trusted-Types/ALLOWED_ATTR), `@opentelemetry/core` (baggage memory).');
bullet('MongoDB docs - multi-document transactions require a replica set (explains the standalone-Mongo risk).');

h2('A.5 Suggested order of work');
bullet('1) Fix the 3 blockers (Section 18) -> 2) rotate admin + DB passwords -> 3) commit working tree + let CI run -> 4) add ESLint + blocking audit gate -> 5) reconcile version & docs -> 6) then start splitting the monoliths behind tests.');

// =============================================================================
// RENDER TOC (backfill the reserved page)
// =============================================================================
(function renderTOC() {
  doc.switchToPage(TOC_PAGE_INDEX); contentPages.add(TOC_PAGE_INDEX);
  doc.x = ML; doc.y = top();
  doc.save().rect(ML, doc.y, 5, 21).fill(C.teal).restore();
  doc.font('Helvetica-Bold').fontSize(16.5).fillColor(C.navy).text('Table of Contents', ML + 13, doc.y + 1.5);
  doc.moveTo(ML, doc.y + 5).lineTo(ML + uW(), doc.y + 5).lineWidth(1).strokeColor(C.line).stroke();
  doc.y += 18; doc.x = ML;
  toc.forEach((e) => {
    const yy = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(C.body).text(tr(e.title), ML, yy, { width: uW() - 40, lineBreak: false });
    const tw = doc.widthOfString(tr(e.title)), dotsX = ML + tw + 6, dotsEnd = ML + uW() - 26;
    if (dotsEnd > dotsX) doc.save().dash(1, { space: 2.5 }).moveTo(dotsX, yy + 7.5).lineTo(dotsEnd, yy + 7.5).lineWidth(0.6).strokeColor(C.faint).stroke().undash().restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.navy).text(String(e.page), ML + uW() - 24, yy, { width: 24, align: 'right', lineBreak: false });
    doc.x = ML; doc.y = yy + 16;
  });
})();

// ── Footers (skip cover) ──────────────────────────────────────────────────────
// IMPORTANT: footer text sits in the bottom-margin zone. Writing there with the
// normal flow makes pdfkit think the page overflowed and auto-add a new page
// (one per footer call) => trailing blank pages. We neutralize the page margins
// before each footer write so maxY == page height and no page is ever added.
const range = doc.bufferedPageRange();
for (let p = 0; p < range.count; p++) {
  doc.switchToPage(range.start + p);
  if (p === 0) continue;
  const m = doc.page.margins;
  doc.page.margins = { top: 0, bottom: 0, left: m.left, right: m.right }; // stop auto-pagination
  doc.save().moveTo(ML, doc.page.height - 44).lineTo(ML + uW(), doc.page.height - 44).lineWidth(0.5).strokeColor(C.line).stroke().restore();
  doc.font('Helvetica').fontSize(7.3).fillColor(C.faint).text('Semivra Libellus - Production Readiness Audit', ML, doc.page.height - 38, { width: uW() / 2, lineBreak: false });
  doc.font('Helvetica').fontSize(7.3).fillColor(C.faint).text(`Page ${p + 1} of ${range.count}`, ML + uW() / 2, doc.page.height - 38, { width: uW() / 2, align: 'right', lineBreak: false });
  doc.page.margins = m;
}

// ── Blank-page self-check (authoritative: pdfkit's own page count) ─────────────
const total = range.count;
const blanks = [];
for (let i = 0; i < total; i++) if (!contentPages.has(i)) blanks.push(i + 1);
doc.end();
console.log('Wrote', OUT, '-', total, 'pages');
console.log('Blank-page self-check:', blanks.length === 0 ? 'PASS (0 blank pages)' : `FAIL - blank pages: ${blanks.join(', ')}`);
