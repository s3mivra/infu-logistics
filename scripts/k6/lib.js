// Shared helpers for the Part-2 k6 load-test suite (pre-launch spec, 4-tenant
// KVM2). Every scenario script imports from here so login/config/env parsing
// only lives in one place.
//
// Required env vars (pass with -e NAME=value):
//   BASE_URL        e.g. https://tenant-a.example.com  (default: http://localhost:5000)
//   STAFF_NAME      an existing staff/admin user CODE on this tenant (e.g. ADN-A0001)
//   STAFF_PASSWORD  that user's password
//
// A staff account with report-viewing permission must already exist on the
// tenant being tested — these scripts do not create one. Seed a product
// catalog first too (server/scripts/seed-load-test-data.mjs creates a
// synthetic one automatically if none exists).
import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
export const STAFF_NAME = __ENV.STAFF_NAME || '';
export const STAFF_PASSWORD = __ENV.STAFF_PASSWORD || '';

export function login() {
  if (!STAFF_NAME || !STAFF_PASSWORD) {
    throw new Error('Set -e STAFF_NAME=<staff code> -e STAFF_PASSWORD=<password> for a real staff account on this tenant.');
  }
  const res = http.post(
    `${BASE_URL}/api/users/login`,
    JSON.stringify({ name: STAFF_NAME, password: STAFF_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  const ok = check(res, { 'login succeeded': (r) => r.status === 200 });
  if (!ok) throw new Error(`Login failed (${res.status}): ${res.body}`);
  return res.json('token');
}

export function authHeaders(token, extra = {}) {
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra } };
}

// Picks the first available product to build order payloads with. Seed one
// first (server/scripts/seed-load-test-data.mjs) if this throws.
export function pickProduct(token) {
  const res = http.get(`${BASE_URL}/api/products`, authHeaders(token));
  const products = res.json('products') || [];
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('No products found on this tenant — seed a catalog first (server/scripts/seed-load-test-data.mjs creates one if none exists).');
  }
  return products[0];
}

export function orderBody(product, qty = 1) {
  return JSON.stringify({
    items: [{ productId: String(product._id), name: product.name, price: product.basePrice, quantity: qty }],
    table: 'k6-load-test',
    paymentMethod: 'Cash',
  });
}

// The spec's default pass/fail gates (server/scripts/../PRE_LAUNCH_SPEC —
// Part 2 §9). Confirm these with whoever owns the business relationship
// before treating them as hard gates rather than starting defaults.
export const THRESHOLDS = {
  READ_P95_MS: 500,
  ORDER_COMPLETE_P95_MS: 800,
  ERROR_RATE: 0.01,
};
