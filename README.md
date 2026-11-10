# ADAIG Portal

Association for Data and AI Governance member & public portal. Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 (utilities only) + `src/styles/tokens.css`/`site.css` · Prisma 7 on Supabase Postgres · Auth.js v5 · next-intl (EN/FR) · Stripe (test mode, with mock fallback; used for paid event tickets only).

## Run locally (online Supabase)
Requirements: Node 26 (`.nvmrc`; any Node `^22.12 || >=24` works) and a Supabase project (use a **development** project, not production).
```bash
cp .env.example .env            # paste DATABASE_URL / DIRECT_URL from Supabase → Connect → ORMs → Prisma; set AUTH_SECRET (openssl rand -base64 32)
npm install                     # also runs `prisma generate` (client in src/generated/prisma, gitignored)
npx prisma migrate deploy       # create/upgrade the tables (+ RLS lockdown); `npm run db:check-rls` verifies it
SEED_PASSWORD="<12+ chars>" npm run db:seed   # once, on an empty database: demo accounts + events
npm run dev                     # http://localhost:3000  (→ /en)
npm run build && npm start      # production build
```
Seed logins: `admin@adaig.test` (staff admin), `admin2@adaig.test`, `member@adaig.test` (active Professional), `guest@adaig.test` (free guest), all with the `SEED_PASSWORD` you chose (on a `localhost` database the seed defaults to `Password123!`). The seed refuses a database that already has users unless `SEED_FORCE=1` (it wipes the tables). Offline alternative: `npx supabase start` (Docker) and the local URLs noted in `.env.example`.

Useful commands: `npm run lint` (ESLint CLI; `next lint` no longer exists), `npm run typecheck`, `npm run db:seed` (re-seed: wipes the app tables), `npm run db:reset` (drop + re-apply all migrations + seed; local only), `npm run db:check-rls`, `npx prisma studio`. Health check: `GET /api/health` → `{ "ok": true, "db": "up" }` (503 with `"down"` when the database does not answer).

