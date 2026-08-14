// Scenario 6/6 — Spike test.
// Sudden opening-rush burst — confirms the existing rate limiters (300/min
// general via generalApiLimiter, 60/min orders via orderLimiter, 5/15min
// login via loginLimiter — all in server.js) degrade traffic to clean 429s
// instead of the process crashing. Deliberately bursts past those thresholds.
// Run this against each of the 4 tenants (simultaneously, from 4 terminals,
// or wrap with 02-concurrent-tenant-peak.js's multi-tenant pattern) for the
// real "opening rush across all 4 tenants" scenario — this file itself is
// single-tenant so the burst shape against one stack is easy to read.
//
// PASS condition: zero 5xx responses. 429s under the burst are expected and
// correct, not a failure — see the custom checks below, which explicitly
// distinguish "the limiter worked" (429) from "the server fell over" (5xx).
//
// Run:
//   k6 run -e BASE_URL=https://tenant-a.example.com \
//          -e STAFF_NAME=ADN-A0001 -e STAFF_PASSWORD=... \
//          scripts/k6/06-spike-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, login, authHeaders, pickProduct, orderBody } from './lib.js';

const serverErrorRate = new Rate('server_error_rate'); // 5xx only — must stay at 0

export const options = {
  scenarios: {
    opening_rush: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 100 }, // sudden burst, not a gradual ramp
        { duration: '20s', target: 100 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    server_error_rate: ['rate==0'], // the one hard gate: never a 5xx, ever
  },
};

export function setup() {
  const token = login();
  return { token, product: pickProduct(token) };
}

export default function (data) {
  const h = authHeaders(data.token);

  const dash = http.get(`${BASE_URL}/api/analytics/dashboard`, h);
  serverErrorRate.add(dash.status >= 500);
  check(dash, {
    'dashboard: 200 or clean 429 (never 5xx)': (r) => r.status === 200 || r.status === 429,
  });

  const created = http.post(`${BASE_URL}/api/orders`, orderBody(data.product), h);
  serverErrorRate.add(created.status >= 500);
  check(created, {
    'order create: 200 or clean 429 (never 5xx)': (r) => r.status === 200 || r.status === 429,
  });

  sleep(0.1); // deliberately tight — this is the burst, not the baseline
}
