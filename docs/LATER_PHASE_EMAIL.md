# Later phase: production email and staff codes

Status: deferred by request on 7 October 2026. One reminder is scheduled for 14 October 2026, 12:08 pm Nepal time.

Current release: compact Home, aligned registration and password sign-in screens, optional collapsed personal booking profile for staff. Current deployed database/API sign-in policy is retained.

Before enabling email codes:

1. Arrange one dedicated Makerspace email sender: college IT SMTP or a verified transactional email provider. No personal mailbox password is required when a dedicated provider is used.
2. Configure real SMTP credentials in Supabase and verify delivery to a test address outside the project team.
3. Apply the prepared confirmation/invitation/recovery branding and the staff-otp.html sign-in code template. Keep their respective link/code variables intact.
4. Review the email-code client, shared API authentication checks and staff RPC migration against the then-current app. The earlier OTP ZIP remains available, but its installer hashes may no longer match later UI edits.
5. Verify active role, confirmed email, proof, permissions, training scope, password-only denials and inactive/nonstaff denials.
6. Coordinate one migration, all affected API deployments and the client release. Test real Owner/Trainer sign-in, student confirmation, recovery and invitations.

Do not reset/import operational data or change Google Calendar mappings, worker credentials or schedules as part of email setup.
