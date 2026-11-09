# ADAIG Portal — MVP

Association for Data and AI Governance member & public portal. Next.js 15 (App Router) · TypeScript · Tailwind v4 (utilities only) + the prototype's `tokens.css`/`site.css` · Prisma · Auth.js v5 · next-intl (EN/FR) · Stripe (test mode, with mock fallback).

## Run locally
```bash
cp .env.example .env            # then set AUTH_SECRET (openssl rand -base64 32)
npm install                     # runs prisma generate
npm run setup                   # create SQLite db + seed
npm run dev                     # http://localhost:3000  (→ /en)
npm run build && npm start      # production build
```
Seed logins (password `Password123!`): `admin@adaig.test` (staff admin), `member@adaig.test` (active Professional), `guest@adaig.test` (free guest).

## Configuration — founder decisions in ONE file
`src/config/site.ts` holds **locales, currencies (USD only; CAD kept for display of historic payments and can be re-enabled by adding it to `currencies`), membership tiers (names EN/FR, descriptions, prices per currency, benefits), US state sales-tax table (empty = no tax), US states/DC/territories and Canadian provinces (address only), CPE target**. Membership page, join/checkout, dashboard and admin all read from it; the DB stores only the tier id. Re-run nothing — just edit and reload. (The "Compare benefits" table and the corporate block on /membership are still the prototype's static HTML.)

## Database
Dev uses SQLite (`prisma/dev.db`) because Postgres/Docker weren't available on the build machine. To use Postgres: set `provider = "postgresql"` in `prisma/schema.prisma`, point `DATABASE_URL` at it, then `npm run setup`. No SQLite-specific features are used.

## Payments
- No `STRIPE_SECRET_KEY` → **mock checkout** (`/[locale]/join/checkout`) simulates payment and activates the membership.
- `STRIPE_SECRET_KEY=sk_test_...` → Stripe Checkout (hosted, PCI SAQ-A). Live keys (`sk_live_`) are **refused** in code. Membership activates on return (session verified server-side) and via webhook `POST /api/stripe/webhook` (set `STRIPE_WEBHOOK_SECRET`; locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`).
- No sales tax on dues by default. `salesTaxByState` (empty) can add per-state rates for US addresses; TODO: confirm with an accountant and use Stripe Tax before charging tax.

## Design
`scripts/extract-design.py` copies `<main>` content from `../design/*.html` into `src/content/en/*.html` with links rewritten to app routes (`npm run extract-design` to refresh). Content pages render that HTML in the React layout. French versions go in `src/content/fr/<page>.html`; until then FR shows English content with a notice (all UI chrome, nav, forms, membership, events, dashboard, admin are translated in `messages/fr.json`). Screenshots of the build: `docs/screenshots/`.

## Routes
| Area | Route | Status |
|---|---|---|
| Public | `/`, about, governance, certifications, verify, learning, community, chapters, resources, news, advocacy, careers, vendors, contact, legal | Prototype content (static) |
| Public | `/membership` | Live — tiers & currency from config |
| Public | `/join` → `/join/checkout` | Live — account + membership + Stripe/mock |
| Public | `/events`, `/events/[slug]` | Live — DB, filters, member-price auto-applied, registration |
| Auth | `/login`, `/signup` | Live — email/password (Auth.js credentials, JWT) |
| Auth | `/mfa` | Prototype only |
| Member | `/my/dashboard`, `/my/profile` (+ `/api/me/export`) | Live |
| Member | `/my/billing, credentials, learning, events, community, directory` | Login-gated prototype views (placeholder data) |
| Admin | `/admin/dashboard`, `/admin/members` (+ CSV), `/admin/events` (create/publish) | Live, role `admin` only |
| Admin | `/admin/content, credentialing, corporate, chapter` | Gated prototype views |
| Design | `/design/brand`, `/design/components` | Prototype reference |

## QA round 1 defaults (configurable in `src/config/site.ts`)
- Public directory opt-in is **off** by default (`directoryOptInDefault`).
- Student tier: institution + attestation required at join; membership stays `pending_verification` until staff Approve/Reject in Admin → Members.
- Event tickets are charged in **USD** (`eventCurrency`); paid tickets are `pending_payment` until Stripe test/mock confirms.
- Login throttling (`loginRateLimit`, stored in the DB table `LoginThrottle`, so it survives restarts and works across instances): after 5 failures an account is locked for 1 min, doubling with each further failure up to 15 min, and the count resets on success. A per-IP throttle (20 failures, then +0.5 s per attempt up to 5 s) only slows requests and never locks. It is used only when `TRUSTED_PROXY=true` (the IP is read `TRUSTED_PROXY_HOPS` entries from the right of X-Forwarded-For); otherwise X-Forwarded-For is ignored. To clear a lockout in dev, re-run `npm run db:seed` or delete the `LoginThrottle` rows.
- Provincial tax rates are placeholders. Have them confirmed by finance.
- CSP is set per request in `src/middleware.ts` with a nonce plus `'strict-dynamic'`, so script-src has no `'unsafe-inline'`. style-src keeps `'unsafe-inline'` because inline style attributes (React `style={}` and the prototype markup) can't carry nonces. API routes get `default-src 'none'`.
- Dashboard "Recommended for you" is rule-based and says so on the page. No AI or profiling is used.
- CSV exports escape formula-leading characters.
- Payments fail closed: with `NODE_ENV=production` and no Stripe key, checkout shows "Payment unavailable" unless `ALLOW_MOCK_PAYMENTS=true` is set (set in the local `.env` for this private demo only). A key that isn't `sk_test_` always disables payments.
- Rejected students (`REJECTED_STUDENT_POLICY`, default `notice_manual_refund`): staff enter a reason; the member sees the reason on their dashboard (EN/FR); a paid membership is flagged "Manual refund due" in Admin → Members, and staff click "Mark refunded" after refunding in Stripe. Nothing is refunded automatically. `notice_only` skips the flag. No email is sent because no mail provider is wired up yet.
- Event type/format labels are translated through `eventLabels` in the config.

## QA round 3
- **Admins**: `admin@adaig.test` and `admin2@adaig.test` are seeded. Admin → Members has Make admin / Remove admin buttons. Roles are read from the DB on every request, and removing or deleting the last admin is blocked (checked inside a transaction).
- **Unlock**: Admin → Members shows a "Locked" badge and an "Unlock account" button, which clears that account's `LoginThrottle` rows and writes `auth.account_unlocked` to the audit log. From the CLI: `npm run unlock -- user@example.com`.
- **Account deletion** (Profile → Delete my account): needs the confirmation box ticked and the password. It removes or anonymises name, email, password, organisation, job title, province, preferences, the CPE log, eligibility notes, free or unpaid registrations, and the email in audit targets. Memberships and paid registrations (amount, tax, currency, payment ref, dates) and the audit log are kept for tax and financial record-keeping, linked only to an opaque id. Active memberships are cancelled without refund, and the member is signed out.
- **Mock payments** are allowed only when `NODE_ENV` or `APP_ENV` is `development`/`local`, or when `ALLOW_MOCK_PAYMENTS=true` AND both `APP_URL` and the request Host are localhost/127.0.0.1. Otherwise the flag is ignored. Visitors see a generic "payment unavailable" message; the reason is logged on the server (`[payments] …`).
- **Input border** token `--c-input-border:#667085` (4.97:1 on white). The brand page and `design/assets/contrast.json` are updated.
- `REJECTED_STUDENT_POLICY` is unchanged (`notice_manual_refund` | `notice_only`).

## QA round 5 notes
- Migration `prisma/manual-migrations/2026-10-30_r5_membership_active_slot.sql` (additive: `Membership.activeSlot` + unique index). Back up `prisma/dev.db` first, then apply with `npx prisma db execute --file <sql> --schema prisma/schema.prisma && npx prisma generate`. No reseed.
- One open (pending / pending_verification / active) membership per person, enforced by `activeSlot` (DB) and in `/join` (redirect to `/my/dashboard?already=1`).
- Input rules live in `src/lib/validation.ts` (password 12–128 + blocklist, email format/254, field lengths, country/province whitelist).
- Account deletion options (product decision pending): `DELETED_USER_PAID_TICKETS=keep|cancel` (default keep), `DELETED_MEMBERSHIP_REFUND=none|flag_manual_refund` (default none).
- Verify: `qa/verify-r5/verify.mjs` (creates only `r5v+…@example.test` accounts).

## QA round 6 notes
- Unpaid membership orders (status `pending`) can be cancelled or replaced (pick another tier/currency) from `/join`, the checkout page and the dashboard.
- They expire after `UNPAID_ORDER_TTL_HOURS` (default 24): lazily on access (join, checkout, dashboard, admin members) and via `node scripts/expire-unpaid-orders.mjs [--dry-run]` (cron-able, idempotent). Paid/awaiting-verification orders are never touched. Stripe sessions are created with a matching `expires_at` (Stripe max 24 h); a payment that still lands on a cancelled/expired order is flagged "refund due", not activated.
- Payment replays against another user's ticket/order (or unknown ids, forged locale, bad Stripe `sid`) end on the dashboard with a friendly notice; nothing is charged, no 5xx.
- One-off data fix: `scripts/cleanup-r6.mjs [--dry-run]` (idempotent, only qa+upgrade / qa+student-pending).
- Verify: `qa/verify-r6/verify.mjs`.

## USD-only / US HQ (Nov 2026)
- ADAIG HQ is in the USA; new orders are USD only. Currency switches are hidden whenever `currencies` has one entry. Historic CAD payments keep their currency, and the admin dues table shows a column for every currency with data.
- Country defaults to United States; US addresses pick a state, DC or territory; Canada keeps provinces (no tax); other countries have no subdivision.
- Open unpaid CAD orders were cancelled with `node scripts/retire-cad-open-orders.mjs [--dry-run]` (idempotent, audit action `*_currency_retired`).
- Marketing consent is worded for CAN-SPAM; HQ address/phone are placeholders. Legal text needs lawyer review (see legal page).
- `prisma/schema.prisma` still has `country @default("Canada")` (changing a default on SQLite needs a table rebuild); the app always sets the country explicitly.
- Verify: `qa/verify-usd/verify.mjs`.
