import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Nothing on a screen may be cut off with no way to reach it. On a short
// window - a laptop with the browser's bars, a tablet on its side, a phone - a
// box whose content is taller than the box, and that hides the rest instead of
// scrolling, simply loses whatever is below. This opens every screen in a
// short window and fails on any such box big enough to matter.
const SCREENS = ['Orders & POS', 'Inventory & Stock', 'Hub', 'Production', 'Procurement', 'Clients', 'Quotations',
  'Owner Overview', 'Analytics', 'Reports', 'Ledger', 'Pricing Control', 'Shifts & Cash', 'Approvals', 'Audit Report', 'Fixed Assets', 'Settings'];

// Boxes that hide overflow on purpose: one line of text cut with "…", a
// picture cropped to its frame, a bar drawn as a share of its track.
const CUT_ON_PURPOSE = (el) => /\btruncate\b|line-clamp|rounded-full|aspect-|object-cover/.test(el.className || '');

async function cutOff(page) {
  return page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 60) continue;                         // too small to hold a screen's worth
      const hidesY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (!hidesY || el.scrollHeight - el.clientHeight < 24) continue;      // nothing meaningful hidden
      if (/\btruncate\b|line-clamp|rounded-full|aspect-|object-cover/.test(el.className?.baseVal ?? el.className ?? '')) continue;
      // Hidden content that is just a decoration (an animation, a sliding panel offscreen) has no text.
      const hiddenText = [...el.querySelectorAll('*')].some(c => {
        const cr = c.getBoundingClientRect();
        return cr.top >= r.bottom - 2 && (c.textContent || '').trim().length > 0 && c.children.length === 0;
      });
      if (!hiddenText) continue;
      found.push(`${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? '').split(/\s+/).slice(0, 6).join('.')} - ${el.scrollHeight - el.clientHeight}px hidden`);
    }
    return found;
  });
}

for (const [label, size] of [['laptop', { width: 1280, height: 620 }], ['phone', { width: 390, height: 700 }]]) {
  test(`on a short ${label} screen nothing is cut off without a way to scroll`, async ({ page }) => {
    test.setTimeout(300000);
    void CUT_ON_PURPOSE;
    await page.setViewportSize(size);
    await login(page);
    const problems = [];
    for (const screen of SCREENS) {
      // On a phone the menu is a drawer: open it first.
      const open = page.getByRole('button', { name: 'Open navigation' });
      if (await open.isVisible().catch(() => false)) await open.click({ timeout: 5000 }).catch(() => {});
      const btn = page.getByRole('button', { name: screen, exact: true }).locator('visible=true').first();
      if (!(await btn.count())) continue;
      await btn.click({ timeout: 5000 }).catch(() => {});
      // Close the drawer again so the screen itself is what gets measured.
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);
      for (const p of await cutOff(page)) problems.push(`${screen}: ${p}`);
    }
    expect([...new Set(problems)], [...new Set(problems)].join('\n')).toEqual([]);
  });
}
