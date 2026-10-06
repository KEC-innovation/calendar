# KEC Makerspace · version 2.0

Student accounts, equipment bookings, supervised training, certifications, external subscriptions and staff operations. React/Vite frontend; Supabase Auth, PostgreSQL and Edge Functions backend. The app owns bookings; Google Calendar is an optional reference mirror.

**Upgrading the existing Mac installation? Read [MAC_UPDATE_AND_RUN.md](docs/MAC_UPDATE_AND_RUN.md). Do not reimport your legacy data.**

## Included

- Student signup and email confirmation; existing people matched by confirmed email, preserving imported passes.
- Student dashboard: own certifications, prerequisite status, bookings, cancellation, quiz results and subscription balances.
- Account setup links, temporary-password emails for new accounts, mandatory initial password change, forgot password and staff self-service recovery.
- Expiring, capacity-limited training QR sessions; selected quiz and mapped certification; authenticated participants; randomized questions; server timer and grading; one attempt per person/session.
- Manual training: date, trainer, evidence, outcome and certificate on a pass. Suspensions are not silently overridden.
- Focused staff responsibilities: training, access records, subscriptions and catalog. Owner/Admin retain the full operations console.
- Category-specific subscription plans from the supplied policy appendix, minimum three calendar months, renewal agreements, payment receipts, balances and calculated expiry.
- Public policies/tracking guide; equipment, filament, material and electronics catalog; explicit KEC/non-KEC material prices.
- Additive migrations 009–010, with no reimport or reset of existing people, certification or compliance data.

## Run locally

Use Node 24. Supply the public URL and publishable key in `.env.local` (see `.env.example`). An unconfigured app shows a setup screen; it no longer silently substitutes demo data.

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/`. Staff workspace: `/#/staff/login`. Policies: `/#/policies`. Catalog: `/#/catalog`.

## Verification

```bash
npm run verify
npx playwright install chromium
npm run test:e2e
npx deno check supabase/functions/portal-api/index.ts supabase/functions/admin-api/index.ts supabase/functions/quiz-api/index.ts supabase/functions/public-api/index.ts supabase/functions/calendar-sync/index.ts supabase/functions/notification-worker/index.ts
```

Database tests run actual PostgreSQL through PGlite with synthetic Auth identities, fixtures and rollback. Browser tests stub the remote Supabase responses; they verify the UI flow, not hosted service configuration. Read `docs/VALIDATION.md` for results and remaining live checks. Historical guest/demo browser tests are retained in `docs/legacy-e2e/` for reference; the account workflow replaces them.

## Hosting and configuration

The frontend can run on GitHub Pages. Publish app source only, never the original private package, migration output, person list, quiz workbooks or server secrets. Browser builds contain the public project URL/key only. Configure SMTP and `APP_URL` before invitations and phone QR sessions. See [HOSTING_AND_EMAIL.md](docs/HOSTING_AND_EMAIL.md).

## What remains a staff procedure

Priority ranks describe policy tiers; there is no automatic pending-request priority queue. Existing confirmations cannot be bumped. Fair-use reviews, reduced-capacity releases, incident decisions, appeals, public-holiday closure entry and hourly payment arrangements remain staff-managed. Subscription payments are a ledger, not an online checkout or automatic billing service. A paid plan does not grant certification, and an expired plan does not revoke permanent certification; eligible external users can arrange hourly use.

The supplied policy says a 10-minute quiz; the earlier locked app brief says 8 minutes, 16/20. The release retains 8 minutes and explicitly discloses this discrepancy. Do not claim full policy automation.
