# Feature Gap List — Build Status

Status of the feature-gap list, honestly accounted. Every item is one of:
**BUILT** (backend shipped with tests), **PARTIAL** (a bounded slice shipped,
with the limit stated), or **DESCOPED** (why it wasn't built here).

Everything BUILT is **backend + integration tests only** — none of these
include new frontend UI. The APIs are ready for the client app to consume.
All server tests pass (701/701 across 51 files as of this writing).

---

## AP (Accounts Payable)

| Item | Status | Notes |
|---|---|---|
| Bill approval workflow | **BUILT** | `Bill` model + `server/features/bills.js`. PO receipt auto-creates a Pending bill; manual bills (rent/utilities) supported too. Manual-bill approval posts the `DR expense / CR 220000` journal entry; PO-bill liability posts at receipt (goods physically arrived) and approval is the sign-off gate. Gated `accounting.manage`. Tests: `server/test/bills.integration.test.js`. |
| Payment scheduling | **BUILT** | `scheduledPaymentDate` on Bill + `GET /api/bills/upcoming` worklist (approved bills, soonest first, overdue flagged). Only Approved bills can be scheduled. |

## AR (Accounts Receivable)

| Item | Status | Notes |
|---|---|---|
| Collection reminders | **BUILT** | `CollectionReminder` log + `server/features/collections.js`: `/overdue` worklist, `/due` follow-up list, per-client history, log-a-contact. Built on the existing aging data (`lib/credit.js`). It's a **contact log, not an automated sender** — nothing emails/SMSes a client (same no-3rd-party-dependency rule as payment gateways). Tests: `server/test/collections.integration.test.js`. |

## Seller Performance

| Item | Status | Notes |
|---|---|---|
| Commission tracking | **BUILT** | `commissionRate` on User + `GET /api/reports/commissions`. Sales attributed by `Order.cashier`, complimentary orders excluded. Gated `reports.view`. Tests: `server/test/commissions.integration.test.js`. |

## Operational Management

| Item | Status | Notes |
|---|---|---|
| Shift scheduling | **BUILT** | `ScheduledShift` roster model + `server/features/scheduling.js`: manager CRUD, bulk publish a date range, staff "my upcoming schedule" (own + Published only). New `scheduling.manage` permission (admin + manager). Distinct from the existing cash-drawer `Shift` and attendance `ClockEntry`. **No shift-swap/request workflow** — that's a larger add left for later. Tests: `server/test/scheduling.integration.test.js`. |

## Customer Management

| Item | Status | Notes |
|---|---|---|
| Customer contact tracking (phone/email) | **BUILT** | `phone`/`email`/`contactNotes` added to `ClientAccount`, wired through create + update routes with email-format validation. Tests: `server/test/client-contact.integration.test.js`. |

## Settings

| Item | Status | Notes |
|---|---|---|
| Discount rule engine configuration | **BUILT** | `DiscountRule` model + `server/features/discount-rules.js`: configurable order-level conditional rules (min-subtotal, day-of-week, date window, client segment) + `POST /evaluate` returning the single best applicable percent. **Deliberately NOT auto-applied in the order money path** — the POS calls evaluate and applies the result through the existing, tested `discountPercent` field, keeping the VAT/discount/ledger math untouched. Gated `settings.manage` to configure, any staff to evaluate. Tests: `server/test/discount-rules.integration.test.js`. |
| Dynamic pricing control | **PARTIAL** | Largely addressed by the discount rule engine above (time-of-day / date-window / segment / min-spend conditional pricing). True per-product dynamic repricing (surge, demand-based) is not built. |
| Multi-currency support | **PARTIAL (display config only)** | `GET`/`PATCH /api/settings/currency` sets the display **symbol + ISO code** (default ₱/PHP). This is **NOT** FX / true multi-currency: every amount is still a single flat number with no currency dimension and no conversion happens. Changing to `$`/`USD` relabels the display, it does not convert existing figures. True multi-currency (per-transaction currency, exchange rates, revaluation) would touch every money calculation and was deliberately out of scope. Tests: `server/test/currency-setting.integration.test.js`. |
| Customizable reports & dashboards | **DESCOPED** | Large and primarily a frontend concern (drag-drop dashboard builder, saved layouts). The backend already exposes many granular report endpoints a customizable UI would compose; building the customization layer itself is its own project. |

## Reporting & Exports

| Item | Status | Notes |
|---|---|---|
| Customizable report templates | **DESCOPED** | Same reasoning as customizable dashboards — a template designer is a frontend-heavy feature. PDF/export generation today is client-side (jsPDF); templating belongs there. |
| Scheduled report generation | **DESCOPED** | Needs a per-tenant scheduler + a delivery channel (email). The delivery channel is the same blocker as collection reminders / payment gateways (no outbound-mail dependency added). The platform's control-plane has cron-style patterns that could host this later, but it's a standalone build. |

## Hardware & Integration

| Item | Status | Notes |
|---|---|---|
| Barcode scanning | **BUILT (backend)** | `barcode` field on Product + `GET /api/products/by-barcode/:code` POS lookup (flags ambiguous when two products share a code). The actual scanner input is a **frontend/hardware** concern (a USB scanner types into a field; a camera scanner is a JS library) — the backend now fully supports it. Tests: `server/test/barcode.integration.test.js`. |
| Payment terminal integration | **DESCOPED** | Requires a specific terminal vendor's SDK/hardware (e.g. a card terminal's API). Can't be built or tested without the actual device and merchant account. |
| Customer display screen support | **DESCOPED** | A second-screen/frontend feature (mirroring the cart to a customer-facing display) — no backend gap; it's a client-app build. |
| Payment gateway integration | **EXCLUDED** | Explicitly out of scope per your direction (no Stripe/PayMongo/Xendit SDK). |

---

## Summary

- **BUILT (8):** bill approval, payment scheduling, collection reminders,
  commission tracking, shift scheduling, customer contact tracking, discount
  rule engine, barcode backend.
- **PARTIAL (2, scope stated):** currency display config (not FX), dynamic
  pricing (via the discount engine, not surge repricing).
- **DESCOPED (5):** customizable dashboards, customizable report templates,
  scheduled report generation, payment terminal integration, customer display
  screen — each is either frontend-only, hardware/SDK-dependent, or needs an
  outbound-delivery dependency that's deliberately not being added.
- **EXCLUDED (1):** payment gateway integration (your call).

**Note on the running rehearsal tenants:** the 4 local Docker tenants
(`tenanta`–`tenantd`) are running images built before these features. They'd
need a rebuild (`docker compose ... up -d --build` per tenant, or recreate via
the control plane) to serve the new endpoints. The features are proven by the
server test suite regardless.
