# KEC Makerspace: update and restart on your Mac M4

Your Supabase project is already created, migrations 001–008 were applied, and the real import succeeded: 158 people, 184 equipment certificates and 193 training attempts. Keep these records. This update does not need the importer or Python virtual environment.

## 1. Reopen the current app after reboot

Open Terminal and paste:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 24
cd "$HOME/Downloads/KEC_Makerspace/app"
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open http://127.0.0.1:5173/ in Safari. Keep this Terminal running for local use. If port 5173 is occupied, first open that address: the previous server may already be running. Stop its Terminal with Control-C before restarting. This does not affect your cloud database.

Once the frontend is hosted on GitHub Pages, your Mac can be off; Supabase and the hosted website serve students independently. A phone cannot use your Mac’s `127.0.0.1` address.

## 2. Install this update

Download and unzip `KEC_Makerspace_v2_Update.zip` into Downloads. The folder should be named `KEC_Makerspace_v2_Update`, containing `app`, `apply_update.py` and `START_HERE.md`.

Stop the local development server with Control-C. In Terminal:

```bash
python3 "$HOME/Downloads/KEC_Makerspace_v2_Update/apply_update.py" --app "$HOME/Downloads/KEC_Makerspace/app"
```

The installer validates file hashes and creates a dated backup beside the app before replacing source files. It preserves your `.env.local`, `.venv`, Supabase link files, private sources, migration output and any unrelated files. It does not connect to or modify the database. It prints the backup path.

Then:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 24
cd "$HOME/Downloads/KEC_Makerspace/app"
npm ci
npx supabase link --project-ref rgpoyqgfcgjelffuymnb
npx supabase db push --dry-run
```

Expected new migrations:

- `202609110009_staff_booking_policy_checks.sql`
- `202609150010_accounts_training_subscriptions.sql`

If 001–008 are shown again, stop: check the project link and migration history. Do not reset the database or run the importer. If 009 was already applied, only 010 should be pending.

Apply and deploy:

```bash
npx supabase db push
npx supabase functions deploy --use-api
npx supabase secrets set APP_URL=http://127.0.0.1:5173/
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

`APP_URL` above is only for testing on this Mac. Replace it with the deployed HTTPS URL before inviting students or using QR codes on their phones. Keep your existing rate-limit, identity and cron secrets. The new function is `portal-api`; all six functions need the current source.

Open http://127.0.0.1:5173/#/staff/login and use your existing owner account. Refresh Safari with Command-R. Go to **My responsibilities** to see the new features. Existing people/certificates should still be present.

## 3. Configure account emails

Follow `HOSTING_AND_EMAIL.md`. Do this before sending student invitations. Without custom SMTP, Supabase only sends to project-team addresses. Temporary-password invitations additionally need a Brevo API key and verified sender.

Students can create their own account with the email on their training record. A confirmed email matches the existing person; it does not create a replacement person or erase certificates. A new trainee first needs a person record from staff.

## 4. Assign staff tasks

In **Staff access**, invite someone as **Trainer** or **Focused staff**. Use the responsibilities selector to choose:

- Training: QR sessions and manual training entries.
- Access: add people, verify safety/waiver/age evidence, send account invitations.
- Subscriptions: agreements and payment receipts.
- Catalog: public material/electronics stock.

Trainer defaults to Training. Focused staff starts with no tasks until assigned. Owner and Admin have full operations access; only Owner manages staff. Staff should sign in again after task changes. An invitation to someone who already has an Auth account may fail; an owner can add that existing Auth user UUID to `staff_roles` through the Supabase Table Editor rather than creating another account. Never grant staff status from student profile metadata.

## 5. Run training

1. Access staff add/find the participant using the existing email and verify actual one-time evidence.
2. Trainer opens **My responsibilities → Training & QR sessions**.
3. Choose quiz, certification, QR admission window and capacity.
4. Show/download the QR. Students sign in on their own phones and scan it.
5. Each student starts one timed assessment; closing admission does not interrupt an attempt already started.
6. Passing issues the authorized equipment certificate immediately. Verified adults with safety/waiver records and active booking privileges can book the equipment.
7. Existing passes should not be repeated. Use a manual training entry for a documented assessment where appropriate.

Manual entries require trainer name, date, outcome and evidence. Attendance alone grants nothing. Suspended/revoked certification needs an authorized administrator’s review.

## 6. External clients and catalog

Subscriptions: choose client and equipment plan, start date, at least three months and agreement reference. Add receipt-backed payments separately. Balance and expiry appear in staff and client views. Renew with a new agreement. Cancel with a reason. The app does not charge cards or deduct bank payments.

Catalog: publish actual filament/material/electronics quantity, unit and market price. KEC and non-KEC material prices are shown automatically. Stock is manually maintained; consuming a material does not automatically deduct inventory in this release.

## 7. Before opening to students

Use one owner account and one separate test student account to verify email confirmation/reset, existing certificate linking, one QR assessment and one booking/cancellation. Check phone access using the real HTTPS address. Keep the private roster and quiz source workbooks off GitHub. Read the policy page’s explicit limits; physical safety checks and disciplinary decisions stay with the team.

## Recovery

If an install step fails, the source backup printed by the installer is available. Reapplying the source installer is safe; it creates a new backup. Do not roll back cloud data by deleting tables. Applied additive migrations stay in place. A frontend rollback alone may not restore the old guest-booking API because v2 deliberately requires account sign-in.

If the Supabase connection times out before any migration is applied, retry `npx supabase db push`. If a migration reports a SQL error, keep the complete error and stop there rather than resetting or editing the migration history.
