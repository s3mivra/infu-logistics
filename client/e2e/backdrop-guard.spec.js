import { test, expect } from '@playwright/test';

// A pop-up closes on a real click on its dimmed background - not when a text
// selection is dragged out of a field, and not once something has been typed
// in it (see src/shared/ui/backdropGuard.js).

async function mountPopup(page) {
  await page.evaluate(() => {
    document.getElementById('bg-test')?.remove();
    window.__closed = 0;
    const back = document.createElement('div');
    back.id = 'bg-test';
    back.className = 'fixed inset-0';
    back.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center';
    back.addEventListener('click', (e) => { if (e.target === back) window.__closed++; });
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:24px';
    const input = document.createElement('input');
    input.id = 'bg-input';
    box.appendChild(input);
    back.appendChild(box);
    document.body.appendChild(back);
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByLabel('Staff Name')).toBeVisible({ timeout: 30000 });
});

test('a plain click on the background closes it', async ({ page }) => {
  await mountPopup(page);
  await page.mouse.click(10, 10);
  expect(await page.evaluate(() => window.__closed)).toBe(1);
});

test('dragging a selection out of a field does not close it', async ({ page }) => {
  await mountPopup(page);
  const box = await page.locator('#bg-input').boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, 10);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__closed)).toBe(0);
});

test('after typing in it, a click outside does not close it', async ({ page }) => {
  await mountPopup(page);
  await page.locator('#bg-input').fill('half-typed');
  await page.mouse.click(10, 10);
  expect(await page.evaluate(() => window.__closed)).toBe(0);
  expect(await page.locator('#bg-input').inputValue()).toBe('half-typed');
});
