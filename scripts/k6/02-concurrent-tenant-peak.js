// Scenario 2/6 — Concurrent 4-tenant peak. THE critical test.
// Fires simultaneous lunch-rush traffic at all 4 tenant stacks AT ONCE,
// matching their real shared business hours — this is what actually exercises
// CPU contention across 4 Node event loops on 2 vCPUs and lock contention on
// the single shared mongod across 4 logical databases. Each tenant gets its
// own k6 scenario (own VU pool), all scheduled to start together.
//
// Mix per tenant, per iteration: 70% reads (dashboard/products/order-history),
// 30% a full create→complete order round-trip — a realistic POS mix, not an
// all-write hammer.
//
// Run (4 tenants, comma-separated, same order across all three env vars):
//   k6 run \
//     -e TENANT_URLS="https://a.x.com,https://b.x.com,https://c.x.com,https://d.x.com" \
//     -e STAFF_NAMES="ADN-A0001,ADN-A0001,ADN-A0001,ADN-A0001" \
//     -e STAFF_PASSWORDS="pw1,pw2,pw3,pw4" \
//     scripts/k6/02-concurrent-tenant-peak.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { THRESHOLDS } from './lib.js';

const urls = (__ENV.TENANT_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
const names = (__ENV.STAFF_NAMES || '').split(',').map((s) => s.trim());
const passwords = (__ENV.STAFF_PASSWORDS || '').split(',').map((s) => s.trim());

if (urls.length === 0) {
  throw new Error('Set -e TENANT_URLS="url1,url2,url3,url4" (and matching STAFF_NAMES/STAFF_PASSWORDS) — this scenario needs every tenant stack up front.');
}

const scenarios = {};
urls.forEach((_, i) => {
  scenarios[`tenant_${i}`] = {
    executor: 'ramping-vus',
    exec: 'tenantLoad',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 15 },
      { duration: '3m', target: 25 }, // simultaneous "lunch rush" plateau across all tenants
      { duration: '30s', target: 0 },
    ],
    env: { TENANT_INDEX: String(i) },
  };
});

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: [`rate<${THRESHOLDS.ERROR_RATE}`],
    'http_req_duration{kind:read}': [`p(95)<${THRESHOLDS.READ_P95_MS}`],
    'http_req_duration{kind:complete}': [`p(95)<${THRESHOLDS.ORDER_COMPLETE_P95_MS}`],
  },
};

function tenantOf(idx) {
  return { url: urls[idx], name: names[idx] || names[0], password: passwords[idx] || passwords[0] };
}

export function setup() {
  // One login per tenant, done once, reused by every VU in that tenant's scenario.
  return urls.map((url, i) => {
    const t = tenantOf(i);
    const res = http.post(`${url}/api/users/login`, JSON.stringify({ name: t.name, password: t.password }), {
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status !== 200) throw new Error(`Login failed for tenant ${i} (${url}): ${res.status} ${res.body}`);
    return res.json('token');
  });
}

export function tenantLoad(tokens) {
  const idx = Number(__ENV.TENANT_INDEX);
  const url = urls[idx];
  const token = tokens[idx];
  const h = { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };

  if (Math.random() < 0.3) {
    // Full create -> complete round trip (write path).
    const productsRes = http.get(`${url}/api/products`, h);
    const products = productsRes.json('products') || [];
    if (products.length > 0) {
      const p = products[Math.floor(Math.random() * products.length)];
      const body = JSON.stringify({
        items: [{ productId: String(p._id), name: p.name, price: p.basePrice, quantity: 1 + Math.floor(Math.random() * 2) }],
        table: 'k6-peak-test', paymentMethod: 'Cash',
      });
      const created = http.post(`${url}/api/orders`, body, h);
      check(created, { 'order created': (r) => r.status === 200 }, { kind: 'write' });
      if (created.status === 200) {
        const orderId = created.json('order.id') || created.json('order._id');
        const completed = http.put(`${url}/api/orders/${orderId}`, JSON.stringify({ status: 'Completed' }), h, { tags: { kind: 'complete' } });
        check(completed, { 'order completed': (r) => r.status === 200 }, { kind: 'complete' });
      }
    }
  } else {
    const dash = http.get(`${url}/api/analytics/dashboard`, Object.assign({}, h, { tags: { kind: 'read' } }));
    check(dash, { 'dashboard 200': (r) => r.status === 200 }, { kind: 'read' });
  }

  sleep(0.5 + Math.random());
}