## Architecture
- **Next.js 16 App Router**: pages are React Server Components that read the database directly (`src/lib/db.ts`); mutations are Server Actions (`actions.ts` next to each page). Route handlers only for the CSV/JSON exports, the Stripe webhook, Auth.js and `/api/health`. Turbopack builds dev and production.
- **Prisma 7** with the `prisma-client` generator (`src/generated/prisma`) and the **`@prisma/adapter-pg`** driver adapter (node-postgres; no Rust query engine). The runtime uses the pooled URL with a small pool (`DB_POOL_MAX`, default 5); the CLI (`prisma.config.ts`), seed and scripts use the direct URL. Server environment is validated with zod in `src/lib/env.ts` (secrets never reach the browser).
- **Supabase Postgres** is the only database. Schema history is versioned in `prisma/migrations` (`prisma migrate dev` locally, `prisma migrate deploy` on Vercel). Row Level Security is enabled on every `public` table with no policies, and the Data API roles `anon`/`authenticated` have no grants, so Supabase's REST/GraphQL API exposes nothing; the app connects as the table owner and is unaffected. `scripts/check-rls.mjs` fails if a table is missing RLS.
- **Auth.js v5** (credentials provider, JWT sessions). The role is re-read from the database on every session lookup; login throttling lives in the `LoginThrottle` table.
- **next-intl** (EN/FR, `/en` and `/fr` prefixes) and a **per-request nonce CSP**, both in `src/proxy.ts` (Next.js 16's name for middleware; Node.js runtime).

## Configuration — founder decisions in ONE file
`src/config/site.ts` holds **locales, currencies (USD only; CAD kept for display of historic payments and can be re-enabled by adding it to `currencies`), membership tiers (names EN/FR, descriptions, prices per currency, benefits), US state sales-tax table (empty = no tax), US states/DC/territories and Canadian provinces (address only), CPE target**. Membership page, join, dashboard and admin all read tiers through `src/lib/settings.ts`; the DB stores only the tier id. The values in `site.ts` are the **defaults**: staff can override tier names/descriptions/benefits (EN/FR), order, visibility, “most popular” and eligibility checks, the public contact details and the operational policies in **Admin → Settings** (`Setting` table, effective on the next request; “Reset to default” removes the override). Tier ids and prices stay in code. Tier prices in the config are not shown publicly (dues are still being finalized; the point of contact confirms them after an application). The "Compare benefits" table, enterprise section and FAQ on /membership come from `src/content/<locale>/membership.html`.

## Database
Supabase Postgres, locally via the Supabase CLI and in production via Supabase on Vercel (see "Deploying to Vercel"). To change the schema: edit `prisma/schema.prisma`, run `npx prisma migrate dev --name <change>` (creates and applies a new folder in `prisma/migrations`; then `npx prisma generate`), commit the folder. New tables need `ALTER TABLE "<Table>" ENABLE ROW LEVEL SECURITY;` in their migration (`npm run db:check-rls` and the Vercel build fail otherwise). Status columns are plain strings validated in code. `User.name` uses collation `"C"` (byte order, set in the init migration) so the member directory sorts exactly as it did on SQLite; text search uses case-insensitive `contains` (ILIKE).

## Payments
- Membership applications take **no payment** (see "Membership applications" below). Stripe is used only for paid event tickets.
- No `STRIPE_SECRET_KEY` → **mock checkout** (`/[locale]/events/[slug]/checkout`) simulates the ticket payment and confirms the registration.
- `STRIPE_SECRET_KEY=sk_test_...` → Stripe Checkout (hosted, PCI SAQ-A). Live keys (`sk_live_`) are **refused** in code. Tickets are confirmed on return (session verified server-side) and via webhook `POST /api/stripe/webhook` (set `STRIPE_WEBHOOK_SECRET`; locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`). `/join/checkout` remains only to finish legacy membership sessions.
- No sales tax by default. `salesTaxByState` (empty) can add per-state rates for US addresses; TODO: confirm with an accountant and use Stripe Tax before charging tax.

## Content
Public pages are HTML fragments in `src/content/en/*.html` (`__L__` is replaced with `/<locale>`), rendered inside the React layout by `src/lib/content.ts`. The files are the **defaults**; staff can edit any page in EN/FR in **Admin → Content** (stored in `ContentPage` with full revision history, sanitized on save by `src/lib/contentSanitize.ts`; “Return to the original” deletes the override). Developers edit the default files directly in `src/content`. (`scripts/extract-design.py` / `npm run extract-design` regenerated these files from the original `../design/*.html` prototype, which is not part of this repo; don't run it, as it would overwrite the edited content.) French versions go in `src/content/fr/<page>.html`; `home` and `membership` are translated, other pages show the English text with a notice. All UI chrome, nav, forms, membership, events, dashboard and admin strings are in `messages/en.json` / `messages/fr.json` (keep the key sets identical). Copy is US English. Screenshots of an earlier build: `docs/screenshots/`.

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
| Admin | `/admin/dashboard` | Applications awaiting review, members, registrations, recent activity, links to every tool and CSV export |
| Admin | `/admin/members`, `/admin/members/[id]`, `/admin/members/new` | Members & applications (approve/reject, CSV); account page: profile, role, unlock, staff password reset (signs out existing sessions), memberships (tier, renewal, lapse, cancel, reactivate, grant, refunds), CPE ledger, activity, delete/anonymize; create accounts |
| Admin | `/admin/events`, `/admin/events/[id]` | Create, edit (EN/FR, ET times), publish, cancel/restore, delete (no registrations); registrations with search/filters, attendance (credits CPE once), cancel tickets, per-event CSV |
| Admin | `/admin/messages` | Contact-form inbox: New / Handled / All, reply by email, mark handled or reopen |
| Admin | `/admin/content`, `/admin/content/[slug]/[lang]` | Edit public page content (EN/FR) with live preview, revision history, restore and reset to default |
| Admin | `/admin/settings` | Membership tiers, public contact details, operational policies |
| Admin | `/admin/audit`, `/admin/system` | Audit log (filters, CSV); system status (database, migrations, RLS, environment checklist without values, scheduled job) |
| Admin | `/admin/corporate`, `/admin/chapter` | Planned staff tools: static previews with sample data, controls disabled |
| API | `/api/admin/{members,messages,registrations,audit}.csv`, `/api/admin/events/[id]/registrations.csv`, `/api/cron/expire-unpaid-orders`, `/api/health` | Admin-only CSV exports (formula-escaped, no-store); daily cron (Bearer `CRON_SECRET`); health check |
| Design | `/design/brand`, `/design/components` | Brand & component reference (admins only; others are redirected home) |

Removed: `/certifications`, `/learning`, `/verify`, `/mfa`, `/my/credentials`, `/my/learning`, `/admin/credentialing` (certification and learning modules are not part of the offering).

## QA round 1 defaults (configurable in `src/config/site.ts`)
- Public directory opt-in is **off** by default (`directoryOptInDefault`).
- Student tier: institution + attestation required at join; membership stays `pending_verification` until staff Approve/Reject in Admin → Members.
- Event tickets are charged in **USD** (`eventCurrency`); paid tickets are `pending_payment` until Stripe test/mock confirms.
- Login throttling (`loginRateLimit`, stored in the DB table `LoginThrottle`, so it survives restarts and works across instances): after 5 failures an account is locked for 1 min, doubling with each further failure up to 15 min, and the count resets on success. A per-IP throttle (20 failures, then +0.5 s per attempt up to 5 s) only slows requests and never locks. It is used only when `TRUSTED_PROXY=true` (the IP is read `TRUSTED_PROXY_HOPS` entries from the right of X-Forwarded-For); otherwise X-Forwarded-For is ignored. To clear a lockout in dev, re-run `npm run db:seed` or delete the `LoginThrottle` rows.
- CSP is set per request in `src/proxy.ts` with a nonce plus `'strict-dynamic'`, so script-src has no `'unsafe-inline'`. style-src keeps `'unsafe-inline'` because inline style attributes (React `style={}` and the prototype markup) can't carry nonces. API routes get `default-src 'none'`.
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
- `Membership.activeSlot` + unique index (originally a manual SQLite migration) is part of the Postgres init migration.
- One open (pending / pending_verification / active) membership per person, enforced by `activeSlot` (DB) and in `/join` (redirect to `/my/dashboard?already=1`).
- Input rules live in `src/lib/validation.ts` (password 12–128 + blocklist, email format/254, field lengths, country/province whitelist).
- Account deletion options (product decision pending): `DELETED_USER_PAID_TICKETS=keep|cancel` (default keep), `DELETED_MEMBERSHIP_REFUND=none|flag_manual_refund` (default none).

## QA round 6 notes
- Legacy unpaid membership orders (status `pending`, from the earlier payment flow) can be canceled from `/join` and the dashboard.
- They expire after `UNPAID_ORDER_TTL_HOURS` (default 24): lazily on access (join, checkout, dashboard, admin members) and via `npm run expire-unpaid-orders [-- --dry-run]` (cron-able, idempotent). Paid/awaiting-verification orders are never touched. Stripe sessions are created with a matching `expires_at` (Stripe max 24 h); a payment that still lands on a canceled/expired order is flagged "refund due", not activated.
- Payment replays against another user's ticket/order (or unknown ids, forged locale, bad Stripe `sid`) end on the dashboard with a friendly notice; nothing is charged, no 5xx.
- One-off data fix: `npx tsx scripts/cleanup-r6.mts [--dry-run]` (idempotent, only qa+upgrade / qa+student-pending).

## USD-only / US HQ (Nov 2026)
- ADAIG HQ is in the USA; new orders are USD only. Currency switches are hidden whenever `currencies` has one entry. Historic CAD payments keep their currency, and the admin dues table shows a column for every currency with data.
- Country defaults to United States; US addresses pick a state, DC or territory; Canada keeps provinces (no tax); other countries have no subdivision.
- Open unpaid CAD orders were canceled with `npx tsx scripts/retire-cad-open-orders.mts [--dry-run]` (idempotent, audit action `*_currency_retired`).
- Marketing consent is worded for CAN-SPAM. No HQ postal address or phone is published yet. Legal text needs lawyer review (see legal page).
- `prisma/schema.prisma` still has `country @default("Canada")` (kept from the SQLite schema); the app always sets the country explicitly.

## Membership applications (Nov 2026)
- `/join` captures data only: no prices, tax or payment step. Submitting creates the account (if needed) and a membership in status `pending_verification` for any tier (amount/tax 0, no `paymentRef`, `autoRenew` false), audit `membership.application_submitted`, then redirects to `/my/dashboard?applied=1`, which says the ADAIG team point of contact (POC) will be in touch.
- Staff approve or reject in Admin → Members ("Application review" column). Approve makes the membership active for one year and the user a member; reject shows the reason on the member's dashboard. No refund is flagged because nothing was paid.
- `pending_verification` is never auto-expired. Legacy unpaid `pending` orders can still be canceled from `/join` or the dashboard; `/join/checkout` only completes a legacy Stripe session, then redirects to the dashboard.

## Contact form & bilingual events (Nov 2026)
- `/contact` stores messages in the `ContactMessage` table (name, email, optional organization, topic, message, locale). Validation, a honeypot field and a limit of 5 messages per email per hour; audit `contact.message_received`. Staff see them in Admin → Messages (sidebar shows the count of new messages). Deleting an account also deletes that person's contact messages.
- Events have an optional `summaryFr`; French pages show it when present (Admin → Events has a "Summary (French)" field). Event times are entered and shown in US Eastern time (ET). Unconfirmed events are marked by ending the title with "(proposed)": they show a Proposed badge, no fixed day, and are excluded from member recommendations and registration.
- Schema changes are versioned migrations in `prisma/migrations` (see "Database").


## Deploying to Vercel (with Supabase)
Production uses a hosted **Supabase Postgres** database (Vercel's file system is read-only, and SQLite is no longer supported). The app connects through Supabase's **transaction pooler** (Supavisor, port 6543 — right for serverless functions); migrations run over the **direct/session** connection.

1. **Database:** Vercel → Project → Storage → Create/Connect Database → **Supabase**, for Production and Preview. The integration adds `POSTGRES_PRISMA_URL` (pooled) and `POSTGRES_URL_NON_POOLING` (direct), which the app and build use automatically. Without the integration, set `DATABASE_URL` (pooled, `…:6543/postgres?pgbouncer=true&sslmode=require`) and `DIRECT_URL` (`…:5432/postgres?sslmode=require`) from Supabase → Connect; these win over the integration names.
2. **Environment variables** (Project → Settings → Environment Variables, Production and Preview):
   - `AUTH_SECRET` — required (`openssl rand -base64 32`); production rejects short or placeholder values.
   - `CRON_SECRET` — required for the daily scheduled job in `vercel.json` (expires stale unpaid orders, prunes old sign-in throttle rows); Vercel sends it as a Bearer token. Without it the job answers 503.
   - `TRUSTED_PROXY=true`, `TRUSTED_PROXY_HOPS=1` — recommended on Vercel so sign-in throttling also counts per client IP (Vercel sets `X-Forwarded-For`).
   - The database variables from step 1.
   - Optional: `APP_URL` (the site URL), `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (test keys only), `DB_POOL_MAX` (default 5 per instance).
3. **Deploy:** `npm run vercel-build` (used automatically by Vercel) runs `scripts/check-env.mjs` (a missing or wrong variable fails the build with a clear message), `prisma generate`, `prisma migrate deploy` (applies pending migrations, including the RLS lockdown), `scripts/check-rls.mjs` (fails if any public table lacks RLS), then `next build`. Node version: `engines` in package.json (Vercel uses Node 26). Functions run in **Mumbai (`bom1`, `vercel.json` → `regions`)** next to the Supabase database (ap-south-1); change both together if the database moves.
4. **Seed once (optional):** from your machine, against the hosted database (direct URL):
   `DIRECT_URL="<direct postgres url>" SEED_PASSWORD="<strong password>" npm run db:seed`.
   The seed refuses to run on any non-localhost database without `SEED_PASSWORD`, and refuses if users already exist (it wipes all tables) unless `SEED_FORCE=1`. Change or remove the demo accounts before a public launch.
5. **Monitoring:** point an uptime monitor at `/api/health`.

**Upgrading a database created before migrations** (the earlier `prisma db push` deployment): don't let the first deploy run against it unprepared — `migrate deploy` stops with "database schema is not empty" (P3005). Back it up, then with `DIRECT_URL` pointing at it run `npx prisma db execute --file prisma/upgrade-from-db-push.sql` (timestamps → timestamptz as UTC, collation, new indexes; data kept), `npx prisma migrate resolve --applied 20261110134554_init`, `npx prisma migrate deploy` and `npm run db:check-rls`. If the hosted data is disposable demo data, an empty database plus `npm run db:seed` (with `SEED_PASSWORD`) is simpler.

Page content in `src/content` is read at runtime, so `next.config.ts` includes it in the serverless bundle (`outputFileTracingIncludes`).

## Testing (end-to-end, Playwright)
`tests/e2e` holds a Playwright suite that drives the running app in a browser and checks the database: public pages EN/FR (status, console errors, no horizontal overflow at 390px), security headers/CSP nonce, auth and lockout, join → approval, member area, contact → inbox, admin members/events/content/settings/audit/system, CSV access control, Server Action authorization replays, cron auth and Supabase RLS.
```bash
npm run build && npm start                 # the suite tests a running app (default http://localhost:3000; E2E_BASE_URL to change)
npx playwright install chromium            # once (or use a local Chrome: PW_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", or PW_CHANNEL=chrome)
npm run test:e2e                           # desktop project (all tests) + mobile project (tests tagged @smoke)
npm run test:e2e -- --project=desktop specs/admin-events.spec.ts   # one file
npm run test:e2e:smoke                     # @smoke tests only
npm run test:e2e:report                    # open the HTML report (traces/screenshots of failures)
npm run test:e2e:cleanup                   # remove e2e data after an interrupted run
```
- **Data**: tests create their own throwaway data (users `e2e+<run>-<n>@example.test`, ids `e2e-…`, events `E2E …`) and only read the seed accounts (`Password123!`, override with `E2E_SEED_PASSWORD`). Tests that change shared state (settings, page content, seed admin roles) undo it through the admin UI in `finally`, so the app's settings/content cache stays correct.
- **Cleanup**: the global setup snapshots the database; the global teardown deletes everything the run wrote (markers + a per-test ledger of unmarked rows such as admin audit entries), restores seed rows, compares with the snapshot and prints before/after table counts (`tests/.state/db-report.json`). Rows written meanwhile by other people using the same database are left alone and reported. `E2E_RESTORE=strict` (CI / dedicated database) restores every table exactly and fails on any difference; `E2E_KEEP_DATA=1` skips cleanup for debugging.
- **Settings**: one worker (tests share the seed accounts and the app cache), retries only on CI (`CI=1`), traces kept on failure. The database is read from `E2E_DATABASE_URL`, else `DIRECT_URL`/`DATABASE_URL` in `.env`. Never run it against production.
- **CI**: start Supabase (`npx supabase start`), `npm ci && npm run setup && npm run build`, `npx playwright install --with-deps chromium`, then `CI=1 E2E_RESTORE=strict E2E_START_SERVER=1 npm run test:e2e` (Playwright starts `npm start` itself); publish `playwright-report/` and `test-results/e2e-junit.xml`.
