import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// The order panel at the till holds a lot: who it is for, guests, loyalty,
// bar cups, a note, the cart, the totals, and under them Park and the button
// that places the order. On a short screen all of that is taller than the
// panel. It used to clip, so Park and the place-order button were cut off
// under the total with no way for a person to reach them.
//
// A script can scroll even a clipped box, so this does not just scroll to the
// button - it checks the panel lets a PERSON scroll: when its content is
// taller than the panel, the panel must be a scrolling box, not a clipping one.
test('on a short screen the till panel can be scrolled down to the place-order button', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 560 });
  await login(page);
  await page.getByRole('button', { name: 'Orders & POS', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  await page.getByRole('button', { name: 'Manual Order' }).first().click();

  // Put something in the cart, so the panel is as tall as it gets in use.
  const addOpen = page.getByRole('button', { name: /item not on the menu/i }).first();
  if (await addOpen.count()) {
    await addOpen.click();
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add to order' }) });
    await form.locator('input').nth(0).fill('Test drink');
    await form.locator('input').nth(1).fill('120');
    await form.getByRole('button', { name: 'Add to order' }).click();
  }

  const park = page.getByRole('button', { name: /park/i }).last();
  await expect(park).toHaveCount(1);
  // Every box between the button and the page: any that holds more than it
  // shows must let a person scroll it.
  const clipping = await park.evaluate((btn) => {
    const bad = [];
    for (let el = btn.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (el.scrollHeight - el.clientHeight > 4 && (cs.overflowY === 'hidden' || cs.overflowY === 'clip')) {
        bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 5).join('.')}`);
      }
    }
    return bad;
  });
  expect(clipping, `cut off with no way to scroll: ${clipping.join(', ')}`).toEqual([]);
});
