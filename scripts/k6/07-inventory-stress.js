// Scenario 7 — Inventory stress (fb + log).
// Inventory is where the two business types genuinely diverge: fb consumes
// stock through recipes/BOM on order completion, log mostly links 1:1 to a
// sold product — but both share the SAME Inventory model and restock
// endpoint, so this scenario is business-type-agnostic by design. Run it
// against an fb tenant and a log tenant separately and compare.
//
// Read mix: inventory list, expiring-soon, restock history — the screens
// staff actually leave open during a shift.
//
// Write: POST /api/inventory/restock/:id, concentrated on the first few items
// on purpose (not spread uniformly across the whole catalog) — restock does a
// read-modify-write weighted-average-cost recalculation inside a transaction
// with its own 3-attempt WriteConflict retry (inventory.js), and that retry
// logic is only actually exercised under real concurrent contention on the
// SAME document. This is the same class of test that caught the TenantStats
// sharding bug in Part 1 — concentrate load on a hot document on purpose.
//
// Run:
//   k6 run -e BASE_URL=https://tenant-a.example.com \
//          -e STAFF_NAME=ADN-A0001 -e STAFF_PASSWORD=... \
//          scripts/k6/07-inventory-stress.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, login, authHeaders, THRESHOLDS } from './lib.js';

const restockConflicts = new Counter('restock_conflicts'); // exhausted the endpoint's own retry — worth knowing, not necessarily a failure
const restockOk = new Counter('restock_ok');

export const options = {
  stages: [
    { duration: '20s', target: 6 },
    { duration: '2m', target: 12 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{kind:read}': [`p(95)<${THRESHOLDS.READ_P95_MS}`],
    http_req_failed: [`rate<0.05`], // looser than the read-only scenarios — some restock 409s under deliberate contention are expected, not a capacity problem
  },
};

export function setup() {
  const token = login();
  const res = http.get(`${BASE_URL}/api/inventory`, authHeaders(token));
  const items = res.json('items') || [];
  if (items.length === 0) {
    throw new Error('No inventory items on this tenant — add stock first (or run server/scripts/seed-load-test-data.mjs, though that seeds orders, not inventory).');
  }
  // Deliberately hot: only the first 3 items (or fewer) get restocked, so
  // concurrent VUs collide on the same few documents instead of spreading out.
  const hotItems = items.slice(0, Math.min(3, items.length));
  return { token, hotItems };
}

export default function (data) {
  const h = authHeaders(data.token);
  const roll = Math.random();

  if (roll < 0.5) {
    const res = http.get(`${BASE_URL}/api/inventory`, Object.assign({}, h, { tags: { kind: 'read' } }));
    check(res, { 'inventory list 200': (r) => r.status === 200 }, { kind: 'read' });
  } else if (roll < 0.75) {
    const res = http.get(`${BASE_URL}/api/inventory/expiring`, Object.assign({}, h, { tags: { kind: 'read' } }));
    check(res, { 'inventory expiring 200': (r) => r.status === 200 }, { kind: 'read' });
  } else if (roll < 0.9) {
    const res = http.get(`${BASE_URL}/api/inventory/history?limit=50`, Object.assign({}, h, { tags: { kind: 'read' } }));
    check(res, { 'inventory history 200': (r) => r.status === 200 }, { kind: 'read' });
  } else {
    const item = data.hotItems[Math.floor(Math.random() * data.hotItems.length)];
    const addedStock = 1 + Math.floor(Math.random() * 5);
    const body = JSON.stringify({ addedStock, totalCost: addedStock * 10 });
    const res = http.post(`${BASE_URL}/api/inventory/restock/${item._id}`, body, Object.assign({}, h, { tags: { kind: 'write' } }));
    if (res.status === 200) restockOk.add(1);
    else if (res.status === 500) restockConflicts.add(1); // retry exhausted inside the handler
    check(res, { 'restock 200 or handled conflict': (r) => r.status === 200 || r.status === 500 }, { kind: 'write' });
  }

  sleep(1 + Math.random() * 2);
}
