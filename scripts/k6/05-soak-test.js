// Scenario 5/6 — Soak test.
// Sustained MODERATE load for a full simulated business day, catching memory
// leaks and connection-pool exhaustion that only show up over hours, not
// minutes. To actually exercise the midnight auto-archive job
// (scheduleMidnightArchive in server.js) mid-test, TIME THIS RUN so DURATION
// spans the tenant's local midnight — k6 can't reach into the server's cron
// schedule, this just needs to be running while it fires.
//
// DURATION defaults short (10m) so this is runnable in CI/smoke-test mode;
// override it to something like 16h for the real pre-launch soak.
//
// Run:
//   k6 run -e BASE_URL=https://tenant-a.example.com \
//          -e STAFF_NAME=ADN-A0001 -e STAFF_PASSWORD=... \
//          -e DURATION=16h -e VUS=15 \
//          scripts/k6/05-soak-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, login, authHeaders, pickProduct, orderBody, THRESHOLDS } from './lib.js';

const DURATION = __ENV.DURATION || '10m';
const VUS = Number(__ENV.VUS) || 15;

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_duration: [`p(95)<${THRESHOLDS.READ_P95_MS}`],
    http_req_failed: [`rate<${THRESHOLDS.ERROR_RATE}`],
  },
};

export function setup() {
  const token = login();
  return { token, product: pickProduct(token) };
}

export default function (data) {
  const h = authHeaders(data.token);
  const roll = Math.random();

  if (roll < 0.6) {
    const dash = http.get(`${BASE_URL}/api/analytics/dashboard`, h);
    check(dash, { 'dashboard 200': (r) => r.status === 200 });
  } else if (roll < 0.85) {
    const list = http.get(`${BASE_URL}/api/orders?limit=50`, h);
    check(list, { 'orders 200': (r) => r.status === 200 });
  } else {
    const created = http.post(`${BASE_URL}/api/orders`, orderBody(data.product), h);
    check(created, { 'order created': (r) => r.status === 200 });
    if (created.status === 200) {
      const orderId = created.json('order.id') || created.json('order._id');
      const completed = http.put(`${BASE_URL}/api/orders/${orderId}`, JSON.stringify({ status: 'Completed' }), h);
      check(completed, { 'order completed': (r) => r.status === 200 });
    }
  }

  sleep(2 + Math.random() * 3); // moderate pace — this is a soak, not a spike
}
