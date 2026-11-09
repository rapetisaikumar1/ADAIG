# ADAIG Portal

Association for Data and AI Governance member & public portal. Next.js 15 (App Router) · TypeScript · Tailwind v4 (utilities only) + `src/styles/tokens.css`/`site.css` · Prisma · Auth.js v5 · next-intl (EN/FR) · Stripe (test mode, with mock fallback; used for paid event tickets only).

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
`src/config/site.ts` holds **locales, currencies (USD only; CAD kept for display of historic payments and can be re-enabled by adding it to `currencies`), membership tiers (names EN/FR, descriptions, prices per currency, benefits), US state sales-tax table (empty = no tax), US states/DC/territories and Canadian provinces (address only), CPE target**. Membership page, join, dashboard and admin all read from it; the DB stores only the tier id. Re-run nothing — just edit and reload. Tier prices in the config are not shown publicly (dues are still being finalized; the point of contact confirms them after an application). The "Compare benefits" table, enterprise section and FAQ on /membership come from `src/content/<locale>/membership.html`.

## Database
Dev uses SQLite (`prisma/dev.db`) because Postgres/Docker weren't available on the build machine. To use Postgres: set `provider = "postgresql"` in `prisma/schema.prisma`, point `DATABASE_URL` at it, then `npm run setup`. No SQLite-specific features are used.

