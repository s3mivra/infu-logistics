// Scenario 3/6 — Report / data-volume load.
// Hammers P&L, balance sheet, inventory/expiry (FEFO), and order-history
// endpoints concurrently with seeded history in place (run
// server/scripts/seed-load-test-data.mjs + backfill-stats.mjs first). This is
// what surfaces missing indexes and pagination that degrades with dataset
// size — none of these show up against an empty database.
//
// Run:
//   k6 run -e BASE_URL=https://tenant-a.example.com \
//          -e STAFF_NAME=ADN-A0001 -e STAFF_PASSWORD=... \
//          scripts/k6/03-report-data-volume.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, login, authHeaders, THRESHOLDS } from './lib.js';

export const options = {
  stages: [
    { duration: '20s', target: 8 },
    { duration: '2m', target: 20 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: [`p(95)<${THRESHOLDS.READ_P95_MS}`],
    http_req_failed: [`rate<${THRESHOLDS.ERROR_RATE}`],
  },
};

export function setup() {
  return { token: login() };
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

export default function (data) {
  const h = authHeaders(data.token);
  const start = isoDaysAgo(90);
  const end = isoDaysAgo(0);

  const endpoints = [
    `/api/reports/pnl?start=${start}&end=${end}`,
    `/api/reports/pnl-monthly`,
    `/api/reports/balance-sheet`,
    `/api/reports/balance-sheet-monthly`,
    `/api/reports/sales-summary?start=${start}&end=${end}`,
    `/api/reports/sales-line-items?start=${start}&end=${end}`,
    `/api/inventory`,
    `/api/inventory/expiring`,
    `/api/orders?limit=100`,
    `/api/analytics/dashboard`,
  ];

  const path = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${BASE_URL}${path}`, h);
  check(res, { [`${path} 200`]: (r) => r.status === 200 });

  sleep(0.5);
}
