# KEC Makerspace: certification dates and Google Calendar sync

This is a patch for your existing KEC-innovation/calendar app. Its live URL remains https://kec-innovation.github.io/calendar/. No account access is needed by ChatGPT. You apply the update from your own accounts. Imported people, training passes and certifications remain in the existing Supabase project. Do not rerun the importer or reset the database.

## 1. Apply the patch on your Windows app computer

Extract this ZIP. Open the extracted KEC_Makerspace_Date_Calendar_Patch folder in File Explorer. Click its address bar, type powershell, then press Enter.

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\APPLY_PATCH.ps1
```

It asks for your existing app folder. Press Enter to use:

```text
C:\Users\user\Downloads\KEC_Makerspace_v2_Update\KEC_Makerspace_v2_Update\app
```

The script checks that this is your existing Git repository, verifies the original versions of changed files, backs up those files under private/update-backups, and copies only this patch's files. It does not change .env.local, package files, credentials or imported data. If a file differs from the expected original and the patch, the script stops before copying; share its filename/error so the update can be adapted.

Enter that app folder in PowerShell:

```powershell
cd "C:\Users\user\Downloads\KEC_Makerspace_v2_Update\KEC_Makerspace_v2_Update\app"
git diff --stat
git status --short
npm.cmd run verify
```

After verification succeeds:

```powershell
git add src/features/portal/StudentPortal.tsx src/features/admin/sections/CertificationsPanel.tsx src/lib/certificationDate.ts supabase/functions/calendar-sync/index.ts supabase/functions/_shared/calendarEvents.ts supabase/migrations/202610060011_calendar_sync_reliability.sql tests/certificationDate.test.ts tests/calendarEvents.test.ts scripts/qa/verify-database.mjs docs/HOSTING_AND_EMAIL.md docs/GOOGLE_CALENDAR_SETUP.md
git commit -m "Fix missing certification dates and calendar synchronization"
git push origin main
```

Keep the existing repository variables. GitHub Actions rebuilds the same site. Once it succeeds, refresh the student account: missing dates should say "Issue date not recorded".

If working from the other computer without Git, use GitHub's repository root → Add file → Upload files. Drag the **docs, scripts, src, supabase and tests folders inside this patch's app folder**, keeping their folder paths, and commit to main. This uploads only changed files. The remaining backend steps need Supabase's SQL Editor and your existing CLI computer; no app server needs to be running.

## 2. Apply the additive database upgrade and deploy the worker

In PowerShell inside the existing app folder:

```powershell
npx.cmd supabase link --project-ref rgpoyqgfcgjelffuymnb
npx.cmd supabase db push --dry-run
```

The preview must list only **202610060011_calendar_sync_reliability.sql** (or no migration if already applied). If 001–010 appear, stop and share the output.

Then run these separately:

```powershell
npx.cmd supabase db push
npx.cmd supabase functions deploy calendar-sync --use-api
```

This deploys only the calendar worker. Its config has verify_jwt=false because the worker checks a dedicated secret header itself. The other functions and your current account login are unchanged.

A browser alternative for the database step is to paste the contents of app/supabase/migrations/202610060011_calendar_sync_reliability.sql into Supabase SQL Editor once. This bypasses the CLI migration ledger; use the CLI route when available. If you use the SQL Editor route, record it in the CLI on your app computer before future db push commands:

```powershell
npx.cmd supabase migration repair 202610060011 --status applied
```

## 3. Use your existing Google calendars and service account if already configured

In Supabase Edge Functions → Secrets, check for GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY. If both already exist and belong to the current calendar integration, retain them and reuse that service account. You do not need to create another one.

If this integration has never been configured:

1. Sign into https://console.cloud.google.com/ with the account that manages Makerspace's calendars. Select an existing project or create a Makerspace project.
2. APIs & Services → Library → Google Calendar API → Enable.
3. IAM & Admin → Service Accounts → Create service account. Name it KEC Calendar Sync. You do not need to grant project Owner or Editor access; calendar access is granted in Calendar.
4. Open the service account → Keys → Add key → Create new key → JSON. Keep the downloaded JSON outside your repository, or under its ignored private folder.
5. The JSON contains client_email and private_key. Add client_email as GOOGLE_SERVICE_ACCOUNT_EMAIL in Supabase Edge Function Secrets. Add private_key as GOOGLE_PRIVATE_KEY. Copy the complete key with BEGIN/END lines; the worker accepts either actual line breaks or literal \\n sequences. Do not put this JSON or private key in GitHub, your browser .env configuration, or a chat screenshot.
6. Leave GOOGLE_CALENDAR_DELEGATED_USER unset for an ordinary shared-calendar service account. Delegation is only for a separately configured Google Workspace integration.

Official references:
- https://developers.google.com/identity/protocols/oauth2/service-account
- https://developers.google.com/workspace/calendar/api/concepts/sharing

## 4. Share and map the calendars

Run setup/03_check_calendar_sync.sql in Supabase SQL Editor to view the equipment's existing calendar IDs. Do not overwrite existing mappings just to make a new calendar: existing event IDs belong to those calendars.

For each mapped equipment calendar:

1. Open https://calendar.google.com/ → Settings → select that calendar.
2. Under sharing with specific people, add the service-account client_email with **Make changes to events** permission.
3. Share it with the admins who need to see bookings, normally with **See all event details**. Each admin accepts/adds the calendar to their own Google Calendar. They can select all equipment calendars together in their normal Calendar view and phone app.

For equipment with an empty mapping:

- Use an existing Makerspace bookings calendar, or create one in Google Calendar under your own account.
- Settings → that calendar → Integrate calendar → copy **Calendar ID**. This is not the public URL, iframe code or a secret iCal URL.
- Staff portal → Equipment → Edit → Google Calendar ID → paste it → Save equipment.
- The same calendar ID can be used for several initially unmapped machines. Event titles distinguish the machines.
- Share that calendar with the service account and admins as above.

New mappings pick up future bookings automatically. Existing mapped events are updated using their stored IDs. Moving a calendar that already has synced events to another ID is a separate migration; keep its current mapping for this update.

## 5. Set secrets and enable the automatic schedule

Open Supabase SQL Editor and run setup/01_prepare_calendar_secret.sql. It generates a dedicated calendar worker secret in Vault and shows it once in the result. Copy that value directly into Edge Function Secrets as GOOGLE_CALENDAR_CRON_SECRET. It does not replace your existing CRON_SECRET used by the notification worker.

In Edge Function Secrets, set:

| Name | Value |
|---|---|
| GOOGLE_SERVICE_ACCOUNT_EMAIL | Existing service account's client_email |
| GOOGLE_PRIVATE_KEY | Existing service account's private_key |
| GOOGLE_CALENDAR_CRON_SECRET | Value generated by 01_prepare_calendar_secret.sql |
| GOOGLE_CALENDAR_ENABLED | true |
| GOOGLE_CALENDAR_INCLUDE_NAMES | true for calendars shared privately with staff; false to omit names |

Names are optional. A private staff event can read "Bambu A1 — Prasanna Jibi Ghimire · KEC-...". Participant emails, phone numbers and project details are not exported. Leave APP_URL, ALLOWED_ORIGINS and your current notification secrets as configured.

Run setup/02_start_calendar_schedule.sql in Supabase SQL Editor. It schedules the worker every minute under the name kec-calendar-sync-every-minute, with authorization read from Vault. Rerunning this file updates that named schedule. If you have an older schedule calling calendar-sync, disable that older duplicate and keep this one; keep notification schedules.

Supabase supports scheduled Edge Functions through pg_cron and pg_net, with credentials in Vault:
https://supabase.com/docs/guides/functions/schedule-functions

## 6. Prove the live integration before using it

1. Create one booking marked "System test" for a future available slot on mapped equipment.
2. Allow one to two minutes in normal operation. A large backlog or Google error can take longer; the worker handles five jobs per run and retries failures with backoff.
3. In your regular Google Calendar, check the right equipment, Nepal date/time, reference and optional name.
4. Run setup/03_check_calendar_sync.sql. That booking should have calendar_sync_status='synced' and an event ID.
5. Cancel the booking in the app. Confirm the event disappears from Google after another run.
6. Refresh/check that no duplicate was created. Test a real staff status update if needed; its event description should reflect the current status.

This is an app-to-Google mirror for administrator visibility. Use the app for bookings, cancellations and conflict checking; manually editing Google events does not change the app reservation. Admins can view the schedule without opening the portal. The sync keeps running when your computer and PowerShell are closed.

If sync fails, check:
- 401 worker response: dedicated calendar secret in Edge Function Secrets must match the Vault value.
- 403/404 Google response: Calendar API enabled, correct calendar ID, and service account has calendar write access.
- failed job: the booking remains valid; correct the configuration and allow retries, or use Dashboard → Calendar attention → Retry.
- processing for longer than ten minutes: the upgraded worker reclaims it after the lease expires.
- no events/no jobs: confirm an equipment mapping, GOOGLE_CALENDAR_ENABLED=true, and the Cron schedule is active.

## Verification of this package

Checked locally against the retained v2 update: TypeScript, ESLint, 33 unit tests (including mock Google API responses), 51 PostgreSQL checks, production build and built-secret scan passed. Google credentials, hosted functions, Cron extensions and a real Google calendar cannot be exercised without your account-side configuration. The live change is complete only after the booking/create/cancel test above succeeds.
