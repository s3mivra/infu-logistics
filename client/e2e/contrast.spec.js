import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Contrast, measured in the browser rather than argued about on paper.
//
// The arithmetic can be right and the screen still wrong: a token can fail to
// reach the CSS, a hardcoded colour can end up on a themed ground, a rule can
// be overridden. This reads the colours the browser actually painted, on every
// theme, across screens that have real content on them.
//
// It reports the worst offenders by name, so a failure says which text, at
// what size, on which theme - not just that something somewhere is too faint.

const THEMES = ['default', 'yellow', 'ocean', 'light'];

// Screens worth auditing: each puts a different mix of labels, table headers,
// status chips and buttons on screen. An empty dashboard proves nothing.
const SCREENS = ['Orders & POS', 'Inventory & Stock', 'Clients', 'Ledger', 'Quotations', 'Analytics', 'Reports'];

// Runs inside the page. Returns every leaf text node that misses its WCAG AA
// threshold, with enough detail to find it again.
function auditContrast() {
  const lum = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);

  // Walk up for the first ancestor that actually paints something opaque -
  // that is the ground the text is really read against.
  const bgOf = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.85)) return c.slice(0, 3);
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    return body.length >= 3 ? body.slice(0, 3) : [255, 255, 255];
  };

  const out = [];
  let measured = 0;
  // Text NODES, not leaf elements. Most labels here sit beside an icon, so
  // their element has children and a leaf-only walk skipped almost all of
  // them - which made an earlier version of this test measure 17 nodes and
  // pass while seeing nothing.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);

  for (const node of nodes) {
    const text = (node.nodeValue || '').trim();
    if (!text || text.length < 2) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;

    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.1) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;

    const fg = parse(st.color);
    if (fg.length < 3) continue;
    const alpha = fg[3] === undefined ? 1 : fg[3];
    if (alpha < 0.1) continue;                               // decorative, not read

    const bg = bgOf(el);
    // text-fg/70 is not a colour, it is --fg at 70% over whatever is behind
    // it. Composite before measuring or the number is meaningless.
    const eff = [0, 1, 2].map(i => Math.round(fg[i] * alpha + bg[i] * (1 - alpha)));
    const l1 = lum(eff[0], eff[1], eff[2]);
    const l2 = lum(bg[0], bg[1], bg[2]);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    measured++;

    const px = parseFloat(st.fontSize) || 16;
    const bold = (parseInt(st.fontWeight, 10) || 400) >= 700;
    // WCAG large text: 24px, or 18.66px when bold. Everything else needs 4.5.
    const need = (px >= 24 || (bold && px >= 18.66)) ? 3.0 : 4.5;

    if (ratio + 0.02 < need) {
      // The class list is what makes a failure actionable: without it you are
      // grepping for a string that appears in six places.
      out.push({ text: text.slice(0, 44), ratio: Number(ratio.toFixed(2)), need,
        px: Number(px.toFixed(1)), cls: String(el.className || '').slice(0, 100) });
    }
  }
  return { measured, bad: out };
}

for (const theme of THEMES) {
  test(`text is readable on the ${theme} theme`, async ({ page }) => {
    await login(page);
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      try { localStorage.setItem('theme', t); } catch { /* private mode */ }
    }, theme);

    const failures = [];
    let measured = 0;

    for (const screen of SCREENS) {
      const nav = page.getByRole('button', { name: new RegExp('^' + screen.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')) }).first();
      if (await nav.count() === 0) continue;
      await nav.click();
      await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
      await page.waitForTimeout(600);

      const r = await page.evaluate(auditContrast);
      measured += r.measured;
      for (const b of r.bad) failures.push({ ...b, screen });
    }

    // Guards against the failure mode this test is most prone to: passing
    // because it looked at nothing. If the walk stops finding text, that is a
    // broken test, not a readable app.
    expect(measured, 'the audit found no text to measure - the walk is broken').toBeGreaterThan(150);

    const worst = failures.sort((a, b) => a.ratio - b.ratio).slice(0, 15);
    expect(
      failures,
      `${failures.length} of ${measured} text nodes are below AA on "${theme}":\n` +
      worst.map(b => '  ' + b.ratio + ':1 (needs ' + b.need + ') ' + b.px + 'px  [' + b.screen + ']  "' + b.text + '"  |  ' + b.cls).join(String.fromCharCode(10)),
    ).toEqual([]);
  });
}