## Payments
- Membership applications take **no payment** (see "Membership applications" below). Stripe is used only for paid event tickets.
- No `STRIPE_SECRET_KEY` → **mock checkout** (`/[locale]/events/[slug]/checkout`) simulates the ticket payment and confirms the registration.
- `STRIPE_SECRET_KEY=sk_test_...` → Stripe Checkout (hosted, PCI SAQ-A). Live keys (`sk_live_`) are **refused** in code. Tickets are confirmed on return (session verified server-side) and via webhook `POST /api/stripe/webhook` (set `STRIPE_WEBHOOK_SECRET`; locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`). `/join/checkout` remains only to finish legacy membership sessions.
- No sales tax by default. `salesTaxByState` (empty) can add per-state rates for US addresses; TODO: confirm with an accountant and use Stripe Tax before charging tax.

## Content
Public pages are HTML fragments in `src/content/en/*.html` (`__L__` is replaced with `/<locale>`), rendered inside the React layout by `src/lib/content.ts`. **Content is now edited directly in `src/content`.** (`scripts/extract-design.py` / `npm run extract-design` regenerated these files from the original `../design/*.html` prototype, which is not part of this repo; don't run it, as it would overwrite the edited content.) French versions go in `src/content/fr/<page>.html`; `home` and `membership` are translated, other pages show the English text with a notice. All UI chrome, nav, forms, membership, events, dashboard and admin strings are in `messages/en.json` / `messages/fr.json` (keep the key sets identical). Copy is US English. Screenshots of an earlier build: `docs/screenshots/`.

## Routes
| Area | Route | Status |
|---|---|---|
| Public | `/` | Static content (`home.html`) + upcoming events read live from the DB |
| Public | about, principles, governance, community, chapters, resources, news, advocacy, careers, vendors, legal | Static content (`src/content/<locale>/<page>.html`) |
| Public | `/contact` | Working contact form (`?topic=` preselects a topic) beside the FAQ from `src/content/<locale>/contact.html`; messages are stored in `ContactMessage` and handled in Admin → Messages |
| Public | `/membership` | Tiers & benefits from config, no prices shown; compare table/enterprise/FAQ from `membership.html` |
| Public | `/join` | Membership application (account + details, no payment); the ADAIG point of contact (POC) follows up; staff approve in Admin → Members |
| Public | `/events`, `/events/[slug]` | DB-backed, filters (type, format, search), times shown in ET (America/New_York), member price auto-applied, registration; paid tickets via `/events/[slug]/checkout` |
| Auth | `/login`, `/signup` | Email/password (Auth.js credentials, JWT); signup creates a free guest account with a news opt-in |
| Member | `/my/dashboard`, `/my/profile` (+ `/api/me/export`), `/my/billing` (membership status, event receipts), `/my/events`, `/my/directory` (opt-in, active members only) | Live data, login required |
| Member | `/my/community` | Login required; explains what is planned and links to what exists |
| Admin | `/admin/dashboard`, `/admin/members` (+ CSV, approve/reject), `/admin/events` (create/publish) | Live, role `admin` only |
| Admin | `/admin/content`, `/admin/corporate`, `/admin/chapter` | Planned staff tools: static previews with sample data, controls disabled |
| Admin | `/admin/messages` | Contact-form inbox: New / Handled / All, reply by email, mark handled or reopen |
| Design | `/design/brand`, `/design/components` | Brand & component reference (admins only; others are redirected home) |

Removed: `/certifications`, `/learning`, `/verify`, `/mfa`, `/my/credentials`, `/my/learning`, `/admin/credentialing` (certification and learning modules are not part of the offering).

## QA round 1 defaults (configurable in `src/config/site.ts`)
- Public directory opt-in is **off** by default (`directoryOptInDefault`).
- Student tier: institution + attestation required at join; membership stays `pending_verification` until staff Approve/Reject in Admin → Members.
- Event tickets are charged in **USD** (`eventCurrency`); paid tickets are `pending_payment` until Stripe test/mock confirms.
- Login throttling (`loginRateLimit`, stored in the DB table `LoginThrottle`, so it survives restarts and works across instances): after 5 failures an account is locked for 1 min, doubling with each further failure up to 15 min, and the count resets on success. A per-IP throttle (20 failures, then +0.5 s per attempt up to 5 s) only slows requests and never locks. It is used only when `TRUSTED_PROXY=true` (the IP is read `TRUSTED_PROXY_HOPS` entries from the right of X-Forwarded-For); otherwise X-Forwarded-For is ignored. To clear a lockout in dev, re-run `npm run db:seed` or delete the `LoginThrottle` rows.
- CSP is set per request in `src/middleware.ts` with a nonce plus `'strict-dynamic'`, so script-src has no `'unsafe-inline'`. style-src keeps `'unsafe-inline'` because inline style attributes (React `style={}` and the prototype markup) can't carry nonces. API routes get `default-src 'none'`.
- Dashboard "Recommended for you" is rule-based and says so on the page. No AI or profiling is used.
- CSV exports escape formula-leading characters.
- Payments fail closed: with `NODE_ENV=production` and no Stripe key, checkout shows "Payment unavailable" unless `ALLOW_MOCK_PAYMENTS=true` is set (set in the local `.env` for this private demo only). A key that isn't `sk_test_` always disables payments.
- Rejected students (`REJECTED_STUDENT_POLICY`, default `notice_manual_refund`): staff enter a reason; the member sees the reason on their dashboard (EN/FR); a paid membership is flagged "Manual refund due" in Admin → Members, and staff click "Mark refunded" after refunding in Stripe. Nothing is refunded automatically. `notice_only` skips the flag. No email is sent because no mail provider is wired up yet.
- Event type/format labels are translated through `eventLabels` in the config.

## QA round 3
- **Admins**: `admin@adaig.test` and `admin2@adaig.test` are seeded. Admin → Members has Make admin / Remove admin buttons. Roles are read from the DB on every request, and removing or deleting the last admin is blocked (checked inside a transaction).
- **Unlock**: Admin → Members shows a "Locked" badge and an "Unlock account" button, which clears that account's `LoginThrottle` rows and writes `auth.account_unlocked` to the audit log. From the CLI: `npm run unlock -- user@example.com`.
- **Account deletion** (Profile → Delete my account): needs the confirmation box ticked and the password. It removes or anonymizes name, email, password, organization, job title, province, preferences, the CPE log, eligibility notes, free or unpaid registrations, and the email in audit targets. Memberships and paid registrations (amount, tax, currency, payment ref, dates) and the audit log are kept for tax and financial record-keeping, linked only to an opaque id. Active memberships are canceled without refund, and the member is signed out.
- **Mock payments** are allowed only when `NODE_ENV` or `APP_ENV` is `development`/`local`, or when `ALLOW_MOCK_PAYMENTS=true` AND both `APP_URL` and the request Host are localhost/127.0.0.1. Otherwise the flag is ignored. Visitors see a generic "payment unavailable" message; the reason is logged on the server (`[payments] …`).
- **Input border** token `--c-input-border:#667085` (4.97:1 on white). The brand page is updated.
- `REJECTED_STUDENT_POLICY` is unchanged (`notice_manual_refund` | `notice_only`).

## QA round 5 notes
- Migration `prisma/manual-migrations/2026-10-30_r5_membership_active_slot.sql` (additive: `Membership.activeSlot` + unique index). Back up `prisma/dev.db` first, then apply with `npx prisma db execute --file <sql> --schema prisma/schema.prisma && npx prisma generate`. No reseed.
- One open (pending / pending_verification / active) membership per person, enforced by `activeSlot` (DB) and in `/join` (redirect to `/my/dashboard?already=1`).
- Input rules live in `src/lib/validation.ts` (password 12–128 + blocklist, email format/254, field lengths, country/province whitelist).
- Account deletion options (product decision pending): `DELETED_USER_PAID_TICKETS=keep|cancel` (default keep), `DELETED_MEMBERSHIP_REFUND=none|flag_manual_refund` (default none).

## QA round 6 notes
- Legacy unpaid membership orders (status `pending`, from the earlier payment flow) can be canceled from `/join` and the dashboard.
- They expire after `UNPAID_ORDER_TTL_HOURS` (default 24): lazily on access (join, checkout, dashboard, admin members) and via `node scripts/expire-unpaid-orders.mjs [--dry-run]` (cron-able, idempotent). Paid/awaiting-verification orders are never touched. Stripe sessions are created with a matching `expires_at` (Stripe max 24 h); a payment that still lands on a canceled/expired order is flagged "refund due", not activated.
- Payment replays against another user's ticket/order (or unknown ids, forged locale, bad Stripe `sid`) end on the dashboard with a friendly notice; nothing is charged, no 5xx.
- One-off data fix: `scripts/cleanup-r6.mjs [--dry-run]` (idempotent, only qa+upgrade / qa+student-pending).

## USD-only / US HQ (Nov 2026)
- ADAIG HQ is in the USA; new orders are USD only. Currency switches are hidden whenever `currencies` has one entry. Historic CAD payments keep their currency, and the admin dues table shows a column for every currency with data.
- Country defaults to United States; US addresses pick a state, DC or territory; Canada keeps provinces (no tax); other countries have no subdivision.
- Open unpaid CAD orders were canceled with `node scripts/retire-cad-open-orders.mjs [--dry-run]` (idempotent, audit action `*_currency_retired`).
- Marketing consent is worded for CAN-SPAM. No HQ postal address or phone is published yet. Legal text needs lawyer review (see legal page).
- `prisma/schema.prisma` still has `country @default("Canada")` (changing a default on SQLite needs a table rebuild); the app always sets the country explicitly.

## Membership applications (Nov 2026)
- `/join` captures data only: no prices, tax or payment step. Submitting creates the account (if needed) and a membership in status `pending_verification` for any tier (amount/tax 0, no `paymentRef`, `autoRenew` false), audit `membership.application_submitted`, then redirects to `/my/dashboard?applied=1`, which says the ADAIG team point of contact (POC) will be in touch.
- Staff approve or reject in Admin → Members ("Application review" column). Approve makes the membership active for one year and the user a member; reject shows the reason on the member's dashboard. No refund is flagged because nothing was paid.
- `pending_verification` is never auto-expired. Legacy unpaid `pending` orders can still be canceled from `/join` or the dashboard; `/join/checkout` only completes a legacy Stripe session, then redirects to the dashboard.

## Contact form & bilingual events (Nov 2026)
- `/contact` stores messages in the `ContactMessage` table (name, email, optional organization, topic, message, locale). Validation, a honeypot field and a limit of 5 messages per email per hour; audit `contact.message_received`. Staff see them in Admin → Messages (sidebar shows the count of new messages). Deleting an account also deletes that person's contact messages.
- Events have an optional `summaryFr`; French pages show it when present (Admin → Events has a "Summary (French)" field). Event times are entered and shown in US Eastern time (ET). Unconfirmed events are marked by ending the title with "(proposed)": they show a Proposed badge, no fixed day, and are excluded from member recommendations and registration.
- Schema changes since the first release were applied with `npx prisma db push` (additive only).


## Deploying to Vercel
SQLite is for local development only: on Vercel the file system is read-only and temporary, so production uses a hosted **PostgreSQL** database (Supabase, or Neon, from the Vercel Marketplace). The same `prisma/schema.prisma` serves both — `scripts/prisma-provider.mjs` switches the datasource provider to `postgresql` when the connection URL starts with `postgres://`/`postgresql://` (it runs in `postinstall` and in `vercel-build`; locally nothing changes). It accepts `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED`, Neon) or `POSTGRES_PRISMA_URL` (+ `POSTGRES_URL_NON_POOLING`, Supabase integration); the non-pooled URL is used as `directUrl` for schema pushes.

1. **Database:** Vercel → Project → Storage → Create Database → **Supabase** (or Neon), connected to this project for Production and Preview. The integration adds the connection variables (`POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, … for Supabase; `DATABASE_URL`, `DATABASE_URL_UNPOOLED` for Neon) automatically.
2. **Environment variables** (Project → Settings → Environment Variables, for Production and Preview):
   - `AUTH_SECRET` — required by Auth.js; generate with `openssl rand -base64 32`.
   - The database variables from step 1 (added by the integration; set `DATABASE_URL` yourself only if you use another Postgres host).
   - Optional: `APP_URL` (the site URL), `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (test keys only) for paid event tickets.
3. **Deploy:** `npm run vercel-build` (used automatically by Vercel) checks the variables, generates the Prisma client for Postgres, applies the schema with `prisma db push`, then builds. A missing variable fails the build with a clear message instead of a runtime error.
4. **Seed once (optional):** from your machine, against the hosted database:
   `DATABASE_URL="<non-pooled postgres url>" SEED_PASSWORD="<strong password>" npm run db:seed` — run `node scripts/prisma-provider.mjs && npx prisma generate` with the same `DATABASE_URL` first so the local Prisma client targets Postgres, then `git checkout prisma/schema.prisma && npx prisma generate` to switch back to SQLite.
   The seed refuses to run on a hosted database without `SEED_PASSWORD`, and refuses if users already exist (it wipes all tables) unless `SEED_FORCE=1`. Change or remove the demo accounts before a public launch.

Page content in `src/content` is read at runtime, so `next.config.ts` includes it in the serverless bundle (`outputFileTracingIncludes`).
