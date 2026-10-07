# Account and training workflow

## Participants

1. Open Home -> Register.
2. New users enter name, category, phone, email and a password twice. KEC students include their roll number; external college/business users include their organization.
3. Existing trainees select **Already trained? Link my existing Makerspace record**, use the email on their training record, and confirm it. Existing Auth users choose Sign in or Forgot password. Signup responses deliberately do not announce whether someone else's email has an account.
4. Confirm email, open My account, and confirm the profile if no existing record is found. Existing details and passes are not overwritten. Staff-only accounts can use their staff workspace without creating a personal student record. Adding a personal booking profile is optional and collapsed until selected.
5. Request equipment training with a contact number, preferred days/times and optional questions. Staff see the request and post session time/instructions in My account. Requests are visible in the app; this update does not send training-schedule notification emails.
6. Questions and special arrangements go to the help desk, including minor outreach: kec.innovation@kecktm.edu.np or the official website's Contact page.
7. Hands-on training and the assessment remain separate. A scheduled/completed appointment does not grant booking eligibility. The existing safety, waiver, adult status and equipment certification checks still apply.

## Trainer features

An Owner assigns training duties and equipment certification categories to qualified staff. A Trainer can:

- View pending/scheduled requests for authorized equipment and arrange a session time with instructions.
- Open a supervised QR admission window with a participant limit; students join using their own accounts.
- Close QR admission without shortening the timer of an assessment already started.
- Record documented hands-on or historical training evidence: Passed issues the authorized equipment certificate; Attended alone does not.
- View their own recent QR sessions and manual training history. Admin/Owner can see all authorized operations.

Trainer permission does not include staff management, broad directory access, safety/waiver verification, subscriptions or catalog editing unless Owner assigns those duties separately. New Trainers need equipment scope assigned before they can conduct assessments. Existing reviewed authority is preserved.

## Roles

| Role shown in app | Intended controls |
| --- | --- |
| Owner | Operational controls, staff management and reviewed duties; record archival with reasons |
| Admin | Operational controls, excluding Owner-only archival and staff management |
| Trainer | Assigned training types, supervised assessment and documented training |
| Staff | Only duties expressly assigned by Owner; stored role remains `viewer` for compatibility |
| MS Ambassador | Distinct role, no duties by default; future filament/electronics request approvals and checkout await Google Apps Script integration |

Only Owner can archive records. Permanent deletion is blocked to retain business history and audit evidence. Cancelling a booking/training request or revoking a certification retains the original record. Administrative roles do not grant personal equipment-use certification.

## Account security and email setup

Staff currently sign in with confirmed email and their own password. Mandatory authenticator setup and code checks are temporarily removed by request while email OTP is deferred. Existing authenticator factors are retained but are not enforced by the app. Owner changes and all staff APIs still check active role, duties and equipment scope on each request. Client caches do not grant authority.

In Supabase Authentication settings:

- Keep email confirmation enabled; minimum password length 12.
- Keep TOTP MFA enrollment/verification enabled. Do not disable it after deploying this patch.
- Site URL: `https://kec-innovation.github.io/calendar/`.
- Redirect allow list must include `https://kec-innovation.github.io/calendar/**`, including `?account=confirm` and `?account=reset` callback URLs. Confirmation and recovery are separate routes.
- Configure your existing verified SMTP provider for production delivery. SMTP credentials remain in Supabase settings, never in Vite variables or Git. Use your provider's TLS settings and verified sender/domain, with SPF/DKIM/DMARC as applicable.
- In Email Templates, paste `docs/auth-email-templates/confirmation.html`, `invite.html`, and `recovery.html` into Confirm signup, Invite user and Reset password. Keep `{{ .ConfirmationURL }}` exactly as written: Supabase creates and validates the token. Suggested subjects: Confirm your KEC Makerspace email; Set up your KEC Makerspace account; Reset your KEC Makerspace password.
- Disable email click tracking/link rewriting for authentication messages. Test a real confirmation, invite and recovery on a test account after saving settings. Hosted Auth, SMTP delivery and authenticator scanning cannot be validated by local synthetic tests.
- Existing authenticator factors remain stored; this release neither deletes them nor offers new enrollment. The app does not require their codes during the interim password-only phase.

Optional bot protection needs a real CAPTCHA integration and keys. Do not turn on Supabase CAPTCHA until the corresponding client widget/token support is installed, because that would block current forms. Built-in Auth rate limits remain active. This patch does not configure external service credentials or send messages.

Official references:

- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/auth/auth-mfa/totp
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/reference/javascript/auth-signup
- https://kec-innovation.github.io/makerspace/contact.html

## Booking, review, tables and performance

Click the first free block, then the last free block to select the time between them, including the final block. Clicking the same block twice selects that block. Reserved/closed gaps and equipment maximum durations are rejected. Typed start/end fields remain available. Confirmation still runs the database conflict/eligibility checks.

Overview Review opens saved scores and answer evidence, plus an audited follow-up note. Legacy results without individual answers say so; imported zero scores may be placeholders. Review never changes an assessment score or grants a certificate.

People name/safety/booking-heading sorting applies across the paginated query. Other tables sort their loaded rows, with a visible note saying so. Table scrolling is inside the panel with sticky headings and a bounded height. Narrow dashboard columns stack, and dialogs cover the viewport rather than being constrained by a panel.

Responsibilities load only the selected task. Independent queries run together, and returning to a workspace within 15 seconds reuses a bounded in-memory cache. Account/token keys keep users separate; writes, manual refresh and sign-out invalidate it. Booking availability remains separately refreshed and rechecked when booking. Hosted cold starts and network latency still affect uncached requests.

## Deferred email phase

The compact entry screens remain. The interim password release removes mandatory authenticator checks in the client, shared APIs and a new database migration. It does not enable email-code sign-in or change staff assignments. Existing Admins and Owners do not register again; new staff accept an Owner invitation once.

Production email delivery and branded templates are deferred. This hosted Free project uses Supabase's built-in sender and its email-template editor is locked. Customizing the templates requires a configured SMTP provider or an eligible paid plan. The built-in sender is restricted to project-team addresses, so ordinary student confirmation/invitation/recovery delivery is not production-ready until email setup is completed. Do not disable email confirmation to work around delivery.

The supplied docs/auth-email-templates HTML files are prepared designs, not active dashboard settings. The staff-otp.html file is reserved for the later email-code rollout. Finish and test production delivery before enabling that client/server flow. Revisit the current source and revalidate the authentication changes during that phase rather than reapplying an older patch over subsequent edits.

References:
- https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/auth-email-passwordless
