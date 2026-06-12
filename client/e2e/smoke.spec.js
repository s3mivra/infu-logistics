import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Lightweight smoke test — app loads and the dashboard renders after login with no
// console errors. Catches the "white screen / broken build" class of bug.

test('app loads the login screen', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByLabel('Staff Name')).toBeVisible({ timeout: 30000 });
});

test('dashboard renders after login with no console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await login(page);

  const real = errors.filter(e => !/favicon|manifest|service ?worker|net::ERR|Failed to load resource/i.test(e));
  expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
});
