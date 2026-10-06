# Version 2.0 validation

Verified locally against the release source:

- TypeScript build checks and ESLint.
- 19 booking/access unit tests.
- 43 upgrade checks using actual PostgreSQL through PGlite, all migrations 001–010, synthetic Auth identities, and transactional fixtures.
- Earlier migration 009 checks: 21 staff-booking/prerequisite/priority and preservation cases.
- Deno type checks for all six Edge Functions.
- Production build and secret/answer-bank pattern scan.
- Update installer: backups and preservation of environment, virtual environment, migration output and Supabase project-link files, tested on a synthetic installation.

Database coverage includes verified-email account linking without reimport, denying participant/direct REST access to private tables and answer keys, staff capability separation, manual training and evidence, QR expiry/revocation/capacity, one attempt per person/session, 16/20 pass versus 15/20 failure, timeout, replay, suspensions, booking after a pass, cancellation ownership, calendar-month subscriptions and password-change restrictions.

Browser execution could not be completed in this workspace: the standard Chromium download timed out, and the alternate browser runtime did not launch successfully. These browser cases are supplied but are not reported as passed.

The browser regression suite covers account booking/cancellation, password recovery, QR-to-quiz flow, focused trainer controls, manual training, and responsive policy layout at desktop, 390px and 320px. Its Supabase responses are mocked. Hosted Auth, actual SMTP delivery, Google Calendar synchronization, and multi-device/concurrent network tests require the configured deployment.

No live Supabase mutation, student email, migration or public deployment was performed by this handoff. The update must be installed and configured using START_HERE.md before it is available in your current app.
