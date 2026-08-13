// Scenario 1/6 — Single-tenant baseline.
// Ramps VUs against ONE tenant stack to establish the per-tenant ceiling
// (req/s, p95/p99) that every other scenario compares against. Read-heavy mix
// matching real POS/staff usage: dashboard, product list, order history.
//
// VU count is deliberately modest (peak 8) and paced like real staff usage
// (2-4s between polls), NOT a burst — this scenario measures genuine server
// response capability. A first version of this script ramped to 30 VUs with
// ~1s pacing and mostly re-discovered server/server.js's generalApiLimiter
// (300 req/min per IP, applied to all of /api) instead of measuring anything
// about the server: k6 sends every VU's traffic from ONE source IP, so 30
// VUs firing 3 requests/iteration blew past 300/min almost immediately and
// 88% of "failures" were clean 429s in 0-6ms, not the server struggling.
// That's scripts/k6/06-spike-test.js's job (it deliberately bursts past the
// limiter and checks for clean 429s, never 5xx). If THIS scenario — modest,
// human-paced concurrency — still produces a high 429 rate, that's a real,
// different finding worth escalating: one location's legitimate concurrent
// traffic (multiple POS terminals + a live dashboard + reports, likely
// sharing one public IP via NAT) may be tight enough to trip a
// per-IP limiter under normal business hours, not just an attack.
//
// Run:
//   k6 run -e BASE_URL=https://tenant-a.example.com \
//          -e STAFF_NAME=ADN-A0001 -e STAFF_PASSWORD=... \
//          scripts/k6/01-single-tenant-baseline.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, login, authHeaders, THRESHOLDS } from './lib.js';

const rateLimited = new Counter('rate_limited');

export const options = {
  stages: [
    { duration: '30s', target: 4 },
    { duration: '2m', target: 8 },
    { duration: '2m', target: 8 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: [`p(95)<${THRESHOLDS.READ_P95_MS}`],
    http_req_failed: [`rate<${THRESHOLDS.ERROR_RATE}`],
    // Separate signal from the general pass/fail checks below: if THIS
    // shows up non-zero at this modest, human-paced VU count, it's the
    // per-IP-rate-limit finding described above, not a capacity problem.
    rate_limited: ['count==0'],
  },
};

export function setup() {
  return { token: login() };
}

function checkEndpoint(res, name) {
  if (res.status === 429) rateLimited.add(1);
  check(res, {
    [`${name} 200`]: (r) => r.status === 200,
    [`${name} not rate-limited`]: (r) => r.status !== 429,
  });
}

export default function (data) {
  const h = authHeaders(data.token);

  const dash = http.get(`${BASE_URL}/api/analytics/dashboard`, h);
  checkEndpoint(dash, 'dashboard');

  const products = http.get(`${BASE_URL}/api/products`, h);
  checkEndpoint(products, 'products');

  const orders = http.get(`${BASE_URL}/api/orders?limit=50`, h);
  checkEndpoint(orders, 'orders');

  sleep(2 + Math.random() * 2); // 2-4s between polls — human-paced, not a burst
}
