# Hosting, email and website integration

## Free-plan deployment

The source has no license or subscription charge. A small deployment can use GitHub Pages, Supabase Free and Brevo Free, within their limits. This is not an unlimited-free or uptime guarantee. Brevo currently permits 300 emails/day, shared across mail sent by the account. Supabase’s built-in sender is unsuitable for student invitations: team-address-only and currently two emails/hour. Custom SMTP initially has a separate Supabase rate limit, which you configure in Authentication.

Official references checked September 15, 2026:

- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Brevo free-plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)
- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Supabase password recovery](https://supabase.com/docs/guides/auth/passwords)

## Publish the frontend

1. Create a GitHub repository for the app source only. Do not upload the entire original private handoff package or the containing `KEC_Makerspace` directory.
2. Put the contents of `app/` at the repository root. Include `.github/workflows/deploy-pages.yml`; exclude `.env.local`, `.venv`, `node_modules`, private sources and migration output (the supplied `.gitignore` does this).
3. In GitHub repository Settings → Secrets and variables → Actions → Variables, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from your current `.env.local`. These are browser configuration, not the database password or secret/service-role key.
4. In Settings → Pages, choose GitHub Actions. Push to main or run the supplied workflow. It verifies and publishes `dist/`. The Vite configuration handles the repository subpath automatically.
5. Use the exact HTTPS URL GitHub displays. For a repository named `kec-makerspace-app`, it is typically `https://YOUR-ACCOUNT.github.io/kec-makerspace-app/`; use your real account/organization, not this placeholder.
6. Update the Supabase Edge Function `APP_URL` secret to that full URL, including the repository path and final slash. Update `ALLOWED_ORIGINS` to include the host origin only, plus local testing origins if still needed. For example, if hosted under KEC’s existing organization:

```bash
npx supabase secrets set APP_URL=https://kec-innovation.github.io/kec-makerspace-app/ ALLOWED_ORIGINS=https://kec-innovation.github.io,http://127.0.0.1:5173,http://localhost:5173
```

Use that example only if it matches the URL you actually deployed. No new rate-limit/identity salts are required.

## Supabase Auth URLs and email

1. In Supabase Authentication → URL Configuration, set Site URL to the exact hosted app URL.
2. Add these exact redirect URLs using your real host and path:
   - `https://YOUR-HOST/YOUR-PATH/?account=reset`
   - `http://127.0.0.1:5173/?account=reset` for local tests.
3. Keep email confirmation enabled. Set the minimum password length to 12. The app’s signup/change form uses at least 12 characters too.
4. Create a Brevo Free account, verify your sending address and complete the provider’s sender/domain requirements. Use an address the Makerspace controls. No sender credentials are bundled.
5. Copy the SMTP host, port, login and SMTP key shown in Brevo to Supabase Authentication’s custom SMTP settings. Set sender name to KEC Makerspace. The SMTP key and Brevo API key are different credentials.
6. Keep the default Supabase confirmation, invitation and recovery link templates, or ensure their confirmation URL placeholder is retained. The app uses `?account=reset` because Supabase uses the URL fragment for Auth tokens.
7. Test an invitation and Forgot password with an address outside the Supabase project team. A successful API response is not proof of delivery; verify receipt and completing password setup.
8. Adjust Supabase’s email rate limit for expected attendance within your mail provider’s daily allowance. Do not disable email confirmation to work around email limits.

## Optional emailed temporary passwords

Setup links and Forgot password use custom SMTP. The additional “temporary password” invitation mode uses Brevo’s transactional API. It only creates NEW accounts; it never replaces an existing user’s password. The password is generated on the server, emailed once, and never returned to staff or stored in an application table. The account cannot use the app until a new password is set. There is no automatic timed expiry of the Auth password; password reset is available if the user loses it.

In Supabase’s Edge Function Secrets screen add:

- `BREVO_API_KEY`: a Brevo transactional API key.
- `MAIL_FROM`: the verified sender email.
- `APP_URL`: the real HTTPS app URL.

Use the secret-entry interface to avoid putting credentials in shell history. Do not put these values in any `VITE_` variable or send them in chat. Then an access officer can choose a person and **Send account email**. Existing accounts use **Forgot password**. Staff can recover/change their own password through the same account page; only an owner can restore a deactivated staff role.

No emails have been sent by this handoff. Credentials and sender verification must be completed in your accounts.

## Link from the existing GitHub website

Recommended: add normal links to the hosted app:

```html
<a href="https://YOUR-HOST/YOUR-PATH/#/account">Book equipment</a>
<a href="https://YOUR-HOST/YOUR-PATH/#/catalog">Materials and electronics</a>
<a href="https://YOUR-HOST/YOUR-PATH/#/policies">Makerspace policies</a>
```

For a catalog embed:

```html
<iframe src="https://YOUR-HOST/YOUR-PATH/#/catalog"
  title="KEC Makerspace equipment and materials"
  loading="lazy" style="width:100%;height:900px;border:0"></iframe>
```

Prefer opening login/booking in a normal page for reliable email recovery and phone use. Hash routes work on static GitHub Pages without a server rewrite. A public POST to `portal-api` with `{"action":"catalog"}` can also supply a future website integration; configure its origin allowlist and use only the publishable key. It returns equipment/material/plan data, never the people list or answer keys.

## Google Calendar display

The existing `calendar-sync` worker remains optional. It writes app bookings to configured equipment calendars; it does not read Google events to accept bookings. The event payload includes equipment, booking reference and status. It omits emails and project details and disables guest edits/invitations. Names can be included in private staff calendars using GOOGLE_CALENDAR_INCLUDE_NAMES=true. Give viewers read-only calendar sharing rights in Google. Google calendar owners can still edit their own events, but those edits never change app bookings.

Enable the existing worker and its schedule only if you want the mirror. The integration settings and service-account secrets must already be configured; simply deploying the function does not create a schedule. The database remains authoritative even if synchronization is delayed or disabled.

For the tested calendar reliability upgrade and activation steps, see `GOOGLE_CALENDAR_SETUP.md`.
