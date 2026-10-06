# Legacy migration

The importer is deliberately separate from the web application. It reads personal records and quiz answers only from a private local directory, writes only non-identifying audit summaries during a dry run, and applies the complete model in one database transaction.

Run it only against the new Supabase project and only before live quiz attempts begin.

## Required private files

Create `private/legacy-source/` and place one exact copy of each file inside it:

```text
KEC Makerspace Booking System.xlsx
Code.gs
KEC Makerspace_Laser Cutting Quiz.xlsx
KEC Makerspace_3d Printing Quiz.xlsx
```

The directory is excluded from Git and from the application source folder. The private handoff includes these files separately in `private-sources/`. Do not rename, publish, or move them into `src/` or `public/`.

## Install the migration dependencies

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r scripts/import-legacy/requirements.txt
```

## Dry run

```bash
npm run migration:dry-run
```

Inspect both generated files:

- `migration-output/summary.json` contains aggregate counts and validation results.
- `migration-output/review.csv` contains hashed subjects and source-row references, not names or emails.

The last source audit found 11 equipment rows, 193 non-test training attempts, 40 quiz questions, 184 defensible certification records, and 3 non-test bookings. Missing source emails were converted to inactive review records. Reconcile a new dry run to these numbers or explain every difference before applying it.

All 144 supplied Authorized Users identities have recognized equipment training: 112 printing certifications, 68 laser, 2 scanning, and 2 electronics (people may hold more than one). There are 158 person records total after historical training/bookings are reconciled, not 158 approved users. The seven passed results with legacy review states remain passed; staff should correct the missing details and grant the relevant certification after matching the original record, without starting another quiz.

From the private handoff's `app/` directory, use:

```bash
python scripts/import-legacy/import_legacy.py --source-dir ../private-sources --output-dir migration-output --test-records exclude
```

After checking the report and setting `DATABASE_URL`, repeat that command with `--apply`. Do not run it on the old production database.

## Apply once the review passes

Use the direct database connection string for the new Supabase project. Keep it only in the current terminal session.

```bash
export DATABASE_URL='YOUR_DIRECT_POSTGRES_CONNECTION_STRING'
npm run migration:apply -- --test-records exclude
```

The explicit `exclude` decision prevents the detected legacy test submissions and test booking from entering production. Use `keep` only if KEC staff have reviewed and intentionally accepted every detected test row.

The apply step uses stable IDs and is limited to pre-launch use. Repeated imports preserve staff edits to people and certification statuses, including suspensions and revocations. It refuses to replace the quiz bank after any live quiz attempt exists. Database replay behavior still requires staging verification before production use.

## Required staff review after import

1. Open **People & access** and filter for migration review.
2. Verify safety orientation, waiver, and adult/minor status from authoritative records.
3. Keep people with synthetic `@invalid.local` addresses inactive until their real email is confirmed.
4. Preserve certifications imported from explicit equipment permissions. Their source-list evidence counts; a missing issue date is not a reason to make the person repeat training.
5. Confirm the seven-day schedule and any closures.
6. Check the 11 equipment records, calendar mappings, and certification requirements.
7. Confirm that Tables 1 and 2 are inactive and not bookable.
8. Run one supervised test attempt for each active quiz only after staff sign-in works.

Do not manually copy quiz answers into frontend code, GitHub Actions, browser variables, or documentation.
